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
import { loadJourney } from "./games/journey-save";
import { GAME_NAME } from "./games/journey-content";
import { CARDS_WANTED } from "./games/journey-core";
import { gradeOf, levelFor, recordRun, type Level } from "../../shared/career";
import { loadCareer, saveCareer, syncCareer } from "./career-sync";
import { careerSummary, renderCareerMap, stars } from "./career-view";
import { renderEditorsDesk } from "./exam-view";

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
    loading: "Building your asteroid field",
    load: () => import("./games/asteroids").then((m) => m.startAsteroids),
  },
  {
    id: "journey",
    name: GAME_NAME,
    blurb: "A text adventure. Travel as a young newspaper reporter and check a fact at every stop to get your story on the front page.",
    sectors: false,
    cards: CARDS_WANTED,
    career: true,
    loading: "Packing your bags",
    hasSave: (code, topicId) => loadJourney(code, topicId) !== null,
    load: () => import("./games/journey").then((m) => m.startJourney),
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
  let onLobby = false;
  /** The card level of the Dispatches run in progress (career runs only). */
  let runLevel: Level | null = null;
  const careerGame = GAMES.find((g) => g.career);

  const syllabus = () => findSyllabus(ctx.code) ?? SYLLABUSES[0];
  const tierFor = (s: Syllabus) => (s.tiers ? (ctx.tier && s.tiers.includes(ctx.tier) ? ctx.tier : s.defaultTier) : null);

  function lobby() {
    stopGame?.();
    stopGame = null;
    onLobby = true;
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
    const cards = GAMES.filter((g) => !g.subjects || g.subjects.includes(s.code)).map((g) => {
      const best = Number(prefs.get(bestKey(g.id, s.code, ctx.topicId)) ?? 0);
      const sector = readSector(g.id, s.code, ctx.topicId);
      const saved = topic ? g.hasSave?.(s.code, ctx.topicId) : false;
      const play = el("button", { type: "button", class: "play-btn" }, saved ? "Continue" : "Play");
      play.addEventListener("click", () => startRound(g, !!saved));
      let fresh: HTMLElement | null = null;
      if (saved) {
        fresh = el("button", { type: "button", class: "link-btn" }, "Start again");
        fresh.addEventListener("click", () => {
          if (confirm("Start a new journey? Your saved one will be lost.")) startRound(g, false);
        });
      }
      const career = loadCareer();
      const progress = g.sectors === false
        ? [
            g.career && topic ? `${stars(gradeOf(career, s.code, ctx.topicId))} · level ${levelFor(career, s.code, ctx.topicId)} on this topic` : "",
            best ? `best ${best}` : "",
            saved ? "journey saved" : "",
          ].filter(Boolean).join(" · ")
        : `Sector ${sector} of ${MAX_SECTOR}` + (best ? ` · best ${best}` : "") +
          (sector < MAX_SECTOR ? ` · score ${CLEAR_SCORE * ROUND_LENGTH}+ to move up` : " · top speed");
      return el("div", { class: "card game-card" },
        el("div", { class: "game-card-text" },
          el("strong", {}, g.name),
          el("div", { class: "meta" }, g.blurb),
          progress ? el("div", { class: "meta" }, progress) : null,
        ),
        el("div", { class: "game-card-actions" }, play, fresh),
      );
    });

    panel.replaceChildren(...[
      el("h2", {}, "Arcade"),
      el("p", { class: "meta" }, `Recall cards to check you know a topic's key facts, best after you've studied it. ${ROUND_LENGTH} cards a game; anything you miss is explained at the end.`),
      el("div", { class: "arcade-pick" },
        el("label", { class: "field" }, "Subject", subjectSel),
        el("label", { class: "field" }, "Topic", topicSel),
      ),
      el("label", { class: "check" }, calm, " Calm mode (no timer)"),
      streak ? el("p", { class: "streak-note" }, `🔥 ${streak}-day streak — keep it going!`) : null,
      careerGame ? careerSummary(loadCareer(), careerMap) : null,
      ...cards,
      el("p", { class: "meta soon" }, `Coming soon: ${COMING_SOON.join(" · ")}`),
      topic ? null : el("p", { class: "err" }, "Pick a topic to play."),
    ].filter((n): n is HTMLElement => n !== null));
  }

  function careerMap() {
    onLobby = false;
    renderCareerMap(panel, loadCareer(), {
      onBack: lobby,
      onEditor: (code, topicId) => {
        const sy = findSyllabus(code);
        const found = sy && findTopic(sy, topicId);
        if (!sy || !found) return;
        ctx.code = code;
        ctx.topicId = topicId;
        ctx.onTopicChange(code, topicId);
        stopGame = renderEditorsDesk(panel, {
          token: ctx.token,
          code,
          topicId,
          topicTitle: found.topic.title,
          tier: tierFor(sy),
          onBack: careerMap,
          onLearn: (message) => ctx.onLearn(code, topicId, message),
          onAuthLost: ctx.onAuthLost,
        });
      },
      onPlay: (code, topicId) => {
        ctx.code = code;
        ctx.topicId = topicId;
        ctx.onTopicChange(code, topicId);
        if (careerGame) startRound(careerGame, !!careerGame.hasSave?.(code, topicId));
      },
    });
    panel.scrollTop = 0;
  }

  async function startRound(game: GameInfo, resume = false) {
    onLobby = false;
    const s = syllabus();
    const found = findTopic(s, ctx.topicId);
    if (!found) return;
    runLevel = game.career ? levelFor(loadCareer(), s.code, found.topic.id) : null;
    panel.replaceChildren(el("div", { class: "arcade-loading", role: "status" },
      el("div", { class: "loader-rock", "aria-hidden": "true" }),
      el("p", {}, `${game.loading ?? "Getting ready"} for ${found.topic.title}…`),
    ));

    let questions: McqQuestion[];
    let start;
    try {
      [questions, start] = await Promise.all([
        // A saved run already holds its cards.
        resume ? Promise.resolve([]) :
          fetchQuizQuestions(ctx.token, {
            code: s.code, topicId: found.topic.id, tier: tierFor(s), count: game.cards ?? ROUND_LENGTH, level: runLevel ?? undefined,
          }),
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

    if (!resume) ctx.store.recordStudy({ code: s.code, topicId: found.topic.id, topicTitle: found.topic.title, subject: s.subject });
    const stage = el("div", { class: "arcade-stage" });
    panel.replaceChildren(stage);
    stopGame = start(stage, {
      questions,
      calm: calmMode(),
      reducedMotion: prefersReducedMotion(),
      speed: Math.pow(SECTOR_SPEED, readSector(game.id, s.code, found.topic.id) - 1),
      topic: { code: s.code, sectionId: found.section.id, topicId: found.topic.id, topicTitle: found.topic.title },
      resume,
      onEnd: (r) => {
        stopGame = null;
        results(game, r);
      },
      onExit: () => {
        stopGame = null;
        lobby();
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
    let careerNote: HTMLElement | null = null;
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
      if (game.career && runLevel) {
        const res = recordRun(loadCareer(), { code: s.code, topicId: found.topic.id, level: runLevel, got, total, finished: !r.quit });
        saveCareer(res.career);
        void syncCareer(ctx.token).catch(() => {}); // an expired login shows up on the next request
        const nextLevel = levelFor(res.career, s.code, found.topic.id);
        careerNote = el("div", { class: "career-note" },
          res.promotedTo ? el("div", { class: "score-chip" }, `📰 Promoted to ${res.promotedTo}!`) : null,
          el("div", { class: "meta" },
            res.cleared && res.newGrade >= runLevel
              ? `Level ${runLevel} cleared on this topic: ${stars(res.newGrade)}.` + (res.newGrade < 3 ? ` Next time here: level ${nextLevel}.` : " Topic mastered!")
              : r.quit
                ? `Finish the journey with ${Math.ceil(0.8 * total)}+ correct to clear level ${runLevel}.`
                : `Clear level ${runLevel} with 80% or more correct (you got ${Math.round((got / total) * 100)}%).`),
        );
      }
      if (game.sectors === false) {
        /* story games have no speed sectors */
      } else if (!r.quit && total >= ROUND_LENGTH && got / total >= CLEAR_SCORE) {
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
        el("h2", {}, r.title ?? (r.quit ? "Round ended" : "Round over")),
        r.summary ? el("p", { class: "results-summary" }, r.summary) : null,
        el("div", { class: "results-score" }, String(r.score)),
        el("div", { class: "meta" }, `${got}/${total} correct · best streak ${r.bestStreak}` + (streak ? ` · 🔥 ${streak}-day streak` : "")),
        newBest ? el("div", { class: "score-chip" }, "New personal best!") : null,
        sectorNote ? el("div", { class: "meta" }, sectorNote) : null,
        careerNote,
      ),
      el("div", { class: "results-actions" }, again, back),
      wrong.length ? el("h2", { style: "margin-top:20px" }, "Worth another look") : el("p", {}, total ? `Perfect ${game.sectors === false ? "run" : "round"}, nothing to fix! 🎉` : ""),
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
  // Pick up progress made on another device, then refresh the lobby if he's still on it.
  if (careerGame) {
    syncCareer(ctx.token)
      .then(() => alive && onLobby && lobby())
      .catch((ex) => ex instanceof ApiError && ex.status === 401 && alive && ctx.onAuthLost());
  }
  return () => {
    alive = false;
    stopGame?.();
  };
}
