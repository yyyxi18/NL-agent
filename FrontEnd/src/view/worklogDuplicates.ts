export type JiraWorklog = {
  id: string;
  issueKey: string;
  issueSummary: string;
  issueStatus: string;
  started: string;
  timeSpentSeconds: number;
  comment: string;
};

type WorklogCandidate = { summary: string; started: string; hours: number; issueKey?: string };
export type WorklogMatch = {
  worklog: JiraWorklog;
  exact: boolean;
  reason: string;
};

const taipeiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
});
const meetingWords = /開(?:了|過|完)?(?:一場)?會(?:議)?|召開會議|參加會議|會議|會談|討論會|例會|碰面|\b(?:meet(?:ing|ings)?(?:\s+with)?|met with|call with|conference call)\b/giu;
const timeWords = /\b(?:today|yesterday|this morning|this afternoon|this evening|for\s+)?(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?))\b|\b(?:today|yesterday|this morning|this afternoon|this evening)\b|(?:\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十半]+)\s*(?:個?小時|鐘頭|分鐘)(?:半)?|今天|今日|本日|上午|下午|晚上|早上/giu;
const genericMeetingSubject = /^(?:客戶|公司|團隊|內部|client|customer|team|internal)$/u;
const genericActivity = /^(?:工時|會議|開會|工作|討論|同步|例行事項|處理|meeting|call|sync|work|task|discussion|logwork|worklog)$/u;

export function taipeiDateKey(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) return '';
  const parts = taipeiDate.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return [get('year'), get('month'), get('day')].join('-');
}

function normalized(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function compact(text: string): string {
  return text.replace(/[^\p{Letter}\p{Number}]/gu, '');
}

function meetingSubject(text: string): string | undefined {
  const withoutMeeting = text.replace(meetingWords, ' ');
  if (withoutMeeting === text) return undefined;
  const subject = withoutMeeting
    .replace(timeWords, ' ')
    .replace(/\b(?:with|completed|done|held|attended|the|corporation|corp|inc|ltd|llc|company)\b|已開完|已完成|已結束|完畢|股份有限公司|有限公司|公司/giu, ' ')
    .replace(/[\p{Punctuation}\p{Symbol}]/gu, ' ')
    .replace(/^\s*(?:我(?:們)?\s*)?(?:跟|和|與|同)\s*/u, '')
    .replace(/(?:的|進行|舉行)\s*$/u, '');
  return compact(subject);
}

function activityMatches(a: string, b: string): 'meeting' | 'text' | null {
  const left = normalized(a);
  const right = normalized(b);
  const meetingA = meetingSubject(left);
  const meetingB = meetingSubject(right);
  if (meetingA !== undefined && meetingB !== undefined) {
    return meetingA.length >= 2 && !genericMeetingSubject.test(meetingA) && meetingA === meetingB ? 'meeting' : null;
  }
  const signature = compact(left);
  return signature.length >= 2 && !genericActivity.test(signature) && signature === compact(right) ? 'text' : null;
}

export function findWorklogMatch(
  candidate: WorklogCandidate, worklogs: JiraWorklog[], source: 'draft' | 'calendar' = 'draft',
): WorklogMatch | undefined {
  const start = Date.parse(candidate.started);
  const day = taipeiDateKey(new Date(start));
  if (!day) return undefined;
  const duration = Math.round(candidate.hours * 3600);
  const issueKey = candidate.issueKey?.toUpperCase();
  const sameDay = worklogs.filter((row) => taipeiDateKey(new Date(row.started)) === day);
  const exact = sameDay.filter((row) => (issueKey ? row.issueKey.toUpperCase() === issueKey : source === 'calendar')
    && Math.floor(Date.parse(row.started) / 60000) === Math.floor(start / 60000)
    && row.timeSpentSeconds === duration && normalized(row.comment) === normalized(candidate.summary)
    && (source === 'draft' || issueKey || activityMatches(candidate.summary, row.comment)));
  if (exact.length && (source === 'draft' || exact.length === 1)) {
    return { worklog: exact[0], exact: true, reason: '開始時間、時數和描述一致' };
  }

  const possible = sameDay.flatMap((row) => {
    const match = activityMatches(candidate.summary, row.comment);
    const fromTitle = activityMatches(candidate.summary, row.issueSummary);
    const jiraStart = Date.parse(row.started);
    const sameIssue = issueKey === row.issueKey.toUpperCase();
    const sameTime = Math.floor(jiraStart / 60000) === Math.floor(start / 60000);
    const hasSpecificComment = activityMatches(row.comment, row.comment) !== null;
    const similar = match ?? (!hasSpecificComment || (sameIssue && sameTime) ? fromTitle : null);
    if (!similar) return [];
    const score = (match ? 4 : 0) + Number(sameIssue) + Number(sameTime) + Number(row.timeSpentSeconds === duration);
    return [{
      score,
      worklog: row,
      exact: false,
      reason: similar === 'meeting' ? '同一天有同一對象或主題的會議' : '同一天已有相同內容的工時',
    }];
  });
  return possible.sort((a, b) => b.score - a.score)[0];
}
