import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { db, assert, esc, page } from './core.js';
import { cookie, parseCookies, readFormBody } from './lib/http.js';
import { login } from './lib/auth.js';
import * as home from './modules/00-home.js';
import * as products from './modules/10-products.js';
import * as users from './modules/20-users.js';
import * as orders from './modules/30-orders.js';
import * as placement from './modules/40-placement.js';
import * as reports from './modules/50-reports.js';

const modules = [home, products, users, orders, placement, reports];
export const server = createServer(async (req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400);
    res.end('Nederīga adrese.');
    return;
  }
  const ctx = { req, res, url, user: null, session: null };
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
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return res.end(readFileSync(new URL('./public/style.css', import.meta.url)));
    }
    if (req.method === 'POST') {
      ctx.data = await readFormBody(req);
    }

    const cookies = parseCookies(req.headers.cookie);
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
    db.prepare('DELETE FROM login_limits WHERE until_time <= ?').run(now);
    if (cookies.sid) {
      ctx.session = db
        .prepare('SELECT * FROM sessions WHERE token=? AND expires>?')
        .get(cookies.sid, now);
      if (ctx.session) {
        ctx.user = db
          .prepare('SELECT id,name,email,role FROM users WHERE id=?')
          .get(ctx.session.user_id);
      }
    }
    if (ctx.url.pathname === '/login') {
      return login(ctx, cookies);
    }
    if (!ctx.user) {
      return ctx.redirect('/login');
    }
    if (req.method === 'POST') {
      assert(ctx.data.get('csrf') === ctx.session.csrf, 'Drošības tokens nav derīgs.', 403);
    }
    if (ctx.url.pathname === '/logout' && req.method === 'POST') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(ctx.session.token);
      res.setHeader('Set-Cookie', cookie('sid', '', 0));
      return ctx.redirect('/login');
    }
    for (const mod of modules) {
      if (await mod.route(ctx)) {
        return;
      }
    }
    ctx.send('Lapa nav atrasta', '<p>Atgriezieties <a href="/">sākumā</a>.</p>', 404);
  } catch (e) {
    const constraint = e.code === 'ERR_SQLITE_ERROR' && (e.errcode & 255) === 19;
    const status = e.status || (constraint ? 409 : 500);
    if (status === 500) {
      console.error(e);
    }
    ctx.send(
      'Darbība neizdevās',
      /* HTML */ `
        <p class="error" role="alert">
          ${esc(
            e.status
              ? e.message
              : status === 409
                ? 'Ieraksts jau pastāv vai ir saistīts ar citiem datiem.'
                : 'Iekšēja kļūda. Mēģiniet vēlreiz.',
          )}
        </p>
        <p><a href="${ctx.user ? '/' : '/login'}">Atgriezties</a></p>
      `,
      status,
    );
  }
});
if (process.argv[1] === import.meta.filename) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  server.listen(port, host, () => {
    const address = host.includes(':') ? `[${host}]` : host;
    console.log(`STASH: http://${address}:${server.address().port}`);
  });
}
