import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, useConfirm, useToast, Spinner } from './ui.jsx';
import Icon from './Icon.jsx';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { PasswordForm } from './Login.jsx';
import { Core, CAT_COLORS, catColor, fmtDate, num, readFileText } from '../lib/util.js';
import { LANGS, getLang } from '../i18n/index.js';
import { t } from '../i18n/index.js';

const MATCH = { contains: 'הטקסט מכיל', domain: 'קישור מהדומיין', starts: 'הטקסט מתחיל ב־', regex: 'ביטוי רגולרי' };
const COLOR_HE = { slate: 'אפור', teal: 'טורקיז', green: 'ירוק', amber: 'ענבר', rose: 'ורד', indigo: 'אינדיגו', sky: 'תכלת', violet: 'סגול', brown: 'חום', orange: 'כתום', pink: 'ורוד', lime: 'ליים', cyan: 'ציאן', red: 'אדום' };

/* ---------- Rules ---------- */
function RulesTab() {
  const { rules, categories, items, actions } = useStore();
  const empty = { match: 'contains', pattern: '', category: 'inbox', labels: '' };
  const [form, setForm] = useState(empty);
  const active = useMemo(() => Object.values(items).filter(i => i.status !== 'purged'), [items]);
  const test = r => { if (!r.pattern.trim()) return null; return active.filter(it => Core.ruleMatches({ ...r, enabled: true }, it)).length; };
  const matches = test(form);
  const add = async e => {
    e.preventDefault();
    const rule = await actions.addRule({ ...form, category: form.category || null, labels: form.labels.split(',').map(s => s.trim()).filter(Boolean) });
    if (rule) setForm(empty);
  };
  const catName = id => t(categories.find(c => c.id === id)?.name || '—');
  return (
    <div className="dlg-body">
      <p className="hint">{t('כללים מופעלים רק על הודעות חדשות בייבוא הבא, לפני המיון האוטומטי. הכלל הראשון שמתאים קובע את הקטגוריה; תוויות מכל הכללים המתאימים מצטרפות.')}</p>
      <form className="box" onSubmit={add}>
        <h3>{t('כלל חדש')}</h3>
        <div className="rulerow">
          <select id="rule-match" className="sel" value={form.match} onChange={e => setForm({ ...form, match: e.target.value })}>
            {Object.entries(MATCH).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
          <input id="rule-pattern" className="inp" dir="auto" placeholder={form.match === 'domain' ? 'github.com' : t('למשל: aliexpress')} value={form.pattern} onChange={e => setForm({ ...form, pattern: e.target.value })} />
          <select id="rule-category" className="sel" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} aria-label={t('קטגוריית יעד')}>
            <option value="">{t('בלי שינוי קטגוריה')}</option>
            {categories.map(c => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
          </select>
          <input id="rule-labels" className="inp" dir="auto" placeholder={t('תוויות, מופרדות בפסיק')} value={form.labels} onChange={e => setForm({ ...form, labels: e.target.value })} />
          <button className="btn primary" disabled={!form.pattern.trim()}>{t('הוספה')}</button>
        </div>
        {matches !== null && <p className="hint">{t('מתאים ל־{n} כרטיסים קיימים (הכלל לא ישנה אותם).', { n: num(matches) })}</p>}
      </form>
      {rules.length === 0 ? <p className="hint">{t('עוד אין כללים.')}</p> : (
        <div className="scrollx"><table className="tbl">
          <thead><tr><th>{t('תנאי')}</th><th>{t('יעד')}</th><th>{t('תוויות')}</th><th className="n">{t('התאמות')}</th><th>{t('פעיל')}</th><th /></tr></thead>
          <tbody>{rules.map(r => (
            <tr key={r.id}>
              <td>{t(MATCH[r.match])} <b dir="auto">„{r.pattern}”</b></td>
              <td>{r.category ? catName(r.category) : '—'}</td>
              <td dir="auto">{r.labels.map(l => '#' + l).join(' ') || '—'}</td>
              <td className="n">{num(test(r) || 0)}</td>
              <td><input type="checkbox" checked={r.enabled} onChange={() => actions.updateRule(r.id, { enabled: !r.enabled })} aria-label={t('כלל פעיל')} /></td>
              <td><button className="iconbtn" onClick={() => actions.deleteRule(r.id)} aria-label={t('מחיקת הכלל')}><Icon name="trash" size="sm" /></button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

/* ---------- Categories ---------- */
function CategoriesTab() {
  const { categories, items, actions } = useStore();
  const confirm = useConfirm();
  // names are shown (and saved) in the current language
  const base = useMemo(() => categories.map(c => ({ ...c, name: t(c.name) })), [categories]);
  const [list, setList] = useState(base);
  useEffect(() => setList(base), [base]);
  const counts = useMemo(() => { const m = {}; for (const it of Object.values(items)) m[it.category] = (m[it.category] || 0) + 1; return m; }, [items]);
  const dirty = JSON.stringify(list) !== JSON.stringify(base);
  const upd = (i, patch) => setList(l => l.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i, d) => setList(l => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = async i => {
    const c = list[i];
    if (counts[c.id] && !(await confirm({ title: t('למחוק את „{name}”?', { name: t(c.name) }), body: t('{n} כרטיסים יעברו ל„לא ממוינים”. כללים שמפנים לקטגוריה הזו יפנו לשם גם הם.', { n: num(counts[c.id]) }), confirm: t('מחיקה'), danger: true }))) return;
    setList(l => l.filter((_, j) => j !== i));
  };
  return (
    <div className="dlg-body">
      <div className="grid gap-2">
        {list.map((c, i) => (
          <div className="catrow" key={c.id + i}>
            <span className="dot" style={{ width: 14, height: 14, borderRadius: '50%', background: catColor(c.color), justifySelf: 'center' }} />
            <input id={`cat-name-${i}`} className="inp" dir="auto" value={c.name} onChange={e => upd(i, { name: e.target.value })} aria-label={t('שם הקטגוריה')} />
            <select id={`cat-color-${i}`} className="sel" value={c.color} onChange={e => upd(i, { color: e.target.value })} aria-label={t('צבע')}>
              {CAT_COLORS.map(k => <option key={k} value={k}>{t(COLOR_HE[k])}</option>)}
            </select>
            <div className="flex gap-0.5 items-center">
              <button className="iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('למעלה')}><Icon name="chevDown" size="sm" className="rotate-180" /></button>
              <button className="iconbtn" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={t('למטה')}><Icon name="chevDown" size="sm" /></button>
              <button className="iconbtn" onClick={() => remove(i)} disabled={c.id === 'inbox'} title={c.id === 'inbox' ? t('אי אפשר למחוק את „לא ממוינים”') : t('מחיקה')} aria-label={t('מחיקה')}><Icon name="trash" size="sm" /></button>
              <span className="faint text-xs num" style={{ minWidth: 34 }}>{num(counts[c.id] || 0)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn" onClick={() => setList(l => [...l, { name: t('קטגוריה חדשה'), color: CAT_COLORS[l.length % CAT_COLORS.length], icon: 'folder' }])}><Icon name="plus" size="sm" />{t('קטגוריה חדשה')}</button>
        <span className="flex-1" />
        {dirty && <button className="btn ghost" onClick={() => setList(base)}>{t('ביטול השינויים')}</button>}
        <button className="btn primary" disabled={!dirty} onClick={() => actions.saveCategories(list)}>{t('שמירה')}</button>
      </div>
    </div>
  );
}

/* ---------- Labels ---------- */
function LabelsTab() {
  const { items, settings, actions } = useStore();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(null);
  const [nu, setNu] = useState('');
  const counts = useMemo(() => { const m = {}; for (const it of Object.values(items)) for (const l of it.labels || []) m[l] = (m[l] || 0) + 1; return m; }, [items]);
  const labels = [...new Set([...settings.labels, ...Object.keys(counts)])].sort((a, b) => a.localeCompare(b, 'he'));
  return (
    <div className="dlg-body">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const l = nu.trim().replace(/^#/, ''); if (l) { actions.addKnownLabel(l); setNu(''); } }}>
        <input id="label-new" className="inp" dir="auto" placeholder={t('תווית חדשה, למשל: עבודה')} value={nu} onChange={e => setNu(e.target.value)} />
        <button className="btn primary" disabled={!nu.trim()}>{t('הוספה')}</button>
      </form>
      {!labels.length && <p className="hint">{t('עוד אין תוויות.')}</p>}
      <div className="grid gap-1">
        {labels.map(l => (
          <div key={l} className="flex items-center gap-2" style={{ minHeight: 40 }}>
            {edit?.from === l ? (
              <form className="flex gap-2 flex-1" onSubmit={e => { e.preventDefault(); if (edit.to.trim() && edit.to !== l) actions.renameLabel(l, edit.to); setEdit(null); }}>
                <input id="label-rename" className="inp" dir="auto" value={edit.to} onChange={e => setEdit({ ...edit, to: e.target.value })} autoFocus />
                <button className="btn primary">{t('שמירה')}</button>
                <button type="button" className="btn ghost" onClick={() => setEdit(null)}>{t('ביטול')}</button>
              </form>
            ) : (<>
              <Icon name="tag" size="sm" className="text-fg3" />
              <span className="flex-1" dir="auto">{l}</span>
              <span className="faint text-xs">{t('{n} כרטיסים', { n: num(counts[l] || 0) })}</span>
              <button className="iconbtn" onClick={() => setEdit({ from: l, to: l })} aria-label={t('שינוי שם')}><Icon name="note" size="sm" /></button>
              <button className="iconbtn" aria-label={t('מחיקה')} onClick={async () => {
                if (await confirm({ title: t('למחוק את התווית #{name}?', { name: l }), body: t('התווית תוסר מ־{n} כרטיסים. הכרטיסים עצמם לא יימחקו.', { n: num(counts[l] || 0) }), confirm: t('מחיקה'), danger: true })) actions.deleteLabel(l);
              }}><Icon name="trash" size="sm" /></button>
            </>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Import history ---------- */
function ImportsTab() {
  const { imports } = useStore();
  const fmtFormat = f => ({ md: t('‎.md‎ מומר'), android: t('אנדרואיד ‎.txt‎'), ios: t('אייפון ‎.txt‎') }[f] || f || '—');
  return (
    <div className="dlg-body">
      {!imports.length ? <p className="hint">{t('עוד לא בוצע ייבוא.')}</p> : (
        <div className="scrollx"><table className="tbl">
          <thead><tr><th>{t('מתי')}</th><th>{t('קובץ')}</th><th>{t('תבנית')}</th><th className="n">{t('חדשים')}</th><th className="n">{t('קיימים')}</th><th className="n">{t('עריכות')}</th><th className="n">{t('הודעות')}</th></tr></thead>
          <tbody>{imports.map(im => (
            <tr key={im.id}>
              <td><bdi>{fmtDate(im.at.slice(0, 10), new Date(im.at).toTimeString().slice(0, 5))}</bdi></td>
              <td dir="auto">{im.fileName || '—'}</td>
              <td>{fmtFormat(im.format)}</td>
              <td className="n">{num(im.counts.newItems)}</td>
              <td className="n">{num(im.counts.present)}</td>
              <td className="n">{num(im.counts.edits)}</td>
              <td className="n">{num(im.counts.messages)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

/* ---------- Backup ---------- */
function BackupTab() {
  const { actions } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const pick = async file => {
    if (!file) return;
    try {
      const data = JSON.parse(await readFileText(file));
      if (!['pockeep', 'saved-messages'].includes(data?.app) || !Array.isArray(data.items)) throw new Error(t('הקובץ הזה אינו גיבוי של פוקיפ'));
      setPending({ data, name: file.name });
    } catch (e) { toast(e instanceof SyntaxError ? t('הקובץ אינו JSON תקין') : e.message); }
  };
  const restore = async mode => {
    if (mode === 'replace' && !(await confirm({ title: t('להחליף את כל הנתונים?'), body: t('כל הכרטיסים, הכללים והיסטוריית הייבוא הנוכחיים יימחקו ויוחלפו בתוכן הגיבוי. אי אפשר לבטל את הפעולה.'), confirm: t('החלפת הכול'), danger: true }))) return;
    setBusy(true);
    try {
      const r = await api.restore(pending.data, mode);
      actions.applyServerData(r);
      toast(t('שוחזרו {n} כרטיסים', { n: num(r.items.length) }));
      setPending(null);
    } catch (e) { toast(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="dlg-body">
      <div className="box">
        <h3>{t('ייצוא גיבוי')}</h3>
        <p className="hint">{t('קובץ JSON עם כל הכרטיסים, הכללים, הקטגוריות, התוויות והיסטוריית הייבוא של החשבון שלך.')}</p>
        <div><a className="btn" href={api.backupUrl} download><Icon name="download" size="sm" />{t('הורדת גיבוי')}</a></div>
      </div>
      <div className="box">
        <h3>{t('שחזור מגיבוי')}</h3>
        {!pending ? (<>
          <p className="hint">{t('מיזוג מוסיף כרטיסים מהגיבוי ומחליף כרטיסים זהים. כרטיסים שאינם בגיבוי נשארים.')}</p>
          <div><button className="btn" onClick={() => input.current?.click()}><Icon name="upload" size="sm" />{t('בחירת קובץ גיבוי')}</button></div>
          <input ref={input} id="restore-file" type="file" accept=".json,application/json" hidden onChange={e => pick(e.target.files?.[0])} />
        </>) : (<>
          <p><b dir="auto">{pending.name}</b> · {t('{n} כרטיסים', { n: num(pending.data.items.length) })} · {t('{n} כללים', { n: num((pending.data.rules || []).length) })}{pending.data.exportedAt ? <> · {t('מ־{date}', { date: fmtDate(pending.data.exportedAt.slice(0, 10)) })}</> : null}</p>
          {busy ? <Spinner /> : (
            <div className="flex gap-2 flex-wrap">
              <button className="btn primary" onClick={() => restore('merge')}>{t('מיזוג (מומלץ)')}</button>
              <button className="btn danger" onClick={() => restore('replace')}>{t('החלפת הכול')}</button>
              <button className="btn ghost" onClick={() => setPending(null)}>{t('ביטול')}</button>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

/* ---------- Account ---------- */
function AccountTab({ onLogout }) {
  const { user, settings, actions } = useStore();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const theme = settings.prefs?.theme || 'system';
  return (
    <div className="dlg-body">
      <div className="box">
        <h3>{t('החשבון שלך')}</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <Icon name="user" />
          <b className="ltr">{user.username}</b>
          <span className="pill">{user.role === 'admin' ? t('מנהל מערכת') : t('משתמש')}</span>
          <span className="flex-1" />
          <button className="btn" onClick={onLogout}><Icon name="logout" size="sm" className="flip" />{t('יציאה')}</button>
        </div>
      </div>
      <div className="box">
        <h3>{t('סיסמה')}</h3>
        {changing
          ? <PasswordForm username={user.username} onDone={() => { setChanging(false); toast('הסיסמה עודכנה. התנתקת משאר המכשירים.'); }} onCancel={() => setChanging(false)} />
          : <div><button className="btn" onClick={() => setChanging(true)}><Icon name="key" size="sm" />{t('החלפת סיסמה')}</button></div>}
      </div>
      <div className="box">
        <h3>{t('שפה')}</h3>
        <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label={t('שפה')}>
          {Object.entries(LANGS).map(([k, v]) => (
            <button key={k} className="chip" role="radio" aria-checked={getLang() === k} aria-pressed={getLang() === k} onClick={() => actions.setLanguage(k)}>{v.label}</button>
          ))}
        </div>
        <p className="hint">{t('השפה נשמרת בחשבון שלך ומופעלת בכל המכשירים.')}</p>
      </div>
      <div className="box">
        <h3>{t('מראה')}</h3>
        <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label={t('ערכת צבעים')}>
          {[['system', t('לפי המכשיר')], ['light', t('בהיר')], ['dark', t('כהה')]].map(([k, v]) => (
            <button key={k} className="chip" aria-pressed={theme === k} role="radio" aria-checked={theme === k} onClick={() => actions.setTheme(k)}>{v}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Users (admin) ---------- */
function UsersTab() {
  const { user: me } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'user', mustChangePassword: true });
  const [reset, setReset] = useState(null); // {id, password}
  const load = () => api.users().then(r => setUsers(r.users)).catch(e => toast(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async e => {
    e.preventDefault();
    try {
      const r = await api.createUser(form);
      setUsers(u => [...u, r.user]);
      toast(r.user.mustChangePassword ? t('החשבון {name} נוצר. בכניסה הראשונה תתבקש החלפת סיסמה.', { name: r.user.username }) : t('החשבון {name} נוצר', { name: r.user.username }));
      setForm({ username: '', password: '', role: 'user', mustChangePassword: true });
    } catch (err) { toast(err.message); }
  };
  const update = async (u, changes, msg) => {
    try { const r = await api.updateUser(u.id, changes); setUsers(list => list.map(x => (x.id === u.id ? r.user : x))); if (msg) toast(msg); return true; }
    catch (err) { toast(err.message); return false; }
  };
  const remove = async u => {
    if (!(await confirm({ title: t('למחוק את {name}?', { name: u.username }), body: t('החשבון וכל {n} הכרטיסים, הכללים והגיבויים שלו יימחקו לצמיתות.', { n: num(u.cards) }), confirm: t('מחיקת המשתמש'), danger: true }))) return;
    try { await api.deleteUser(u.id); setUsers(list => list.filter(x => x.id !== u.id)); toast('המשתמש נמחק'); }
    catch (err) { toast(err.message); }
  };

  if (!users) return <div className="dlg-body"><Spinner /></div>;
  return (
    <div className="dlg-body">
      <p className="hint">{t('מנהלים יכולים ליצור, לעדכן ולמחוק חשבונות. גם מנהל לא רואה את הכרטיסים של משתמשים אחרים.')}</p>
      <div className="scrollx"><table className="tbl">
        <thead><tr><th>{t('משתמש')}</th><th>{t('תפקיד')}</th><th className="n">{t('כרטיסים')}</th><th>{t('סיסמה')}</th><th>{t('נוצר')}</th><th /></tr></thead>
        <tbody>{users.map(u => (
          <tr key={u.id}>
            <td><b className="ltr">{u.username}</b>{u.id === me.id && <span className="faint"> {t('(את/ה)')}</span>}</td>
            <td>
              <select id={`role-${u.id}`} className="sel" style={{ height: 32, width: 'auto' }} value={u.role} disabled={u.id === me.id}
                onChange={e => update(u, { role: e.target.value }, t('התפקיד עודכן'))} aria-label={t('תפקיד')}>
                <option value="user">{t('משתמש')}</option><option value="admin">{t('מנהל מערכת')}</option>
              </select>
            </td>
            <td className="n">{num(u.cards)}</td>
            <td>{u.mustChangePassword ? <span className="pill warn">{t('זמנית — תוחלף בכניסה')}</span> : <span className="pill good">{t('פעילה')}</span>}</td>
            <td><bdi>{fmtDate(u.createdAt.slice(0, 10))}</bdi></td>
            <td>
              <div className="flex gap-1 justify-end">
                <button className="btn sm" onClick={() => setReset({ id: u.id, password: '' })}><Icon name="key" size="xs" />{t('איפוס סיסמה')}</button>
                <button className="iconbtn" disabled={u.id === me.id} onClick={() => remove(u)} title={u.id === me.id ? t('אי אפשר למחוק את עצמך') : t('מחיקה')} aria-label={t('מחיקה')}><Icon name="trash" size="sm" /></button>
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table></div>

      {reset && (
        <form className="box" onSubmit={async e => {
          e.preventDefault();
          const u = users.find(x => x.id === reset.id);
          if (await update(u, { password: reset.password, mustChangePassword: true }, t('הסיסמה של {name} אופסה. בכניסה הבאה תתבקש סיסמה חדשה.', { name: u.username }))) setReset(null);
        }}>
          <h3>{t('איפוס סיסמה ל־')}<span className="ltr">{users.find(x => x.id === reset.id)?.username}</span></h3>
          <div className="flex gap-2 flex-wrap items-end">
            <label className="field flex-1"><span>{t('סיסמה זמנית (6 תווים לפחות)')}</span>
              <input id="reset-password" className="inp ltr" type="text" autoComplete="off" value={reset.password} onChange={e => setReset({ ...reset, password: e.target.value })} autoFocus />
            </label>
            <button className="btn primary" disabled={reset.password.length < 6}>{t('איפוס')}</button>
            <button type="button" className="btn ghost" onClick={() => setReset(null)}>{t('ביטול')}</button>
          </div>
          <p className="hint">{t('המשתמש ינותק מכל המכשירים ויתבקש לבחור סיסמה חדשה בכניסה הבאה.')}</p>
        </form>
      )}

      <form className="box" onSubmit={create}>
        <h3>{t('משתמש חדש')}</h3>
        <div className="grid2">
          <label className="field"><span>{t('שם משתמש (באנגלית)')}</span>
            <input id="new-username" className="inp ltr" autoComplete="off" autoCapitalize="none" spellCheck="false" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
          </label>
          <label className="field"><span>{form.mustChangePassword ? t('סיסמה זמנית (6 תווים לפחות)') : t('סיסמה (8 תווים לפחות)')}</span>
            <input id="new-password" className="inp ltr" type="text" autoComplete="off" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="field"><span>{t('תפקיד')}</span>
            <select id="new-role" className="sel" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="user">{t('משתמש')}</option><option value="admin">{t('מנהל מערכת')}</option>
            </select>
          </label>
          <div className="field"><span>&nbsp;</span>
            <label className="toggle" style={{ minHeight: 38 }}><input type="checkbox" checked={form.mustChangePassword} onChange={e => setForm({ ...form, mustChangePassword: e.target.checked })} />{t('חייב להחליף סיסמה בכניסה הראשונה')}</label>
          </div>
        </div>
        <div><button className="btn primary" disabled={!form.username || form.password.length < (form.mustChangePassword ? 6 : 8)}><Icon name="plus" size="sm" />{t('יצירת משתמש')}</button></div>
      </form>
    </div>
  );
}

export default function Settings({ tab: initialTab = 'rules', onClose, onLogout }) {
  const { user } = useStore();
  const tabs = [
    ['rules', t('כללי מיון')], ['categories', t('קטגוריות')], ['labels', t('תוויות')], ['imports', t('היסטוריית ייבוא')], ['backup', t('גיבוי')], ['account', t('חשבון')],
    ...(user.role === 'admin' ? [['users', t('ניהול משתמשים')]] : [])
  ];
  const [tab, setTab] = useState(tabs.some(t => t[0] === initialTab) ? initialTab : 'rules');
  return (
    <Modal title={t('הגדרות')} onClose={onClose} size="wide" initialFocus={false}>
      <div className="tabs" role="tablist">
        {tabs.map(([k, v]) => <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {tab === 'rules' && <RulesTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'labels' && <LabelsTab />}
      {tab === 'imports' && <ImportsTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'account' && <AccountTab onLogout={onLogout} />}
      {tab === 'users' && user.role === 'admin' && <UsersTab />}
    </Modal>
  );
}
