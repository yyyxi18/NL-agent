# NL-agent Backend

Backend for NL-agent with Google OAuth/Calendar and optional Gemini or Bedrock event classification.

## Local development

1. Install Node.js 22 or later and npm. Node.js 24 matches the configured Lambda runtime.
2. Copy `.env.example` to `.env` and adjust local values if needed.
3. Run `npm ci` and `npm run dev`.
4. Check `GET http://localhost:3000/api/v1/health`.

The frontend runs on `http://localhost:5173` by default and is the only default browser origin allowed by CORS. Keep real credentials out of `.env.example` and source control.

## AWS deployment target

`template.yaml` is an AWS SAM starting template for:

- **API Gateway HTTP API**: public HTTPS entry point that routes requests to Lambda.
- **AWS Lambda**: runs the Express API through `serverless-http`; Node.js 24, 512 MB, 30-second timeout, arm64.
- **CloudWatch Logs**: Lambda output with a 30-day retention group.

Build and deploy from this directory with AWS SAM CLI after setting `AllowedOrigins` to the actual website origin. The current template only exposes the API; it does not create the frontend, login, Jira integration, database, or scheduled reminders.

## Planned AWS service placement

| Service | Where it belongs | Use in NL-agent |
|---|---|---|
| CloudFront + S3 | Frontend hosting, separate from this backend folder | Serve the built React/Vite site and static assets. The API is called using its API Gateway URL or a later custom domain. |
| API Gateway HTTP API | `template.yaml` | HTTPS API boundary and routing to Lambda. |
| Lambda | `template.yaml` and `src/lambda.ts` | API handlers and orchestration; handlers should remain stateless and suitable for short requests. |
| DynamoDB | Add SAM table resources and access policies once data models are agreed | User settings, project mappings, idempotency state, and minimal audit metadata. Avoid storing Jira as a shadow database. |
| Secrets Manager + KMS | Add secret references and narrowly scoped Lambda IAM permissions | OAuth client secrets and integration credentials; encrypt stored OAuth refresh tokens with KMS. Never place secrets in frontend variables or logs. |
| Bedrock Runtime | Add an integration module and narrowly scoped IAM permission | Convert natural-language input into a validated structured candidate. It must not write Jira worklogs or choose an unverified issue key. |
| Jira Cloud REST API | Call from a backend integration module in Lambda | Search accessible projects/issues, validate permissions/status, and create or update only after explicit user confirmation. |
| Google OAuth / Calendar API | Backend OAuth callback and integration modules | Authenticate the user first; request Calendar read-only access separately when Calendar import is enabled. |
| EventBridge Scheduler + SQS (later phase) | Add schedule/queue resources to SAM when reminders are implemented | Friday reminders and retryable asynchronous work; add a dead-letter queue and idempotent handlers as needed. |
| Google Chat | Backend notification integration, with credentials in Secrets Manager | Send weekly reminders after a user/team configures a destination. |
| CloudWatch + CloudTrail + WAF (later hardening) | AWS account/API edge configuration and SAM resources | Metrics/alarms, AWS control-plane audit, and API abuse protection. Avoid logging prompts, tokens, or private calendar descriptions. |

## Current API

- `GET /api/v1/health` — basic health response.
- `GET /api/v1/auth/google` — starts Google OpenID Connect sign-in.
- `GET /api/v1/auth/google/callback` — validates OAuth state and Google ID token, then sets an encrypted, HttpOnly session cookie.
- `GET /api/v1/auth/me` — returns the signed-in user's basic profile (401 when signed out).
- `POST /api/v1/auth/logout` — clears the session cookie.
- `GET /api/v1/calendar/google` — requests Google Calendar read-only consent for the signed-in user.
- `GET /api/v1/calendar/status` — returns whether that user connected a calendar.
- `GET /api/v1/calendar/events?timeMin=...&timeMax=...` — reads primary-calendar events for a date range (up to 31 days).
- `DELETE /api/v1/calendar/connection` — revokes and removes the saved calendar connection.
- `GET /api/v1/jira/connect` — starts Atlassian OAuth 2.0 authorization.
- `GET /api/v1/jira/status` — returns connected Jira sites and the selected site.
- `PUT /api/v1/jira/site` — selects an authorized Jira site by `cloudId`.
- `GET /api/v1/jira/projects` and `GET /api/v1/jira/issues` — search projects and issues in the selected site.
- `POST /api/v1/jira/worklogs` — creates worklogs only after the user confirms in the frontend.
- `DELETE /api/v1/jira/connection` — revokes the Jira connection and removes local tokens.
- `POST /api/v1/chat/events` — Google Chat App interaction endpoint; a user can link their Chat DM after connecting Calendar with the same company account.
- `GET /api/v1/chat/status` — reports whether daily reminders are enabled and the signed-in user has linked a Chat DM.

