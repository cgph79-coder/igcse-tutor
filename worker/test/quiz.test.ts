import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { bankKey, buildRound, parseQuestions, parseVerdicts, shuffleOptions, validateQuestion, type McqQuestion } from "../src/quiz";
import { makeCtx, makeEnv, MemoryKV, sseBody } from "./helpers";

const ORIGIN = "https://site.example";

function req(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  return new Request(`https://worker.example${path}`, { ...init, headers });
}

async function login(env: ReturnType<typeof makeEnv>) {
  const { ctx } = makeCtx();
  const res = await worker.fetch(
    req("/api/login", { method: "POST", body: JSON.stringify({ passcode: "let-me-in" }) }),
    env as never,
    ctx,
  );
  return ((await res.json()) as { token: string }).token;
}

const q = (i: number, extra: Record<string, unknown> = {}) => ({
  q: `Question number ${i}?`,
  options: [`right ${i}`, `wrong a${i}`, `wrong b${i}`, `wrong c${i}`],
  answer: 0,
  explain: "Because.",
  ...extra,
});

const reply = (n: number) => JSON.stringify({ questions: Array.from({ length: n }, (_, i) => q(i)) });
/** Checker reply: passes every card except the listed indices. */
const verdicts = (n: number, reject: number[] = []) =>
  JSON.stringify({ verdicts: Array.from({ length: n }, (_, i) => ({ i, ok: !reject.includes(i), ...(reject.includes(i) ? { reason: "wrong" } : {}) })) });
/** Mock model: the first call writes cards, the second checks them. */
function twoStepModel(cardsText: string, checkText: string) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const isCheck = String(body.messages[0].content).includes("checking revision cards");
    return new Response(sseBody([isCheck ? checkText : cardsText]), { status: 200 });
  });
}
const quizBody = JSON.stringify({ code: "0606", topicId: "series", count: 10 });

afterEach(() => vi.unstubAllGlobals());

describe("question validation", () => {
  it("accepts a well-formed question", () => {
    expect(validateQuestion(q(1))).toMatchObject({ answer: 0, options: expect.arrayContaining(["right 1"]) });
  });

  it("rejects bad shapes", () => {
    expect(validateQuestion(q(1, { options: ["a", "b", "c"] }))).toBeNull();
    expect(validateQuestion(q(1, { answer: 4 }))).toBeNull();
    expect(validateQuestion(q(1, { answer: "x" }))).toBeNull();
    expect(validateQuestion(q(1, { options: ["a", "A", "b", "c"] }))).toBeNull();
    expect(validateQuestion(q(1, { options: ["a", "b", "c", "All of the above"] }))).toBeNull();
    expect(validateQuestion(q(1, { q: "x".repeat(400) }))).toBeNull();
    expect(validateQuestion(null)).toBeNull();
  });

  it("rejects cards that don't suit quick recall", () => {
    expect(validateQuestion(q(1, { q: "Which of these is not a vector?" }))).toBeNull();
    expect(validateQuestion(q(1, { q: "All are forces EXCEPT" }))).toBeNull();
    expect(validateQuestion(q(1, { q: "True or false: friction is a force?" }))).toBeNull();
    expect(validateQuestion(q(1, { q: "x".repeat(170) }))).toBeNull();
    expect(validateQuestion(q(1, { options: ["a".repeat(61), "b", "c", "d"] }))).toBeNull();
    // Ordinary uses of "not" are fine.
    expect(validateQuestion(q(1, { q: "A force that does not need contact is" }))).not.toBeNull();
  });

  it("parses JSON wrapped in a code fence and drops invalid or duplicate items", () => {
    const text = "```json\n" + JSON.stringify({ questions: [q(1), q(1), q(2, { answer: 9 }), q(3)] }) + "\n```";
    expect(parseQuestions(text).map((x) => x.q)).toEqual(["Question number 1?", "Question number 3?"]);
    expect(parseQuestions("not json")).toEqual([]);
  });

  it("reads the card level, defaulting to 2", () => {
    expect(validateQuestion(q(1, { level: 3 }))!.level).toBe(3);
    expect(validateQuestion(q(1))!.level).toBe(2);
    expect(validateQuestion(q(1, { level: 7 }))!.level).toBe(2);
  });

  it("builds a round that mixes levels and goes easiest first", () => {
    const pool = Array.from({ length: 30 }, (_, i) => ({ ...validateQuestion(q(i))!, level: ((i % 3) + 1) as McqQuestion["level"] }));
    const round = buildRound(pool, 10);
    expect(round).toHaveLength(10);
    expect(new Set(round.map((x) => x.q)).size).toBe(10);
    expect(round.map((x) => x.level)).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
    // Short on one level: still a full round, still in order.
    const lopsided = buildRound(pool.filter((x) => x.level !== 3), 10);
    expect(lopsided).toHaveLength(10);
    expect(lopsided.map((x) => x.level)).toEqual([...lopsided.map((x) => x.level)].sort());
  });

  it("reads checker verdicts, treating anything unclear as a reject", () => {
    expect([...parseVerdicts(verdicts(4, [1]), 4)!].sort()).toEqual([0, 2, 3]);
    // Missing verdicts, out-of-range indices and non-boolean "ok" don't pass a card.
    expect([...parseVerdicts('{"verdicts":[{"i":0,"ok":true},{"i":9,"ok":true},{"i":2,"ok":"yes"}]}', 4)!]).toEqual([0]);
    expect(parseVerdicts("I think they're fine", 4)).toBeNull();
    expect(parseVerdicts('{"questions":[]}', 4)).toBeNull();
  });

  it("keeps the correct answer when shuffling", () => {
    for (let i = 0; i < 20; i++) {
      const s = shuffleOptions(validateQuestion(q(1))!);
      expect(s.options[s.answer]).toBe("right 1");
    }
  });
});

