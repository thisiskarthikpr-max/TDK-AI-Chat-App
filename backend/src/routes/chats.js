import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Chat } from '../models/Chat.js';
import { Message } from '../models/Message.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
const renameSchema = z.object({ title: z.string().trim().min(1).max(100) }).strict();
const objectIdSchema = z.string().refine((value) => mongoose.isObjectIdOrHexString(value));

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
