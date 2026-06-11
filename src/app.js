'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy → correct secure-cookie handling

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Order matters: mount the more specific admin router first.
  app.use('/api/admin', adminRoutes);
  app.use('/api', publicRoutes);

  // Static frontend ("/admin" resolves to admin.html via the html extension).
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // Fallback: any non-API GET serves the home page.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // JSON error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'internal error', detail: String(err && err.message ? err.message : err) });
  });

  return app;
}

module.exports = { createApp };
