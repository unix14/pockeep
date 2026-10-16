import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { MenuItem } from './ui.jsx';
import { catColor, CARD_COLORS } from '../lib/util.js';
import { t } from '../i18n/index.js';

const COLOR_NAMES = { coral: 'אלמוג', peach: 'אפרסק', sand: 'חול', mint: 'מנטה', sage: 'מרווה', fog: 'ערפל', storm: 'סערה', dusk: 'דמדומים', blossom: 'פריחה', clay: 'חימר' };

export function MoveMenu({ ids, onDone }) {
  const { categories, items, actions } = useStore();
  const current = ids.length === 1 ? items[ids[0]]?.category : null;
  const move = c => {
    actions.patch(ids.filter(id => items[id]?.category !== c.id).map(id => ({ id, patch: { category: c.id } })),
      { message: ids.length === 1 ? t('הועבר אל „{name}”', { name: t(c.name) }) : t('{n} כרטיסים הועברו אל „{name}”', { n: ids.length, name: t(c.name) }) });
    onDone();
  };
  return (
    <>
      <div className="mh">{t('העברה לקטגוריה')}</div>
      {categories.map(c => <MenuItem key={c.id} dot={catColor(c.color)} checked={current === c.id} onClick={() => move(c)}>{t(c.name)}</MenuItem>)}
    </>
  );
}

export function LabelMenu({ ids, onDone }) {
  const { items, settings, actions } = useStore();
  const [q, setQ] = useState('');
  const all = useMemo(() => {
    const s = new Set(settings.labels);
    for (const it of Object.values(items)) for (const l of it.labels || []) s.add(l);
    return [...s].sort((a, b) => a.localeCompare(b, 'he'));
  }, [items, settings.labels]);
  const sel = ids.map(id => items[id]).filter(Boolean);
  const state = l => { const n = sel.filter(it => (it.labels || []).includes(l)).length; return n === 0 ? 'none' : n === sel.length ? 'all' : 'some'; };
  const toggle = l => {
    const add = state(l) !== 'all';
    actions.patch(sel.map(it => ({ id: it.id, patch: { labels: add ? [...new Set([...(it.labels || []), l])] : (it.labels || []).filter(x => x !== l) } })), { undo: false });
  };
  const clean = q.trim().replace(/^#/, '');
  const shown = all.filter(l => !clean || l.toLowerCase().includes(clean.toLowerCase()));
  const create = () => { if (!clean) return; toggle(clean); setQ(''); };
  return (
    <>
      <div className="mh">{t('תוויות')}</div>
      <div style={{ padding: '0 6px' }}>
        <input className="inp" placeholder={t('חיפוש או תווית חדשה')} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} autoFocus />
      </div>
      {shown.map(l => (
        <MenuItem key={l} icon="tag" checked={state(l) === 'all'} onClick={() => toggle(l)}>
          {l}{state(l) === 'some' ? <span className="faint"> {t('(חלק)')}</span> : null}
        </MenuItem>
      ))}
      {clean && !all.includes(clean) && <MenuItem icon="plus" onClick={create}>{t('יצירת התווית „{name}”', { name: clean })}</MenuItem>}
      {!shown.length && !clean && <div className="mh" style={{ textTransform: 'none' }}>{t('עוד אין תוויות. אפשר להקליד שם ולהוסיף.')}</div>}
      <div className="msep" />
      <MenuItem icon="check" onClick={onDone}>{t('סיום')}</MenuItem>
    </>
  );
}

export function ColorMenu({ ids, onDone }) {
  const { items, actions } = useStore();
  const current = ids.length === 1 ? items[ids[0]]?.color || null : undefined;
  const set = c => { actions.patch(ids.map(id => ({ id, patch: { color: c } })), { undo: false }); onDone(); };
  return (
    <>
      <div className="mh">{t('צבע רקע')}</div>
      <div className="swatches">
        <button className={`sw none ${current === null ? 'on' : ''}`} onClick={() => set(null)} aria-label={t('ללא צבע')} title={t('ללא צבע')} />
        {CARD_COLORS.map(c => (
          <button key={c} className={`sw ${current === c ? 'on' : ''}`} style={{ background: `var(--k-${c})` }} onClick={() => set(c)} aria-label={t(COLOR_NAMES[c])} title={t(COLOR_NAMES[c])} />
        ))}
      </div>
    </>
  );
}
