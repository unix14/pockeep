import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { listUsers, createUser, updateUser, deleteUser, getUser } from '../users.js';
import { HttpError, notFound } from '../errors.js';
import { translate, requestLang } from '../i18n.js';

/* User management. Admin only. Admins manage accounts; they cannot read other
   users' cards through these endpoints (or any other). */
export default async function adminRoutes(app) {
  const { db, config } = app;

  app.addHook('preHandler', async (req, reply) => {
    if (reply.sent) return;
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: translate('רק מנהל מערכת יכול לנהל משתמשים', requestLang(req)), code: 'forbidden' });
  });

  app.get('/users', async () => ({ users: listUsers(db) }));

  app.post('/users', async req => {
    const { username, password, role = 'user', mustChangePassword = true } = req.body || {};
    const user = createUser(db, { username, password, role, mustChangePassword: mustChangePassword !== false });
    return { user: { ...user, cards: 0 } };
  });

  app.patch('/users/:id', async req => {
    const id = Number(req.params.id);
    if (!getUser(db, id)) throw notFound('המשתמש לא נמצא');
    const { role, mustChangePassword, password } = req.body || {};
    const user = updateUser(db, req.user.id, id, {
      role, password: password === '' ? undefined : password,
      mustChangePassword: typeof mustChangePassword === 'boolean' ? mustChangePassword : undefined
    });
    return { user: listUsers(db).find(u => u.id === user.id) };
  });

  app.delete('/users/:id', async req => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'bad_request', 'מזהה משתמש לא תקין');
    deleteUser(db, req.user.id, id);
    try { rmSync(join(config.exportsDir, String(id)), { recursive: true, force: true }); } catch { /* nothing stored */ }
    return { ok: true };
  });
}
