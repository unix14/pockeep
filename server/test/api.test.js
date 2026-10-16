import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/users.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXPORT = readFileSync(process.env.SM_TEST_EXPORT || join(here, 'fixtures/sample.md'), 'utf8');
const H = { 'x-requested-with': 'pockeep' };
let app, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sm-test-'));
  app = await buildApp(loadConfig({ dataDir: dir, dbFile: join(dir, 'test.db'), exportsDir: join(dir, 'exports'), webDist: join(dir, 'none'), seed: false }), { logger: false });
  createUser(app.db, { username: 'alice', password: 'alice-password' }); // fictional test accounts
  createUser(app.db, { username: 'bob', password: 'bob-password1' });
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

async function login(username, password) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username, password } });
  assert.equal(r.statusCode, 200, r.body);
  const c = r.cookies.find(c => c.name === 'pockeep_session');
  return { cookie: `pockeep_session=${c.value}` };
}
const call = (auth, method, url, payload, extra = {}) =>
  app.inject({ method, url, payload, headers: { ...H, cookie: auth.cookie, ...extra } });
async function importFile(auth, text = EXPORT) {
  const p = await app.inject({ method: 'POST', url: '/api/imports/preview', payload: text, headers: { ...H, cookie: auth.cookie, 'content-type': 'text/plain', 'x-file-name': 'sample.md' } });
  assert.equal(p.statusCode, 200, p.body);
  const prev = p.json();
  const c = await call(auth, 'POST', `/api/imports/${prev.token}/commit`, {});
  assert.equal(c.statusCode, 200, c.body);
  return { preview: prev, commit: c.json() };
}

test('rejects unauthenticated and cross-site requests', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/state' })).statusCode, 401);
  const a = await login('alice', 'alice-password');
  const noHeader = await app.inject({ method: 'POST', url: '/api/trash/empty', headers: { cookie: a.cookie } });
  assert.equal(noHeader.statusCode, 403);
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'alice', password: 'nope-nope' } });
  assert.equal(bad.statusCode, 401);
});

test('import preview writes nothing; commit creates cards; re-import is idempotent', async () => {
  const a = await login('alice', 'alice-password');
  const p = await app.inject({ method: 'POST', url: '/api/imports/preview', payload: EXPORT, headers: { ...H, cookie: a.cookie, 'content-type': 'text/plain' } });
  const counts = p.json().counts;
  assert.ok(counts.newItems > 0);
  assert.equal((await call(a, 'GET', '/api/state')).json().items.length, 0, 'preview must not write');
  const c = await call(a, 'POST', `/api/imports/${p.json().token}/commit`, {});
  assert.equal(c.json().counts.newItems, counts.newItems);
  const again = await importFile(a);
  assert.equal(again.preview.counts.newItems, 0);
  assert.equal(again.preview.counts.present, counts.kept);
});

test('users are fully isolated', async () => {
  const a = await login('alice', 'alice-password');
  const b = await login('bob', 'bob-password1');
  const aItems = (await call(a, 'GET', '/api/state')).json().items;
  assert.ok(aItems.length > 0);
  assert.equal((await call(b, 'GET', '/api/state')).json().items.length, 0, 'bob sees none of alice\'s cards');

  const target = aItems[0].id;
  assert.equal((await call(b, 'GET', `/api/items/${target}`)).statusCode, 404);
  assert.equal((await call(b, 'PATCH', `/api/items/${target}`, { patch: { title: 'hacked' } })).statusCode, 404);
  const batch = (await call(b, 'POST', '/api/items/batch', { ops: [{ id: target, patch: { status: 'trashed' } }] })).json();
  assert.equal(batch.items.length, 0);
  assert.equal(batch.skipped[0].reason, 'not_found');
  assert.equal((await call(b, 'POST', `/api/items/${target}/resolve`, { action: 'merge' })).statusCode, 404);
  await call(b, 'POST', '/api/trash/empty', {});
  const still = (await call(a, 'GET', `/api/items/${target}`)).json().item;
  assert.notEqual(still.title, 'hacked');

  // Bob imports the same export: identical fingerprints, separate rows.
  const bi = await importFile(b);
  assert.ok(bi.preview.counts.newItems > 0, 'bob gets his own copies of the same fingerprints');
  assert.equal(bi.commit.counts.newItems, bi.preview.counts.newItems);
  await call(b, 'PATCH', `/api/items/${target}`, { patch: { title: 'bob title', status: 'archived' } });
  assert.equal((await call(a, 'GET', `/api/items/${target}`)).json().item.title, '');
  assert.equal((await call(a, 'GET', `/api/items/${target}`)).json().item.status, 'active');

  // Rules, categories and labels are per user too.
  await call(b, 'POST', '/api/rules', { match: 'contains', pattern: 'tiktok', category: 'notes', labels: ['bob-only'] });
  const aState = (await call(a, 'GET', '/api/state')).json();
  assert.equal(aState.rules.length, 0);
  assert.ok(!aState.settings.labels.includes('bob-only'));
  const bBackup = (await call(b, 'GET', '/api/backup')).json();
  assert.equal(bBackup.username, 'bob');
  assert.equal(bBackup.items.filter(i => i.status !== 'purged').length, (await call(b, 'GET', '/api/state')).json().items.length);
});

test('lock blocks archive/trash; trash and empty trash keep the fingerprint', async () => {
  const a = await login('alice', 'alice-password');
  const items = (await call(a, 'GET', '/api/state')).json().items;
  const [x, y] = items;
  await call(a, 'PATCH', `/api/items/${x.id}`, { patch: { locked: true } });
  assert.equal((await call(a, 'PATCH', `/api/items/${x.id}`, { patch: { status: 'trashed' } })).statusCode, 409);
  const res = (await call(a, 'POST', '/api/items/batch', { ops: [{ id: x.id, patch: { status: 'archived' } }, { id: y.id, patch: { status: 'trashed' } }] })).json();
  assert.equal(res.skipped[0].reason, 'locked');
  assert.equal((await call(a, 'POST', '/api/trash/empty', {})).json().purged, 1);
  assert.equal((await call(a, 'GET', `/api/items/${y.id}`)).statusCode, 404);
  const re = await importFile(a);
  assert.equal(re.preview.counts.newItems, 0);
  assert.equal(re.preview.counts.previouslyDeleted, 1);
});

test('duplicate merge and category deletion', async () => {
  const a = await login('alice', 'alice-password');
  let items = (await call(a, 'GET', '/api/state')).json().items;
  const dup = items.find(i => i.flags.dup);
  if (dup) {
    const r = await call(a, 'POST', `/api/items/${dup.id}/resolve`, { action: 'merge' });
    assert.equal(r.statusCode, 200, r.body);
    const re = await importFile(a);
    assert.equal(re.preview.counts.newItems, 0, 'merged duplicate is recognised on re-import');
  }
  const cats = (await call(a, 'GET', '/api/state')).json().categories.filter(c => c.id !== 'watch');
  const put = (await call(a, 'PUT', '/api/categories', { categories: cats })).json();
  assert.ok(!put.items.some(i => i.category === 'watch'));
  assert.equal((await call(a, 'PUT', '/api/categories', { categories: cats.filter(c => c.id !== 'inbox') })).statusCode, 400);
});

test('backup restore round-trip', async () => {
  const a = await login('alice', 'alice-password');
  const backup = (await call(a, 'GET', '/api/backup')).json();
  const before = (await call(a, 'GET', '/api/state')).json().items.length;
  const r = await call(a, 'POST', '/api/backup/restore', { mode: 'replace', backup });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().items.length, before);
});
