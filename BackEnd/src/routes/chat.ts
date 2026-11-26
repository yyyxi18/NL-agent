import { Router } from 'express';
import { env } from '../config/env';
import { getAuthSession } from './auth';
import { linkChatDirectMessage, verifyGoogleChatRequest } from '../services/googleChatReminder';
import { listCalendarReminderUsers } from '../services/calendarTokenStore';

export const chatRouter = Router();

chatRouter.post('/events', async (req, res) => {
  if (!await verifyGoogleChatRequest(req.get('authorization'))) {
    res.status(401).json({ code: 'INVALID_CHAT_REQUEST', message: 'Request must come from Google Chat' });
    return;
  }
  const event = req.body as {
    type?: string;
    user?: { email?: string };
    space?: { name?: string; type?: string; singleUserBotDm?: boolean };
  };
  const isDirectMessage = event.space?.singleUserBotDm === true || event.space?.type === 'DIRECT_MESSAGE';
  if (!isDirectMessage || !event.space?.name) {
    res.json({ text: '請以私訊方式開啟 NL-agent Chat App，系統才能將每日工時提醒送給你本人。' });
    return;
  }
  const email = event.user?.email?.toLowerCase();
  if (!email) {
    res.json({ text: '無法取得你的公司 Email。請確認以公司 Google Chat 帳號開啟 App，或請管理員檢查 Chat App 的使用者資訊設定。' });
    return;
  }
  try {
    const linked = await linkChatDirectMessage(email, event.space.name);
    if (!linked) {
      res.json({ text: '尚未找到你的 Google Calendar 連線。請先以相同公司 Google 帳號登入 NL-agent 並連接 Google Calendar，再回到此私訊重新傳送訊息。' });
      return;
    }
    res.json({ text: `已連結 NL-agent 每日工時提醒。每天台灣時間 16:30，我會私訊你當日已判定為工作的行程摘要與 NL-agent 檢查連結。私人與待確認行程名稱不會放進提醒；工時仍需你在 NL-agent 確認後才會送到 Jira。` });
  } catch {
    res.status(500).json({ text: '連結提醒時發生錯誤，請稍後再試。' });
  }
});

chatRouter.get('/status', async (req, res) => {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign-in required' });
    return;
  }
  if (!env.dailyReminderEnabled) {
    res.json({ enabled: false, connected: false, timeZone: 'Asia/Taipei', time: '16:30' });
    return;
  }
  const users = await listCalendarReminderUsers();
  const user = users.find((entry) => entry.userId === session.sub);
  res.json({ enabled: true, connected: Boolean(user?.chatSpaceName), timeZone: 'Asia/Taipei', time: '16:30' });
});
