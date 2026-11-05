import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/users.js';

/* Users may delete any default category except "Unsorted", but the built-in
   classifier still files expenses, vouchers, events and so on under the
   default ids. Those cards must land in "Unsorted", not in a category that
   no longer exists. */

const H = { 'x-requested-with': 'pockeep' };
let app, dir, cookie;
const call = (method, url, payload, extra = {}) => app.inject({ method, url, payload, headers: { ...H, cookie, ...extra } });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pk-delcat-'));
  app = await buildApp(loadConfig({
    dataDir: dir, dbFile: join(dir, 'test.db'), exportsDir: join(dir, 'exports'),
    webDist: join(dir, 'none'), seed: false
  }), { logger: false });
  createUser(app.db, { username: 'dana', password: 'dana-password' }); // fictional test account
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'dana', password: 'dana-password' } });
  cookie = `pockeep_session=${r.cookies.find(c => c.name === 'pockeep_session').value}`;
  const state = (await call('GET', '/api/state')).json();
  const put = await call('PUT', '/api/categories', { categories: state.categories.filter(c => c.id !== 'expenses') });
  assert.equal(put.statusCode, 200, put.body);
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

test('an import never files cards under a deleted category', async () => {
  const text = '[17/10/2026, 2:30:00] Dana: 50 ש"ח פיצה\n';
  const p = await call('POST', '/api/imports/preview', text, { 'content-type': 'text/plain' });
  assert.equal(p.statusCode, 200, p.body);
  const c = await call('POST', `/api/imports/${p.json().token}/commit`, {});
  assert.equal(c.statusCode, 200, c.body);
  const body = c.json();
  assert.deepEqual(body.items.map(i => i.category), ['inbox']);
  assert.equal(body.items[0].type, 'expense'); // the typed fields are kept
  assert.deepEqual(body.counts.byCategory, { inbox: 1 });
});

test('applying rules works when the classifier names a deleted category', async () => {
  const created = await call('POST', '/api/items', { body: '30 ש"ח קפה' });
  assert.equal(created.statusCode, 200, created.body);
  const dry = await call('POST', '/api/rules/apply', { dryRun: true });
  assert.equal(dry.statusCode, 200, dry.body);
  const run = await call('POST', '/api/rules/apply', {});
  assert.equal(run.statusCode, 200, run.body);
  assert.ok(run.json().items.every(i => i.category !== 'expenses'));
});
