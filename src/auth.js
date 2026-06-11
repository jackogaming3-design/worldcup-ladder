'use strict';

const crypto = require('crypto');
const { config } = require('./config');

const COOKIE = 'wcl_admin';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Stateless signed-cookie session: "<issuedAtMs>.<hmac>". No session store
// needed, so it survives Render restarts.
function sign(value) {
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

function verify(signed) {
  if (!signed || typeof signed !== 'string') return false;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return false;

  const value = signed.slice(0, idx);
  const expected = sign(value);
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const issued = parseInt(value, 10);
  if (!Number.isFinite(issued) || Date.now() - issued > MAX_AGE_MS) return false;
  return true;
}

function issueCookie(res) {
  res.cookie(COOKIE, sign(String(Date.now())), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// Authenticated if: valid admin cookie OR Authorization: Bearer <CRON_SECRET>.
function isAdminRequest(req) {
  const auth = req.get('authorization') || '';
  if (config.cronSecret && auth === `Bearer ${config.cronSecret}`) return true;
  return verify(req.cookies && req.cookies[COOKIE]);
}

function requireAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// Constant-time password comparison.
function checkPassword(input) {
  if (!config.adminPassword || typeof input !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(config.adminPassword);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { requireAdmin, isAdminRequest, issueCookie, clearCookie, checkPassword, COOKIE };
