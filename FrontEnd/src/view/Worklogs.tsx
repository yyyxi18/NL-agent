import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import WorklogIssueSearch from './WorklogIssueSearch';
import { findWorklogMatch, taipeiDateKey, type JiraWorklog, type WorklogMatch } from './worklogDuplicates';
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Edit3, FileClock, Plus, Sparkles, Trash2, X } from 'lucide-react';

type Draft = { id: number; project: string; projectKey?: string; issueKey?: string; newIssueSummary?: string; createNewIssue?: boolean; approvedDuplicate?: string; submitError?: string; started: string; hours: number; summary: string; source: 'Calendar' | '手動補登'; };

type CalendarEvent = {
  id: string;
  time: string;
  title: string;
  project: string;
  started: string;
  hours: number;
  confidence: 'high' | 'uncertain' | 'skip';
  skipReason?: string;
  reason?: string;
};

type CalendarApiEvent = { id: string; summary: string; start: string | null; end: string | null; allDay: boolean; classification: 'work' | 'private' | 'uncertain'; confidence: number; reason: string };
type CalendarApiResponse = { aiStatus: 'ready' | 'not_configured' | 'error'; events: CalendarApiEvent[] };
type JiraSite = { id: string; name: string; url: string };
type JiraProject = { id: string; key: string; name: string };
type JiraMatchSuggestion = { id: number; projectKey: string; issueKey: string | null; newIssueSummary: string | null; confidence: number; reason: string };
type JiraStatusResponse = { configured: boolean; connected: boolean; sites: JiraSite[]; selectedCloudId: string | null };
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');

function formatCalendarEvent(event: CalendarApiEvent): CalendarEvent {
  const confidence: CalendarEvent['confidence'] = event.confidence >= 0.6 && event.classification === 'work'
    ? 'high'
    : event.confidence >= 0.6 && event.classification === 'private' ? 'skip' : 'uncertain';
  if (event.allDay || !event.start || !event.end) {
    return { id: event.id, time: '全天', title: event.summary, project: '', started: event.start ?? new Date().toISOString(), hours: 8, confidence, skipReason: event.reason, reason: event.reason };
  }
  const start = new Date(event.start);
  const end = new Date(event.end);
  const clock = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  const hours = Math.max(0.25, Math.round((end.getTime() - start.getTime()) / 900000) / 4);
  return { id: event.id, time: `${clock.format(start)} – ${clock.format(end)}`, title: event.summary, project: '', started: event.start, hours, confidence, skipReason: event.reason, reason: event.reason };
}

type JiraWorklogSnapshot = { scope: string; worklogs: JiraWorklog[]; loading: boolean; error?: string };

const noJiraWorklogs: JiraWorklog[] = [];
const displayHours = (hours: number) => Number(hours.toFixed(2));
const jiraClock = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });

function duplicateReviewKey(draft: Draft, match: WorklogMatch, cloudId: string) {
  const row = match.worklog;
  return JSON.stringify([cloudId, draft.issueKey, draft.projectKey, draft.started, draft.hours, draft.summary,
    row.id, row.issueKey, row.started, row.timeSpentSeconds, row.comment, row.issueSummary]);
}

function DraftIssueSearch({ draft, cloudId, onSelect }: {
  draft: Draft; cloudId: string; onSelect: (issueKey?: string, newIssueSummary?: string) => void;
}) {
  const [query, setQuery] = useState(draft.summary);
  return <WorklogIssueSearch apiBaseUrl={API_BASE_URL} cloudId={cloudId} projectKey={draft.projectKey ?? ''}
    label={`${draft.summary} 的 Jira 票卡搜尋`}
    value={query} selection="" disabled={false} onChange={setQuery} onClear={() => setQuery('')}
    onSelect={(issue) => onSelect(issue?.key, issue ? undefined : query.trim())} />;
}

function WorklogMatchNotice({ match }: { match?: WorklogMatch }) {
  if (!match) return null;
  const { worklog, exact, reason } = match;
  return <small className={exact ? 'jira-match-notice is-recorded' : 'jira-match-notice'}
    title={`${reason}：${worklog.comment || worklog.issueSummary}`}>
    {exact ? 'Jira 已登錄' : '可能重複'} · {worklog.issueKey} · {displayHours(worklog.timeSpentSeconds / 3600)} 小時
  </small>;
}

function draftMatch(draft: Draft, worklogs: JiraWorklog[]) {
  return findWorklogMatch(draft, worklogs);
}

function calendarMatch(event: CalendarEvent, worklogs: JiraWorklog[]) {
  const issueKey = event.title.match(/\b[A-Z][A-Z0-9_]*-\d+\b/i)?.[0];
  return findWorklogMatch({ summary: event.title, started: event.started, hours: event.hours, issueKey }, worklogs, 'calendar');
}

type DayWorklog = { project: string; hours: number; summary: string; status?: string };

// 2026 台灣國定假日 (11月沒有國定假日，加幾個示意)
const holidays: Record<string, string> = {
  '2026-01-01': '元旦',
  '2026-01-29': '除夕',
  '2026-01-30': '春節',
  '2026-01-31': '春節',
  '2026-02-01': '春節',
  '2026-02-02': '春節',
  '2026-02-28': '和平紀念日',
  '2026-04-04': '兒童節',
  '2026-04-05': '清明節',
  '2026-05-01': '勞動節',
  '2026-06-19': '端午節',
  '2026-09-25': '中秋節',
  '2026-10-10': '國慶日',
  '2026-10-11': '國慶日(補假)',
};

function dateKeyToUtcDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  const date = dateKeyToUtcDate(dateKey);
  return new Intl.DateTimeFormat('zh-TW', { ...options, timeZone: 'UTC' }).format(date);
}

