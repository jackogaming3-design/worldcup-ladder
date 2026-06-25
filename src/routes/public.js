'use strict';

const express = require('express');
const { query } = require('../db');
const { computeLadder } = require('../ladder');
const { lastSync, runSync } = require('../sync');

const router = express.Router();

// Self-healing auto-sync: when the ladder is viewed and the last sync is stale,
// kick one off in the background (no external cron or secret needed). Debounced
// so concurrent visitors don't pile up. Returns true if one was started.
let autoSyncing = false;
function maybeAutoSync(sync) {
  if (autoSyncing) return false;
  const finishedAt = sync && sync.finished_at ? new Date(sync.finished_at).getTime() : 0;
  if (finishedAt && Date.now() - finishedAt < 20 * 60 * 1000) return false; // fresh enough
  autoSyncing = true;
  runSync({ trigger: 'auto-visit' })
    .catch(() => {})
    .finally(() => { autoSyncing = false; });
  return true;
}

// GET /api/ladder — everything the home page needs in one call.
router.get('/ladder', async (req, res, next) => {
  try {
    const [ladder, sync, lu] = await Promise.all([
      computeLadder(),
      lastSync(),
      query(`SELECT MAX(updated_at) AS m FROM matches WHERE status IN ('FT','AET','PEN','AWD','WO')`),
    ]);

    const lastUpdated = (lu.rows[0] && lu.rows[0].m) || (sync && sync.finished_at) || null;
    const syncing = maybeAutoSync(sync);

    res.json({
      lastUpdated,
      lastSync: sync,
      syncing,
      scoring: { win: 3, draw: 1, loss: 0, penaltyRule: 'shootout-winner-wins' },
      source: 'ESPN (free public feed)',
      apiConfigured: true,
      playerLadder: ladder.playerLadder,
      teamLadder: ladder.teamLadder,
      recentMatches: ladder.recentMatches,
      whatCouldHaveBeen: ladder.whatCouldHaveBeen,
      upcomingHighlight: ladder.upcomingHighlight,
      playerNextMatches: ladder.playerNextMatches,
      goldenBoot: ladder.goldenBoot,
      playmaker: ladder.playmaker,
      badBoy: ladder.badBoy,
      droppedHead: ladder.droppedHead,
      socceroos: ladder.socceroos,
      boxSeat: ladder.boxSeat,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/refresh — public "Sync Now" button. Forces a sync (bypassing the
// staleness check), guarded by the shared lock + a short cooldown so it can't be
// spammed. Fires in the background and returns immediately.
router.post('/refresh', async (req, res, next) => {
  try {
    if (autoSyncing) {
      return res.json({ ok: true, started: false, message: 'A sync is already running — hang tight.' });
    }
    const recent = await lastSync();
    const finishedAt = recent && recent.finished_at ? new Date(recent.finished_at).getTime() : 0;
    if (finishedAt && Date.now() - finishedAt < 20 * 1000) {
      return res.json({ ok: true, started: false, message: 'Already up to date — synced seconds ago.' });
    }
    autoSyncing = true;
    runSync({ trigger: 'manual' }).catch(() => {}).finally(() => { autoSyncing = false; });
    res.json({ ok: true, started: true, message: 'Syncing the latest results…' });
  } catch (err) {
    next(err);
  }
});

// GET /api/players — all players with their teams.
router.get('/players', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT p.name AS player,
              COALESCE(
                array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL),
                '{}'
              ) AS teams
         FROM players p
         LEFT JOIN teams t ON t.player_id = p.id
        GROUP BY p.name
        ORDER BY p.name`
    );
    res.json({ players: r.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/matches — completed matches involving a drafted team.
router.get('/matches', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id, api_fixture_id, home_team, away_team, home_goals, away_goals,
              home_pen, away_pen, winner_team, status, round, match_date, updated_at
         FROM matches
        WHERE status IN ('FT','AET','PEN','AWD','WO')
          AND ( lower(home_team) IN (SELECT lower(name) FROM teams WHERE player_id IS NOT NULL)
             OR lower(away_team) IN (SELECT lower(name) FROM teams WHERE player_id IS NOT NULL) )
        ORDER BY match_date DESC NULLS LAST`
    );
    res.json({ matches: r.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
