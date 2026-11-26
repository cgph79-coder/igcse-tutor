/**
 * In-app feedback: a short note from the student about the app ("too fast", "this card is
 * wrong"), shown in the parent view so it can go into the feedback log in docs/ROADMAP.md.
 * Text goes through the same privacy filter as chat; context is app details only, never the
 * conversation.
 */
import { findSyllabus } from "../../syllabus/index";
import { stripPii } from "./pii";
import { assessSafety, type SafetyLevel } from "./safety";
import { ukDay } from "./ratelimit";

export const FEEDBACK_AREAS = ["tutor", "arcade", "timer", "other"] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

export const MAX_FEEDBACK_CHARS = 500;
export const DAILY_FEEDBACK_LIMIT = 20;

export interface FeedbackContext {
  build?: string;
  view?: string;
  code?: string;
  subject?: string;
  topic?: string;
  game?: string;
}

export interface FeedbackItem {
  id: string;
  at: string;
  area: FeedbackArea;
  text: string;
  context?: FeedbackContext;
  redactions?: string[];
  /** Wellbeing or safeguarding words were spotted — the parent should read it. */
  flag?: SafetyLevel;
}

const short = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined;

/** Only known, short fields survive; anything else is dropped. */
export function cleanContext(raw: unknown): FeedbackContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const code = short(r.code, 8);
  const ctx: FeedbackContext = {
    build: short(r.build, 20),
    view: short(r.view, 30),
    code: code && findSyllabus(code) ? code : undefined,
    subject: code ? findSyllabus(code)?.subject : undefined,
    topic: short(r.topic, 80),
    game: short(r.game, 40),
  };
  for (const k of Object.keys(ctx) as (keyof FeedbackContext)[]) if (ctx[k] === undefined) delete ctx[k];
  return Object.keys(ctx).length ? ctx : undefined;
}

/** Newest first when listed: keys sort by a reversed timestamp. */
function feedbackKey(now: Date) {
  const reversed = String(9_999_999_999_999 - now.getTime()).padStart(13, "0");
  return `feedback:${reversed}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function saveFeedback(
  kv: KVNamespace,
  userId: string,
  input: { area: unknown; text: unknown; context?: unknown },
  blockedTerms: string[],
  retentionDays: number,
  now = new Date(),
): Promise<{ ok: true; item: FeedbackItem } | { ok: false; status: number; error: string }> {
  const area = FEEDBACK_AREAS.includes(input.area as FeedbackArea) ? (input.area as FeedbackArea) : null;
  const raw = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
  if (!area || raw.length < 3 || raw.length > MAX_FEEDBACK_CHARS) {
    return { ok: false, status: 400, error: "Please write a few words (up to 500 characters)." };
  }

  const countKey = `feedbackcount:${userId}:${ukDay(now)}`;
  const count = Number((await kv.get(countKey)) ?? 0);
  if (count >= DAILY_FEEDBACK_LIMIT) {
    return { ok: false, status: 429, error: "That's plenty of feedback for today. Thank you! Send more tomorrow." };
  }

  const { text, redactions } = stripPii(raw, blockedTerms);
  const safety = assessSafety(raw);
  const key = feedbackKey(now);
  const item: FeedbackItem = {
    id: key.slice("feedback:".length),
    at: now.toISOString(),
    area,
    text,
    ...(cleanContext(input.context) ? { context: cleanContext(input.context) } : {}),
    ...(redactions.length ? { redactions } : {}),
    ...(safety !== "none" ? { flag: safety } : {}),
  };
  await kv.put(key, JSON.stringify(item), { expirationTtl: retentionDays * 86400 });
  await kv.put(countKey, String(count + 1), { expirationTtl: 60 * 60 * 48 });
  return { ok: true, item };
}

export async function listFeedback(kv: KVNamespace, limit = 50): Promise<FeedbackItem[]> {
  const page = await kv.list({ prefix: "feedback:", limit });
  const items = await Promise.all(page.keys.map((k) => kv.get<FeedbackItem>(k.name, "json")));
  return items.filter((x): x is FeedbackItem => x !== null).sort((a, b) => b.at.localeCompare(a.at));
}

export async function deleteFeedback(kv: KVNamespace, id: string): Promise<boolean> {
  if (!/^\d{13}-[0-9a-f]{8}$/.test(id)) return false;
  await kv.delete(`feedback:${id}`);
  return true;
}
