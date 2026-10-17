import { useMemo, useRef, useState } from 'react';
import { Modal, useConfirm } from './ui.jsx';
import Icon from './Icon.jsx';
import { useStore } from '../store.jsx';
import { LinkedText, LinkChip } from './Card.jsx';
import { Core, displayText, fmtDate, TYPE_LABELS, catColor } from '../lib/util.js';
import { t } from '../i18n/index.js';

/* Card editor. The original message (raw) is never edited; edits change the
   display text, title, note and the typed fields. Saved when the dialog closes. */

function initialDraft(it) {
  return {
    title: it.title || '', text: displayText(it), note: it.note || '', category: it.category, type: it.type,
    labels: it.labels || [], fields: JSON.parse(JSON.stringify(it.fields || {}))
  };
}

function guessFields(type, text, date) {
  if (type === 'expense') return Core.parseExpense(text) || { amount: 0, currency: 'ILS', desc: text.split('\n')[0].slice(0, 80) };
  if (type === 'voucher') return Core.parseVoucher(text, date) || { code: null, value: null, expiry: null, issuer: null, link: null };
  if (type === 'event') return Core.parseEvent(text, date) || { date: null, time: null };
  return null;
}

export default function Editor({ item, onClose }) {
  const { categories, actions, settings } = useStore();
  const confirm = useConfirm();
  const [d, setD] = useState(() => initialDraft(item));
  const [showOrig, setShowOrig] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const start = useRef(initialDraft(item));
  const set = patch => setD(cur => ({ ...cur, ...patch }));
  const setField = (k, patch) => setD(cur => ({ ...cur, fields: { ...cur.fields, [k]: { ...(cur.fields[k] || {}), ...patch } } }));
  const original = item.waText ?? item.body;

  const diff = useMemo(() => {
    const s = start.current, p = {};
    if (d.title !== s.title) p.title = d.title;
    if (d.text !== s.text) p.text = d.text === original ? null : d.text;
    if (d.note !== s.note) p.note = d.note;
    if (d.category !== s.category) p.category = d.category;
    if (d.type !== s.type) p.type = d.type;
    if (JSON.stringify(d.labels) !== JSON.stringify(s.labels)) p.labels = d.labels;
    const fp = {};
    for (const k of ['expense', 'voucher', 'event']) if (JSON.stringify(d.fields[k] ?? null) !== JSON.stringify(s.fields[k] ?? null)) fp[k] = d.fields[k] ?? null;
    if (Object.keys(fp).length) p.fields = fp;
    return p;
  }, [d, original]);

  const close = () => {
    if (Object.keys(diff).length) actions.patchOne(item.id, diff, { message: t('השינויים נשמרו') });
    onClose();
  };
  const changeType = type => {
    const next = { type };
    if (['expense', 'voucher', 'event'].includes(type) && !d.fields[type]) next.fields = { ...d.fields, [type]: guessFields(type, d.text, item.date) };
    set(next);
  };
  const addLabel = raw => {
    const l = raw.trim().replace(/^#/, '');
    if (l && !d.labels.includes(l)) set({ labels: [...d.labels, l] });
    setLabelInput('');
  };
  const statusAction = async status => {
    if (Object.keys(diff).length) await actions.patchOne(item.id, diff, { undo: false });
    const msg = { archived: t('הועבר לארכיון'), trashed: t('הועבר לסל המחזור'), active: t('שוחזר') }[status];
    actions.patchOne(item.id, { status }, { message: msg });
    onClose();
  };
  const resetText = async () => {
    if (await confirm({ title: t('לחזור לטקסט המקורי?'), body: t('הטקסט שערכת יוחלף בנוסח של ההודעה מוואטסאפ.'), confirm: t('חזרה למקור') })) set({ text: original });
  };

  const cat = categories.find(c => c.id === d.category);
  const f = d.fields;
  const knownLabels = settings.labels.filter(l => !d.labels.includes(l));

  return (
    <Modal title={null} onClose={close} size="wide">
      <div className="dlg-head">
        <span className="dot" style={{ width: 10, height: 10, borderRadius: '50%', background: catColor(cat?.color) }} />
        <h2 className="text-[15px] font-medium text-fg2">{cat ? t(cat.name) : ''} · <bdi>{fmtDate(item.date, item.time)}</bdi></h2>
        <button className={`iconbtn ${item.pinned ? '' : ''}`} aria-pressed={item.pinned} onClick={() => actions.patchOne(item.id, { pinned: !item.pinned })} title={item.pinned ? t('ביטול הצמדה') : t('הצמדה')}><Icon name="pin" /></button>
        <button className="iconbtn" aria-pressed={item.locked} onClick={() => actions.patchOne(item.id, { locked: !item.locked })} title={item.locked ? t('ביטול נעילה') : t('נעילה מפני מחיקה')}><Icon name={item.locked ? 'lock' : 'unlock'} /></button>
        <button className="iconbtn" onClick={close} aria-label={t('סגירה ושמירה')}><Icon name="close" /></button>
      </div>
      <div className="dlg-body">
        <input id="ed-title" className="ed-title" placeholder={t('כותרת')} value={d.title} onChange={e => set({ title: e.target.value })} dir="auto" />
        <textarea id="ed-text" className="ta ed-text" value={d.text} onChange={e => set({ text: e.target.value })} dir="auto" aria-label={t('טקסט הכרטיס')} data-autofocus
          rows={Math.min(16, Math.max(5, d.text.split('\n').length + 1))} />
        {item.docName && <div className="c-doc"><Icon name="clip" size="xs" /><span dir="auto">{item.docName}</span></div>}
        {item.attachments?.length > 0 && (
          <div className="c-attachments" style={{ marginTop: 8 }}>
            {item.attachments.map(a => (
              <a key={a.name} className="c-att" href={`/api/attachments/${encodeURIComponent(item.id)}/${encodeURIComponent(a.name)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={a.name}>
                <Icon name={a.type?.startsWith('image/') ? 'eye' : a.type === 'application/pdf' ? 'note' : 'clip'} size="xs" />
                <span className="att-name" dir="auto">{a.name}</span>
              </a>
            ))}
          </div>
        )}
        {f.link && <LinkChip link={f.link} />}

        <div className="grid3">
          <label className="field"><span>{t('קטגוריה')}</span>
            <select id="ed-category" className="sel" value={d.category} onChange={e => set({ category: e.target.value })}>
              {categories.map(c => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('סוג כרטיס')}</span>
            <select id="ed-type" className="sel" value={d.type} onChange={e => changeType(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>
          <div className="field"><span>{t('מצב')}</span>
            <div className="flex gap-3 flex-wrap items-center" style={{ minHeight: 38 }}>
              {d.type === 'todo' && <label className="toggle"><input type="checkbox" checked={item.done} onChange={() => actions.patchOne(item.id, { done: !item.done })} />{t('בוצע')}</label>}
              {d.type === 'link' && <label className="toggle"><input type="checkbox" checked={item.watched} onChange={() => actions.patchOne(item.id, { watched: !item.watched })} />{t('נצפה')}</label>}
              {d.type === 'voucher' && <label className="toggle"><input type="checkbox" checked={item.used} onChange={() => actions.patchOne(item.id, { used: !item.used })} />{t('מומש')}</label>}
              {!['todo', 'link', 'voucher'].includes(d.type) && <span className="faint">—</span>}
            </div>
          </div>
        </div>

        {d.type === 'expense' && (
          <div className="box"><h3>{t('פרטי ההוצאה')}</h3>
            <div className="grid3">
              <label className="field"><span>{t('סכום')}</span><input id="ed-amount" className="inp ltr" type="number" step="0.01" min="0" value={f.expense?.amount ?? ''} onChange={e => setField('expense', { amount: e.target.value === '' ? 0 : Number(e.target.value) })} /></label>
              <label className="field"><span>{t('מטבע')}</span>
                <select id="ed-currency" className="sel" value={f.expense?.currency || 'ILS'} onChange={e => setField('expense', { currency: e.target.value })}>
                  <option value="ILS">{t('₪ שקל')}</option><option value="USD">{t('$ דולר')}</option>
                </select>
              </label>
              <label className="field"><span>{t('על מה')}</span><input id="ed-desc" className="inp" dir="auto" value={f.expense?.desc || ''} onChange={e => setField('expense', { desc: e.target.value })} /></label>
            </div>
          </div>
        )}
        {d.type === 'voucher' && (
          <div className="box"><h3>{t('פרטי השובר')}</h3>
            <div className="grid2">
              <label className="field"><span>{t('קוד')}</span><input id="ed-code" className="inp mono ltr" value={f.voucher?.code || ''} onChange={e => setField('voucher', { code: e.target.value || null })} /></label>
              <label className="field"><span>{t('שווי (₪)')}</span><input id="ed-value" className="inp ltr" type="number" min="0" value={f.voucher?.value ?? ''} onChange={e => setField('voucher', { value: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label className="field"><span>{t('בתוקף עד')}</span><input id="ed-expiry" className="inp" type="date" value={f.voucher?.expiry || ''} onChange={e => setField('voucher', { expiry: e.target.value || null })} /></label>
              <label className="field"><span>{t('מנפיק')}</span><input id="ed-issuer" className="inp" dir="auto" value={f.voucher?.issuer || ''} onChange={e => setField('voucher', { issuer: e.target.value || null })} /></label>
              <label className="field" style={{ gridColumn: '1 / -1' }}><span>{t('קישור למימוש')}</span><input id="ed-vlink" className="inp ltr" dir="ltr" value={f.voucher?.link || ''} onChange={e => setField('voucher', { link: e.target.value || null })} /></label>
            </div>
          </div>
        )}
        {d.type === 'event' && (
          <div className="box"><h3>{t('מועד האירוע')}</h3>
            <div className="grid2">
              <label className="field"><span>{t('תאריך')}</span><input id="ed-edate" className="inp" type="date" value={f.event?.date || ''} onChange={e => setField('event', { date: e.target.value || null })} /></label>
              <label className="field"><span>{t('שעה')}</span><input id="ed-etime" className="inp" type="time" value={f.event?.time || ''} onChange={e => setField('event', { time: e.target.value || null })} /></label>
            </div>
          </div>
        )}

        <div className="field"><span>{t('תוויות')}</span>
          <div className="labelpick">
            {d.labels.map(l => (
              <span key={l} className="lab" dir="auto">#{l}<button onClick={() => set({ labels: d.labels.filter(x => x !== l) })} aria-label={t('הסרת התווית {name}', { name: l })}><Icon name="close" size="xs" /></button></span>
            ))}
            <input id="ed-label" list="ed-label-list" placeholder={t('הוספת תווית…')} value={labelInput} onChange={e => setLabelInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLabel(labelInput); } }} onBlur={() => labelInput && addLabel(labelInput)} />
            <datalist id="ed-label-list">{knownLabels.map(l => <option key={l} value={l} />)}</datalist>
          </div>
        </div>

        <label className="field"><span>{t('הערה אישית')}</span>
          <textarea id="ed-note" className="ta" style={{ minHeight: 70 }} dir="auto" value={d.note} onChange={e => set({ note: e.target.value })} placeholder={t('תזכורות, הקשר, מה לעשות עם זה…')} />
        </label>

        <div className="box">
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn sm" onClick={() => setShowOrig(v => !v)} aria-expanded={showOrig}><Icon name="eye" size="xs" />{showOrig ? t('הסתרת ההודעה המקורית') : t('הצגת ההודעה המקורית')}</button>
            {d.text !== original && <button className="btn sm ghost" onClick={resetText}><Icon name="undo" size="xs" />{t('חזרה לטקסט המקורי')}</button>}
          </div>
          {showOrig && (<>
            <div className="ed-orig" dir="auto"><LinkedText text={item.raw || item.body} /></div>
            {item.waText && <><div className="hint">{t('הנוסח אחרי העריכה בוואטסאפ:')}</div><div className="ed-orig" dir="auto"><LinkedText text={item.waText} /></div></>}
          </>)}
          <div className="ed-meta">
            <span>{t('נשלח:')} <bdi>{fmtDate(item.date, item.time)}</bdi></span>
            {item.forwarded && <span>{t('הודעה שהועברה')}</span>}
            {item.media && <span>📎 {item.docName ? t('ההודעה כללה מסמך') : t('ההודעה כללה קובץ מדיה')}</span>}
            {item.createdAt && <span>{t('יובא:')} <bdi>{fmtDate(item.createdAt.slice(0, 10))}</bdi></span>}
          </div>
        </div>
      </div>
      <div className="dlg-foot">
        {item.status === 'trashed'
          ? <button className="btn" onClick={() => statusAction('active')}><Icon name="restore" size="sm" />{t('שחזור')}</button>
          : <>
            <button className="btn danger" disabled={item.locked} title={item.locked ? t('הכרטיס נעול') : undefined} onClick={() => statusAction('trashed')}><Icon name="trash" size="sm" />{t('מחיקה')}</button>
            <button className="btn" disabled={item.locked && item.status !== 'archived'} onClick={() => statusAction(item.status === 'archived' ? 'active' : 'archived')}>
              <Icon name={item.status === 'archived' ? 'unarchive' : 'archive'} size="sm" />{item.status === 'archived' ? t('הוצאה מהארכיון') : t('ארכיון')}
            </button>
          </>}
        <span className="spacer" />
        <button className="btn primary" onClick={close}>{t('סגירה')}</button>
      </div>
    </Modal>
  );
}
