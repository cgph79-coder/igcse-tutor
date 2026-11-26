/**
 * Arcade: short revision games on the chosen topic. Loaded on demand so the main app stays fast.
 * Questions come from the Worker (/api/quiz-questions); scores go into the same ProgressStore,
 * so they feed the "weak topics" list. Personal bests and the daily streak stay on this device.
 */
import { SYLLABUSES, findSyllabus, findTopic, type Syllabus } from "../../syllabus/index";
import { ApiError, fetchQuizQuestions, type McqQuestion } from "./api";
import { renderMarkdown } from "./render";
import { prefs, type ProgressStore } from "./storage";
import { el } from "./ui";
import type { GameInfo, GameResult } from "./games/types";
import { feedbackButton, openFeedback } from "./feedback";

const ROUND_LENGTH = 10;
/**
 * Sectors: per-topic progression between rounds. Clearing a round (8/10 or better, without
 * quitting) moves him up a sector, and each sector starts the rocks ~10% faster.
 * Within a round the game itself ramps up (harder cards, faster rocks).
 */
const MAX_SECTOR = 5;
const CLEAR_SCORE = 0.8;
const SECTOR_SPEED = 0.9;

export const GAMES: GameInfo[] = [
  {
    id: "asteroids",
    name: "Asteroid answers",
    blurb: "Four answer rocks drift towards your base. Blast the right one before they land.",
    load: () => import("./games/asteroids").then((m) => m.startAsteroids),
  },
];

const COMING_SOON = ["Lane runner", "Defend the base", "Speed tiles"];

export interface ArcadeContext {
  token: string;
  code: string;
  topicId: string;
  tier: string | null;
  store: ProgressStore;
  /** Called when he changes subject or topic in the arcade, so the tutor follows. */
  onTopicChange(code: string, topicId: string): void;
  /** Open the tutor in Learn mode with this message. */
  onLearn(code: string, topicId: string, message: string): void;
  onAuthLost(): void;
}

// ---------- device-only motivation ----------

function bestKey(game: string, code: string, topicId: string) {
  return `arcade:best:${game}:${code}:${topicId}`;
}

function sectorKey(game: string, code: string, topicId: string) {
  return `arcade:sector:${game}:${code}:${topicId}`;
}

