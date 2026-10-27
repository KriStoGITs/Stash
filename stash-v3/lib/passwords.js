import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hash(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

export function verify(password, stored) {
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(
    Buffer.from(digest, 'hex'),
    scryptSync(password, salt, 64),
  );
}
