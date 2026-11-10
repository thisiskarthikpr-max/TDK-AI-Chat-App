import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { hashRefreshToken } from '../src/lib/tokenHash.js';

process.env.JWT_ACCESS_SECRET = 'test-access-secret-with-enough-entropy-123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-with-enough-entropy-456';
process.env.AUTH_RATE_LIMIT_MAX = '100';

let mongoServer;
let server;
let baseUrl;

before(async () => {
  mongoServer = await MongoMemoryServer.create({ binary: { version: '8.0.5' } });
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), RefreshToken.init()]);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

async function signup(email = 'reader@example.com', password = 'correct horse battery') {
  return fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

function refreshCookie(response) {
  const setCookie = response.headers.getSetCookie().find((header) => header.startsWith('tdk_refresh='));
  assert.ok(setCookie, 'refresh cookie should be set');
  return setCookie.split(';', 1)[0];
}

test('signup hashes the password and returns only public user data', async () => {
  const response = await signup('Reader@Example.com');
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.user.email, 'reader@example.com');
  assert.ok(body.accessToken);
  assert.equal('passwordHash' in body.user, false);
  assert.match(response.headers.getSetCookie().join(';'), /HttpOnly/i);

  const storedUser = await User.findOne({ email: 'reader@example.com' }).select('+passwordHash');
  assert.notEqual(storedUser.passwordHash, 'correct horse battery');

  const storedRefreshToken = await RefreshToken.findOne({ userId: storedUser._id });
  const rawRefreshToken = refreshCookie(response).slice('tdk_refresh='.length);
  assert.ok(storedRefreshToken);
  assert.notEqual(storedRefreshToken.tokenHash, rawRefreshToken);
  const indexes = await RefreshToken.collection.indexes();
  assert.ok(indexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
});

test('signup rejects a duplicate email after normalization', async () => {
  assert.equal((await signup('reader@example.com')).status, 201);
  const duplicate = await signup(' Reader@Example.com ');
  assert.equal(duplicate.status, 409);
});

test('signup rejects passwords that exceed bcrypt’s 72-byte input limit', async () => {
  const tooLongAscii = await signup('long-ascii@example.com', 'a'.repeat(73));
  const tooLongUtf8 = await signup('long-utf8@example.com', '😀'.repeat(19));
  assert.equal(tooLongAscii.status, 400);
  assert.equal(tooLongUtf8.status, 400);
});

test('login accepts valid credentials and uses one generic error for invalid credentials', async () => {
  await signup();
  const validResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'READER@example.com', password: 'correct horse battery' }),
  });
  assert.equal(validResponse.status, 200);
  assert.ok((await validResponse.json()).accessToken);
  assert.match(validResponse.headers.getSetCookie().join(';'), /HttpOnly/i);

  const wrongPassword = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'reader@example.com', password: 'wrong password' }),
  });
  const unknownUser = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'unknown@example.com', password: 'wrong password' }),
  });
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongPassword.json(), await unknownUser.json());
});

test('refresh exchanges the httpOnly cookie for a new access token', async () => {
  const signupResponse = await signup();
  const cookie = refreshCookie(signupResponse);
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST', headers: { cookie },
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).accessToken);
  const rotatedCookie = refreshCookie(response);
  assert.notEqual(rotatedCookie, cookie);
  assert.match(response.headers.getSetCookie().join(';'), /HttpOnly/i);
  assert.equal(await RefreshToken.countDocuments({}), 1);
});

test('protected /me rejects missing tokens and accepts a valid bearer token', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(unauthorized.status, 401);

  const expiredToken = jwt.sign({}, process.env.JWT_ACCESS_SECRET, {
    subject: new mongoose.Types.ObjectId().toString(),
    expiresIn: -1,
    algorithm: 'HS256',
  });
  const expired = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(expired.status, 401);

  const signupResponse = await signup();
  const session = await signupResponse.json();
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.email, 'reader@example.com');
});

test('logout deletes the refresh token so it cannot restore a session', async () => {
  const signupResponse = await signup();
  const cookie = refreshCookie(signupResponse);
  assert.equal(await RefreshToken.countDocuments({}), 1);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST', headers: { cookie },
  });
  assert.equal(logout.status, 204);
  assert.equal(await RefreshToken.countDocuments({}), 0);

  const refresh = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST', headers: { cookie },
  });
  assert.equal(refresh.status, 401);
});

test('refresh token reuse revokes all refresh tokens for the user', async () => {
  const signupResponse = await signup();
  const originalCookie = refreshCookie(signupResponse);
  const rotation = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST', headers: { cookie: originalCookie },
  });
  assert.equal(rotation.status, 200);
  const rotatedCookie = refreshCookie(rotation);
  assert.equal(await RefreshToken.countDocuments({}), 1);

  const replay = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST', headers: { cookie: originalCookie },
  });
  assert.equal(replay.status, 401);
  assert.equal(await RefreshToken.countDocuments({}), 0);

  const revokedRotatedToken = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST', headers: { cookie: rotatedCookie },
  });
  assert.equal(revokedRotatedToken.status, 401);
});

test('wrong password is rejected with the generic login error', async () => {
  await signup();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'reader@example.com', password: 'not-the-password' }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Invalid email or password' });
});
