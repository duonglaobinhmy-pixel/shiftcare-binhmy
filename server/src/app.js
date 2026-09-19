import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.routes.js';
import bcareRoutes from './routes/bcare.routes.js';
import usersRoutes from './routes/users.routes.js';
import coreRoutes from './routes/core.routes.js';
import aiRoutes from './routes/ai.routes.js';
import medicationRoutes from './routes/medication.routes.js';

import { startMediaRetentionCleanup } from './services/media-retention.service.js';
import { databaseHealth } from './services/db.service.js';
import mediaRoutes from './routes/media.routes.js';

app.use('/api/media', mediaRoutes);
const app = express();

app.use('/api/media', mediaRoutes);

const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (
      process.env.NODE_ENV !== 'production' ||
      allowedOrigins.length === 0 ||
      allowedOrigins.includes(origin)
    ) {
      return callback(null, true);
    }

    const error = new Error('Origin không được phép');
    error.status = 403;
    return callback(error);
  },
  credentials: true
}));

app.use(express.json({ limit: '8mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

startMediaRetentionCleanup();

app.get('/api/health', async (_req, res) => {
  const database = await databaseHealth();

  res.json({
    ok: true,
    service: 'shiftcare-bcare-middleware',
    database,
    architecture: 'BCARE_API_SOURCE_OF_TRUTH_PLUS_LOCAL_CARE_EXTENSIONS',
    pwa: true,
    ai: process.env.GEMINI_API_KEY ? 'GEMINI' : 'LOCAL_DEMO',
    telegramAlerts: Boolean(
      process.env.TELEGRAM_BOT_TOKEN &&
      process.env.TELEGRAM_ALERT_CHAT_ID
    ),
    time: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/bcare', bcareRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/medication', medicationRoutes);
app.use('/api', coreRoutes);

if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(__dirname, '../../client/dist');

  app.use(express.static(dist, {
    maxAge: '1h'
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }

    return res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);

  const status = Number(
    err?.status ||
    err?.statusCode ||
    500
  );

  res.status(status).json({
    success: false,
    message: err?.message || 'Lỗi hệ thống'
  });
});

const port = Number(process.env.PORT || 8788);

app.listen(port, '0.0.0.0', () => {
  console.log(`ShiftCare API listening on :${port}`);
});