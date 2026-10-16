import { useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { LANGS } from '../i18n/index.js';

function LangSwitch({ lang, onLang }) {
  if (!onLang) return null;
  return (
    <div className="flex gap-1 justify-center" role="radiogroup" aria-label="Language / שפה">
      {Object.entries(LANGS).map(([k, v]) => (
        <button key={k} type="button" className="chip" role="radio" aria-checked={lang === k} aria-pressed={lang === k} onClick={() => onLang(k)}>{v.label}</button>
      ))}
    </div>
  );
}
import { t } from '../i18n/index.js';

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark"><Icon name="message" /></div>
      <div>
        <div className="text-[19px] font-semibold tracking-tight">{t('פוקיפ')}</div>
        <div className="text-xs text-fg3">{t('ההודעות ששלחת לעצמך בוואטסאפ, מסודרות')}</div>
      </div>
    </div>
  );
}

export function Login({ onSignedIn, allowRegistration, lang, onLang }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = mode === 'login' ? await api.login(username.trim(), password) : await api.register(username.trim(), password);
      onSignedIn(r.user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit} noValidate>
        <Brand />
        <div>
          <h1>{mode === 'login' ? t('כניסה') : t('יצירת חשבון')}</h1>
          <p className="mt-1">{mode === 'login' ? t('כל משתמש רואה רק את הכרטיסים שלו.') : t('בחרו שם משתמש באנגלית וסיסמה של 8 תווים לפחות.')}</p>
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <label className="field">
          <span>{t('שם משתמש')}</span>
          <input id="login-username" className="inp ltr text-left" autoComplete="username" autoCapitalize="none" spellCheck="false" value={username} onChange={e => setUsername(e.target.value)} required data-autofocus autoFocus />
        </label>
        <label className="field">
          <span>{t('סיסמה')}</span>
          <input id="login-password" className="inp ltr text-left" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary justify-center h-11" disabled={busy || !username || !password}>{busy ? t('רגע…') : mode === 'login' ? t('כניסה') : t('יצירת חשבון')}</button>
        {allowRegistration && (
          <button type="button" className="btn ghost justify-center" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? t('אין לך חשבון? הרשמה') : t('כבר יש לך חשבון? כניסה')}
          </button>
        )}
        {!allowRegistration && <p className="text-xs text-fg3">{t('אין לך חשבון? מנהל המערכת יכול לפתוח לך אחד.')}</p>}
        <LangSwitch lang={lang} onLang={onLang} />
      </form>
    </div>
  );
}

// Password change form, used for the forced first-login change and in the account settings.
export function PasswordForm({ forced, onDone, onCancel, username }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mismatch = again && next !== again;
  const short = next && next.length < 8;

  async function submit(e) {
    e.preventDefault();
    if (next !== again) { setError(t('הסיסמאות החדשות לא תואמות')); return; }
    setBusy(true); setError('');
    try { const r = await api.changePassword(current, next); onDone?.(r.user); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {/* hidden username helps password managers save the new password */}
      {username && <input type="text" autoComplete="username" value={username} readOnly hidden />}
      {error && <div className="err" role="alert">{error}</div>}
      <label className="field">
        <span>{forced ? t('הסיסמה הזמנית שקיבלת') : t('הסיסמה הנוכחית')}</span>
        <input id="pw-current" className="inp ltr text-left" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} autoFocus={forced} />
      </label>
      <label className="field">
        <span>{t('סיסמה חדשה')}</span>
        <input id="pw-next" className="inp ltr text-left" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
        {short && <span className="note-bad">{t('לפחות 8 תווים')}</span>}
      </label>
      <label className="field">
        <span>{t('הסיסמה החדשה שוב')}</span>
        <input id="pw-again" className="inp ltr text-left" type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} />
        {mismatch && <span className="note-bad">{t('הסיסמאות לא תואמות')}</span>}
      </label>
      <div className="flex gap-2 justify-end">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>{t('ביטול')}</button>}
        <button className="btn primary" disabled={busy || !current || !next || short || mismatch || next !== again}>{busy ? t('שומרים…') : t('שמירת הסיסמה')}</button>
      </div>
    </form>
  );
}

export function ForcePasswordChange({ user, onDone, onLogout, lang, onLang }) {
  return (
    <div className="login-wrap">
      <div className="login">
        <Brand />
        <div>
          <h1>{t('בחירת סיסמה חדשה')}</h1>
          <p className="mt-1">{t('שלום {name}! לפני הכניסה הראשונה צריך להחליף את הסיסמה הזמנית בסיסמה אישית (8 תווים לפחות).', { name: user.username })}</p>
        </div>
        <PasswordForm forced username={user.username} onDone={onDone} />
        <button type="button" className="btn ghost justify-center" onClick={onLogout}><Icon name="logout" size="sm" className="flip" />{t('יציאה')}</button>
        <LangSwitch lang={lang} onLang={onLang} />
      </div>
    </div>
  );
}
