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

// --- Golden Boot: scrape goalscorers from match summaries ---

async function fetchSummary(eventId) {
  const url = `${config.espnBase}/summary?event=${encodeURIComponent(eventId)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'worldcup-ladder/1.0 (+ladder)' } });
  if (!resp.ok) throw new Error(`summary ${eventId} HTTP ${resp.status}`);
  return resp.json();
}

// Goals + assists (excluding own goals; penalties count) for the given teams in
// an ESPN match summary. On a goal event, participants[0] is the scorer and
// participants[1] (when present) is the assister — both on the scoring team.
function extractContributions(summary, teamSet) {
  const goals = [];
  const assists = [];
  for (const ke of summary.keyEvents || []) {
    if ((ke.type || {}).type !== 'goal') continue;
    if (/own goal/i.test(ke.text || '')) continue;
    const team = ke.team && ke.team.displayName;
    if (!team || !teamSet.has(team.toLowerCase())) continue;
    const parts = ke.participants || [];
    const scorer = parts[0] && parts[0].athlete;
    if (scorer && scorer.id) {
      goals.push({ athleteId: String(scorer.id), athleteName: scorer.displayName || 'Unknown', team });
    }
    const assister = parts[1] && parts[1].athlete;
    if (assister && assister.id) {
      assists.push({ athleteId: String(assister.id), athleteName: assister.displayName || 'Unknown', team });
    }
  }
  return { goals, assists };
}

// Scrape scorers for completed drafted-team matches not yet scraped. Incremental
// and bounded (only your teams' new games), so syncs stay fast. Returns count.
async function syncScorers() {
  const dt = await query(`SELECT lower(name) AS n FROM teams WHERE player_id IS NOT NULL`);
  const drafted = dt.rows.map((r) => r.n);
  if (!drafted.length) return 0;
  // Also scrape the spotlight team (Socceroos) so we can show their scorers.
  const interest = [...new Set([...drafted, config.spotlightTeam.toLowerCase()])];
  const interestSet = new Set(interest);

  const todo = await query(
    `SELECT api_fixture_id FROM matches
      WHERE status IN ('FT','AET','PEN','AWD','WO')
        AND (lower(home_team) = ANY($1::text[]) OR lower(away_team) = ANY($1::text[]))
        AND api_fixture_id NOT IN (SELECT fixture_id FROM scraped_fixtures)`,
    [interest]
  );

  let scraped = 0;
  for (const { api_fixture_id: fid } of todo.rows) {
    try {
      const summary = await fetchSummary(fid);
      const { goals, assists } = extractContributions(summary, interestSet);
      const tally = (list) => {
        const m = new Map();
        for (const x of list) {
          if (!m.has(x.athleteId)) m.set(x.athleteId, { ...x, count: 0 });
          m.get(x.athleteId).count += 1;
        }
        return m;
      };
      const byGoal = tally(goals);
      const byAssist = tally(assists);
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM scorers WHERE fixture_id = $1`, [fid]);
        for (const g of byGoal.values()) {
          await client.query(
            `INSERT INTO scorers (fixture_id, athlete_id, athlete_name, team, goals)
             VALUES ($1,$2,$3,$4,$5)`,
            [fid, g.athleteId, g.athleteName, g.team, g.count]
          );
        }
        await client.query(`DELETE FROM assists WHERE fixture_id = $1`, [fid]);
        for (const a of byAssist.values()) {
          await client.query(
            `INSERT INTO assists (fixture_id, athlete_id, athlete_name, team, assists)
             VALUES ($1,$2,$3,$4,$5)`,
            [fid, a.athleteId, a.athleteName, a.team, a.count]
          );
        }
        await client.query(
          `INSERT INTO scraped_fixtures (fixture_id) VALUES ($1)
           ON CONFLICT (fixture_id) DO UPDATE SET scraped_at = NOW()`,
          [fid]
        );
      });
      scraped += 1;
    } catch (err) {
      console.warn(`[sync] scorer scrape failed for ${fid}: ${err.message}`);
      // leave unmarked so it retries next sync
    }
  }
  return scraped;
}

// Resolve a player photo from Wikipedia's page image (keyed by name). ESPN has
// headshots for almost no footballers, but Wikipedia has them for nearly every
// notable player. Tries the exact title, then a "<name> footballer" search,
// then one retry — with a Wikipedia-compliant User-Agent. Returns a URL or null.
async function resolvePhoto(name) {
  if (!name) return null;
  const headers = {
    'User-Agent': 'WorldCupLadder/1.0 (https://worldcup-ladder.onrender.com; World Cup ladder app)',
  };
  const enc = encodeURIComponent(name);
  const direct =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1` +
    `&prop=pageimages&piprop=thumbnail&pithumbsize=320&titles=${enc}`;
  const search =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1` +
    `&generator=search&gsrsearch=${enc}%20footballer&gsrlimit=1` +
    `&prop=pageimages&piprop=thumbnail&pithumbsize=320`;

  const attempt = async (url) => {
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) return null;
      const data = await resp.json();
      const pages = (data.query && data.query.pages) || {};
      for (const k of Object.keys(pages)) {
        const t = pages[k].thumbnail;
        if (t && t.source) return t.source;
      }
    } catch (_) {
      /* ignore and try the next strategy */
    }
    return null;
  };

  return (await attempt(direct)) || (await attempt(search)) || (await attempt(direct));
}

// Backfill photos for any scorer athlete we don't have one for yet. Runs every
// sync; once resolved an athlete is skipped, so it stays cheap. Returns count.
async function resolveMissingPhotos() {
  const rows = (await query(
    `SELECT x.athlete_id, MAX(x.athlete_name) AS name
       FROM (
         SELECT athlete_id, athlete_name FROM scorers
         UNION ALL
         SELECT athlete_id, athlete_name FROM assists
       ) x
       LEFT JOIN athlete_photos ap ON ap.athlete_id = x.athlete_id
      WHERE ap.athlete_id IS NULL OR ap.photo_url IS NULL
      GROUP BY x.athlete_id`
  )).rows;
  let resolved = 0;
  for (const r of rows) {
    const photo = await resolvePhoto(r.name);
    await query(
      `INSERT INTO athlete_photos (athlete_id, name, photo_url) VALUES ($1,$2,$3)
       ON CONFLICT (athlete_id) DO UPDATE SET name = EXCLUDED.name, photo_url = EXCLUDED.photo_url`,
      [r.athlete_id, r.name, photo]
    );
    if (photo) resolved += 1;
  }
  return resolved;
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

    const scorersScraped = await syncScorers();
    const photosResolved = await resolveMissingPhotos();

    const message =
      `Scanned ${events.length} fixtures · ${completed} completed · ${processed} new/updated` +
      `${scorersScraped ? ` · ${scorersScraped} scorer scrape(s)` : ''}` +
      `${photosResolved ? ` · ${photosResolved} photo(s)` : ''}.`;
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
