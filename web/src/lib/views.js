import { voucherState, eventState, today, matchesSearch, byNewest } from './util.js';

// Names below are Hebrew source strings; components translate them with t() when rendering.

/* View definitions: which cards a sidebar entry shows. */

export const SMART = [
  { id: 'new', name: 'חדשים מהייבוא האחרון', icon: 'star' },
  { id: 'auto', name: 'מוינו אוטומטית', icon: 'sparkle' },
  { id: 'dupes', name: 'כפילויות ועריכות', icon: 'layers' },
  { id: 'expiring', name: 'שוברים שעומדים לפוג', icon: 'clock' },
  { id: 'upcoming', name: 'אירועים קרובים', icon: 'calendar' }
];

export function inView(view, it, ctx) {
  const t = ctx.today;
  if (view.kind === 'archive') return it.status === 'archived';
  if (view.kind === 'trash') return it.status === 'trashed';
  if (it.status !== 'active') return false;
  switch (view.kind) {
    case 'all': return true;
    case 'cat': return it.category === view.id;
    case 'label': return (it.labels || []).includes(view.id);
    case 'smart':
      switch (view.id) {
        case 'new': return !!ctx.lastImportId && it.importId === ctx.lastImportId;
        case 'auto': return !!it.flags?.auto;
        case 'dupes': return !!(it.flags?.dup || it.flags?.possibleEdit || it.flags?.editedWA);
        case 'expiring': return !!it.fields?.voucher && it.type === 'voucher' && voucherState(it, t).key === 'expiring';
        case 'upcoming': return !!it.fields?.event?.date && it.fields.event.date >= t;
        default: return false;
      }
    default: return false;
  }
}

export function viewTitle(view, categories) {
  switch (view.kind) {
    case 'all': return 'כל הכרטיסים';
    case 'cat': return categories.find(c => c.id === view.id)?.name || 'קטגוריה';
    case 'label': return `#${view.id}`;
    case 'smart': return SMART.find(s => s.id === view.id)?.name || '';
    case 'archive': return 'ארכיון';
    case 'trash': return 'סל מחזור';
    default: return '';
  }
}

export const STATUS_CHIPS = [
  { id: 'undone', label: 'לא בוצעו', group: 'todo', test: it => it.type === 'todo' && !it.done },
  { id: 'done', label: 'בוצעו', group: 'todo', test: it => it.type === 'todo' && it.done },
  { id: 'unwatched', label: 'עוד לא נצפו', group: 'link', test: it => it.type === 'link' && !it.watched },
  { id: 'watched', label: 'נצפו', group: 'link', test: it => it.type === 'link' && it.watched },
  { id: 'v-active', label: 'שוברים בתוקף', group: 'voucher', test: (it, t) => it.type === 'voucher' && ['active', 'expiring'].includes(voucherState(it, t).key) },
  { id: 'v-used', label: 'שוברים שמומשו', group: 'voucher', test: it => it.type === 'voucher' && it.used },
  { id: 'v-expired', label: 'שוברים שפגו', group: 'voucher', test: (it, t) => it.type === 'voucher' && voucherState(it, t).key === 'expired' },
  { id: 'ev-upcoming', label: 'אירועים קרובים', group: 'event', test: (it, t) => it.type === 'event' && eventState(it, t).key === 'upcoming' },
  { id: 'ev-past', label: 'אירועים שעברו', group: 'event', test: (it, t) => it.type === 'event' && eventState(it, t).key === 'past' },
  { id: 'attach', label: '📎 עם קובץ מצורף', group: 'misc', test: it => !!(it.media || it.docName) }
];

export function applyFilters(list, { search, types, statuses, from, to }, t = today()) {
  const chips = STATUS_CHIPS.filter(c => statuses.has(c.id));
  return list.filter(it => {
    if (types.size && !types.has(it.type)) return false;
    if (chips.length && !chips.some(c => c.test(it, t))) return false;
    if (from && it.date < from) return false;
    if (to && it.date > to) return false;
    return matchesSearch(it, search);
  });
}

export function itemsFor(view, items, ctx) {
  return Object.values(items).filter(it => inView(view, it, ctx)).sort(byNewest);
}

export function sidebarCounts(items, categories, ctx) {
  const c = { all: 0, archive: 0, trash: 0, cat: {}, smart: {}, label: {} };
  for (const k of categories) c.cat[k.id] = 0;
  for (const s of SMART) c.smart[s.id] = 0;
  for (const it of Object.values(items)) {
    if (it.status === 'archived') { c.archive++; continue; }
    if (it.status === 'trashed') { c.trash++; continue; }
    if (it.status !== 'active') continue;
    c.all++;
    c.cat[it.category] = (c.cat[it.category] || 0) + 1;
    for (const l of it.labels || []) c.label[l] = (c.label[l] || 0) + 1;
    for (const s of SMART) if (inView({ kind: 'smart', id: s.id }, it, ctx)) c.smart[s.id]++;
  }
  return c;
}
