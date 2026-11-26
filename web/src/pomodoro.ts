/**
 * Pomodoro study timer: focus blocks with short breaks (a long one every 4th).
 * A header button opens the panel; while a block runs, a slim bar under the header shows the
 * phase, topic and countdown in every view (tutor, arcade, progress). Alerts at each change:
 * on-screen, plus optional sound, vibration and a browser notification.
 * The timing logic lives in pomodoro-core.ts; this file is the UI around it.
 */
import { prefs, type ProgressStore } from "./storage";
import { el } from "./ui";
import { isIos, isStandalone, showNotification } from "./install";
import {
  cleanSettings,
  cleanState,
  formatClock,
  IDLE,
  pause,
  reconcile,
  remainingMs,
  resume,
  startFocus,
  stop,
  type FocusTopic,
  type PomodoroEvent,
  type PomodoroSettings,
  type PomodoroState,
} from "./pomodoro-core";

export interface PomodoroContext {
  store: ProgressStore;
  /** The topic selected in the tutor right now (the next focus block is for this). */
  currentTopic(): FocusTopic | null;
  /** Open the arcade on a topic for a quick recall round. */
  openArcade(code: string, topicId: string): void;
}

const STATE_KEY = "pomodoro:state";
const SETTINGS_KEY = "pomodoro:settings";
/** Alerts for blocks that ended longer ago than this (app was closed) are shown quietly. */
const FRESH_MS = 90_000;

let ctx: PomodoroContext;
let state: PomodoroState = IDLE;
let settings: PomodoroSettings = cleanSettings(null);
let dialog: HTMLDialogElement | null = null;
let audio: AudioContext | null = null;
let lastPhaseKey = "";

function load() {
  try {
    state = cleanState(JSON.parse(prefs.get(STATE_KEY) ?? "null"));
    settings = cleanSettings(JSON.parse(prefs.get(SETTINGS_KEY) ?? "null"));
  } catch {
    state = IDLE;
  }
}

function save() {
  prefs.set(STATE_KEY, JSON.stringify(state));
}

function saveSettings() {
  prefs.set(SETTINGS_KEY, JSON.stringify(settings));
}

function setState(next: PomodoroState) {
  state = next;
  save();
  refresh(true);
}

// ---------- alerts ----------

/** Must be called from a tap: phones only allow sound after the user has interacted. */
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

function chime(kind: "focusDone" | "breakDone") {
  if (!settings.sound || !audio) return;
  const notes = kind === "focusDone" ? [660, 880, 1100] : [880, 660, 880];
  notes.forEach((freq, i) => {
    const t = audio!.currentTime + i * 0.22;
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.21);
  });
}

function notify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) void showNotification(title, body);
}

function toast(title: string, body: string, actions: Array<{ label: string; run: () => void }> = []) {
  document.querySelector(".pomo-toast")?.remove();
  const close = el("button", { type: "button", class: "pomo-toast-close", "aria-label": "Dismiss" }, "×");
  const row = el("div", { class: "pomo-toast-actions" });
  for (const a of actions) {
    const b = el("button", { type: "button" }, a.label);
    b.addEventListener("click", () => {
      t.remove();
      a.run();
    });
    row.append(b);
  }
  const t = el("div", { class: "pomo-toast", role: "alert" }, close, el("strong", {}, title), el("p", {}, body), actions.length ? row : null);
  close.addEventListener("click", () => t.remove());
  document.body.append(t);
}

function handle(events: PomodoroEvent[], now: number) {
  for (const e of events) {
    const fresh = now - e.at < FRESH_MS;
    if (e.type === "focusDone") {
      if (e.topic) void ctx.store.recordFocus({ at: new Date(e.at).toISOString(), minutes: e.minutes, ...e.topic });
      const title = "Focus block done ✓";
      const body = `Take a ${e.nextBreakMin}-minute${e.long ? " long" : ""} break. Stand up, get some water and look away from the screen.`;
      if (fresh) {
        chime("focusDone");
        if (settings.vibrate) navigator.vibrate?.([200, 100, 200]);
        notify(title, body);
      }
      toast(title, body);
    } else {
      const title = "Break over";
      const topic = state.topic;
      const body = topic ? `Ready for the next focus block? Warm up with a quick recall round on ${topic.topicTitle} first.` : "Ready for the next focus block?";
      if (fresh) {
        chime("breakDone");
        if (settings.vibrate) navigator.vibrate?.([300]);
        notify(title, body);
      }
      toast(title, body, [
        { label: "Start focus", run: () => begin() },
        ...(topic ? [{ label: "Recall round", run: () => ctx.openArcade(topic.code, topic.topicId) }] : []),
      ]);
    }
  }
}

