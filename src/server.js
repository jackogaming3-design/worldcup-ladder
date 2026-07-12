'use strict';

const { createApp } = require('./app');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const { config } = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bring the schema + seed up to date, retrying with backoff. Runs in the
// BACKGROUND after the server is already listening, so a transient database
// hiccup on cold start can't crash-loop the whole service — /healthz keeps
// passing, the platform keeps the instance alive, and it self-heals the moment
// the DB is reachable again. (Both migrate + seed are idempotent.)
async function ensureSchema() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await migrate();
      await seed();
      console.log('[boot] schema + seed ready');
      return;
    } catch (err) {
      const wait = Math.min(30000, 3000 * attempt);
      console.error(`[boot] migrate/seed attempt ${attempt} failed: ${err.message} — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

function main() {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] 2026 World Cup Live Ladder listening on :${config.port} (${config.nodeEnv})`);
    if (!config.adminPassword) console.warn('[server] ADMIN_PASSWORD not set — admin login is disabled.');
    console.log('[server] Result source: ESPN free public feed (no API key required).');
  });
  ensureSchema(); // prepare the DB in the background; server is already healthy
}

main();
