import Core from '@shared/core.js';
import { t, locale } from '../i18n/index.js';

export { Core };

export const today = () => Core.ymd(new Date());
const MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const MONTHS_LONG = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const WEEKDAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];
export const monthShort = i => t(MONTHS_SHORT[i]);
export const weekday = i => t(WEEKDAYS[i]);

// Israeli date format: DD/MM/YYYY · HH:mm
export function fmtDate(date, time) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}${time ? ' · ' + time : ''}`;
}
export const fmtDay = date => fmtDate(date);
export function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${t(MONTHS_LONG[+m - 1])} ${y}`;
}
export function daysBetween(a, b) { return Math.round((Core.parseYmd(b) - Core.parseYmd(a)) / 864e5); }

export function money(n, cur = 'ILS') {
  const s = Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(+n) ? 0 : 2 });
  return (cur === 'USD' ? '$' : '₪') + s;
}

export const displayText = it => (it.text ?? it.waText ?? it.body ?? '');
export const sortKey = it => `${it.date}T${it.time}#${String(it.seq || 0).padStart(5, '0')}`;
export const byNewest = (a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0);

export function voucherState(it, td = today()) {
  const v = it.fields?.voucher || {};
  if (it.used) return { key: 'used', label: t('מומש'), tone: '' };
  if (v.expiry && v.expiry < td) return { key: 'expired', label: t('פג תוקף'), tone: 'bad' };
  if (v.expiry) {
    const d = daysBetween(td, v.expiry);
    if (d <= 30) return { key: 'expiring', label: d === 0 ? t('פג היום') : d === 1 ? t('פג מחר') : t('פג בעוד {n} ימים', { n: d }), tone: 'warn', days: d };
  }
  return { key: 'active', label: t('בתוקף'), tone: 'good' };
}
export function eventState(it, td = today()) {
  const e = it.fields?.event || {};
  if (!e.date) return { key: 'undated', label: t('בלי תאריך') };
  if (e.date < td) return { key: 'past', label: t('עבר') };
  const d = daysBetween(td, e.date);
  return { key: 'upcoming', label: d === 0 ? t('היום') : d === 1 ? t('מחר') : d === 2 ? t('מחרתיים') : t('בעוד {n} ימים', { n: d }), days: d };
}

// Search index per item object (items are replaced, never mutated, so a WeakMap is safe).
const idx = new WeakMap();
export function searchText(it) {
  let s = idx.get(it);
  if (s === undefined) {
    const f = it.fields || {};
    s = Core.searchNorm([it.title, displayText(it), it.raw, it.note, (it.labels || []).join(' '), it.docName,
      f.voucher?.code, f.voucher?.issuer, f.link?.domain, f.expense?.desc].filter(Boolean).join(' \n '));
    idx.set(it, s);
  }
  return s;
}
export function matchesSearch(it, q) {
  if (!q) return true;
  const hay = searchText(it);
  return Core.searchNorm(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

// Split text into strings and link descriptors for rendering.
const URL_SPLIT = /((?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]])/gi;
export function splitLinks(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(URL_SPLIT)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const href = Core.cleanUrl(m[0]);
    parts.push({ href: /^https?:/i.test(href) ? href : 'https://' + href, label: shortUrl(href) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
export function shortUrl(u) {
  try {
    const x = new URL(/^www\./i.test(u) ? 'https://' + u : u);
    let path = decodeURIComponent(x.pathname);
    if (path.length > 28) path = path.slice(0, 26) + '…';
    return x.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
  } catch { return u; }
}

export const catColor = name => `var(--c-${name || 'slate'})`;
export const CAT_COLORS = ['slate', 'teal', 'green', 'amber', 'rose', 'indigo', 'sky', 'violet', 'brown', 'orange', 'pink', 'lime', 'cyan', 'red'];
export const CARD_COLORS = ['coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay'];
export const TYPE_LABELS = { note: 'פתק', todo: 'משימה', expense: 'הוצאה', voucher: 'שובר', link: 'קישור', event: 'אירוע' };
export const PLATFORM_LABEL = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', spotify: 'Spotify', github: 'GitHub', linkedin: 'LinkedIn', ai: 'שיחת AI', lovable: 'Lovable', web: 'אתר' };

// Merge semantics identical to the server (used for optimistic updates).
export function applyLocal(item, patch) {
  const next = { ...item };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'fields') {
      const f = { ...(item.fields || {}) };
      for (const [fk, fv] of Object.entries(v)) { if (fv === null) delete f[fk]; else f[fk] = { ...(f[fk] || {}), ...fv }; }
      next.fields = f;
    } else if (k === 'flags') next.flags = { ...(item.flags || {}), ...v };
    else next[k] = v;
  }
  if (!(patch.flags && 'auto' in patch.flags)) next.flags = { ...(next.flags || {}), auto: false };
  return next;
}

// Inverse patch: restores what `patch` would change on `item`.
export function inversePatch(item, patch) {
  const inv = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'fields') {
      inv.fields = {};
      for (const fk of Object.keys(v)) inv.fields[fk] = item.fields?.[fk] ?? null;
    } else if (k === 'flags') {
      inv.flags = {};
      for (const fk of Object.keys(v)) inv.flags[fk] = !!item.flags?.[fk];
    } else inv[k] = item[k] ?? (k === 'labels' ? [] : k === 'title' || k === 'note' ? '' : null);
  }
  if (!('flags' in patch) || !('auto' in (patch.flags || {}))) inv.flags = { ...(inv.flags || {}), auto: !!item.flags?.auto };
  return inv;
}

export const num = n => Number(n || 0).toLocaleString(locale());

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t('לא הצלחנו לקרוא את הקובץ')));
    r.readAsText(file, 'utf-8');
  });
}
