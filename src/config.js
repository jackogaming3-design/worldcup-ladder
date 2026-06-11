'use strict';

// Load .env if present (no-op in production where vars come from the platform).
try {
  require('dotenv').config();
} catch (_) {
  /* dotenv is optional at runtime */
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  databaseUrl: process.env.DATABASE_URL || '',

  // Data source: ESPN's free public World Cup feed (no API key required).
  espnBase: (process.env.ESPN_BASE_URL || 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world')
    .replace(/\/+$/, ''),
  season: process.env.WORLD_CUP_SEASON || '2026',
  // Optional YYYYMMDD overrides for the date window scanned each sync.
  // Defaults to 1 Jun – 1 Aug of the season year, which brackets the tournament.
  windowStart: process.env.WC_WINDOW_START || '',
  windowEnd: process.env.WC_WINDOW_END || '',

  // Security
  adminPassword: process.env.ADMIN_PASSWORD || '',
  cronSecret: process.env.CRON_SECRET || '',
  sessionSecret:
    process.env.SESSION_SECRET ||
    process.env.CRON_SECRET ||
    process.env.ADMIN_PASSWORD ||
    'dev-insecure-secret-change-me',
};

module.exports = { config };
