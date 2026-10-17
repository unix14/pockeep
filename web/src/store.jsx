import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { api } from './api.js';
import { applyLocal, inversePatch } from './lib/util.js';

const lockedMsg = n => (n === 1 ? t('כרטיס נעול אחד לא שונה') : t('{n} כרטיסים נעולים לא שונו', { n }));
import { useToast } from './components/ui.jsx';
import { t } from './i18n/index.js';

/* App data store: the signed-in user's cards and settings, with optimistic
   updates (applied locally first, confirmed or rolled back by the server). */

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const initial = { loaded: false, error: null, items: {}, categories: [], rules: [], settings: { labels: [], prefs: {}, lastImportId: null }, imports: [], pending: 0 };

function reducer(s, a) {
  switch (a.type) {
    case 'loaded': {
      const items = {}; for (const it of a.data.items) items[it.id] = it;
      return { ...s, loaded: true, error: null, items, categories: a.data.categories, rules: a.data.rules, settings: a.data.settings, imports: a.data.imports };
    }
    case 'error': return { ...s, error: a.error };
    case 'upsert': {
      if (!a.items.length) return s;
      const items = { ...s.items }; for (const it of a.items) items[it.id] = it;
      return { ...s, items };
    }
    case 'remove': {
      const items = { ...s.items }; for (const id of a.ids) delete items[id];
      return { ...s, items };
    }
    case 'replaceItems': { const items = {}; for (const it of a.items) items[it.id] = it; return { ...s, items }; }
    case 'set': return { ...s, ...a.patch };
    case 'pending': return { ...s, pending: Math.max(0, s.pending + a.delta) };
    default: return s;
  }
}

