import { useRef, useState } from 'react';
import { Modal, Spinner } from './ui.jsx';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { readFileText, num, fmtDate, catColor } from '../lib/util.js';
import { t } from '../i18n/index.js';

/* Import: choose file -> server preview (nothing saved) -> confirm -> saved. */
export default function ImportDialog({ onClose, onImported }) {
  const { categories, actions } = useStore();
  const [step, setStep] = useState('pick'); // pick | reading | preview | saving | error
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef(null);

  async function handle(file) {
    if (!file) return;
    setStep('reading'); setError('');
    try {
      const isZip = /\.zip$/i.test(file.name);
      const payload = isZip ? file : await readFileText(file);
      setPreview(await api.previewImport(payload, file.name));
      setStep('preview');
    } catch (e) { setError(e.message); setStep('error'); }
  }
  async function commit() {
    setStep('saving');
    try {
      const r = await api.commitImport(preview.token);
      actions.applyServerData(r);
      onImported(r.counts);
    } catch (e) { setError(e.message); setStep('error'); }
  }

  const c = preview?.counts;
  const att = preview?.attachments;
  const catName = id => t(categories.find(x => x.id === id)?.name || id);
  const catCol = id => catColor(categories.find(x => x.id === id)?.color);
  const byCat = c ? Object.entries(c.byCategory || {}).sort((a, b) => b[1] - a[1]) : [];
  const maxCat = Math.max(1, ...byCat.map(x => x[1]));

  const footer = step === 'preview' ? <>
    <button className="btn ghost" onClick={onClose}>{t('ביטול')}</button>
    <button className="btn primary" onClick={commit} disabled={!c.newItems && !c.edits} data-autofocus>
      {c.newItems ? t('ייבוא {n} כרטיסים חדשים', { n: num(c.newItems) }) : c.edits ? t('עדכון העריכות') : t('אין מה לייבא')}
    </button>
  </> : step === 'error' ? <>
    <button className="btn ghost" onClick={onClose}>{t('סגירה')}</button>
    <button className="btn primary" onClick={() => setStep('pick')}>{t('בחירת קובץ אחר')}</button>
  </> : step === 'pick' ? <button className="btn ghost" onClick={onClose}>{t('ביטול')}</button> : null;

  return (
    <Modal title={t('ייבוא ייצוא צ׳אט')} onClose={step === 'saving' ? () => {} : onClose} footer={footer}>
      <div className="dlg-body">
        {step === 'pick' && (<>
          <div
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]); }}
            className="rounded-xl border-2 border-dashed p-8 grid gap-3 justify-items-center text-center"
            style={{ borderColor: over ? 'var(--accent)' : 'var(--border)', background: over ? 'var(--accent-soft)' : 'var(--surface-2)' }}>
            <Icon name="upload" className="!w-10 !h-10 text-fg3" />
            <div className="font-medium">{t('גוררים לכאן את קובץ הייצוא, או בוחרים אותו מהמחשב')}</div>
            <div className="hint">{t('ייצוא של וואטסאפ: קובץ ‎.zip‎ (עם מדיה), ‎.txt‎ (אנדרואיד/אייפון) או ‎.md‎ מומר.')}</div>
            <button className="btn primary" onClick={() => input.current?.click()} data-autofocus><Icon name="upload" size="sm" />{t('בחירת קובץ')}</button>
            <input ref={input} id="import-file" type="file" accept=".txt,.md,.zip,text/plain,text/markdown,application/zip" hidden onChange={e => handle(e.target.files?.[0])} />
          </div>
          <p className="hint">{t('שום דבר לא נשמר לפני שמאשרים. הודעות שכבר קיימות אצלך מזוהות ומדולגות, והסידור שלך לא משתנה.')}</p>
        </>)}

        {(step === 'reading' || step === 'saving') && (
          <div className="grid justify-items-center gap-3 py-10 text-fg2">
            <Spinner />
            <div>{step === 'reading' ? t('קוראים את הקובץ ובודקים מה חדש…') : t('שומרים את הכרטיסים…')}</div>
          </div>
        )}

        {step === 'error' && <div className="err" role="alert">{error}</div>}

        {step === 'preview' && c && (<>
          <div className="text-sm text-fg2">
            <b className="text-fg" dir="auto">{preview.fileName}</b>
            {preview.firstDate && <> {t('· הודעות מ־')}<bdi>{fmtDate(preview.firstDate)}</bdi> {t('עד')} <bdi>{fmtDate(preview.lastDate)}</bdi></>}
            {preview.exportDate && <> {t('· יוצא ב־')}<bdi dir="ltr">{preview.exportDate}</bdi></>}
          </div>
          <div className="counts">
            <div className="cnt-tile hi"><div className="v">{num(c.newItems)}</div><div className="k">{t('כרטיסים חדשים')}</div></div>
            <div className="cnt-tile"><div className="v">{num(c.present)}</div><div className="k">{t('כבר קיימים אצלך')}</div></div>
            <div className="cnt-tile"><div className="v">{num(c.edits)}</div><div className="k">{t('נערכו בוואטסאפ (יעודכנו)')}</div></div>
            <div className="cnt-tile"><div className="v">{num(c.dups)}</div><div className="k">{t('כפילויות באותו יום (יסומנו)')}</div></div>
            <div className="cnt-tile"><div className="v">{num(c.possibleEdits)}</div><div className="k">{t('אולי עריכה (יסומנו)')}</div></div>
            <div className="cnt-tile"><div className="v">{num(c.previouslyDeleted)}</div><div className="k">{t('נמחקו בעבר (ידולגו)')}</div></div>
            <div className="cnt-tile"><div className="v">{num(c.bareMedia)}</div><div className="k">{t('מדיה בלי טקסט (תדולג)')}</div></div>
            <div className="cnt-tile"><div className="v">{num(c.messages)}</div><div className="k">{t('הודעות בקובץ')}</div></div>
            {att && (
              <div className="cnt-tile"><div className="v">{num(att.matched)}<span className="text-fg3">/{num(att.total)}</span></div><div className="k">{t('קבצים מצורפים יקושרו')}</div></div>
            )}
          </div>
          {byCat.length > 0 && (
            <div className="box">
              <h3>{t('לאן ימוינו הכרטיסים החדשים')}</h3>
              <div className="bars">
                {byCat.map(([id, n]) => (
                  <div className="bar" key={id}>
                    <span className="name">{catName(id)}</span>
                    <span className="track"><span className="fill" style={{ display: 'block', width: `${(n / maxCat) * 100}%`, background: catCol(id) }} /></span>
                    <span className="amt">{num(n)}</span>
                  </div>
                ))}
              </div>
              <p className="hint">{t('כרטיסים שמוינו אוטומטית יקבלו תג „אוטומטי" עד שתבדקו אותם.')}</p>
            </div>
          )}
        </>)}
      </div>
    </Modal>
  );
}
