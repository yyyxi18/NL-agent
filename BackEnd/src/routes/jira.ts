import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env';
import { clearCookie, cookieValue, getAuthSession, seal, setCookie, unseal } from './auth';
import { exchangeJiraCode, getAccessibleJiraSites, jiraApi, jiraConfigured, JiraRequestError, revokeJiraToken } from '../services/jiraClient';
import { getJiraConnection, removeJiraConnection, saveJiraConnection } from '../services/jiraTokenStore';
import { suggestJiraIssues } from '../services/eventClassifier';

export const jiraRouter = Router();
const STATE_COOKIE = 'nl_agent_jira_oauth_state';
const STATE_TTL_SECONDS = 10 * 60;
const OAUTH_SCOPES = ['read:jira-work', 'read:jira-user', 'write:jira-work', 'offline_access'];
type JiraOAuthState = { state: string; userId: string; expiresAt: number };

function frontendResult(key: string, value: string): string {
  return `${env.frontendUrl.replace(/\/$/, '')}/#/worklogs?${key}=${encodeURIComponent(value)}`;
}

function authRequired(req: import('express').Request, res: import('express').Response): string | null {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign in before connecting Jira' });
    return null;
  }
  return session.sub;
}

jiraRouter.get('/connect', (req, res) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  if (!jiraConfigured()) {
    res.status(503).json({ code: 'JIRA_NOT_CONFIGURED', message: 'Configure JIRA_CLIENT_ID and JIRA_CLIENT_SECRET on the server' });
    return;
  }
  const state = randomBytes(32).toString('base64url');
  setCookie(res, STATE_COOKIE, seal(JSON.stringify({ state, userId, expiresAt: Date.now() + STATE_TTL_SECONDS * 1000 })), STATE_TTL_SECONDS);
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: env.jiraClientId,
    scope: OAUTH_SCOPES.join(' '),
    redirect_uri: env.jiraRedirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  res.redirect(`https://auth.atlassian.com/authorize?${params.toString()}`);
});

jiraRouter.get('/oauth/callback', async (req, res) => {
  const session = getAuthSession(req);
  const stateCookie = cookieValue(req, STATE_COOKIE);
  const rawState = stateCookie ? unseal(stateCookie) : null;
  let savedState: JiraOAuthState | null = null;
  try { savedState = rawState ? JSON.parse(rawState) as JiraOAuthState : null; } catch { savedState = null; }
  const fail = (reason: string) => {
    clearCookie(res, STATE_COOKIE);
    res.redirect(frontendResult('jira_error', reason));
  };

  if (!session || !savedState || savedState.expiresAt < Date.now() || savedState.userId !== session.sub || req.query.state !== savedState.state) {
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
    const connection = await exchangeJiraCode(req.query.code);
    await saveJiraConnection(session.sub, connection);
    clearCookie(res, STATE_COOKIE);
    res.redirect(frontendResult('jira_connected', '1'));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'jira_oauth_callback_failed', errorName: error instanceof Error ? error.name : 'UnknownError', status: error instanceof JiraRequestError ? error.status : undefined }));
    fail(error instanceof JiraRequestError && error.message.includes('refresh token') ? 'offline_access_required' : 'token_exchange_failed');
  }
});

jiraRouter.get('/status', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  if (!jiraConfigured()) {
    res.json({ configured: false, connected: false, sites: [], selectedCloudId: null });
    return;
  }
  try {
    const connection = await getJiraConnection(userId);
    if (!connection) {
      res.json({ configured: true, connected: false, sites: [], selectedCloudId: null });
      return;
    }
    const resources = await getAccessibleJiraSites(userId);
    const sites = resources.sites.map(({ id, name, url, avatarUrl }) => ({ id, name, url, avatarUrl }));
    const selectedCloudId = resources.connection.selectedCloudId && sites.some((site) => site.id === resources.connection.selectedCloudId)
      ? resources.connection.selectedCloudId
      : null;
    res.json({ configured: true, connected: true, sites, selectedCloudId });
  } catch (error) { next(error); }
});

jiraRouter.put('/site', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  const cloudId = req.body?.cloudId;
  if (typeof cloudId !== 'string') {
    res.status(400).json({ code: 'INVALID_SITE', message: 'Choose a Jira site' });
    return;
  }
  try {
    const { sites, connection } = await getAccessibleJiraSites(userId);
    if (!sites.some((site) => site.id === cloudId)) {
      res.status(403).json({ code: 'JIRA_SITE_NOT_AUTHORIZED', message: 'This Jira site is not available to the connected account' });
      return;
    }
    await saveJiraConnection(userId, { ...connection, selectedCloudId: cloudId });
    res.json({ selectedCloudId: cloudId });
  } catch (error) { next(error); }
});