describe("POST /api/quiz-questions", () => {
  it("requires a token", async () => {
    const env = makeEnv();
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/quiz-questions", { method: "POST", body: quizBody }), env as never, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects an unknown topic", async () => {
    const env = makeEnv();
    const token = await login(env);
    const { ctx } = makeCtx();
    const res = await worker.fetch(
      req("/api/quiz-questions", { method: "POST", token, body: JSON.stringify({ code: "0606", topicId: "nope" }) }),
      env as never,
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("generates, validates, banks and counts usage", async () => {
    const env = makeEnv();
    const token = await login(env);
    const fetchMock = twoStepModel("```json\n" + reply(15) + "\n```", verdicts(15, [2, 7]));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/quiz-questions", { method: "POST", token, body: quizBody }), env as never, ctx);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { questions: Array<{ q: string; options: string[]; answer: number }>; source: string };
    expect(data.source).toBe("new");
    expect(data.questions).toHaveLength(10);
    for (const x of data.questions) expect(x.options[x.answer]).toMatch(/^right/);
    // Rejected cards are never served or saved.
    const rejected = ["Question number 2?", "Question number 7?"];
    expect(data.questions.some((x) => rejected.includes(x.q))).toBe(false);

    const kv = env.TUTOR_KV as unknown as MemoryKV;
    const banked = JSON.parse(kv.store.get(bankKey("0606", null, "series"))!.value) as Array<{ q: string }>;
    expect(banked).toHaveLength(13);
    expect(banked.some((x) => rejected.includes(x.q))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const usageKey = [...kv.store.keys()].find((k) => k.startsWith("usage:"))!;
    expect(JSON.parse(kv.store.get(usageKey)!.value).requests).toBe(1);

    // The prompt names the topic and asks for JSON only.
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.messages[0].content).toContain("Series");
    expect(sent.messages[0].content).toContain("ONLY this JSON");
    expect(sent.messages[0].content).toContain("flashcards");
  });

  it("serves unchecked cards once but never saves them if the checker reply is unusable", async () => {
    const env = makeEnv();
    const token = await login(env);
    vi.stubGlobal("fetch", twoStepModel(reply(15), "Looks good to me!"));
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/quiz-questions", { method: "POST", token, body: quizBody }), env as never, ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { questions: unknown[] }).questions).toHaveLength(10);
    const kv = env.TUTOR_KV as unknown as MemoryKV;
    expect(kv.store.get(bankKey("0606", null, "series"))).toBeUndefined();
  });

  it("returns 502 when the model's reply is unusable", async () => {
    const env = makeEnv();
    const token = await login(env);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseBody(["Sorry, I can't."]), { status: 200 })));
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/quiz-questions", { method: "POST", token, body: quizBody }), env as never, ctx);
    expect(res.status).toBe(502);
  });

  it("serves from the bank when over the daily limit", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1" });
    const token = await login(env);
    const kv = env.TUTOR_KV as unknown as MemoryKV;
    await kv.put(bankKey("0606", null, "series"), JSON.stringify(Array.from({ length: 8 }, (_, i) => q(i))));
    const usageDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    await kv.put(`usage:student:${usageDay}`, JSON.stringify({ requests: 5, tokens: 0 }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/quiz-questions", { method: "POST", token, body: quizBody }), env as never, ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { source: string }).source).toBe("bank");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
