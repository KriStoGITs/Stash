import { showDashboard } from './lib/dashboard.js';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { cookie, loadSession, handleLogin } from './lib/auth.js';
import { readFormBody } from './lib/http.js';
import { db, assert, esc, page } from './core.js';
const routeModules = [];
for (const file of readdirSync(new URL('./modules/', import.meta.url))
  .filter((fileName) => fileName.endsWith('.js'))
  .sort()) {
  routeModules.push(await import('./modules/' + file));
}
export const server = createServer(async (req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
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
  ctx.redirect = (path) => {
    res.writeHead(303, { Location: path });
    res.end();
  };
  try {
    assert(['GET', 'POST'].includes(req.method), 'Metode nav atļauta.', 405);
    if (ctx.url.pathname === '/style.css' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(
        readFileSync(new URL('./public/style.css', import.meta.url)),
      );
    }
    const cookies = loadSession(ctx);
    if (req.method === 'POST') {
      assert(
        (req.headers['content-type'] || '').startsWith(
          'application/x-www-form-urlencoded',
        ),
        'Nederīgs datu formāts.',
        415,
      );
      ctx.data = await readFormBody(req);
    }
    if (ctx.url.pathname === '/login') {
      return handleLogin(ctx, cookies);
    }
    if (!ctx.user) {
      return ctx.redirect('/login');
    }
    if (req.method === 'POST') {
      assert(
        ctx.data.get('csrf') === ctx.session.csrf,
        'Drošības tokens nav derīgs.',
        403,
      );
    }
    if (ctx.url.pathname === '/logout' && req.method === 'POST') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(ctx.session.token);
      res.setHeader('Set-Cookie', cookie('sid', '', 0));
      return ctx.redirect('/login');
    }
    if (ctx.url.pathname === '/' && req.method === 'GET') {
      return showDashboard(ctx);
    }
    for (const routeModule of routeModules) {
      if (await routeModule.route(ctx)) {
        return;
      }
    }
    ctx.send(
      'Lapa nav atrasta',
      '<p>Atgriezieties <a href="/">sākumā</a>.</p>',
      404,
    );
  } catch (error) {
    if (!error.status) {
      console.error(error);
    }
    const status =
      error.status || (error.code?.startsWith('ERR_SQLITE') ? 409 : 500);
    ctx.send(
      'Darbība neizdevās',
      `<p class="error" role="alert">${esc(error.status ? error.message : status === 409 ? 'Ieraksts jau pastāv vai ir saistīts ar citiem datiem.' : 'Iekšēja kļūda. Mēģiniet vēlreiz.')}</p><p><a href="${ctx.user ? '/' : '/login'}">Atgriezties</a></p>`,
      status,
    );
  }
});
if (process.argv[1] === import.meta.filename) {
  server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || '127.0.0.1',
    () => console.log(`STASH: http://127.0.0.1:${process.env.PORT || 3000}`),
  );
}
