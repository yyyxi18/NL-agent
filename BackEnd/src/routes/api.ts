import { Router } from 'express';
import { authRouter } from './auth';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'nl-agent-api',
    environment: process.env.APP_ENV ?? 'development',
  });
});
