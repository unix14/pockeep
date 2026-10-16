import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Card from './Card.jsx';
import Masonry from './Masonry.jsx';
import Sidebar from './Sidebar.jsx';
import Editor from './Editor.jsx';
import ImportDialog from './ImportDialog.jsx';
import Settings from './Settings.jsx';
import { MoveMenu, LabelMenu, ColorMenu } from './CardMenus.jsx';
import { ExpenseSummary, VoucherSummary, EventSummary, expenseMonths } from './Summaries.jsx';
import { Popover, MenuItem, useConfirm, Spinner } from './ui.jsx';
import { useStore } from '../store.jsx';
import { itemsFor, viewTitle, applyFilters, sidebarCounts, STATUS_CHIPS } from '../lib/views.js';
import { today as todayFn, TYPE_LABELS, catColor, num, Core, voucherState, eventState } from '../lib/util.js';
import { t } from '../i18n/index.js';

const PAGE = 120;
const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

export default function Shell({ onLogout }) {
  const store = useStore();
  const { items, categories, settings, loaded, error, user, actions, pending } = store;
  const confirm = useConfirm();
  const td = todayFn();
  const ctx = useMemo(() => ({ today: td, lastImportId: settings.lastImportId }), [td, settings.lastImportId]);

  const [view, setViewRaw] = useState({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [types, setTypes] = useState(new Set());
  const [statuses, setStatuses] = useState(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [editorId, setEditorId] = useState(null);
  const [dialog, setDialog] = useState(null); // {kind:'import'} | {kind:'settings', tab}
  const [menu, setMenu] = useState(null); // {kind, anchor, ids}
  const [sheet, setSheetRaw] = useState(null); // item id (mobile long-press)
  const sheetOpenedAt = useRef(0);
  const setSheet = useCallback(id => { sheetOpenedAt.current = id ? Date.now() : 0; setSheetRaw(id); }, []);
  const [drawer, setDrawer] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [showDone, setShowDone] = useState(false);
  const [expMonth, setExpMonth] = useState(null);
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef(null);
  const lastClicked = useRef(null);

  const setView = useCallback(v => { setViewRaw(v); setSelected(new Set()); setLimit(PAGE); setDrawer(false); setShowDone(false); window.scrollTo({ top: 0 }); }, []);
  const filters = { search, types, statuses, from, to };
  const filterCount = types.size + statuses.size + (from ? 1 : 0) + (to ? 1 : 0);

  const counts = useMemo(() => sidebarCounts(items, categories, ctx), [items, categories, ctx]);
  const base = useMemo(() => itemsFor(view, items, ctx), [view, items, ctx]);
  const isExpenses = view.kind === 'cat' && view.id === 'expenses';
  const months = useMemo(() => (isExpenses ? expenseMonths(base) : []), [isExpenses, base]);
  const month = isExpenses ? (expMonth && (expMonth === 'all' || months.includes(expMonth)) ? expMonth : months[0] || 'all') : 'all';
  const visible = useMemo(() => {
    let list = applyFilters(base, filters, td);
    if (isExpenses && month !== 'all') list = list.filter(it => it.type !== 'expense' || it.date.startsWith(month));
    return list;
  }, [base, search, types, statuses, from, to, td, isExpenses, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinned = visible.filter(it => it.pinned && !(it.type === 'todo' && it.done));
  const doneTodos = visible.filter(it => it.type === 'todo' && it.done);
  const others = visible.filter(it => !it.pinned && !(it.type === 'todo' && it.done));
  const ordered = useMemo(() => [...pinned, ...others, ...(showDone ? doneTodos : [])].map(i => i.id), [pinned, others, doneTodos, showDone]);

  // keyboard: "/" focuses search, Escape clears the selection
  useEffect(() => {
    const k = e => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName) && !editorId && !dialog) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape' && !editorId && !dialog && !menu && !sheet) { setSelected(new Set()); setSelectMode(false); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [editorId, dialog, menu, sheet]);
  useEffect(() => { document.body.classList.toggle('selecting', selectMode || selected.size > 0); document.body.classList.toggle('has-bulk', selected.size > 0); }, [selectMode, selected]);
  useEffect(() => { document.body.classList.toggle('drawer', drawer); }, [drawer]);

  /* ---------- card callbacks (stable for memoised cards) ---------- */
  const orderedRef = useRef(ordered); orderedRef.current = ordered;
  const onSelect = useCallback((id, e) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (e?.shiftKey && lastClicked.current && orderedRef.current.includes(lastClicked.current)) {
        const a = orderedRef.current.indexOf(lastClicked.current), b = orderedRef.current.indexOf(id);
        for (const x of orderedRef.current.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      } else if (next.has(id)) next.delete(id); else next.add(id);
      lastClicked.current = id;
      return next;
    });
  }, []);
  const onOpen = useCallback(id => setEditorId(id), []);
  const onMenu = useCallback((kind, anchor, ids) => setMenu({ kind, anchor, ids }), []);
  const onLongPress = useCallback(it => setSheet(it.id), [setSheet]);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const onDragStart = useCallback((e, id) => {
    const ids = selectedRef.current.has(id) ? [...selectedRef.current] : [id];
    e.dataTransfer.setData('text/plain', ids.join(','));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }, []);
  const onDragEnd = useCallback(() => setDragging(false), []);

  const dropOn = (ids, target) => {
    const its = ids.map(id => items[id]).filter(Boolean);
    if (target.kind === 'cat') actions.patch(its.filter(i => i.category !== target.id || i.status !== 'active').map(i => ({ id: i.id, patch: { category: target.id, ...(i.status !== 'active' ? { status: 'active' } : {}) } })), { message: its.length === 1 ? t('הועבר אל „{name}”', { name: t(target.name) }) : t('{n} כרטיסים הועברו אל „{name}”', { n: its.length, name: t(target.name) }) });
    if (target.kind === 'label') actions.patch(its.filter(i => !(i.labels || []).includes(target.id)).map(i => ({ id: i.id, patch: { labels: [...(i.labels || []), target.id] } })), { message: t('התווית #{name} נוספה', { name: target.id }) });
    if (target.kind === 'status') actions.patch(its.map(i => ({ id: i.id, patch: { status: target.id } })), { message: target.id === 'archived' ? t('הועבר לארכיון') : t('הועבר לסל המחזור') });
    setSelected(new Set());
  };

  /* ---------- bulk ---------- */
  const selIds = [...selected].filter(id => items[id]);
  const bulk = (patchFn, message) => { actions.patch(selIds.map(id => ({ id, patch: patchFn(items[id]) })), { message }); setSelected(new Set()); setSelectMode(false); };

  /* ---------- cleanup ---------- */
  const cleanupSets = useMemo(() => {
    const active = Object.values(items).filter(i => i.status === 'active' && !i.locked);
    const promosOlder = days => { const cut = new Date(); cut.setDate(cut.getDate() - days); const c = Core.ymd(cut); return active.filter(i => i.category === 'promos' && i.date < c); };
    return {
      events: active.filter(i => i.type === 'event' && eventState(i, td).key === 'past'),
      watched: active.filter(i => i.type === 'link' && i.watched),
      vouchers: active.filter(i => i.type === 'voucher' && voucherState(i, td).key === 'expired'),
      done: active.filter(i => i.type === 'todo' && i.done),
      promos30: promosOlder(30), promos90: promosOlder(90), promos180: promosOlder(180)
    };
  }, [items, td]);
  const runCleanup = async (key, label) => {
    setMenu(null);
    const list = cleanupSets[key];
    if (!list.length) return;
    if (!(await confirm({ title: label, body: t('{n} כרטיסים יועברו לארכיון. אפשר לבטל מיד אחר כך, וכרטיסים נעולים לא ייגעו.', { n: num(list.length) }), confirm: t('העברה לארכיון') }))) return;
    actions.patch(list.map(i => ({ id: i.id, patch: { status: 'archived' } })), { message: t('{n} כרטיסים הועברו לארכיון', { n: num(list.length) }) });
  };
  const emptyTrash = async () => {
    const n = counts.trash;
    if (!n) return;
    if (await confirm({ title: t('לרוקן את סל המחזור?'), body: t('{n} כרטיסים יימחקו לצמיתות. אי אפשר לבטל את זה.\nהודעות שנמחקו לא יחזרו גם בייבוא הבא.', { n: num(n) }), confirm: t('מחיקה לצמיתות'), danger: true })) actions.emptyTrash();
  };

  const toggleSet = (setter, id) => setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearFilters = () => { setTypes(new Set()); setStatuses(new Set()); setFrom(''); setTo(''); };

  /* ---------- render ---------- */
  const showCategory = view.kind !== 'cat';
  const renderCard = it => (
    <Card key={it.id} it={it} category={categories.find(c => c.id === it.category)} showCategory={showCategory}
      selected={selected.has(it.id)} selecting={selectMode || selected.size > 0} isNew={!!settings.lastImportId && it.importId === settings.lastImportId}
      today={td} onOpen={onOpen} onSelect={onSelect} onMenu={onMenu} onLongPress={onLongPress} onDragStart={onDragStart} onDragEnd={onDragEnd} />
  );
  const title = t(viewTitle(view, categories));
  const editorItem = editorId ? items[editorId] : null;
  const sheetItem = sheet ? items[sheet] : null;
  const anyItems = Object.keys(items).length > 0;

  let pinnedShown = pinned, othersShown = others, more = 0;
  if (pinned.length + others.length > limit) {
    pinnedShown = pinned.slice(0, limit);
    othersShown = others.slice(0, Math.max(0, limit - pinnedShown.length));
    more = pinned.length + others.length - limit;
  }

  return (
    <>
      <header className="top">
        <button className="iconbtn only-mobile" onClick={() => setDrawer(true)} aria-label={t('פתיחת התפריט')}><Icon name="menu" /></button>
        <div className="brand">
          <div className="brand-mark"><Icon name="message" /></div>
          <div className="brand-name">{t('פוקיפ')}<small>{user.username}</small></div>
        </div>
        <label className="searchbox">
          <Icon name="search" className="text-fg3" />
          <span className="sr">{t('חיפוש')}</span>
          <input ref={searchRef} id="search" type="search" placeholder={t('חיפוש')} value={search} onChange={e => { setSearch(e.target.value); setLimit(PAGE); }} dir="auto" />
          {search && <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => setSearch('')} aria-label={t('ניקוי החיפוש')}><Icon name="close" size="sm" /></button>}
        </label>
        <div className="top-actions">
          <span className="save-state" aria-live="polite">{pending ? t('שומרים…') : ''}</span>
          <button className="iconbtn" aria-pressed={showFilters} onClick={() => setShowFilters(v => !v)} title={t('סינון')} aria-label={t('סינון')}>
            <Icon name="filter" />{filterCount > 0 && <span className="dotbadge" />}
          </button>
          <button className="iconbtn" aria-pressed={selectMode} onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }} title={t('בחירה מרובה')} aria-label={t('בחירה מרובה')}><Icon name="select" /></button>
          <button className="btn primary hide-mobile" onClick={() => setDialog({ kind: 'import' })}><Icon name="upload" size="sm" />{t('ייבוא')}</button>
          <button className="iconbtn only-mobile" onClick={() => setDialog({ kind: 'import' })} aria-label={t('ייבוא')}><Icon name="upload" /></button>
          <button className="iconbtn" onClick={e => setMenu({ kind: 'user', anchor: e.currentTarget })} aria-label={t('חשבון והגדרות')} title={t('חשבון והגדרות')}><Icon name="settings" /></button>
        </div>
      </header>

      <div className="shell">
        <Sidebar view={view} setView={setView} counts={counts} dragging={dragging} onDropIds={dropOn} openSettings={tab => setDialog({ kind: 'settings', tab })} />
        <div className="scrim" onClick={() => setDrawer(false)} />

        <main className="main" id="main">
          {!loaded && !error && <div className="empty"><Spinner /></div>}
          {error && <div className="empty"><div className="err">{error}</div><button className="btn" onClick={actions.reload}>{t('ניסיון נוסף')}</button></div>}

          {loaded && !anyItems && (
            <div className="welcome">
              <h2>{t('שלום {name}! בואו נסדר את ההודעות ששלחת לעצמך.', { name: user.username })}</h2>
              <p>{t('מייצאים בוואטסאפ את הצ׳אט עם עצמך (בלי מדיה), ומעלים כאן את הקובץ. כל הודעה הופכת לכרטיס וממוינת אוטומטית: הוצאות, שוברים, קישורים לצפייה, משימות ועוד.')}</p>
              <div className="steps">
                <div className="step"><b>{t('1. ייצוא מוואטסאפ')}</b>{t('בצ׳אט: ⋮ ← עוד ← ייצוא צ׳אט ← ללא מדיה.')}</div>
                <div className="step"><b>{t('2. ייבוא לכאן')}</b>{t('תוצג תצוגה מקדימה של מה שחדש. שום דבר לא נשמר לפני האישור.')}</div>
                <div className="step"><b>{t('3. סידור')}</b>{t('גוררים כרטיסים לקטגוריות, מוסיפים תוויות, נועלים מה שחשוב.')}</div>
              </div>
              <div><button className="btn primary" onClick={() => setDialog({ kind: 'import' })}><Icon name="upload" size="sm" />{t('ייבוא קובץ ראשון')}</button></div>
              <p className="hint">{t('בייבוא הבא מעלים את הייצוא המעודכן כולו. הודעות שכבר קיימות מזוהות, והסידור שלך נשמר.')}</p>
            </div>
          )}

          {loaded && anyItems && (<>
            <div className="viewhead">
              <div className="grow">
                <h1>{title}</h1>
                <div className="sub">{search ? t('{n} כרטיסים שתואמים ל„{q}”', { n: num(visible.length), q: search }) : t('{n} כרטיסים', { n: num(visible.length) })}</div>
              </div>
              <span className="spacer" />
              {view.kind === 'trash' ? (
                <button className="btn danger" disabled={!counts.trash} onClick={emptyTrash}><Icon name="trash" size="sm" />{t('ריקון סל המחזור')}</button>
              ) : (
                <button className="btn" onClick={e => setMenu({ kind: 'cleanup', anchor: e.currentTarget })}><Icon name="broom" size="sm" />{t('ניקוי')}</button>
              )}
            </div>

            {showFilters && (
              <div className="chips" role="group" aria-label={t('סינון')}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <button key={k} className="chip" aria-pressed={types.has(k)} onClick={() => toggleSet(setTypes, k)}>{t(v)}</button>)}
                <span className="sep" />
                {STATUS_CHIPS.map(c => <button key={c.id} className="chip" aria-pressed={statuses.has(c.id)} onClick={() => toggleSet(setStatuses, c.id)}>{t(c.label)}</button>)}
                <span className="sep" />
                <label className="datef">{t('מתאריך')} <input id="filter-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
                <label className="datef">{t('עד')} <input id="filter-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
                {filterCount > 0 && <button className="chip" onClick={clearFilters}><Icon name="close" size="xs" />{t('ניקוי הסינון')}</button>}
              </div>
            )}

            {isExpenses && <ExpenseSummary items={base} month={month} onMonth={setExpMonth} />}
            {view.kind === 'cat' && view.id === 'vouchers' && <VoucherSummary items={base} today={td} />}
            {view.kind === 'cat' && view.id === 'events' && <EventSummary items={base} today={td} />}
            {view.kind === 'smart' && view.id === 'auto' && visible.length > 0 && (
              <div className="banner">
                <Icon name="sparkle" size="sm" />
                <span>{t('הכרטיסים האלה מוינו אוטומטית. כל עריכה או העברה מסמנת אותם כנבדקו.')}</span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => actions.patch(visible.map(i => ({ id: i.id, patch: { flags: { auto: false } } })), { message: t('{n} כרטיסים סומנו כנבדקו', { n: num(visible.length) }) })}>{t('סימון הכול כנבדק')}</button>
              </div>
            )}

            {visible.length === 0 && (
              <div className="empty">
                <div className="art"><Icon name={view.kind === 'trash' ? 'trash' : view.kind === 'archive' ? 'archive' : 'search'} /></div>
                <h2>{search || filterCount ? t('לא נמצאו כרטיסים') : view.kind === 'trash' ? t('סל המחזור ריק') : view.kind === 'archive' ? t('הארכיון ריק') : t('אין כאן כרטיסים')}</h2>
                <p>{search || filterCount ? t('אפשר לנסות מילה אחרת או לנקות את הסינון.') : view.kind === 'cat' ? t('אפשר לגרור לכאן כרטיסים מכל תצוגה אחרת.') : ''}</p>
                {(search || filterCount > 0) && <div className="row"><button className="btn" onClick={() => { setSearch(''); clearFilters(); }}>{t('ניקוי החיפוש והסינון')}</button></div>}
              </div>
            )}

            {pinnedShown.length > 0 && <><div className="section-label">{t('מוצמדים')}</div><Masonry items={pinnedShown} render={renderCard} /></>}
            {othersShown.length > 0 && <>{pinnedShown.length > 0 && <div className="section-label">{t('אחרים')}</div>}<Masonry items={othersShown} render={renderCard} /></>}
            {more > 0 && <div className="more"><button className="btn" onClick={() => setLimit(l => l + PAGE)}>{t('הצגת עוד {n} (נשארו {left})', { n: num(Math.min(more, PAGE)), left: num(more) })}</button></div>}
            {doneTodos.length > 0 && (<>
              <div className="section-label">
                <button onClick={() => setShowDone(v => !v)} aria-expanded={showDone}><Icon name="chevDown" size="xs" className={showDone ? '' : 'rotate-90'} />{t('משימות שבוצעו')} ({num(doneTodos.length)})</button>
              </div>
              {showDone && <Masonry items={doneTodos} render={renderCard} />}
            </>)}
          </>)}
        </main>
      </div>

      {selIds.length > 0 && (
        <div className="bulk" role="toolbar" aria-label={t('פעולות על הכרטיסים שנבחרו')}>
          <span className="count">{t('נבחרו {n}', { n: num(selIds.length) })}</span>
          {view.kind === 'trash' ? (
            <button className="iconbtn" onClick={() => bulk(() => ({ status: 'active' }), t('הכרטיסים שוחזרו'))} title={t('שחזור')} aria-label={t('שחזור')}><Icon name="restore" /></button>
          ) : (<>
            <button className="iconbtn" onClick={e => setMenu({ kind: 'move', anchor: e.currentTarget, ids: selIds, bulk: true })} title={t('העברה לקטגוריה')} aria-label={t('העברה לקטגוריה')}><Icon name="move" /></button>
            <button className="iconbtn" onClick={e => setMenu({ kind: 'label', anchor: e.currentTarget, ids: selIds })} title={t('תוויות')} aria-label={t('תוויות')}><Icon name="tag" /></button>
            <button className="iconbtn" onClick={() => bulk(it => ({ pinned: !selIds.every(id => items[id].pinned) }), t('עודכן'))} title={t('הצמדה')} aria-label={t('הצמדה')}><Icon name="pin" /></button>
            <button className="iconbtn" onClick={() => bulk(() => ({ locked: !selIds.every(id => items[id].locked) }), t('הנעילה עודכנה'))} title={t('נעילה')} aria-label={t('נעילה')}><Icon name="lock" /></button>
            <button className="iconbtn" onClick={() => bulk(it => (it.type === 'link' ? { watched: true } : it.type === 'voucher' ? { used: true } : { done: true, ...(it.type !== 'todo' ? { type: 'todo' } : {}) }), t('סומנו כבוצעו'))} title={t('סימון כבוצע / נצפה')} aria-label={t('סימון כבוצע')}><Icon name="checkCircle" /></button>
            <button className="iconbtn" onClick={() => bulk(() => ({ status: view.kind === 'archive' ? 'active' : 'archived' }), view.kind === 'archive' ? t('הוצאו מהארכיון') : t('הועברו לארכיון'))} title={view.kind === 'archive' ? t('הוצאה מהארכיון') : t('ארכיון')} aria-label={t('ארכיון')}><Icon name={view.kind === 'archive' ? 'unarchive' : 'archive'} /></button>
            <button className="iconbtn" onClick={() => bulk(() => ({ status: 'trashed' }), t('הועברו לסל המחזור'))} title={t('מחיקה')} aria-label={t('מחיקה')}><Icon name="trash" /></button>
          </>)}
          <button className="iconbtn" onClick={() => setSelected(new Set(ordered))} title={t('בחירת כל המוצגים')} aria-label={t('בחירת הכול')}><Icon name="select" /></button>
          <button className="iconbtn" onClick={() => { setSelected(new Set()); setSelectMode(false); }} title={t('ביטול הבחירה')} aria-label={t('ביטול הבחירה')}><Icon name="close" /></button>
        </div>
      )}

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={menu.kind === 'color' ? 0 : 240}>
          {menu.kind === 'move' && <MoveMenu ids={menu.ids} onDone={() => { setMenu(null); if (menu.bulk) { setSelected(new Set()); setSelectMode(false); } }} />}
          {menu.kind === 'label' && <LabelMenu ids={menu.ids} onDone={() => setMenu(null)} />}
          {menu.kind === 'color' && <ColorMenu ids={menu.ids} onDone={() => setMenu(null)} />}
          {menu.kind === 'cleanup' && (<>
            <div className="mh">{t('העברה לארכיון בלחיצה')}</div>
            <MenuItem icon="calendar" disabled={!cleanupSets.events.length} onClick={() => runCleanup('events', t('אירועים שעברו'))}>{t('אירועים שעברו')} ({num(cleanupSets.events.length)})</MenuItem>
            <MenuItem icon="play" disabled={!cleanupSets.watched.length} onClick={() => runCleanup('watched', t('קישורים שנצפו'))}>{t('קישורים שנצפו')} ({num(cleanupSets.watched.length)})</MenuItem>
            <MenuItem icon="ticket" disabled={!cleanupSets.vouchers.length} onClick={() => runCleanup('vouchers', t('שוברים שפג תוקפם'))}>{t('שוברים שפג תוקפם')} ({num(cleanupSets.vouchers.length)})</MenuItem>
            <MenuItem icon="check" disabled={!cleanupSets.done.length} onClick={() => runCleanup('done', t('משימות שבוצעו'))}>{t('משימות שבוצעו')} ({num(cleanupSets.done.length)})</MenuItem>
            <div className="msep" />
            <MenuItem icon="megaphone" disabled={!cleanupSets.promos30.length} onClick={() => runCleanup('promos30', t('פרסומות מלפני יותר מחודש'))}>{t('פרסומות מלפני חודש')} ({num(cleanupSets.promos30.length)})</MenuItem>
            <MenuItem icon="megaphone" disabled={!cleanupSets.promos90.length} onClick={() => runCleanup('promos90', t('פרסומות מלפני יותר מ־3 חודשים'))}>{t('פרסומות מלפני 3 חודשים')} ({num(cleanupSets.promos90.length)})</MenuItem>
            <MenuItem icon="megaphone" disabled={!cleanupSets.promos180.length} onClick={() => runCleanup('promos180', t('פרסומות מלפני יותר מחצי שנה'))}>{t('פרסומות מלפני חצי שנה')} ({num(cleanupSets.promos180.length)})</MenuItem>
          </>)}
          {menu.kind === 'user' && (<>
            <div className="mh" style={{ textTransform: 'none' }}>{t('מחובר/ת בתור')} <b className="ltr">{user.username}</b></div>
            <MenuItem icon="settings" onClick={() => { setMenu(null); setDialog({ kind: 'settings', tab: 'rules' }); }}>{t('הגדרות וכללי מיון')}</MenuItem>
            <MenuItem icon="download" onClick={() => { setMenu(null); setDialog({ kind: 'settings', tab: 'backup' }); }}>{t('גיבוי ושחזור')}</MenuItem>
            <MenuItem icon="key" onClick={() => { setMenu(null); setDialog({ kind: 'settings', tab: 'account' }); }}>{t('החשבון שלי')}</MenuItem>
            {user.role === 'admin' && <MenuItem icon="users" onClick={() => { setMenu(null); setDialog({ kind: 'settings', tab: 'users' }); }}>{t('ניהול משתמשים')}</MenuItem>}
            <div className="msep" />
            <MenuItem icon="logout" onClick={() => { setMenu(null); onLogout(); }}>{t('יציאה')}</MenuItem>
          </>)}
        </Popover>
      )}

      {sheetItem && (<>
        <div className="overlay" style={{ background: 'var(--overlay)' }} onClick={() => { if (Date.now() - sheetOpenedAt.current > 500) setSheet(null); }} />
        <div className="sheet" role="dialog" aria-label={t('פעולות לכרטיס')}>
          <div className="grab" />
          <div className="row">
            <button className="btn sm" onClick={() => { actions.patchOne(sheetItem.id, { pinned: !sheetItem.pinned }); setSheet(null); }}><Icon name="pin" size="xs" />{sheetItem.pinned ? t('ביטול הצמדה') : t('הצמדה')}</button>
            <button className="btn sm" onClick={() => { actions.patchOne(sheetItem.id, { locked: !sheetItem.locked }); setSheet(null); }}><Icon name="lock" size="xs" />{sheetItem.locked ? t('ביטול נעילה') : t('נעילה')}</button>
            <button className="btn sm" onClick={() => { setSelectMode(true); onSelect(sheetItem.id); setSheet(null); }}><Icon name="select" size="xs" />{t('בחירה')}</button>
            {sheetItem.status === 'trashed'
              ? <button className="btn sm" onClick={() => { actions.patchOne(sheetItem.id, { status: 'active' }, { message: t('שוחזר') }); setSheet(null); }}><Icon name="restore" size="xs" />{t('שחזור')}</button>
              : <>
                <button className="btn sm" disabled={sheetItem.locked} onClick={() => { actions.patchOne(sheetItem.id, { status: sheetItem.status === 'archived' ? 'active' : 'archived' }, { message: sheetItem.status === 'archived' ? t('הוצא מהארכיון') : t('הועבר לארכיון') }); setSheet(null); }}><Icon name="archive" size="xs" />{sheetItem.status === 'archived' ? t('הוצאה מהארכיון') : t('ארכיון')}</button>
                <button className="btn sm danger" disabled={sheetItem.locked} onClick={() => { actions.patchOne(sheetItem.id, { status: 'trashed' }, { message: t('הועבר לסל המחזור') }); setSheet(null); }}><Icon name="trash" size="xs" />{t('מחיקה')}</button>
              </>}
          </div>
          <h3>{t('העברה לקטגוריה')}</h3>
          {categories.map(c => (
            <MenuItem key={c.id} dot={catColor(c.color)} checked={sheetItem.category === c.id} onClick={() => { actions.patchOne(sheetItem.id, { category: c.id }, { message: t('הועבר אל „{name}”', { name: t(c.name) }) }); setSheet(null); }}>{t(c.name)}</MenuItem>
          ))}
        </div>
      </>)}

      {editorItem && <Editor key={editorItem.id} item={editorItem} onClose={() => setEditorId(null)} />}
      {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onImported={() => { setDialog(null); setView({ kind: 'smart', id: 'new' }); }} />}
      {dialog?.kind === 'settings' && <Settings tab={dialog.tab} onClose={() => setDialog(null)} onLogout={onLogout} />}
    </>
  );
}
