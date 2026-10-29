import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function verifyPassword(password, stored) {
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(Buffer.from(digest, 'hex'), scryptSync(password, salt, 64));
}
