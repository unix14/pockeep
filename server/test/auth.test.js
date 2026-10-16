import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

const H = { 'x-requested-with': 'pockeep' };
let app, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sm-auth-'));
  app = await buildApp(loadConfig({ dataDir: dir, dbFile: join(dir, 't.db'), exportsDir: join(dir, 'ex'), webDist: join(dir, 'none'),
    adminUsername: 'admin', adminPassword: 'admin-secret-1', seedUser: 'demo', seedUserPassword: 'temp-pass', allowRegistration: false }), { logger: false });
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

const login = async (username, password) => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username, password } });
  const c = r.cookies.find(c => c.name === 'pockeep_session');
  return { res: r, cookie: c ? `pockeep_session=${c.value}` : '' };
};
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });

test('seeds exactly the admin and the second user; the user must change password', async () => {
  const users = app.db.prepare('SELECT username, role, must_change_password FROM users ORDER BY id').all();
  assert.deepEqual(users.map(u => [u.username, u.role, u.must_change_password]), [['admin', 'admin', 0], ['demo', 'user', 1]]);
  const s = await login('demo', 'temp-pass');
  assert.equal(s.res.statusCode, 200);
  assert.equal(s.res.json().user.mustChangePassword, true);
  // blocked from data until the password is changed
  const blocked = await call(s.cookie, 'GET', '/api/state');
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().code, 'password_change_required');
  assert.equal((await call(s.cookie, 'POST', '/api/auth/password', { current: 'temp-pass', next: 'short' })).statusCode, 400);
  assert.equal((await call(s.cookie, 'POST', '/api/auth/password', { current: 'temp-pass', next: 'temp-pass' })).statusCode, 400);
  const ch = await call(s.cookie, 'POST', '/api/auth/password', { current: 'temp-pass', next: 'demo-new-pass' });
  assert.equal(ch.statusCode, 200, ch.body);
  const newCookie = `pockeep_session=${ch.cookies.find(c => c.name === 'pockeep_session').value}`;
  assert.equal((await call(s.cookie, 'GET', '/api/state')).statusCode, 401, 'old session is revoked');
  assert.equal((await call(newCookie, 'GET', '/api/state')).statusCode, 200);
  assert.equal((await login('demo', 'temp-pass')).res.statusCode, 401);
});

test('registration is closed by default', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { username: 'eve', password: 'eve-password' } });
  assert.equal(r.statusCode, 403);
});

test('admin manages users; normal users cannot', async () => {
  const a = await login('admin', 'admin-secret-1');
  const s = await login('demo', 'demo-new-pass');
  assert.equal((await call(s.cookie, 'GET', '/api/admin/users')).statusCode, 403);
  assert.equal((await call(s.cookie, 'POST', '/api/admin/users', { username: 'x1', password: 'xxxxxxxx' })).statusCode, 403);

  const list = (await call(a.cookie, 'GET', '/api/admin/users')).json().users;
  assert.equal(list.length, 2);
  const created = await call(a.cookie, 'POST', '/api/admin/users', { username: 'guest', password: 'temp12', role: 'user' });
  assert.equal(created.statusCode, 200, created.body);
  const g = created.json().user;
  assert.equal(g.mustChangePassword, true);
  assert.equal((await call(a.cookie, 'POST', '/api/admin/users', { username: 'guest', password: 'temp12' })).statusCode, 409);

  // reset password -> temporary again, sessions revoked
  const gl = await login('guest', 'temp12');
  await call(gl.cookie, 'POST', '/api/auth/password', { current: 'temp12', next: 'guest-password' });
  const reset = await call(a.cookie, 'PATCH', `/api/admin/users/${g.id}`, { password: 'reset99' });
  assert.equal(reset.json().user.mustChangePassword, true);
  assert.equal((await login('guest', 'reset99')).res.json().user.mustChangePassword, true);

  // safety rails
  const me = list.find(u => u.username === 'admin');
  assert.equal((await call(a.cookie, 'DELETE', `/api/admin/users/${me.id}`)).statusCode, 409);
  assert.equal((await call(a.cookie, 'PATCH', `/api/admin/users/${me.id}`, { role: 'user' })).statusCode, 409);
  assert.equal((await call(a.cookie, 'DELETE', `/api/admin/users/${g.id}`)).statusCode, 200);
  assert.equal((await login('guest', 'reset99')).res.statusCode, 401);
});

test('language preference and English error messages', async () => {
  const s = await login('demo', 'demo-new-pass');
  const r = await call(s.cookie, 'PATCH', '/api/settings', { prefs: { lang: 'en', theme: 'dark' } });
  assert.deepEqual(r.json().prefs, { lang: 'en', theme: 'dark' });
  assert.equal((await call(s.cookie, 'PATCH', '/api/settings', { prefs: { lang: 'xx' } })).json().prefs.lang, 'en');
  const he = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'demo', password: 'wrong-pass' } });
  assert.match(he.json().error, /[֐-׿]/);
  const en = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...H, 'x-pockeep-lang': 'en' }, payload: { username: 'demo', password: 'wrong-pass' } });
  assert.equal(en.json().error, 'Wrong username or password');
});
