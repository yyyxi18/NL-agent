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
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/api/v1/auth/google/callback',
  googleWorkspaceDomains: (process.env.GOOGLE_WORKSPACE_DOMAIN ?? '')
    .split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  authCookieSecret: process.env.AUTH_COOKIE_SECRET ?? '',
};
