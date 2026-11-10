import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import authRouter from './routes/auth.js';
import chatsRouter from './routes/chats.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['X-Chat-Id', 'X-User-Message-Id', 'X-Chat-Title'],
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    const databaseConnected = mongoose.connection.readyState === 1;

    res.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? 'ok' : 'unavailable',
      database: databaseConnected ? 'connected' : 'disconnected',
    });
  });

  app.use('/api/auth', rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again shortly.' },
  }), authRouter);
  app.use('/api/chats', chatsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    console.error('Request failed:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