export function StoreProvider({ user, onPasswordChangeRequired, onLang, children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const toast = useToast();
  const ref = useRef(state);
  ref.current = state;

  const track = useCallback(async fn => {
    dispatch({ type: 'pending', delta: 1 });
    try { return await fn(); } finally { dispatch({ type: 'pending', delta: -1 }); }
  }, []);

  const load = useCallback(async () => {
    try { dispatch({ type: 'loaded', data: await api.state() }); }
    catch (e) {
      if (e.code === 'password_change_required') onPasswordChangeRequired?.();
      else dispatch({ type: 'error', error: e.message });
    }
  }, [onPasswordChangeRequired]);
  useEffect(() => { load(); }, [load]);

  // language preference (per user, stored on the server)
  const prefLang = state.settings.prefs?.lang;
  useEffect(() => { if (prefLang) onLang?.(prefLang); }, [prefLang, onLang]);

  // theme preference (per user, stored on the server)
  const theme = state.settings.prefs?.theme || 'system';
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark' || theme === 'light') root.dataset.theme = theme; else delete root.dataset.theme;
  }, [theme]);

  const actions = useMemo(() => {
    const fail = e => { toast(e.message || t('משהו השתבש')); };

    // ops: [{id, patch}]; message: toast text; undo: offer an Undo action
    async function patch(ops, { message, undo = true } = {}) {
      const items = ref.current.items;
      let lockedSkipped = 0;
      const valid = ops.filter(o => {
        const it = items[o.id]; if (!it) return false;
        const s = o.patch.status;
        if (s && s !== 'active' && s !== it.status && it.locked && o.patch.locked !== false) { lockedSkipped++; return false; }
        return true;
      });
      if (!valid.length) { if (lockedSkipped) toast(lockedSkipped === 1 && ops.length === 1 ? t('הכרטיס נעול. יש לבטל את הנעילה קודם.') : lockedMsg(lockedSkipped)); return null; }
      const prev = valid.map(o => items[o.id]);
      const inverse = valid.map(o => ({ id: o.id, patch: inversePatch(items[o.id], o.patch) }));
      dispatch({ type: 'upsert', items: valid.map(o => applyLocal(items[o.id], o.patch)) });
      try {
        const res = await track(() => api.batch(valid));
        dispatch({ type: 'upsert', items: res.items });
        const skippedIds = new Set(res.skipped.map(s => s.id));
        if (skippedIds.size) {
          dispatch({ type: 'upsert', items: prev.filter(p => skippedIds.has(p.id)) });
          lockedSkipped += res.skipped.filter(s => s.reason === 'locked').length;
        }
        const labels = new Set(ref.current.settings.labels);
        let newLabel = false;
        for (const o of valid) for (const l of o.patch.labels || []) if (!labels.has(l)) { labels.add(l); newLabel = true; }
        if (newLabel) dispatch({ type: 'set', patch: { settings: { ...ref.current.settings, labels: [...labels].sort((a, b) => a.localeCompare(b, 'he')) } } });
        let msg = message;
        if (lockedSkipped) msg = `${msg ? msg + ' · ' : ''}${lockedMsg(lockedSkipped)}`;
        if (msg) {
          const inv = inverse.filter(o => !skippedIds.has(o.id));
          toast(msg, undo && inv.length ? { action: { label: t('ביטול'), run: () => patch(inv, { message: t('השינוי בוטל'), undo: false }) } } : {});
        }
        return res;
      } catch (e) {
        dispatch({ type: 'upsert', items: prev });
        fail(e);
        return null;
      }
    }

    return {
      reload: load,
      patch,
      patchOne: (id, p, opts) => patch([{ id, patch: p }], opts),
      async createItem(data) {
        try {
          const r = await track(() => api.createItem(data));
          dispatch({ type: 'upsert', items: [r.item] });
          toast(t('הכרטיס נוצר'));
          return r.item;
        } catch (e) { fail(e); return null; }
      },
      async resolve(id, action) {
        try {
          const r = await track(() => api.resolve(id, action));
          if (r.removedId) dispatch({ type: 'remove', ids: [r.removedId] });
          dispatch({ type: 'upsert', items: [r.kept, r.target].filter(Boolean) });
          toast(action === 'merge' ? t('הכרטיס אוחד עם המקור') : t('שני הכרטיסים נשמרו'));
        } catch (e) { fail(e); }
      },
      async emptyTrash() {
        try {
          const r = await track(() => api.emptyTrash());
          const ids = Object.values(ref.current.items).filter(i => i.status === 'trashed' && !i.locked).map(i => i.id);
          dispatch({ type: 'remove', ids });
          toast(!r.purged ? t('סל המחזור כבר ריק') : r.purged === 1 ? t('כרטיס אחד נמחק לצמיתות') : t('{n} כרטיסים נמחקו לצמיתות', { n: r.purged }));
        } catch (e) { fail(e); }
      },
      async saveCategories(categories) {
        try {
          const r = await track(() => api.putCategories(categories));
          dispatch({ type: 'set', patch: { categories: r.categories } });
          dispatch({ type: 'replaceItems', items: r.items });
          toast('הקטגוריות נשמרו');
          return true;
        } catch (e) { fail(e); return false; }
      },
      async addRule(rule) {
        try { const r = await track(() => api.addRule(rule)); dispatch({ type: 'set', patch: { rules: [...ref.current.rules, r.rule] } }); return r.rule; }
        catch (e) { fail(e); return null; }
      },
      async updateRule(id, changes) {
        try { const r = await track(() => api.updateRule(id, changes)); dispatch({ type: 'set', patch: { rules: ref.current.rules.map(x => (x.id === id ? r.rule : x)) } }); return r.rule; }
        catch (e) { fail(e); return null; }
      },
      async deleteRule(id) {
        try { await track(() => api.deleteRule(id)); dispatch({ type: 'set', patch: { rules: ref.current.rules.filter(x => x.id !== id) } }); toast('הכלל נמחק'); }
        catch (e) { fail(e); }
      },
      // dryRun only reports; without it the server returns the updated board
      async applyRules(dryRun = false) {
        try {
          const r = await track(() => api.applyRules(dryRun));
          if (!dryRun && r.items) dispatch({ type: 'replaceItems', items: r.items });
          return r;
        } catch (e) { fail(e); return null; }
      },
      async addKnownLabel(name) {
        const labels = [...new Set([...ref.current.settings.labels, name])];
        try { const r = await track(() => api.putLabels(labels)); dispatch({ type: 'set', patch: { settings: { ...ref.current.settings, labels: r.labels } } }); }
        catch (e) { fail(e); }
      },
      async renameLabel(from, to) {
        try {
          const r = await track(() => api.renameLabel(from, to));
          dispatch({ type: 'set', patch: { settings: { ...ref.current.settings, labels: r.labels }, rules: r.rules } });
          await load();
          toast('התווית שונתה');
        } catch (e) { fail(e); }
      },
      async deleteLabel(name) {
        try {
          const r = await track(() => api.deleteLabel(name));
          dispatch({ type: 'set', patch: { settings: { ...ref.current.settings, labels: r.labels } } });
          await load();
          toast('התווית נמחקה');
        } catch (e) { fail(e); }
      },
      async setTheme(theme) {
        const settings = ref.current.settings;
        dispatch({ type: 'set', patch: { settings: { ...settings, prefs: { ...settings.prefs, theme } } } });
        try { await api.setPrefs({ theme }); } catch (e) { fail(e); }
      },
      async setLanguage(lang) {
        const settings = ref.current.settings;
        try { await api.setPrefs({ lang }); } catch (e) { fail(e); return; }
        dispatch({ type: 'set', patch: { settings: { ...settings, prefs: { ...settings.prefs, lang } } } });
      },
      // after an import or restore the server returns the fresh lists
      applyServerData(r) {
        if (r.items) dispatch({ type: 'replaceItems', items: r.items });
        const patch = {};
        for (const k of ['categories', 'rules', 'settings', 'imports']) if (r[k]) patch[k] = r[k];
        if (Object.keys(patch).length) dispatch({ type: 'set', patch });
      }
    };
  }, [load, toast, track]);

  const value = useMemo(() => ({ ...state, user, actions }), [state, user, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
