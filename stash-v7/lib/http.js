import { assert } from './validation.js';

export const MAX_BODY_BYTES = 32768;
const secure = process.env.COOKIE_SECURE === '1';

export function cookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator < 1) {
        return [];
      }
      return [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
    }),
  );
}

export async function readFormBody(req) {
  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  assert(contentType === 'application/x-www-form-urlencoded', 'Nederīgs datu formāts.', 415);
  const chunks = [];
  let length = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    length += chunk.length;
    // Drain oversized requests so the server can return a useful 413 response.
    if (length > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  }
  assert(!tooLarge, 'Pieprasījums ir pārāk liels.', 413);
  // Decode once: a UTF-8 character may span multiple network chunks.
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
