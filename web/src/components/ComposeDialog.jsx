import { useState } from 'react';
import { Modal } from './ui.jsx';
import Icon from './Icon.jsx';
import { useStore } from '../store.jsx';
import { TYPE_LABELS } from '../lib/util.js';
import { t } from '../i18n/index.js';

export default function ComposeDialog({ defaultCategory, onClose, onCreated }) {
  const { categories, actions } = useStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState(defaultCategory || 'inbox');
  const [type, setType] = useState('note');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (!body.trim() && !title.trim()) return;
    setBusy(true);
    const item = await actions.createItem({ body: body.trim(), title: title.trim(), category, type });
    setBusy(false);
    if (item) onCreated?.(item);
  };

  return (
    <Modal title={t('כרטיס חדש')} onClose={onClose}>
      <form className="dlg-body grid gap-4" onSubmit={submit}>
        <input className="ed-title" placeholder={t('כותרת')} value={title} onChange={e => setTitle(e.target.value)} dir="auto" autoFocus />
        <textarea className="ta ed-text" placeholder={t('טקסט…')} value={body} onChange={e => setBody(e.target.value)} dir="auto" rows={5} />
        <div className="grid2">
          <label className="field"><span>{t('קטגוריה')}</span>
            <select className="sel" value={category} onChange={e => setCategory(e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('סוג כרטיס')}</span>
            <select className="sel" value={type} onChange={e => setType(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>
        </div>
      </form>
      <div className="dlg-foot">
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>{t('ביטול')}</button>
        <button className="btn primary" disabled={busy || (!body.trim() && !title.trim())} onClick={submit}>
          <Icon name="plus" size="sm" />{busy ? t('רגע…') : t('יצירה')}
        </button>
      </div>
    </Modal>
  );
}
