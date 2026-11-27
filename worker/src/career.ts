/**
 * Dispatches career storage. One small JSON record per student: grades, run counts, dates and
 * last scores per topic (see shared/career.ts). Never anything he typed. Copies from the device
 * are merged with the stored one, so progress from either side is never lost.
 */
import { cleanCareer, mergeCareers, type Career } from "../../shared/career";

const key = (userId: string) => `career:${userId}`;
/** Kept well past the exams; refreshed on every save. */
const TTL = 60 * 60 * 24 * 400;
/** A career is a few KB; refuse anything far bigger. */
const MAX_BYTES = 64 * 1024;

export async function getCareer(kv: KVNamespace, userId: string): Promise<Career | null> {
  return cleanCareer(await kv.get<unknown>(key(userId), "json"));
}

/** Merge an incoming copy into the stored one and return the result; null if it isn't a career. */
export async function saveCareer(kv: KVNamespace, userId: string, incoming: unknown): Promise<Career | null> {
  if (JSON.stringify(incoming ?? null).length > MAX_BYTES) return null;
  const clean = cleanCareer(incoming);
  if (!clean) return null;
  const merged = mergeCareers(await getCareer(kv, userId), clean);
  await kv.put(key(userId), JSON.stringify(merged), { expirationTtl: TTL });
  return merged;
}
