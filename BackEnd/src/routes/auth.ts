import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { Router, Request } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';

export const authRouter = Router();
const SESSION_COOKIE = 'nl_agent_session';
const STATE_COOKIE = 'nl_agent_oauth_state';
const SESSION_SECONDS = 60 * 60 * 8;
const STATE_SECONDS = 10 * 60;

type Session = { sub: string; email: string; name?: string; picture?: string; exp: number };
export type AuthSession = Session;
export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export function oauthClient(redirectUri = env.googleRedirectUri): OAuth2Client {
  return new OAuth2Client(env.googleClientId, env.googleClientSecret, redirectUri);
}

function key(): Buffer {
  if (env.authCookieSecret.length < 32) {
    throw new Error('AUTH_COOKIE_SECRET must contain at least 32 characters');
  }
  return createHash('sha256').update(env.authCookieSecret).digest();
}

export function seal(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function unseal(value: string): string | null {
  try {
    const [ivText, tagText, dataText] = value.split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function cookieValue(req: Request, name: string): string | undefined {
  const entry = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

export function setCookie(res: import('express').Response, name: string, value: string, maxAge: number): void {
  const secure = env.appEnv === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export function clearCookie(res: import('express').Response, name: string): void {
  const secure = env.appEnv === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

function validConfig(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret && env.googleWorkspaceDomains.length && env.authCookieSecret.length >= 32);
}

export function getAuthSession(req: Request): AuthSession | null {
  const raw = cookieValue(req, SESSION_COOKIE);
  const json = raw ? unseal(raw) : null;
  if (!json) return null;
  try {
    const session = JSON.parse(json) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

authRouter.get('/google', (_req, res) => {
  if (!validConfig()) {
    res.status(503).json({ code: 'AUTH_NOT_CONFIGURED', message: 'Google login is not configured on the server' });
    return;
  }
  const state = randomBytes(32).toString('base64url');
  setCookie(res, STATE_COOKIE, seal(JSON.stringify({ state, exp: Date.now() + STATE_SECONDS * 1000 })), STATE_SECONDS);
  const url = oauthClient().generateAuthUrl({
    response_type: 'code',
    scope: ['openid', 'email', 'profile'],
    state,
    hd: env.googleWorkspaceDomains[0],
    prompt: 'select_account',
  });
  res.redirect(url);
});

authRouter.get('/google/callback', async (req, res, next) => {
  try {
    if (!validConfig()) {
      res.status(503).send('Google login is not configured on the server.');
      return;
    }
    if (typeof req.query.error === 'string') {
      clearCookie(res, STATE_COOKIE);
      res.redirect(`${env.frontendUrl}/#/login?error=google_login_cancelled`);
      return;
    }
    const stateText = cookieValue(req, STATE_COOKIE);
    const stateJson = stateText ? unseal(stateText) : null;
    const savedState = stateJson ? JSON.parse(stateJson) as { state: string; exp: number } : null;
    if (!savedState || savedState.exp < Date.now() || typeof req.query.state !== 'string' || req.query.state !== savedState.state) {
      clearCookie(res, STATE_COOKIE);
      res.status(400).send('Invalid or expired OAuth state. Please try signing in again.');
      return;
    }
    if (typeof req.query.code !== 'string') {
      res.status(400).send('Google did not return an authorization code.');
      return;
    }

    const client = oauthClient();
    const { tokens } = await client.getToken(req.query.code);
    if (!tokens.id_token) throw new Error('Google did not return an ID token');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const payload = ticket.getPayload();
    const domain = payload?.hd?.toLowerCase();
    if (!payload?.sub || !payload.email || payload.email_verified !== true || !domain || !env.googleWorkspaceDomains.includes(domain)) {
      clearCookie(res, STATE_COOKIE);
      res.redirect(`${env.frontendUrl}/#/login?error=company_account_required`);
      return;
    }

    const session: Session = {
      sub: payload.sub,
      email: payload.email,
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.picture ? { picture: payload.picture } : {}),
      exp: Date.now() + SESSION_SECONDS * 1000,
    };
    setCookie(res, SESSION_COOKIE, seal(JSON.stringify(session)), SESSION_SECONDS);
    clearCookie(res, STATE_COOKIE);
    res.redirect(env.frontendUrl);
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', (req, res) => {
  const session = getAuthSession(req);
  if (!session) {
    clearCookie(res, SESSION_COOKIE);
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign-in required' });
    return;
  }
  res.json({ id: session.sub, email: session.email, name: session.name, picture: session.picture });
});

authRouter.post('/logout', (req, res) => {
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) {
    res.status(403).json({ code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed' });
    return;
  }
  clearCookie(res, SESSION_COOKIE);
  res.status(204).end();
});
