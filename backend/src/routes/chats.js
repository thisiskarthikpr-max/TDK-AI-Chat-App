import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Chat } from '../models/Chat.js';
import { Message } from '../models/Message.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from 'express-rate-limit';
import { streamChat } from '../llm/index.js';

const router = Router();
const renameSchema = z.object({ title: z.string().trim().min(1).max(100) }).strict();
const objectIdSchema = z.string().refine((value) => mongoose.isObjectIdOrHexString(value));
const sendSchema = z.union([
  z.object({ content: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ retryUserMessageId: objectIdSchema }).strict(),
]);
const streamRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.CHAT_STREAM_RATE_LIMIT_MAX ?? 20),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many messages. Try again shortly.' },
});

function notFound(res) {
  return res.status(404).json({ error: 'Not found' });
}

router.use(requireAuth);

router.get('/', async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const requestedSkip = Number.parseInt(req.query.skip, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 50;
  const skip = Number.isInteger(requestedSkip) ? Math.max(0, Math.min(requestedSkip, 10000)) : 0;

  const chats = await Chat.find({ userId: req.userId })
    .sort({ updatedAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .select('title createdAt updatedAt')
    .lean();

  return res.json({ chats, nextSkip: chats.length === limit ? skip + limit : null });
});

router.post('/:chatId/messages', streamRateLimit, async (req, res) => {
  const parsedBody = sendSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Message must contain 1 to 8,000 characters' });
  }

  const isNewChat = req.params.chatId === 'new';
  const parsedId = isNewChat ? null : objectIdSchema.safeParse(req.params.chatId);
  if (!isNewChat && !parsedId.success) return notFound(res);

  let chat;
  if (isNewChat) {
    if (!('content' in parsedBody.data)) return res.status(400).json({ error: 'A new chat requires a message' });
    chat = await Chat.create({ userId: req.userId, title: 'New chat' });
  } else {
    chat = await Chat.findOne({ _id: parsedId.data, userId: req.userId });
    if (!chat) return notFound(res);
  }

  let userMessage;
  if ('retryUserMessageId' in parsedBody.data) {
    userMessage = await Message.findOne({
      _id: parsedBody.data.retryUserMessageId,
      chatId: chat._id,
      userId: req.userId,
      role: 'user',
    });
    if (!userMessage) return notFound(res);
  } else {
    const hadMessages = await Message.exists({ chatId: chat._id, userId: req.userId });
    userMessage = await Message.create({
      chatId: chat._id,
      userId: req.userId,
      role: 'user',
      content: parsedBody.data.content,
    });
    if (!hadMessages && chat.title === 'New chat') {
      const normalizedTitle = parsedBody.data.content.replace(/\s+/g, ' ').trim();
      chat.title = normalizedTitle.length > 50 ? `${normalizedTitle.slice(0, 49)}…` : normalizedTitle;
      await chat.save();
    }
    await Chat.updateOne({ _id: chat._id, userId: req.userId }, { $currentDate: { updatedAt: true } });
  }

  const contextDocuments = await Message.find({ chatId: chat._id, userId: req.userId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(20)
    .select('role content')
    .lean();
  const context = contextDocuments.reverse().map(({ role, content }) => ({ role, content }));

  const controller = new AbortController();
  let thinking = '';
  let content = '';
  let status = 'complete';
  let streamError = null;
  let disconnected = false;
  const sendEvent = (event) => {
    if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const onClose = () => {
    if (!res.writableEnded) {
      disconnected = true;
      controller.abort();
    }
  };

  res.on('close', onClose);
  req.on('aborted', onClose);
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Chat-Id': String(chat._id),
    'X-User-Message-Id': String(userMessage._id),
    'X-Chat-Title': chat.title,
  });
  res.flushHeaders();
  const heartbeatMs = Math.max(10, Number(process.env.SSE_HEARTBEAT_MS ?? 15000));
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': ping\n\n');
  }, heartbeatMs);

  try {
    for await (const chunk of streamChat(context, { signal: controller.signal })) {
      if (controller.signal.aborted) {
        status = 'stopped';
        break;
      }
      if (!chunk || !['thinking', 'token'].includes(chunk.type) || typeof chunk.text !== 'string') {
        throw new Error('LLM provider returned an invalid stream chunk');
      }
      if (chunk.type === 'thinking') thinking += chunk.text;
      else content += chunk.text;
      sendEvent(chunk);
    }
    if (controller.signal.aborted) status = 'stopped';
  } catch (error) {
    status = controller.signal.aborted || error?.name === 'AbortError' ? 'stopped' : 'error';
    if (status === 'error') {
      streamError = 'The model could not complete this response. Please retry.';
      console.error('LLM stream failed:', error.message);
    }
  } finally {
    clearInterval(heartbeat);
    res.off('close', onClose);
    req.off('aborted', onClose);
  }

  const assistantMessage = await Message.create({
    chatId: chat._id,
    userId: req.userId,
    role: 'assistant',
    content,
    thinking,
    status,
  });
  await Chat.updateOne({ _id: chat._id, userId: req.userId }, { $currentDate: { updatedAt: true } });

  if (!disconnected && !res.destroyed && !res.writableEnded) {
    if (streamError) {
      sendEvent({ type: 'error', error: streamError, chatId: String(chat._id), userMessageId: String(userMessage._id), messageId: String(assistantMessage._id) });
    } else {
      sendEvent({ type: 'done', chatId: String(chat._id), userMessageId: String(userMessage._id), messageId: String(assistantMessage._id), status });
    }
    res.end();
  }
});

router.post('/', async (req, res) => {
  const chat = await Chat.create({ userId: req.userId, title: 'New chat' });
  return res.status(201).json({ chat });
});

router.get('/:chatId/messages', async (req, res) => {
  const parsedId = objectIdSchema.safeParse(req.params.chatId);
  if (!parsedId.success) return notFound(res);

  const ownerFilter = { _id: parsedId.data, userId: req.userId };
  const chat = await Chat.findOne(ownerFilter).select('_id').lean();
  if (!chat) return notFound(res);

  const messages = await Message.find({ chatId: chat._id, userId: req.userId })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return res.json({ messages });
});

router.patch('/:chatId', async (req, res) => {
  const parsedId = objectIdSchema.safeParse(req.params.chatId);
  const parsedBody = renameSchema.safeParse(req.body);
  if (!parsedId.success) return notFound(res);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Title must be between 1 and 100 characters' });
  }

  const chat = await Chat.findOneAndUpdate(
    { _id: parsedId.data, userId: req.userId },
    { $set: { title: parsedBody.data.title } },
    { returnDocument: 'after', runValidators: true, select: 'title createdAt updatedAt' },
  ).lean();
  if (!chat) return notFound(res);
  return res.json({ chat });
});

router.delete('/:chatId', async (req, res) => {
  const parsedId = objectIdSchema.safeParse(req.params.chatId);
  if (!parsedId.success) return notFound(res);

  const chat = await Chat.findOneAndDelete({ _id: parsedId.data, userId: req.userId }).select('_id').lean();
  if (!chat) return notFound(res);

  await Message.deleteMany({ chatId: chat._id, userId: req.userId });
  return res.status(204).end();
});

export default router;