// ---------- actions ----------

function begin() {
  const topic = ctx.currentTopic();
  if (!topic) return;
  unlockAudio();
  setState(startFocus(state, settings, topic, Date.now()));
}

// ---------- UI ----------

function phaseLabel(): string {
  if (state.phase === "focus") return "Focus";
  if (state.phase === "break") return state.longBreak ? "Long break" : "Break";
  return "Study timer";
}

function icon(): string {
  if (state.remainingMs !== undefined) return "⏸";
  return state.phase === "focus" ? "🍅" : state.phase === "break" ? "☕" : "⏱";
}

/** Header button. */
export function timerButton(): HTMLElement {
  const b = el("button", { class: "icon-btn timer-btn", title: "Study timer", "aria-label": "Study timer", "data-pomo-btn": "" }, "⏱");
  b.addEventListener("click", openPanel);
  return b;
}

/** Slim bar under the header while a block is running (hidden when idle). */
export function timerBar(): HTMLElement {
  const bar = el("button", { type: "button", class: "pomo-bar hidden", "data-pomo-bar": "", "aria-label": "Open study timer" });
  bar.addEventListener("click", openPanel);
  queueMicrotask(() => refresh(false));
  return bar;
}

function refresh(structural: boolean) {
  const now = Date.now();
  const left = formatClock(remainingMs(state, now));
  const running = state.phase !== "idle";
  for (const bar of document.querySelectorAll<HTMLElement>("[data-pomo-bar]")) {
    bar.classList.toggle("hidden", !running);
    bar.classList.toggle("break", state.phase === "break");
    bar.textContent = running
      ? `${icon()} ${phaseLabel()}${state.phase === "focus" && state.topic ? ` · ${state.topic.topicTitle}` : ""} · ${left}`
      : "";
  }
  for (const b of document.querySelectorAll<HTMLElement>("[data-pomo-btn]")) {
    b.setAttribute("aria-pressed", String(running));
  }
  for (const c of document.querySelectorAll<HTMLElement>("[data-pomo-clock]")) c.textContent = running ? left : formatClock(settings.focusMin * 60000);
  const key = `${state.phase}:${state.remainingMs !== undefined}:${state.cycleCount}`;
  if (dialog?.open && (structural || key !== lastPhaseKey)) renderPanel();
  lastPhaseKey = key;
}

function tick() {
  const now = Date.now();
  const r = reconcile(state, settings, now);
  if (r.events.length) {
    state = r.state;
    save();
    handle(r.events, now);
    refresh(true);
  } else {
    refresh(false);
  }
}

function select(label: string, value: number, options: number[], onChange: (n: number) => void) {
  const sel = el("select", { "aria-label": label }) as HTMLSelectElement;
  for (const n of options) sel.append(el("option", { value: String(n) }, `${n} min`));
  sel.value = String(value);
  sel.addEventListener("change", () => onChange(Number(sel.value)));
  return el("label", { class: "field" }, label, sel);
}

function checkbox(label: string, value: boolean, onChange: (v: boolean) => void) {
  const box = el("input", { type: "checkbox" }) as HTMLInputElement;
  box.checked = value;
  box.addEventListener("change", () => onChange(box.checked));
  return el("label", { class: "check" }, box, ` ${label}`);
}

function notificationControl(): HTMLElement | null {
  if (!("Notification" in window)) {
    // iPhone/iPad only allow web notifications in apps added to the Home Screen.
    return isIos() && !isStandalone()
      ? el("p", { class: "meta" }, "For notifications on iPhone, add the app to your Home Screen (see Progress).")
      : null;
  }
  if (Notification.permission === "granted") return el("p", { class: "meta" }, "Notifications are on for when the app is in the background.");
  if (Notification.permission === "denied") return el("p", { class: "meta" }, "Notifications are blocked in your browser settings.");
  const b = el("button", { type: "button", class: "icon-btn" }, "Allow notifications");
  b.addEventListener("click", async () => {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
    renderPanel();
  });
  return b;
}

