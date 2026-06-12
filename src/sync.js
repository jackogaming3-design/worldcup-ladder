'use strict';

const { query, withTransaction } = require('./db');
const { config } = require('./config');

// ----------------------------------------------------------------------------
// Data source: ESPN's free public scoreboard for the FIFA World Cup.
//   GET {espnBase}/scoreboard?dates=YYYYMMDD-YYYYMMDD
// No API key or signup required. We scan the tournament window in weekly chunks
// and dedupe events by id. Both finished AND upcoming fixtures are stored so the
// app can show the ladder (from finished games) and upcoming-clash highlights.
// ----------------------------------------------------------------------------

const STAGE_LABELS = {
  'group-stage': 'Group Stage',
  'round-of-32': 'Round of 32',
  'round-of-16': 'Round of 16',
  quarterfinals: 'Quarterfinals',
  'quarter-finals': 'Quarterfinals',
  semifinals: 'Semifinals',
  'semi-finals': 'Semifinals',
  final: 'Final',
  'third-place': 'Third Place',
  '3rd-place': 'Third Place',
};

function prettyStage(slug) {
  if (!slug) return null;
  return (
    STAGE_LABELS[slug] ||
    String(slug).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseYmd(s) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function toInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Fetch all World Cup events across the configured window (weekly chunks).
async function fetchEvents() {
  const season = parseInt(config.season, 10) || new Date().getUTCFullYear();
  const start = parseYmd(config.windowStart) || new Date(Date.UTC(season, 5, 1)); // 1 Jun
  const end = parseYmd(config.windowEnd) || new Date(Date.UTC(season, 7, 1)); // 1 Aug

  const headers = { 'User-Agent': 'worldcup-ladder/1.0 (+ladder)' };
  const byId = new Map();

  let cursor = new Date(start);
  let guard = 0;
  while (cursor <= end && guard < 60) {
    guard += 1;
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 6);
    const rangeEnd = chunkEnd > end ? end : chunkEnd;

    const url = `${config.espnBase}/scoreboard?dates=${ymd(cursor)}-${ymd(rangeEnd)}`;
    const resp = await fetch(url, { headers });
    if (resp.ok) {
      const data = await resp.json();
      for (const ev of data.events || []) byId.set(String(ev.id), ev);
    } else {
      console.warn(`[sync] ESPN chunk ${ymd(cursor)} returned HTTP ${resp.status}`);
    }

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return [...byId.values()];
}

// Map an ESPN event to our match shape. Returns null if it can't be parsed.
// Finished games carry a result; upcoming/live games are stored with no result
// and status NS (not started) / LIVE so they can power upcoming highlights.
function normaliseEvent(ev) {
  const comp = (ev.competitions || [])[0] || {};
  const st = (ev.status || {}).type || {};
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home');
  const away = cs.find((c) => c.homeAway === 'away');
  if (!home || !away || !home.team || !away.team) return null;

  const completed = st.completed === true;
  const winnerComp = cs.find((c) => c.winner === true);
  const hadShootout = cs.some((c) => c.shootoutScore != null);

  let status;
  let homeGoals = null;
  let awayGoals = null;
  let homePen = null;
  let awayPen = null;
  let winnerTeam = null;

  if (completed) {
    homeGoals = toInt(home.score);
    awayGoals = toInt(away.score);
    homePen = home.shootoutScore != null ? Number(home.shootoutScore) : null;
    awayPen = away.shootoutScore != null ? Number(away.shootoutScore) : null;
    winnerTeam = winnerComp && winnerComp.team ? winnerComp.team.displayName : null;
    const name = `${st.name || ''} ${st.detail || ''}`;
    if (hadShootout) status = 'PEN';
    else if (/AET|EXTRA/i.test(name)) status = 'AET';
    else status = 'FT';
  } else {
    // Not finished: a scheduled or in-progress fixture with no stored result.
    status = st.state === 'in' ? 'LIVE' : 'NS';
  }

  return {
    apiFixtureId: String(ev.id),
    homeTeam: home.team.displayName,
    awayTeam: away.team.displayName,
    homeGoals,
    awayGoals,
    homePen,
    awayPen,
    winnerTeam,
    status,
    completed,
    round: prettyStage((ev.season || {}).slug),
    matchDate: ev.date || null,
    raw: ev,
  };
}

// Upsert by fixture id. The WHERE clause means updated_at only moves when
// something material changed, so "last updated" stays meaningful and we don't
// count no-op rows as processed. Returns true if inserted or changed.
async function upsertMatch(client, m) {
  const res = await client.query(
    `INSERT INTO matches
       (api_fixture_id, home_team, away_team, home_goals, away_goals,
        home_pen, away_pen, winner_team, status, round, match_date, raw_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
     ON CONFLICT (api_fixture_id) DO UPDATE SET
        home_team   = EXCLUDED.home_team,
        away_team   = EXCLUDED.away_team,
        home_goals  = EXCLUDED.home_goals,
        away_goals  = EXCLUDED.away_goals,
        home_pen    = EXCLUDED.home_pen,
        away_pen    = EXCLUDED.away_pen,
        winner_team = EXCLUDED.winner_team,
        status      = EXCLUDED.status,
        round       = EXCLUDED.round,
        match_date  = EXCLUDED.match_date,
        raw_json    = EXCLUDED.raw_json,
        updated_at  = NOW()
     WHERE  matches.status      IS DISTINCT FROM EXCLUDED.status
        OR  matches.home_goals  IS DISTINCT FROM EXCLUDED.home_goals
        OR  matches.away_goals  IS DISTINCT FROM EXCLUDED.away_goals
        OR  matches.home_pen    IS DISTINCT FROM EXCLUDED.home_pen
        OR  matches.away_pen    IS DISTINCT FROM EXCLUDED.away_pen
        OR  matches.winner_team IS DISTINCT FROM EXCLUDED.winner_team
        OR  matches.match_date  IS DISTINCT FROM EXCLUDED.match_date
     RETURNING id`,
    [
      m.apiFixtureId, m.homeTeam, m.awayTeam, m.homeGoals, m.awayGoals,
      m.homePen, m.awayPen, m.winnerTeam, m.status, m.round, m.matchDate,
      JSON.stringify(m.raw),
    ]
  );
  return res.rows.length > 0;
}

// Runs a full sync and records a row in sync_logs. Used by both the HTTP
// endpoint and the cron CLI. Never throws — returns a result object.
async function runSync({ trigger = 'manual' } = {}) {
  const logRes = await query(
    `INSERT INTO sync_logs (status, trigger) VALUES ('running', $1) RETURNING id`,
    [trigger]
  );
  const logId = logRes.rows[0].id;

  try {
    const events = await fetchEvents();
    let completed = 0;
    let processed = 0;

    await withTransaction(async (client) => {
      for (const ev of events) {
        const m = normaliseEvent(ev);
        if (!m) continue;
        if (m.completed) completed += 1;
        if (await upsertMatch(client, m)) processed += 1;
      }
    });

    const message = `Scanned ${events.length} fixtures · ${completed} completed · ${processed} new/updated.`;
    await query(
      `UPDATE sync_logs
          SET status='success', message=$2, fixtures_processed=$3, finished_at=NOW()
        WHERE id=$1`,
      [logId, message, processed]
    );
    console.log('[sync]', message);
    return { ok: true, fixtures: events.length, completed, processed, message, logId };
  } catch (err) {
    const message = String(err && err.message ? err.message : err).slice(0, 500);
    await query(
      `UPDATE sync_logs SET status='error', message=$2, finished_at=NOW() WHERE id=$1`,
      [logId, message]
    );
    console.error('[sync] failed:', message);
    return { ok: false, error: message, logId };
  }
}

async function lastSync() {
  const res = await query(
    `SELECT id, started_at, finished_at, status, trigger, message, fixtures_processed
       FROM sync_logs
      ORDER BY started_at DESC
      LIMIT 1`
  );
  return res.rows[0] || null;
}

module.exports = { runSync, lastSync, fetchEvents, normaliseEvent, prettyStage };
