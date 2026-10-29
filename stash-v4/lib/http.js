import { assert } from './validation.js';

const MAX_BODY_BYTES = 32 * 1024;

export async function readFormBody(req) {
  let buffer = '';
  for await (const part of req) {
    buffer += part;
    assert(
      Buffer.byteLength(buffer) <= MAX_BODY_BYTES,
      'Pieprasījums ir pārāk liels.',
      413,
    );
  }
  return new URLSearchParams(buffer);
}
