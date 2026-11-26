import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

// Local-development adapter only. Lambda needs a durable encrypted store such as DynamoDB + KMS.
const storePath = path.resolve(process.cwd(), '.local-data', 'calendar-tokens.json');

function encryptionKey(): Buffer {
  if (env.authCookieSecret.length < 32) throw new Error('AUTH_COOKIE_SECRET must contain at least 32 characters');
  return createHash('sha256').update(`nl-agent-calendar-token-store:${env.authCookieSecret}`).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value: string): string {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Calendar token store is invalid');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export type CalendarReminderUser = { userId: string; email?: string; chatSpaceName?: string; lastReminderDate?: string };
type StoredCalendarUser = { refreshToken: string; email?: string; chatSpaceName?: string; lastReminderDate?: string };

async function readStore(): Promise<Record<string, StoredCalendarUser>> {
  try {
    const raw = JSON.parse(decrypt(await readFile(storePath, 'utf8'))) as Record<string, string | StoredCalendarUser>;
    return Object.fromEntries(Object.entries(raw).flatMap(([userId, value]) => {
      if (typeof value === 'string') return [[userId, { refreshToken: value }]];
      if (value && typeof value.refreshToken === 'string') return [[userId, value]];
      return [];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(store: Record<string, StoredCalendarUser>): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${storePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporaryPath, encrypt(JSON.stringify(store)), { mode: 0o600 });
  await rename(temporaryPath, storePath);
}

export async function saveCalendarRefreshToken(userId: string, refreshToken: string, email?: string): Promise<void> {
  const store = await readStore();
  store[userId] = { ...store[userId], refreshToken, ...(email ? { email: email.toLowerCase() } : {}) };
  await writeStore(store);
}

export async function getCalendarRefreshToken(userId: string): Promise<string | null> {
  const store = await readStore();
  return store[userId]?.refreshToken ?? null;
}

export async function listCalendarReminderUsers(): Promise<CalendarReminderUser[]> {
  const store = await readStore();
  return Object.entries(store).map(([userId, value]) => ({ userId, email: value.email, chatSpaceName: value.chatSpaceName, lastReminderDate: value.lastReminderDate }));
}

export async function setCalendarChatSpace(userId: string, email: string, chatSpaceName: string): Promise<void> {
  const store = await readStore();
  const user = store[userId];
  if (!user?.refreshToken) throw new Error('Calendar connection required before linking Chat');
  store[userId] = { ...user, email: email.toLowerCase(), chatSpaceName };
  await writeStore(store);
}

export async function markCalendarReminderSent(userId: string, date: string): Promise<void> {
  const store = await readStore();
  const user = store[userId];
  if (!user) return;
  store[userId] = { ...user, lastReminderDate: date };
  await writeStore(store);
}

export async function removeCalendarRefreshToken(userId: string): Promise<void> {
  const store = await readStore();
  delete store[userId];
  await writeStore(store);
}
