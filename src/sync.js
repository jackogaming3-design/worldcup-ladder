'use strict';

const { query, withTransaction } = require('./db');
const { config } = require('./config');
const { isCompleted } = require('./scoring');

// Winner from API-Football's boolean flags (accounts for ET + penalties).
function deriveWinner(fx) {
  const h = fx.teams && fx.teams.home;
  const a = fx.teams && fx.teams.away;
  if (h && h.winner === true) return h.name;
  if (a && a.winner === true) return a.name;
  return null;
}

// Fetch every fixture for the configured league + season (handles paging).
async function fetchFixtures() {
  if (!config.apiKey) {
    throw new Error('API_FOOTBALL_KEY is not set — cannot sync results.');
  }

  const headers = { [config.apiKeyHeader]: config.apiKey };
  const all = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url =
      `${config.apiBaseUrl}/fixtures` +
      `?league=${encodeURIComponent(config.leagueId)}` +
      `&season=${encodeURIComponent(config.season)}` +
      `&page=${page}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`API-Football HTTP ${resp.status}: ${body.slice(0, 300)}`);
    }

    const data = await resp.json();
    const errs = data.errors;
    const hasErrors = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
    if (hasErrors) {
      throw new Error(`API-Football returned errors: ${JSON.stringify(errs).slice(0, 300)}`);
    }

    all.push(...(data.response || []));
    totalPages = (data.paging && data.paging.total) || 1;
    page += 1;
  } while (page <= totalPages);

  return all;
}

function normaliseFixture(fx) {
  const status = fx.fixture && fx.fixture.status && fx.fixture.status.short;
  return {
    apiFixtureId: String(fx.fixture.id),
    homeTeam: fx.teams.home.name,
    awayTeam: fx.teams.away.name,
    homeGoals: fx.goals.home,
    awayGoals: fx.goals.away,
    homePen: fx.score && fx.score.penalty ? fx.score.penalty.home : null,
    awayPen: fx.score && fx.score.penalty ? fx.score.penalty.away : null,
    winnerTeam: deriveWinner(fx),
    status,
    round: fx.league && fx.league.round,
    matchDate: fx.fixture && fx.fixture.date,
    raw: fx,
  };
}

// Upsert by fixture id. The WHERE clause means updated_at only moves when
// something material actually changed, so "last updated" stays meaningful and
// we don't count no-op rows as processed. Returns true if inserted or changed.
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
     RETURNING id`,
    [
      m.apiFixtureId, m.homeTeam, m.awayTeam, m.homeGoals, m.awayGoals,
      m.homePen, m.awayPen, m.winnerTeam, m.status, m.round, m.matchDate,
      JSON.stringify(m.raw),
    ]
  );
  // No row returned => the DO UPDATE WHERE blocked a no-op update.
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
    const fixtures = await fetchFixtures();
    let completed = 0;
    let processed = 0;

    await withTransaction(async (client) => {
      for (const fx of fixtures) {
        const m = normaliseFixture(fx);
        if (!isCompleted(m.status)) continue;
        if (m.homeGoals == null || m.awayGoals == null) continue;
        completed += 1;
        if (await upsertMatch(client, m)) processed += 1;
      }
    });

    const message = `Fetched ${fixtures.length} fixtures · ${completed} completed · ${processed} new/updated.`;
    await query(
      `UPDATE sync_logs
          SET status='success', message=$2, fixtures_processed=$3, finished_at=NOW()
        WHERE id=$1`,
      [logId, message, processed]
    );
    console.log('[sync]', message);
    return { ok: true, fixtures: fixtures.length, completed, processed, message, logId };
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

module.exports = { runSync, lastSync, fetchFixtures, normaliseFixture, deriveWinner };
