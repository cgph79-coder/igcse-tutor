import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  IDLE,
  cleanSettings,
  cleanState,
  formatClock,
  pause,
  reconcile,
  remainingMs,
  resume,
  startFocus,
  stop,
} from "../src/pomodoro-core";

const MIN = 60_000;
const topic = { code: "0606", subject: "Additional Mathematics", topicId: "series", topicTitle: "Series" };
const S = DEFAULT_SETTINGS;

describe("pomodoro timer", () => {
  it("counts down from the stored end time", () => {
    const s = startFocus(IDLE, S, topic, 0);
    expect(remainingMs(s, 10 * MIN)).toBe(15 * MIN);
    expect(reconcile(s, S, 24 * MIN).events).toEqual([]);
  });

  it("starts a short break when focus ends, timed from the real end", () => {
    const s = startFocus(IDLE, S, topic, 0);
    const r = reconcile(s, S, 25 * MIN + 30_000);
    expect(r.events).toEqual([{ type: "focusDone", at: 25 * MIN, minutes: 25, topic, nextBreakMin: 5, long: false }]);
    expect(r.state.phase).toBe("break");
    expect(remainingMs(r.state, 25 * MIN + 30_000)).toBe(4.5 * MIN);
  });

  it("catches up on focus and break both ending while the app was closed", () => {
    const s = startFocus(IDLE, S, topic, 0);
    const r = reconcile(s, S, 2 * 60 * MIN);
    expect(r.events.map((e) => e.type)).toEqual(["focusDone", "breakDone"]);
    expect(r.events[1].at).toBe(30 * MIN);
    expect(r.state).toMatchObject({ phase: "idle", cycleCount: 1 });
  });

  it("makes every 4th break a long one, then starts a new cycle", () => {
    let s = IDLE;
    let t = 0;
    const breaks: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = startFocus(s, S, topic, t);
      const r = reconcile(s, S, t + 3 * 60 * MIN);
      const done = r.events[0];
      if (done.type === "focusDone") breaks.push(done.nextBreakMin);
      s = r.state;
      t += 3 * 60 * MIN;
    }
    expect(breaks).toEqual([5, 5, 5, 15, 5]);
  });

  it("pauses and resumes without losing time", () => {
    const s = startFocus(IDLE, S, topic, 0);
    const p = pause(s, 10 * MIN);
    expect(reconcile(p, S, 99 * MIN).events).toEqual([]);
    const r = resume(p, 50 * MIN);
    expect(remainingMs(r, 50 * MIN)).toBe(15 * MIN);
    expect(reconcile(r, S, 65 * MIN).events[0]).toMatchObject({ type: "focusDone", at: 65 * MIN });
  });

  it("doesn't count a stopped focus block", () => {
    const s = stop(startFocus({ ...IDLE, cycleCount: 2 }, S, topic, 0));
    expect(s).toMatchObject({ phase: "idle", cycleCount: 2 });
    expect(reconcile(s, S, 99 * MIN).events).toEqual([]);
  });

  it("formats the clock", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(61_500)).toBe("1:02");
    expect(formatClock(0)).toBe("0:00");
  });

  it("cleans bad saved data", () => {
    expect(cleanSettings({ focusMin: 500, sound: "yes", shortBreakMin: 10 })).toMatchObject({ focusMin: 25, sound: true, shortBreakMin: 10 });
    expect(cleanState({ phase: "nap", cycleCount: 0 })).toEqual(IDLE);
    expect(cleanState({ phase: "focus", cycleCount: 1 })).toEqual(IDLE);
    expect(cleanState(null)).toEqual(IDLE);
  });
});
