import { Router } from 'express';
import { authRouter } from './auth';
import { calendarRouter } from './calendar';
import { jiraRouter } from './jira';
import { chatRouter } from './chat';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/calendar', calendarRouter);
apiRouter.use('/jira', jiraRouter);
apiRouter.use('/chat', chatRouter);

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'nl-agent-api',
    environment: process.env.APP_ENV ?? 'development',
  });
});
