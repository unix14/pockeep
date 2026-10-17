import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { forUser } from '../repo.js';
import { badRequest, notFound } from '../errors.js';

/* Cards, categories, rules, labels and preferences. Every handler builds its
   repository from req.user.id (the session), never from request input. */
export default async function dataRoutes(app) {
  const { db } = app;
  const repoOf = req => forUser(db, req.user.id);

  // Everything the dashboard needs in one request.
  app.get('/state', async req => {
    const r = repoOf(req);
    return {
      user: { id: req.user.id, username: req.user.username, role: req.user.role },
      categories: r.categories(),
      rules: r.rules(),
      settings: r.settings(),
      imports: r.imports(50),
      items: r.items()
    };
  });

  app.get('/items/:id', async req => {
    const it = repoOf(req).item(req.params.id);
    if (!it) throw notFound('הכרטיס לא נמצא');
    return { item: it };
  });

  app.post('/items', async req => ({ item: repoOf(req).createItem(req.body || {}) }));

  app.patch('/items/:id', async req => ({ item: repoOf(req).patchItem(req.params.id, req.body?.patch ?? req.body) }));

  // Batch edits (bulk actions, drag-and-drop of a selection, undo). Atomic.
  app.post('/items/batch', async req => repoOf(req).patchMany(req.body?.ops));

  app.post('/items/:id/resolve', async req => repoOf(req).resolveItem(req.params.id, req.body?.action));

  app.post('/trash/empty', async req => ({ purged: repoOf(req).emptyTrash() }));

  app.put('/categories', async req => ({ categories: repoOf(req).replaceCategories(req.body?.categories), items: repoOf(req).items() }));

  app.post('/rules', async req => ({ rule: repoOf(req).addRule(req.body || {}) }));
  app.patch('/rules/:id', async req => ({ rule: repoOf(req).updateRule(Number(req.params.id), req.body || {}) }));
  app.delete('/rules/:id', async req => { repoOf(req).deleteRule(Number(req.params.id)); return { ok: true }; });

  app.put('/labels', async req => {
    if (!Array.isArray(req.body?.labels)) throw badRequest('תוויות חייבות להיות רשימה');
    return { labels: repoOf(req).setKnownLabels(req.body.labels) };
  });
  app.post('/labels/rename', async req => {
    const { from, to } = req.body || {};
    if (typeof from !== 'string' || typeof to !== 'string') throw badRequest('חסר שם תווית');
    const r = repoOf(req);
    const changed = r.renameLabel(from, to);
    return { changed, labels: r.settings().labels, rules: r.rules() };
  });
  app.post('/labels/delete', async req => {
    if (typeof req.body?.name !== 'string') throw badRequest('חסר שם תווית');
    const r = repoOf(req);
    return { changed: r.deleteLabel(req.body.name), labels: r.settings().labels };
  });

  app.patch('/settings', async req => ({ prefs: repoOf(req).setPrefs(req.body?.prefs) }));

  // Serve attachment files
  app.get('/attachments/:itemId/:fileName', async (req, reply) => {
    const { itemId, fileName } = req.params;
    const safeName = decodeURIComponent(fileName).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 200);
    const filePath = join(app.config.attachmentsDir, String(req.user.id), itemId, safeName);
    if (!filePath.startsWith(app.config.attachmentsDir) || !existsSync(filePath)) throw notFound('הקובץ לא נמצא');

    const ext = safeName.split('.').pop()?.toLowerCase() || '';
    const contentType = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', bmp: 'image/bmp',
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
      pdf: 'application/pdf',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      opus: 'audio/opus', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav',
      vcf: 'text/vcard',
    }[ext] || 'application/octet-stream';

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(safeName)}"`);
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(filePath));
  });
}
