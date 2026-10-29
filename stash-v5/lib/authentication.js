import { randomBytes } from 'node:crypto';
import { db, recordAudit } from './database.js';
import { verifyPassword } from './passwords.js';
import { assert } from './validation.js';
import { cookie } from './http.js';

export function login(ctx, cookies) {
  const { req, res } = ctx;
  if (req.method === 'GET') {
    const csrf = randomBytes(24).toString('hex');
    res.setHeader('Set-Cookie', cookie('login_csrf', csrf, 900));
    return ctx.send(
      'Pieslēgties',
      [
        `<p>Pieslēdzieties ar uzņēmuma piešķirto kontu.</p><form method="post" action="/login"><input type="hidden" name="csrf" value="${csrf}">`,
        '<label>E-pasts<input name="email" type="email" required maxlength="160" autocomplete="username"></label>',
        '<label>Parole<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><button>Pieslēgties</button></form>',
      ].join(''),
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
    !limit || limit.until_time < Date.now() || limit.failures < 5,
    'Pārāk daudz mēģinājumu. Mēģiniet pēc 15 minūtēm.',
    429,
  );
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const password = String(ctx.data.get('password') || '');
  if (!user || password.length > 128 || !verifyPassword(password, user.password)) {
    db.prepare(
      'INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN until_time<? THEN 1 ELSE failures+1 END, until_time=excluded.until_time',
    ).run(key, Date.now() + 900000, Date.now());
    assert(false, 'Nepareizs e-pasts vai parole.', 401);
  }
  db.prepare('DELETE FROM login_limits WHERE key=?').run(key);
  const sid = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
    sid,
    user.id,
    randomBytes(24).toString('hex'),
    Date.now() + 8 * 3600000,
  );
  res.setHeader('Set-Cookie', [cookie('sid', sid, 28800), cookie('login_csrf', '', 0)]);
  recordAudit(user, 'Pieslēgšanās');
  return ctx.redirect('/');
}
