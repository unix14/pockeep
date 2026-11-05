import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/users.js';

/* A .zip upload is limited in compressed size by MAX_IMPORT_MB, but it used to
   be decompressed without any limit, so a few hundred KB could expand to
   gigabytes in server memory. */

const H = { 'x-requested-with': 'pockeep' };
let app, dir, cookie;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pk-zip-'));
  app = await buildApp(loadConfig({
    dataDir: dir, dbFile: join(dir, 'test.db'), exportsDir: join(dir, 'exports'),
    webDist: join(dir, 'none'), seed: false, maxImportMb: 1
  }), { logger: false });
  createUser(app.db, { username: 'zed', password: 'zed-password' }); // fictional test account
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'zed', password: 'zed-password' } });
  cookie = `pockeep_session=${r.cookies.find(c => c.name === 'pockeep_session').value}`;
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

const preview = buf => app.inject({
  method: 'POST', url: '/api/imports/preview', payload: buf,
  headers: { ...H, cookie, 'content-type': 'application/zip', 'x-file-name': 'chat.zip' }
});

test('a highly compressed zip that expands past the limit is refused before decompression', async () => {
  const zip = new AdmZip();
  zip.addFile('chat.txt', Buffer.alloc(12 * 1024 * 1024, 'a')); // ~12 MB that compresses to a few KB
  const buf = zip.toBuffer();
  assert.ok(buf.length < 1024 * 1024, 'the upload itself is under MAX_IMPORT_MB');
  const r = await preview(buf);
  assert.equal(r.statusCode, 413, r.body);
});

test('a normal zip export with media still previews', async () => {
  const zip = new AdmZip();
  zip.addFile('WhatsApp Chat.txt', Buffer.from('[17/10/2026, 2:30:00] Zed: IMG-0001.jpg (file attached)\nnice view\n'));
  zip.addFile('IMG-0001.jpg', Buffer.alloc(2048, 7));
  zip.addFile('empty.bin', Buffer.alloc(0));
  const r = await preview(zip.toBuffer());
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().counts.newItems, 1);
  assert.deepEqual(r.json().attachments, { total: 1, matched: 1 });
});
