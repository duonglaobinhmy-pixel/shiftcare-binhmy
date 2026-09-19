import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('[BOOT 1] app.js loaded');

const app = express();

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || '12mb'
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: process.env.JSON_BODY_LIMIT || '12mb'
  })
);

app.use(morgan('dev'));

console.log('[BOOT 2] middleware ready');

/* =========================================================
 * HEALTH - LUÔN HOẠT ĐỘNG
 * ========================================================= */

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'shiftcare-bcare-middleware',
    status: 'UP',
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    time: new Date().toISOString()
  });
});

/* =========================================================
 * SERVER START TRƯỚC
 * ========================================================= */

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('========================================');
  console.log(' BCARE CARE / SHIFTCARE API');
  console.log('========================================');
  console.log(` Host      : ${HOST}`);
  console.log(` Port      : ${PORT}`);
  console.log(` Health    : http://127.0.0.1:${PORT}/api/health`);
  console.log('========================================');
  console.log('');

  loadApplicationModules();
});

server.on('error', error => {
  console.error('[SERVER ERROR]', error);

  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} đang bị chiếm.`);
  }
});

/* =========================================================
 * LOAD MODULE TỪNG CÁI
 * ========================================================= */

async function loadApplicationModules() {
  try {
    console.log('[IMPORT 1] auth.routes.js...');
    const { default: authRoutes } =
      await import('./routes/auth.routes.js');
    console.log('[IMPORT 1] auth.routes.js OK');

    app.use('/api/auth', authRoutes);


    console.log('[IMPORT 2] bcare.routes.js...');
    const { default: bcareRoutes } =
      await import('./routes/bcare.routes.js');
    console.log('[IMPORT 2] bcare.routes.js OK');

    app.use('/api/bcare', bcareRoutes);


    console.log('[IMPORT 3] users.routes.js...');
    const { default: usersRoutes } =
      await import('./routes/users.routes.js');
    console.log('[IMPORT 3] users.routes.js OK');

    app.use('/api/users', usersRoutes);


    console.log('[IMPORT 4] ai.routes.js...');
    const { default: aiRoutes } =
      await import('./routes/ai.routes.js');
    console.log('[IMPORT 4] ai.routes.js OK');

    app.use('/api/ai', aiRoutes);


    console.log('[IMPORT 5] medication.routes.js...');
    const { default: medicationRoutes } =
      await import('./routes/medication.routes.js');
    console.log('[IMPORT 5] medication.routes.js OK');

    app.use('/api/medication', medicationRoutes);


    console.log('[IMPORT 6] media.routes.js...');
    const { default: mediaRoutes } =
      await import('./routes/media.routes.js');
    console.log('[IMPORT 6] media.routes.js OK');

    app.use('/api/media', mediaRoutes);


    console.log('[IMPORT 7] core.routes.js...');
    const { default: coreRoutes } =
      await import('./routes/core.routes.js');
    console.log('[IMPORT 7] core.routes.js OK');

    app.use('/api', coreRoutes);


    /*
     * Database health chỉ import sau khi server đã sống.
     */
    console.log('[IMPORT 8] db.service.js...');
    const { databaseHealth } =
      await import('./services/db.service.js');
    console.log('[IMPORT 8] db.service.js OK');

    app.get('/api/health/database', async (_req, res) => {
      try {
        const database = await databaseHealth();

        return res.json({
          ok: true,
          database,
          time: new Date().toISOString()
        });
      } catch (error) {
        console.error('[DATABASE HEALTH]', error);

        return res.status(503).json({
          ok: false,
          message:
            error?.message ||
            'Không thể kiểm tra database'
        });
      }
    });


    /*
     * Retention chạy cuối cùng.
     */
    console.log(
      '[IMPORT 9] media-retention.service.js...'
    );

    const { startMediaRetentionCleanup } =
      await import(
        './services/media-retention.service.js'
      );

    console.log(
      '[IMPORT 9] media-retention.service.js OK'
    );

    try {
      startMediaRetentionCleanup();
      console.log('[MEDIA] retention started');
    } catch (error) {
      console.error(
        '[MEDIA] retention start failed:',
        error
      );
    }


    /* =====================================================
     * API 404
     * ===================================================== */

    app.use('/api', (req, res) => {
      return res.status(404).json({
        success: false,
        message:
          `Không tìm thấy API: ` +
          `${req.method} ${req.originalUrl}`
      });
    });


    /* =====================================================
     * PRODUCTION FRONTEND
     * ===================================================== */

    if (process.env.NODE_ENV === 'production') {
      const __dirname = path.dirname(
        fileURLToPath(import.meta.url)
      );

      const dist = path.resolve(
        __dirname,
        '../../client/dist'
      );

      console.log(
        `[STATIC] serving frontend: ${dist}`
      );

      app.use(
        express.static(dist, {
          maxAge: '1h'
        })
      );

      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) {
          return next();
        }

        return res.sendFile(
          path.join(dist, 'index.html')
        );
      });
    }


    console.log('');
    console.log('========================================');
    console.log(' ALL APPLICATION MODULES READY');
    console.log('========================================');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('========================================');
    console.error(' MODULE LOAD FAILED');
    console.error('========================================');
    console.error(error);
    console.error('========================================');
    console.error('');

    /*
     * Không kill server.
     * /api/health vẫn dùng được để debug.
     */
  }
}

/* =========================================================
 * GLOBAL ERROR
 * ========================================================= */

process.on('uncaughtException', error => {
  console.error('[UNCAUGHT EXCEPTION]');
  console.error(error);
});

process.on('unhandledRejection', reason => {
  console.error('[UNHANDLED REJECTION]');
  console.error(reason);
});

/* =========================================================
 * SHUTDOWN
 * ========================================================= */

function shutdown(signal) {
  console.log(`\n[${signal}] shutting down...`);

  server.close(() => {
    console.log('[SERVER] closed');
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

export default app;