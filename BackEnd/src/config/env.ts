import { config as loadDotEnv } from 'dotenv';

// Local development only. AWS configuration is supplied through Lambda settings.
loadDotEnv();

function parseOrigins(value: string | undefined): string[] {
  return (value ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const env = {
  appEnv: process.env.APP_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
};
