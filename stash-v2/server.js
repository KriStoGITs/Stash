import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { db, verify, assert, esc, page, log } from './core.js';

const modules = [];
const moduleFiles = readdirSync(new URL('./modules/', import.meta.url))
  .filter(file => file.endsWith('.js'))
  .sort();

for (const file of moduleFiles) {
  modules.push(await import('./modules/' + file));
}

const secureCookies = process.env.COOKIE_SECURE === '1';
const sessionLifetimeSeconds = 8 * 60 * 60;
const loginCooldownMs = 15 * 60 * 1000;
const maxBodyBytes = 32768;

function cookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
}

async function readFormData(req) {
  let buffer = '';
  for await (const chunk of req) {
    buffer += chunk;
    assert(Buffer.byteLength(buffer) <= maxBodyBytes, 'Pieprasījums ir pārāk liels.', 413);
  }
  return new URLSearchParams(buffer);
}

function loadSession(ctx, cookies) {
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  if (!cookies.sid) return;

  ctx.session = db.prepare(
    'SELECT * FROM sessions WHERE token = ? AND expires > ?',
  ).get(cookies.sid, Date.now());

  if (ctx.session) {
    ctx.user = db.prepare(
      'SELECT id, name, email, role FROM users WHERE id = ?',
    ).get(ctx.session.user_id);
  }
}

function showLogin(ctx) {
  const csrf = randomBytes(24).toString('hex');
  ctx.res.setHeader('Set-Cookie', cookie('login_csrf', csrf, 900));
  ctx.send('Pieslēgties', `
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

function login(ctx, cookies) {
  const { req, res, data } = ctx;
  assert(
    cookies.login_csrf && cookies.login_csrf === data.get('csrf'),
    'Drošības tokens nav derīgs. Atveriet pieslēgšanos vēlreiz.',
    403,
  );

  const email = String(data.get('email') || '').trim().toLowerCase();
  const address = req.socket.remoteAddress;
  const limit = db.prepare('SELECT * FROM login_limits WHERE key = ?').get(address);
  assert(
    !limit || limit.until_time < Date.now() || limit.failures < 5,
    'Pārāk daudz mēģinājumu. Mēģiniet pēc 15 minūtēm.',
    429,
  );

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const password = String(data.get('password') || '');
  if (!user || password.length > 128 || !verify(password, user.password)) {
    db.prepare(`
      INSERT INTO login_limits VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        failures = CASE WHEN until_time < ? THEN 1 ELSE failures + 1 END,
        until_time = excluded.until_time
    `).run(address, Date.now() + loginCooldownMs, Date.now());
    assert(false, 'Nepareizs e-pasts vai parole.', 401);
  }

  db.prepare('DELETE FROM login_limits WHERE key = ?').run(address);

  const sessionToken = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  const expires = Date.now() + sessionLifetimeSeconds * 1000;
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
    .run(sessionToken, user.id, csrf, expires);

  res.setHeader('Set-Cookie', [
    cookie('sid', sessionToken, sessionLifetimeSeconds),
    cookie('login_csrf', '', 0),
  ]);
  log(user, 'Pieslēgšanās');
  ctx.redirect('/');
}

function showDashboard(ctx) {
  const stats = [
    ['Preču veidi', db.prepare('SELECT COUNT(*) n FROM products').get().n],
    ['Vienības noliktavā', db.prepare('SELECT COALESCE(SUM(quantity), 0) n FROM products').get().n],
    ['Aktīvi pasūtījumi', db.prepare(`
      SELECT COUNT(*) n FROM orders WHERE status IN ('Jauns', 'Apstrādē')
    `).get().n],
  ];
  const cards = stats.map(([label, count]) => `
    <section><span>${label}</span><strong>${count}</strong></section>
  `).join('');

  ctx.send('Sākums', `
    <p>Sveicināti, ${esc(ctx.user.name)}!</p>
    <div class="stats">${cards}</div>
    <section>
      <h2>Noliktavas darba vieta</h2>
      <p>Izvēlieties darbību kreisajā izvēlnē. Pieejamās sadaļas atbilst jūsu lomai.</p>
    </section>
  `);
}

function showError(ctx, error) {
  if (!error.status) console.error(error);

  const status = error.status || (error.code?.startsWith('ERR_SQLITE') ? 409 : 500);
  let message = 'Iekšēja kļūda. Mēģiniet vēlreiz.';
  if (error.status) {
    message = error.message;
  } else if (status === 409) {
    message = 'Ieraksts jau pastāv vai ir saistīts ar citiem datiem.';
  }

  ctx.send('Darbība neizdevās', `
    <p class="error" role="alert">${esc(message)}</p>
    <p><a href="${ctx.user ? '/' : '/login'}">Atgriezties</a></p>
  `, status);
}

export const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');

  const ctx = {
    req,
    res,
    url: new URL(req.url, 'http://localhost'),
    user: null,
    session: null,
  };
  ctx.send = (title, content, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(ctx, title, content));
  };
  ctx.redirect = path => {
    res.writeHead(303, { Location: path });
    res.end();
  };

  try {
    assert(['GET', 'POST'].includes(req.method), 'Metode nav atļauta.', 405);

    if (ctx.url.pathname === '/style.css' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(readFileSync(new URL('./public/style.css', import.meta.url)));
    }

    const cookies = Object.fromEntries(
      (req.headers.cookie || '').split(';').map(value => value.trim().split('=')),
    );
    loadSession(ctx, cookies);

    if (req.method === 'POST') {
      assert(
        (req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded'),
        'Nederīgs datu formāts.',
        415,
      );
      ctx.data = await readFormData(req);
    }

    if (ctx.url.pathname === '/login') {
      if (req.method === 'GET') return showLogin(ctx);
      return login(ctx, cookies);
    }

    if (!ctx.user) return ctx.redirect('/login');

    if (req.method === 'POST') {
      assert(ctx.data.get('csrf') === ctx.session.csrf, 'Drošības tokens nav derīgs.', 403);
    }

    if (ctx.url.pathname === '/logout' && req.method === 'POST') {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.session.token);
      res.setHeader('Set-Cookie', cookie('sid', '', 0));
      return ctx.redirect('/login');
    }

    if (ctx.url.pathname === '/' && req.method === 'GET') {
      return showDashboard(ctx);
    }

    for (const module of modules) {
      if (await module.route(ctx)) return;
    }

    ctx.send('Lapa nav atrasta', '<p>Atgriezieties <a href="/">sākumā</a>.</p>', 404);
  } catch (error) {
    showError(ctx, error);
  }
});

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`STASH: http://127.0.0.1:${process.env.PORT || 3000}`);
  });
}
