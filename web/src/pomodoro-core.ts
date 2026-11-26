/**
 * Pomodoro timer logic, kept free of the DOM so it can be tested.
 * The state stores when the current block ENDS (not a running counter), so the timer keeps
 * correct time if he switches apps, the phone sleeps, or the page reloads. `reconcile` replays
 * anything that finished while the app wasn't looking.
 */

export interface PomodoroSettings {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  /** Every Nth break is a long one. */
  longEvery: number;
  sound: boolean;
  vibrate: boolean;
}

export const DEFAULT_SETTINGS: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
  sound: true,
  vibrate: true,
};

export interface FocusTopic {
  code: string;
  subject: string;
  topicId: string;
  topicTitle: string;
}

export type Phase = "idle" | "focus" | "break";

export interface PomodoroState {
  phase: Phase;
  /** When the current block ends (ms since epoch). Unset when idle or paused. */
  endsAt?: number;
  /** Length of the current block, for the progress ring and the record. */
  durationMs?: number;
  /** Set while paused: how much of the block is left. */
  remainingMs?: number;
  /** Focus blocks finished in this cycle (resets after a long break). */
  cycleCount: number;
  /** Whether the current break is a long one. */
  longBreak?: boolean;
  topic?: FocusTopic;
}

export const IDLE: PomodoroState = { phase: "idle", cycleCount: 0 };

export type PomodoroEvent =
  | { type: "focusDone"; at: number; minutes: number; topic?: FocusTopic; nextBreakMin: number; long: boolean }
  | { type: "breakDone"; at: number };

const MIN = 60_000;

export function startFocus(state: PomodoroState, settings: PomodoroSettings, topic: FocusTopic, now: number): PomodoroState {
  const durationMs = settings.focusMin * MIN;
  return { phase: "focus", endsAt: now + durationMs, durationMs, cycleCount: state.cycleCount, topic };
}

export function pause(state: PomodoroState, now: number): PomodoroState {
  if (state.phase === "idle" || state.endsAt === undefined) return state;
  return { ...state, endsAt: undefined, remainingMs: Math.max(0, state.endsAt - now) };
}

export function resume(state: PomodoroState, now: number): PomodoroState {
  if (state.remainingMs === undefined) return state;
  return { ...state, endsAt: now + state.remainingMs, remainingMs: undefined };
}

/** Stop the current block without counting it. */
export function stop(state: PomodoroState): PomodoroState {
  // Abandoning a focus block keeps the cycle; skipping a long break starts a fresh cycle.
  return { ...IDLE, cycleCount: state.phase === "break" && state.longBreak ? 0 : state.cycleCount, topic: state.topic };
}

export function remainingMs(state: PomodoroState, now: number): number {
  if (state.remainingMs !== undefined) return state.remainingMs;
  return state.endsAt === undefined ? 0 : Math.max(0, state.endsAt - now);
}

/**
 * Move the timer on to `now`. A finished focus block starts its break automatically, timed from
 * when the focus actually ended. A finished break goes back to idle: the next focus block waits
 * for him to start it.
 */
export function reconcile(
  state: PomodoroState,
  settings: PomodoroSettings,
  now: number,
): { state: PomodoroState; events: PomodoroEvent[] } {
  const events: PomodoroEvent[] = [];
  let s = state;
  // At most two steps (focus → break → idle), but loop defensively.
  for (let i = 0; i < 4 && s.phase !== "idle" && s.endsAt !== undefined && s.endsAt <= now; i++) {
    const at: number = s.endsAt!;
    if (s.phase === "focus") {
      const cycleCount = s.cycleCount + 1;
      const long = cycleCount % settings.longEvery === 0;
      const breakMin = long ? settings.longBreakMin : settings.shortBreakMin;
      events.push({
        type: "focusDone",
        at,
        minutes: Math.round((s.durationMs ?? settings.focusMin * MIN) / MIN),
        topic: s.topic,
        nextBreakMin: breakMin,
        long,
      });
      s = { phase: "break", endsAt: at + breakMin * MIN, durationMs: breakMin * MIN, cycleCount, longBreak: long, topic: s.topic };
    } else {
      events.push({ type: "breakDone", at });
      s = { ...IDLE, cycleCount: s.longBreak ? 0 : s.cycleCount, topic: s.topic };
    }
  }
  return { state: s, events };
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Validate settings read back from storage, falling back to defaults field by field. */
export function cleanSettings(raw: unknown): PomodoroSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mins = (v: unknown, d: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : d;
  };
  return {
    focusMin: mins(r.focusMin, DEFAULT_SETTINGS.focusMin, 90),
    shortBreakMin: mins(r.shortBreakMin, DEFAULT_SETTINGS.shortBreakMin, 30),
    longBreakMin: mins(r.longBreakMin, DEFAULT_SETTINGS.longBreakMin, 60),
    longEvery: mins(r.longEvery, DEFAULT_SETTINGS.longEvery, 8),
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_SETTINGS.sound,
    vibrate: typeof r.vibrate === "boolean" ? r.vibrate : DEFAULT_SETTINGS.vibrate,
  };
}

/** Validate a saved state; anything odd means start from idle. */
export function cleanState(raw: unknown): PomodoroState {
  if (!raw || typeof raw !== "object") return IDLE;
  const r = raw as PomodoroState;
  if (!["idle", "focus", "break"].includes(r.phase) || !Number.isInteger(r.cycleCount) || r.cycleCount < 0) return IDLE;
  if (r.phase !== "idle" && typeof r.endsAt !== "number" && typeof r.remainingMs !== "number") return IDLE;
  return r;
}
