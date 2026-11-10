import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';

process.env.JWT_ACCESS_SECRET = 'test-access-secret-with-enough-entropy-123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-with-enough-entropy-456';
process.env.AUTH_RATE_LIMIT_MAX = '100';

let mongoServer;
let server;
let baseUrl;

before(async () => {
  mongoServer = await MongoMemoryServer.create({ binary: { version: '8.0.5' } });
  await mongoose.connect(mongoServer.getUri());
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await User.deleteMany({});
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
  assert.match(response.headers.getSetCookie().join(';'), /HttpOnly/i);
});

test('protected /me rejects missing tokens and accepts a valid bearer token', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(unauthorized.status, 401);

  const signupResponse = await signup();
  const session = await signupResponse.json();
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.email, 'reader@example.com');
});
