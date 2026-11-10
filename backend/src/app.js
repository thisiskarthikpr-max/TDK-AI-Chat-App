import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173', credentials: true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const databaseConnected = mongoose.connection.readyState === 1;

    res.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? 'ok' : 'unavailable',
      database: databaseConnected ? 'connected' : 'disconnected',
    });
  });

  return app;
}