For local Google sign-in, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_WORKSPACE_DOMAIN`, `FRONTEND_URL`, and a random `AUTH_COOKIE_SECRET` in `.env`. Register the exact redirect URI in the Google OAuth client. Start the API and open `http://localhost:3000/api/v1/auth/google`. The OAuth callback accepts only verified Google Workspace accounts whose `hd` claim matches one of the comma-separated configured domains. The cookie session lasts eight hours and is stateless; signing out clears the browser cookie but cannot revoke a copied cookie before it expires.

For Calendar, enable Google Calendar API in the same Google Cloud project and register `GOOGLE_CALENDAR_REDIRECT_URI` exactly in the OAuth client. The worklogs page asks for the read-only `calendar.events.readonly` scope when the user clicks Connect. Refresh tokens are stored encrypted in `.local-data/` for local development. Calendar events are shown for the current local day; when an AI provider is configured, its work/private classification is displayed for the user to review.

For Jira Cloud, create an Atlassian OAuth 2.0 (3LO) app. Register `http://localhost:3000/api/v1/jira/oauth/callback` exactly as the callback URL and add `read:jira-work`, `read:jira-user`, and `write:jira-work` scopes. The backend also requests `offline_access` so it can rotate refresh tokens. Set `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, and `JIRA_REDIRECT_URI` in `.env`; use the NL-agent Jira connection control to authorize, select the test site, and choose a project. Jira access and refresh tokens are encrypted in `.local-data/` for local development. Lambda requires a durable encrypted store such as DynamoDB with KMS.

To enable local Gemini classification, set `GEMINI_API_KEY` in `.env`; `GEMINI_MODEL_ID` defaults to `gemini-3.8-flash`. If Gemini is not configured, the backend can use Bedrock when `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, and AWS SDK credentials are configured. If neither provider is configured, events still load and remain unclassified. The classifier sends only each event's title and start/end times to the configured AI provider; it does not send descriptions or locations. Classification is a suggestion and the user must review work events before adding them to drafts. Keep the Gemini key on the backend and store it in AWS Secrets Manager for deployment.

## Local Google Chat daily reminder

Set `DAILY_REMINDER_ENABLED=true`, `GOOGLE_CHAT_APP_AUDIENCE` to the exact audience configured for the Chat App, and `GOOGLE_CHAT_SERVICE_ACCOUNT_JSON_BASE64` to the base64-encoded Chat App service-account JSON. Also set `FRONTEND_URL` to the web app URL. Enable the Google Chat API and configure an HTTP Chat App endpoint at `https://<public-api-host>/api/v1/chat/events`; Google Chat cannot reach `localhost`, so local interaction testing needs an HTTPS tunnel. Each engineer must connect Calendar and send a message to the NL-agent Chat App DM using the same company account. The backend stores that DM mapping and sends a daily 16:30 Asia/Taipei summary of work-classified calendar events, omitting private and uncertain event titles. The message links to that day's worklogs page; it does not submit Jira worklogs.

The local scheduler runs only while `npm run dev`/`npm start` is running. The token store and DM mapping are encrypted in `.local-data/` for local development. This is not an AWS-ready scheduler: Lambda does not run the local interval and its filesystem is not durable. AWS reminders require durable encrypted storage (for example DynamoDB with KMS) and an EventBridge Scheduler target in `Asia/Taipei`, with the Chat credentials stored outside source control (for example Secrets Manager).

The AWS SAM template does not yet inject these authentication settings or provide durable Calendar token storage. Before deployment, store OAuth secrets in AWS Secrets Manager, use a durable encrypted token store (for example DynamoDB with KMS), grant the Lambda role least-privilege access, and inject the settings at runtime. The local `.local-data/` token file is not suitable for Lambda. Use a stable `AUTH_COOKIE_SECRET` across Lambda instances and deployments, and register the production HTTPS callback URI with Google.

The local encrypted token store is only for development. Before company deployment, implement durable token/DM mapping storage, secrets injection, and a timezone-aware cloud scheduler.

## Production readiness

This SAM template is a deployment skeleton, not a production-ready application. Before company use, implement and review authentication/session security, CSRF protection, per-user Jira authorization, OAuth callback/state validation, input/schema validation, rate limiting, idempotent write handling, and IAM/data-retention policies. Do not expose write endpoints until those controls and the user's confirmation flow are in place.
