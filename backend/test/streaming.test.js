import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { Chat } from '../src/models/Chat.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/lib/tokens.js';

process.env.JWT_ACCESS_SECRET = 'stream-test-access-secret-with-enough-entropy-123';
process.env.JWT_REFRESH_SECRET = 'stream-test-refresh-secret-with-enough-entropy-456';
process.env.AUTH_RATE_LIMIT_MAX = '100';
process.env.CHAT_STREAM_RATE_LIMIT_MAX = '100';
process.env.LLM_PROVIDER = 'mock';
process.env.SSE_HEARTBEAT_MS = '10';

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
  userA = await User.create({ email: 'stream-a@example.com', passwordHash: 'test-hash-a' });
  userB = await User.create({ email: 'stream-b@example.com', passwordHash: 'test-hash-b' });
});

afterEach(async () => {
  await Promise.all([Chat.deleteMany({}), Message.deleteMany({}), User.deleteMany({})]);
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
  const response = await fetch(`${baseUrl}/api/chats`, { method: 'POST', headers: authHeaders(user) });
  assert.equal(response.status, 201);
  return (await response.json()).chat;
}

function eventsFrom(text) {
  return [...text.matchAll(/^data: (.+)$/gm)].map((match) => JSON.parse(match[1]));
}

test('SSE streams thinking, word tokens, and done, and creates and titles a chat on first send', async () => {
  const response = await fetch(`${baseUrl}/api/chats/new/messages`, {
    method: 'POST',
    headers: { ...authHeaders(userA), 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Explain streaming responses with a code snippet' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const chatId = response.headers.get('x-chat-id');
  const raw = await response.text();
  const events = eventsFrom(raw);
  assert.match(raw, /: ping/);
  assert.deepEqual(events.slice(0, 2).map((event) => event.type), ['thinking', 'thinking']);
  assert.ok(events.slice(2, -1).length > 1);
  assert.ok(events.slice(2, -1).every((event) => event.type === 'token'));
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).status, 'complete');
  assert.equal(events.at(-1).chatId, chatId);

  const chat = await Chat.findById(chatId);
  assert.equal(chat.title, 'Explain streaming responses with a code snippet');
  const messages = await Message.find({ chatId }).sort({ createdAt: 1 });
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(messages[0].content, 'Explain streaming responses with a code snippet');
  assert.match(messages[1].content, /Explain streaming responses with a code snippet/);
  assert.match(messages[1].content, /```js/);
  assert.match(messages[1].thinking, /understand the request/);
});

test('client abort stops generation and persists the partial assistant response once', async () => {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/chats/new/messages`, {
    method: 'POST',
    headers: { ...authHeaders(userA), 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Please continue for a while' }),
    signal: controller.signal,
  });
  const chatId = response.headers.get('x-chat-id');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawToken = false;
  while (!sawToken) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = eventsFrom(buffer);
    sawToken = events.some((event) => event.type === 'token');
  }
  assert.equal(sawToken, true, 'mock should emit at least one token before abort');
  controller.abort();
  await reader.cancel().catch(() => {});

  let assistant;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assistant = await Message.findOne({ chatId, role: 'assistant' });
    if (assistant) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(assistant, 'partial assistant message should be saved');
  assert.equal(assistant.status, 'stopped');
  assert.ok(assistant.content.length > 0);
  assert.equal(await Message.countDocuments({ chatId, role: 'assistant' }), 1);
});

test('user B cannot stream a message into user A chat', async () => {
  const chat = await createChat(userA);
  await Message.create({ chatId: chat._id, userId: userA._id, role: 'user', content: 'Owner only' });
  const response = await fetch(`${baseUrl}/api/chats/${chat._id}/messages`, {
    method: 'POST',
    headers: { ...authHeaders(userB), 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Write into another user’s chat' }),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
  assert.equal(await Message.countDocuments({ chatId: chat._id }), 1);
});

test('stream endpoint validates the message length before saving it', async () => {
  const response = await fetch(`${baseUrl}/api/chats/new/messages`, {
    method: 'POST',
    headers: { ...authHeaders(userA), 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'x'.repeat(8001) }),
  });
  assert.equal(response.status, 400);
  assert.equal(await Chat.countDocuments({ userId: userA._id }), 0);
});
