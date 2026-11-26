import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

// Local development adapter. Use a durable encrypted store backed by KMS in AWS.
export type JiraSite = { id: string; name: string; url: string; scopes: string[]; avatarUrl?: string };
export type JiraConnection = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  selectedCloudId?: string;
};

const storePath = path.resolve(process.cwd(), '.local-data', 'jira-tokens.json');

function encryptionKey(): Buffer {
  if (env.authCookieSecret.length < 32) throw new Error('AUTH_COOKIE_SECRET must contain at least 32 characters');
  return createHash('sha256').update(`nl-agent-jira-token-store:${env.authCookieSecret}`).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value: string): string {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Jira token store is invalid');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

async function readStore(): Promise<Record<string, JiraConnection>> {
  try {
    return JSON.parse(decrypt(await readFile(storePath, 'utf8'))) as Record<string, JiraConnection>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(store: Record<string, JiraConnection>): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${storePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporaryPath, encrypt(JSON.stringify(store)), { mode: 0o600 });
  await rename(temporaryPath, storePath);
}

export async function getJiraConnection(userId: string): Promise<JiraConnection | null> {
  const store = await readStore();
  return store[userId] ?? null;
}

export async function saveJiraConnection(userId: string, connection: JiraConnection): Promise<void> {
  const store = await readStore();
  store[userId] = connection;
  await writeStore(store);
}

export async function removeJiraConnection(userId: string): Promise<void> {
  const store = await readStore();
  delete store[userId];
  await writeStore(store);
}