async function todayLine(target: HTMLElement) {
  const today = new Date().toDateString();
  const blocks = (await ctx.store.focusLog()).filter((r) => new Date(r.at).toDateString() === today);
  const mins = blocks.reduce((n, r) => n + r.minutes, 0);
  target.textContent = blocks.length ? `Today: ${blocks.length} focus block${blocks.length === 1 ? "" : "s"} · ${formatDuration(mins)}` : "No focus blocks yet today.";
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

function renderPanel() {
  if (!dialog) return;
  const now = Date.now();
  const paused = state.remainingMs !== undefined;
  const topic = state.phase === "focus" ? state.topic : ctx.currentTopic();

  const dots = el("div", { class: "pomo-dots", "aria-label": `${state.cycleCount % settings.longEvery} of ${settings.longEvery} focus blocks before a long break` });
  const filled = state.phase === "break" && state.longBreak ? settings.longEvery : state.cycleCount % settings.longEvery;
  for (let i = 0; i < settings.longEvery; i++) dots.append(el("span", { class: i < filled ? "on" : "" }));

  const actions = el("div", { class: "pomo-actions" });
  const btn = (label: string, run: () => void, primary = false) => {
    const b = el("button", { type: "button", class: primary ? "play-btn" : "icon-btn" }, label);
    b.addEventListener("click", run);
    actions.append(b);
  };
  if (state.phase === "idle") {
    btn(`Start focus · ${settings.focusMin} min`, begin, true);
    const last = state.topic;
    if (last && state.cycleCount > 0) btn("Recall round first", () => { dialog!.close(); ctx.openArcade(last.code, last.topicId); });
  } else {
    if (paused) btn("Resume", () => { unlockAudio(); setState(resume(state, Date.now())); }, true);
    else btn("Pause", () => setState(pause(state, Date.now())), true);
    btn(state.phase === "focus" ? "Stop (won't count)" : "Skip break", () => setState(stop(state)));
  }

  const today = el("p", { class: "meta" });
  void todayLine(today);

  const settingsBox = el("details", { class: "pomo-settings" },
    el("summary", {}, "Settings"),
    el("div", { class: "pomo-settings-grid" },
      select("Focus", settings.focusMin, [15, 20, 25, 30, 40, 45, 50], (n) => { settings.focusMin = n; saveSettings(); renderPanel(); }),
      select("Short break", settings.shortBreakMin, [3, 5, 10], (n) => { settings.shortBreakMin = n; saveSettings(); }),
      select("Long break", settings.longBreakMin, [10, 15, 20, 30], (n) => { settings.longBreakMin = n; saveSettings(); }),
    ),
    checkbox("Sound", settings.sound, (v) => { settings.sound = v; saveSettings(); if (v) unlockAudio(); }),
    checkbox("Vibrate (phones that support it)", settings.vibrate, (v) => { settings.vibrate = v; saveSettings(); }),
    notificationControl() ?? "",
  );

  const close = el("button", { type: "button", class: "pomo-close", "aria-label": "Close" }, "×");
  close.addEventListener("click", () => dialog!.close());

  dialog.replaceChildren(
    close,
    el("h2", {}, phaseLabel() + (paused ? " (paused)" : "")),
    el("div", { class: `pomo-clock${state.phase === "break" ? " break" : ""}`, "data-pomo-clock": "" },
      formatClock(state.phase === "idle" ? settings.focusMin * 60000 : remainingMs(state, now))),
    el("p", { class: "pomo-topic" },
      topic ? `${state.phase === "focus" ? "" : "Next block: "}${topic.subject} · ${topic.topicTitle}` : "Pick a topic in the tutor first."),
    state.phase === "break" ? el("p", { class: "pomo-tip" }, "Step away from the screen: stand up, stretch, get some water.") : "",
    dots,
    actions,
    today,
    settingsBox,
  );
}

function openPanel() {
  if (!dialog) {
    dialog = el("dialog", { class: "pomo-panel", "aria-label": "Study timer" }) as HTMLDialogElement;
    dialog.addEventListener("click", (e) => e.target === dialog && dialog!.close()); // tap outside closes
    document.body.append(dialog);
  }
  renderPanel();
  dialog.showModal();
}

export function initPomodoro(c: PomodoroContext) {
  ctx = c;
  load();
  tick(); // catch up on anything that finished while the app was closed
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => !document.hidden && tick());
  window.addEventListener("storage", (e) => {
    // Another tab changed the timer.
    if (e.key?.endsWith(STATE_KEY) || e.key?.endsWith(SETTINGS_KEY)) {
      load();
      refresh(true);
    }
  });
}
