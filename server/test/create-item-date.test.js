process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: the local day differs from the UTC day for most of the day

import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/users.js';
import { forUser } from '../src/repo.js';

/* A card created by hand got its date from the UTC clock but its time from the
   local clock, so in any non-UTC timezone it could land on the wrong day. */

after(() => mock.timers.reset());

test('a new card takes its date and time from the same (local) clock', () => {
  const db = openDb(':memory:');
  const u = createUser(db, { username: 'kiri', password: 'kiri-password' }); // fictional test account
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') }); // 02:00 on Nov 6 in Kiritimati
  const it = forUser(db, u.id).createItem({ body: 'call the dentist' });
  mock.timers.reset();
  assert.equal(it.time, '02:00');
  assert.equal(it.date, '2026-11-06');
  db.close();
});
