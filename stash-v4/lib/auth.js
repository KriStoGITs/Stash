import { randomBytes } from 'node:crypto';
import { db, verify, assert, log } from '../core.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const MAX_LOGIN_FAILURES = 5;
const secure = process.env.COOKIE_SECURE === '1';
export const cookie = (name, value, age) =>
  `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;

export function loadSession(ctx) {
  const { req } = ctx;
  const cookies = Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((cookiePart) => cookiePart.trim().split('=')),
  );
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  if (cookies.sid) {
    ctx.session = db
      .prepare('SELECT * FROM sessions WHERE token=? AND expires>?')
      .get(cookies.sid, Date.now());
    if (ctx.session) {
      ctx.user = db
        .prepare('SELECT id,name,email,role FROM users WHERE id=?')
        .get(ctx.session.user_id);
    }
  }

  return cookies;
}

export function handleLogin(ctx, cookies) {
  const { req, res } = ctx;

  if (req.method === 'GET') {
    const csrf = randomBytes(24).toString('hex');
    res.setHeader(
      'Set-Cookie',
      cookie('login_csrf', csrf, LOGIN_WINDOW_MS / 1000),
    );
    return ctx.send(
      'Pieslēgties',
      `<p>Pieslēdzieties ar uzņēmuma piešķirto kontu.</p><form method="post" action="/login"><input type="hidden" name="csrf" value="${csrf}"><label>E-pasts<input name="email" type="email" required maxlength="160" autocomplete="username"></label><label>Parole<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><button>Pieslēgties</button></form>`,
    );
  }
  assert(
    cookies.login_csrf && cookies.login_csrf === ctx.data.get('csrf'),
    'Drošības tokens nav derīgs. Atveriet pieslēgšanos vēlreiz.',
    403,
  );
  const email = String(ctx.data.get('email') || '')
    .trim()
    .toLowerCase();
  const key = req.socket.remoteAddress;
  const limit = db.prepare('SELECT * FROM login_limits WHERE key=?').get(key);
  assert(
    !limit ||
      limit.until_time < Date.now() ||
      limit.failures < MAX_LOGIN_FAILURES,
    'Pārāk daudz mēģinājumu. Mēģiniet pēc 15 minūtēm.',
    429,
  );
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const password = String(ctx.data.get('password') || '');
  if (!user || password.length > 128 || !verify(password, user.password)) {
    db.prepare(
      'INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN until_time<? THEN 1 ELSE failures+1 END, until_time=excluded.until_time',
    ).run(key, Date.now() + LOGIN_WINDOW_MS, Date.now());
    assert(false, 'Nepareizs e-pasts vai parole.', 401);
  }
  db.prepare('DELETE FROM login_limits WHERE key=?').run(key);
  const sid = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
    sid,
    user.id,
    randomBytes(24).toString('hex'),
    Date.now() + SESSION_DURATION_SECONDS * 1000,
  );
  res.setHeader('Set-Cookie', [
    cookie('sid', sid, SESSION_DURATION_SECONDS),
    cookie('login_csrf', '', 0),
  ]);
  log(user, 'Pieslēgšanās');
  return ctx.redirect('/');
}
