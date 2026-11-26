import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Edit3, FileClock, Plus, Sparkles, Trash2, X } from 'lucide-react';

type Draft = { id: number; project: string; projectKey?: string; issueKey?: string; newIssueSummary?: string; createNewIssue?: boolean; started: string; hours: number; summary: string; source: 'Calendar' | '手動補登'; };

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
type JiraIssue = { id: string; key: string; summary: string; status: string; issueType: string; projectKey?: string };
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

const previewStarted = (hour: number) => new Date(2026, 10, 26, hour, 0, 0).toISOString();
const initialDrafts: Draft[] = [
  { id: 11, project: '待選票卡', hours: 1, started: previewStarted(9), summary: 'Sprint Planning', source: 'Calendar' },
  { id: 12, project: '待選票卡', hours: 1.5, started: previewStarted(10), summary: 'API Review', source: 'Calendar' },
  { id: 13, project: '待選票卡', hours: 5.5, started: previewStarted(13), summary: '開發與測試', source: '手動補登' },
];

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

const dayWorklogs: Record<number, DayWorklog[]> = {
  2: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: 'API 設計' }],
  3: [{ project: 'ACME-1', hours: 6, summary: '功能開發' }, { project: 'ACME-12', hours: 2, summary: 'Sprint Review' }],
  4: [{ project: 'GLOBEX-5', hours: 5, summary: 'API 測試' }, { project: 'ACME-1', hours: 3, summary: 'Code Review' }],
  5: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: 'POC 展示' }],
  6: [{ project: 'ACME-12', hours: 3, summary: 'Sprint Planning' }, { project: 'ACME-1', hours: 5, summary: '功能開發' }],
  9: [{ project: 'ACME-1', hours: 8, summary: '功能開發與測試' }],
  10: [{ project: 'GLOBEX-5', hours: 4, summary: 'API 開發' }, { project: 'ACME-1', hours: 4, summary: 'Bug 修復' }],
  11: [{ project: 'ACME-1', hours: 6, summary: '功能開發' }, { project: 'ACME-12', hours: 2, summary: 'Backlog Grooming' }],
  12: [{ project: 'GLOBEX-5', hours: 8, summary: 'API 整合測試' }],
  13: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: '文件撰寫' }],
  16: [{ project: 'ACME-1', hours: 8, summary: '功能開發' }],
  17: [{ project: 'GLOBEX-5', hours: 5, summary: 'API Review' }, { project: 'ACME-1', hours: 3, summary: 'Code Review' }],
  18: [{ project: 'ACME-1', hours: 8, summary: '功能開發與測試' }],
  19: [{ project: 'ACME-12', hours: 2, summary: 'Sprint Review' }, { project: 'ACME-1', hours: 6, summary: '功能開發' }],
  20: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: 'API 文件' }],
  23: [{ project: 'ACME-1', hours: 8, summary: '功能開發' }],
  24: [{ project: 'GLOBEX-5', hours: 4, summary: 'API 開發' }, { project: 'ACME-1', hours: 4, summary: 'Bug 修復' }],
  25: [{ project: 'ACME-1', hours: 6, summary: '功能開發' }, { project: 'ACME-12', hours: 2, summary: 'Backlog Grooming' }],
};

function taipeiDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

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

function worklogsForDate(dateKey: string, drafts: Draft[]): DayWorklog[] {
  const draftsForDate = draftWorklogsForDate(dateKey, drafts);
  if (draftsForDate.length) return draftsForDate;
  if (dateKey.startsWith('2026-11-')) return dayWorklogs[Number(dateKey.slice(-2))] ?? [];
  return [];
}

