/**
 * Rules for the History journey game, kept free of the DOM so they can be tested.
 * The whole state is plain JSON, so a run can be saved on the device and resumed.
 *
 * A run: arrive at a stop → a scene asks one recall card → the answer changes your resources →
 * rest or work → choose how to travel to the next stop (with a chance of a road incident) → …
 * At the last stop you file your story, and the ending depends on the editor's trust and the deadline.
 */
import type { McqQuestion } from "../api";
import type { AnswerRecord } from "./types";
import {
  deskFor,
  FINAL_SCENE,
  FOLLOW_UP_BOTH,
  FOLLOW_UP_HALF,
  FOLLOW_UP_TEXT,
  INCIDENTS,
  SCENES,
  settingFor,
  type Desk,
  type Effect,
  type Scene,
} from "./journey-content";

export const MAX_STOPS = 10;
export const MIN_STOPS = 3;
/** Up to this many stops ask a second, follow-up card (when enough cards came back). */
export const MAX_FOLLOW_UPS = 3;
/** Cards to ask the Worker for: one per stop plus the follow-ups. */
export const CARDS_WANTED = MAX_STOPS + MAX_FOLLOW_UPS;
export const MAX_STAMINA = 5;
export const MAX_TRUST = 6;
export const START = { funds: 6, stamina: 4, trust: 3, contacts: 1 };
/** Points for a correct card, and for one answered after asking a contact. */
export const CARD_POINTS = 100;
export const CONTACT_POINTS = 50;

export type Phase = "scene" | "outcome" | "camp" | "travel" | "incident" | "ended";

export interface Resources {
  funds: number;
  stamina: number;
  trust: number;
  contacts: number;
  /** Days used so far. */
  day: number;
}

export interface Ending {
  kind: "front-page" | "published" | "page-nine" | "sent-home" | "recalled";
  title: string;
  text: string;
  late: boolean;
  onRoute: boolean;
}

/** One stop: its scene and the card(s) it asks (indices into `cards`). */
export interface StopPlan {
  scene: string;
  cards: number[];
}

export interface JourneyState {
  v: 2;
  desk: Desk;
  code: string;
  sectionId: string;
  topicId: string;
  topicTitle: string;
  intro: string;
  stops: string[];
  stop: number;
  deadline: number;
  res: Resources;
  cards: McqQuestion[];
  plan: StopPlan[];
  /** Which card of the current stop is being asked (0, or 1 for a follow-up). */
  step: number;
  /** Scenes seen on this desk, including this run's, so the next run picks fresh ones. */
  seenScenes: string[];
  phase: Phase;
  /** The two wrong options a contact has ruled out on the current card, if used. */
  ruledOut: number[] | null;
  /** Text to show for the current outcome or incident. */
  message: string;
  /** Resource changes behind the message, for display. */
  delta: Effect;
  answers: AnswerRecord[];
  score: number;
  streak: number;
  bestStreak: number;
  ending: Ending | null;
}

type Rand = () => number;

