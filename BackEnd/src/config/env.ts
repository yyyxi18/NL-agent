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
  googleCalendarRedirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? 'http://localhost:3000/api/v1/calendar/google/callback',
  jiraClientId: process.env.JIRA_CLIENT_ID ?? '',
  jiraClientSecret: process.env.JIRA_CLIENT_SECRET ?? '',
  jiraRedirectUri: process.env.JIRA_REDIRECT_URI ?? 'http://localhost:3000/api/v1/jira/oauth/callback',
  googleWorkspaceDomains: (process.env.GOOGLE_WORKSPACE_DOMAIN ?? '')
    .split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  authCookieSecret: process.env.AUTH_COOKIE_SECRET ?? '',
  bedrockRegion: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? '',
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModelId: process.env.GEMINI_MODEL_ID ?? 'gemini-3.8-flash',
  googleChatServiceAccountJson: process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON ?? '',
  googleChatServiceAccountJsonBase64: process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON_BASE64 ?? '',
  googleChatAppAudience: process.env.GOOGLE_CHAT_APP_AUDIENCE ?? '',
  dailyReminderEnabled: process.env.DAILY_REMINDER_ENABLED === 'true',
};
