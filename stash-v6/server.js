import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { assert } from './lib/validation.js';
import { loadSession, handleLogin, logout } from './lib/auth.js';
import {
  createContext,
  parseCookies,
  readForm,
  sendError,
  setSecurityHeaders,
} from './lib/http.js';
import { showDashboard } from './lib/dashboard.js';

// File order also determines the order of links in the sidebar.
const featureModules = [];
const moduleFiles = readdirSync(new URL('./modules/', import.meta.url))
  .filter((file) => file.endsWith('.js'))
  .sort();
for (const file of moduleFiles) {
  featureModules.push(await import('./modules/' + file));
}

export const server = createServer(async (req, res) => {
  setSecurityHeaders(res);
  const ctx = createContext(req, res);

  try {
    assert(['GET', 'POST'].includes(req.method), 'Metode nav atļauta.', 405);

    if (ctx.url.pathname === '/style.css' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(readFileSync(new URL('./public/style.css', import.meta.url)));
    }

    const cookies = parseCookies(req.headers.cookie);
    loadSession(ctx, cookies);
    if (req.method === 'POST') ctx.data = await readForm(req);
    if (ctx.url.pathname === '/login') return handleLogin(ctx, cookies);
    if (!ctx.user) return ctx.redirect('/login');

    if (req.method === 'POST') {
      assert(ctx.data.get('csrf') === ctx.session.csrf, 'Drošības tokens nav derīgs.', 403);
    }
    if (ctx.url.pathname === '/logout' && req.method === 'POST') return logout(ctx);
    if (ctx.url.pathname === '/' && req.method === 'GET') return showDashboard(ctx);

    for (const feature of featureModules) {
      if (await feature.route(ctx)) return;
    }
    ctx.send('Lapa nav atrasta', '<p>Atgriezieties <a href="/">sākumā</a>.</p>', 404);
  } catch (error) {
    sendError(ctx, error);
  }
});

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`STASH: http://${host}:${port}`));
}
