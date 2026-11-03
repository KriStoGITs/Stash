import { assert } from './validation.js';
import { page } from './views.js';
import { esc } from './escape.js';

const MAX_BODY_BYTES = 32 * 1024;
const secureCookies = process.env.COOKIE_SECURE === '1';

export function cookie(name, value, age) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((value) => value.trim().split('=')));
}

export async function readForm(req) {
  assert(
    (req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded'),
    'Nederīgs datu formāts.',
    415,
  );
  // Decode once so a UTF-8 character split across chunks stays intact.
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    assert(bytes <= MAX_BODY_BYTES, 'Pieprasījums ir pārāk liels.', 413);
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function setSecurityHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

export function createContext(req, res) {
  const ctx = { req, res, url: new URL(req.url, 'http://localhost'), user: null, session: null };
  ctx.send = (title, content, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(ctx, title, content));
  };
  ctx.redirect = (location) => {
    res.writeHead(303, { Location: location });
    res.end();
  };
  return ctx;
}

export function sendError(ctx, error) {
  if (!error.status) {
    console.error(error);
  }
  const status = error.status || (error.code?.startsWith('ERR_SQLITE') ? 409 : 500);
  const message = error.status
    ? error.message
    : status === 409
      ? 'Ieraksts jau pastāv vai ir saistīts ar citiem datiem.'
      : 'Iekšēja kļūda. Mēģiniet vēlreiz.';
  ctx.send(
    'Darbība neizdevās',
    `<p class="error" role="alert">${esc(message)}</p><p><a href="${ctx.user ? '/' : '/login'}">Atgriezties</a></p>`,
    status,
  );
}
