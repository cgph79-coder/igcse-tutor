/**
 * Sends finished study-timer blocks to the Worker so the parent view can show focus time per day.
 * Only the end time, length and subject code go — no topic text and nothing he typed.
 * Blocks wait in an outbox on the device until they're sent, so being offline loses nothing;
 * the Worker ignores a block it has already counted.
 */
import { WORKER_URL } from "./config";
import { prefs, type FocusRecord } from "./storage";

const OUTBOX = "focus:outbox";
const MAX_AGE_MS = 7 * 86400000; // the Worker only accepts blocks from the last week

interface Pending {
  at: string;
  minutes: number;
  code: string;
}

function read(): Pending[] {
  try {
    const list = JSON.parse(prefs.get(OUTBOX) ?? "[]");
    const cutoff = Date.now() - MAX_AGE_MS;
    return Array.isArray(list) ? list.filter((p) => typeof p?.at === "string" && Date.parse(p.at) > cutoff) : [];
  } catch {
    return [];
  }
}

function write(list: Pending[]) {
  prefs.set(OUTBOX, list.length ? JSON.stringify(list) : null);
}

export function queueFocus(r: FocusRecord) {
  const list = read();
  if (!list.some((p) => p.at === r.at)) list.push({ at: r.at, minutes: r.minutes, code: r.code });
  write(list.slice(-50));
}

let sending = false;

export async function flushFocus(token: string | null) {
  if (!token || sending) return;
  const list = read();
  if (!list.length) return write([]);
  sending = true;
  try {
    const batch = list.slice(0, 20);
    const res = await fetch(WORKER_URL + "/api/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ blocks: batch }),
    });
    if (res.ok || res.status === 400) {
      // Sent (or unusable): drop these and carry on with any others.
      const sent = new Set(batch.map((p) => p.at));
      write(read().filter((p) => !sent.has(p.at)));
      if (read().length) setTimeout(() => void flushFocus(token), 0);
    }
    // 401 or a network error: keep them for next time.
  } catch {
    /* offline — try again later */
  } finally {
    sending = false;
  }
}

/** Retry whenever the app comes back online or to the front. */
export function startFocusSync(getToken: () => string | null) {
  const go = () => void flushFocus(getToken());
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", () => !document.hidden && go());
  go();
}
