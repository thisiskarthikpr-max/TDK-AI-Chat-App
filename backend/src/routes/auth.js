import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User, toPublicUser } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { hashRefreshToken } from '../lib/tokenHash.js';
import { REFRESH_COOKIE, REFRESH_REUSE_GRACE_MS, REFRESH_TTL_MS, refreshCookieOptions, signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
const passwordSchema = z.string().min(8).max(128).refine(
  (password) => Buffer.byteLength(password, 'utf8') <= 72,
);
const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: passwordSchema,
}).strict();
const BCRYPT_COST = 12;

async function issueSession(res, user) {
  const refreshToken = signRefreshToken(user.id);
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return {
    user: toPublicUser(user),
    accessToken: signAccessToken(user.id),
  };
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

function unauthorized(res) {
  return res.status(401).json({ error: 'Authentication required' });
}

router.post('/signup', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Enter a valid email and a password between 8 and 72 UTF-8 bytes' });
  }

  const { email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const user = await User.create({ email, passwordHash });
    return res.status(201).json(await issueSession(res, user));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    throw error;
  }
});

router.post('/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Enter a valid email and password between 8 and 72 UTF-8 bytes' });
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email }).select('+passwordHash');
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.json(await issueSession(res, user));
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return unauthorized(res);

  try {
    const payload = verifyRefreshToken(token);
    if (typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) {
      clearRefreshCookie(res);
      return unauthorized(res);
    }

    const activeToken = await RefreshToken.findOneAndUpdate({
      userId: payload.sub,
      tokenHash: hashRefreshToken(token),
      consumedAt: null,
    }, {
      $set: { consumedAt: new Date() },
    });

    if (!activeToken) {
      const consumedToken = await RefreshToken.findOne({
        userId: payload.sub,
        tokenHash: hashRefreshToken(token),
      });

      if (consumedToken?.consumedAt && Date.now() - consumedToken.consumedAt.getTime() <= REFRESH_REUSE_GRACE_MS) {
        // A second tab can submit the same cookie before the first response updates the shared cookie jar.
        return res.status(409).json({ error: 'Refresh already in progress', code: 'REFRESH_IN_PROGRESS' });
      }

      // A consumed token replay outside the concurrency window indicates theft; revoke every session for this user.
      await RefreshToken.deleteMany({ userId: payload.sub });
      clearRefreshCookie(res);
      return unauthorized(res);
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      await RefreshToken.deleteMany({ userId: payload.sub });
      clearRefreshCookie(res);
      return unauthorized(res);
    }

    return res.json(await issueSession(res, user));
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      clearRefreshCookie(res);
      return unauthorized(res);
    }
    throw error;
  }
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      if (typeof payload.sub === 'string' && mongoose.isValidObjectId(payload.sub)) {
        await RefreshToken.deleteOne({
          userId: payload.sub,
          tokenHash: hashRefreshToken(token),
        });
      }
    } catch (error) {
      if (!(error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError)) throw error;
    }
  }

  clearRefreshCookie(res);
  return res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return unauthorized(res);
  return res.json({ user: toPublicUser(user) });
});

export default router;
