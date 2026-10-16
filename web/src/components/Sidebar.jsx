import { useState } from 'react';
import Icon from './Icon.jsx';
import { useStore } from '../store.jsx';
import { SMART } from '../lib/views.js';
import { catColor, num } from '../lib/util.js';
import { t } from '../i18n/index.js';

/* Left rail (right side in RTL). Categories, labels, Archive and Trash accept
   dropped cards. */
function Nav({ active, icon, dot, label, n, onClick, drop, over, dropHandlers }) {
  return (
    <button className={`nav ${active ? 'active' : ''} ${over ? 'drop-ok' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined} {...(drop ? dropHandlers : {})}>
      {dot ? <span className="dot" style={{ background: dot }} /> : <Icon name={icon} />}
      <span className="lbl">{label}</span>
      {n ? <span className="cnt">{num(n)}</span> : null}
    </button>
  );
}

export default function Sidebar({ view, setView, counts, dragging, onDropIds, openSettings }) {
  const { categories, settings, items } = useStore();
  const [over, setOver] = useState(null);
  const labels = [...new Set([...settings.labels, ...Object.keys(counts.label)])].sort((a, b) => a.localeCompare(b, 'he'));

  // Drop handlers are always attached; they only react to card drags (text/plain ids).
  const dropProps = (key, target) => ({
    onDragOver: e => { if (!e.dataTransfer.types.includes('text/plain')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key); },
    onDragLeave: () => setOver(o => (o === key ? null : o)),
    onDrop: e => {
      e.preventDefault(); setOver(null);
      const ids = (e.dataTransfer.getData('text/plain') || '').split(',').filter(id => items[id]);
      if (ids.length) onDropIds(ids, target);
    }
  });
  const nav = (k, props) => <Nav key={k} {...props} over={dragging && over === k} dropHandlers={props.drop ? dropProps(k, props.drop) : undefined} />;
  const is = (kind, id) => view.kind === kind && (id === undefined || view.id === id);

  return (
    <nav className="side" aria-label={t('ניווט')}>
      <div className="side-sec">
        {nav('all', { active: is('all'), icon: 'message', label: t('כל הכרטיסים'), n: counts.all, onClick: () => setView({ kind: 'all' }) })}
      </div>
      <div className="side-sec">
        <div className="side-head"><span>{t('קטגוריות')}</span><button onClick={() => openSettings('categories')}>{t('עריכה')}</button></div>
        {categories.map(c => nav('c:' + c.id, { active: is('cat', c.id), dot: catColor(c.color), label: t(c.name), n: counts.cat[c.id],
          onClick: () => setView({ kind: 'cat', id: c.id }), drop: { kind: 'cat', id: c.id, name: c.name } }))}
      </div>
      <div className="side-sec">
        <div className="side-head"><span>{t('תצוגות חכמות')}</span></div>
        {SMART.map(s => nav('s:' + s.id, { active: is('smart', s.id), icon: s.icon, label: t(s.name), n: counts.smart[s.id], onClick: () => setView({ kind: 'smart', id: s.id }) }))}
      </div>
      <div className="side-sec">
        <div className="side-head"><span>{t('תוויות')}</span><button onClick={() => openSettings('labels')}>{t('עריכה')}</button></div>
        {labels.length === 0 && <p className="hint" style={{ padding: '2px 24px 6px' }}>{t('אפשר להוסיף תוויות לכרטיסים (למשל #עבודה) ולגרור לכאן.')}</p>}
        {labels.map(l => nav('l:' + l, { active: is('label', l), icon: 'tag', label: l, n: counts.label[l], onClick: () => setView({ kind: 'label', id: l }), drop: { kind: 'label', id: l } }))}
      </div>
      <div className="side-sec">
        {nav('archive', { active: is('archive'), icon: 'archive', label: t('ארכיון'), n: counts.archive, onClick: () => setView({ kind: 'archive' }), drop: { kind: 'status', id: 'archived' } })}
        {nav('trash', { active: is('trash'), icon: 'trash', label: t('סל מחזור'), n: counts.trash, onClick: () => setView({ kind: 'trash' }), drop: { kind: 'status', id: 'trashed' } })}
      </div>
    </nav>
  );
}