function readSector(game: string, code: string, topicId: string): number {
  const n = Number(prefs.get(sectorKey(game, code, topicId)) ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= MAX_SECTOR ? n : 1;
}

function today() {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

function readStreak(): { last: string; days: number } {
  try {
    const s = JSON.parse(prefs.get("arcade:streak") ?? "");
    if (typeof s.last === "string" && typeof s.days === "number") return s;
  } catch {
    /* none yet */
  }
  return { last: "", days: 0 };
}

/** Days in a row he has played at least one round (shown, never shared). */
function currentStreak(): number {
  const s = readStreak();
  const yesterday = new Intl.DateTimeFormat("en-CA").format(new Date(Date.now() - 86400000));
  return s.last === today() || s.last === yesterday ? s.days : 0;
}

function bumpStreak(): number {
  const s = readStreak();
  const t = today();
  if (s.last === t) return s.days;
  const days = currentStreak() + 1;
  prefs.set("arcade:streak", JSON.stringify({ last: t, days }));
  return days;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function calmMode(): boolean {
  const saved = prefs.get("arcade:calm");
  return saved === null ? prefersReducedMotion() : saved === "1";
}

// ---------- views ----------

function visibleTopics(s: Syllabus, tier: string | null) {
  return s.sections.map((sec) => ({
    ...sec,
    topics: sec.topics.filter((t) => !(t.tier === "extended" && tier === "Core")),
  }));
}

function inline(text: string, tag = "span", cls = "") {
  const node = el(tag, cls ? { class: cls } : {});
  node.innerHTML = renderMarkdown(text, true);
  return node;
}

/** Mounts the arcade into `panel`; returns a cleanup function. */
export function mountArcade(panel: HTMLElement, ctx: ArcadeContext): () => void {
  let stopGame: (() => void) | null = null;
  let alive = true;

  const syllabus = () => findSyllabus(ctx.code) ?? SYLLABUSES[0];
  const tierFor = (s: Syllabus) => (s.tiers ? (ctx.tier && s.tiers.includes(ctx.tier) ? ctx.tier : s.defaultTier) : null);

  function lobby() {
    stopGame?.();
    stopGame = null;
    const s = syllabus();
    const tier = tierFor(s);
    const topic = findTopic(s, ctx.topicId)?.topic;

    const subjectSel = el("select", { "aria-label": "Subject" }) as HTMLSelectElement;
    for (const sy of SYLLABUSES) subjectSel.append(el("option", { value: sy.code }, `${sy.subject} (${sy.code})`));
    subjectSel.value = s.code;
    subjectSel.addEventListener("change", () => {
      const next = findSyllabus(subjectSel.value)!;
      ctx.code = next.code;
      ctx.topicId = visibleTopics(next, tierFor(next)).flatMap((sec) => sec.topics)[0]?.id ?? "";
      ctx.onTopicChange(ctx.code, ctx.topicId);
      lobby();
    });

    const topicSel = el("select", { "aria-label": "Topic" }) as HTMLSelectElement;
    for (const sec of visibleTopics(s, tier)) {
      const group = el("optgroup", { label: sec.title });
      for (const t of sec.topics) group.append(el("option", { value: t.id }, t.title));
      topicSel.append(group);
    }
    topicSel.value = ctx.topicId;
    topicSel.addEventListener("change", () => {
      ctx.topicId = topicSel.value;
      ctx.onTopicChange(ctx.code, ctx.topicId);
      lobby();
    });

    const calm = el("input", { type: "checkbox" }) as HTMLInputElement;
    calm.checked = calmMode();
    calm.addEventListener("change", () => prefs.set("arcade:calm", calm.checked ? "1" : "0"));

    const streak = currentStreak();
    const cards = GAMES.map((g) => {
      const best = Number(prefs.get(bestKey(g.id, s.code, ctx.topicId)) ?? 0);
      const sector = readSector(g.id, s.code, ctx.topicId);
      const play = el("button", { type: "button", class: "play-btn" }, "Play");
      play.addEventListener("click", () => startRound(g));
      return el("div", { class: "card game-card" },
        el("div", { class: "game-card-text" },
          el("strong", {}, g.name),
          el("div", { class: "meta" }, g.blurb),
          el("div", { class: "meta" },
            `Sector ${sector} of ${MAX_SECTOR}` + (best ? ` · best ${best}` : "") +
              (sector < MAX_SECTOR ? ` · score ${CLEAR_SCORE * ROUND_LENGTH}+ to move up` : " · top speed")),
        ),
        play,
      );
    });

    panel.replaceChildren(...[
      el("h2", {}, "Arcade"),
      el("p", { class: "meta" }, `Quick-fire recall cards to check you know a topic's key facts, best after you've studied it. ${ROUND_LENGTH} cards a round; anything you miss is explained at the end.`),
      el("div", { class: "arcade-pick" },
        el("label", { class: "field" }, "Subject", subjectSel),
        el("label", { class: "field" }, "Topic", topicSel),
      ),
      el("label", { class: "check" }, calm, " Calm mode (no timer)"),
      streak ? el("p", { class: "streak-note" }, `🔥 ${streak}-day streak — keep it going!`) : null,
      ...cards,
      el("p", { class: "meta soon" }, `Coming soon: ${COMING_SOON.join(" · ")}`),
      topic ? null : el("p", { class: "err" }, "Pick a topic to play."),
    ].filter((n): n is HTMLElement => n !== null));
  }

  async function startRound(game: GameInfo) {
    const s = syllabus();
    const found = findTopic(s, ctx.topicId);
    if (!found) return;
    panel.replaceChildren(el("div", { class: "arcade-loading", role: "status" },
      el("div", { class: "loader-rock", "aria-hidden": "true" }),
      el("p", {}, `Building your asteroid field for ${found.topic.title}…`),
    ));

    let questions: McqQuestion[];
    let start;
    try {
      [questions, start] = await Promise.all([
        fetchQuizQuestions(ctx.token, { code: s.code, topicId: found.topic.id, tier: tierFor(s), count: ROUND_LENGTH }),
        game.load(),
      ]);
    } catch (ex) {
      if (!alive) return;
      if (ex instanceof ApiError && ex.status === 401) return ctx.onAuthLost();
      const back = el("button", { type: "button", class: "icon-btn" }, "Back");
      back.addEventListener("click", lobby);
      panel.replaceChildren(el("div", { class: "arcade-loading" },
        el("p", { class: ex instanceof ApiError && ex.kind === "limit" ? "" : "err" },
          ex instanceof Error ? ex.message : "Couldn't load questions."),
        back,
      ));
      return;
    }
    if (!alive) return;

    ctx.store.recordStudy({ code: s.code, topicId: found.topic.id, topicTitle: found.topic.title, subject: s.subject });
    const stage = el("div", { class: "arcade-stage" });
    panel.replaceChildren(stage);
    stopGame = start(stage, {
      questions,
      calm: calmMode(),
      reducedMotion: prefersReducedMotion(),
      speed: Math.pow(SECTOR_SPEED, readSector(game.id, s.code, found.topic.id) - 1),
      onEnd: (r) => {
        stopGame = null;
        results(game, r);
      },
    });
  }

  function results(game: GameInfo, r: GameResult) {
    const s = syllabus();
    const found = findTopic(s, ctx.topicId);
    const got = r.answers.filter((a) => a.correct).length;
    const total = r.answers.length;

    let newBest = false;
    let sectorNote = "";
    let streak = currentStreak();
    if (found && total > 0) {
      ctx.store.recordScore({
        code: s.code, topicId: found.topic.id, topicTitle: found.topic.title, subject: s.subject,
        mode: "arcade", got, max: total,
      });
      const key = bestKey(game.id, s.code, found.topic.id);
      if (r.score > Number(prefs.get(key) ?? 0)) {
        prefs.set(key, String(r.score));
        newBest = true;
      }
      streak = bumpStreak();
      const sector = readSector(game.id, s.code, found.topic.id);
      if (!r.quit && total >= ROUND_LENGTH && got / total >= CLEAR_SCORE) {
        if (sector < MAX_SECTOR) {
          prefs.set(sectorKey(game.id, s.code, found.topic.id), String(sector + 1));
          sectorNote = `Sector ${sector} cleared! Sector ${sector + 1} is faster.`;
        } else {
          sectorNote = "Top sector cleared — you know this topic cold.";
        }
      } else if (!r.quit) {
        sectorNote = `Sector ${sector}: score ${CLEAR_SCORE * ROUND_LENGTH}+ out of ${ROUND_LENGTH} to move up.`;
      }
    }

    const again = el("button", { type: "button", class: "play-btn" }, "Play again");
    again.addEventListener("click", () => startRound(game));
    const back = el("button", { type: "button", class: "icon-btn" }, "Arcade");
    back.addEventListener("click", lobby);

    const wrong = r.answers.filter((a) => !a.correct);
    const review = wrong.map((a) => {
      const q = a.question;
      const learn = el("button", { type: "button", class: "icon-btn" }, "Learn this");
      learn.addEventListener("click", () => {
        if (!found) return;
        // Plain text reads better in his message bubble; the tutor copes fine without the $ signs.
        const plain = (t: string) => t.replace(/\$/g, "");
        ctx.onLearn(s.code, found.topic.id,
          `I got this wrong in a revision game: "${plain(q.q)}" I said "${a.chosen === null ? "(ran out of time)" : plain(q.options[a.chosen])}" ` +
            `but the answer was "${plain(q.options[q.answer])}". Can you help me understand why?`);
      });
      const plainText = (t: string) => t.replace(/\$/g, "");
      const report = el("button", { type: "button", class: "link-btn" }, "Report this card");
      report.addEventListener("click", () =>
        openFeedback({
          token: ctx.token,
          area: "arcade",
          context: { view: "arcade-results", code: s.code, topic: found?.topic.title, game: game.name },
          text: `This card looks wrong: "${plainText(q.q)}" (marked answer: ${plainText(q.options[q.answer])}). Because: `,
          onAuthLost: ctx.onAuthLost,
        }),
      );
      return el("div", { class: "card review-card" },
        inline(q.q, "div", "review-q"),
        el("div", { class: "review-line bad" }, "Your answer: ",
          a.chosen === null ? el("em", {}, "ran out of time") : inline(q.options[a.chosen])),
        el("div", { class: "review-line good" }, "Correct: ", inline(q.options[q.answer])),
        q.explain ? inline(q.explain, "div", "meta") : null,
        el("div", { class: "review-actions" }, learn, report),
      );
    });

    panel.replaceChildren(
      el("div", { class: "results-head" },
        el("h2", {}, r.quit ? "Round ended" : "Round over"),
        el("div", { class: "results-score" }, String(r.score)),
        el("div", { class: "meta" }, `${got}/${total} correct · best streak ${r.bestStreak}` + (streak ? ` · 🔥 ${streak}-day streak` : "")),
        newBest ? el("div", { class: "score-chip" }, "New personal best!") : null,
        sectorNote ? el("div", { class: "meta" }, sectorNote) : null,
      ),
      el("div", { class: "results-actions" }, again, back),
      wrong.length ? el("h2", { style: "margin-top:20px" }, "Worth another look") : el("p", {}, total ? "Perfect round — nothing to fix! 🎉" : ""),
      wrong.length ? el("p", { class: "meta" }, "Missing a few is normal; these are the cards that make the round worth playing.") : "",
      ...review,
      el("p", { class: "meta feedback-line" }, "Something not right, or an idea for the game? ",
        feedbackButton("Send feedback", () => ({
          token: ctx.token,
          area: "arcade",
          context: { view: "arcade-results", code: s.code, topic: found?.topic.title, game: game.name },
          onAuthLost: ctx.onAuthLost,
        }))),
    );
  }

  lobby();
  return () => {
    alive = false;
    stopGame?.();
  };
}
