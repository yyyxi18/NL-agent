import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { env } from './config/env';
import { apiRouter } from './routes/api';

export const app: express.Application = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const startedAt = Date.now();
  res.on('finish', () => {
    // Do not log request bodies, query strings, tokens, or calendar descriptions.
    console.info(JSON.stringify({
      level: 'info',
      event: 'http_request',
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    }));
  });
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
  exposedHeaders: ['X-Request-Id'],
}));

app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', apiRouter);

app.use((_req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found' });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(JSON.stringify({ level: 'error', event: 'request_error', message: error.message }));
  res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Request failed' });
});
