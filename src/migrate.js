'use strict';

const fs = require('fs');
const path = require('path');
const { query } = require('./db');

// Runs the idempotent schema. Safe to call on every boot.
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(sql);
  console.log('[migrate] schema ensured');
}

module.exports = { migrate };
