# NL-agent Backend

Backend foundation for NL-agent. This backend currently provides a health endpoint and local/AWS execution setup; Jira, Google OAuth/Calendar, Bedrock, and worklog business endpoints are not implemented yet.

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

For local Google sign-in, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_WORKSPACE_DOMAIN`, `FRONTEND_URL`, and a random `AUTH_COOKIE_SECRET` in `.env`. Register the exact redirect URI in the Google OAuth client. Start the API and open `http://localhost:3000/api/v1/auth/google`. The OAuth callback accepts only verified Google Workspace accounts whose `hd` claim matches one of the comma-separated configured domains. The cookie session lasts eight hours and is stateless; signing out clears the browser cookie but cannot revoke a copied cookie before it expires.

The AWS SAM template does not yet inject these authentication settings. Before deployment, store the Google client secret and cookie secret in AWS Secrets Manager, grant the Lambda role access to them, and inject the values at runtime. Use a stable `AUTH_COOKIE_SECRET` across Lambda instances and deployments, and register the production HTTPS callback URI with Google.

Planned API surface (not implemented): Google session/OIDC, Jira project and issue lookup, natural-language worklog draft, draft validation and explicit confirmation, dashboard/month summary, and optional Calendar import. Define request/response schemas before implementing frontend integration.

## Production readiness

This SAM template is a deployment skeleton, not a production-ready application. Before company use, implement and review authentication/session security, CSRF protection, per-user Jira authorization, OAuth callback/state validation, input/schema validation, rate limiting, idempotent write handling, and IAM/data-retention policies. Do not expose write endpoints until those controls and the user's confirmation flow are in place.
