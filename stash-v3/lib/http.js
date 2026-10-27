import { assert } from './validation.js';
import { esc, page } from './views.js';

const MAX_BODY_BYTES = 32_768;

export function setSecurityHeaders(response) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Cache-Control', 'no-store');
}

export function createContext(request, response) {
  const context = {
    req: request,
    res: response,
    url: new URL(request.url, 'http://localhost'),
    user: null,
    session: null,
  };

  context.send = (title, content, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page(context, title, content));
  };

  context.redirect = path => {
    response.writeHead(303, { Location: path });
    response.end();
  };

  return context;
}

export function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || '')
      .split(';')
      .map(cookie => cookie.trim().split('=')),
  );
}

export function cookie(name, value, maxAge) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

export async function readForm(request) {
  assert(
    (request.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded'),
    'Nederīgs datu formāts.',
    415,
  );

  // Decode after collecting bytes so a UTF-8 character split across chunks survives.
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    assert(size <= MAX_BODY_BYTES, 'Pieprasījums ir pārāk liels.', 413);
    chunks.push(chunk);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function sendError(context, error) {
  if (!error.status) console.error(error);

  const status = error.status || (error.code?.startsWith('ERR_SQLITE') ? 409 : 500);
  const message = error.status
    ? error.message
    : status === 409
      ? 'Ieraksts jau pastāv vai ir saistīts ar citiem datiem.'
      : 'Iekšēja kļūda. Mēģiniet vēlreiz.';

  context.send('Darbība neizdevās', `
    <p class="error" role="alert">${esc(message)}</p>
    <p><a href="${context.user ? '/' : '/login'}">Atgriezties</a></p>
  `, status);
}
