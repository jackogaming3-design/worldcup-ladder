'use strict';

const { createApp } = require('./app');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const { config } = require('./config');

async function main() {
  // Ensure schema + seed on every boot. Both are idempotent and non-destructive.
  try {
    await migrate();
    await seed();
  } catch (err) {
    console.error('[boot] migrate/seed failed:', err.message);
    process.exit(1); // let the platform restart & retry
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] 2026 World Cup Live Ladder listening on :${config.port} (${config.nodeEnv})`);
    if (!config.adminPassword) console.warn('[server] ADMIN_PASSWORD not set — admin login is disabled.');
    console.log('[server] Result source: ESPN free public feed (no API key required).');
  });
}

main();
