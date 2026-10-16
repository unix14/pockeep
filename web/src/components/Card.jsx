import { memo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useStore } from '../store.jsx';
import { useToast } from './ui.jsx';
import { catColor, displayText, fmtDate, money, voucherState, eventState, splitLinks, monthShort, weekday, PLATFORM_LABEL, Core } from '../lib/util.js';
import { t } from '../i18n/index.js';

export function LinkedText({ text }) {
  return splitLinks(text).map((p, i) => typeof p === 'string'
    ? <span key={i}>{p}</span>
    : <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} dir="ltr">{p.label}</a>);
}

function PlatformBadge({ platform }) {
  const short = { tiktok: 'TT', instagram: 'IG', youtube: '▶', spotify: '♫', github: 'GH', linkedin: 'in', ai: 'AI', lovable: 'L', web: '' }[platform];
  return <span className={`plat ${platform}`}>{short || <Icon name="external" size="xs" />}</span>;
}

export function LinkChip({ link, onOpened }) {
  if (!link) return null;
  return (
    <a className="c-link" href={link.url} target="_blank" rel="noopener noreferrer" onClick={e => { e.stopPropagation(); onOpened?.(); }}>
      <PlatformBadge platform={link.platform} />
      <span className="lk">
        <b>{link.platform === 'web' ? link.domain : t(PLATFORM_LABEL[link.platform])}</b>
        <span>{link.url.replace(/^https?:\/\//, '')}</span>
      </span>
    </a>
  );
}

function CopyCode({ code }) {
  const toast = useToast();
  const copy = async e => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(code); toast('הקוד הועתק'); }
    catch { toast('לא הצלחנו להעתיק. אפשר לסמן את הקוד ולהעתיק ידנית.'); }
  };
  return (
    <div className="c-code" onClick={e => e.stopPropagation()}>
      <code>{code}</code>
      <button className="btn sm" onClick={copy}><Icon name="copy" size="xs" />{t('העתקה')}</button>
    </div>
  );
}

// Text without the link (links are shown as a chip) for link-type cards.
const withoutUrls = td => td.replace(/(?:https?:\/\/|www\.)\S+/gi, '').trim();

function Body({ it, td }) {
  const { actions } = useStore();
  const f = it.fields || {};
  const text = displayText(it);
  const long = text.length > 420 || text.split('\n').length > 11;
  const TextBlock = ({ value = text, clamp = true }) => value ? (
    <div className={`c-text ${clamp && long ? 'clamped' : ''}`} dir="auto"><LinkedText text={value} /></div>
  ) : null;

  switch (it.type) {
    case 'expense': {
      const e = f.expense || {};
      return (<>
        <div className="c-amount"><bdi>{money(e.amount, e.currency)}</bdi>{e.currency === 'USD' && <small>{t('דולר')}</small>}</div>
        <div className="c-desc" dir="auto">{e.desc || text}</div>
      </>);
    }
    case 'voucher': {
      const v = f.voucher || {};
      const st = voucherState(it, td);
      return (<>
        <div className="c-vmeta">
          {v.value ? <span className="val"><bdi>{money(v.value)}</bdi></span> : null}
          {v.issuer ? <span className="iss" dir="auto">{v.issuer}</span> : null}
        </div>
        {v.code && <CopyCode code={v.code} />}
        <div className="c-line">
          <span className={`pill ${st.tone}`}>{st.label}</span>
          {v.expiry && <span>{t('בתוקף עד')} <bdi>{fmtDate(v.expiry)}</bdi></span>}
        </div>
        {v.link && <a className="btn sm" style={{ marginTop: 6 }} href={v.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}><Icon name="external" size="xs" />{t('לאתר המימוש')}</a>}
        <TextBlock value={text.length > 160 ? text.slice(0, 160).trimEnd() + '…' : text} clamp={false} />
      </>);
    }
    case 'event': {
      const e = f.event || {};
      const st = eventState(it, td);
      const d = e.date ? Core.parseYmd(e.date) : null;
      return (<>
        <div className="c-event">
          {d ? (
            <div className={`cal ${st.key === 'past' ? 'past' : ''}`}>
              <div className="m">{monthShort(d.getMonth())}</div>
              <div className="d">{d.getDate()}</div>
              <div className="w">{weekday(d.getDay())}</div>
            </div>
          ) : <div className="cal"><div className="m">?</div><div className="d">–</div><div className="w">{t('אין תאריך')}</div></div>}
          <div className="c-ev-meta">
            <span className={`pill ${st.key === 'upcoming' ? 'accent' : ''}`}>{st.label}</span>
            {e.date && <span className="muted"><bdi>{fmtDate(e.date, e.time)}</bdi></span>}
          </div>
        </div>
        <TextBlock />
      </>);
    }
    case 'link': {
      const caption = withoutUrls(text);
      return (<>
        {caption && <div className="c-text" dir="auto">{caption}</div>}
        <LinkChip link={f.link} onOpened={() => {}} />
      </>);
    }
    case 'todo': {
      const caption = f.link ? withoutUrls(text) : text;
      return (<>
        <div className="c-todo">
          <button className={`tick ${it.done ? 'on' : ''}`} aria-pressed={it.done} aria-label={it.done ? t('סימון כלא בוצע') : t('סימון כבוצע')}
            onClick={e => { e.stopPropagation(); actions.patchOne(it.id, { done: !it.done }, { message: it.done ? t('הוחזר לרשימה') : t('סומן כבוצע') }); }}>
            <Icon name="check" size="xs" />
          </button>
          <div className={`c-text ${long ? 'clamped' : ''}`} dir="auto"><LinkedText text={caption || text} /></div>
        </div>
        {f.link && <LinkChip link={f.link} />}
      </>);
    }
    default:
      return (<>
        <TextBlock />
        {it.docName && <div className="c-doc"><Icon name="clip" size="xs" /><span dir="auto">{it.docName}</span></div>}
      </>);
  }
}

