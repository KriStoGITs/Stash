import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { assert } from './lib/validation.js';
import { handleLogin, loadSession, signOut } from './lib/auth.js';
import { showDashboard } from './lib/dashboard.js';
import {
  createContext,
  parseCookies,
  readForm,
  sendError,
  setSecurityHeaders,
} from './lib/http.js';

const routeModules = [];
const moduleDirectory = new URL('./modules/', import.meta.url);
const moduleFiles = readdirSync(moduleDirectory)
  .filter(file => file.endsWith('.js'))
  .sort();

for (const file of moduleFiles) {
  routeModules.push(await import(new URL(file, moduleDirectory)));
}

async function handleRequest(request, response) {
  setSecurityHeaders(response);
  const context = createContext(request, response);

  try {
    assert(['GET', 'POST'].includes(request.method), 'Metode nav atļauta.', 405);
    const { pathname } = context.url;

    if (pathname === '/style.css' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/css' });
      response.end(readFileSync(new URL('./public/style.css', import.meta.url)));
      return;
    }

    const cookies = parseCookies(request);
    loadSession(context, cookies);

    if (request.method === 'POST') {
      context.data = await readForm(request);
    }

    if (handleLogin(context, cookies)) return;
    if (!context.user) return context.redirect('/login');

    if (request.method === 'POST') {
      assert(context.data.get('csrf') === context.session.csrf, 'Drošības tokens nav derīgs.', 403);
    }

    if (pathname === '/logout' && request.method === 'POST') return signOut(context);
    if (pathname === '/' && request.method === 'GET') return showDashboard(context);

    for (const routeModule of routeModules) {
      if (await routeModule.route(context)) return;
    }

    context.send('Lapa nav atrasta', '<p>Atgriezieties <a href="/">sākumā</a>.</p>', 404);
  } catch (error) {
    sendError(context, error);
  }
}

export const server = createServer(handleRequest);

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';

  server.listen(port, host, () => {
    console.log(`STASH: http://${host}:${port}`);
  });
}
