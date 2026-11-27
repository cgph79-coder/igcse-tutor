import { describe, expect, it } from "vitest";
import {
  cleanCareer,
  coverage,
  emptyCareer,
  followUps,
  levelFor,
  mergeCareers,
  nextRankNeeds,
  rankOf,
  recordRun,
  topicsByCode,
  weeksUntil,
  type Career,
} from "../../shared/career";

const T0 = new Date("2026-12-01T10:00:00Z");
const run = (c: Career, code: string, topicId: string, got: number, opts: { total?: number; finished?: boolean; now?: Date } = {}) =>
  recordRun(c, { code, topicId, level: levelFor(c, code, topicId), got, total: opts.total ?? 10, finished: opts.finished ?? true }, opts.now ?? T0);

/** Clear the first n topics of a subject up to a grade. */
function clear(c: Career, code: string, n: number, grade = 1): Career {
  for (const id of topicsByCode()[code].slice(0, n)) for (let g = 0; g < grade; g++) c = run(c, code, id, 10).career;
  return c;
}

describe("grades and levels", () => {
  it("starts each topic at level 1 and moves up one level per cleared run", () => {
    let c = emptyCareer(T0);
    expect(levelFor(c, "0977", "weimar")).toBe(1);
    const r1 = run(c, "0977", "weimar", 8);
    expect(r1.cleared).toBe(true);
    expect(r1.newGrade).toBe(1);
    c = r1.career;
    expect(levelFor(c, "0977", "weimar")).toBe(2);
    c = run(c, "0977", "weimar", 9).career;
    c = run(c, "0977", "weimar", 10).career;
    expect(levelFor(c, "0977", "weimar")).toBe(3); // stays at 3 once mastered
    expect(c.topics["0977:weimar"]).toMatchObject({ grade: 3, runs: 3, lastScore: 1 });
  });

  it("doesn't clear a level below 80%, or when the run ended early", () => {
    const c = emptyCareer(T0);
    expect(run(c, "0977", "weimar", 7).cleared).toBe(false);
    expect(run(c, "0977", "weimar", 9, { finished: false }).cleared).toBe(false);
    expect(run(c, "0977", "weimar", 0, { total: 0 }).cleared).toBe(false);
    expect(run(c, "0977", "weimar", 7).career.topics["0977:weimar"]).toMatchObject({ grade: 0, runs: 1, lastScore: 0.7 });
  });
});

describe("ranks", () => {
  it("needs breadth across subjects to be promoted", () => {
    let c = emptyCareer(T0);
    expect(rankOf(c)).toBe("Cub reporter");
    c = clear(c, "0977", 10);
    expect(rankOf(c)).toBe("Cub reporter"); // 10 topics, but only one subject
    expect(nextRankNeeds(c)?.text).toMatch(/in at least 2 subjects \(1 so far\)/);
    const r = run(c, "0606", topicsByCode()["0606"][0], 10);
    expect(r.promotedTo).toBe("Staff reporter");
    c = r.career;
    // Senior: 20 topics at ★★ with at least 2 in every subject
    for (const code of ["0977", "0973", "0984", "0606"]) c = clear(c, code, 5, 2);
    expect(rankOf(c)).toBe("Senior correspondent");
    for (const code of ["0977", "0973", "0984", "0606"]) c = clear(c, code, 8, 3);
    expect(rankOf(c)).toBe("Editor");
    expect(nextRankNeeds(c)).toBeNull();
  });
});

describe("merging device and Worker copies", () => {
  it("keeps the highest grade and the most recent score", () => {
    const a = run(emptyCareer(T0), "0977", "weimar", 10, { now: new Date("2026-12-02T10:00:00Z") }).career;
    const b = run(emptyCareer(new Date("2026-11-20T10:00:00Z")), "0977", "weimar", 3, { now: new Date("2026-12-05T10:00:00Z") }).career;
    const m = mergeCareers(a, b);
    expect(m.topics["0977:weimar"]).toMatchObject({ grade: 1, lastScore: 0.3 });
    expect(m.started).toBe(b.started);
    expect(mergeCareers(b, a)).toEqual(m); // order doesn't matter
    expect(mergeCareers(null, a)).toBe(a);
  });

  it("cleans bad data", () => {
    expect(cleanCareer(null)).toBeNull();
    expect(cleanCareer({ v: 2, topics: {} })).toBeNull();
    const c = cleanCareer({
      v: 1, started: "nonsense", updated: T0.toISOString(),
      topics: {
        "0977:weimar": { grade: 2, runs: 3, last: T0.toISOString(), lastScore: 5 },
        "0977:made-up": { grade: 1, runs: 1, last: T0.toISOString(), lastScore: 1 },
        "0606:functions": { grade: 7, runs: 1, last: T0.toISOString(), lastScore: 1 },
      },
    }, T0)!;
    expect(Object.keys(c.topics)).toEqual(["0977:weimar"]);
    expect(c.topics["0977:weimar"].lastScore).toBe(1);
    expect(c.started).toBe(T0.toISOString());
  });
});

describe("follow-ups and pacing", () => {
  it("flags topics that went badly a couple of days ago", () => {
    let c = run(emptyCareer(T0), "0977", "weimar", 3).career;
    c = run(c, "0977", "nazi-rise", 5).career;
    c = run(c, "0977", "crash", 9).career;
    expect(followUps(c, new Date("2026-12-02T10:00:00Z"))).toEqual([]); // too soon
    expect(followUps(c, new Date("2026-12-04T10:00:00Z")).map((f) => f.topicId)).toEqual(["weimar", "nazi-rise"]);
  });

  it("shows coverage per subject and flags subjects falling behind the exam calendar", () => {
    let c = emptyCareer(new Date("2026-09-01T00:00:00Z"));
    c = clear(c, "0977", 12);
    const cov = coverage(c, "2027-05-01", new Date("2027-01-01T00:00:00Z"));
    const hist = cov.find((x) => x.code === "0977")!;
    expect(hist.atGrade).toEqual([12, 0, 0]);
    expect(hist.behind).toBe(false);
    expect(cov.find((x) => x.code === "0606")!.behind).toBe(true);
    expect(coverage(emptyCareer(T0), "2027-05-01", T0).some((x) => x.behind)).toBe(false); // no nagging at the start
    expect(weeksUntil("2027-05-01", new Date("2027-04-17T00:00:00Z"))).toBe(2);
  });
});
