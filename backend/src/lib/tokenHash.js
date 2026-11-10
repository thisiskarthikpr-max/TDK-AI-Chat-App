import { createHash } from 'node:crypto';

export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
