import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { db, verify, assert, esc, page, form, log } from './core.js';
const modules = [];
for (const file of readdirSync(new URL('./modules/', import.meta.url)).filter(f => f.endsWith('.js')).sort()) modules.push(await import('./modules/' + file));
const secure = process.env.COOKIE_SECURE === '1';
const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
async function body(req) {
  let buffer = '';
  for await (const part of req) {
    buffer += part;
    assert(Buffer.byteLength(buffer) <= 32768, 'Pieprasījums ir pārāk liels.', 413);
  }
  return new URLSearchParams(buffer);
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
    session: null
  };
  ctx.send = (title, content, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(ctx, title, content));
  };
  ctx.redirect = (path) => {
    res.writeHead(303, { Location: path });
    res.end();
  };
  try {
    assert(['GET', 'POST'].includes(req.method), 'Metode nav atļauta.', 405);
    if (ctx.url.pathname === '/style.css' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(readFileSync(new URL('./public/style.css', import.meta.url)));
    }
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    if (cookies.sid) {
      ctx.session = db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(cookies.sid, Date.now());
      if (ctx.session) ctx.user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(ctx.session.user_id);
    }
    if (req.method === 'POST') {
      assert((req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded'), 'Nederīgs datu formāts.', 415);
      ctx.data = await body(req);
    }
    if (ctx.url.pathname === '/login') {
      if (req.method === 'GET') {
        const csrf = randomBytes(24).toString('hex');
        res.setHeader('Set-Cookie', cookie('login_csrf', csrf, 900));
        return ctx.send('Pieslēgties', `<p>Pieslēdzieties ar uzņēmuma piešķirto kontu.</p><form method="post" action="/login"><input type="hidden" name="csrf" value="${csrf}"><label>E-pasts<input name="email" type="email" required maxlength="160" autocomplete="username"></label><label>Parole<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><button>Pieslēgties</button></form>`);
      }
      assert(cookies.login_csrf && cookies.login_csrf === ctx.data.get('csrf'), 'Drošības tokens nav derīgs. Atveriet pieslēgšanos vēlreiz.', 403);
      const email = String(ctx.data.get('email') || '').trim().toLowerCase();
      const key = req.socket.remoteAddress;
      const limit = db.prepare('SELECT * FROM login_limits WHERE key=?').get(key);
      assert(!limit || limit.until_time < Date.now() || limit.failures < 5, 'Pārāk daudz mēģinājumu. Mēģiniet pēc 15 minūtēm.', 429);
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const password = String(ctx.data.get('password') || '');
      if (!user || password.length > 128 || !verify(password, user.password)) {
        db.prepare('INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN until_time<? THEN 1 ELSE failures+1 END, until_time=excluded.until_time').run(key, Date.now() + 900000, Date.now());
        assert(false, 'Nepareizs e-pasts vai parole.', 401);
      }
      db.prepare('DELETE FROM login_limits WHERE key=?').run(key);
      const sid = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sid, user.id, randomBytes(24).toString('hex'), Date.now() + 8 * 3600000);
      res.setHeader('Set-Cookie', [cookie('sid', sid, 28800), cookie('login_csrf', '', 0)]);
      log(user, 'Pieslēgšanās');
      return ctx.redirect('/');
    }
    if (!ctx.user) return ctx.redirect('/login');
    if (req.method === 'POST') assert(ctx.data.get('csrf') === ctx.session.csrf, 'Drošības tokens nav derīgs.', 403);
    if (ctx.url.pathname === '/logout' && req.method === 'POST') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(ctx.session.token);
      res.setHeader('Set-Cookie', cookie('sid', '', 0));
      return ctx.redirect('/login');
    }
    if (ctx.url.pathname === '/' && req.method === 'GET') {
      const stats = [['Preču veidi', db.prepare('SELECT COUNT(*) n FROM products').get().n], ['Vienības noliktavā', db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM products').get().n], ['Aktīvi pasūtījumi', db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('Jauns','Apstrādē')").get().n]];
      return ctx.send('Sākums', `<p>Sveicināti, ${esc(ctx.user.name)}!</p><div class="stats">${stats.map(([a,b])=>`<section><span>${a}</span><strong>${b}</strong></section>`).join('')}</div><section><h2>Noliktavas darba vieta</h2><p>Izvēlieties darbību kreisajā izvēlnē. Pieejamās sadaļas atbilst jūsu lomai.</p></section>`);
    }
    for (const mod of modules) if (await mod.route(ctx)) return;
    ctx.send('Lapa nav atrasta', '<p>Atgriezieties <a href="/">sākumā</a>.</p>', 404);
  } catch (e) {
    if (!e.status) console.error(e);
    const status = e.status || (e.code?.startsWith('ERR_SQLITE') ? 409: 500);
    ctx.send('Darbība neizdevās', `<p class="error" role="alert">${esc(e.status?e.message:status===409?'Ieraksts jau pastāv vai ir saistīts ar citiem datiem.':'Iekšēja kļūda. Mēģiniet vēlreiz.')}</p><p><a href="${ctx.user?'/':'/login'}">Atgriezties</a></p>`, status);
  }
});
if (process.argv[1] === import.meta.filename) server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`STASH: http://127.0.0.1:${process.env.PORT||3000}`));
