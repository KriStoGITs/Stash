import { randomBytes } from 'node:crypto';
import { db, log } from './database.js';
import { hash, verify } from './passwords.js';
import { assert } from './validation.js';
import { cookie } from './http.js';

const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
// Use the same expensive password check for unknown accounts.
const dummyPassword = hash(randomBytes(32).toString('hex'));

export function login(ctx, cookies) {
  const { req, res } = ctx;
  const now = Date.now();
  if (req.method === 'GET') {
    const csrf = randomBytes(24).toString('hex');
    res.setHeader('Set-Cookie', cookie('login_csrf', csrf, 900));
    return ctx.send(
      'Pieslēgties',
      /* HTML */ `
        <p>Pieslēdzieties ar uzņēmuma piešķirto kontu.</p>
        <form method="post" action="/login">
          <input type="hidden" name="csrf" value="${csrf}" />
          <label>
            E-pasts
            <input name="email" type="email" required maxlength="160" autocomplete="username" />
          </label>
          <label>
            Parole
            <input
              name="password"
              type="password"
              required
              maxlength="128"
              autocomplete="current-password"
            />
          </label>
          <button>Pieslēgties</button>
        </form>
      `,
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
    !limit || limit.until_time <= now || limit.failures < MAX_LOGIN_FAILURES,
    'Pārāk daudz mēģinājumu. Mēģiniet pēc 15 minūtēm.',
    429,
  );
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const password = String(ctx.data.get('password') || '');
  const validPassword = password.length <= 128 && verify(password, user?.password ?? dummyPassword);
  if (!user || !validPassword) {
    db.prepare(
      `
      INSERT INTO login_limits
      VALUES (?,1,?) ON CONFLICT(key)
      DO UPDATE SET failures=CASE WHEN until_time<? THEN 1 ELSE failures+1 END, until_time=excluded.until_time
    `,
    ).run(key, now + LOGIN_WINDOW_MS, now);
    assert(false, 'Nepareizs e-pasts vai parole.', 401);
  }
  db.prepare('DELETE FROM login_limits WHERE key=?').run(key);
  if (ctx.session) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(ctx.session.token);
  }
  const sid = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
    sid,
    user.id,
    randomBytes(24).toString('hex'),
    now + SESSION_SECONDS * 1000,
  );
  res.setHeader('Set-Cookie', [cookie('sid', sid, SESSION_SECONDS), cookie('login_csrf', '', 0)]);
  log(user, 'Pieslēgšanās');
  return ctx.redirect('/');
}
