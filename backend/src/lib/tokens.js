import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_REUSE_GRACE_MS = 10 * 1000;
export const REFRESH_COOKIE = 'tdk_refresh';

export function signAccessToken(userId) {
  return jwt.sign({}, process.env.JWT_ACCESS_SECRET, {
    subject: String(userId),
    expiresIn: ACCESS_TTL,
    algorithm: 'HS256',
  });
}

export function signRefreshToken(userId) {
  return jwt.sign({ jti: randomUUID() }, process.env.JWT_REFRESH_SECRET, {
    subject: String(userId),
    expiresIn: REFRESH_TTL,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS,
  };
}
