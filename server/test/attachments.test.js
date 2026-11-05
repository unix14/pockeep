import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/users.js';
import { forUser } from '../src/repo.js';

/* Attachment files are served by item id and file name taken from the URL.
   Neither may be used to reach another account's files. */

const H = { 'x-requested-with': 'pockeep' };
let app, dir, alice, bob, bobItem;

async function login(username, password) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username, password } });
  assert.equal(r.statusCode, 200, r.body);
  return `pockeep_session=${r.cookies.find(c => c.name === 'pockeep_session').value}`;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pk-att-'));
  app = await buildApp(loadConfig({
    dataDir: dir, dbFile: join(dir, 'test.db'), exportsDir: join(dir, 'exports'),
    attachmentsDir: join(dir, 'attachments'), webDist: join(dir, 'none'), seed: false
  }), { logger: false });
  alice = createUser(app.db, { username: 'alice', password: 'alice-password' }); // fictional test accounts
  bob = createUser(app.db, { username: 'bob', password: 'bob-password1' });
  const repo = forUser(app.db, bob.id);
  bobItem = repo.createItem({ body: 'receipt' });
  repo.addAttachments(bobItem.id, [{ name: 'secret.txt', type: 'text/plain', size: 10 }]);
  mkdirSync(join(dir, 'attachments', String(bob.id), bobItem.id), { recursive: true });
  writeFileSync(join(dir, 'attachments', String(bob.id), bobItem.id, 'secret.txt'), 'BOB SECRET');
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

test('the owner can download an attachment of their own card', async () => {
  const cookie = await login('bob', 'bob-password1');
  const r = await app.inject({ method: 'GET', url: `/api/attachments/${bobItem.id}/secret.txt`, headers: { cookie } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, 'BOB SECRET');
});

test("an encoded ../ in the item id cannot reach another user's files", async () => {
  const cookie = await login('alice', 'alice-password');
  for (const id of [`..%2F${bob.id}%2F${bobItem.id}`, `%2E%2E%2F${bob.id}%2F${bobItem.id}`, bobItem.id]) {
    const r = await app.inject({ method: 'GET', url: `/api/attachments/${id}/secret.txt`, headers: { cookie } });
    assert.equal(r.statusCode, 404, `${id} -> ${r.statusCode} ${r.body}`);
    assert.ok(!r.body.includes('BOB SECRET'));
  }
});

test('a malformed file name is a 404, not a server error', async () => {
  const cookie = await login('alice', 'alice-password');
  const r = await app.inject({ method: 'GET', url: '/api/attachments/x/%25', headers: { cookie } });
  assert.equal(r.statusCode, 404);
});