function shiftDateKey(dateKey: string, amount: number): string {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function shiftMonthDateKey(dateKey: string, amount: number): string {
  const date = dateKeyToUtcDate(dateKey);
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function draftWorklogsForDate(dateKey: string, drafts: Draft[]): DayWorklog[] {
  return drafts.filter((draft) => taipeiDateKey(new Date(draft.started)) === dateKey).map((draft) => ({
    project: draft.issueKey ?? draft.projectKey ?? '待選票卡', hours: draft.hours, summary: draft.summary,
    status: draft.issueKey ? '草稿・待確認送出' : '待配對票卡',
  }));
}

function worklogsForDate(dateKey: string, drafts: Draft[], jiraWorklogs: JiraWorklog[]): DayWorklog[] {
  const recorded = jiraWorklogs.filter((row) => taipeiDateKey(new Date(row.started)) === dateKey);
  return [
    ...recorded.map((row) => ({
      project: row.issueKey, summary: row.comment || row.issueSummary, hours: row.timeSpentSeconds / 3600,
      status: row.issueStatus ? `Jira 已登錄・${row.issueStatus}` : 'Jira 已登錄',
    })),
    ...draftWorklogsForDate(dateKey, drafts.filter((draft) => !draftMatch(draft, recorded)?.exact)),
  ];
}

function getMonthGrid(dateKey: string, drafts: Draft[], jiraWorklogs: JiraWorklog[]) {
  const [year, month] = dateKey.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const dateValue = new Date(Date.UTC(year, month - 1, 1 - offset + index));
    const day = dateValue.getUTCDate();
    const cellDateKey = `${dateValue.getUTCFullYear()}-${String(dateValue.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const sameMonth = dateValue.getUTCMonth() === month - 1;
    const today = cellDateKey === taipeiDateKey();
    const isWeekend = dateValue.getUTCDay() === 0 || dateValue.getUTCDay() === 6;
    const holidayName = holidays[cellDateKey];
    const isHoliday = Boolean(holidayName);
    const isWorkday = !isWeekend && !isHoliday;
    const worklogs = sameMonth ? worklogsForDate(cellDateKey, drafts, jiraWorklogs) : [];
    const totalHours = worklogs.reduce((sum, worklog) => sum + worklog.hours, 0);
    const hours = totalHours > 0 ? `${displayHours(totalHours)}h` : '—';
    return { date: day, dateKey: cellDateKey, hours, totalHours, today, muted: !sameMonth, isWorkday, isWeekend, isHoliday, holidayName, worklogs };
  });
}

function Worklogs() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [draftStorageKey, setDraftStorageKey] = useState('nl-agent-worklog-drafts:guest');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarAuthRequired, setCalendarAuthRequired] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarMessage, setCalendarMessage] = useState('');
  const [aiStatus, setAiStatus] = useState<CalendarApiResponse['aiStatus']>('not_configured');
  const [eventSelections, setEventSelections] = useState<Record<string, boolean>>({});
  const [uncertainDecisions, setUncertainDecisions] = useState<Record<string, 'work' | 'skip'>>({});
  const [manualSummary, setManualSummary] = useState('');
  const [manualHours, setManualHours] = useState('1');
  const [manualIssueKey, setManualIssueKey] = useState('');
  const [manualNewIssueSummary, setManualNewIssueSummary] = useState('');
  const [manualIssueLabel, setManualIssueLabel] = useState('');
  const projectDialogRef = useRef<HTMLDialogElement>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectConsentRequired, setProjectConsentRequired] = useState(false);
  const [message, setMessage] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [editingTicketId, setEditingTicketId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(taipeiDateKey());
  const [todayDateKey, setTodayDateKey] = useState(taipeiDateKey());
  const dateInputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const selectedDrafts = useMemo(() => drafts.filter((draft) => taipeiDateKey(new Date(draft.started)) === selectedDate), [selectedDate, drafts]);
  const selectedWeekStart = shiftDateKey(selectedDate, -((dateKeyToUtcDate(selectedDate).getUTCDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const dateKey = shiftDateKey(selectedWeekStart, index);
    const date = dateKeyToUtcDate(dateKey);
    return { dateKey, label: formatDateKey(dateKey, { weekday: 'short' }), date: date.getUTCDate(), fullDate: formatDateKey(dateKey, { month: 'numeric', day: 'numeric' }) };
  });
  const [showSkipped, setShowSkipped] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [overviewMode, setOverviewMode] = useState<'week' | 'month'>('week');
  const [jiraConfigured, setJiraConfigured] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [jiraSites, setJiraSites] = useState<JiraSite[]>([]);
  const [selectedCloudId, setSelectedCloudId] = useState('');
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState('');
  const [jiraMatching, setJiraMatching] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [jiraSubmitting, setJiraSubmitting] = useState(false);
  const [jiraSnapshot, setJiraSnapshot] = useState<JiraWorklogSnapshot | null>(null);
  const [jiraRevision, setJiraRevision] = useState(0);
  const [recentlyWritten, setRecentlyWritten] = useState<Record<string, string[]>>({});
  const monthStart = shiftMonthDateKey(selectedDate, 0);
  const monthEnd = shiftMonthDateKey(selectedDate, 1);
  const weekEnd = shiftDateKey(selectedWeekStart, 7);
  const jiraFrom = monthStart < selectedWeekStart ? monthStart : selectedWeekStart;
  const jiraTo = monthEnd > weekEnd ? monthEnd : weekEnd;
  const knownIssueKeys = [...new Set([
    ...(recentlyWritten[selectedCloudId] ?? []),
    ...selectedDrafts.flatMap((draft) => draft.issueKey ? [draft.issueKey.toUpperCase()] : []),
  ])].filter((key) => /^[A-Z][A-Z0-9_]*-\d+$/.test(key)).slice(0, 50);
  const jiraQuery = selectedCloudId ? new URLSearchParams({
    cloudId: selectedCloudId, from: jiraFrom, to: jiraTo,
    ...(knownIssueKeys.length ? { issues: knownIssueKeys.join(',') } : {}),
  }).toString() : '';
  const jiraScope = JSON.stringify([selectedCloudId, jiraFrom, jiraTo]);
  const activeSnapshot = jiraConnected && jiraSnapshot?.scope === jiraScope ? jiraSnapshot : null;
  const jiraWorklogs = activeSnapshot?.worklogs ?? noJiraWorklogs;
  const monthDays = useMemo(() => getMonthGrid(selectedDate, drafts, jiraWorklogs), [selectedDate, drafts, jiraWorklogs]);
  const todayJiraWorklogs = jiraWorklogs.filter((row) => taipeiDateKey(new Date(row.started)) === selectedDate);
  const selectedDayHours = displayHours(worklogsForDate(selectedDate, drafts, todayJiraWorklogs).reduce((sum, row) => sum + row.hours, 0));
  const weekTotalHours = displayHours(weekDays.reduce((sum, day) =>
    sum + worklogsForDate(day.dateKey, drafts, jiraWorklogs).reduce((hours, row) => hours + row.hours, 0), 0));
  const draftMatches = new Map(selectedDrafts.map((draft) => [draft.id, draftMatch(draft, todayJiraWorklogs)]));
  const calendarMatches = new Map(calendarEvents.map((event) => [event.id, calendarMatch(event, todayJiraWorklogs)]));
  const manualMatch = findWorklogMatch({
    summary: manualSummary, hours: Number(manualHours),
    started: `${selectedDate}T12:00:00+08:00`, issueKey: manualIssueKey,
  }, todayJiraWorklogs);
  const recordedCalendarCount = calendarEvents.filter((event) => event.confidence !== 'skip' && calendarMatches.get(event.id)?.exact).length;
  const jiraSiteUrl = jiraSites.find((site) => site.id === selectedCloudId)?.url.replace(/\/$/, '');
  const totalHours = displayHours(selectedDrafts.reduce((sum, draft) => sum + (draftMatches.get(draft.id)?.exact ? 0 : draft.hours), 0));
  const readyDrafts = selectedDrafts.filter((draft) => {
    if (!draft.issueKey && !(draft.projectKey && draft.newIssueSummary)) return false;
    if (!Number.isFinite(draft.hours) || draft.hours < 1 / 60 || draft.hours > 24) return false;
    const match = draftMatches.get(draft.id);
    return !match || (!match.exact && draft.approvedDuplicate === duplicateReviewKey(draft, match, selectedCloudId));
  });
  const readyIds = new Set(readyDrafts.map((draft) => draft.id));
  const readyHours = displayHours(readyDrafts.reduce((sum, draft) => sum + draft.hours, 0));
  const waitingCount = selectedDrafts.length - readyDrafts.length;

  useEffect(() => {
    let cancelled = false;
    const restoreDrafts = async () => {
      let userId = 'guest';
      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
        if (response.ok) {
          const profile = await response.json() as { id?: string };
          if (profile.id) userId = profile.id;
        }
      } catch { /* Allow the page to retain its local demo drafts if auth is offline. */ }
      if (cancelled) return;
      const key = `nl-agent-worklog-drafts:${userId}`;
      setDraftStorageKey(key);
      try {
        const saved = localStorage.getItem(key);
        const parsed = saved ? JSON.parse(saved) as Draft[] : null;
        const valid = Array.isArray(parsed) && parsed.every((draft) =>
          Number.isInteger(draft.id) && typeof draft.summary === 'string' && typeof draft.hours === 'number'
          && typeof draft.started === 'string' && typeof draft.source === 'string');
        setDrafts(valid ? parsed : []);
      } catch {
        setDrafts([]);
      }
      setDraftsLoaded(true);
    };
    void restoreDrafts();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!draftsLoaded) return;
    try { localStorage.setItem(draftStorageKey, JSON.stringify(drafts)); } catch { /* Keep editing if browser storage is unavailable. */ }
  }, [drafts, draftsLoaded, draftStorageKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentDateKey = taipeiDateKey();
      if (currentDateKey !== todayDateKey) {
        setTodayDateKey(currentDateKey);
        setSelectedDate((selected) => selected === todayDateKey ? currentDateKey : selected);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [todayDateKey]);

  useEffect(() => {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    const params = new URLSearchParams(hashQuery);
    const requestedDate = params.get('date');
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      const parsedDate = new Date(`${requestedDate}T00:00:00Z`);
      if (!Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === requestedDate) setSelectedDate(requestedDate);
    }
    if (params.has('calendar_connected')) setCalendarMessage('Google Calendar 已連接，正在讀取所選日期行程。');
    if (params.has('jira_connected')) setMessage('Jira 已連接，請選擇要使用的 Jira 網站與專案。');
    const jiraError = params.get('jira_error');
    if (jiraError) setMessage(jiraError === 'offline_access_required' ? 'Jira 未提供 refresh token，請確認 OAuth 權限包含 offline_access 後重新連接。' : `Jira 連線失敗（${jiraError}），請再試一次。`);
    const calendarError = params.get('calendar_error');
    if (calendarError) setCalendarMessage(`Calendar 連線失敗（${calendarError}），請再試一次。`);

  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCalendar = async () => {
      setCalendarLoading(true);
      setCalendarEvents([]);
      setEventSelections({});
      setUncertainDecisions({});
      try {
        const statusResponse = await fetch(`${API_BASE_URL}/calendar/status`, { credentials: 'include' });
        if (statusResponse.status === 401) {
          if (!cancelled) setCalendarAuthRequired(true);
          return;
        }
        if (!statusResponse.ok) throw new Error('無法確認 Google Calendar 連線狀態');
        const status = await statusResponse.json() as { connected: boolean };
        if (cancelled) return;
        setCalendarAuthRequired(false);
        setCalendarConnected(status.connected);
        if (!status.connected) return;

        const start = new Date(`${selectedDate}T00:00:00+08:00`);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const eventResponse = await fetch(`${API_BASE_URL}/calendar/events?timeMin=${encodeURIComponent(start.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}`, { credentials: 'include' });
        if (!eventResponse.ok) throw new Error('讀取 Google Calendar 行程失敗');
        const data = await eventResponse.json() as CalendarApiResponse;
        if (cancelled) return;
        setAiStatus(data.aiStatus);
        const mappedEvents = data.events.map(formatCalendarEvent);
        setCalendarEvents(mappedEvents);
      } catch (error) {
        if (!cancelled) setCalendarMessage(error instanceof Error ? error.message : '讀取 Google Calendar 失敗');
      } finally {
        if (!cancelled) setCalendarLoading(false);
      }
    };
    void loadCalendar();
    return () => { cancelled = true; };
  }, [selectedDate]);

  useEffect(() => {
    const loadJiraStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/jira/status`, { credentials: 'include' });
        if (!response.ok) return;
        const status = await response.json() as JiraStatusResponse;
        setJiraConfigured(status.configured);
        setJiraConnected(status.connected);
        setJiraSites(status.sites);
        let selectedCloudId = status.selectedCloudId ?? '';
        // Avoid guessing when the account can access multiple Jira sites. A single
        // authorized site is safe to select automatically.
        if (!selectedCloudId && status.connected && status.sites.length === 1) {
          const selectResponse = await fetch(`${API_BASE_URL}/jira/site`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cloudId: status.sites[0].id }),
          });
          if (selectResponse.ok) selectedCloudId = status.sites[0].id;
        }
        setSelectedCloudId(selectedCloudId);
      } catch {
        setMessage('無法讀取 Jira 連線狀態。');
      }
    };
    void loadJiraStatus();
  }, []);

  useEffect(() => {
    if (!jiraConnected || !selectedCloudId) {
      setJiraProjects([]);
      setSelectedProjectKey('');
      return;
    }
    let cancelled = false;
    const loadProjects = async () => {
      setJiraBusy(true);
      try {
        const response = await fetch(`${API_BASE_URL}/jira/projects`, { credentials: 'include' });
        if (!response.ok) throw new Error('無法讀取 Jira 專案');
        const data = await response.json() as { projects: JiraProject[] };
        if (cancelled) return;
        setJiraProjects(data.projects);
        setSelectedProjectKey((current) => data.projects.some((project) => project.key === current) ? current : '');
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '讀取 Jira 專案失敗。');
      } finally {
        if (!cancelled) setJiraBusy(false);
      }
    };
    void loadProjects();
    return () => { cancelled = true; };
  }, [jiraConnected, selectedCloudId]);

  useEffect(() => {
    if (!jiraConnected || !jiraQuery) return;
    const controller = new AbortController();
    let request: AbortController | undefined;
    const loadWorklogs = async () => {
      if (controller.signal.aborted) return;
      request?.abort();
      const current = new AbortController();
      request = current;
      setJiraSnapshot((previous) => ({
        scope: jiraScope, worklogs: previous?.scope === jiraScope ? previous.worklogs : [], loading: true,
      }));
      try {
        const response = await fetch(`${API_BASE_URL}/jira/worklogs?${jiraQuery}`, {
          credentials: 'include', signal: current.signal,
        });
        if (!response.ok) throw new Error('Jira 工時同步失敗，請重新整理。');
        const data = await response.json() as { worklogs: JiraWorklog[] };
        if (!current.signal.aborted) setJiraSnapshot({ scope: jiraScope, worklogs: data.worklogs, loading: false });
      } catch {
        if (!current.signal.aborted) setJiraSnapshot((previous) => ({
          scope: jiraScope, worklogs: previous?.scope === jiraScope ? previous.worklogs : [],
          loading: false, error: 'Jira 工時同步失敗，請重新整理。',
        }));
      }
    };
    void loadWorklogs();
    window.addEventListener('focus', loadWorklogs);
    return () => {
      controller.abort();
      request?.abort();
      window.removeEventListener('focus', loadWorklogs);
    };
  }, [jiraConnected, jiraQuery, jiraRevision, jiraScope]);

  const connectCalendar = () => {
    window.location.assign(`${API_BASE_URL}${calendarAuthRequired ? '/auth/google' : '/calendar/google'}`);
  };

  const connectJira = () => window.location.assign(`${API_BASE_URL}/jira/connect`);

  const selectJiraSite = async (cloudId: string) => {
    setJiraBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/jira/site`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudId }),
      });
      if (!response.ok) throw new Error('無法選取 Jira 網站，請確認授權與權限。');
      setSelectedCloudId(cloudId);
      setSelectedProjectKey('');
      clearManualIssue();
      setDrafts((current) => current.map((draft) => ({ ...draft, project: '待選票卡', projectKey: undefined, issueKey: undefined, newIssueSummary: undefined, createNewIssue: false })));
      setMessage('已選擇 Jira 網站。Calendar 草稿會由 AI 配對專案與票卡；手動補登可先選專案。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '選取 Jira 網站失敗。');
    } finally { setJiraBusy(false); }
  };

  const disconnectJira = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/jira/connection`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('解除 Jira 連線失敗。');
      setJiraConnected(false);
      setJiraSites([]);
      setSelectedCloudId('');
      setJiraProjects([]);
      setSelectedProjectKey('');
      clearManualIssue();
      setDrafts((current) => current.map((draft) => ({ ...draft, project: '待選票卡', issueKey: undefined, createNewIssue: false })));
      setMessage('已解除 Jira 連線。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '解除 Jira 連線失敗。'); }
  };

  const updateDraft = (id: number, changes: Partial<Draft>) => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, submitError: undefined, ...changes } : draft));
  };

  const removeDraft = (id: number) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  };

  const createJiraIssue = async (projectKey: string, summary: string) => {
    const response = await fetch(API_BASE_URL + '/jira/issues', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectKey, summary, cloudId: selectedCloudId }),
    });
    const data = await response.json() as { key?: string; message?: string };
    if (!response.ok || !data.key) throw new Error(data.message || '建立 Jira 票卡失敗。');
    return data.key;
  };

  const clearManualIssue = () => {
    setManualIssueKey('');
    setManualIssueLabel('');
    setManualNewIssueSummary('');
  };

  const createJiraProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingProject || !selectedCloudId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreatingProject(true);
    setProjectError('');
    setProjectConsentRequired(false);
    try {
      const response = await fetch(`${API_BASE_URL}/jira/projects`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudId: selectedCloudId, name: data.get('name'), key: data.get('key') }),
      });
      const result = await response.json() as { project?: JiraProject; code?: string; message?: string };
      if (!response.ok || !result.project) {
        setProjectConsentRequired(result.code === 'JIRA_PROJECT_CONSENT_REQUIRED');
        throw new Error(result.code === 'JIRA_PROJECT_CONSENT_REQUIRED' ? '請先授權 NL-agent 建立 Jira 專案。'
          : result.code === 'JIRA_ADMIN_REQUIRED' ? '此 Jira 帳號需要 Jira 全域管理員權限才能建立專案。'
            : result.message || '建立 Jira 專案失敗。');
      }
      const project = result.project;
      setJiraProjects((current) => [...current.filter((item) => item.key !== project.key), project]
        .sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedProjectKey(project.key);
      clearManualIssue();
      form.reset();
      projectDialogRef.current?.close();
      setMessage(`已建立並選取 Jira 專案 ${project.key}。`);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '建立 Jira 專案失敗。');
    } finally {
      setCreatingProject(false);
    }
  };

  const openWorklogDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    const input = manualInputRef.current;
    input?.scrollIntoView({ block: 'center' });
    input?.focus({ preventScroll: true });
  };

  const addManualDraft = () => {
    const hours = Number(manualHours);
    const newIssueSummary = manualNewIssueSummary;
    if (!selectedProjectKey || (!manualIssueKey && !newIssueSummary) || !manualSummary.trim() || !Number.isFinite(hours) || hours < 0.25 || hours > 24) {
      setMessage('手動補登請選擇專案與票卡，並填寫內容及有效時數。');
      return;
    }
    setDrafts((current) => [...current, { id: Date.now(), project: manualIssueKey || '待建立票卡', projectKey: selectedProjectKey, issueKey: manualIssueKey || undefined, newIssueSummary: newIssueSummary || undefined, createNewIssue: Boolean(newIssueSummary), started: new Date(`${selectedDate}T12:00:00+08:00`).toISOString(), hours, summary: manualSummary.trim(), source: '手動補登' }]);
    setManualSummary(''); setManualHours('1'); clearManualIssue();
    setMessage('手動工時已加入草稿。');
  };

  const submitWorklogs = async () => {
    if (jiraSubmitting || jiraBusy || !jiraConnected || !selectedCloudId || !readyDrafts.length) return;
    setJiraSubmitting(true);
    const errors = new Map<number, string>();
    const succeeded: Array<{ clientId: number; issueKey: string; duplicate?: boolean }> = [];
    const resolvedDrafts: Draft[] = [];
    for (const draft of readyDrafts) {
      try {
        if (draft.issueKey) {
          resolvedDrafts.push(draft);
          continue;
        }
        const issueKey = await createJiraIssue(draft.projectKey!, draft.newIssueSummary!);
        const resolved = { ...draft, issueKey, newIssueSummary: undefined, createNewIssue: false, project: issueKey };
        const match = draftMatches.get(draft.id);
        if (match && draft.approvedDuplicate) resolved.approvedDuplicate = duplicateReviewKey(resolved, match, selectedCloudId);
        resolvedDrafts.push(resolved);
        updateDraft(draft.id, resolved);
      } catch (error) {
        errors.set(draft.id, error instanceof Error ? error.message : '建立 Jira 票卡失敗。');
      }
    }

    for (let offset = 0; offset < resolvedDrafts.length; offset += 50) {
      const batch = resolvedDrafts.slice(offset, offset + 50);
      try {
        const response = await fetch(API_BASE_URL + '/jira/worklogs', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cloudId: selectedCloudId, entries: batch.map((draft) => ({
            clientId: draft.id, issueKey: draft.issueKey, started: draft.started,
            timeSpentSeconds: Math.round(draft.hours * 3600), comment: draft.summary,
          })) }),
        });
        const data = await response.json() as {
          results?: Array<{ clientId: number; issueKey: string; ok: boolean; duplicate?: boolean; message?: string }>;
          message?: string;
        };
        const results = new Map(data.results?.map((result) => [result.clientId, result]));
        for (const draft of batch) {
          const result = results.get(draft.id);
          if (result?.ok) succeeded.push(result);
          else errors.set(draft.id, result?.message || data.message || 'Jira 未確認這筆工時，請重試。');
        }
      } catch {
        for (const draft of batch) errors.set(draft.id, '無法確認 Jira 是否收到這筆工時，請重試。');
      }
    }

    const successfulIds = new Set(succeeded.map((result) => result.clientId));
    setDrafts((current) => current.filter((draft) => !successfulIds.has(draft.id)).map((draft) => {
      const submitError = errors.get(draft.id);
      return submitError ? { ...draft, submitError } : draft;
    }));
    if (succeeded.length) {
      setRecentlyWritten((current) => ({
        ...current,
        [selectedCloudId]: [...new Set([...succeeded.map((result) => result.issueKey), ...(current[selectedCloudId] ?? [])])].slice(0, 50),
      }));
    }
    const duplicates = succeeded.filter((result) => result.duplicate).length;
    const outcome = ['已寫入 ' + (succeeded.length - duplicates) + ' 筆'];
    if (duplicates) outcome.push(duplicates + ' 筆已登錄，已略過');
    if (errors.size) outcome.push(errors.size + ' 筆未完成，請查看各筆草稿');
    if (waitingCount) outcome.push(waitingCount + ' 筆留待確認');
    setMessage(outcome.join('，') + '。');
    setJiraRevision((revision) => revision + 1);
    setShowConfirm(false);
    setJiraSubmitting(false);
  };

  const disconnectCalendar = async () => {
    const response = await fetch(`${API_BASE_URL}/calendar/connection`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) {
      setCalendarConnected(false);
      setCalendarEvents([]);
      setEventSelections({});
      setCalendarMessage('已解除 Google Calendar 連接。');
    } else {
      setCalendarMessage('解除 Google Calendar 連接失敗。');
    }
  };

  const candidates = calendarEvents.filter((event) => event.confidence !== 'skip' && !calendarMatches.get(event.id)?.exact);
  const highConfidence = candidates.filter((event) => event.confidence === 'high');
  const uncertain = candidates.filter((event) => event.confidence === 'uncertain');
  const skipped = calendarEvents.filter((e) => e.confidence === 'skip');

  const isEventSelected = (event: CalendarEvent) => (
    eventSelections[event.id] ?? (event.confidence === 'high' && !calendarMatches.get(event.id))
  );

  const handleUncertainDecision = (id: string, decision: 'work' | 'skip') => {
    setUncertainDecisions((previous) => ({ ...previous, [id]: decision }));
    setEventSelections((previous) => ({ ...previous, [id]: decision === 'work' }));
  };

  const addCalendarSuggestions = async () => {
    const additions = candidates
      .filter(isEventSelected)
      .filter((event) => !drafts.some((draft) => draft.source === 'Calendar' && draft.summary === event.title && draft.started === event.started))
      .map((event, index) => ({ id: Date.now() + index, project: '待選票卡', started: event.started, hours: event.hours, summary: event.title, source: 'Calendar' as const }));
    setDrafts((current) => [...current, ...additions]);
    if (!additions.length) { setMessage('選取的行程已在草稿中。'); return; }
    if (!jiraConnected || !selectedCloudId) { setMessage(`已加入 ${additions.length} 筆行程；連接並選擇 Jira 網站後可自動配對票卡。`); return; }
    setJiraMatching(true);
    setMessage(`已加入 ${additions.length} 筆行程，AI 正在比對 Jira 專案與票卡…`);
    try {
      const response = await fetch(`${API_BASE_URL}/jira/issues/match`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: additions.map(({ id, summary }) => ({ id, summary })) }),
      });
      if (!response.ok) throw new Error('AI 比對 Jira 票卡失敗');
      const result = await response.json() as { status: string; suggestions: JiraMatchSuggestion[] };
      const matches = new Map(result.suggestions.map((suggestion) => [suggestion.id, suggestion]));
      setDrafts((current) => current.map((draft) => {
        const match = matches.get(draft.id);
        if (!match || draft.projectKey || draft.issueKey) return draft;
        return { ...draft, projectKey: match.projectKey || undefined, issueKey: match.issueKey ?? undefined, newIssueSummary: match.newIssueSummary ?? undefined, createNewIssue: Boolean(match.newIssueSummary), project: match.issueKey ?? '待選票卡' };
      }));
      setMessage(result.status === 'ready' ? 'AI 已完成配對建議，請確認專案與票卡；待新增票卡會在按「確認送出」時建立。' : '已加入草稿，但 AI 尚未設定，請手動選專案與票卡。');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'AI 比對失敗，請手動選擇專案與票卡。'); }
    finally { setJiraMatching(false); }
  };

  const updateHours = (id: number, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0) return;
    updateDraft(id, { hours });
  };

  return (
    <div className="worklog-page">
      <dialog className="confirm-modal jira-project-dialog" aria-labelledby="jira-project-title" ref={projectDialogRef}
        onCancel={(event) => { if (creatingProject) event.preventDefault(); }}>
        <form onSubmit={(event) => void createJiraProject(event)}>
          <h2 id="jira-project-title">新增 Jira 專案</h2>
          <label>專案名稱<input name="name" required maxLength={80} autoFocus disabled={creatingProject} /></label>
          <label>專案代號<input name="key" required minLength={2} maxLength={10} pattern="[A-Za-z][A-Za-z0-9]{1,9}"
            autoCapitalize="characters" placeholder="例如 OPS" aria-describedby="jira-project-key-hint" disabled={creatingProject} /></label>
          <small id="jira-project-key-hint">2–10 個英文字母或數字，開頭須為英文字母。</small>
          {projectError && <p className="jira-project-error" role="alert">{projectError}</p>}
          {projectConsentRequired && <a className="jira-refresh-button" href={`${API_BASE_URL}/jira/connect?project_admin=1`}>授權 Jira 專案管理</a>}
          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={() => projectDialogRef.current?.close()} disabled={creatingProject}>取消</button>
            <button className="button button-primary" type="submit" disabled={creatingProject}>{creatingProject ? '建立中…' : '建立專案'}</button>
          </div>
        </form>
      </dialog>
      <section className="page-heading worklog-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" />工時管理</div>
          <h1>Jira 工時紀錄</h1>
          <p>整理日曆建議與手動補登，確認後再送出。</p>
        </div>
        <div className="date-switcher">
          <button type="button" aria-label="前一天" onClick={() => setSelectedDate((date) => shiftDateKey(date, -1))}><ChevronLeft size={17} /></button>
          <label className="date-picker-label" title="選取日期">
            <CalendarDays size={16} />
            <span>{selectedDate === todayDateKey ? '今天・' : ''}{formatDateKey(selectedDate, { month: 'numeric', day: 'numeric', weekday: 'short' })}</span>
            <input ref={dateInputRef} aria-label="選取要查看的日期" type="date" value={selectedDate} onChange={(event) => event.target.value && setSelectedDate(event.target.value)} />
          </label>
          <button type="button" aria-label="後一天" onClick={() => setSelectedDate((date) => shiftDateKey(date, 1))}><ChevronRight size={17} /></button>
        </div>
      </section>

      <section className="worklog-summary-strip">
        <div className="summary-week"><span className="summary-label">本週進度</span><strong>{weekTotalHours}<span>/40</span><small>小時</small></strong><div className="mini-progress"><i style={{ width: `${Math.min(weekTotalHours / 40 * 100, 100)}%` }} /></div></div>
        <div className="summary-divider" />
        <div className="summary-day"><span className="summary-label">所選日期已排入</span><strong>{selectedDayHours}<small>小時</small></strong></div>
        <div className="summary-callout"><Clock3 size={16} /><span>建議工作時數 8 小時</span><strong>還差 {displayHours(Math.max(8 - selectedDayHours, 0))} 小時</strong></div>
      </section>

      {/* Calendar + Drafts side by side on wide screens */}
      <div className="worklog-two-col">
        <section className="work-section calendar-section">
          <div className="section-heading-row">
            <div className="section-title-wrap"><span className="section-icon calendar-icon"><CalendarDays size={17} /></span><div><h2>行事曆建議</h2><p>{calendarConnected ? aiStatus === 'ready' ? 'AI 分類・加入草稿前請確認' : aiStatus === 'error' ? 'AI 呼叫失敗・行程保留待手動分類' : 'Calendar 行程已連接・AI 尚未設定' : '連接 Google Calendar 讀取行程'}</p></div></div>
            <div className="calendar-connect-actions">
              <span className={`connection-label ${calendarConnected ? 'connected' : ''}`}><i />{calendarConnected ? 'Google Calendar 已連線' : '尚未連線'}</span>
              {calendarConnected ? <button className="small-text-button" type="button" onClick={() => void disconnectCalendar()}>解除連接</button> : <button className="small-text-button" type="button" onClick={connectCalendar} disabled={calendarLoading}>{calendarAuthRequired ? '先登入 Google' : '連接 Google Calendar'}</button>}
            </div>
          </div>

          {calendarMessage && <div className="calendar-status-message" role="status">{calendarMessage}</div>}
          {calendarLoading && <div className="calendar-empty">正在載入 Google Calendar…</div>}
          {!calendarLoading && !calendarConnected && <div className="calendar-empty">
            <span>{calendarAuthRequired ? '請先登入 Google 帳號，再授權 NL-agent 讀取行事曆。' : '授權 NL-agent 讀取 Google Calendar 後，今日行程會顯示在這裡。'}</span>
            <button className="button button-primary calendar-connect-button" type="button" onClick={connectCalendar}>
              <CalendarDays size={14} />{calendarAuthRequired ? '使用 Google 登入' : '連接 Google Calendar'}
            </button>
          </div>}
          {!calendarLoading && calendarConnected && calendarEvents.length === 0 && <div className="calendar-empty">今日沒有行程。</div>}

          {recordedCalendarCount > 0 && <p className="jira-calendar-recorded">
            {recordedCalendarCount} 筆行程已和 Jira 工時配對，可在「Jira 已登錄工時」查看。
          </p>}
          {highConfidence.length > 0 && (
            <div className="calendar-group">
              <div className="calendar-group-header"><Check size={13} className="confidence-high-icon" /><span className="confidence-label confidence-high">判為工作・請確認要加入的行程</span></div>
              <div className="calendar-suggestion-list">
                {highConfidence.map((event) => (
                  <label className={`calendar-suggestion${event.project ? ' has-project' : ' no-project'}`} key={event.id}>
                    <input type="checkbox" checked={isEventSelected(event)} onChange={(change) => {
                      const checked = change.target.checked;
                      setEventSelections((previous) => ({ ...previous, [event.id]: checked }));
                    }} />
                    <span className="suggestion-check"><Check size={12} /></span>
                    <span className="suggestion-time">{event.time}</span>
                    <span className="suggestion-title" title={event.title}>{event.title}<WorklogMatchNotice match={calendarMatches.get(event.id)} /></span>
                    <span className="suggestion-project">{event.project}</span>
                    <span className="suggestion-hours">{event.hours}h</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {uncertain.length > 0 && (
            <div className="calendar-group">
              <div className="calendar-group-header"><CircleHelp size={13} className="confidence-uncertain-icon" /><span className="confidence-label confidence-uncertain">{aiStatus === 'ready' ? 'AI 無法確定・請你判斷' : '待分類・請你確認工作或私人'}</span></div>
              <div className="calendar-suggestion-list uncertain-list">
                {uncertain.map((event) => {
                  const decision = uncertainDecisions[event.id];
                  return (
                    <div className={`calendar-suggestion uncertain-suggestion ${decision ? 'decided' : ''}`} key={event.id}>
                      <span className="suggestion-time">{event.time}</span>
                      <span className="suggestion-title" title={event.reason}>{event.title}<WorklogMatchNotice match={calendarMatches.get(event.id)} /></span>
                      {!decision ? (
                        <span className="uncertain-actions">
                          <button className="uncertain-btn work-btn" type="button" onClick={() => handleUncertainDecision(event.id, 'work')}>工作</button>
                          <button className="uncertain-btn skip-btn" type="button" onClick={() => handleUncertainDecision(event.id, 'skip')}>跳過</button>
                        </span>
                      ) : (
                        <span className={`uncertain-decided ${decision}`}>
                          {decision === 'work' ? '✓ 列入' : '已跳過'}
                          <button className="undo-decision" type="button" onClick={() => {
                            setUncertainDecisions((prev) => { const next = { ...prev }; delete next[event.id]; return next; });
                            setEventSelections((current) => ({ ...current, [event.id]: false }));
                          }}><X size={12} /></button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {skipped.length > 0 && (
            <div className="calendar-group">
              <button className="collapsible-header" type="button" onClick={() => setShowSkipped(!showSkipped)}>
                <span className="confidence-label confidence-skip"><X size={13} className="confidence-skip-icon" /> 已跳過 {skipped.length} 筆</span>
                <ChevronDown size={14} className={`collapse-chevron ${showSkipped ? 'open' : ''}`} />
              </button>
              {showSkipped && (
                <div className="calendar-suggestion-list skipped-list">
                  {skipped.map((event) => (
                    <div className="calendar-suggestion skipped" key={event.id}>
                      <span className="suggestion-time">{event.time}</span>
                      <span className="suggestion-title">{event.title}</span>
                      <span className="skip-reason">{event.skipReason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {candidates.length > 0 && <div className="calendar-actions">
            <span>{aiStatus === 'ready' ? 'AI 分類僅供參考，送出前請確認。' : aiStatus === 'error' ? 'AI 呼叫失敗，行程保留待手動分類。' : '尚未設定 AI，行程不會自動判定工作或私人。'}</span>
            <button className="small-text-button" type="button" onClick={addCalendarSuggestions} disabled={jiraMatching || jiraSubmitting || !candidates.some(isEventSelected)}><Plus size={14} />加入草稿</button>
          </div>}
        </section>

        <section className="work-section draft-section">
          <div className="section-heading-row">
            <div className="section-title-wrap"><span className="section-icon draft-icon"><FileClock size={17} /></span><div><h2>所選日期草稿</h2><p>確認後送出</p></div></div>
            <div className="draft-total"><strong>{totalHours}h</strong><span className="draft-ready"><Check size={12} /></span></div>
          </div>
          <div className="jira-connector">
            <div className="jira-connector-status"><strong>Jira</strong><span>{jiraConnected ? '已連線' : jiraConfigured ? '尚未連線' : '等待後端設定 Client ID / Secret'}</span></div>
            {!jiraConnected ? <button className="button button-secondary jira-connect-button" type="button" onClick={connectJira} disabled={!jiraConfigured}>連接 Jira</button> : <>
              <select aria-label="選擇 Jira 網站" value={selectedCloudId} onChange={(event) => void selectJiraSite(event.target.value)} disabled={jiraBusy || jiraSubmitting || jiraSites.length === 0}>
                <option value="">選擇 Jira 網站</option>
                {jiraSites.map((site) => <option value={site.id} key={site.id}>{site.name}（{site.url.replace(/^https?:\/\//, '')}）</option>)}
              </select>
              <button className="small-text-button jira-disconnect-button" type="button" onClick={() => void disconnectJira()} disabled={jiraSubmitting}>解除連線</button>
            </>}
          </div>
          {jiraConnected && selectedCloudId && <section className="jira-recorded-worklogs" aria-labelledby="jira-recorded-title">
            <div className="jira-recorded-heading">
              <h3 id="jira-recorded-title">Jira 已登錄工時</h3>
              <button className="jira-refresh-button" type="button" onClick={() => setJiraRevision((revision) => revision + 1)}>重新整理 Jira 工時</button>
            </div>
            <p role="status">{activeSnapshot?.error ?? (!activeSnapshot || activeSnapshot.loading ? '正在讀取 Jira 工時…' :
              !todayJiraWorklogs.length ? '所選日期沒有已登錄工時。' :
              `${todayJiraWorklogs.length} 筆・${displayHours(todayJiraWorklogs.reduce((sum, row) => sum + row.timeSpentSeconds, 0) / 3600)} 小時`)}</p>
            {todayJiraWorklogs.length > 0 && <ul>
              {todayJiraWorklogs.map((row) => <li key={row.id}>
                <div>
                  {jiraSiteUrl ? <a href={`${jiraSiteUrl}/browse/${encodeURIComponent(row.issueKey)}`} target="_blank" rel="noreferrer">{row.issueKey}</a> : <strong>{row.issueKey}</strong>}
                  {row.issueStatus && <span className="jira-recorded-status">{row.issueStatus}</span>}
                  <span className="jira-recorded-description">{row.comment || row.issueSummary}</span>
                </div>
                <span>{jiraClock.format(new Date(row.started))} · {displayHours(row.timeSpentSeconds / 3600)}h</span>
              </li>)}
            </ul>}
          </section>}
          {selectedDrafts.length ? <div className="draft-table-wrap">
            <table className="draft-table">
              <thead><tr><th>專案</th><th>票卡</th><th>內容</th><th>時數</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{selectedDrafts.map((draft) => {
                const match = draftMatches.get(draft.id);
                const approved = match && draft.approvedDuplicate === duplicateReviewKey(draft, match, selectedCloudId);
                const needsTicket = !draft.issueKey && !draft.newIssueSummary;
                const validHours = Number.isFinite(draft.hours) && draft.hours >= 1 / 60 && draft.hours <= 24;
                const canSearch = Boolean(jiraConnected && selectedCloudId && draft.projectKey && !jiraSubmitting);
                return <Fragment key={draft.id}>
                  <tr>
                    <td>{jiraConnected && selectedCloudId ? <select className="jira-row-project-select" aria-label={draft.summary + ' 的 Jira 專案'}
                      value={draft.projectKey ?? ''} onChange={(event) => updateDraft(draft.id, {
                        projectKey: event.target.value || undefined, issueKey: undefined, newIssueSummary: undefined,
                        createNewIssue: false, project: '待選票卡', approvedDuplicate: undefined,
                      })} disabled={jiraBusy || jiraSubmitting || !jiraProjects.length}>
                      <option value="">{jiraMatching ? 'AI 配對中…' : '選擇專案'}</option>
                      {jiraProjects.map((project) => <option value={project.key} key={project.id}>{project.key}・{project.name}</option>)}
                    </select> : draft.projectKey ?? '待配對'}</td>
                    <td>{draft.issueKey || (draft.newIssueSummary ? '待建：' + draft.newIssueSummary : draft.projectKey ? '待選票卡' : '請先選專案')}
                      {canSearch && !needsTicket && <button className="small-text-button draft-ticket-button" type="button"
                        aria-expanded={editingTicketId === draft.id}
                        onClick={() => setEditingTicketId((current) => current === draft.id ? null : draft.id)}>
                        {editingTicketId === draft.id ? '關閉搜尋' : '更換票卡'}
                      </button>}
                    </td>
                    <td>{draft.summary}
                      {readyIds.has(draft.id) && !draft.submitError && <small className="draft-ready-label">{approved ? '已確認保留' : '可送出'}</small>}
                      {draft.submitError && <small className="draft-attention-label">上次送出未完成</small>}
                    </td>
                    <td>{editingId === draft.id && !jiraSubmitting ? <input className="hours-input" type="number" min="0.25" max="24" step="0.25"
                      value={draft.hours} onChange={(event) => updateHours(draft.id, Number(event.target.value))}
                      onBlur={() => setEditingId(null)} aria-label="編輯工時" autoFocus /> : draft.hours + 'h'}</td>
                    <td className="draft-actions">
                      <button type="button" aria-label={'編輯 ' + draft.summary} onClick={() => setEditingId(draft.id)} disabled={jiraSubmitting}><Edit3 size={14} /></button>
                      <button type="button" aria-label={'移除 ' + draft.summary} onClick={() => removeDraft(draft.id)} disabled={jiraSubmitting}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                  {((canSearch && (needsTicket || editingTicketId === draft.id)) || match || draft.submitError || !validHours) && <tr className="draft-review-row">
                    <td colSpan={5}>
                      {canSearch && (needsTicket || editingTicketId === draft.id) && <DraftIssueSearch
                        key={selectedCloudId + ':' + draft.projectKey} draft={draft} cloudId={selectedCloudId}
                        onSelect={(issueKey, newIssueSummary) => {
                          updateDraft(draft.id, { issueKey, newIssueSummary, createNewIssue: Boolean(newIssueSummary),
                            project: issueKey || '待建立票卡', approvedDuplicate: undefined });
                          setEditingTicketId(null);
                        }} />}
                      {!validHours && <p className="draft-attention-label">請將時數調整為 1 分鐘至 24 小時。</p>}
                      {draft.submitError && <p className="draft-attention-label" role="status">{draft.submitError}</p>}
                      {match && <div className="draft-match-review">
                        <strong>{match.exact ? 'Jira 已登錄' : '可能重複'}</strong>
                        <dl>
                          <div><dt>這筆草稿</dt><dd>{draft.summary} · {displayHours(draft.hours)} 小時</dd></div>
                          <div><dt>Jira {match.worklog.issueKey}</dt><dd>{match.worklog.comment || match.worklog.issueSummary} · {jiraClock.format(new Date(match.worklog.started))} · {displayHours(match.worklog.timeSpentSeconds / 3600)} 小時</dd></div>
                        </dl>
                        <div className="draft-match-actions">
                          <button className="small-text-button" type="button" disabled={jiraSubmitting}
                            onClick={() => removeDraft(draft.id)}>略過這筆草稿</button>
                          {!match.exact && <button className="small-text-button" type="button" disabled={jiraSubmitting}
                            onClick={() => updateDraft(draft.id, { approvedDuplicate: approved ? undefined : duplicateReviewKey(draft, match, selectedCloudId) })}>
                            {approved ? '取消保留' : '仍要送出'}
                          </button>}
                        </div>
                      </div>}
                    </td>
                  </tr>}
                </Fragment>;
              })}</tbody>
            </table>
          </div> : <div className="empty-drafts"><FileClock size={20} /><span>草稿是空的，加入日曆建議或手動補登。</span></div>}

          <div className="manual-worklog-form">
            <div className="manual-worklog-heading"><Sparkles size={14} /><strong>手動補登</strong><span>{formatDateKey(selectedDate, { month: 'numeric', day: 'numeric', weekday: 'short' })}</span></div>
            <div className="manual-worklog-fields">
              <div className="manual-project-field">
                <select aria-label="手動補登專案" value={selectedProjectKey} onChange={(event) => {
                  setSelectedProjectKey(event.target.value);
                  clearManualIssue();
                }} disabled={!jiraConnected || !selectedCloudId || jiraBusy || jiraSubmitting}>
                  <option value="">選擇專案</option>
                  {jiraProjects.map((project) => <option value={project.key} key={project.id}>{project.key}・{project.name}</option>)}
                </select>
                <button type="button" className="manual-new-project"
                  disabled={!jiraConnected || !selectedCloudId || jiraBusy || jiraSubmitting}
                  onClick={() => { setProjectError(''); setProjectConsentRequired(false); projectDialogRef.current?.showModal(); }}>
                  <Plus size={14} aria-hidden="true" />新增專案
                </button>
              </div>
              <WorklogIssueSearch key={selectedCloudId + ':' + selectedProjectKey}
                apiBaseUrl={API_BASE_URL} inputRef={manualInputRef} cloudId={selectedCloudId} projectKey={selectedProjectKey}
                value={manualSummary} selection={manualIssueLabel} disabled={jiraSubmitting}
                onChange={setManualSummary} onClear={clearManualIssue} onSelect={(issue) => {
                  if (issue) setManualSummary(issue.summary);
                  setManualIssueKey(issue?.key ?? '');
                  setManualNewIssueSummary(issue ? '' : manualSummary.trim());
                  setManualIssueLabel(issue ? `${issue.key}・${issue.summary}` : `新票卡・${manualSummary.trim()}`);
                }}
              />
              <label className="manual-hours-field"><input aria-label="手動補登時數" type="number" min="0.25" max="24" step="0.25" value={manualHours} onChange={(event) => setManualHours(event.target.value)} /><span>小時</span></label>
              <button className="button button-primary manual-add-button" type="button" onClick={addManualDraft} disabled={jiraSubmitting || !selectedProjectKey || !manualSummary.trim() || !manualIssueLabel || !(Number(manualHours) >= 0.25 && Number(manualHours) <= 24)}>加入草稿</button>
            </div>
            {manualMatch && <p className="manual-jira-match" role="status">
              <WorklogMatchNotice match={manualMatch} /> {manualMatch.reason}：{manualMatch.worklog.comment || manualMatch.worklog.issueSummary}
            </p>}
          </div>
        </section>
      </div>

      <section className="work-section overview-section">
        <div className="section-heading-row">
          <button className="collapsible-header" type="button" onClick={() => setShowOverview(!showOverview)} style={{ flex: 1 }}>
            <div className="section-title-wrap"><span className="section-icon month-icon"><CalendarDays size={17} /></span><div><h2>工時總覽</h2></div></div>
            <ChevronDown size={16} className={`collapse-chevron ${showOverview ? 'open' : ''}`} />
          </button>
          {showOverview && (
            <div className="overview-tabs">
              <button className={`overview-tab ${overviewMode === 'week' ? 'active' : ''}`} type="button" onClick={() => setOverviewMode('week')}>本週</button>
              <button className={`overview-tab ${overviewMode === 'month' ? 'active' : ''}`} type="button" onClick={() => setOverviewMode('month')}>本月</button>
            </div>
          )}
        </div>

        {showOverview && overviewMode === 'week' && (() => {
          const weekEnd = weekDays[6].dateKey;
          return (
            <>
              <div className="week-header-row">
                <div className="month-switcher"><button type="button" aria-label="前一週" onClick={() => setSelectedDate((date) => shiftDateKey(date, -7))}><ChevronLeft size={16} /></button><strong>{formatDateKey(selectedWeekStart, { month: 'numeric', day: 'numeric' })} — {formatDateKey(weekEnd, { month: 'numeric', day: 'numeric' })}</strong><button type="button" aria-label="下一週" onClick={() => setSelectedDate((date) => shiftDateKey(date, 7))}><ChevronRight size={16} /></button></div>
                <span className="week-total-label">{weekTotalHours} / 40h</span>
              </div>
              <div className="week-grid">
                {weekDays.map((d) => {
                  const isToday = d.dateKey === todayDateKey;
                  const weekday = dateKeyToUtcDate(d.dateKey).getUTCDay();
                  const isWeekend = weekday === 0 || weekday === 6;
                  const wl = worklogsForDate(d.dateKey, drafts, jiraWorklogs);
                  const hrs = wl.reduce((sum, worklog) => sum + worklog.hours, 0);
                  const isSelected = d.dateKey === selectedDate;
                  const needsFill = !isWeekend && !isToday && hrs === 0 && (!jiraConnected || activeSnapshot?.loading === false && !activeSnapshot.error);
                  return (
                    <button
                      className={`week-cell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${isWeekend ? ' is-off' : ''}${needsFill ? ' needs-fill' : ''}`}
                      type="button"
                      key={d.dateKey}
                      aria-label={`${d.fullDate} 填寫工時`}
                      aria-pressed={isSelected}
                      onClick={() => openWorklogDate(d.dateKey)}
                    >
                      <span className="week-cell-label">{d.label}</span>
                      <span className="week-cell-date">{d.date}</span>
                      <div className="week-cell-bar-area"><span className="week-cell-bar" style={{ height: `${Math.max(hrs / 8 * 100, 4)}%` }} /></div>
                      <span className="week-cell-hours">{hrs > 0 ? `${displayHours(hrs)}h` : isWeekend ? '休' : '—'}</span>
                    </button>
                  );
                })}
              </div>
              {(() => {
                const sel = weekDays.find((d) => d.dateKey === selectedDate);
                if (!sel) return null;
                const isToday = sel.dateKey === todayDateKey;
                const weekday = dateKeyToUtcDate(sel.dateKey).getUTCDay();
                const isWeekend = weekday === 0 || weekday === 6;
                const wl = worklogsForDate(sel.dateKey, drafts, jiraWorklogs);
                const hrs = wl.reduce((sum, worklog) => sum + worklog.hours, 0);
                return (
                  <div className="selected-day-panel">
                    <div className="selected-day-header">
                      <strong>{sel.fullDate}（{sel.label}）</strong>
                      {isWeekend && <span className="day-off-tag">休息日</span>}
                      {!isWeekend && <span className="day-hours-tag">{displayHours(hrs)} / 8h</span>}
                    </div>
                    {wl.length > 0 ? (
                      <div className="day-detail-list">
                        {wl.map((w, i) => (
                          <div className="day-detail-row" key={i}>
                            <span className="day-detail-project"><span className="project-dot" />{w.project}</span>
                            <span className="day-detail-summary">{w.summary}</span>
                            <span className="day-detail-hours">{displayHours(w.hours)}h</span>
                            {w.status && <span className="day-detail-status">{w.status}</span>}
                          </div>
                        ))}
                      </div>
                    ) : isWeekend ? (
                      <div className="day-detail-empty">週末，不需填寫工時</div>
                    ) : isToday ? (
                      <div className="day-detail-list">
                        <div className="day-detail-info">草稿尚未送出，確認後會顯示在這裡</div>
                      </div>
                    ) : (
                      <div className="day-detail-empty">尚未記錄工時</div>
                    )}
                  </div>
                );
              })()}
              <div className="month-legend"><span><i className="legend-filled" />有工時</span><span><i className="legend-empty-day" />尚未填寫</span><span><i className="legend-off" />週末</span></div>
            </>
          );
        })()}

        {showOverview && overviewMode === 'month' && (
          <>
            <div className="month-switcher-row">
              <div className="month-switcher"><button type="button" aria-label="前一月" onClick={() => setSelectedDate((date) => shiftMonthDateKey(date, -1))}><ChevronLeft size={16} /></button><strong>{formatDateKey(selectedDate, { year: 'numeric', month: 'long' })}</strong><button type="button" aria-label="下一月" onClick={() => setSelectedDate((date) => shiftMonthDateKey(date, 1))}><ChevronRight size={16} /></button></div>
              <span className="week-total-label">{displayHours(monthDays.reduce((sum, item) => sum + item.totalHours, 0))}h</span>
            </div>
            <div className="month-calendar">
              {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="month-weekday" key={day}>{day}</span>)}
              {monthDays.map((item, index) => {
                const isSelected = item.dateKey === selectedDate && !item.muted;
                const needsFill = !item.muted && item.isWorkday && !item.today && item.hours === '—' && item.dateKey < todayDateKey
                  && (!jiraConnected || activeSnapshot?.loading === false && !activeSnapshot.error);
                return (
                  <button
                    className={`month-day${item.today ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${item.muted ? ' is-muted' : ''}${(item.isWeekend || item.isHoliday) && !item.muted ? ' is-off' : ''}${needsFill ? ' needs-fill' : ''}${item.hours === '—' ? ' no-hours' : ''}`}
                    type="button"
                    key={`${item.date}-${index}`}
                    disabled={item.muted}
                    aria-pressed={isSelected}
                    aria-label={`${formatDateKey(item.dateKey, { month: 'numeric', day: 'numeric' })} 填寫工時`}
                    onClick={() => openWorklogDate(item.dateKey)}
                    title={item.holidayName || undefined}
                  >
                    <span>{item.date}</span>
                    <small>{item.totalHours > 0 ? item.hours : item.isHoliday && !item.muted ? '假' : item.isWeekend && !item.muted ? '休' : item.hours}</small>
                  </button>
                );
              })}
            </div>
            {(() => {
              const sel = monthDays.find((item) => item.dateKey === selectedDate && !item.muted);
              if (!sel) return null;
              const worklogs = sel.worklogs;
              const isToday = sel.today;
              const isOff = sel.isWeekend || sel.isHoliday;
              return (
                <div className="selected-day-panel">
                  <div className="selected-day-header">
                    <strong>{formatDateKey(sel.dateKey, { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })}</strong>
                    {sel.holidayName && <span className="day-holiday-tag">{sel.holidayName}</span>}
                    {isOff && !sel.holidayName && <span className="day-off-tag">休息日</span>}
                    {(!isOff || sel.totalHours > 0) && <span className="day-hours-tag">{displayHours(sel.totalHours)} / 8h</span>}
                  </div>
                  {worklogs.length > 0 ? (
                    <div className="day-detail-list">
                      {worklogs.map((w, i) => (
                        <div className="day-detail-row" key={i}>
                          <span className="day-detail-project"><span className="project-dot" />{w.project}</span>
                          <span className="day-detail-summary">{w.summary}</span>
                          <span className="day-detail-hours">{displayHours(w.hours)}h</span>
                          {w.status && <span className="day-detail-status">{w.status}</span>}
                        </div>
                      ))}
                    </div>
                  ) : isOff ? (
                    <div className="day-detail-empty">{sel.holidayName || '週末'}，不需填寫工時</div>
                  ) : isToday ? (
                    <div className="day-detail-list">
                      <div className="day-detail-info">草稿尚未送出，確認後會顯示在這裡</div>
                    </div>
                  ) : (
                    <div className="day-detail-empty">尚未記錄工時</div>
                  )}
                </div>
              );
            })()}
            <div className="month-legend"><span><i className="legend-filled" />有工時</span><span><i className="legend-empty-day" />尚未填寫</span><span><i className="legend-off" />假日/週末</span><span className="holiday-note"><AlertTriangle size={13} />依 Nextlink 工作日曆</span></div>
          </>
        )}
      </section>

      <div className="sticky-submit-bar">
        <div className="sticky-submit-inner">
          <span className="draft-security"><CheckCheck size={15} />確認前不會寫入 Jira</span>
          <div className="sticky-submit-right">
            <span className="sticky-total">{jiraConnected && selectedCloudId && (!activeSnapshot || activeSnapshot.loading)
              ? '正在比對 Jira 工時…'
              : <>{waitingCount > 0 && `${waitingCount} 筆待處理・`}<strong>{readyDrafts.length} 筆可送出</strong></>}
            </span>
            <button className="button button-primary" type="button"
              disabled={jiraSubmitting || jiraBusy || !jiraConnected || !selectedCloudId || !activeSnapshot || activeSnapshot.loading || !readyDrafts.length}
              onClick={() => setShowConfirm(true)}>確認送出 <ArrowRight size={16} /></button>
          </div>
        </div>
      </div>

      {message && <div className="toast-message" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="關閉">×</button></div>}
      {showConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (!jiraSubmitting && event.target === event.currentTarget) setShowConfirm(false);
      }}>
        <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <span className="modal-icon"><AlertTriangle size={21} /></span>
          <h2 id="confirm-title">確認寫入 Jira 工時</h2>
          <p>{formatDateKey(selectedDate, { month: 'numeric', day: 'numeric', weekday: 'short' })}
            {' · '}{readyDrafts.length} 筆工時，合計 {readyHours} 小時。</p>
          {waitingCount > 0 && <p>另有 {waitingCount} 筆草稿會留待確認。</p>}
          {!!activeSnapshot?.error && <p role="status">Jira 工時同步失敗，請視需要重新整理後再確認。</p>}
          {readyDrafts.some((draft) => draft.newIssueSummary) && <p>待建立的票卡會在送出時新增到 Jira。</p>}
          <div className="modal-actions">
            <button className="button button-secondary modal-close" type="button" onClick={() => setShowConfirm(false)} disabled={jiraSubmitting}>返回檢查</button>
            <button className="button button-primary modal-close" type="button" onClick={() => void submitWorklogs()}
              disabled={jiraSubmitting || !readyDrafts.length}>{jiraSubmitting ? '正在寫入…' : '確認寫入 Jira'}</button>
          </div>
        </section>
      </div>}
      <div className="preview-footnote">草稿送出前須選擇 Jira 票卡，並經你確認後才會寫入 Jira。</div>
    </div>
  );
}

export default Worklogs;