jiraRouter.get('/projects', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  try {
    const allProjects: Array<{ id: string; key: string; name: string; projectTypeKey?: string; archived?: boolean }> = [];
    let startAt = 0;
    while (true) {
      const response = await jiraApi(userId, `/rest/api/3/project/search?startAt=${startAt}&maxResults=100&orderBy=name&includeArchived=false`) as {
        values?: Array<{ id: string; key: string; name: string; projectTypeKey?: string; archived?: boolean }>;
        isLast?: boolean;
      };
      const page = response.values ?? [];
      allProjects.push(...page);
      if (response.isLast === true || page.length === 0 || page.length < 100) break;
      startAt += page.length;
    }
    const activeProjects = allProjects.filter((project) =>
      project.archived !== true && !/^\s*\[closed\]/i.test(project.name));
    res.json({ projects: activeProjects.map(({ id, key, name, projectTypeKey }) => ({ id, key, name, projectTypeKey })) });
  } catch (error) { next(error); }
});

jiraRouter.get('/issues', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  const projectKey = typeof req.query.projectKey === 'string' ? req.query.projectKey : '';
  const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 120) : '';
  if (projectKey && !/^[A-Z][A-Z0-9_]{1,19}$/i.test(projectKey)) {
    res.status(400).json({ code: 'INVALID_PROJECT', message: 'Choose a valid Jira project' });
    return;
  }
  if (!query) {
    res.json({ issues: [] });
    return;
  }
  try {
    const safeQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jql = `${projectKey ? `project = "${projectKey}" AND ` : ''}text ~ "${safeQuery}" ORDER BY updated DESC`;
    const response = await jiraApi(userId, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, maxResults: 20, fields: ['summary', 'status', 'issuetype', 'project'] }),
    }) as { issues?: Array<{ id: string; key: string; fields?: { summary?: string; status?: { name?: string }; issuetype?: { name?: string }; project?: { key?: string; name?: string } } }> };
    res.json({ issues: (response.issues ?? []).map((issue) => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary ?? '',
      status: issue.fields?.status?.name ?? '',
      issueType: issue.fields?.issuetype?.name ?? '',
      projectKey: issue.fields?.project?.key ?? projectKey,
      projectName: issue.fields?.project?.name ?? '',
    })) });
  } catch (error) { next(error); }
});

jiraRouter.post('/issues/match', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  const entries = req.body?.entries;
  if (!Array.isArray(entries) || entries.length > 40 || entries.some((entry: Record<string, unknown>) =>
    !Number.isInteger(entry.id) || typeof entry.summary !== 'string' || !entry.summary.trim() || entry.summary.length > 300)) {
    res.status(400).json({ code: 'INVALID_MATCH_REQUEST', message: 'Provide up to 40 calendar worklog titles' });
    return;
  }
  try {
    const projects: Array<{ key: string; name: string }> = [];
    let startAt = 0;
    while (true) {
      const projectResponse = await jiraApi(userId, `/rest/api/3/project/search?startAt=${startAt}&maxResults=100&orderBy=name&includeArchived=false`) as {
        values?: Array<{ key: string; name: string; archived?: boolean }>;
        isLast?: boolean;
      };
      const page = projectResponse.values ?? [];
      projects.push(...page.filter((project) => project.archived !== true && !/^\s*\[closed\]/i.test(project.name)).map(({ key, name }) => ({ key, name })));
      if (projectResponse.isLast === true || page.length === 0 || page.length < 100) break;
      startAt += page.length;
    }
    const issueResponse = await jiraApi(userId, '/rest/api/3/search/jql', {
      method: 'POST', body: JSON.stringify({ jql: 'ORDER BY created DESC', maxResults: 100, fields: ['summary', 'project'] }),
    }) as { issues?: Array<{ key: string; fields?: { summary?: string; project?: { key?: string; name?: string } } }> };
    const projectNames = new Map(projects.map((project) => [project.key, project.name]));
    const candidates = (issueResponse.issues ?? []).flatMap((issue) => {
      const projectKey = issue.fields?.project?.key ?? '';
      if (!projectNames.has(projectKey) || !issue.fields?.summary) return [];
      return [{ key: issue.key, summary: issue.fields.summary, projectKey, projectName: projectNames.get(projectKey)! }];
    });
    // Search each event's named project directly. The recent-issues window alone
    // misses older tickets, even when the project and ticket title are explicit.
    const targeted = await Promise.all(entries.map(async (entry: { id: number; summary: string }) => {
      const leadingKey = entry.summary.trim().match(/^([A-Z][A-Z0-9_]{1,19})\b/i)?.[1]?.toUpperCase();
      const project = leadingKey ? projects.find((item) => item.key.toUpperCase() === leadingKey) : undefined;
      const title = project ? entry.summary.trim().replace(new RegExp(`^${project.key}\\b\\s*[-:：]?\\s*`, 'i'), '') : entry.summary.trim();
      const safeQuery = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 120);
      if (!safeQuery) return [];
      const jql = `${project ? `project = "${project.key}" AND ` : ''}text ~ "${safeQuery}" ORDER BY updated DESC`;
      const found = await jiraApi(userId, '/rest/api/3/search/jql', {
        method: 'POST', body: JSON.stringify({ jql, maxResults: 20, fields: ['summary', 'project'] }),
      }) as { issues?: Array<{ key: string; fields?: { summary?: string; project?: { key?: string; name?: string } } }> };
      return (found.issues ?? []).flatMap((issue) => {
        const projectKey = issue.fields?.project?.key ?? '';
        const projectName = projectNames.get(projectKey);
        if (!projectName || !issue.fields?.summary) return [];
        return [{ key: issue.key, summary: issue.fields.summary, projectKey, projectName }];
      });
    }));
    const candidateByKey = new Map([...candidates, ...targeted.flat()].map((candidate) => [candidate.key, candidate]));
    const result = await suggestJiraIssues(entries, projects, [...candidateByKey.values()]);
    res.json(result);
  } catch (error) { next(error); }
});

