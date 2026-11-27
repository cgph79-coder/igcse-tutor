import { describe, expect, it } from "vitest";
import type { McqQuestion } from "../src/api";
import {
  answerCard,
  askContact,
  campChoices,
  chooseCamp,
  chooseTravel,
  continueFromIncident,
  continueFromOutcome,
  currentCard,
  daysLeft,
  newJourney,
  parseSave,
  pickScenes,
  sceneText,
  scenePool,
  travelChoices,
  type JourneyState,
} from "../src/games/journey-core";
import { SCENES, SETTINGS, SUBJECT_SETTINGS } from "../src/games/journey-content";

const card = (i: number): McqQuestion => ({ q: `Q${i}?`, options: ["a", "b", "c", "d"], answer: i % 4, explain: `Fact ${i}`, level: 1 });
const cards = (n: number) => Array.from({ length: n }, (_, i) => card(i));
const never = () => 0.99; // no road incidents
const start = (n = 10, sectionId = "germany") =>
  newJourney({ code: "0977", sectionId, topicId: "weimar", topicTitle: "Was the Weimar Republic doomed?", cards: cards(n) }, () => 0.3);

const right = (s: JourneyState) => answerCard(s, currentCard(s).answer);
const wrong = (s: JourneyState) => answerCard(s, (currentCard(s).answer + 1) % 4);

/** Answer, press on and take the local train (or whatever is affordable), until the end. */
function playThrough(s: JourneyState, answer: (s: JourneyState) => JourneyState) {
  for (let guard = 0; guard < 100; guard++) {
    s = answer(s);
    if (s.phase === "ended") return s;
    s = continueFromOutcome(s);
    if (s.phase === "ended") return s;
    if (s.phase === "scene") continue; // a follow-up card at the same stop
    s = chooseCamp(s, "move");
    const mode = travelChoices(s).find((m) => m.id === "local" && !m.disabled) ?? travelChoices(s).find((m) => !m.disabled)!;
    s = chooseTravel(s, mode.id, never);
    if (s.phase === "ended") return s;
  }
  throw new Error("Journey never ended");
}

describe("journey setup", () => {
  it("uses the section's route and ends at its destination", () => {
    const s = start();
    expect(s.stops).toEqual(SETTINGS.germany.route);
    expect(s.stops.at(-1)).toBe("Berlin");
    expect(sceneText(s)).toContain("Munich");
    expect(s.plan.at(-1)?.scene).toBe("front-page");
    expect(new Set(s.plan.map((p) => p.scene)).size).toBe(10);
    expect(s.plan.every((p) => p.cards.length === 1)).toBe(true); // 10 cards: no follow-ups
  });

  it("shortens the route (keeping the destination) when there are fewer cards", () => {
    const s = start(6, "russia");
    expect(s.stops).toHaveLength(6);
    expect(s.stops.at(-1)).toBe("Moscow");
    expect(s.cards).toHaveLength(6);
  });

  it("refuses a run with too few cards", () => {
    expect(() => start(2)).toThrow();
  });

  it("falls back to a general route for sections without a setting", () => {
    expect(start(10, "unknown").stops).toHaveLength(10);
  });
});

