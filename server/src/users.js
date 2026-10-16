import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
import { nowIso } from './db.js';
import { seedUserDefaults } from './repo.js';
import { badRequest, conflict, notFound } from './errors.js';

const ROUNDS = 12;
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
export const MIN_PASSWORD = 8;        // passwords people choose themselves
export const MIN_TEMP_PASSWORD = 6;   // temporary passwords set by an admin (must be changed at next sign-in)
// used when a username doesn't exist, so failed logins take the same time either way
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', ROUNDS);

export const hashToken = t => createHash('sha256').update(t).digest('hex');
const userOut = u => ({ id: u.id, username: u.username, role: u.role, mustChangePassword: !!u.must_change_password, createdAt: u.created_at });

export function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME.test(username)) {
    throw badRequest('שם משתמש צריך להכיל 3–32 תווים באנגלית: אותיות, ספרות, נקודה, מקף או קו תחתון');
  }
}
export function validatePassword(password, { temporary = false } = {}) {
  const min = temporary ? MIN_TEMP_PASSWORD : MIN_PASSWORD;
  if (typeof password !== 'string' || password.length < min) throw badRequest(`הסיסמה צריכה להכיל לפחות ${min} תווים`);
  if (password.length > 200) throw badRequest('הסיסמה ארוכה מדי');
}

/* createUser: `seed` skips the length policy (used only for the initial seeded
   accounts, which are always forced to change their password). */
export function createUser(db, { username, password, role = 'user', mustChangePassword = false, seed = false }) {
  validateUsername(username);
  if (!seed) validatePassword(password, { temporary: mustChangePassword });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('שם המשתמש הזה כבר תפוס', 'username_taken');
  const info = db.prepare('INSERT INTO users (username, password_hash, role, created_at, must_change_password) VALUES (?, ?, ?, ?, ?)')
    .run(username, bcrypt.hashSync(password, ROUNDS), role === 'admin' ? 'admin' : 'user', nowIso(), mustChangePassword ? 1 : 0);
  const id = Number(info.lastInsertRowid);
  seedUserDefaults(db, id);
  return userOut(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function listUsers(db) {
  return db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id AND i.status != 'purged') AS cards
    FROM users u ORDER BY u.id`).all().map(u => ({ ...userOut(u), cards: u.cards }));
}
export function getUser(db, id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return u ? userOut(u) : null;
}
const adminCount = db => db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get().n;

export function updateUser(db, actorId, id, { role, mustChangePassword, password }) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw notFound('המשתמש לא נמצא');
  db.transaction(() => {
    if (role !== undefined) {
      if (!['admin', 'user'].includes(role)) throw badRequest('תפקיד לא מוכר');
      if (u.role === 'admin' && role !== 'admin' && adminCount(db) <= 1) throw conflict('חייב להישאר לפחות מנהל אחד במערכת', 'last_admin');
      if (id === actorId && role !== 'admin') throw conflict('אי אפשר להסיר את הרשאות הניהול מעצמך', 'self_demote');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    }
    if (password !== undefined) {
      // an admin-set password is temporary unless the admin unticks "must change"
      const temporary = mustChangePassword !== false;
      validatePassword(password, { temporary });
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(bcrypt.hashSync(password, ROUNDS), temporary ? 1 : 0, id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    } else if (mustChangePassword !== undefined) {
      db.prepare('UPDATE users SET must_change_password = ? WHERE id = ?').run(mustChangePassword ? 1 : 0, id);
    }
  })();
  return getUser(db, id);
}

export function deleteUser(db, actorId, id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw notFound('המשתמש לא נמצא');
  if (id === actorId) throw conflict('אי אפשר למחוק את החשבון שאיתו התחברת', 'self_delete');
  if (u.role === 'admin' && adminCount(db) <= 1) throw conflict('חייב להישאר לפחות מנהל אחד במערכת', 'last_admin');
  db.prepare('DELETE FROM users WHERE id = ?').run(id); // cascades to cards, rules, categories, imports, sessions
  return userOut(u);
}

// The user's own password change. Clears the "must change" flag and signs out other sessions.
export function changeOwnPassword(db, userId, current, next) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u || !bcrypt.compareSync(current || '', u.password_hash)) throw badRequest('הסיסמה הנוכחית שגויה', 'bad_credentials');
  validatePassword(next);
  if (bcrypt.compareSync(next, u.password_hash)) throw badRequest('הסיסמה החדשה צריכה להיות שונה מהנוכחית');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(next, ROUNDS), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// Used by the CLI.
export function setPassword(db, userId, password, { mustChangePassword = false } = {}) {
  validatePassword(password, { temporary: mustChangePassword });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(bcrypt.hashSync(password, ROUNDS), mustChangePassword ? 1 : 0, userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function verifyLogin(db, username, password) {
  const u = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) : null;
  const ok = await bcrypt.compare(typeof password === 'string' ? password : '', u ? u.password_hash : DUMMY_HASH);
  return ok && u ? userOut(u) : null;
}

export function createSession(db, userId, days, userAgent) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(token), userId, nowIso(), expires, (userAgent || '').slice(0, 200));
  return { token, expires };
}

export function sessionUser(db, token, days) {
  if (!token) return null;
  const h = hashToken(token);
  const row = db.prepare(`SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h);
  if (!row) return null;
  if (row.expires_at < nowIso()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  // sliding renewal once less than half the lifetime is left
  if (new Date(row.expires_at) - Date.now() < days * 864e5 / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() + days * 864e5).toISOString(), h);
  }
  return userOut(row);
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
export function pruneSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
}
export const randomPassword = () => randomBytes(12).toString('base64url');

// Small in-memory limiter for login attempts (per IP and per username).
export function makeLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  const key = k => { const now = Date.now(); const e = hits.get(k); if (!e || now - e.start > windowMs) { const n = { start: now, count: 0 }; hits.set(k, n); return n; } return e; };
  return {
    blocked: keys => keys.some(k => key(k).count >= max),
    fail: keys => keys.forEach(k => key(k).count++),
    reset: keys => keys.forEach(k => hits.delete(k))
  };
}
