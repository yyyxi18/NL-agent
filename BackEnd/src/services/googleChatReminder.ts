import { OAuth2Client } from 'google-auth-library';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import { env } from '../config/env';
import { oauthClient } from '../routes/auth';
import { classifyCalendarEvents } from './eventClassifier';
import { getCalendarRefreshToken, listCalendarReminderUsers, markCalendarReminderSent, setCalendarChatSpace } from './calendarTokenStore';

const CHAT_BOT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';
const chatIssuer = 'chat@system.gserviceaccount.com';
const idTokenVerifier = new OAuth2Client();

function getChatServiceAccount(): Record<string, unknown> {
  const json = env.googleChatServiceAccountJson || (env.googleChatServiceAccountJsonBase64
    ? Buffer.from(env.googleChatServiceAccountJsonBase64, 'base64').toString('utf8')
    : '');
  if (!json) throw new Error('Google Chat service account is not configured');
  const credentials = JSON.parse(json) as Record<string, unknown>;
  if (typeof credentials.client_email !== 'string' || typeof credentials.private_key !== 'string') {
    throw new Error('Google Chat service account JSON is invalid');
  }
  return credentials;
}

export async function verifyGoogleChatRequest(authorization: string | undefined): Promise<boolean> {
  if (!env.googleChatAppAudience || !authorization?.startsWith('Bearer ')) return false;
  try {
    const ticket = await idTokenVerifier.verifyIdToken({ idToken: authorization.slice('Bearer '.length), audience: env.googleChatAppAudience });
    const payload = ticket.getPayload();
    return payload?.email_verified === true && payload.email === chatIssuer;
  } catch { return false; }
}

export async function linkChatDirectMessage(email: string, spaceName: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();
  const user = (await listCalendarReminderUsers()).find((entry) => entry.email === normalizedEmail);
  if (!user) return false;
  await setCalendarChatSpace(user.userId, normalizedEmail, spaceName);
  return true;
}

function dateKeyInTaipei(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function formatEventTime(start: string | null, end: string | null, allDay: boolean): string {
  if (allDay || !start || !end) return '全天';
  const formatter = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

function eventHours(start: string | null, end: string | null, allDay: boolean): number {
  if (allDay || !start || !end) return 8;
  return Math.max(0.25, Math.round((Date.parse(end) - Date.parse(start)) / 900_000) / 4);
}

async function buildReminder(userId: string, date: string): Promise<string> {
  const refreshToken = await getCalendarRefreshToken(userId);
  if (!refreshToken) throw new Error('Google Calendar connection is missing');
  const client = oauthClient(env.googleCalendarRedirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  const start = new Date(`${date}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const calendar = google.calendar({ version: 'v3', auth: client });
  const response = await calendar.events.list({
    calendarId: 'primary', timeMin: start.toISOString(), timeMax: end.toISOString(),
    singleEvents: true, orderBy: 'startTime', maxResults: 250,
  });
  const events = (response.data.items ?? []).filter((event) => event.status !== 'cancelled').map((event) => ({
    id: event.id ?? '', summary: event.summary || '（無標題行程）',
    start: event.start?.dateTime ?? event.start?.date ?? null,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
  }));
  const classification = await classifyCalendarEvents(events);
  const workEvents = classification.events.filter((event) => event.classification === 'work');
  const uncertainCount = classification.events.filter((event) => event.classification === 'uncertain').length;
  const totalHours = workEvents.reduce((sum, event) => sum + eventHours(event.start, event.end, Boolean(events.find((item) => item.id === event.id)?.allDay)), 0);
  const details = workEvents.map((event) => {
    const allDay = Boolean(events.find((item) => item.id === event.id)?.allDay);
    const hours = eventHours(event.start, event.end, allDay);
    const title = event.summary.replace(/[\r\n]+/g, ' ').slice(0, 160);
    return `• ${formatEventTime(event.start, event.end, allDay)} ${title}（${hours} 小時）`;
  });
  const displayDate = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' }).format(start);
  const link = `${env.frontendUrl.replace(/\/$/, '')}/#/worklogs?date=${date}`;
  return [
    `NL-agent 每日工時提醒｜${displayDate}`,
    `已判定工作行程：${workEvents.length} 筆，預估 ${totalHours} 小時。`,
    ...(details.length ? details : ['今天沒有判定為工作的行程。']),
    ...(uncertainCount ? [`另有 ${uncertainCount} 筆行程待你在系統確認；提醒不會列出私人或待確認行程名稱。`] : []),
    '請檢查草稿是否完整；工時只會在你於系統確認送出後寫入 Jira。',
    `查看今日工時與缺漏：${link}`,
  ].join('\n');
}

export async function sendDailyCalendarReminders(now = new Date()): Promise<void> {
  if (!env.googleChatServiceAccountJson && !env.googleChatServiceAccountJsonBase64) throw new Error('Google Chat service account is not configured');
  const date = dateKeyInTaipei(now);
  const auth = new GoogleAuth({ credentials: getChatServiceAccount(), scopes: [CHAT_BOT_SCOPE] });
  const chat = google.chat({ version: 'v1', auth });
  const users = await listCalendarReminderUsers();
  for (const user of users) {
    if (!user.email || !user.chatSpaceName || user.lastReminderDate === date) continue;
    try {
      const text = await buildReminder(user.userId, date);
      await chat.spaces.messages.create({ parent: user.chatSpaceName, requestBody: { text } });
      await markCalendarReminderSent(user.userId, date);
      console.info(JSON.stringify({ level: 'info', event: 'daily_calendar_reminder_sent', date }));
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'daily_calendar_reminder_failed', date, errorName: error instanceof Error ? error.name : 'UnknownError' }));
    }
  }
}
