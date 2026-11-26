/**
 * Asteroid answers: four answer rocks drift down towards the base. Tap (or press 1–4) the rock
 * with the right answer before they land. Wrong picks and landings cost a shield; three shields.
 * It gets harder as the round goes on: the cards arrive easiest first (levels 1–3) and the rocks
 * fall faster with every card, faster still on a streak. Each card starts with a short reading
 * pause (longer for longer questions) before the rocks move; he can answer during it.
 * Calm mode stops the drift (no timer) but keeps the harder cards.
 */
import { renderMarkdown } from "../render";
import { el } from "../ui";
import type { AnswerRecord, GameOptions, StartGame } from "./types";

const SHIELDS = 3;
const BASE_FALL_MS = 15000;
const MIN_FALL_MS = 5000;
/** Each card falls this much faster than the one before (card 10 is ~45% quicker than card 1). */
const RAMP_PER_CARD = 0.935;
/** Extra speed for each correct answer in a row. */
const RAMP_PER_STREAK = 0.97;
const LEVEL_NAMES = ["", "Level 1", "Level 2 — trickier cards", "Level 3 — expert cards"];
const LEVEL_PAUSE_MS = 1300;
/** Reading time before the rocks start to fall: a base plus time per character of question and answers. */
const READ_BASE_MS = 1200;
const READ_MS_PER_Q_CHAR = 45;
const READ_MS_PER_OPTION_CHAR = 20;
const READ_MIN_MS = 2000;
const READ_MAX_MS = 6000;

/** Roughly how many characters he actually reads (LaTeX commands and $ signs don't count). */
function readableLength(text: string): number {
  return text.replace(/\\[a-zA-Z]+/g, " ").replace(/[${}^_\\]/g, "").replace(/\s+/g, " ").trim().length;
}

export function readingTimeMs(question: string, options: string[]): number {
  const ms =
    READ_BASE_MS +
    readableLength(question) * READ_MS_PER_Q_CHAR +
    options.reduce((n, o) => n + readableLength(o), 0) * READ_MS_PER_OPTION_CHAR;
  return Math.round(Math.min(READ_MAX_MS, Math.max(READ_MIN_MS, ms)));
}
const LABELS = ["1", "2", "3", "4"];

