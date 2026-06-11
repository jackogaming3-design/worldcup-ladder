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

  // API-Football
  apiKey: process.env.API_FOOTBALL_KEY || '',
  apiBaseUrl: (process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io').replace(/\/+$/, ''),
  apiKeyHeader: (process.env.API_FOOTBALL_KEY_HEADER || 'x-apisports-key').toLowerCase(),
  leagueId: process.env.WORLD_CUP_LEAGUE_ID || '1',
  season: process.env.WORLD_CUP_SEASON || '2026',

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