jiraRouter.post('/issues', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  const { projectKey, summary } = req.body ?? {};
  if (typeof projectKey !== 'string' || !/^[A-Z][A-Z0-9_]{1,19}$/i.test(projectKey)
    || typeof summary !== 'string' || !summary.trim() || summary.length > 255) {
    res.status(400).json({ code: 'INVALID_ISSUE', message: 'Choose a project and provide an issue title' });
    return;
  }
  try {
    const result = await jiraApi(userId, '/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields: { project: { key: projectKey }, summary: summary.trim(), issuetype: { name: 'Task' } } }),
    }) as { id?: string; key?: string; self?: string };
    res.status(201).json({ id: result.id, key: result.key, self: result.self });
  } catch (error) { next(error); }
});

jiraRouter.post('/worklogs', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  const entries = req.body?.entries;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 50) {
    res.status(400).json({ code: 'INVALID_WORKLOGS', message: 'Provide between 1 and 50 worklog entries' });
    return;
  }
  const invalid = entries.some((entry: Record<string, unknown>) =>
    typeof entry.issueKey !== 'string' || !/^[A-Z][A-Z0-9_]+-\d+$/i.test(entry.issueKey)
    || typeof entry.started !== 'string' || !Number.isFinite(Date.parse(entry.started))
    || typeof entry.timeSpentSeconds !== 'number' || !Number.isInteger(entry.timeSpentSeconds) || entry.timeSpentSeconds < 60 || entry.timeSpentSeconds > 86400
    || typeof entry.comment !== 'string' || !entry.comment.trim() || entry.comment.length > 1000);
  if (invalid) {
    res.status(400).json({ code: 'INVALID_WORKLOGS', message: 'Each draft needs a valid Jira issue, start time, duration, and description' });
    return;
  }

  try {
    const results: Array<{ clientId?: number; issueKey: string; ok: boolean; message?: string }> = [];
    for (const entry of entries as Array<{ clientId?: number; issueKey: string; started: string; timeSpentSeconds: number; comment: string }>) {
      try {
        await jiraApi(userId, `/rest/api/3/issue/${encodeURIComponent(entry.issueKey)}/worklog`, {
          method: 'POST',
          body: JSON.stringify({
            started: new Date(entry.started).toISOString().replace(/Z$/, '+0000'),
            timeSpentSeconds: entry.timeSpentSeconds,
            comment: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: entry.comment }] }] },
          }),
        });
        results.push({ ...(typeof entry.clientId === 'number' ? { clientId: entry.clientId } : {}), issueKey: entry.issueKey, ok: true });
      } catch (error) {
        results.push({ ...(typeof entry.clientId === 'number' ? { clientId: entry.clientId } : {}), issueKey: entry.issueKey, ok: false, message: error instanceof JiraRequestError ? error.message : 'Jira request failed' });
      }
    }
    const failedCount = results.filter((result) => !result.ok).length;
    res.status(failedCount === 0 ? 201 : failedCount === results.length ? 502 : 207).json({ results });
  } catch (error) { next(error); }
});

jiraRouter.delete('/connection', async (req, res, next) => {
  const userId = authRequired(req, res);
  if (!userId) return;
  try {
    const connection = await getJiraConnection(userId);
    if (connection && jiraConfigured()) await revokeJiraToken(connection.refreshToken).catch(() => undefined);
    await removeJiraConnection(userId);
    res.status(204).end();
  } catch (error) { next(error); }
});
