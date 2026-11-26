import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { cleanBlocks } from "../src/focus";
import { makeCtx, makeEnv } from "./helpers";

const ORIGIN = "https://site.example";

function req(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  return new Request(`https://worker.example${path}`, { ...init, headers });
}

async function login(env: ReturnType<typeof makeEnv>, parent = false) {
  const { ctx } = makeCtx();
  const res = await worker.fetch(
    req(parent ? "/api/parent/login" : "/api/login", {
      method: "POST",
      body: JSON.stringify(parent ? { password: "parent-pass" } : { passcode: "let-me-in" }),
    }),
    env as never,
    ctx,
  );
  return ((await res.json()) as { token: string }).token;
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

describe("focus block validation", () => {
  it("keeps good blocks and drops bad ones", () => {
    const now = new Date();
    const good = { at: minsAgo(30), minutes: 25, code: "0606" };
    expect(cleanBlocks([good], now)).toHaveLength(1);
    expect(cleanBlocks([{ ...good, minutes: 0 }], now)).toEqual([]);
    expect(cleanBlocks([{ ...good, minutes: 500 }], now)).toEqual([]);
    expect(cleanBlocks([{ ...good, code: "9999" }], now)).toEqual([]);
    expect(cleanBlocks([{ ...good, at: "yesterday" }], now)).toEqual([]);
    expect(cleanBlocks([{ ...good, at: minsAgo(-60) }], now)).toEqual([]); // in the future
    expect(cleanBlocks([{ ...good, at: minsAgo(60 * 24 * 10) }], now)).toEqual([]); // too old
    expect(cleanBlocks("nope", now)).toEqual([]);
  });
});

describe("POST /api/focus and the parent view", () => {
  it("requires the student token", async () => {
    const env = makeEnv();
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/focus", { method: "POST", body: JSON.stringify({ blocks: [] }) }), env as never, ctx);
    expect(res.status).toBe(401);
  });

  it("records daily totals once per block and shows them to the parent", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1" });
    const token = await login(env);
    const blocks = [
      { at: minsAgo(60), minutes: 25, code: "0606" },
      { at: minsAgo(30), minutes: 25, code: "0973" },
    ];
    const send = async () => {
      const { ctx } = makeCtx();
      const res = await worker.fetch(req("/api/focus", { method: "POST", token, body: JSON.stringify({ blocks }) }), env as never, ctx);
      return (await res.json()) as { saved: number };
    };
    expect(await send()).toEqual({ saved: 2 });
    expect(await send()).toEqual({ saved: 0 }); // resent: not double-counted

    const parent = await login(env, true);
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/parent/sessions", { token: parent }), env as never, ctx);
    const data = (await res.json()) as { focus: Array<{ day: string; minutes: number; blocks: number; subjects: Record<string, number> }> };
    expect(data.focus).toHaveLength(14);
    const total = data.focus.reduce((n, d) => n + d.minutes, 0);
    expect(total).toBe(50);
    const withTime = data.focus.filter((d) => d.minutes > 0);
    const subjects = Object.assign({}, ...withTime.map((d) => d.subjects));
    expect(Object.keys(subjects).sort()).toEqual(["Additional Mathematics", "Co-ordinated Sciences (Double Award)"]);
  });

  it("doesn't count towards the daily message limit", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1" });
    const token = await login(env);
    for (let i = 0; i < 3; i++) {
      const { ctx } = makeCtx();
      const res = await worker.fetch(
        req("/api/focus", { method: "POST", token, body: JSON.stringify({ blocks: [{ at: minsAgo(10 + i), minutes: 25, code: "0606" }] }) }),
        env as never,
        ctx,
      );
      expect(res.status).toBe(200);
    }
  });
});
