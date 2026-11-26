/**
 * Progress tracking. The app only talks to the ProgressStore interface, so the
 * localStorage implementation can later be swapped for a database-backed one.
 */

export interface ScoreRecord {
  at: string;
  mode: string;
  got: number;
  max: number;
}

export interface TopicProgress {
  code: string;
  topicId: string;
  topicTitle: string;
  subject: string;
  sessions: number;
  lastStudied: string;
  scores: ScoreRecord[];
}

/** One completed Pomodoro focus block. */
export interface FocusRecord {
  at: string;
  minutes: number;
  code: string;
  subject: string;
  topicId: string;
  topicTitle: string;
}

export interface ProgressStore {
  recordStudy(p: { code: string; topicId: string; topicTitle: string; subject: string }): Promise<void>;
  recordScore(p: { code: string; topicId: string; topicTitle: string; subject: string; mode: string; got: number; max: number }): Promise<void>;
  all(): Promise<TopicProgress[]>;
  weakest(limit?: number): Promise<Array<TopicProgress & { average: number }>>;
  recordFocus(r: FocusRecord): Promise<void>;
  /** Focus blocks, oldest first (the last ~120 days). */
  focusLog(): Promise<FocusRecord[]>;
  clear(): Promise<void>;
}

const KEY = "igcse-tutor:progress:v1";
const FOCUS_KEY = "igcse-tutor:focus:v1";
const FOCUS_KEEP_DAYS = 120;

export class LocalProgressStore implements ProgressStore {
  private read(): Record<string, TopicProgress> {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      return {};
    }
  }

  private write(data: Record<string, TopicProgress>) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage full or blocked — progress just isn't saved */
    }
  }

  private upsert(data: Record<string, TopicProgress>, p: { code: string; topicId: string; topicTitle: string; subject: string }) {
    const k = `${p.code}:${p.topicId}`;
    data[k] ??= { ...p, sessions: 0, lastStudied: new Date().toISOString(), scores: [] };
    data[k].topicTitle = p.topicTitle;
    return data[k];
  }

  async recordStudy(p: { code: string; topicId: string; topicTitle: string; subject: string }) {
    const data = this.read();
    const t = this.upsert(data, p);
    t.sessions += 1;
    t.lastStudied = new Date().toISOString();
    this.write(data);
  }

  async recordScore(p: { code: string; topicId: string; topicTitle: string; subject: string; mode: string; got: number; max: number }) {
    const data = this.read();
    const t = this.upsert(data, p);
    t.scores.push({ at: new Date().toISOString(), mode: p.mode, got: p.got, max: p.max });
    t.scores = t.scores.slice(-50);
    t.lastStudied = new Date().toISOString();
    this.write(data);
  }

  async all() {
    return Object.values(this.read()).sort((a, b) => b.lastStudied.localeCompare(a.lastStudied));
  }

  async weakest(limit = 5) {
    return (await this.all())
      .filter((t) => t.scores.length > 0)
      .map((t) => {
        const recent = t.scores.slice(-5); // recent attempts matter most
        const got = recent.reduce((s, r) => s + r.got, 0);
        const max = recent.reduce((s, r) => s + r.max, 0);
        return { ...t, average: max ? got / max : 0 };
      })
      .sort((a, b) => a.average - b.average)
      .slice(0, limit);
  }

  async recordFocus(r: FocusRecord) {
    const cutoff = new Date(Date.now() - FOCUS_KEEP_DAYS * 86400000).toISOString();
    const log = (await this.focusLog()).filter((x) => x.at >= cutoff);
    if (log.some((x) => x.at === r.at)) return; // already recorded (e.g. by another open tab)
    log.push(r);
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify(log));
    } catch {
      /* storage full or blocked */
    }
  }

  async focusLog(): Promise<FocusRecord[]> {
    try {
      const log = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? "[]");
      return Array.isArray(log) ? log.filter((x) => typeof x?.at === "string" && typeof x?.minutes === "number") : [];
    } catch {
      return [];
    }
  }

  async clear() {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(FOCUS_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Small helpers for per-device preferences (theme, last subject…). */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`igcse-tutor:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(`igcse-tutor:${key}`);
      else localStorage.setItem(`igcse-tutor:${key}`, value);
    } catch {
      /* ignore */
    }
  },
};
