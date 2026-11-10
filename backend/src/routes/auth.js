import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User, toPublicUser } from '../models/User.js';
import { REFRESH_COOKIE, refreshCookieOptions, signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
}).strict();
const BCRYPT_COST = 12;

function issueSession(res, user) {
  const refreshToken = signRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return {
    user: toPublicUser(user),
    accessToken: signAccessToken(user.id),
  };
}

router.post('/signup', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Enter a valid email and a password with at least 8 characters' });
  }

  const { email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const user = await User.create({ email, passwordHash });
    return res.status(201).json(issueSession(res, user));
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
    return res.status(400).json({ error: 'Enter a valid email and password' });
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email }).select('+passwordHash');
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.json(issueSession(res, user));
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = verifyRefreshToken(token);
    if (typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await User.findById(payload.sub);
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.json(issueSession(res, user));
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      return res.status(401).json({ error: 'Authentication required' });
    }
    throw error;
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  return res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.json({ user: toPublicUser(user) });
});

export default router;
