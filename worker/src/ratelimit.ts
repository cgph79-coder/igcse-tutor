/** Daily usage caps per user, stored in KV. Days roll over at midnight UK time. */

export interface Usage {
  requests: number;
  tokens: number;
}

export interface Limits {
  requests: number;
  tokens: number;
}

export function ukDay(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

function key(userId: string, day: string) {
  return `usage:${userId}:${day}`;
}

export async function getUsage(kv: KVNamespace, userId: string, now = new Date()): Promise<Usage> {
  const raw = await kv.get(key(userId, ukDay(now)));
  if (!raw) return { requests: 0, tokens: 0 };
  try {
    const u = JSON.parse(raw) as Usage;
    return { requests: u.requests ?? 0, tokens: u.tokens ?? 0 };
  } catch {
    return { requests: 0, tokens: 0 };
  }
}

export function isOverLimit(usage: Usage, limits: Limits): boolean {
  return usage.requests >= limits.requests || usage.tokens >= limits.tokens;
}

export async function recordUsage(
  kv: KVNamespace,
  userId: string,
  tokens: number,
  now = new Date(),
): Promise<Usage> {
  const current = await getUsage(kv, userId, now);
  const next = { requests: current.requests + 1, tokens: current.tokens + Math.max(0, Math.round(tokens)) };
  // Keep for 2 days so it expires on its own.
  await kv.put(key(userId, ukDay(now)), JSON.stringify(next), { expirationTtl: 60 * 60 * 48 });
  return next;
}

export const LIMIT_MESSAGE =
  "You've reached today's study limit — great effort! 🎉 Take a proper break, and the tutor will be ready again tomorrow. " +
  "If you're in the middle of something important, ask a parent to raise the limit.";

/** Rough token estimate (≈4 characters per token) when the provider doesn't report usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Throttle failed passcode attempts per IP: max `max` failures per hour. */
export async function loginThrottled(kv: KVNamespace, ip: string, max = 10): Promise<boolean> {
  const raw = await kv.get(`loginfail:${ip}`);
  return Number(raw ?? 0) >= max;
}

export async function recordLoginFailure(kv: KVNamespace, ip: string): Promise<void> {
  const k = `loginfail:${ip}`;
  const n = Number((await kv.get(k)) ?? 0) + 1;
  await kv.put(k, String(n), { expirationTtl: 3600 });
}
