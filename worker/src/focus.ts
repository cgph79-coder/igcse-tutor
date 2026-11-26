/**
 * Study-timer totals for the parent view. The app sends each finished focus block (when it
 * ended, how long, which subject) and the Worker keeps one small record per UK day.
 * No message content, topic text or anything he typed is involved.
 */
import { findSyllabus } from "../../syllabus/index";
import { ukDay } from "./ratelimit";

export interface FocusBlock {
  at: string;
  minutes: number;
  code: string;
}

interface StoredDay {
  minutes: number;
  blocks: number;
  /** Minutes per syllabus code. */
  byCode: Record<string, number>;
  /** End times already counted, so a block sent twice (retries, two tabs) only counts once. */
  ats: string[];
}

export interface FocusDay {
  day: string;
  minutes: number;
  blocks: number;
  /** Minutes per subject name. */
  subjects: Record<string, number>;
}

const MAX_BLOCKS_PER_REQUEST = 20;
const MAX_AGE_MS = 7 * 86400000; // the app's outbox resends within a week

const key = (userId: string, day: string) => `focus:${userId}:${day}`;

/** Validate what the app sent; anything odd is dropped rather than rejected. */
export function cleanBlocks(raw: unknown, now = new Date()): FocusBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: FocusBlock[] = [];
  for (const b of raw.slice(0, MAX_BLOCKS_PER_REQUEST)) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const at = typeof r.at === "string" ? new Date(r.at) : null;
    const minutes = Number(r.minutes);
    const code = String(r.code ?? "");
    if (!at || Number.isNaN(at.getTime())) continue;
    const age = now.getTime() - at.getTime();
    if (age < -5 * 60000 || age > MAX_AGE_MS) continue; // not in the future, not too old
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 90) continue;
    if (!findSyllabus(code)) continue;
    out.push({ at: at.toISOString(), minutes, code });
  }
  return out;
}

export async function recordFocusBlocks(
  kv: KVNamespace,
  userId: string,
  blocks: FocusBlock[],
  retentionDays: number,
): Promise<number> {
  const byDay = new Map<string, FocusBlock[]>();
  for (const b of blocks) {
    const day = ukDay(new Date(b.at));
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  let saved = 0;
  for (const [day, list] of byDay) {
    const k = key(userId, day);
    const rec: StoredDay = (await kv.get<StoredDay>(k, "json")) ?? { minutes: 0, blocks: 0, byCode: {}, ats: [] };
    let changed = false;
    for (const b of list) {
      if (rec.ats.includes(b.at)) continue;
      rec.ats.push(b.at);
      rec.minutes += b.minutes;
      rec.blocks += 1;
      rec.byCode[b.code] = (rec.byCode[b.code] ?? 0) + b.minutes;
      saved += 1;
      changed = true;
    }
    if (changed) await kv.put(k, JSON.stringify(rec), { expirationTtl: retentionDays * 86400 });
  }
  return saved;
}

/** The last `days` UK days, newest first, including days with no focus time. */
export async function getFocusDays(kv: KVNamespace, userId: string, days: number, now = new Date()): Promise<FocusDay[]> {
  const dayKeys = Array.from({ length: days }, (_, i) => ukDay(new Date(now.getTime() - i * 86400000)));
  const unique = [...new Set(dayKeys)]; // clock changes can repeat a day
  const records = await Promise.all(unique.map((d) => kv.get<StoredDay>(key(userId, d), "json")));
  return unique.map((day, i) => {
    const r = records[i];
    const subjects: Record<string, number> = {};
    for (const [code, mins] of Object.entries(r?.byCode ?? {})) {
      const name = findSyllabus(code)?.subject ?? code;
      subjects[name] = (subjects[name] ?? 0) + mins;
    }
    return { day, minutes: r?.minutes ?? 0, blocks: r?.blocks ?? 0, subjects };
  });
}
