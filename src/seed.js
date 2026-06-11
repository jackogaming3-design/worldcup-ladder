'use strict';

const { withTransaction } = require('./db');

// The completed snake draft. Used ONLY to seed an empty database.
// Re-seeding is non-destructive: existing players/teams are never overwritten,
// so a commissioner's later reassignments survive every redeploy.
const SEED = [
  { player: 'Jacko', teams: ['France', 'Germany'] },
  { player: 'CAVS', teams: ['Spain', 'Norway'] },
  { player: 'Bayley', teams: ['England', 'Argentina'] },
  { player: 'Bobby', teams: ['Portugal', 'Brazil'] },
];

async function seed() {
  await withTransaction(async (client) => {
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
