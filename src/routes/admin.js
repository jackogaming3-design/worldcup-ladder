'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAdmin, isAdminRequest, issueCookie, clearCookie, checkPassword } = require('../auth');
const { runSync, lastSync } = require('../sync');
const { config } = require('../config');

const router = express.Router();

// --- Public auth endpoints (no admin session required) ---

// POST /api/admin/login { password }
router.post('/login', (req, res) => {
  if (!config.adminPassword) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured on the server.' });
  }
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid password.' });
  }
  issueCookie(res);
  res.json({ ok: true });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

// GET /api/admin/me — lets the frontend show/hide commissioner controls.
router.get('/me', (req, res) => {
  res.json({ admin: isAdminRequest(req) });
});

// --- Everything below requires admin (cookie or Bearer CRON_SECRET) ---
router.use(requireAdmin);

// GET /api/admin/status
router.get('/status', async (req, res, next) => {
  try {
    res.json({ lastSync: await lastSync(), source: 'ESPN (free public feed)' });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/sync-results — manual button OR scheduled cron.
router.post('/sync-results', async (req, res, next) => {
  try {
    const isBearer = (req.get('authorization') || '').startsWith('Bearer ');
    const result = await runSync({ trigger: isBearer ? 'cron' : 'manual' });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/assign-teams { assignments: [{ player, teams: [a, b] }] }
// Reassigns team ownership. NEVER touches the matches table.
router.post('/assign-teams', async (req, res, next) => {
  try {
    const { assignments } = req.body || {};
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'assignments must be a non-empty array of { player, teams: [..] }.' });
    }

    // Validate shape + no team claimed by two players in this payload.
    const claimed = new Set();
    for (const a of assignments) {
      if (!a || typeof a.player !== 'string' || !a.player.trim() || !Array.isArray(a.teams)) {
        return res.status(400).json({ error: 'Each assignment needs { player, teams: [..] }.' });
      }
      for (const t of a.teams) {
        const key = String(t).trim().toLowerCase();
        if (!key) return res.status(400).json({ error: 'Team names cannot be empty.' });
        if (claimed.has(key)) return res.status(400).json({ error: `Team "${t}" is assigned to two players.` });
        claimed.add(key);
      }
    }

    await withTransaction(async (client) => {
      // Ensure players exist; map name -> id.
      const playerIds = new Map();
      for (const a of assignments) {
        const r = await client.query(
          `INSERT INTO players (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [a.player.trim()]
        );
        playerIds.set(a.player, r.rows[0].id);
      }

      // Un-own any currently owned team not present in the new payload
      // (keeps its match history, just drops it off the ladder).
      const keep = [...claimed];
      await client.query(
        `UPDATE teams SET player_id = NULL
          WHERE player_id IS NOT NULL AND lower(name) <> ALL($1::text[])`,
        [keep]
      );

      // Upsert each team with its new owner.
      for (const a of assignments) {
        for (const t of a.teams) {
          await client.query(
            `INSERT INTO teams (name, player_id) VALUES ($1, $2)
             ON CONFLICT (name) DO UPDATE SET player_id = EXCLUDED.player_id`,
            [String(t).trim(), playerIds.get(a.player)]
          );
        }
      }
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/reset-results — clears match results ONLY. Picks are safe.
router.post('/reset-results', async (req, res, next) => {
  try {
    const r = await query(`DELETE FROM matches`);
    await query(
      `INSERT INTO sync_logs (status, trigger, message, finished_at)
       VALUES ('success', 'reset', 'Match results cleared by admin.', NOW())`
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
