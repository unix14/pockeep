import { randomBytes } from 'node:crypto';
import Core from '../../shared/core.js';
import { nowIso } from './db.js';
import { rowToItem, itemToRow, validatePatch, applyPatch, cleanLabels } from './items.js';
import { badRequest, notFound } from './errors.js';

/*
  Data access, always scoped to one user.

  forUser(db, userId) is the only way route handlers reach user data. Every
  statement below binds user_id from the authenticated session; no method
  accepts a user id from the client, so one account can never address another
  account's rows.
*/

const J = (s, d) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };
const ITEM_COLS = ['user_id', 'id', 'date', 'time', 'seq', 'sender', 'raw', 'body', 'wa_text', 'media', 'doc_name', 'forwarded',
  'title', 'text', 'note', 'category_id', 'type', 'labels', 'fields', 'flags', 'pinned', 'locked', 'color', 'done', 'watched',
  'used', 'status', 'possible_edit_of', 'dup_of', 'import_id', 'created_at', 'updated_at', 'trashed_at'];
const UPDATABLE = ITEM_COLS.filter(c => !['user_id', 'id', 'created_at'].includes(c));

const stmtCache = new WeakMap();
function statements(db) {
  if (stmtCache.has(db)) return stmtCache.get(db);
  const s = {
    items: db.prepare(`SELECT * FROM items WHERE user_id = ? AND status != 'purged' ORDER BY date DESC, time DESC, seq DESC`),
    itemsAll: db.prepare(`SELECT * FROM items WHERE user_id = ?`),
    item: db.prepare(`SELECT * FROM items WHERE user_id = ? AND id = ?`),
    insertItem: db.prepare(`INSERT INTO items (${ITEM_COLS.join(',')}) VALUES (${ITEM_COLS.map(c => '@' + c).join(',')})`),
    upsertItem: db.prepare(`INSERT INTO items (${ITEM_COLS.join(',')}) VALUES (${ITEM_COLS.map(c => '@' + c).join(',')})
      ON CONFLICT(user_id, id) DO UPDATE SET ${UPDATABLE.map(c => `${c} = excluded.${c}`).join(', ')}`),
    updateItem: db.prepare(`UPDATE items SET ${UPDATABLE.map(c => `${c} = @${c}`).join(', ')} WHERE user_id = @user_id AND id = @id`),
    deleteItem: db.prepare(`DELETE FROM items WHERE user_id = ? AND id = ?`),
    reconcileRows: db.prepare(`SELECT id, date, time, status FROM items WHERE user_id = ?`),
    aliases: db.prepare(`SELECT alias, item_id FROM item_aliases WHERE user_id = ?`),
    addAlias: db.prepare(`INSERT OR REPLACE INTO item_aliases (user_id, alias, item_id) VALUES (?, ?, ?)`),
    repointAliases: db.prepare(`UPDATE item_aliases SET item_id = ? WHERE user_id = ? AND item_id = ?`),
    purgeTrash: db.prepare(`UPDATE items SET status = 'purged', raw = '', body = '', wa_text = NULL, title = '', text = NULL, note = '',
      fields = '{}', labels = '[]', flags = '{}', doc_name = NULL, sender = NULL, color = NULL, pinned = 0, updated_at = ?
      WHERE user_id = ? AND status = 'trashed' AND locked = 0`),
    itemsWithLabel: db.prepare(`SELECT i.id, i.labels FROM items i WHERE i.user_id = ? AND EXISTS (SELECT 1 FROM json_each(i.labels) j WHERE j.value = ?)`),
    setLabels: db.prepare(`UPDATE items SET labels = ?, updated_at = ? WHERE user_id = ? AND id = ?`),
    recategorize: db.prepare(`UPDATE items SET category_id = 'inbox', updated_at = ? WHERE user_id = ? AND category_id = ?`),

    categories: db.prepare(`SELECT id, name, color, icon, position FROM categories WHERE user_id = ? ORDER BY position`),
    deleteCategories: db.prepare(`DELETE FROM categories WHERE user_id = ?`),
    insertCategory: db.prepare(`INSERT INTO categories (user_id, id, name, color, icon, position) VALUES (?, ?, ?, ?, ?, ?)`),

    rules: db.prepare(`SELECT * FROM rules WHERE user_id = ? ORDER BY position, id`),
    rule: db.prepare(`SELECT * FROM rules WHERE user_id = ? AND id = ?`),
    insertRule: db.prepare(`INSERT INTO rules (user_id, match, pattern, category_id, labels, enabled, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    updateRule: db.prepare(`UPDATE rules SET match = ?, pattern = ?, category_id = ?, labels = ?, enabled = ?, position = ? WHERE user_id = ? AND id = ?`),
    deleteRule: db.prepare(`DELETE FROM rules WHERE user_id = ? AND id = ?`),
    rulesToInbox: db.prepare(`UPDATE rules SET category_id = 'inbox' WHERE user_id = ? AND category_id = ?`),
    maxRulePos: db.prepare(`SELECT COALESCE(MAX(position), -1) AS p FROM rules WHERE user_id = ?`),

    settings: db.prepare(`SELECT * FROM user_settings WHERE user_id = ?`),
    ensureSettings: db.prepare(`INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`),
    setLastImport: db.prepare(`UPDATE user_settings SET last_import_id = ? WHERE user_id = ?`),
    setKnownLabels: db.prepare(`UPDATE user_settings SET labels = ? WHERE user_id = ?`),
    setPrefs: db.prepare(`UPDATE user_settings SET prefs = ? WHERE user_id = ?`),

    imports: db.prepare(`SELECT * FROM imports WHERE user_id = ? ORDER BY at DESC LIMIT ?`),
    insertImport: db.prepare(`INSERT INTO imports (user_id, id, at, file_name, export_date, format, counts, stored_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    upsertImport: db.prepare(`INSERT OR REPLACE INTO imports (user_id, id, at, file_name, export_date, format, counts, stored_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),

    attachmentsForUser: db.prepare(`SELECT item_id, file_name, mime_type, size FROM item_attachments WHERE user_id = ?`),
    attachmentsForItem: db.prepare(`SELECT file_name, mime_type, size FROM item_attachments WHERE user_id = ? AND item_id = ?`),
    insertAttachment: db.prepare(`INSERT OR REPLACE INTO item_attachments (user_id, item_id, file_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
    deleteAttachmentsForItem: db.prepare(`DELETE FROM item_attachments WHERE user_id = ? AND item_id = ?`),

    wipeItems: db.prepare(`DELETE FROM items WHERE user_id = ?`),
    wipeAliases: db.prepare(`DELETE FROM item_aliases WHERE user_id = ?`),
    wipeRules: db.prepare(`DELETE FROM rules WHERE user_id = ?`),
    wipeImports: db.prepare(`DELETE FROM imports WHERE user_id = ?`)
  };
  stmtCache.set(db, s);
  return s;
}

const ruleOut = r => ({ id: r.id, match: r.match, pattern: r.pattern, category: r.category_id, labels: J(r.labels, []), enabled: !!r.enabled, position: r.position });
const importOut = r => ({ id: r.id, at: r.at, fileName: r.file_name, exportDate: r.export_date, format: r.format, counts: J(r.counts, {}), storedFile: !!r.stored_file });
const COLOR_NAMES = ['slate', 'teal', 'green', 'amber', 'rose', 'indigo', 'sky', 'violet', 'brown', 'orange', 'pink', 'lime', 'cyan', 'red'];

export function seedUserDefaults(db, userId) {
  const s = statements(db);
  db.transaction(() => {
    s.ensureSettings.run(userId);
    if (!s.categories.all(userId).length) {
      Core.CATEGORIES.forEach((c, i) => s.insertCategory.run(userId, c.id, c.name, c.color, c.icon, i));
    }
  })();
}

export function forUser(db, userId) {
  if (!Number.isInteger(userId)) throw new Error('forUser requires an authenticated user id');
  const s = statements(db);
  const now = nowIso;

  const repo = {
    userId,

    // ---------- reads ----------
    items: () => {
      const rows = s.items.all(userId).map(rowToItem);
      const atts = s.attachmentsForUser.all(userId);
      if (atts.length) {
        const byItem = new Map();
        for (const a of atts) {
          if (!byItem.has(a.item_id)) byItem.set(a.item_id, []);
          byItem.get(a.item_id).push({ name: a.file_name, type: a.mime_type, size: a.size });
        }
        for (const it of rows) if (byItem.has(it.id)) it.attachments = byItem.get(it.id);
      }
      return rows;
    },
    item(id) {
      const r = s.item.get(userId, id);
      if (!r || r.status === 'purged') return null;
      const it = rowToItem(r);
      const atts = s.attachmentsForItem.all(userId, id);
      if (atts.length) it.attachments = atts.map(a => ({ name: a.file_name, type: a.mime_type, size: a.size }));
      return it;
    },
    categories: () => s.categories.all(userId),
    categoryIds: () => new Set(s.categories.all(userId).map(c => c.id)),
    rules: () => s.rules.all(userId).map(ruleOut),
    settings() {
      s.ensureSettings.run(userId);
      const r = s.settings.get(userId);
      return { lastImportId: r.last_import_id, labels: J(r.labels, []), prefs: J(r.prefs, {}) };
    },
    imports: (limit = 100) => s.imports.all(userId, limit).map(importOut),
    // existing cards for import reconciliation: Map id -> {id,date,time,status,aliases}
    reconcileMap() {
      const m = new Map();
      for (const r of s.reconcileRows.all(userId)) m.set(r.id, { ...r, aliases: [] });
      for (const a of s.aliases.all(userId)) m.get(a.item_id)?.aliases.push(a.alias);
      return m;
    },

    // ---------- create card ----------
    createItem({ body, category, type, title, note, labels, fields } = {}) {
      if (!body && !title) throw badRequest('הבקשה לא תקינה');
      const id = 'i' + randomBytes(8).toString('base64url');
      const at = now();
      const d = new Date();
      const date = d.toISOString().slice(0, 10);
      const time = d.toTimeString().slice(0, 5);
      const catIds = repo.categoryIds();
      const it = {
        id, date, time, seq: 0, sender: null,
        raw: body || '', body: body || '', waText: null, media: null, docName: null, forwarded: false,
        title: typeof title === 'string' ? title.slice(0, 500) : '',
        text: null, note: typeof note === 'string' ? note.slice(0, 10000) : '',
        category: catIds.has(category) ? category : 'inbox',
        type: ['note', 'todo', 'expense', 'voucher', 'event', 'link'].includes(type) ? type : 'note',
        labels: cleanLabels(labels || []),
        fields: fields && typeof fields === 'object' ? fields : {},
        flags: {}, pinned: false, locked: false, color: null,
        done: false, watched: false, used: false, status: 'active',
        possibleEditOf: null, dupOf: null, importId: null,
        createdAt: at, updatedAt: at, trashedAt: null
      };
      s.insertItem.run(itemToRow(it, userId));
      if (it.labels.length) repo.rememberLabels(it.labels);
      return it;
    },

    // ---------- card edits ----------
    patchItem(id, rawPatch, { touch = true } = {}) {
      const row = s.item.get(userId, id);
      if (!row || row.status === 'purged') throw notFound('הכרטיס לא נמצא');
      const patch = validatePatch(rawPatch, { categoryIds: repo.categoryIds() });
      const next = applyPatch(rowToItem(row), patch, { touch, now: now() });
      s.updateItem.run(itemToRow(next, userId));
      if (patch.labels) repo.rememberLabels(patch.labels);
      return next;
    },
    // ops: [{id, patch}] -> {items, skipped}
    patchMany(ops) {
      if (!Array.isArray(ops) || !ops.length) throw badRequest('לא נשלחו שינויים');
      if (ops.length > 5000) throw badRequest('יותר מדי שינויים בבקשה אחת');
      const items = [], skipped = [];
      db.transaction(() => {
        for (const op of ops) {
          try { items.push(repo.patchItem(String(op.id), op.patch)); }
          catch (e) { if (e.statusCode && e.statusCode < 500 && e.code !== 'bad_request') skipped.push({ id: op.id, reason: e.code }); else throw e; }
        }
      })();
      return { items, skipped };
    },
    // resolve a duplicate / possible-edit card: 'keep' clears the flag, 'merge' folds it into the original
    resolveItem(id, action) {
      const row = s.item.get(userId, id);
      if (!row || row.status === 'purged') throw notFound('הכרטיס לא נמצא');
      const it = rowToItem(row);
      return db.transaction(() => {
        if (action === 'keep') {
          const next = { ...it, flags: { ...it.flags, dup: false, possibleEdit: false, auto: false }, possibleEditOf: null, dupOf: null, updatedAt: now() };
          s.updateItem.run(itemToRow(next, userId));
          return { kept: next, removedId: null, target: null };
        }
        if (action !== 'merge') throw badRequest('פעולה לא מוכרת');
        const targetId = it.flags.possibleEdit ? (it.possibleEditOf || [])[0] : it.dupOf;
        const targetRow = targetId && s.item.get(userId, targetId);
        if (!targetRow || targetRow.status === 'purged') throw badRequest('הכרטיס המקורי כבר לא קיים');
        let target = rowToItem(targetRow);
        if (it.flags.possibleEdit) {
          target = { ...target, waText: it.body, flags: { ...target.flags, editedWA: true }, updatedAt: now() };
          s.updateItem.run(itemToRow(target, userId));
        }
        s.repointAliases.run(target.id, userId, it.id);
        s.deleteItem.run(userId, it.id);
        s.addAlias.run(userId, it.id, target.id); // future imports recognise this message
        return { kept: null, removedId: it.id, target };
      })();
    },
    emptyTrash() { return s.purgeTrash.run(now(), userId).changes; },

    // ---------- taxonomy ----------
    replaceCategories(list) {
      if (!Array.isArray(list) || !list.length) throw badRequest('רשימת הקטגוריות ריקה');
      if (list.length > 60) throw badRequest('יותר מדי קטגוריות');
      const seen = new Set();
      const clean = list.map((c, i) => {
        const name = String(c.name || '').trim().slice(0, 60);
        if (!name) throw badRequest('לכל קטגוריה צריך להיות שם');
        let id = typeof c.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(c.id) ? c.id : 'c_' + Math.random().toString(36).slice(2, 9);
        if (seen.has(id)) throw badRequest('מזהה קטגוריה כפול');
        seen.add(id);
        return { id, name, color: COLOR_NAMES.includes(c.color) ? c.color : 'slate', icon: String(c.icon || 'folder').slice(0, 20), position: i };
      });
      if (!seen.has('inbox')) throw badRequest('אי אפשר למחוק את הקטגוריה „לא ממוינים”');
      db.transaction(() => {
        const removed = s.categories.all(userId).map(c => c.id).filter(id => !seen.has(id));
        for (const id of removed) { s.recategorize.run(now(), userId, id); s.rulesToInbox.run(userId, id); }
        s.deleteCategories.run(userId);
        for (const c of clean) s.insertCategory.run(userId, c.id, c.name, c.color, c.icon, c.position);
      })();
      return repo.categories();
    },
    validRule(r) {
      const match = ['contains', 'domain', 'starts', 'regex'].includes(r.match) ? r.match : null;
      if (!match) throw badRequest('סוג התנאי לא מוכר');
      const pattern = String(r.pattern || '').trim();
      if (!pattern || pattern.length > 300) throw badRequest('יש להזין טקסט לחיפוש (עד 300 תווים)');
      if (match === 'regex') { try { new RegExp(pattern, 'i'); } catch { throw badRequest('הביטוי הרגולרי לא תקין'); } }
      const category = r.category == null || r.category === '' ? null : String(r.category);
      if (category && !repo.categoryIds().has(category)) throw badRequest('הקטגוריה לא קיימת');
      const labels = cleanLabels(r.labels || []);
      if (!category && !labels.length) throw badRequest('לכלל צריך להיות יעד: קטגוריה או לפחות תווית אחת');
      return { match, pattern, category, labels, enabled: r.enabled !== false };
    },
    addRule(r) {
      const v = repo.validRule(r);
      const pos = s.maxRulePos.get(userId).p + 1;
      const info = s.insertRule.run(userId, v.match, v.pattern, v.category, JSON.stringify(v.labels), v.enabled ? 1 : 0, pos, now());
      if (v.labels.length) repo.rememberLabels(v.labels);
      return ruleOut(s.rule.get(userId, info.lastInsertRowid));
    },
    updateRule(id, r) {
      const cur = s.rule.get(userId, id);
      if (!cur) throw notFound('הכלל לא נמצא');
      const merged = { ...ruleOut(cur), ...r };
      const v = repo.validRule(merged);
      const pos = Number.isInteger(merged.position) ? merged.position : cur.position;
      s.updateRule.run(v.match, v.pattern, v.category, JSON.stringify(v.labels), v.enabled ? 1 : 0, pos, userId, id);
      if (v.labels.length) repo.rememberLabels(v.labels);
      return ruleOut(s.rule.get(userId, id));
    },
    deleteRule(id) { if (!s.deleteRule.run(userId, id).changes) throw notFound('הכלל לא נמצא'); },

    rememberLabels(labels) {
      const cur = repo.settings().labels;
      const add = labels.filter(l => !cur.includes(l));
      if (add.length) s.setKnownLabels.run(JSON.stringify([...cur, ...add].sort((a, b) => a.localeCompare(b))), userId);
    },
    setKnownLabels(labels) {
      const clean = cleanLabels(labels.slice(0, 500), 500);
      s.setKnownLabels.run(JSON.stringify(clean), userId);
      return clean;
    },
    renameLabel(from, to) {
      const [target] = cleanLabels([to]);
      if (!target) throw badRequest('יש להזין שם לתווית');
      let changed = 0;
      db.transaction(() => {
        for (const r of s.itemsWithLabel.all(userId, from)) {
          const labels = J(r.labels, []).map(l => (l === from ? target : l)).filter((l, i, a) => a.indexOf(l) === i);
          s.setLabels.run(JSON.stringify(labels), now(), userId, r.id); changed++;
        }
        const known = repo.settings().labels.map(l => (l === from ? target : l)).filter((l, i, a) => a.indexOf(l) === i);
        s.setKnownLabels.run(JSON.stringify(known), userId);
        for (const rule of repo.rules()) if (rule.labels.includes(from)) repo.updateRule(rule.id, { labels: rule.labels.map(l => (l === from ? target : l)) });
      })();
      return changed;
    },
    deleteLabel(name) {
      let changed = 0;
      db.transaction(() => {
        for (const r of s.itemsWithLabel.all(userId, name)) {
          s.setLabels.run(JSON.stringify(J(r.labels, []).filter(l => l !== name)), now(), userId, r.id); changed++;
        }
        s.setKnownLabels.run(JSON.stringify(repo.settings().labels.filter(l => l !== name)), userId);
      })();
      return changed;
    },
    setPrefs(prefs) {
      const cur = repo.settings().prefs;
      const next = { ...cur };
      if (prefs && typeof prefs === 'object') {
        if (['system', 'light', 'dark'].includes(prefs.theme)) next.theme = prefs.theme;
        if (['he', 'en'].includes(prefs.lang)) next.lang = prefs.lang;
      }
      s.setPrefs.run(JSON.stringify(next), userId);
      return next;
    },

    // ---------- attachments ----------
    addAttachments(itemId, files) {
      const at = now();
      for (const f of files) s.insertAttachment.run(userId, itemId, f.name, f.type || null, f.size || 0, at);
    },

    // ---------- imports ----------
    // parsed = result of Core.parseExport. Re-runs reconciliation inside the write transaction.
    // attachmentMap: Map itemId -> [{name, type, size}] (optional, from zip imports)
    commitImport(parsed, meta, attachmentMap) {
      return db.transaction(() => {
        const plan = Core.reconcile(parsed.items, repo.reconcileMap(), repo.rules());
        const importId = 'imp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const at = now();
        for (const rec of plan.newItems) {
          s.insertItem.run(itemToRow({ ...rec, importId, createdAt: at, updatedAt: at }, userId));
          if (attachmentMap?.has(rec.id)) repo.addAttachments(rec.id, attachmentMap.get(rec.id));
        }
        for (const e of plan.edits) {
          const cur = rowToItem(s.item.get(userId, e.existingId));
          const next = { ...cur, waText: e.parsed.body, flags: { ...cur.flags, editedWA: true }, updatedAt: at };
          s.updateItem.run(itemToRow(next, userId));
          s.addAlias.run(userId, e.parsed.id, cur.id);
          if (attachmentMap?.has(e.parsed.id)) repo.addAttachments(cur.id, attachmentMap.get(e.parsed.id));
        }
        const counts = summarize(parsed, plan);
        s.insertImport.run(userId, importId, at, meta.fileName || null, parsed.exportDate || null, parsed.format, JSON.stringify(counts), meta.storedFile || null);
        s.ensureSettings.run(userId);
        s.setLastImport.run(importId, userId);
        return { importId, counts };
      })();
    },

    // ---------- backup ----------
    exportAll() {
      return {
        categories: repo.categories(),
        rules: repo.rules(),
        settings: repo.settings(),
        imports: repo.imports(100000),
        items: s.itemsAll.all(userId).map(rowToItem),
        aliases: s.aliases.all(userId).map(a => ({ alias: a.alias, itemId: a.item_id }))
      };
    },
    restore(backup, mode) {
      if (!backup || !Array.isArray(backup.items)) throw badRequest('הקובץ הזה אינו גיבוי של פוקיפ');
      return db.transaction(() => {
        if (mode === 'replace') {
          s.wipeAliases.run(userId); s.wipeItems.run(userId); s.wipeRules.run(userId); s.wipeImports.run(userId);
        }
        if (Array.isArray(backup.categories) && backup.categories.length) {
          const cur = mode === 'replace' ? [] : repo.categories();
          const byId = new Map(cur.map(c => [c.id, c]));
          for (const c of backup.categories) byId.set(c.id, c);
          if (!byId.has('inbox')) byId.set('inbox', Core.CATEGORIES[0]);
          repo.replaceCategories([...byId.values()]);
        }
        const catIds = repo.categoryIds();
        let items = 0;
        for (const it of backup.items) {
          if (!it || typeof it.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || '') || !/^\d{2}:\d{2}$/.test(it.time || '')) continue;
          const at = now();
          const rec = { ...it, category: catIds.has(it.category) ? it.category : 'inbox', createdAt: it.createdAt || at, updatedAt: it.updatedAt || at };
          s.upsertItem.run(itemToRow(rec, userId)); items++;
        }
        for (const a of backup.aliases || []) {
          if (a && typeof a.alias === 'string' && s.item.get(userId, a.itemId)) s.addAlias.run(userId, a.alias, a.itemId);
        }
        const existingRules = mode === 'replace' ? [] : repo.rules();
        let rules = 0;
        for (const r of backup.rules || []) {
          if (existingRules.some(x => x.match === r.match && x.pattern === r.pattern)) continue;
          try { repo.addRule(r); rules++; } catch { /* skip invalid rule */ }
        }
        for (const im of backup.imports || []) {
          if (im && typeof im.id === 'string') s.upsertImport.run(userId, im.id, im.at || now(), im.fileName || null, im.exportDate || null, im.format || null, JSON.stringify(im.counts || {}), null);
        }
        if (backup.settings) {
          if (Array.isArray(backup.settings.labels)) repo.rememberLabels(cleanLabels(backup.settings.labels.slice(0, 500), 500));
          if (backup.settings.lastImportId) s.setLastImport.run(String(backup.settings.lastImportId), userId);
        }
        return { items, rules };
      })();
    }
  };
  return repo;
}

export function summarize(parsed, plan) {
  return {
    messages: parsed.stats.messages,
    system: parsed.stats.system,
    bareMedia: parsed.stats.bareMedia,
    kept: parsed.stats.kept,
    newItems: plan.newItems.length,
    present: plan.present,
    previouslyDeleted: plan.previouslyDeleted,
    edits: plan.edits.length,
    dups: plan.dups,
    possibleEdits: plan.possibleEdits,
    byCategory: plan.byCategory,
    byType: plan.byType
  };
}