function shuffled<T>(list: T[], rand: Rand): T[] {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Days allowed: enough to take the local train everywhere and rest twice. */
export function deadlineFor(stops: number): number {
  return (stops - 1) * 2 + 3;
}

/** Scenes this desk can use, apart from the final one. */
export function scenePool(desk: Desk): Scene[] {
  return SCENES.filter((sc) => !sc.desks || sc.desks.includes(desk));
}

/**
 * Pick n scene ids, preferring ones not seen yet. When the unseen ones run out, a new cycle
 * starts: the returned `seen` list then holds only the new cycle's picks.
 */
export function pickScenes(pool: string[], n: number, seen: string[], rand: Rand = Math.random): { ids: string[]; seen: string[] } {
  const seenSet = new Set(seen);
  const unseen = shuffled(pool.filter((id) => !seenSet.has(id)), rand);
  if (unseen.length >= n) {
    const ids = unseen.slice(0, n);
    return { ids, seen: [...seen.filter((id) => pool.includes(id)), ...ids] };
  }
  const refill = shuffled(pool.filter((id) => seenSet.has(id)), rand).slice(0, n - unseen.length);
  return { ids: shuffled([...unseen, ...refill], rand), seen: refill };
}

export function newJourney(
  o: { code: string; sectionId: string; topicId: string; topicTitle: string; cards: McqQuestion[]; seen?: string[] },
  rand: Rand = Math.random,
): JourneyState {
  const desk = deskFor(o.code);
  const setting = settingFor(o.code, o.sectionId);
  const n = Math.min(MAX_STOPS, o.cards.length, setting.route.length);
  if (n < MIN_STOPS) throw new Error("Not enough cards for a journey.");
  // Keep the destination: a short run starts further along the route.
  const stops = setting.route.slice(setting.route.length - n);
  const picked = pickScenes(scenePool(desk).map((sc) => sc.id), n - 1, o.seen ?? [], rand);
  // Spare cards become follow-ups at a few stops in the middle (never the first or last).
  const middle = shuffled(Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1), rand);
  const doubles = new Set(middle.slice(0, Math.min(MAX_FOLLOW_UPS, o.cards.length - n)));
  let next = 0;
  const plan: StopPlan[] = [...picked.ids, FINAL_SCENE.id].map((scene, i) => ({
    scene,
    cards: doubles.has(i) ? [next++, next++] : [next++],
  }));
  return {
    v: 2,
    desk,
    code: o.code,
    sectionId: o.sectionId,
    topicId: o.topicId,
    topicTitle: o.topicTitle,
    intro: setting.intro,
    stops,
    stop: 0,
    deadline: deadlineFor(n),
    res: { ...START, day: 0 },
    cards: o.cards.slice(0, next),
    plan,
    step: 0,
    seenScenes: picked.seen,
    phase: "scene",
    ruledOut: null,
    message: "",
    delta: {},
    answers: [],
    score: 0,
    streak: 0,
    bestStreak: 0,
    ending: null,
  };
}

export function isFinalStop(s: JourneyState): boolean {
  return s.stop === s.stops.length - 1;
}

export function currentScene(s: JourneyState): Scene {
  const id = s.plan[s.stop].scene;
  return (id === FINAL_SCENE.id ? FINAL_SCENE : SCENES.find((x) => x.id === id)) ?? SCENES[0];
}

export function sceneText(s: JourneyState): string {
  return s.step > 0 ? FOLLOW_UP_TEXT : currentScene(s).text.replace("{place}", s.stops[s.stop]);
}

export function currentCard(s: JourneyState): McqQuestion {
  return s.cards[s.plan[s.stop].cards[s.step]];
}

/** True when the card just answered (or being asked) is the last one at this stop. */
export function isLastCardAtStop(s: JourneyState): boolean {
  return s.step >= s.plan[s.stop].cards.length - 1;
}

/** True when the current stop asks two cards. */
export function isTwoPart(s: JourneyState): boolean {
  return s.plan[s.stop].cards.length > 1;
}

/** Apply an effect within limits; returns what actually changed. */
function apply(res: Resources, e: Effect): Effect {
  const before = { ...res };
  res.funds = Math.max(0, res.funds + (e.funds ?? 0));
  res.stamina = Math.min(MAX_STAMINA, Math.max(0, res.stamina + (e.stamina ?? 0)));
  res.trust = Math.min(MAX_TRUST, Math.max(0, res.trust + (e.trust ?? 0)));
  res.contacts = Math.max(0, res.contacts + (e.contacts ?? 0));
  res.day += e.days ?? 0;
  const out: Effect = {};
  if (res.funds !== before.funds) out.funds = res.funds - before.funds;
  if (res.stamina !== before.stamina) out.stamina = res.stamina - before.stamina;
  if (res.trust !== before.trust) out.trust = res.trust - before.trust;
  if (res.contacts !== before.contacts) out.contacts = res.contacts - before.contacts;
  if (res.day !== before.day) out.days = res.day - before.day;
  return out;
}

/** Spend a contact to rule out two wrong options on the current card. */
export function askContact(s: JourneyState, rand: Rand = Math.random): JourneyState {
  if (s.phase !== "scene" || s.ruledOut || s.res.contacts < 1) return s;
  const card = currentCard(s);
  const wrong = shuffled([0, 1, 2, 3].filter((i) => i !== card.answer), rand).slice(0, 2);
  return { ...s, res: { ...s.res, contacts: s.res.contacts - 1 }, ruledOut: wrong };
}

