'use strict';

const { withTransaction } = require('./db');

// The completed snake draft. Used ONLY to seed an empty database.
// Re-seeding is non-destructive: existing players/teams are never overwritten,
// so a commissioner's later reassignments survive every redeploy.
const SEED = [
  { player: 'Jacko', teams: ['France', 'Germany'] },
  { player: 'Cabs', teams: ['Spain', 'Norway'] },
  { player: 'Bailey', teams: ['England', 'Argentina'] },
  { player: 'Bobby', teams: ['Portugal', 'Brazil'] },
];

// One-time, idempotent player-name corrections applied on boot. A real rename,
// so the player's id, team links and points are preserved. Becomes a harmless
// no-op once applied (the old name no longer exists).
const RENAMES = [
  ['Bayley', 'Bailey'],
  ['CAVS', 'Cabs'],
];

async function seed() {
  await withTransaction(async (client) => {
    // Apply pending name corrections first, so seeding doesn't recreate the
    // old names as duplicates. The NOT EXISTS guard keeps it safe + idempotent.
    for (const [oldName, newName] of RENAMES) {
      await client.query(
        `UPDATE players SET name = $2
          WHERE name = $1 AND NOT EXISTS (SELECT 1 FROM players WHERE name = $2)`,
        [oldName, newName]
      );
    }

    // One-time backfill: assist tracking was added after some fixtures had
    // already been scraped for goals. Clear the scraped marker once so the next
    // sync re-reads those summaries and captures assists too.
    const done = await client.query(`SELECT 1 FROM meta WHERE key = 'assists_backfill_v1'`);
    if (!done.rows.length) {
      await client.query(`DELETE FROM scraped_fixtures`);
      await client.query(
        `INSERT INTO meta (key, value) VALUES ('assists_backfill_v1', 'done')
         ON CONFLICT (key) DO NOTHING`
      );
    }
    // Same again for cards (added after assists): re-read scraped fixtures once.
    const doneCards = await client.query(`SELECT 1 FROM meta WHERE key = 'cards_backfill_v1'`);
    if (!doneCards.rows.length) {
      await client.query(`DELETE FROM scraped_fixtures`);
      await client.query(
        `INSERT INTO meta (key, value) VALUES ('cards_backfill_v1', 'done')
         ON CONFLICT (key) DO NOTHING`
      );
    }
    // One-off: clear all scrape markers once to re-read every match for late
    // ESPN goal/assist updates that the old once-only scrape had missed.
    const doneRescrape = await client.query(`SELECT 1 FROM meta WHERE key = 'rescrape_all_v1'`);
    if (!doneRescrape.rows.length) {
      await client.query(`DELETE FROM scraped_fixtures`);
      await client.query(
        `INSERT INTO meta (key, value) VALUES ('rescrape_all_v1', 'done')
         ON CONFLICT (key) DO NOTHING`
      );
    }

    for (const { player, teams } of SEED) {
      const res = await client.query(
        `INSERT INTO players (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [player]
      );
      const playerId = res.rows[0].id;

      for (const team of teams) {
        // If the team already exists we leave its owner untouched (the admin
        // may have reassigned it) — seeding must never clobber assignments.
        await client.query(
          `INSERT INTO teams (name, player_id) VALUES ($1, $2)
           ON CONFLICT (name) DO NOTHING`,
          [team, playerId]
        );
      }
    }
  });
  console.log('[seed] players & teams ensured (non-destructive)');
}

module.exports = { seed, SEED };
