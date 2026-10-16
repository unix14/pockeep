import { useCallback, useEffect, useState } from 'react';
import { api, onUnauthorized } from './api.js';
import { StoreProvider } from './store.jsx';
import { Login, ForcePasswordChange } from './components/Login.jsx';
import Shell from './components/Shell.jsx';
import { Spinner } from './components/ui.jsx';
import { getLang, setLang } from './i18n/index.js';

export default function App() {
  const [phase, setPhase] = useState('boot'); // boot | anon | ready
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState({ allowRegistration: false });
  const [lang, setLangState] = useState(() => setLang(getLang()));
  // switching language re-renders the whole UI in the new language and direction
  const changeLang = useCallback(l => { if (l !== getLang()) setLangState(setLang(l)); }, []);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    api.me().then(r => { if (r.user) { setUser(r.user); setPhase('ready'); } else setPhase('anon'); }).catch(() => setPhase('anon'));
    return onUnauthorized(() => { setUser(null); setPhase('anon'); });
  }, []);

  const signedIn = useCallback(u => { setUser(u); setPhase('ready'); }, []);
  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* signed out anyway */ }
    delete document.documentElement.dataset.theme;
    setUser(null); setPhase('anon');
  }, []);
  const requireChange = useCallback(() => setUser(u => (u ? { ...u, mustChangePassword: true } : u)), []);

  if (phase === 'boot') return <div className="boot"><Spinner /></div>;
  if (phase === 'anon' || !user) return <Login key={lang} onSignedIn={signedIn} allowRegistration={config.allowRegistration} lang={lang} onLang={changeLang} />;
  if (user.mustChangePassword) return <ForcePasswordChange key={lang} user={user} onDone={u => setUser({ ...user, ...u, mustChangePassword: false })} onLogout={logout} lang={lang} onLang={changeLang} />;
  return (
    <StoreProvider key={user.id} user={user} onPasswordChangeRequired={requireChange} onLang={changeLang}>
      <Shell key={lang} onLogout={logout} />
    </StoreProvider>
  );
}
