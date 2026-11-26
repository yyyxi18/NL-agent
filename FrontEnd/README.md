# NL-agent Frontend

React, TypeScript, and Vite frontend for NL-agent.

## Local development

1. Install Node.js and npm.
2. Copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL` if the backend URL differs.
3. Run `npm ci` and `npm run dev`.

The current pages use clearly labeled preview data. The worklog confirmation dialog does not write to Jira. Login, Jira, Google Calendar, and natural-language parsing are not connected yet.

## Pages

- `/` — worklog overview and weekly summary.
- `/worklogs` — Calendar suggestion preview, merged worklog drafts, manual input, and monthly calendar.
- `/reports` and `/sow` — roadmap placeholders.
