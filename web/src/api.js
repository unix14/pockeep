import { t, getLang } from './i18n/index.js';
/* API client for the pockeep server. Cookie-based session; every
   state-changing call carries the CSRF header the server requires. */

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const listeners = new Set();
export const onUnauthorized = fn => { listeners.add(fn); return () => listeners.delete(fn); };

async function request(method, url, { json, text, headers = {}, allow401 = false } = {}) {
  const h = { 'x-requested-with': 'pockeep', 'x-pockeep-lang': getLang(), ...headers };
  let body;
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (text !== undefined) { h['content-type'] = 'text/plain; charset=utf-8'; body = text; }
  let res;
  try {
    res = await fetch(url, { method, headers: h, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', t('אין חיבור לשרת. כדאי לבדוק את החיבור ולנסות שוב.'));
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && !allow401) listeners.forEach(fn => fn());
    throw new ApiError(res.status, data.code || 'error', data.error || t('הבקשה נכשלה ({status})', { status: res.status }));
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  // auth
  config: () => request('GET', '/api/auth/config'),
  me: () => request('GET', '/api/auth/me', { allow401: true }),
  login: (username, password) => request('POST', '/api/auth/login', { json: { username, password }, allow401: true }),
  register: (username, password) => request('POST', '/api/auth/register', { json: { username, password } }),
  logout: () => request('POST', '/api/auth/logout', { json: {} }),
  changePassword: (current, next) => request('POST', '/api/auth/password', { json: { current, next } }),

  // data
  state: () => request('GET', '/api/state'),
  patchItem: (id, patch) => request('PATCH', `/api/items/${enc(id)}`, { json: { patch } }),
  batch: ops => request('POST', '/api/items/batch', { json: { ops } }),
  resolve: (id, action) => request('POST', `/api/items/${enc(id)}/resolve`, { json: { action } }),
  emptyTrash: () => request('POST', '/api/trash/empty', { json: {} }),
  putCategories: categories => request('PUT', '/api/categories', { json: { categories } }),
  addRule: rule => request('POST', '/api/rules', { json: rule }),
  updateRule: (id, rule) => request('PATCH', `/api/rules/${id}`, { json: rule }),
  deleteRule: id => request('DELETE', `/api/rules/${id}`),
  putLabels: labels => request('PUT', '/api/labels', { json: { labels } }),
  renameLabel: (from, to) => request('POST', '/api/labels/rename', { json: { from, to } }),
  deleteLabel: name => request('POST', '/api/labels/delete', { json: { name } }),
  setPrefs: prefs => request('PATCH', '/api/settings', { json: { prefs } }),

  // imports & backup
  previewImport: (text, fileName) => request('POST', '/api/imports/preview', { text, headers: { 'x-file-name': encodeFileName(fileName) } }),
  commitImport: token => request('POST', `/api/imports/${enc(token)}/commit`, { json: {} }),
  imports: () => request('GET', '/api/imports'),
  backupUrl: '/api/backup',
  restore: (backup, mode) => request('POST', '/api/backup/restore', { json: { backup, mode } }),

  // admin: user management
  users: () => request('GET', '/api/admin/users'),
  createUser: user => request('POST', '/api/admin/users', { json: user }),
  updateUser: (id, changes) => request('PATCH', `/api/admin/users/${id}`, { json: changes }),
  deleteUser: id => request('DELETE', `/api/admin/users/${id}`)
};

// HTTP headers must be Latin-1, so the (often Hebrew) file name is URL-encoded.
function encodeFileName(name = '') {
  return encodeURIComponent(name.slice(0, 200)) || 'export';
}
