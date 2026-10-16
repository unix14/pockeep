import { verifyLogin, createSession, deleteSession, createUser, makeLoginLimiter, changeOwnPassword } from '../users.js';
import { SESSION_COOKIE } from '../constants.js';
import { HttpError } from '../errors.js';

export default async function authRoutes(app) {
  const { db, config } = app;
  const limiter = makeLoginLimiter();
  const pub = { config: { public: true } };

  const setCookie = (req, reply, token, expires) => {
    const secure = config.cookieSecure === 'true' || (config.cookieSecure === 'auto' && req.protocol === 'https');
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires: new Date(expires) });
  };
  const userOut = u => ({ id: u.id, username: u.username, role: u.role, mustChangePassword: !!u.mustChangePassword });

  app.get('/config', pub, async () => ({ allowRegistration: config.allowRegistration }));

  app.get('/me', pub, async (req, reply) => {
    // 200 with user:null when signed out, so the login page loads without a console error
    return { user: req.user ? userOut(req.user) : null };
  });

  app.post('/login', pub, async (req, reply) => {
    const { username, password } = req.body || {};
    const keys = ['ip:' + req.ip, 'u:' + String(username || '').toLowerCase()];
    if (limiter.blocked(keys)) throw new HttpError(429, 'rate_limited', 'יותר מדי ניסיונות התחברות. אפשר לנסות שוב בעוד 15 דקות.');
    const user = await verifyLogin(db, username, password);
    if (!user) { limiter.fail(keys); throw new HttpError(401, 'bad_credentials', 'שם המשתמש או הסיסמה שגויים'); }
    limiter.reset(keys);
    const { token, expires } = createSession(db, user.id, config.sessionDays, req.headers['user-agent']);
    setCookie(req, reply, token, expires);
    return { user: userOut(user) };
  });

  // Self-registration is off unless ALLOW_REGISTRATION=true. Normally the admin creates accounts.
  app.post('/register', pub, async (req, reply) => {
    if (!config.allowRegistration) throw new HttpError(403, 'registration_closed', 'ההרשמה סגורה. מנהל המערכת יוצר את החשבונות.');
    const { username, password } = req.body || {};
    const keys = ['reg:' + req.ip];
    if (limiter.blocked(keys)) throw new HttpError(429, 'rate_limited', 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד 15 דקות.');
    limiter.fail(keys);
    const user = createUser(db, { username, password });
    const { token, expires } = createSession(db, user.id, config.sessionDays, req.headers['user-agent']);
    setCookie(req, reply, token, expires);
    return { user: userOut(user) };
  });

  app.post('/logout', pub, async (req, reply) => {
    deleteSession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Reachable while a password change is pending (that's how the user clears it).
  app.post('/password', { config: { duringPasswordChange: true } }, async (req, reply) => {
    const { current, next } = req.body || {};
    changeOwnPassword(db, req.user.id, current, next);
    const { token, expires } = createSession(db, req.user.id, config.sessionDays, req.headers['user-agent']);
    setCookie(req, reply, token, expires);
    return { user: { ...userOut(req.user), mustChangePassword: false } };
  });
}