function Card({ it, category, showCategory, selected, selecting, isNew, today: td, onOpen, onSelect, onMenu, onLongPress, onDragStart, onDragEnd }) {
  const { actions } = useStore();
  const ref = useRef(null);
  const press = useRef(null);
  const [dragging, setDragging] = useState(false);
  const trashed = it.status === 'trashed', archived = it.status === 'archived';
  const dim = (it.type === 'link' && it.watched) || (it.type === 'event' && eventState(it, td).key === 'past') || (it.type === 'voucher' && ['used', 'expired'].includes(voucherState(it, td).key));
  const dupBar = it.flags?.dup || it.flags?.possibleEdit;

  const stop = fn => e => { e.stopPropagation(); fn(e); };
  const statusTo = status => {
    const msg = { archived: t('הועבר לארכיון'), trashed: t('הועבר לסל המחזור'), active: archived ? t('הוצא מהארכיון') : t('שוחזר') }[status];
    actions.patchOne(it.id, { status }, { message: msg });
  };

  // touch long-press opens the action sheet
  const onPointerDown = e => {
    if (e.pointerType !== 'touch') return;
    const x = e.clientX, y = e.clientY;
    press.current = { x, y, fired: false, timer: setTimeout(() => { press.current.fired = true; navigator.vibrate?.(15); onLongPress(it); }, 480) };
  };
  const cancelPress = e => {
    const p = press.current; if (!p) return;
    if (e.type === 'pointermove' && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10) return;
    clearTimeout(p.timer);
    if (e.type !== 'pointermove' && !p.fired) press.current = null;
  };
  const onClick = e => {
    if (press.current?.fired) { press.current = null; return; }
    if (selecting || e.shiftKey || e.metaKey || e.ctrlKey) { onSelect(it.id, e); return; }
    onOpen(it.id);
  };

  return (
    <article
      ref={ref}
      className={`card ${selected ? 'sel' : ''} ${dim ? 'dim' : ''} ${it.done ? 'done' : ''} ${dragging ? 'dragging' : ''}`}
      data-bg={it.color || undefined}
      style={it.color ? { '--card-bg': `var(--k-${it.color})` } : undefined}
      tabIndex={0}
      draggable={!trashed}
      onDragStart={e => { setDragging(true); onDragStart(e, it.id); }}
      onDragEnd={() => { setDragging(false); onDragEnd(); }}
      onClick={onClick}
      onClickCapture={e => { if (selecting && e.target.closest('a, .c-code, .tick, .flag, .c-dupbar')) { e.preventDefault(); e.stopPropagation(); onSelect(it.id, e); } }}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(it.id); if (e.key === ' ' && e.target === e.currentTarget) { e.preventDefault(); onSelect(it.id, e); } }}
      onPointerDown={onPointerDown} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerMove={cancelPress}
      onTouchEnd={e => { if (press.current?.fired) e.preventDefault(); /* no synthetic click after a long press */ }}
      onContextMenu={e => { if (press.current) e.preventDefault(); }}
      aria-label={`${it.title || displayText(it).slice(0, 60)}`}
    >
      <button className="c-check" onClick={stop(e => onSelect(it.id, e))} aria-label={selected ? t('ביטול בחירה') : t('בחירה')} tabIndex={-1}><Icon name="check" size="xs" /></button>
      {!trashed && (
        <button className={`c-pin ${it.pinned ? 'on' : ''}`} onClick={stop(() => actions.patchOne(it.id, { pinned: !it.pinned }))} aria-label={it.pinned ? t('ביטול הצמדה') : t('הצמדה למעלה')} title={it.pinned ? t('ביטול הצמדה') : t('הצמדה')}>
          <Icon name="pin" size="sm" />
        </button>
      )}
      <div className="c-head">
        {showCategory && category && <><span className="dot" style={{ background: catColor(category.color) }} /><span className="cat">{t(category.name)}</span></>}
        {it.locked && <Icon name="lock" size="xs" className="lockmark" title={t('נעול')} />}
        <span className="when"><bdi>{fmtDate(it.date, it.time)}</bdi></span>
      </div>
      {it.title && <div className="c-title" dir="auto">{it.title}</div>}
      <Body it={it} td={td} />
      {it.labels?.length > 0 && <div className="c-labels">{it.labels.map(l => <span key={l} className="lab" dir="auto">#{l}</span>)}</div>}
      {(isNew || it.flags?.auto || it.media || it.forwarded || it.flags?.editedWA || it.note) && (
        <div className="c-flags">
          {isNew && <span className="flag new">{t('חדש')}</span>}
          {it.flags?.auto && (
            <button className="flag auto" onClick={stop(() => actions.patchOne(it.id, { flags: { auto: false } }))} title={t('מוין אוטומטית. לחיצה מסמנת שנבדק.')}>
              <Icon name="sparkle" size="xs" />{t('אוטומטי')}
            </button>
          )}
          {it.media && <span className="flag" title={t('ההודעה המקורית כללה קובץ מצורף')}><Icon name="clip" size="xs" />{it.docName ? t('מסמך') : t('מצורף')}</span>}
          {it.forwarded && <span className="flag"><Icon name="forward" size="xs" className="flip" />{t('הועבר')}</span>}
          {it.flags?.editedWA && <span className="flag warn">{t('נערך בוואטסאפ')}</span>}
          {it.note && <span className="flag" title={it.note}><Icon name="note" size="xs" />{t('הערה')}</span>}
        </div>
      )}
      {dupBar && !trashed && (
        <div className="c-dupbar" onClick={e => e.stopPropagation()}>
          <span style={{ flex: 1, minWidth: 120 }}>{it.flags.dup ? t('אותה הודעה נשמרה פעמיים באותו יום') : t('ייתכן שזו גרסה ערוכה של הודעה קיימת')}</span>
          <button className="btn" onClick={() => actions.resolve(it.id, 'merge')}>{t('איחוד')}</button>
          <button className="btn" onClick={() => actions.resolve(it.id, 'keep')}>{t('להשאיר את שניהם')}</button>
        </div>
      )}
      <div className="c-tools" onClick={e => e.stopPropagation()}>
        {trashed ? (
          <button className="iconbtn" onClick={() => statusTo('active')} title={t('שחזור')} aria-label={t('שחזור')}><Icon name="restore" /></button>
        ) : (<>
          <button className="iconbtn" onClick={() => actions.patchOne(it.id, { locked: !it.locked })} title={it.locked ? t('ביטול נעילה') : t('נעילה מפני מחיקה')} aria-label={it.locked ? t('ביטול נעילה') : t('נעילה')}><Icon name={it.locked ? 'unlock' : 'lock'} /></button>
          <button className="iconbtn" onClick={e => onMenu('label', e.currentTarget, [it.id])} title={t('תוויות')} aria-label={t('תוויות')}><Icon name="tag" /></button>
          <button className="iconbtn" onClick={e => onMenu('move', e.currentTarget, [it.id])} title={t('העברה לקטגוריה')} aria-label={t('העברה לקטגוריה')}><Icon name="move" /></button>
          <button className="iconbtn" onClick={e => onMenu('color', e.currentTarget, [it.id])} title={t('צבע רקע')} aria-label={t('צבע רקע')}><Icon name="palette" /></button>
          <span className="grow" />
          <button className="iconbtn" disabled={it.locked} onClick={() => statusTo(archived ? 'active' : 'archived')} title={it.locked ? t('הכרטיס נעול') : archived ? t('הוצאה מהארכיון') : t('ארכיון')} aria-label={archived ? t('הוצאה מהארכיון') : t('ארכיון')}><Icon name={archived ? 'unarchive' : 'archive'} /></button>
          <button className="iconbtn" disabled={it.locked} onClick={() => statusTo('trashed')} title={it.locked ? t('הכרטיס נעול') : t('מחיקה')} aria-label={t('מחיקה')}><Icon name="trash" /></button>
        </>)}
      </div>
    </article>
  );
}

export default memo(Card);