function getMonthGrid(dateKey: string, drafts: Draft[]) {
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
    const worklogs = sameMonth ? worklogsForDate(cellDateKey, drafts) : [];
    const totalHours = worklogs.reduce((sum, worklog) => sum + worklog.hours, 0);
    const hours = totalHours > 0 ? `${totalHours}h` : '—';
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
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [uncertainDecisions, setUncertainDecisions] = useState<Record<string, 'work' | 'skip'>>({});
  const [manualSummary, setManualSummary] = useState('');
  const [manualHours, setManualHours] = useState('1');
  const [manualIssueKey, setManualIssueKey] = useState('');
  const [manualNewIssueSummary, setManualNewIssueSummary] = useState('');
  const [manualIssueOptions, setManualIssueOptions] = useState<JiraIssue[]>([]);
  const [message, setMessage] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(taipeiDateKey());
  const [todayDateKey, setTodayDateKey] = useState(taipeiDateKey());
  const dateInputRef = useRef<HTMLInputElement>(null);
  const monthDays = useMemo(() => getMonthGrid(selectedDate, drafts), [selectedDate, drafts]);
  const selectedDayHours = useMemo(() => worklogsForDate(selectedDate, drafts).reduce((sum, worklog) => sum + worklog.hours, 0), [selectedDate, drafts]);
  const selectedDrafts = useMemo(() => drafts.filter((draft) => taipeiDateKey(new Date(draft.started)) === selectedDate), [selectedDate, drafts]);
  const selectedWeekStart = shiftDateKey(selectedDate, -((dateKeyToUtcDate(selectedDate).getUTCDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const dateKey = shiftDateKey(selectedWeekStart, index);
    const date = dateKeyToUtcDate(dateKey);
    return { dateKey, label: formatDateKey(dateKey, { weekday: 'short' }), date: date.getUTCDate(), fullDate: formatDateKey(dateKey, { month: 'numeric', day: 'numeric' }) };
  });
  const weekTotalHours = weekDays.reduce((sum, day) => sum + worklogsForDate(day.dateKey, drafts).reduce((hours, worklog) => hours + worklog.hours, 0), 0);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [overviewMode, setOverviewMode] = useState<'week' | 'month'>('week');
  const [jiraConfigured, setJiraConfigured] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [jiraSites, setJiraSites] = useState<JiraSite[]>([]);
  const [selectedCloudId, setSelectedCloudId] = useState('');
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState('');
  const [jiraIssues, setJiraIssues] = useState<Record<number, JiraIssue[]>>({});
  const [jiraMatching, setJiraMatching] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [jiraSubmitting, setJiraSubmitting] = useState(false);
  const totalHours = selectedDayHours;
  const hasUnresolvedIssue = drafts.some((draft) => !draft.issueKey && !(draft.projectKey && draft.newIssueSummary && draft.createNewIssue));

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
        setDrafts(valid ? parsed : initialDrafts);
      } catch {
        setDrafts(initialDrafts);
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
        setSelectedEvents(mappedEvents.filter((event) => event.confidence === 'high').map((event) => event.id));
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
      setJiraIssues({});
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
    if (!jiraConnected || !selectedCloudId || drafts.length === 0) {
      setJiraIssues({});
      return;
    }
    let cancelled = false;
    const loadIssueOptions = async () => {
      const options = await Promise.all(drafts.map(async (draft) => {
        const query = new URLSearchParams({ query: draft.summary });
        if (draft.projectKey) query.set('projectKey', draft.projectKey);
        try {
          const response = await fetch(`${API_BASE_URL}/jira/issues?${query}`, { credentials: 'include' });
          if (!response.ok) return [draft.id, []] as const;
          const data = await response.json() as { issues: JiraIssue[] };
          return [draft.id, data.issues] as const;
        } catch { return [draft.id, []] as const; }
      }));
      if (!cancelled) setJiraIssues(Object.fromEntries(options));
    };
    void loadIssueOptions();
    return () => { cancelled = true; };
  }, [jiraConnected, selectedCloudId, drafts.map((draft) => `${draft.id}:${draft.summary}:${draft.projectKey ?? ''}`).join('|')]);

  useEffect(() => {
    if (!jiraConnected || !selectedCloudId || !selectedProjectKey || !manualSummary.trim()) {
      setManualIssueOptions([]);
      return;
    }
    let cancelled = false;
    const loadManualIssues = async () => {
      const query = new URLSearchParams({ projectKey: selectedProjectKey, query: manualSummary.trim() });
      try {
        const response = await fetch(`${API_BASE_URL}/jira/issues?${query}`, { credentials: 'include' });
        const data = response.ok ? await response.json() as { issues: JiraIssue[] } : { issues: [] };
        if (!cancelled) setManualIssueOptions(data.issues);
      } catch { if (!cancelled) setManualIssueOptions([]); }
    };
    void loadManualIssues();
    return () => { cancelled = true; };
  }, [jiraConnected, selectedCloudId, selectedProjectKey, manualSummary]);

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
      setDrafts((current) => current.map((draft) => ({ ...draft, project: '待選票卡', issueKey: undefined, createNewIssue: false })));
      setMessage('已解除 Jira 連線。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '解除 Jira 連線失敗。'); }
  };

  const chooseIssue = (draftId: number, issueKey: string) => {
    const issue = (jiraIssues[draftId] ?? []).find((item) => item.key === issueKey);
    setDrafts((current) => current.map((draft) => draft.id === draftId
      ? { ...draft, issueKey: issue?.key, projectKey: issue?.projectKey ?? draft.projectKey, createNewIssue: false, project: issue?.key ?? '待選票卡' }
      : draft));
  };

  const createJiraIssue = async (projectKey: string, summary: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/jira/issues`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, summary }),
      });
      const data = await response.json() as { key?: string; message?: string };
      if (!response.ok || !data.key) throw new Error(data.message || '建立 Jira 票卡失敗');
      return data.key;
    } catch (error) { setMessage(error instanceof Error ? error.message : '建立 Jira 票卡失敗。'); return ''; }
  };

  const addManualDraft = () => {
    const hours = Number(manualHours);
    if (!selectedProjectKey || (!manualIssueKey && !manualNewIssueSummary) || !manualSummary.trim() || !Number.isFinite(hours) || hours <= 0) {
      setMessage('手動補登請選擇專案與票卡，並填寫內容及有效時數。');
      return;
    }
    setDrafts((current) => [...current, { id: Date.now(), project: manualIssueKey || '待建立票卡', projectKey: selectedProjectKey, issueKey: manualIssueKey || undefined, newIssueSummary: manualNewIssueSummary || undefined, createNewIssue: Boolean(manualNewIssueSummary), started: new Date(`${selectedDate}T12:00:00+08:00`).toISOString(), hours, summary: manualSummary.trim(), source: '手動補登' }]);
    setManualSummary(''); setManualHours('1'); setManualIssueKey(''); setManualNewIssueSummary('');
    setMessage('手動工時已加入草稿。');
  };

  const submitWorklogs = async () => {
    if (!jiraConnected || !selectedCloudId) {
      setMessage('請先連接 Jira 並選擇 Jira 網站。');
      return;
    }
    if (drafts.some((draft) => !draft.issueKey && !(draft.projectKey && draft.newIssueSummary && draft.createNewIssue))) {
      setMessage('每筆草稿都要先選擇既有票卡或指定待建立的新票卡。');
      return;
    }
    setJiraSubmitting(true);
    try {
      const resolvedDrafts: Draft[] = [];
      for (const draft of drafts) {
        if (draft.issueKey) { resolvedDrafts.push(draft); continue; }
        const key = await createJiraIssue(draft.projectKey!, draft.newIssueSummary!);
        if (!key) {
          setMessage(`新票卡建立失敗；尚未送出工時，已完成建立的票卡已保留在草稿中。`);
          return;
        }
        const resolved = { ...draft, issueKey: key, newIssueSummary: undefined, createNewIssue: false, project: key };
        resolvedDrafts.push(resolved);
        setDrafts((current) => current.map((item) => item.id === draft.id ? resolved : item));
      }
      const response = await fetch(`${API_BASE_URL}/jira/worklogs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: resolvedDrafts.map((draft) => ({
          clientId: draft.id,
          issueKey: draft.issueKey,
          started: draft.started,
          timeSpentSeconds: Math.round(draft.hours * 3600),
          comment: draft.summary,
        })) }),
      });
      const data = await response.json() as { results?: Array<{ clientId?: number; issueKey: string; ok: boolean; message?: string }> };
      const results = data.results ?? [];
      const succeeded = results.filter((result) => result.ok);
      const failed = results.filter((result) => !result.ok);
      if (succeeded.length) {
        const successfulIds = new Set(succeeded.map((result) => result.clientId));
        setDrafts((current) => current.filter((draft) => !successfulIds.has(draft.id)));
      }
      setMessage(failed.length
        ? `成功寫入 ${succeeded.length} 筆；${failed.length} 筆失敗：${failed[0]?.message ?? '請檢查 Jira 權限與票卡狀態。'}`
        : response.ok ? `已成功寫入 ${succeeded.length} 筆 Jira 工時。` : 'Jira 未接受工時，草稿已保留。');
      if (!failed.length && response.ok) setShowConfirm(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '送出 Jira 工時失敗，草稿已保留。');
    } finally { setJiraSubmitting(false); }
  };

  const disconnectCalendar = async () => {
    const response = await fetch(`${API_BASE_URL}/calendar/connection`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) {
      setCalendarConnected(false);
      setCalendarEvents([]);
      setSelectedEvents([]);
      setCalendarMessage('已解除 Google Calendar 連接。');
    } else {
      setCalendarMessage('解除 Google Calendar 連接失敗。');
    }
  };

  const highConfidence = calendarEvents.filter((e) => e.confidence === 'high');
  const uncertain = calendarEvents.filter((e) => e.confidence === 'uncertain');
  const skipped = calendarEvents.filter((e) => e.confidence === 'skip');

  const toggleEvent = (id: string) => {
    setSelectedEvents((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleUncertainDecision = (id: string, decision: 'work' | 'skip') => {
    setUncertainDecisions((prev) => ({ ...prev, [id]: decision }));
    if (decision === 'work') {
      setSelectedEvents((current) => current.includes(id) ? current : [...current, id]);
    } else {
      setSelectedEvents((current) => current.filter((item) => item !== id));
    }
  };

  const addCalendarSuggestions = async () => {
    const additions = calendarEvents
      .filter((event) => selectedEvents.includes(event.id))
      .filter((event) => !drafts.some((draft) => draft.source === 'Calendar' && draft.summary === event.title))
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
        if (!match) return draft;
        return { ...draft, projectKey: match.projectKey || undefined, issueKey: match.issueKey ?? undefined, newIssueSummary: match.newIssueSummary ?? undefined, project: match.issueKey ?? '待選票卡' };
      }));
      setMessage(result.status === 'ready' ? 'AI 已完成配對建議，請確認專案與票卡；待新增票卡會在按「確認送出」時建立。' : '已加入草稿，但 AI 尚未設定，請手動選專案與票卡。');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'AI 比對失敗，請手動選擇專案與票卡。'); }
    finally { setJiraMatching(false); }
  };

  const updateHours = (id: number, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0) return;
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, hours } : draft));
  };

  return (
    <div className="worklog-page">
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
        <div className="summary-day"><span className="summary-label">所選日期已排入</span><strong>{totalHours}<small>小時</small></strong></div>
        <div className="summary-callout"><Clock3 size={16} /><span>建議工作時數 8 小時</span><strong>還差 {Math.max(8 - totalHours, 0)} 小時</strong></div>
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

          {highConfidence.length > 0 && (
            <div className="calendar-group">
              <div className="calendar-group-header"><Check size={13} className="confidence-high-icon" /><span className="confidence-label confidence-high">AI 判定為工作・已勾選待確認</span></div>
              <div className="calendar-suggestion-list">
                {highConfidence.map((event) => (
                  <label className={`calendar-suggestion${event.project ? ' has-project' : ' no-project'}`} key={event.id}>
                    <input type="checkbox" checked={selectedEvents.includes(event.id)} onChange={() => toggleEvent(event.id)} />
                    <span className="suggestion-check"><Check size={12} /></span>
                    <span className="suggestion-time">{event.time}</span>
                    <span className="suggestion-title" title={event.title}>{event.title}</span>
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
                      <span className="suggestion-title" title={event.reason}>{event.title}</span>
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
                            setSelectedEvents((current) => current.filter((item) => item !== event.id));
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

          {calendarEvents.length > 0 && <div className="calendar-actions">
            <span>{aiStatus === 'ready' ? 'AI 分類僅供參考，送出前請確認。' : aiStatus === 'error' ? 'AI 呼叫失敗，行程保留待手動分類。' : '尚未設定 AI，行程不會自動判定工作或私人。'}</span>
            <button className="small-text-button" type="button" onClick={addCalendarSuggestions}><Plus size={14} />加入草稿</button>
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
              <select aria-label="選擇 Jira 網站" value={selectedCloudId} onChange={(event) => void selectJiraSite(event.target.value)} disabled={jiraBusy || jiraSites.length === 0}>
                <option value="">選擇 Jira 網站</option>
                {jiraSites.map((site) => <option value={site.id} key={site.id}>{site.name}（{site.url.replace(/^https?:\/\//, '')}）</option>)}
              </select>
              <button className="small-text-button jira-disconnect-button" type="button" onClick={() => void disconnectJira()}>解除連線</button>
            </>}
          </div>
          {selectedDrafts.length ? <div className="draft-table-wrap">
            <table className="draft-table">
              <thead><tr><th>專案</th><th>票卡</th><th>內容</th><th>時數</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{selectedDrafts.map((draft) => (
                <tr key={draft.id}>
                  <td>{jiraConnected && selectedCloudId ? <select className="jira-row-project-select" aria-label={`${draft.summary} 的 Jira 專案`} value={draft.projectKey ?? ''} onChange={(event) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, projectKey: event.target.value || undefined, issueKey: undefined, newIssueSummary: undefined, createNewIssue: false, project: '待選票卡' } : item))} disabled={jiraBusy || jiraSubmitting || jiraProjects.length === 0}>
                    <option value="">{jiraMatching ? 'AI 配對中…' : '選擇專案'}</option>
                    {jiraProjects.map((project) => <option value={project.key} key={project.id}>{project.key}・{project.name}</option>)}
                  </select> : draft.projectKey ?? '待配對'}</td>
                  <td>{jiraConnected && selectedCloudId ? <>
                    <select className="jira-issue-select" aria-label={`${draft.summary} 的 Jira 票卡`} value={draft.issueKey ?? (draft.createNewIssue ? '__create_new__' : '')} onChange={(event) => {
                      if (event.target.value === '__create_new__') setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, issueKey: undefined, newIssueSummary: item.newIssueSummary || draft.summary, createNewIssue: true, project: '待建立票卡' } : item));
                      else chooseIssue(draft.id, event.target.value);
                    }} disabled={jiraMatching || jiraSubmitting || !draft.projectKey}>
                      <option value="">{!draft.projectKey ? '先選擇專案' : jiraMatching ? 'AI 配對中…' : jiraIssues[draft.id]?.length ? '選擇票卡' : '沒有符合的票卡'}</option>
                      {draft.issueKey && !(jiraIssues[draft.id] ?? []).some((issue) => issue.key === draft.issueKey) && <option value={draft.issueKey}>{draft.issueKey}</option>}
                      {(jiraIssues[draft.id] ?? []).map((issue) => <option value={issue.key} key={issue.id}>{issue.key}・{issue.summary}</option>)}
                      {draft.projectKey && <option value="__create_new__">＋ 新增「{draft.newIssueSummary || draft.summary}」</option>}
                    </select>
                  </> : <><span className="project-dot project-dot-pending" />待選票卡</>}</td>
                  <td>{draft.summary}</td>
                  <td>{editingId === draft.id ? <input className="hours-input" type="number" min="0.25" step="0.25" value={draft.hours} onChange={(event) => updateHours(draft.id, Number(event.target.value))} onBlur={() => setEditingId(null)} aria-label="編輯工時" autoFocus /> : `${draft.hours}h`}</td>
                  <td className="draft-actions"><button type="button" aria-label={`編輯 ${draft.summary}`} onClick={() => setEditingId(draft.id)}><Edit3 size={14} /></button><button type="button" aria-label={`移除 ${draft.summary}`} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}><Trash2 size={14} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div> : <div className="empty-drafts"><FileClock size={20} /><span>草稿是空的，加入日曆建議或手動補登。</span></div>}

          <div className="manual-worklog-form">
            <div className="manual-worklog-heading"><Sparkles size={14} /><strong>手動補登</strong><span>新增 Calendar 沒有的工時</span></div>
            <div className="manual-worklog-fields">
              <select aria-label="手動補登專案" value={selectedProjectKey} onChange={(event) => { setSelectedProjectKey(event.target.value); setManualIssueKey(''); }} disabled={!jiraConnected || !selectedCloudId || jiraBusy}>
                <option value="">選擇專案</option>
                {jiraProjects.map((project) => <option value={project.key} key={project.id}>{project.key}・{project.name}</option>)}
              </select>
              <select aria-label="手動補登票卡" value={manualIssueKey || (manualNewIssueSummary ? '__create_new__' : '')} onChange={(event) => {
                if (event.target.value === '__create_new__' && selectedProjectKey && manualSummary.trim()) {
                  setManualIssueKey(''); setManualNewIssueSummary(manualSummary.trim());
                } else { setManualIssueKey(event.target.value); setManualNewIssueSummary(''); }
              }} disabled={!selectedProjectKey || !jiraConnected || jiraBusy}>
                <option value="">{!selectedProjectKey ? '先選擇專案' : manualIssueOptions.length ? '選擇票卡' : '輸入內容以搜尋票卡'}</option>
                {manualIssueOptions.map((issue) => <option value={issue.key} key={issue.id}>{issue.key}・{issue.summary}</option>)}
                {manualSummary.trim() && selectedProjectKey && <option value="__create_new__">＋ 待新增「{manualNewIssueSummary || manualSummary.trim()}」</option>}
              </select>
              <input aria-label="手動補登內容" value={manualSummary} onChange={(event) => { setManualSummary(event.target.value); setManualIssueKey(''); setManualNewIssueSummary(''); }} placeholder="工時內容" />
              <label className="manual-hours-field"><input aria-label="手動補登時數" type="number" min="0.25" max="24" step="0.25" value={manualHours} onChange={(event) => setManualHours(event.target.value)} /><span>小時</span></label>
              <button className="button button-primary manual-add-button" type="button" onClick={addManualDraft} disabled={jiraSubmitting || !manualSummary.trim() || (!manualIssueKey && !manualNewIssueSummary)}>加入草稿</button>
            </div>
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
                  const wl = worklogsForDate(d.dateKey, drafts);
                  const hrs = wl.reduce((sum, worklog) => sum + worklog.hours, 0);
                  const isSelected = d.dateKey === selectedDate;
                  const needsFill = !isWeekend && !isToday && hrs === 0;
                  return (
                    <button
                      className={`week-cell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${isWeekend ? ' is-off' : ''}${needsFill ? ' needs-fill' : ''}`}
                      type="button"
                      key={d.dateKey}
                      onClick={() => setSelectedDate(d.dateKey)}
                    >
                      <span className="week-cell-label">{d.label}</span>
                      <span className="week-cell-date">{d.date}</span>
                      <div className="week-cell-bar-area"><span className="week-cell-bar" style={{ height: `${Math.max(hrs / 8 * 100, 4)}%` }} /></div>
                      <span className="week-cell-hours">{hrs > 0 ? `${hrs}h` : isWeekend ? '休' : '—'}</span>
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
                const wl = worklogsForDate(sel.dateKey, drafts);
                const hrs = wl.reduce((sum, worklog) => sum + worklog.hours, 0);
                return (
                  <div className="selected-day-panel">
                    <div className="selected-day-header">
                      <strong>{sel.fullDate}（{sel.label}）</strong>
                      {isWeekend && <span className="day-off-tag">休息日</span>}
                      {!isWeekend && <span className="day-hours-tag">{hrs} / 8h</span>}
                    </div>
                    {wl.length > 0 ? (
                      <div className="day-detail-list">
                        {wl.map((w, i) => (
                          <div className="day-detail-row" key={i}>
                            <span className="day-detail-project"><span className="project-dot" />{w.project}</span>
                            <span className="day-detail-summary">{w.summary}</span>
                            <span className="day-detail-hours">{w.hours}h</span>
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
              <span className="week-total-label">{monthDays.reduce((sum, item) => sum + item.totalHours, 0)}h</span>
            </div>
            <div className="month-calendar">
              {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="month-weekday" key={day}>{day}</span>)}
              {monthDays.map((item, index) => {
                const isSelected = item.dateKey === selectedDate && !item.muted;
                const needsFill = !item.muted && item.isWorkday && !item.today && item.hours === '—' && item.dateKey < todayDateKey;
                return (
                  <button
                    className={`month-day${item.today ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${item.muted ? ' is-muted' : ''}${(item.isWeekend || item.isHoliday) && !item.muted ? ' is-off' : ''}${needsFill ? ' needs-fill' : ''}${item.hours === '—' ? ' no-hours' : ''}`}
                    type="button"
                    key={`${item.date}-${index}`}
                    disabled={item.muted}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedDate(item.dateKey)}
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
                    {(!isOff || sel.totalHours > 0) && <span className="day-hours-tag">{sel.totalHours} / 8h</span>}
                  </div>
                  {worklogs.length > 0 ? (
                    <div className="day-detail-list">
                      {worklogs.map((w, i) => (
                        <div className="day-detail-row" key={i}>
                          <span className="day-detail-project"><span className="project-dot" />{w.project}</span>
                          <span className="day-detail-summary">{w.summary}</span>
                          <span className="day-detail-hours">{w.hours}h</span>
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
            <span className="sticky-total">{drafts.length} 筆・<strong>{totalHours}h</strong></span>
            <button className="button button-primary" type="button" disabled={!drafts.length} onClick={() => setShowConfirm(true)}>確認送出 <ArrowRight size={16} /></button>
          </div>
        </div>
      </div>

      {message && <div className="toast-message" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="關閉">×</button></div>}
      {showConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowConfirm(false); }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span className="modal-icon"><AlertTriangle size={21} /></span><h2 id="confirm-title">{!jiraConnected ? '請先連接 Jira' : !selectedCloudId ? '請選擇 Jira 網站' : hasUnresolvedIssue ? '還有票卡待選' : '確認寫入 Jira 工時'}</h2><p>{!jiraConnected ? '連接 Jira 後才能送出工時。' : !selectedCloudId ? '選擇要寫入的 Jira 測試或正式網站。' : hasUnresolvedIssue ? '請先為每筆草稿選擇專案與既有票卡，或選擇待新增票卡。' : drafts.some((draft) => draft.createNewIssue) ? '確認後才會建立你選取的新票卡，並寫入這些草稿的工時。' : '確認後，以下草稿會以目前選取的 Jira 網站與票卡建立工時紀錄。'}</p><div className="modal-summary"><span>目前草稿</span><strong>{drafts.length} 筆・{totalHours} 小時</strong></div><div className="modal-actions"><button className="button button-secondary modal-close" type="button" onClick={() => setShowConfirm(false)}>返回檢查</button>{jiraConnected && selectedCloudId && !hasUnresolvedIssue && <button className="button button-primary modal-close" type="button" onClick={() => void submitWorklogs()} disabled={jiraSubmitting}>{jiraSubmitting ? '正在寫入…' : '確認寫入 Jira'}</button>}</div></section></div>}
      <div className="preview-footnote">草稿送出前須選擇 Jira 票卡，並經你確認後才會寫入 Jira。</div>
    </div>
  );
}

export default Worklogs;
