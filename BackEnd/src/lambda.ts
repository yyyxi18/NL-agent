import serverless = require('serverless-http');
import { app } from './app';

// API Gateway HTTP API v2 -> Lambda -> Express routes.
export const handler = serverless(app);
