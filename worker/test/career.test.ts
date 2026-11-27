import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { buildLevelRound, type McqQuestion } from "../src/quiz";
import { emptyCareer, recordRun } from "../../shared/career";
import { makeCtx, makeEnv } from "./helpers";

const ORIGIN = "https://site.example";

function req(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  return new Request(`https://worker.example${path}`, { ...init, headers });
}

async function call(env: ReturnType<typeof makeEnv>, path: string, init: RequestInit & { token?: string } = {}) {
  const { ctx } = makeCtx();
  return worker.fetch(req(path, init), env as never, ctx);
}

async function login(env: ReturnType<typeof makeEnv>, parent = false) {
  const res = await call(env, parent ? "/api/parent/login" : "/api/login", {
    method: "POST",
    body: JSON.stringify(parent ? { password: "parent-pass" } : { passcode: "let-me-in" }),
  });
  return ((await res.json()) as { token: string }).token;
}

const played = (code: string, topicId: string, got: number) =>
  recordRun(emptyCareer(), { code, topicId, level: 1, got, total: 10, finished: true }).career;

describe("career storage", () => {
  it("requires the student token", async () => {
    const env = makeEnv();
    expect((await call(env, "/api/career")).status).toBe(401);
    const parent = await login(env, true);
    expect((await call(env, "/api/career", { token: parent })).status).toBe(401);
  });

  it("saves, merges copies from two devices without losing progress, and shows the parent", async () => {
    const env = makeEnv();
    const token = await login(env);
    expect(await (await call(env, "/api/career", { token })).json()).toEqual({ career: null });

    const phone = played("0977", "weimar", 9);
    const laptop = played("0606", "functions", 10);
    let res = await call(env, "/api/career", { method: "POST", token, body: JSON.stringify({ career: phone }) });
    expect(res.status).toBe(200);
    res = await call(env, "/api/career", { method: "POST", token, body: JSON.stringify({ career: laptop }) });
    const merged = ((await res.json()) as { career: { topics: Record<string, { grade: number }> } }).career;
    expect(merged.topics["0977:weimar"].grade).toBe(1);
    expect(merged.topics["0606:functions"].grade).toBe(1);

    // an older copy with a lower grade can't undo progress
    const stale = played("0977", "weimar", 2);
    res = await call(env, "/api/career", { method: "POST", token, body: JSON.stringify({ career: stale }) });
    expect(((await res.json()) as { career: { topics: Record<string, { grade: number }> } }).career.topics["0977:weimar"].grade).toBe(1);

    const parent = await login(env, true);
    const view = (await (await call(env, "/api/parent/sessions", { token: parent })).json()) as { career: { topics: object } };
    expect(Object.keys(view.career.topics).sort()).toEqual(["0606:functions", "0977:weimar"]);
  });

  it("rejects things that aren't a career and drops unknown topics", async () => {
    const env = makeEnv();
    const token = await login(env);
    expect((await call(env, "/api/career", { method: "POST", token, body: JSON.stringify({ career: "hi" }) })).status).toBe(400);
    expect((await call(env, "/api/career", { method: "POST", token, body: JSON.stringify({ career: { v: 1, topics: { x: "y".repeat(70000) } } }) })).status).toBe(400);
    const odd = { ...emptyCareer(), topics: { "9999:nope": { grade: 3, runs: 1, last: new Date().toISOString(), lastScore: 1 } } };
    const res = await call(env, "/api/career", { method: "POST", token, body: JSON.stringify({ career: odd }) });
    expect(((await res.json()) as { career: { topics: object } }).career.topics).toEqual({});
  });
});

describe("level rounds", () => {
  const card = (i: number, level: 1 | 2 | 3): McqQuestion => ({ q: `Q${i}`, options: ["a", "b", "c", "d"], answer: 0, explain: "", level });
  const pool = [...Array.from({ length: 6 }, (_, i) => card(i, 1)), ...Array.from({ length: 4 }, (_, i) => card(10 + i, 2)), ...Array.from({ length: 6 }, (_, i) => card(20 + i, 3))];

  it("uses the asked level first, then the nearest (lower before higher)", () => {
    const r = buildLevelRound(pool, 8, 2);
    expect(r).toHaveLength(8);
    expect(r.filter((q) => q.level === 2)).toHaveLength(4);
    expect(r.filter((q) => q.level === 1)).toHaveLength(4);
    expect(r.filter((q) => q.level === 3)).toHaveLength(0);
    expect(buildLevelRound(pool, 6, 3).every((q) => q.level === 3)).toBe(true);
    expect(buildLevelRound(pool, 100, 1)).toHaveLength(16);
  });
});
