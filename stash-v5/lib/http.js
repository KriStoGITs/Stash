import { assert } from './validation.js';

const secure = process.env.COOKIE_SECURE === '1';
export const cookie = (name, value, age) =>
  `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
export async function readBody(req) {
  let buffer = '';
  for await (const part of req) {
    buffer += part;
    assert(Buffer.byteLength(buffer) <= 32768, 'Pieprasījums ir pārāk liels.', 413);
  }
  return new URLSearchParams(buffer);
}
