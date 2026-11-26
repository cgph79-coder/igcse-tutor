/**
 * Session logs for parent review. Stored as JSON in KV, one key per study session,
 * and automatically deleted LOG_RETENTION_DAYS (default 90) after the last message.
 * Only the privacy-filtered text is stored — the same text the LLM saw.
 */

export interface LogMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  redactions?: string[];
}

export interface SessionLog {
  id: string;
  userId: string;
  startedAt: string;
  updatedAt: string;
  subject: string;
  code: string;
  topic: string;
  tier: string | null;
  mode: string;
  flags: string[];
  messages: LogMessage[];
}

export interface LogMeta {
  updatedAt: string;
  subject: string;
  topic: string;
  mode: string;
  flagged: boolean;
  count: number;
}

export const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

export function logKey(userId: string, sessionId: string) {
  return `log:${userId}:${sessionId}`;
}

export async function appendToLog(
  kv: KVNamespace,
  base: Omit<SessionLog, "startedAt" | "updatedAt" | "flags" | "messages">,
  newMessages: LogMessage[],
  newFlags: string[],
  retentionDays: number,
  now = new Date(),
): Promise<SessionLog> {
  const key = logKey(base.userId, base.id);
  const existing = await kv.get<SessionLog>(key, "json");
  const at = now.toISOString();
  const log: SessionLog = existing ?? { ...base, startedAt: at, updatedAt: at, flags: [], messages: [] };
  // A session can change mode/topic part-way; keep the latest.
  Object.assign(log, { subject: base.subject, code: base.code, topic: base.topic, tier: base.tier, mode: base.mode });
  log.updatedAt = at;
  log.messages.push(...newMessages);
  log.flags = [...new Set([...log.flags, ...newFlags])];
  const meta: LogMeta = {
    updatedAt: at,
    subject: log.subject,
    topic: log.topic,
    mode: log.mode,
    flagged: log.flags.length > 0,
    count: log.messages.length,
  };
  await kv.put(key, JSON.stringify(log), { expirationTtl: retentionDays * 86400, metadata: meta });
  return log;
}

export async function listLogs(kv: KVNamespace): Promise<Array<{ key: string } & Partial<LogMeta>>> {
  const out: Array<{ key: string } & Partial<LogMeta>> = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list<LogMeta>({ prefix: "log:", cursor });
    for (const k of page.keys) out.push({ key: k.name, ...(k.metadata ?? {}) });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < 5000);
  out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return out;
}
