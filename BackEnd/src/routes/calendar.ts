import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { google } from 'googleapis';
import { env } from '../config/env';
import { cookieValue, getAuthSession, oauthClient, seal, setCookie, clearCookie, unseal } from './auth';
import { getCalendarRefreshToken, saveCalendarRefreshToken, removeCalendarRefreshToken } from '../services/calendarTokenStore';
import { classifyCalendarEvents } from '../services/eventClassifier';

export const calendarRouter = Router();
const CALENDAR_STATE_COOKIE = 'nl_agent_calendar_state';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const STATE_TTL_SECONDS = 10 * 60;

calendarRouter.get('/google', (req, res) => {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign in before connecting Google Calendar' });
    return;
  }
  const state = randomBytes(32).toString('base64url');
  setCookie(res, CALENDAR_STATE_COOKIE, seal(JSON.stringify({ state, sub: session.sub, exp: Date.now() + STATE_TTL_SECONDS * 1000 })), STATE_TTL_SECONDS);
  const authorizationUrl = oauthClient(env.googleCalendarRedirectUri).generateAuthUrl({
    response_type: 'code',
    scope: ['openid', 'email', CALENDAR_SCOPE],
    state,
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent',
    login_hint: session.email,
    hd: env.googleWorkspaceDomains[0],
  });
  res.redirect(authorizationUrl);
});

calendarRouter.get('/google/callback', async (req, res) => {
  const session = getAuthSession(req);
  const stateValue = cookieValue(req, CALENDAR_STATE_COOKIE);
  const statePayload = stateValue ? unseal(stateValue) : null;
  type OAuthState = { state: string; sub: string; exp: number };
  let state: OAuthState | null = null;
  try {
    state = statePayload ? JSON.parse(statePayload) as OAuthState : null;
  } catch {
    state = null;
  }
  const fail = (reason: string) => {
    clearCookie(res, CALENDAR_STATE_COOKIE);
    res.redirect(`${env.frontendUrl.replace(/\/$/, '')}/#/worklogs?calendar_error=${encodeURIComponent(reason)}`);
  };

  if (!session || !state || state.exp < Date.now() || state.sub !== session.sub || req.query.state !== state.state) {
    fail('invalid_state');
    return;
  }
  if (typeof req.query.error === 'string') {
    fail('consent_denied');
    return;
  }
  if (typeof req.query.code !== 'string') {
    fail('missing_code');
    return;
  }

  try {
    const client = oauthClient(env.googleCalendarRedirectUri);
    const { tokens } = await client.getToken(req.query.code);
    if (!tokens.id_token) throw new Error('Google did not return an identity token');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const identity = ticket.getPayload();
    if (identity?.sub !== session.sub) {
      fail('wrong_google_account');
      return;
    }
    const refreshToken = tokens.refresh_token ?? await getCalendarRefreshToken(session.sub);
    if (!refreshToken) {
      fail('missing_refresh_token');
      return;
    }
    await saveCalendarRefreshToken(session.sub, refreshToken, identity.email ?? session.email);
    clearCookie(res, CALENDAR_STATE_COOKIE);
    res.redirect(`${env.frontendUrl.replace(/\/$/, '')}/#/worklogs?calendar_connected=1`);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'google_calendar_connect_failed', message: error instanceof Error ? error.message : 'unknown error' }));
    fail('connect_failed');
  }
});

calendarRouter.get('/status', async (req, res, next) => {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign-in required' });
    return;
  }
  try {
    res.json({ connected: Boolean(await getCalendarRefreshToken(session.sub)) });
  } catch (error) {
    next(error);
  }
});

calendarRouter.get('/events', async (req, res, next) => {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign-in required' });
    return;
  }
  const timeMin = typeof req.query.timeMin === 'string' ? new Date(req.query.timeMin) : null;
  const timeMax = typeof req.query.timeMax === 'string' ? new Date(req.query.timeMax) : null;
  if (!timeMin || !timeMax || !Number.isFinite(timeMin.getTime()) || !Number.isFinite(timeMax.getTime()) || timeMax <= timeMin || timeMax.getTime() - timeMin.getTime() > 31 * 24 * 60 * 60 * 1000) {
    res.status(400).json({ code: 'INVALID_DATE_RANGE', message: 'Provide a valid timeMin and timeMax range up to 31 days' });
    return;
  }

  try {
    const refreshToken = await getCalendarRefreshToken(session.sub);
    if (!refreshToken) {
      res.status(409).json({ code: 'CALENDAR_NOT_CONNECTED', message: 'Connect Google Calendar first' });
      return;
    }
    const client = oauthClient();
    client.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    const events = (response.data.items ?? []).filter((event) => event.status !== 'cancelled').map((event) => ({
      id: event.id ?? randomBytes(8).toString('hex'),
      summary: event.summary || '（無標題行程）',
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
      allDay: Boolean(event.start?.date && !event.start?.dateTime),
    }));
    const classification = await classifyCalendarEvents(events);
    res.json({ aiStatus: classification.status, events: classification.events.map((event, index) => ({
      ...event,
      allDay: events[index]?.allDay ?? false,
    })) });
  } catch (error) {
    next(error);
  }
});

calendarRouter.delete('/connection', async (req, res, next) => {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign-in required' });
    return;
  }
  try {
    const refreshToken = await getCalendarRefreshToken(session.sub);
    if (refreshToken) {
      const client = oauthClient();
      await client.revokeToken(refreshToken).catch(() => undefined);
    }
    await removeCalendarRefreshToken(session.sub);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
