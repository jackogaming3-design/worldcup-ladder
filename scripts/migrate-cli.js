'use strict';

// Run schema migration + seed manually: `npm run migrate`.

const { migrate } = require('../src/migrate');
const { seed } = require('../src/seed');
const { pool } = require('../src/db');

(async () => {
  try {
    await migrate();
    await seed();
    console.log('[migrate-cli] done');
    await pool.end();
  } catch (err) {
    console.error('[migrate-cli] failed:', err);
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
})();