export const startAsteroids: StartGame = (stage, opts: GameOptions) => {
  const { questions, calm, reducedMotion } = opts;
  let index = 0;
  let shields = SHIELDS;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let locked = false; // between questions
  let progress = 0; // 0 = top of the field, 1 = landed
  let fallMs = BASE_FALL_MS;
  let last = 0;
  let raf = 0;
  let paused = false;
  let ended = false;
  let holdUntil = 0; // the rocks wait during the reading pause and any "level up" banner
  let shownLevel = 0;
  const timers: number[] = [];
  const answers: AnswerRecord[] = [];

  // ---- layout ----
  const shieldEl = el("span", { class: "hud-shields", "aria-label": "Shields" });
  const scoreEl = el("span", { class: "hud-score" }, "0");
  const streakEl = el("span", { class: "hud-streak" });
  const countEl = el("span", { class: "hud-count" });
  const quitBtn = el("button", { type: "button", class: "hud-quit", "aria-label": "End round" }, "End");
  const hud = el("div", { class: "arcade-hud" }, shieldEl, countEl, streakEl, scoreEl, quitBtn);
  const questionEl = el("div", { class: "arcade-question", "aria-live": "polite" });
  const formation = el("div", { class: "rock-formation" });
  const flash = el("div", { class: "arcade-flash", "aria-live": "assertive" });
  const base = el("div", { class: "arcade-base", "aria-hidden": "true" }, el("div", { class: "base-turret" }));
  const field = el("div", { class: `arcade-field${reducedMotion ? " still" : ""}` }, formation, flash, base);
  const root = el("div", { class: "arcade-game" }, hud, questionEl, field);
  stage.replaceChildren(root);

  let rocks: HTMLButtonElement[] = [];

  function updateHud() {
    shieldEl.textContent = "🛡".repeat(shields) + "·".repeat(SHIELDS - shields);
    shieldEl.setAttribute("aria-label", `${shields} shield${shields === 1 ? "" : "s"} left`);
    scoreEl.textContent = String(score);
    const level = questions[Math.min(index, questions.length - 1)].level;
    countEl.textContent = `${Math.min(index + 1, questions.length)}/${questions.length}${level ? ` · L${level}` : ""}`;
    const mult = multiplier();
    streakEl.textContent = streak >= 2 ? `🔥${streak}${mult > 1 ? ` ×${mult}` : ""}` : "";
  }

  function multiplier() {
    return Math.min(3, 1 + Math.floor(streak / 3) * 0.5);
  }

  function showQuestion() {
    const q = questions[index];
    locked = false;
    progress = 0;
    fallMs = Math.max(MIN_FALL_MS, BASE_FALL_MS * opts.speed * Math.pow(RAMP_PER_CARD, index) * Math.pow(RAMP_PER_STREAK, streak));
    const level = q.level ?? 0;
    let bannerMs = 0;
    if (level > shownLevel) {
      // Announce harder cards (not the first level) and give him a beat before the rocks move.
      if (shownLevel > 0) {
        flash.textContent = `${LEVEL_NAMES[level]}${calm ? "" : " · faster"}`;
        flash.className = "arcade-flash level";
        bannerMs = LEVEL_PAUSE_MS;
        later(() => flash.classList.contains("level") && (flash.className = "arcade-flash"), LEVEL_PAUSE_MS);
      }
      shownLevel = level;
    }
    questionEl.innerHTML = renderMarkdown(q.q, true);
    if (!calm) {
      // Reading pause: the rocks hold still while a thin bar fills, then start to fall.
      const readMs = readingTimeMs(q.q, q.options);
      holdUntil = performance.now() + bannerMs + readMs;
      const bar = el("div", { class: "read-bar", "aria-hidden": "true" }, el("div"));
      bar.style.setProperty("--read-ms", `${readMs}ms`);
      bar.style.setProperty("--read-delay", `${bannerMs}ms`);
      questionEl.append(bar);
    }
    formation.classList.remove("landed");
    formation.style.setProperty("--fall", "0");
    rocks = q.options.map((opt, i) => {
      const b = el("button", { type: "button", class: `rock rock-${i}` }) as HTMLButtonElement;
      b.append(el("span", { class: "rock-key", "aria-hidden": "true" }, LABELS[i]), el("span", { class: "sr-only" }, `Answer ${LABELS[i]}: `));
      const label = el("span", { class: "rock-label" });
      label.innerHTML = renderMarkdown(opt, true);
      b.append(label);
      b.addEventListener("click", () => choose(i));
      return b;
    });
    formation.replaceChildren(...rocks);
    updateHud();
  }

  function later(fn: () => void, ms: number) {
    timers.push(window.setTimeout(fn, ms));
  }

  function choose(i: number | null) {
    if (locked || ended || paused) return;
    locked = true;
    const q = questions[index];
    const correct = i === q.answer;
    answers.push({ question: q, chosen: i, correct });

    rocks.forEach((r) => (r.disabled = true));
    rocks[q.answer].classList.add(correct ? "hit" : "reveal");
    if (correct) {
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      const timeBonus = calm ? 0 : Math.round(50 * (1 - progress));
      const gained = Math.round((100 + timeBonus) * multiplier());
      score += gained;
      flash.textContent = `+${gained}`;
      flash.className = "arcade-flash good";
    } else {
      streak = 0;
      shields -= 1;
      if (i !== null) rocks[i].classList.add("miss");
      else formation.classList.add("landed");
      flash.textContent = i === null ? "Landed! −1 shield" : "−1 shield";
      flash.className = "arcade-flash bad";
      if (!reducedMotion) field.classList.add("shake");
    }
    rocks.forEach((r, k) => k !== q.answer && k !== i && r.classList.add("fade"));
    updateHud();

    later(() => {
      flash.className = "arcade-flash";
      field.classList.remove("shake");
      index += 1;
      if (shields <= 0 || index >= questions.length) finish(false);
      else showQuestion();
    }, correct ? 750 : 1700);
  }

  function finish(quit: boolean) {
    if (ended) return;
    ended = true;
    cleanup();
    opts.onEnd({ score, answers, bestStreak, quit });
  }

  function tick(now: number) {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(now - last, 100) : 0;
    last = now;
    if (calm || locked || paused || ended || now < holdUntil) return;
    progress = Math.min(1, progress + dt / fallMs);
    formation.style.setProperty("--fall", progress.toFixed(4));
    if (progress >= 1) choose(null);
  }

  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
    if (k >= 0 && e.key.length === 1) {
      e.preventDefault();
      choose(k);
    }
  }

  function onVisibility() {
    paused = document.hidden;
    last = 0;
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisibility);
  }

  quitBtn.addEventListener("click", () => finish(true));
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  showQuestion();
  raf = requestAnimationFrame(tick);
  return cleanup;
};
