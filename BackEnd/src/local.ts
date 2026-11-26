import { app } from './app';
import { env } from './config/env';
import { sendDailyCalendarReminders } from './services/googleChatReminder';

app.listen(env.port, () => {
  console.info(`NL-agent API listening on port ${env.port}`);
  if (env.dailyReminderEnabled) {
    let running = false;
    const tick = async () => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      const time = `${parts.find((part) => part.type === 'hour')?.value}:${parts.find((part) => part.type === 'minute')?.value}`;
      if (time !== '16:30' || running) return;
      running = true;
      try { await sendDailyCalendarReminders(); }
      catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'daily_calendar_reminder_run_failed', errorName: error instanceof Error ? error.name : 'UnknownError' }));
      } finally { running = false; }
    };
    const timer = setInterval(() => void tick(), 15_000);
    timer.unref();
    console.info('Daily Google Chat reminders enabled for 16:30 Asia/Taipei');
  }
});
