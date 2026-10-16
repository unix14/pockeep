#!/usr/bin/env node
/* Account administration from the shell.
     node server/src/cli.js user:add <username> [--admin] [--temp]
     node server/src/cli.js user:passwd <username> [--temp]
     node server/src/cli.js user:list
     node server/src/cli.js user:delete <username>      (deletes the account and all its cards)
   --temp marks the password as temporary: the user must change it at next sign-in.
   Passwords are read from the SM_PASSWORD environment variable, or prompted for. */
import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createUser, setPassword } from './users.js';

const [, , cmd, name, ...rest] = process.argv;
const config = loadConfig();
const db = openDb(config.dbFile);

function ask(question, hidden = true) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    rl.question(question, a => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
async function password() {
  if (process.env.SM_PASSWORD) return process.env.SM_PASSWORD;
  const a = await ask('Password (min 8 characters): ');
  const b = await ask('Repeat password: ');
  if (a !== b) { console.error('The passwords do not match.'); process.exit(1); }
  return a;
}
const find = n => db.prepare('SELECT * FROM users WHERE username = ?').get(n);

try {
  switch (cmd) {
    case 'user:add': {
      if (!name) throw new Error('Usage: user:add <username> [--admin] [--temp]');
      const u = createUser(db, { username: name, password: await password(), role: rest.includes('--admin') ? 'admin' : 'user', mustChangePassword: rest.includes('--temp') });
      console.log(`Created ${u.role} account "${u.username}".`);
      break;
    }
    case 'user:passwd': {
      const u = name && find(name);
      if (!u) throw new Error(`No account named "${name}".`);
      setPassword(db, u.id, await password(), { mustChangePassword: rest.includes('--temp') });
      console.log(`Password changed for "${u.username}". Existing sessions were signed out.`);
      break;
    }
    case 'user:list': {
      const rows = db.prepare(`SELECT u.username, u.role, u.created_at, u.must_change_password,
        (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id AND i.status != 'purged') AS cards FROM users u ORDER BY u.id`).all();
      if (!rows.length) console.log('No accounts yet.');
      for (const r of rows) console.log(`${r.username.padEnd(24)} ${r.role.padEnd(6)} ${String(r.cards).padStart(6)} cards   created ${r.created_at.slice(0, 10)}${r.must_change_password ? '   (must change password)' : ''}`);
      break;
    }
    case 'user:delete': {
      const u = name && find(name);
      if (!u) throw new Error(`No account named "${name}".`);
      if (!rest.includes('--yes')) {
        const a = await ask(`Delete "${u.username}" and all of their cards? Type the username to confirm: `, false);
        if (a !== u.username) { console.log('Cancelled.'); break; }
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      console.log(`Deleted "${u.username}".`);
      break;
    }
    default:
      console.log('Commands: user:add <name> [--admin] [--temp] | user:passwd <name> [--temp] | user:list | user:delete <name> [--yes]');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
