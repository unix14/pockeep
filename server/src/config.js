import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
// Values copied verbatim from .env.example are treated as unset, so a known
// placeholder can never become a real password.
const secret = v => (!v || /^(replace_me|change_me)/i.test(v) ? '' : v);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(overrides = {}) {
  const dataDir = resolve(overrides.dataDir ?? env.DATA_DIR ?? join(here, '../../data'));
  const cfg = {
    env: env.NODE_ENV || 'production',
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 3000),
    dataDir,
    dbFile: overrides.dbFile ?? env.DB_FILE ?? join(dataDir, 'pockeep.db'),
    exportsDir: overrides.exportsDir ?? env.EXPORTS_DIR ?? join(dataDir, 'exports'),
    attachmentsDir: overrides.attachmentsDir ?? env.ATTACHMENTS_DIR ?? join(dataDir, 'attachments'),
    // keep a copy of every uploaded export file next to the database
    storeExports: bool(env.STORE_EXPORTS, true),
    allowRegistration: bool(env.ALLOW_REGISTRATION, false),
    sessionDays: Number(env.SESSION_DAYS || 30),
    // 'auto' marks the cookie Secure when the request arrived over HTTPS
    cookieSecure: (env.COOKIE_SECURE || 'auto').toLowerCase(),
    trustProxy: bool(env.TRUST_PROXY, false),
    // Initial accounts, created only when the database has no users yet.
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: secret(env.ADMIN_PASSWORD),          // empty: a random one is generated and printed to the log once
    seedUser: env.SEED_USER ?? 'user',               // second account; set SEED_USER= (empty) to skip it
    seedUserPassword: secret(env.SEED_USER_PASSWORD),  // empty: a random one-time password is generated and logged once
    maxImportMb: Number(env.MAX_IMPORT_MB || 25),
    maxBackupMb: Number(env.MAX_BACKUP_MB || 100),
    webDist: resolve(env.WEB_DIST || join(here, '../../web/dist')),
    logLevel: env.LOG_LEVEL || 'info',
    ...overrides
  };
  return cfg;
}
