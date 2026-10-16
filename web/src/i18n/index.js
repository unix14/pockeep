import en from './en.js';

/* Minimal i18n. Hebrew is the source language: UI strings are written in Hebrew
   and wrapped in t(); other languages map each Hebrew string to a translation.
   Missing translations fall back to the Hebrew text. Placeholders use {name}.
   (A dedicated TranslationsCenter is on the roadmap; see ROADMAP.md.) */

export const LANGS = {
  he: { label: 'עברית', dir: 'rtl', locale: 'he-IL' },
  en: { label: 'English', dir: 'ltr', locale: 'en-GB' }
};
const DICTS = { en };
const KEY = 'pockeep.lang';

function initial() {
  try { const v = localStorage.getItem(KEY); if (LANGS[v]) return v; } catch { /* storage unavailable */ }
  return 'he';
}
let current = initial();

export const getLang = () => current;
export const isRtl = () => LANGS[current].dir === 'rtl';
export const locale = () => LANGS[current].locale;

export function t(text, vars) {
  let out = (current !== 'he' && DICTS[current]?.[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}

// Applies the language to the document and remembers it in this browser.
export function setLang(lang) {
  if (!LANGS[lang]) lang = 'he';
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* storage unavailable */ }
  const root = document.documentElement;
  root.lang = lang;
  root.dir = LANGS[lang].dir;
  document.title = t('פוקיפ');
  return lang;
}
