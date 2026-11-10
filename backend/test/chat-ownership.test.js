import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { Chat } from '../src/models/Chat.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/lib/tokens.js';

process.env.JWT_ACCESS_SECRET = 'chat-test-access-secret-with-enough-entropy-123';
process.env.JWT_REFRESH_SECRET = 'chat-test-refresh-secret-with-enough-entropy-456';
process.env.AUTH_RATE_LIMIT_MAX = '100';

let mongoServer;
let server;
let baseUrl;
let userA;
let userB;

before(async () => {
  mongoServer = await MongoMemoryServer.create({ binary: { version: '8.0.5' } });
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), Chat.init(), Message.init()]);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  userA = await User.create({ email: 'user-a@example.com', passwordHash: 'test-hash-a' });
  userB = await User.create({ email: 'user-b@example.com', passwordHash: 'test-hash-b' });
});

afterEach(async () => {
  await Promise.all([
    Chat.deleteMany({}),
    Message.deleteMany({}),
    User.deleteMany({}),
  ]);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

function authHeaders(user) {
  return { authorization: `Bearer ${signAccessToken(user.id)}` };
}

async function createChat(user) {
  const response = await fetch(`${baseUrl}/api/chats`, {
    method: 'POST',
    headers: authHeaders(user),
  });
  assert.equal(response.status, 201);
  return (await response.json()).chat;
}

async function addPrivateMessage(user, chat, content = 'private conversation content') {
  return Message.create({ chatId: chat._id, userId: user._id, role: 'user', content });
}

test('user A cannot read user B messages or see B chats in the list', async () => {
  const chat = await createChat(userB);
  await addPrivateMessage(userB, chat);

  const messages = await fetch(`${baseUrl}/api/chats/${chat._id}/messages`, { headers: authHeaders(userA) });
  assert.equal(messages.status, 404);
  assert.deepEqual(await messages.json(), { error: 'Not found' });

  const list = await fetch(`${baseUrl}/api/chats`, { headers: authHeaders(userA) });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).chats, []);
});

test('user A cannot rename user B chat', async () => {
  const chat = await createChat(userB);
  const rename = await fetch(`${baseUrl}/api/chats/${chat._id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(userA), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Stolen title' }),
  });
  assert.equal(rename.status, 404);

  const ownerList = await fetch(`${baseUrl}/api/chats`, { headers: authHeaders(userB) });
  const ownerChat = (await ownerList.json()).chats[0];
  assert.equal(ownerChat.title, 'New chat');
});

test('user A cannot delete user B chat or its messages', async () => {
  const chat = await createChat(userB);
  await addPrivateMessage(userB, chat);

  const deletion = await fetch(`${baseUrl}/api/chats/${chat._id}`, {
    method: 'DELETE', headers: authHeaders(userA),
  });
  assert.equal(deletion.status, 404);

  const ownerMessages = await fetch(`${baseUrl}/api/chats/${chat._id}/messages`, { headers: authHeaders(userB) });
  assert.equal(ownerMessages.status, 200);
  assert.equal((await ownerMessages.json()).messages[0].content, 'private conversation content');
  assert.equal(await Chat.countDocuments({ _id: chat._id, userId: userB._id }), 1);
  assert.equal(await Message.countDocuments({ chatId: chat._id, userId: userB._id }), 1);
});

test('owner can rename and delete a chat, which also removes its messages', async () => {
  const chat = await createChat(userA);
  await addPrivateMessage(userA, chat, 'my content');

  const rename = await fetch(`${baseUrl}/api/chats/${chat._id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(userA), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Renamed conversation' }),
  });
  assert.equal(rename.status, 200);
  assert.equal((await rename.json()).chat.title, 'Renamed conversation');

  const deletion = await fetch(`${baseUrl}/api/chats/${chat._id}`, {
    method: 'DELETE', headers: authHeaders(userA),
  });
  assert.equal(deletion.status, 204);
  assert.equal(await Message.countDocuments({ chatId: chat._id }), 0);
});

test('chat and message collections create the required query indexes', async () => {
  const chatIndexes = await Chat.collection.indexes();
  const messageIndexes = await Message.collection.indexes();
  assert.ok(chatIndexes.some((index) => index.key.userId === 1 && index.key.updatedAt === -1));
  assert.ok(messageIndexes.some((index) => index.key.chatId === 1 && index.key.createdAt === 1));
});
