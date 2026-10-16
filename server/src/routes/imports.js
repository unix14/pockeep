import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Core from '../../../shared/core.js';
import { forUser, summarize } from '../repo.js';
import { badRequest, notFound, HttpError } from '../errors.js';

const PENDING_TTL = 30 * 60 * 1000;

/* Import flow: POST the export as text to /imports/preview, show the counts,
   then POST /imports/:token/commit. Nothing is written until commit, and the
   commit re-checks against the database inside one transaction. */
export default async function importRoutes(app) {
  const { db, config } = app;
  const pending = new Map(); // token -> {userId, parsed, text, fileName, at}

  const sweep = () => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > PENDING_TTL) pending.delete(k); };
  const textBody = { bodyLimit: config.maxImportMb * 1024 * 1024 };

  app.addContentTypeParser(['text/plain', 'text/markdown'], { parseAs: 'string', bodyLimit: config.maxImportMb * 1024 * 1024 },
    (req, body, done) => done(null, body));

  app.post('/imports/preview', textBody, async req => {
    sweep();
    const text = typeof req.body === 'string' ? req.body : '';
    if (!text.trim()) throw badRequest('הקובץ ריק');
    const parsed = Core.parseExport(text);
    if (!parsed.format) throw badRequest(parsed.stats.error, 'unrecognized_format');
    const repo = forUser(db, req.user.id);
    const plan = Core.reconcile(parsed.items, repo.reconcileMap(), repo.rules());
    // keep at most 3 pending previews per user
    const mine = [...pending.entries()].filter(([, v]) => v.userId === req.user.id).sort((a, b) => a[1].at - b[1].at);
    while (mine.length >= 3) pending.delete(mine.shift()[0]);
    const token = randomBytes(18).toString('base64url');
    let fileName = String(req.headers['x-file-name'] || '');
    try { fileName = decodeURIComponent(fileName); } catch { /* keep as sent */ }
    fileName = fileName.slice(0, 200).replace(/[^\p{L}\p{N} ._()-]/gu, '_') || 'export';
    pending.set(token, { userId: req.user.id, parsed, text, fileName, at: Date.now() });
    return {
      token, fileName, format: parsed.format, exportDate: parsed.exportDate || null,
      firstDate: parsed.items[0]?.date || null, lastDate: parsed.items.at(-1)?.date || null,
      counts: summarize(parsed, plan)
    };
  });

  app.post('/imports/:token/commit', async req => {
    const p = pending.get(req.params.token);
    if (!p || p.userId !== req.user.id) throw notFound('התצוגה המקדימה פגה. יש לבחור את הקובץ שוב.');
    pending.delete(req.params.token);
    let storedFile = null;
    if (config.storeExports) {
      try {
        const dir = join(config.exportsDir, String(req.user.id));
        mkdirSync(dir, { recursive: true });
        storedFile = `${new Date().toISOString().replace(/[:.]/g, '-')}_${p.fileName}`;
        writeFileSync(join(dir, storedFile), p.text, 'utf8');
      } catch (e) { req.log.warn(e, 'Could not store the export file'); storedFile = null; }
    }
    const repo = forUser(db, req.user.id);
    const result = repo.commitImport(p.parsed, { fileName: p.fileName, storedFile });
    return { ...result, items: repo.items(), imports: repo.imports(50), settings: repo.settings() };
  });

  app.get('/imports', async req => ({ imports: forUser(db, req.user.id).imports(500) }));

  // Backup: full JSON of this account's data.
  app.get('/backup', async (req, reply) => {
    const data = forUser(db, req.user.id).exportAll();
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="pockeep-${req.user.username}-${stamp}.json"`);
    return { app: 'pockeep', version: 1, exportedAt: new Date().toISOString(), username: req.user.username, ...data };
  });

  app.post('/backup/restore', { bodyLimit: config.maxBackupMb * 1024 * 1024 }, async req => {
    const { mode = 'merge', backup } = req.body || {};
    if (!['merge', 'replace'].includes(mode)) throw badRequest('מצב שחזור לא מוכר');
    if (!backup || !['pockeep', 'saved-messages'].includes(backup.app)) throw new HttpError(400, 'bad_backup', 'הקובץ הזה אינו גיבוי של פוקיפ');
    const repo = forUser(db, req.user.id);
    const result = repo.restore(backup, mode);
    return { ...result, items: repo.items(), categories: repo.categories(), rules: repo.rules(), settings: repo.settings(), imports: repo.imports(50) };
  });
}
