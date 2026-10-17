import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import AdmZip from 'adm-zip';
import Core from '../../../shared/core.js';
import { forUser, summarize } from '../repo.js';
import { badRequest, notFound, HttpError } from '../errors.js';

const PENDING_TTL = 30 * 60 * 1000;

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.opus': 'audio/opus', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.vcf': 'text/vcard', '.csv': 'text/csv',
  '.zip': 'application/zip', '.gz': 'application/gzip',
  '.json': 'application/json', '.xml': 'application/xml',
};
function mimeOf(name) {
  return MIME_MAP[extname(name).toLowerCase()] || 'application/octet-stream';
}

const SKIP_RE = /^(__MACOSX|\.DS_Store|Thumbs\.db|\.)/i;
function isSkippable(entryName) {
  return SKIP_RE.test(entryName) || entryName.split('/').some(p => SKIP_RE.test(p));
}

function extractZip(buf) {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  let textEntry = null;
  const files = new Map();

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.split('/').pop();
    if (!name || isSkippable(entry.entryName)) continue;

    if (/\.(txt|md)$/i.test(name) && !textEntry) {
      textEntry = entry;
    } else {
      files.set(name, { entryName: entry.entryName, size: entry.header.size });
    }
  }

  if (!textEntry) throw badRequest('לא נמצא קובץ טקסט (‎.txt‎ או ‎.md‎) בתוך ה-ZIP');

  const text = textEntry.getData().toString('utf8');
  return { text, textFileName: textEntry.entryName.split('/').pop(), files, zip };
}

function matchAttachments(items, fileNames) {
  const byBase = new Map();
  for (const fn of fileNames) byBase.set(fn.toLowerCase(), fn);

  const map = new Map();
  const matched = new Set();

  for (const item of items) {
    const raw = (item.raw || '').toLowerCase();
    for (const [baseLower, original] of byBase) {
      if (raw.includes(baseLower)) {
        if (!map.has(item.id)) map.set(item.id, []);
        map.get(item.id).push(original);
        matched.add(original);
      }
    }
  }
  return { map, matched };
}

/* Import flow: POST the export as text or zip to /imports/preview, show the counts,
   then POST /imports/:token/commit. Nothing is written until commit, and the
   commit re-checks against the database inside one transaction. */
export default async function importRoutes(app) {
  const { db, config } = app;
  const pending = new Map();

  const sweep = () => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > PENDING_TTL) pending.delete(k); };
  const bodyLimit = config.maxImportMb * 1024 * 1024;

  app.addContentTypeParser(['text/plain', 'text/markdown'], { parseAs: 'string', bodyLimit },
    (req, body, done) => done(null, body));

  app.addContentTypeParser(['application/zip', 'application/x-zip-compressed'], { parseAs: 'buffer', bodyLimit },
    (req, body, done) => done(null, body));

  app.post('/imports/preview', { bodyLimit }, async req => {
    sweep();

    let text, zipBuffer = null, attachmentFiles = null, attachmentMatch = null;

    if (Buffer.isBuffer(req.body)) {
      const extracted = extractZip(req.body);
      text = extracted.text;
      zipBuffer = req.body;
      attachmentFiles = extracted.files;
    } else {
      text = typeof req.body === 'string' ? req.body : '';
    }

    if (!text.trim()) throw badRequest('הקובץ ריק');
    const parsed = Core.parseExport(text);
    if (!parsed.format) throw badRequest(parsed.stats.error, 'unrecognized_format');
    const repo = forUser(db, req.user.id);
    const plan = Core.reconcile(parsed.items, repo.reconcileMap(), repo.rules());

    let attachmentStats = null;
    if (attachmentFiles?.size) {
      attachmentMatch = matchAttachments(parsed.items, [...attachmentFiles.keys()]);
      attachmentStats = { total: attachmentFiles.size, matched: attachmentMatch.matched.size };
    }

    const mine = [...pending.entries()].filter(([, v]) => v.userId === req.user.id).sort((a, b) => a[1].at - b[1].at);
    while (mine.length >= 3) pending.delete(mine.shift()[0]);
    const token = randomBytes(18).toString('base64url');
    let fileName = String(req.headers['x-file-name'] || '');
    try { fileName = decodeURIComponent(fileName); } catch { /* keep as sent */ }
    fileName = fileName.slice(0, 200).replace(/[^\p{L}\p{N} ._()-]/gu, '_') || 'export';
    pending.set(token, { userId: req.user.id, parsed, text, fileName, zipBuffer, attachmentFiles, attachmentMatch, at: Date.now() });
    return {
      token, fileName, format: parsed.format, exportDate: parsed.exportDate || null,
      firstDate: parsed.items[0]?.date || null, lastDate: parsed.items.at(-1)?.date || null,
      counts: summarize(parsed, plan),
      attachments: attachmentStats
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

    let attachmentMap = null;
    if (p.zipBuffer && p.attachmentMatch?.matched.size) {
      const zip = new AdmZip(p.zipBuffer);
      attachmentMap = new Map();

      for (const [itemId, fileNames] of p.attachmentMatch.map) {
        const records = [];
        for (const fn of fileNames) {
          const info = p.attachmentFiles.get(fn);
          if (!info) continue;
          const entry = zip.getEntry(info.entryName);
          if (!entry) continue;

          const safeFileName = fn.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 200);
          const dir = join(config.attachmentsDir, String(req.user.id), itemId);
          mkdirSync(dir, { recursive: true });
          try {
            writeFileSync(join(dir, safeFileName), entry.getData());
            records.push({ name: safeFileName, type: mimeOf(fn), size: entry.header.size });
          } catch (e) {
            req.log.warn(e, `Could not store attachment ${fn}`);
          }
        }
        if (records.length) attachmentMap.set(itemId, records);
      }
    }

    const repo = forUser(db, req.user.id);
    const result = repo.commitImport(p.parsed, { fileName: p.fileName, storedFile }, attachmentMap);
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
