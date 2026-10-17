import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/users.js';

/* Rules only ran during import, so a rule written today did nothing for cards
   already on the board. POST /api/rules/apply re-runs them over existing cards,
   but only over ones the user has not filed themselves. */

const H = { 'x-requested-with': 'pockeep' };
let app, dir, auth;

const EXPORT = [
  '[05/01/2026, 09:00:00] You: standup notes for the aliexpress order',
  '[05/01/2026, 09:01:00] You: a second aliexpress message',
  '[05/01/2026, 09:02:00] You: something entirely unrelated'
].join('\n') + '\n';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pk-rules-'));
  app = await buildApp(loadConfig({
    dataDir: dir, dbFile: join(dir, 'test.db'), exportsDir: join(dir, 'exports'),
    webDist: join(dir, 'none'), seed: false
  }), { logger: false });
  createUser(app.db, { username: 'rena', password: 'rena-password' }); // fictional test account
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'rena', password: 'rena-password' } });
  auth = { cookie: `pockeep_session=${r.cookies.find(c => c.name === 'pockeep_session').value}` };
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (method, url, payload, extra = {}) =>
  app.inject({ method, url, payload, headers: { ...H, cookie: auth.cookie, ...extra } });

async function seedCards() {
  const p = await app.inject({
    method: 'POST', url: '/api/imports/preview', payload: EXPORT,
    headers: { ...H, cookie: auth.cookie, 'content-type': 'text/plain', 'x-file-name': 'c.txt' }
  });
  assert.equal(p.statusCode, 200, p.body);
  const c = await call('POST', `/api/imports/${p.json().token}/commit`, {});
  assert.equal(c.statusCode, 200, c.body);
  return c.json().items;
}
const state = async () => (await call('GET', '/api/state')).json();
const addRule = (pattern, category) => call('POST', '/api/rules', { match: 'contains', pattern, category, labels: [] });
const byBody = (items, text) => items.find(i => (i.body || '').includes(text));

test('a rule written after the import moves an unsorted card', async () => {
  await seedCards();
  const before = byBody((await state()).items, 'standup notes');
  assert.equal(before.category, 'inbox', 'card should start unsorted');

  await addRule('aliexpress', 'orders');
  const r = await call('POST', '/api/rules/apply', {});
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().changed, 2, 'both aliexpress cards should move');

  const after = byBody((await state()).items, 'standup notes');
  assert.equal(after.category, 'orders');
});

test('a dry run reports the same count but writes nothing', async () => {
  const before = (await state()).items;
  const unrelated = byBody(before, 'entirely unrelated');
  assert.equal(unrelated.category, 'inbox');

  await addRule('unrelated', 'notes');
  const dry = await call('POST', '/api/rules/apply', { dryRun: true });
  assert.equal(dry.statusCode, 200, dry.body);
  assert.equal(dry.json().changed, 1);

  const still = byBody((await state()).items, 'entirely unrelated');
  assert.equal(still.category, 'inbox', 'dry run must not write');
});

test('a card filed by hand is never re-sorted', async () => {
  const card = byBody((await state()).items, 'entirely unrelated');
  // the user files it themselves, which clears the auto flag
  await call('PATCH', `/api/items/${card.id}`, { patch: { category: 'dev' } });

  const r = await call('POST', '/api/rules/apply', {});
  assert.equal(r.statusCode, 200, r.body);

  const after = byBody((await state()).items, 'entirely unrelated');
  assert.equal(after.category, 'dev', 'rule targets notes, but the user chose dev');
  assert.ok(r.json().skipped.manual >= 1);
});

test('a locked card is never re-sorted', async () => {
  const card = byBody((await state()).items, 'a second aliexpress');
  await call('PATCH', `/api/items/${card.id}`, { patch: { category: 'inbox', locked: true } });

  const r = await call('POST', '/api/rules/apply', {});
  assert.equal(r.statusCode, 200, r.body);

  const after = byBody((await state()).items, 'a second aliexpress');
  assert.equal(after.category, 'inbox', 'locked card must stay put');
  assert.ok(r.json().skipped.locked >= 1);
});

test('applying with nothing to change reports zero', async () => {
  const r = await call('POST', '/api/rules/apply', {});
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().changed, 0);
});

test('another user\'s cards are never touched', async () => {
  createUser(app.db, { username: 'shai', password: 'shai-password1' }); // fictional test account
  const l = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'shai', password: 'shai-password1' } });
  const other = { cookie: `pockeep_session=${l.cookies.find(c => c.name === 'pockeep_session').value}` };
  const r = await app.inject({ method: 'POST', url: '/api/rules/apply', payload: {}, headers: { ...H, cookie: other.cookie } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().eligible, 0, 'shai has no cards of their own');
});
