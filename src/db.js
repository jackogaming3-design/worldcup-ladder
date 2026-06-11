'use strict';

const { Pool } = require('pg');
const { config } = require('./config');

// Decide SSL: on for remote hosts (Render/Supabase), off for localhost.
// Override with PGSSL=true|false.
function sslConfig() {
  const flag = (process.env.PGSSL || '').toLowerCase();
  if (flag === 'false') return false;
  if (flag === 'true') return { rejectUnauthorized: false };

  const url = config.databaseUrl;
  if (!url || url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

if (!config.databaseUrl) {
  console.warn('[db] DATABASE_URL is not set — database operations will fail until it is configured.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslConfig(),
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected idle client error:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
