import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/prompts/tutor";
import { findSyllabus, findTopic, SYLLABUSES } from "../../syllabus/index";

function setup(code: string, topicId: string) {
  const s = findSyllabus(code)!;
  const f = findTopic(s, topicId)!;
  return { syllabus: s, section: f.section, topic: f.topic };
}

describe("syllabus files", () => {
  it("load with unique topic ids", () => {
    expect(SYLLABUSES.map((s) => s.code).sort()).toEqual(["0606", "0973", "0977", "0984"]);
    for (const s of SYLLABUSES) {
      const ids = s.sections.flatMap((sec) => sec.topics.map((t) => t.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(3);
    }
  });
});

describe("tutor prompt", () => {
  it("fills in board, subject, code, tier, topic and mode", () => {
    const p = buildSystemPrompt({ ...setup("0973", "c-stoichiometry"), tier: "Extended", mode: "learn" });
    expect(p).toContain("Cambridge International Co-ordinated Sciences (Double Award) (0973)");
    expect(p).toContain("Extended tier");
    expect(p).toContain("Stoichiometry");
    expect(p).toContain("LEARN mode");
    expect(p).toContain("0800 1111");
  });

  it("includes Extended-only content only for Extended", () => {
    const ext = buildSystemPrompt({ ...setup("0973", "c-stoichiometry"), tier: "Extended", mode: "learn" });
    const core = buildSystemPrompt({ ...setup("0973", "c-stoichiometry"), tier: "Core", mode: "learn" });
    expect(ext).toContain("The mole");
    expect(core).not.toContain("The mole");
  });

  it("describes single-tier subjects as single tier", () => {
    const p = buildSystemPrompt({ ...setup("0606", "series"), tier: null, mode: "quiz", quizLength: 6 });
    expect(p).toContain("single tier");
    expect(p).toContain("6 short, original");
    expect(p).toContain("[[SCORE:");
  });

  it("uses practise settings", () => {
    const p = buildSystemPrompt({
      ...setup("0984", "boolean-logic"),
      tier: null,
      mode: "practise",
      difficulty: "challenging",
      commandWord: "describe",
    });
    expect(p).toContain("challenging difficulty");
    expect(p).toContain('"describe"');
    expect(p).toContain("pseudocode");
  });

  it("uses level-based marking for History", () => {
    const p = buildSystemPrompt({ ...setup("0977", "weimar"), tier: null, mode: "mark" });
    expect(p).toContain("LEVELS");
    expect(p).toContain("Germany, 1918–45");
  });
});
