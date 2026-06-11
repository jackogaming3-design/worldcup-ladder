'use strict';

// Entry point for the scheduled sync (Render Cron Job or any host that can run
// `node scripts/sync-cli.js`). Talks directly to the database — no running web
// service required.

const { migrate } = require('../src/migrate');
const { seed } = require('../src/seed');
const { runSync } = require('../src/sync');
const { pool } = require('../src/db');

(async () => {
  try {
    await migrate();
    await seed();
    const result = await runSync({ trigger: 'cron' });
    console.log('[sync-cli]', JSON.stringify(result));
    await pool.end();
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error('[sync-cli] fatal:', err);
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
})();