export function answerCard(s: JourneyState, chosen: number): JourneyState {
  if (s.phase !== "scene" || s.ruledOut?.includes(chosen)) return s;
  const next: JourneyState = structuredClone(s);
  const card = currentCard(next);
  const correct = chosen === card.answer;
  const scene = currentScene(next);
  next.answers.push({ question: card, chosen, correct });
  if (correct) {
    next.streak += 1;
    next.bestStreak = Math.max(next.bestStreak, next.streak);
    next.score += next.ruledOut ? CONTACT_POINTS : CARD_POINTS;
  } else {
    next.streak = 0;
  }
  next.phase = "outcome";
  if (!isLastCardAtStop(next)) {
    // First half of a two-part stop: just the verdict, then the follow-up.
    next.message = "";
    next.delta = {};
    return next;
  }
  // The stop's outcome depends on all its cards.
  const asked = next.plan[next.stop].cards.length;
  const got = next.answers.slice(-asked).filter((a) => a.correct).length;
  if (asked > 1 && got === asked) {
    next.delta = apply(next.res, { ...scene.right.effect, trust: (scene.right.effect.trust ?? 0) + 1 });
    next.message = `${FOLLOW_UP_BOTH} ${scene.right.text}`;
  } else if (got > 0 && got < asked) {
    next.delta = {};
    next.message = FOLLOW_UP_HALF;
  } else {
    const outcome = got ? scene.right : scene.wrong;
    next.delta = apply(next.res, outcome.effect);
    next.message = outcome.text;
  }
  return checkFailure(next);
}

function checkFailure(s: JourneyState): JourneyState {
  if (s.res.stamina <= 0) return end(s, "sent-home");
  if (s.res.trust <= 0) return end(s, "recalled");
  return s;
}

/** After reading the outcome: the final stop ends the run, otherwise make camp. */
export function continueFromOutcome(s: JourneyState): JourneyState {
  if (s.phase !== "outcome") return s;
  if (!isLastCardAtStop(s)) return { ...s, step: s.step + 1, ruledOut: null, phase: "scene", message: "", delta: {} };
  if (isFinalStop(s)) return end(s, null);
  return { ...s, phase: "camp", message: "", delta: {} };
}

export interface Choice {
  id: string;
  label: string;
  detail: string;
  effect: Effect;
  disabled?: string;
}

export function campChoices(s: JourneyState): Choice[] {
  const r = s.res;
  return [
    { id: "move", label: "Press on", detail: "Head straight for the station.", effect: {} },
    {
      id: "rest",
      label: "Rest a day",
      detail: "A proper bed and a meal.",
      effect: { stamina: 2, funds: -1, days: 1 },
      disabled: r.funds < 1 ? "You can't afford a room." : r.stamina >= MAX_STAMINA ? "You're already rested." : undefined,
    },
    {
      id: "work",
      label: "Write a quick piece",
      detail: "Sell a short article to a local paper.",
      effect: { funds: 3, stamina: -1, days: 1 },
      disabled: r.stamina <= 1 ? "You're too tired to write." : undefined,
    },
  ];
}

export function chooseCamp(s: JourneyState, id: string): JourneyState {
  if (s.phase !== "camp") return s;
  const c = campChoices(s).find((x) => x.id === id);
  if (!c || c.disabled) return s;
  const next: JourneyState = structuredClone(s);
  next.delta = apply(next.res, c.effect);
  next.phase = "travel";
  return checkFailure(next);
}

interface TravelMode extends Choice {
  incidentChance: number;
}

export function travelChoices(s: JourneyState): TravelMode[] {
  const r = s.res;
  const modes: TravelMode[] = [
    { id: "express", label: "Express train", detail: "Fast and comfortable.", effect: { funds: -3, days: 1 }, incidentChance: 0.1 },
    { id: "local", label: "Local train", detail: "Slow, stops everywhere.", effect: { funds: -1, days: 2 }, incidentChance: 0.25 },
    { id: "hitch", label: "Hitch a ride", detail: "Free, but slow and tiring.", effect: { stamina: -1, days: 3 }, incidentChance: 0.5 },
  ].map((m) => ({
    ...m,
    disabled:
      r.funds + (m.effect.funds ?? 0) < 0 ? "Not enough money." : r.stamina + (m.effect.stamina ?? 0) <= 0 ? "You're too tired to hitch." : undefined,
  }));
  // Never leave him stuck: with no money and no energy, hitching is still possible (and risky).
  if (modes.every((m) => m.disabled)) modes[2].disabled = undefined;
  return modes;
}

