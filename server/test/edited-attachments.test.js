import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/users.js';

/* When a newer export shows a message that was edited in WhatsApp, the import
   updates the existing card instead of adding a new one. Files from a .zip
   export attached to that message must end up on the existing card, where
   they can be downloaded. */

const H = { 'x-requested-with': 'pockeep' };
let app, dir, cookie;
const call = (method, url, payload, extra = {}) => app.inject({ method, url, payload, headers: { ...H, cookie, ...extra } });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pk-editatt-'));
  app = await buildApp(loadConfig({
    dataDir: dir, dbFile: join(dir, 'test.db'), exportsDir: join(dir, 'exports'),
    attachmentsDir: join(dir, 'attachments'), webDist: join(dir, 'none'), seed: false
  }), { logger: false });
  createUser(app.db, { username: 'edie', password: 'edie-password' }); // fictional test account
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'edie', password: 'edie-password' } });
  cookie = `pockeep_session=${r.cookies.find(c => c.name === 'pockeep_session').value}`;
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

async function importPayload(payload, contentType) {
  const p = await call('POST', '/api/imports/preview', payload, { 'content-type': contentType });
  assert.equal(p.statusCode, 200, p.body);
  const c = await call('POST', `/api/imports/${p.json().token}/commit`, {});
  assert.equal(c.statusCode, 200, c.body);
  return c.json();
}

test("a zip's file reaches the existing card of a message edited in WhatsApp", async () => {
  // first export: text only, original caption
  await importPayload('[17/10/2026, 2:30:00] Edie: IMG-20261017-WA0001.jpg (file attached)\nthe old caption\n', 'text/plain');
  // newer export: same message, caption edited, now with the photo
  const zip = new AdmZip();
  zip.addFile('WhatsApp Chat.txt', Buffer.from('[17/10/2026, 2:30:00] Edie: IMG-20261017-WA0001.jpg (file attached)\nthe new caption\n'));
  zip.addFile('IMG-20261017-WA0001.jpg', Buffer.from('JPEGDATA'));
  const res = await importPayload(zip.toBuffer(), 'application/zip');
  assert.equal(res.counts.edits, 1);
  assert.equal(res.items.length, 1);
  const card = res.items[0];
  assert.deepEqual(card.attachments?.map(a => a.name), ['IMG-20261017-WA0001.jpg']);
  const dl = await call('GET', `/api/attachments/${card.id}/IMG-20261017-WA0001.jpg`);
  assert.equal(dl.statusCode, 200, dl.body);
  assert.equal(dl.body, 'JPEGDATA');
});
