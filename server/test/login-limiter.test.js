import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLoginLimiter } from '../src/users.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('blocks after max failures and unblocks after the window', async () => {
  const l = makeLoginLimiter({ max: 3, windowMs: 40 });
  const keys = ['ip:1', 'u:eve'];
  for (let i = 0; i < 3; i++) { assert.equal(l.blocked(keys), false); l.fail(keys); }
  assert.equal(l.blocked(keys), true);
  await sleep(60);
  assert.equal(l.blocked(keys), false);
});

test('reset clears the counters for those keys', () => {
  const l = makeLoginLimiter({ max: 2, windowMs: 60_000 });
  l.fail(['u:a']); l.fail(['u:a']);
  assert.equal(l.blocked(['u:a']), true);
  l.reset(['u:a']);
  assert.equal(l.blocked(['u:a']), false);
});

test('expired entries are swept instead of accumulating forever', async () => {
  const l = makeLoginLimiter({ max: 10, windowMs: 30 });
  for (let i = 0; i < 500; i++) { const keys = ['ip:x', `u:random-${i}`]; l.blocked(keys); l.fail(keys); }
  assert.equal(l.size(), 501);
  await sleep(50);
  l.blocked(['ip:y', 'u:someone']);
  assert.equal(l.size(), 0);
});

test('checking alone never creates entries', () => {
  const l = makeLoginLimiter();
  for (let i = 0; i < 100; i++) l.blocked([`ip:${i}`, `u:${i}`]);
  assert.equal(l.size(), 0);
});
