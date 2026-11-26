import { env } from '../config/env';
import { getJiraConnection, JiraConnection, JiraSite, saveJiraConnection } from './jiraTokenStore';

const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const refreshes = new Map<string, Promise<JiraConnection>>();

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

export class JiraRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'JiraRequestError';
  }
}

export function jiraConfigured(): boolean {
  return Boolean(env.jiraClientId && env.jiraClientSecret && env.jiraRedirectUri);
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: env.jiraClientId, client_secret: env.jiraClientSecret, ...body }),
  });
  const data = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !data.access_token) {
    throw new JiraRequestError(response.status, data.error || 'Atlassian OAuth token request failed');
  }
  return data;
}

export async function exchangeJiraCode(code: string): Promise<JiraConnection> {
  const token = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: env.jiraRedirectUri });
  if (!token.refresh_token) throw new JiraRequestError(502, 'Atlassian did not return a refresh token. Reconnect with offline_access enabled.');
  return {
    accessToken: token.access_token!,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
  };
}

async function refreshConnection(userId: string): Promise<JiraConnection> {
  const existing = await getJiraConnection(userId);
  if (!existing) throw new JiraRequestError(401, 'Jira is not connected');
  const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: existing.refreshToken });
  const updated: JiraConnection = {
    ...existing,
    accessToken: token.access_token!,
    refreshToken: token.refresh_token ?? existing.refreshToken,
    expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
  };
  await saveJiraConnection(userId, updated);
  return updated;
}

async function validConnection(userId: string, forceRefresh = false): Promise<JiraConnection> {
  const existing = await getJiraConnection(userId);
  if (!existing) throw new JiraRequestError(401, 'Jira is not connected');
  if (!forceRefresh && existing.expiresAt > Date.now() + 60_000) return existing;

  let pending = refreshes.get(userId);
  if (!pending) {
    pending = refreshConnection(userId).finally(() => refreshes.delete(userId));
    refreshes.set(userId, pending);
  }
  return pending;
}

export async function getAccessibleJiraSites(userId: string): Promise<{ sites: JiraSite[]; connection: JiraConnection }> {
  const connection = await validConnection(userId);
  const response = await fetch(RESOURCES_URL, { headers: { authorization: `Bearer ${connection.accessToken}`, accept: 'application/json' } });
  if (response.status === 401) {
    const refreshed = await validConnection(userId, true);
    const retry = await fetch(RESOURCES_URL, { headers: { authorization: `Bearer ${refreshed.accessToken}`, accept: 'application/json' } });
    if (!retry.ok) throw new JiraRequestError(retry.status, 'Unable to load Jira sites');
    const sites = await retry.json() as JiraSite[];
    return { sites: sites.filter((site) => site.scopes?.some((scope) => scope.includes('jira'))), connection: refreshed };
  }
  if (!response.ok) throw new JiraRequestError(response.status, 'Unable to load Jira sites');
  const sites = await response.json() as JiraSite[];
  return { sites: sites.filter((site) => site.scopes?.some((scope) => scope.includes('jira'))), connection };
}

export async function jiraApi(userId: string, path: string, init: RequestInit = {}): Promise<unknown> {
  let connection = await validConnection(userId);
  if (!connection.selectedCloudId) throw new JiraRequestError(409, 'Choose a Jira site first');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(connection.selectedCloudId)) throw new JiraRequestError(400, 'Invalid Jira site id');

  const request = (accessToken: string) => fetch(`https://api.atlassian.com/ex/jira/${connection.selectedCloudId}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers, authorization: `Bearer ${accessToken}` },
  });
  let response = await request(connection.accessToken);
  if (response.status === 401) {
    connection = await validConnection(userId, true);
    response = await request(connection.accessToken);
  }
  const raw = await response.text();
  const data = raw ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; } })() : null;
  if (!response.ok) {
    const messages = Array.isArray(data?.errorMessages) ? data.errorMessages.filter((message): message is string => typeof message === 'string') : [];
    throw new JiraRequestError(response.status, messages[0] || 'Jira API request failed');
  }
  return data;
}

export async function revokeJiraToken(token: string): Promise<void> {
  const response = await fetch('https://auth.atlassian.com/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.jiraClientId, client_secret: env.jiraClientSecret, token }),
  });
  if (!response.ok && response.status !== 400) throw new JiraRequestError(response.status, 'Unable to revoke Jira token');
}
