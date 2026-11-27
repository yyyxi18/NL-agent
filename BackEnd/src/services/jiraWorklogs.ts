import { jiraApi, JiraRequestError } from './jiraClient';

export type JiraWorklog = {
  id: string;
  issueKey: string;
  issueSummary: string;
  issueStatus: string;
  started: string;
  timeSpentSeconds: number;
  comment: string;
};

type JiraIssue = { key: string; fields?: { summary?: string; status?: { name?: string } } };
type RawWorklog = Omit<JiraWorklog, 'issueKey' | 'issueSummary' | 'issueStatus' | 'comment'> & {
  author?: { accountId?: string };
  comment?: unknown;
};

function commentText(comment: unknown): string {
  if (typeof comment === 'string') return comment;
  if (!comment || typeof comment !== 'object') return '';
  const node = comment as { type?: string; text?: string; content?: unknown[] };
  if (node.type === 'hardBreak') return '\n';
  return node.text ?? (node.content ?? []).map(commentText).join(node.type === 'doc' ? '\n' : '');
}

export async function jiraAccountId(userId: string, cloudId?: string): Promise<string> {
  const profile = await jiraApi(userId, '/rest/api/3/myself', {}, cloudId) as { accountId?: string };
  if (!profile?.accountId) throw new JiraRequestError(502, 'Unable to identify the Jira account');
  return profile.accountId;
}

export async function issueWorklogs(
  userId: string, issue: JiraIssue, accountId: string, start: number, end: number, cloudId?: string,
): Promise<JiraWorklog[]> {
  const worklogs: JiraWorklog[] = [];
  let startAt = 0;
  while (true) {
    const query = new URLSearchParams({
      startAt: String(startAt), maxResults: '100', startedAfter: String(start - 1), startedBefore: String(end),
    });
    const page = await jiraApi(userId, '/rest/api/3/issue/' + encodeURIComponent(issue.key) + '/worklog?' + query, {}, cloudId) as {
      worklogs: RawWorklog[]; total: number;
    };
    if (!Array.isArray(page?.worklogs) || !Number.isInteger(page.total)) {
      throw new JiraRequestError(502, 'Jira returned an invalid worklog page');
    }
    for (const row of page.worklogs) {
      const started = Date.parse(row.started);
      if (row.author?.accountId !== accountId || !(started >= start && started < end)) continue;
      worklogs.push({
        id: row.id, issueKey: issue.key, issueSummary: issue.fields?.summary ?? '',
        issueStatus: issue.fields?.status?.name ?? '', started: new Date(started).toISOString(),
        timeSpentSeconds: row.timeSpentSeconds, comment: commentText(row.comment),
      });
    }
    startAt += page.worklogs.length;
    if (startAt >= page.total) return worklogs;
    if (!page.worklogs.length) throw new JiraRequestError(502, 'Jira returned an incomplete worklog page');
  }
}

export async function listJiraWorklogs(userId: string, from: string, to: string, cloudId: string, knownKeys: string[]): Promise<JiraWorklog[]> {
  const start = Date.parse(from + 'T00:00:00+08:00');
  const end = Date.parse(to + 'T00:00:00+08:00');
  const jqlDate = (time: number) => new Date(time).toISOString().slice(0, 10);
  const accountId = await jiraAccountId(userId, cloudId);
  // JQL dates use Jira's time zone, so widen the search and filter the actual timestamps.
  const dated = '(worklogDate >= "' + jqlDate(start - 86400000)
    + '" AND worklogDate <= "' + jqlDate(end + 86400000) + '")';
  const issues = new Map<string, JiraIssue>();
  let nextPageToken: string | undefined;
  do {
    const page = await jiraApi(userId, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql: dated, maxResults: 100, fields: ['summary', 'status'], nextPageToken }),
    }, cloudId) as { issues: JiraIssue[]; nextPageToken?: string };
    if (!Array.isArray(page?.issues)) throw new JiraRequestError(502, 'Jira returned an invalid issue page');
    for (const issue of page.issues) issues.set(issue.key, issue);
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  const missingKeys = knownKeys.filter((key) => !issues.has(key));
  for (let offset = 0; offset < missingKeys.length; offset += 5) {
    await Promise.all(missingKeys.slice(offset, offset + 5).map(async (key) => {
      try {
        const issue = await jiraApi(userId, '/rest/api/3/issue/' + key + '?fields=summary,status', {}, cloudId) as JiraIssue;
        issues.set(issue.key, issue);
      } catch (error) {
        if (!(error instanceof JiraRequestError) || error.status !== 404) throw error;
      }
    }));
  }
  const worklogs: JiraWorklog[] = [];
  const candidates = [...issues.values()];
  for (let offset = 0; offset < candidates.length; offset += 5) {
    const batch = await Promise.all(candidates.slice(offset, offset + 5)
      .map((issue) => issueWorklogs(userId, issue, accountId, start, end, cloudId)));
    worklogs.push(...batch.flat());
  }
  return worklogs.sort((a, b) => a.started.localeCompare(b.started) || a.id.localeCompare(b.id));
}