export function chooseTravel(s: JourneyState, id: string, rand: Rand = Math.random): JourneyState {
  if (s.phase !== "travel") return s;
  const m = travelChoices(s).find((x) => x.id === id);
  if (!m || m.disabled) return s;
  const next: JourneyState = structuredClone(s);
  const delta = apply(next.res, m.effect);
  next.stop += 1;
  next.step = 0;
  next.ruledOut = null;
  if (rand() < m.incidentChance) {
    const inc = INCIDENTS[Math.floor(rand() * INCIDENTS.length)];
    const extra = apply(next.res, inc.effect);
    for (const [k, v] of Object.entries(extra) as Array<[keyof Effect, number]>) delta[k] = (delta[k] ?? 0) + v;
    next.message = inc.text;
    next.delta = delta;
    next.phase = "incident";
  } else {
    next.message = "";
    next.delta = delta;
    next.phase = "scene";
  }
  return checkFailure(next);
}

export function continueFromIncident(s: JourneyState): JourneyState {
  return s.phase === "incident" ? { ...s, phase: "scene", message: "", delta: {} } : s;
}

export function daysLeft(s: JourneyState): number {
  return s.deadline - s.res.day;
}

const ENDINGS: Record<Ending["kind"], { title: string; text: string }> = {
  "front-page": { title: "Front-page scoop!", text: "Your story leads the paper. The editor wants you on the next big assignment." },
  published: { title: "Your story makes the paper", text: "A solid piece, well received. The editor is pleased." },
  "page-nine": { title: "A short piece on page 9", text: "Too many shaky facts. The editor cut it down to a few lines." },
  "sent-home": { title: "Sent home to recover", text: "You're worn out. The paper sends someone else to finish the story." },
  recalled: { title: "Recalled to London", text: "Too many wrong facts. The editor has lost confidence and calls you home." },
};

function end(s: JourneyState, failure: "sent-home" | "recalled" | null): JourneyState {
  const next: JourneyState = { ...s, phase: "ended" };
  const late = daysLeft(next) < 0;
  let kind: Ending["kind"];
  if (failure) kind = failure;
  else {
    const t = next.res.trust;
    const tier = t >= 5 ? 0 : t >= 3 ? 1 : 2;
    kind = (["front-page", "published", "page-nine"] as const)[Math.min(2, tier + (late ? 1 : 0))];
  }
  const e = ENDINGS[kind];
  next.ending = {
    kind,
    title: e.title,
    text: late && !failure ? `${e.text} You missed the deadline by ${-daysLeft(next)} day${daysLeft(next) === -1 ? "" : "s"}, so it ran later than planned.` : e.text,
    late,
    onRoute: !!failure,
  };
  next.score = finalScore(next);
  return next;
}

/** Card points (s.score before the run ends) plus, for a finished journey, a bonus for what's left in the bag. */
export function finalScore(s: JourneyState): number {
  const cards = s.score;
  if (!s.ending || s.ending.onRoute) return cards;
  const r = s.res;
  return cards + r.trust * 40 + r.stamina * 20 + Math.max(0, daysLeft(s)) * 10 + r.funds * 5 + r.contacts * 15;
}

/** A saved run from storage, if it's one we can still use. Version 1 saves (one card per stop) are upgraded. */
export function parseSave(raw: string | null): JourneyState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Omit<JourneyState, "v"> & { v: number; sceneIds?: string[] };
    if (s?.v === 1 && Array.isArray(s.sceneIds)) {
      s.plan = s.sceneIds.map((scene, i) => ({ scene, cards: [i] }));
      s.step = 0;
      s.desk = deskFor(s.code);
      s.seenScenes = [];
      s.v = 2;
      delete s.sceneIds;
    }
    if (s?.v !== 2 || s.phase === "ended" || !Array.isArray(s.cards) || !Array.isArray(s.stops) || !Array.isArray(s.plan)) return null;
    if (s.plan.length !== s.stops.length || s.stop < 0 || s.stop >= s.stops.length) return null;
    if (s.plan.some((p) => !Array.isArray(p.cards) || p.cards.some((i) => !s.cards[i]))) return null;
    if (s.step < 0 || s.step >= s.plan[s.stop].cards.length) return null;
    return s as JourneyState;
  } catch {
    return null;
  }
}