describe("playing", () => {
  it("a right answer scores and raises trust; a wrong one lowers it", () => {
    const s = start();
    const good = right(s);
    expect(good.score).toBe(100);
    expect(good.answers[0].correct).toBe(true);
    const bad = wrong(s);
    expect(bad.score).toBe(0);
    expect(bad.answers[0].correct).toBe(false);
    expect(bad.streak).toBe(0);
  });

  it("a contact rules out two wrong answers and halves the points", () => {
    let s = askContact(start(), () => 0.1);
    expect(s.res.contacts).toBe(0);
    expect(s.ruledOut).toHaveLength(2);
    expect(s.ruledOut).not.toContain(currentCard(s).answer);
    expect(answerCard(s, s.ruledOut![0])).toBe(s); // can't pick a ruled-out answer
    s = right(s);
    expect(s.score).toBe(50);
    expect(askContact({ ...s, phase: "scene" })).toEqual({ ...s, phase: "scene" }); // none left
  });

  it("all right answers on time lands the front page with a bonus", () => {
    const s = playThrough(start(), right);
    expect(s.phase).toBe("ended");
    expect(s.ending?.kind).toBe("front-page");
    expect(s.ending?.late).toBe(false);
    expect(s.answers).toHaveLength(10);
    expect(s.score).toBeGreaterThan(1000);
  });

  it("too many wrong answers ends the run early (recalled, or broke and worn out)", () => {
    const s = playThrough(start(), wrong);
    expect(["recalled", "sent-home"]).toContain(s.ending?.kind);
    expect(s.ending?.onRoute).toBe(true);
    expect(s.answers.length).toBeLessThan(10);
  });

  it("running out of energy sends him home", () => {
    let s = start();
    s = { ...s, res: { ...s.res, stamina: 1 }, plan: [{ scene: "briefing", cards: [0] }, ...s.plan.slice(1)] };
    s = wrong(s);
    expect(s.ending?.kind).toBe("sent-home");
  });

  it("arriving late knocks the ending down a level", () => {
    let s = start(3);
    s = { ...s, deadline: 0 };
    s = playThrough(s, right);
    expect(daysLeft(s)).toBeLessThan(0);
    expect(s.ending?.late).toBe(true);
    expect(s.ending?.kind).not.toBe("front-page");
  });
});

describe("camp and travel", () => {
  const atCamp = () => continueFromOutcome(right(start()));

  it("resting costs money and a day and restores energy", () => {
    const s = chooseCamp(atCamp(), "rest");
    expect(s.phase).toBe("travel");
    expect(s.res.stamina).toBe(5);
    expect(s.res.day).toBe(1);
  });

  it("disables choices he can't afford, but never leaves him stuck", () => {
    let s = atCamp();
    s = { ...s, res: { ...s.res, funds: 0, stamina: 1 } };
    expect(campChoices(s).find((c) => c.id === "rest")?.disabled).toBeTruthy();
    expect(campChoices(s).find((c) => c.id === "work")?.disabled).toBeTruthy();
    s = chooseCamp(s, "move");
    const modes = travelChoices(s);
    expect(modes.find((m) => m.id === "express")?.disabled).toBeTruthy();
    expect(modes.some((m) => !m.disabled)).toBe(true);
  });

  it("travel moves to the next stop and can bring a road incident", () => {
    const s = chooseCamp(atCamp(), "move");
    const quiet = chooseTravel(s, "express", never);
    expect(quiet.stop).toBe(1);
    expect(quiet.phase).toBe("scene");
    expect(quiet.res.funds).toBe(s.res.funds - 3);
    const eventful = chooseTravel(s, "hitch", () => 0.01);
    expect(eventful.phase).toBe("incident");
    expect(eventful.message).not.toBe("");
    expect(continueFromIncident(eventful).phase).toBe("scene");
  });
});

