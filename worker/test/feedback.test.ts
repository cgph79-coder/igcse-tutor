import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { cleanContext } from "../src/feedback";
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

const send = (env: ReturnType<typeof makeEnv>, token: string, body: unknown) =>
  call(env, "/api/feedback", { method: "POST", token, body: JSON.stringify(body) });

interface Item {
  id: string;
  area: string;
  text: string;
  context?: Record<string, string>;
  redactions?: string[];
  flag?: string;
}

describe("in-app feedback", () => {
  it("requires the student token to send and the parent token to read", async () => {
    const env = makeEnv();
    expect((await call(env, "/api/feedback", { method: "POST", body: JSON.stringify({ area: "arcade", text: "hello" }) })).status).toBe(401);
    const student = await login(env);
    expect((await call(env, "/api/parent/feedback", { token: student })).status).toBe(401);
  });

  it("validates the area and length", async () => {
    const env = makeEnv();
    const token = await login(env);
    expect((await send(env, token, { area: "nope", text: "too fast" })).status).toBe(400);
    expect((await send(env, token, { area: "arcade", text: "x" })).status).toBe(400);
    expect((await send(env, token, { area: "arcade", text: "x".repeat(501) })).status).toBe(400);
  });

  it("stores privacy-filtered feedback with app context and shows it to the parent, newest first", async () => {
    const env = makeEnv();
    const token = await login(env);
    expect((await send(env, token, { area: "arcade", text: "Rocks are too fast on level 3" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 5)); // distinct timestamps, so "newest first" is well defined
    expect(
      (await send(env, token, {
        area: "tutor",
        text: "My name is Zebedee and the answer about AP was wrong, email z@x.com",
        context: { build: "abc123", view: "chat", code: "0606", topic: "Series", conversation: "should be dropped" },
      })).status,
    ).toBe(200);

    const parent = await login(env, true);
    const res = await call(env, "/api/parent/feedback", { token: parent });
    const { feedback } = (await res.json()) as { feedback: Item[] };
    expect(feedback).toHaveLength(2);
    expect(feedback[0].area).toBe("tutor"); // newest first
    expect(feedback[0].text).not.toMatch(/Zebedee|z@x\.com/);
    expect(feedback[0].redactions?.length).toBeGreaterThan(0);
    expect(feedback[0].context).toEqual({ build: "abc123", view: "chat", code: "0606", subject: "Additional Mathematics", topic: "Series" });

    // Clearing an item once it's in the log.
    const done = await call(env, "/api/parent/feedback/done", { method: "POST", token: parent, body: JSON.stringify({ id: feedback[0].id }) });
    expect(done.status).toBe(200);
    const after = (await (await call(env, "/api/parent/feedback", { token: parent })).json()) as { feedback: Item[] };
    expect(after.feedback.map((f) => f.area)).toEqual(["arcade"]);
    expect((await call(env, "/api/parent/feedback/done", { method: "POST", token: parent, body: JSON.stringify({ id: "../usage" }) })).status).toBe(400);
  });

  it("flags wellbeing words for the parent", async () => {
    const env = makeEnv();
    const token = await login(env);
    await send(env, token, { area: "other", text: "I'm so stressed about exams, the timer helps" });
    const parent = await login(env, true);
    const { feedback } = (await (await call(env, "/api/parent/feedback", { token: parent })).json()) as { feedback: Item[] };
    expect(feedback[0].flag).toBe("wellbeing");
  });

  it("caps feedback per day", async () => {
    const env = makeEnv();
    const token = await login(env);
    for (let i = 0; i < 20; i++) expect((await send(env, token, { area: "other", text: `note number ${i}` })).status).toBe(200);
    expect((await send(env, token, { area: "other", text: "one more note" })).status).toBe(429);
  });

  it("keeps only known context fields", () => {
    expect(cleanContext({ code: "9999", topic: "  Forces  ", extra: "x" })).toEqual({ topic: "Forces" });
    expect(cleanContext("nope")).toBeUndefined();
  });
});
