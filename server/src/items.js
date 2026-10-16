import { badRequest, conflict } from './errors.js';

/* Row <-> API object mapping and patch validation for cards. */

const J = (s, d) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };

export const TYPES = ['note', 'expense', 'voucher', 'link', 'todo', 'event'];
export const COLORS = ['coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay'];
export const STATUSES_USER = ['active', 'archived', 'trashed'];
const FLAG_KEYS = ['auto', 'dup', 'possibleEdit', 'editedWA'];
const FIELD_KEYS = ['expense', 'voucher', 'event', 'link'];

export function rowToItem(r) {
  return {
    id: r.id, date: r.date, time: r.time, seq: r.seq, sender: r.sender,
    raw: r.raw, body: r.body, waText: r.wa_text, media: r.media, docName: r.doc_name, forwarded: !!r.forwarded,
    title: r.title, text: r.text, note: r.note,
    category: r.category_id, type: r.type,
    labels: J(r.labels, []), fields: J(r.fields, {}), flags: J(r.flags, {}),
    pinned: !!r.pinned, locked: !!r.locked, color: r.color,
    done: !!r.done, watched: !!r.watched, used: !!r.used,
    status: r.status, possibleEditOf: J(r.possible_edit_of, null), dupOf: r.dup_of,
    importId: r.import_id, createdAt: r.created_at, updatedAt: r.updated_at, trashedAt: r.trashed_at
  };
}

export function itemToRow(it, userId) {
  return {
    user_id: userId, id: it.id, date: it.date, time: it.time, seq: it.seq | 0, sender: it.sender ?? null,
    raw: it.raw ?? '', body: it.body ?? '', wa_text: it.waText ?? null, media: it.media ?? null, doc_name: it.docName ?? null,
    forwarded: it.forwarded ? 1 : 0, title: it.title ?? '', text: it.text ?? null, note: it.note ?? '',
    category_id: it.category || 'inbox', type: TYPES.includes(it.type) ? it.type : 'note',
    labels: JSON.stringify(it.labels || []), fields: JSON.stringify(it.fields || {}), flags: JSON.stringify(it.flags || {}),
    pinned: it.pinned ? 1 : 0, locked: it.locked ? 1 : 0, color: COLORS.includes(it.color) ? it.color : null,
    done: it.done ? 1 : 0, watched: it.watched ? 1 : 0, used: it.used ? 1 : 0,
    status: ['active', 'archived', 'trashed', 'purged'].includes(it.status) ? it.status : 'active',
    possible_edit_of: it.possibleEditOf ? JSON.stringify(it.possibleEditOf) : null, dup_of: it.dupOf ?? null,
    import_id: it.importId ?? null, created_at: it.createdAt, updated_at: it.updatedAt, trashed_at: it.trashedAt ?? null
  };
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max, name) => {
  if (typeof v !== 'string') throw badRequest(`השדה ${name} חייב להיות טקסט`);
  if (v.length > max) throw badRequest(`השדה ${name} ארוך מדי (עד ${max} תווים)`);
  return v;
};

export function cleanLabels(arr, max = 30) {
  if (!Array.isArray(arr)) throw badRequest('תוויות חייבות להיות רשימה');
  const out = [];
  for (const l of arr) {
    if (typeof l !== 'string') continue;
    const t = l.trim().replace(/^#/, '').slice(0, 60);
    if (t && !out.includes(t)) out.push(t);
  }
  if (out.length > max) throw badRequest(`אפשר עד ${max} תוויות כאן`);
  return out;
}

// Validates a client patch. Returns a normalised patch containing only known keys.
export function validatePatch(p, { categoryIds }) {
  if (!isObj(p)) throw badRequest('השינוי לא תקין');
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case 'title': out.title = str(v, 500, 'title'); break;
      case 'text': out.text = v === null ? null : str(v, 200000, 'text'); break;
      case 'note': out.note = str(v, 20000, 'note'); break;
      case 'category':
        if (!categoryIds.has(v)) throw badRequest('הקטגוריה לא קיימת');
        out.category = v; break;
      case 'type':
        if (!TYPES.includes(v)) throw badRequest('סוג כרטיס לא מוכר');
        out.type = v; break;
      case 'labels': out.labels = cleanLabels(v); break;
      case 'color':
        if (v !== null && !COLORS.includes(v)) throw badRequest('צבע לא מוכר');
        out.color = v; break;
      case 'pinned': case 'locked': case 'done': case 'watched': case 'used':
        if (typeof v !== 'boolean') throw badRequest(`הערך של ${k} לא תקין`);
        out[k] = v; break;
      case 'status':
        if (!STATUSES_USER.includes(v)) throw badRequest('סטטוס לא מוכר');
        out.status = v; break;
      case 'flags':
        if (!isObj(v)) throw badRequest('הסימונים לא תקינים');
        out.flags = {};
        for (const [fk, fv] of Object.entries(v)) if (FLAG_KEYS.includes(fk)) out.flags[fk] = !!fv;
        break;
      case 'fields':
        if (!isObj(v)) throw badRequest('השדות לא תקינים');
        out.fields = {};
        for (const [fk, fv] of Object.entries(v)) {
          if (!FIELD_KEYS.includes(fk)) continue;
          if (fv !== null && !isObj(fv)) throw badRequest(`השדה ${fk} לא תקין`);
          if (fv && JSON.stringify(fv).length > 20000) throw badRequest(`השדה ${fk} גדול מדי`);
          out.fields[fk] = fv;
        }
        break;
      case 'possibleEditOf': out.possibleEditOf = v === null ? null : (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 10) : null); break;
      default: break; // unknown keys are ignored (ids, raw text and dates are immutable)
    }
  }
  return out;
}

function mergeFields(cur, patch) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = { ...(isObj(cur[k]) ? cur[k] : {}), ...v };
  }
  return next;
}

// Applies a validated patch to an item; enforces the lock rule.
export function applyPatch(item, patch, { touch = true, now }) {
  if (item.status === 'purged') throw conflict('הכרטיס הזה נמחק לצמיתות', 'purged');
  const next = { ...item };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'fields') next.fields = mergeFields(item.fields || {}, v);
    else if (k === 'flags') next.flags = { ...(item.flags || {}), ...v };
    else next[k] = v;
  }
  if (touch && !(patch.flags && 'auto' in patch.flags)) next.flags = { ...next.flags, auto: false };
  if (patch.status && patch.status !== item.status) {
    if (next.locked && patch.status !== 'active') throw conflict('הכרטיס נעול. יש לבטל את הנעילה קודם.', 'locked');
    next.trashedAt = patch.status === 'trashed' ? now : null;
  }
  next.updatedAt = now;
  return next;
}
