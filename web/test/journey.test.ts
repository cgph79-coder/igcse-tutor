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
  sceneText,
  travelChoices,
  type JourneyState,
} from "../src/games/journey-core";
import { SETTINGS } from "../src/games/journey-content";

const card = (i: number): McqQuestion => ({ q: `Q${i}?`, options: ["a", "b", "c", "d"], answer: i % 4, explain: `Fact ${i}`, level: 1 });
const cards = (n: number) => Array.from({ length: n }, (_, i) => card(i));
const never = () => 0.99; // no road incidents
const start = (n = 10, sectionId = "germany") =>
  newJourney({ code: "0977", sectionId, topicId: "weimar", topicTitle: "Was the Weimar Republic doomed?", cards: cards(n) }, () => 0.3);

const right = (s: JourneyState) => answerCard(s, currentCard(s).answer);
const wrong = (s: JourneyState) => answerCard(s, (currentCard(s).answer + 1) % 4);

/** Answer, press on and take the local train, until the last stop. */
function playThrough(s: JourneyState, answer: (s: JourneyState) => JourneyState) {
  for (;;) {
    s = answer(s);
    if (s.phase === "ended") return s;
    s = continueFromOutcome(s);
    if (s.phase === "ended") return s;
    s = chooseCamp(s, "move");
    s = chooseTravel(s, "local", never);
  }
}

describe("journey setup", () => {
  it("uses the section's route and ends at its destination", () => {
    const s = start();
    expect(s.stops).toEqual(SETTINGS.germany.route);
    expect(s.stops.at(-1)).toBe("Berlin");
    expect(sceneText(s)).toContain("Munich");
    expect(s.sceneIds.at(-1)).toBe("front-page");
    expect(new Set(s.sceneIds).size).toBe(10);
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

  it("too many wrong answers gets him recalled before the end", () => {
    const s = playThrough(start(), wrong);
    expect(s.ending?.kind).toBe("recalled");
    expect(s.ending?.onRoute).toBe(true);
    expect(s.answers.length).toBeLessThan(10);
  });

  it("running out of energy sends him home", () => {
    let s = start();
    s = { ...s, res: { ...s.res, stamina: 1 }, sceneIds: ["briefing", ...s.sceneIds.slice(1)] };
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

describe("saving", () => {
  it("round-trips a run in progress and rejects finished or broken ones", () => {
    const s = right(start());
    expect(parseSave(JSON.stringify(s))).toEqual(s);
    expect(parseSave(JSON.stringify(playThrough(start(), right)))).toBeNull();
    expect(parseSave("{oops")).toBeNull();
    expect(parseSave(JSON.stringify({ ...s, cards: [] }))).toBeNull();
    expect(parseSave(null)).toBeNull();
  });
});
