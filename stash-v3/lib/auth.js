import { randomBytes } from 'node:crypto';
import { db, log } from './database.js';
import { verify } from './passwords.js';
import { assert } from './validation.js';
import { cookie } from './http.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_LOGIN_FAILURES = 5;

export function loadSession(context, cookies) {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
  if (!cookies.sid) return;

  context.session = db.prepare(
    'SELECT * FROM sessions WHERE token = ? AND expires > ?',
  ).get(cookies.sid, now);

  if (context.session) {
    context.user = db.prepare(
      'SELECT id, name, email, role FROM users WHERE id = ?',
    ).get(context.session.user_id);
  }
}

function showLogin(context) {
  const csrf = randomBytes(24).toString('hex');
  context.res.setHeader('Set-Cookie', cookie('login_csrf', csrf, LOGIN_WINDOW_MS / 1000));
  context.send('Pieslēgties', `
    <p>Pieslēdzieties ar uzņēmuma piešķirto kontu.</p>
    <form method="post" action="/login">
      <input type="hidden" name="csrf" value="${csrf}">
      <label>E-pasts
        <input name="email" type="email" required maxlength="160" autocomplete="username">
      </label>
      <label>Parole
        <input name="password" type="password" required maxlength="128" autocomplete="current-password">
      </label>
      <button>Pieslēgties</button>
    </form>
  `);
}

function signIn(context, cookies) {
  const { req, res, data } = context;
  assert(
    cookies.login_csrf && cookies.login_csrf === data.get('csrf'),
    'Drošības tokens nav derīgs. Atveriet pieslēgšanos vēlreiz.',
    403,
  );

  const address = req.socket.remoteAddress;
  const limit = db.prepare('SELECT * FROM login_limits WHERE key = ?').get(address);
  const now = Date.now();

  assert(
    !limit || limit.until_time < now || limit.failures < MAX_LOGIN_FAILURES,
    'Pārāk daudz mēģinājumu. Mēģiniet pēc 15 minūtēm.',
    429,
  );

  const email = String(data.get('email') || '').trim().toLowerCase();
  const password = String(data.get('password') || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || password.length > 128 || !verify(password, user.password)) {
    db.prepare(`
      INSERT INTO login_limits VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        failures = CASE WHEN until_time < ? THEN 1 ELSE failures + 1 END,
        until_time = excluded.until_time
    `).run(address, now + LOGIN_WINDOW_MS, now);
    assert(false, 'Nepareizs e-pasts vai parole.', 401);
  }

  db.prepare('DELETE FROM login_limits WHERE key = ?').run(address);

  const sessionToken = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(
    sessionToken, user.id, csrf, now + SESSION_SECONDS * 1000,
  );

  res.setHeader('Set-Cookie', [
    cookie('sid', sessionToken, SESSION_SECONDS),
    cookie('login_csrf', '', 0),
  ]);
  log(user, 'Pieslēgšanās');
  context.redirect('/');
}

export function handleLogin(context, cookies) {
  if (context.url.pathname !== '/login') return false;

  if (context.req.method === 'GET') {
    showLogin(context);
  } else {
    signIn(context, cookies);
  }
  return true;
}

export function signOut(context) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(context.session.token);
  context.res.setHeader('Set-Cookie', cookie('sid', '', 0));
  context.redirect('/login');
}
