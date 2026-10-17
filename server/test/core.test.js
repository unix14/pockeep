import { test } from 'node:test';
import assert from 'node:assert/strict';
import Core from '../../shared/core.js';

/* Media messages in a .zip export carry a real filename, so they must become
   cards even without a caption - otherwise the file in the zip has no card to
   attach to. Media in a text-only export ("<Media omitted>") has no file
   behind it and is still dropped. */

const line = (time, body) => `[05/01/2026, ${time}] You: ${body}\n`;
const parse = body => Core.parseExport(line('08:10:00', body));
const only = body => {
  const r = parse(body);
  assert.equal(r.items.length, 1, `expected 1 card, got ${r.items.length} (bareMedia: ${r.stats.bareMedia})`);
  return r.items[0];
};

test('keeps an uncaptioned photo and remembers its file name', () => {
  const item = only('IMG-20260105-WA0001.jpg (file attached)');
  assert.ok(item.media, 'should be marked as carrying media');
  assert.equal(item.fileName, 'IMG-20260105-WA0001.jpg');
});

test('keeps an uncaptioned voice note', () => {
  const item = only('PTT-20260105-WA0003.opus (file attached)');
  assert.ok(item.media, 'should be marked as carrying media');
  assert.equal(item.fileName, 'PTT-20260105-WA0003.opus');
});

test('keeps an uncaptioned video sent with the <attached: ...> marker', () => {
  const item = only('<attached: 00000004-VIDEO-2026-01-05.mp4>');
  assert.ok(item.media, 'should be marked as carrying media');
  assert.equal(item.fileName, '00000004-VIDEO-2026-01-05.mp4');
});

test('still drops <Media omitted>, which has no file behind it', () => {
  const r = parse('<Media omitted>');
  assert.equal(r.items.length, 0);
  assert.equal(r.stats.bareMedia, 1);
});

test('still drops the Hebrew media-omitted marker', () => {
  const r = parse('<מדיה הושמטה>');
  assert.equal(r.items.length, 0);
  assert.equal(r.stats.bareMedia, 1);
});

test('two uncaptioned photos in the same minute stay separate cards', () => {
  const r = Core.parseExport(
    line('08:10:00', 'IMG-20260105-WA0001.jpg (file attached)') +
    line('08:10:00', 'IMG-20260105-WA0002.jpg (file attached)')
  );
  assert.equal(r.items.length, 2);
  assert.notEqual(r.items[0].id, r.items[1].id, 'each photo needs its own fingerprint');
});

test('the same uncaptioned photo re-exported keeps the same fingerprint', () => {
  const first = only('IMG-20260105-WA0001.jpg (file attached)');
  const second = only('IMG-20260105-WA0001.jpg (file attached)');
  assert.equal(first.id, second.id);
});

/* Fingerprints already in people's databases must not shift, or the next
   import would re-add every existing card as a duplicate. */
test('fingerprints of existing card shapes are unchanged', () => {
  // captured from the parser as released, before the media fix
  assert.equal(only('just a normal text message').id, 'i24w79d7hqvu');
  assert.equal(only('IMG-20260105-WA0002.jpg (file attached)\nLook at this receipt').id, 'i9s5hzhl1em');
  assert.equal(only('invoice-2026.pdf (file attached)').id, 'i1owjwedckn5');
});