describe("desks and scenes", () => {
  it("gives every subject its own setting and desk", () => {
    const sci = newJourney({ code: "0973", sectionId: "physics", topicId: "x", topicTitle: "t", cards: cards(10) }, () => 0.3);
    expect(sci.desk).toBe("science");
    expect(sci.stops).toEqual(SUBJECT_SETTINGS["0973"].route);
    expect(start().desk).toBe("history");
  });

  it("only uses scenes that suit the desk, and every scene has a unique id", () => {
    expect(new Set(SCENES.map((x) => x.id)).size).toBe(SCENES.length);
    for (const desk of ["history", "science", "tech", "data"] as const) {
      const pool = scenePool(desk);
      expect(pool.length).toBeGreaterThanOrEqual(25);
      expect(pool.every((x) => !x.desks || x.desks.includes(desk))).toBe(true);
    }
  });

  it("picks unseen scenes first, and starts a new cycle when they run out", () => {
    const pool = ["a", "b", "c", "d", "e"];
    const first = pickScenes(pool, 3, []);
    expect(new Set(first.ids).size).toBe(3);
    const second = pickScenes(pool, 3, first.seen);
    // the two unseen ones are used, plus one from the old cycle
    expect(second.ids.filter((id) => !first.ids.includes(id))).toHaveLength(2);
    expect(second.seen).toHaveLength(1);
    // fresh runs in a row don't repeat a scene until the pool is used up
    let seen: string[] = [];
    const used: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = newJourney({ code: "0977", sectionId: "germany", topicId: "w", topicTitle: "t", cards: cards(10), seen });
      seen = r.seenScenes;
      used.push(...r.plan.slice(0, -1).map((p) => p.scene));
    }
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("two-part stops", () => {
  const twoPart = () => newJourney({ code: "0977", sectionId: "germany", topicId: "w", topicTitle: "t", cards: cards(13) }, () => 0.3);

  it("uses spare cards as follow-ups in the middle of the route", () => {
    const s = twoPart();
    expect(s.plan).toHaveLength(10);
    expect(s.plan.filter((p) => p.cards.length === 2)).toHaveLength(3);
    expect(s.plan[0].cards).toHaveLength(1);
    expect(s.plan.at(-1)?.cards).toEqual([12]); // the final stop gets the last (hardest) card
    expect(s.plan.flatMap((p) => p.cards)).toEqual([...Array(13).keys()]);
  });

  function toTwoPart(s: JourneyState) {
    const at = s.plan.findIndex((p) => p.cards.length === 2);
    return { ...s, stop: at };
  }

  it("asks the follow-up, and gives a scoop bonus for both right", () => {
    let s = toTwoPart(twoPart());
    const trust = s.res.trust;
    s = right(s);
    expect(s.phase).toBe("outcome");
    expect(s.delta).toEqual({});
    s = continueFromOutcome(s);
    expect(s.phase).toBe("scene");
    expect(s.step).toBe(1);
    expect(sceneText(s)).toMatch(/one more detail/);
    s = right(s);
    expect(s.message).toMatch(/scoop/);
    expect(s.res.trust).toBeGreaterThan(trust);
    expect(continueFromOutcome(s).phase).toBe("camp");
  });

  it("half right changes nothing", () => {
    let s = toTwoPart(twoPart());
    const before = s.res;
    s = continueFromOutcome(right(s));
    s = wrong(s);
    expect(s.message).toMatch(/Half right/);
    expect(s.res).toEqual(before);
  });

  it("all right through a run with follow-ups still lands the front page", () => {
    const s = playThrough(twoPart(), right);
    expect(s.answers).toHaveLength(13);
    expect(s.ending?.kind).toBe("front-page");
  });
});

describe("saving", () => {
  it("round-trips a run in progress and rejects finished or broken ones", () => {
    const s = right(start());
    expect(parseSave(JSON.stringify(s))).toEqual(s);
    expect(parseSave(JSON.stringify(playThrough(start(), right)))).toBeNull();
    expect(parseSave("{oops")).toBeNull();
    expect(parseSave(JSON.stringify({ ...s, cards: [] }))).toBeNull();
    expect(parseSave(null)).toBeNull();
  });

  it("upgrades a run saved by the first version", () => {
    const { plan, step, desk, seenScenes, ...rest } = right(start());
    void step; void desk; void seenScenes;
    const v1 = { ...rest, v: 1, sceneIds: plan.map((p) => p.scene) };
    const s = parseSave(JSON.stringify(v1));
    expect(s?.v).toBe(2);
    expect(s?.plan).toEqual(plan);
    expect(s?.desk).toBe("history");
  });
});
