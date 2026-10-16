import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import { createUser, sessionUser, pruneSessions, randomPassword } from './users.js';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
import importRoutes from './routes/imports.js';
import adminRoutes from './routes/admin.js';
import { translate, requestLang } from './i18n.js';

import { SESSION_COOKIE, CSRF_HEADER, CSRF_VALUE } from './constants.js';
export { SESSION_COOKIE, CSRF_HEADER, CSRF_VALUE };

export async function buildApp(config, { logger } = {}) {
  const db = config.db || openDb(config.dbFile);
  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024
  });
  app.decorate('db', db);
  app.decorate('config', config);

  await app.register(cookie);

  // First start: seed the admin account and the second user. Both must change
  // their password at first sign-in unless ADMIN_PASSWORD was given explicitly.
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (!userCount && config.seed !== false) {
    const generated = !config.adminPassword;
    const adminPassword = config.adminPassword || randomPassword();
    createUser(db, { username: config.adminUsername, password: adminPassword, role: 'admin', mustChangePassword: generated, seed: true });
    if (generated) {
      app.log.warn(`Created admin account "${config.adminUsername}" with a one-time password: ${adminPassword}  (you will be asked to change it at first sign-in)`);
    } else {
      app.log.info(`Created admin account "${config.adminUsername}" from ADMIN_PASSWORD`);
    }
    if (config.seedUser) {
      const userPassword = config.seedUserPassword || randomPassword();
      createUser(db, { username: config.seedUser, password: userPassword, role: 'user', mustChangePassword: true, seed: true });
      app.log.warn(config.seedUserPassword
        ? `Created user "${config.seedUser}" with the temporary password from SEED_USER_PASSWORD (must be changed at first sign-in)`
        : `Created user "${config.seedUser}" with a one-time password: ${userPassword}  (must be changed at first sign-in)`);
    }
  }
  pruneSessions(db);
  const pruneTimer = setInterval(() => pruneSessions(db), 6 * 3600 * 1000);
  pruneTimer.unref();
  app.addHook('onClose', async () => { clearInterval(pruneTimer); if (!config.db) db.close(); });

  // Security headers on every response.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // CSRF: state-changing API calls must carry a custom header, which a cross-site
  // form or image tag cannot send. Combined with SameSite=Lax cookies.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      reply.code(403).send({ error: translate('הבקשה נחסמה (חסרה כותרת אבטחה)', requestLang(req)), code: 'csrf' });
    }
  });

  // Authentication: every /api route is private unless it opts out with config.public.
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const token = req.cookies[SESSION_COOKIE];
    req.user = sessionUser(db, token, config.sessionDays);
    const cfg = req.routeOptions.config || {};
    if (!req.user && !cfg.public) {
      return reply.code(401).send({ error: translate('יש להתחבר מחדש', requestLang(req)), code: 'unauthenticated' });
    }
    // Until a forced password change is done, only the change-password flow is reachable.
    if (req.user?.mustChangePassword && !cfg.public && !cfg.duringPasswordChange) {
      return reply.code(403).send({ error: translate('יש להחליף את הסיסמה לפני שממשיכים', requestLang(req)), code: 'password_change_required' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const message = status >= 500 ? 'משהו השתבש בשרת. כדאי לבדוק את הלוגים של הקונטיינר.' :
      err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'הקובץ גדול מדי עבור השרת. אפשר להגדיל את MAX_IMPORT_MB או MAX_BACKUP_MB.' :
      err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'סוג הקובץ לא נתמך' :
      err.validation ? 'הבקשה לא תקינה' : err.message;
    reply.code(status).send({ error: translate(message, requestLang(req)), code: err.code || 'error' });
  });

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(dataRoutes, { prefix: '/api' });
  await app.register(importRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  // Serve the built web app, with SPA fallback to index.html.
  const hasWeb = existsSync(join(config.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fstatic, { root: config.webDist, prefix: '/', wildcard: true, index: ['index.html'],
      // @fastify/static v10 hands setHeaders the Fastify reply, not the raw response.
      setHeaders(reply, path) { reply.header('Cache-Control', /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'); } });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !hasWeb) {
      return reply.code(404).send({ error: translate('לא נמצא', requestLang(req)), code: 'not_found' });
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  return app;
}
