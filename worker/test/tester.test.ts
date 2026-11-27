import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { makeCtx, makeEnv, sseBody } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

function req(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", "https://site.example");
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  return new Request(`https://worker.example${path}`, { ...init, headers });
}

async function call(env: ReturnType<typeof makeEnv>, path: string, init: RequestInit & { token?: string } = {}) {
  const { ctx } = makeCtx();
  return worker.fetch(req(path, init), env as never, ctx);
}

const loginWith = (env: ReturnType<typeof makeEnv>, passcode: string) =>
  call(env, "/api/login", { method: "POST", body: JSON.stringify({ passcode }) });

describe("tester login", () => {
  it("is off unless TESTER_PASSCODE is set", async () => {
    const env = makeEnv();
    expect((await loginWith(env, "tester-pass")).status).toBe(401);
    expect(await (await loginWith(env, "let-me-in")).json()).toMatchObject({ user: "student" });
  });

  it("logs in as a separate user whose career doesn't touch the student's", async () => {
    const env = makeEnv({ TESTER_PASSCODE: "tester-pass" });
    const tester = (await (await loginWith(env, "tester-pass")).json()) as { token: string; user: string };
    expect(tester.user).toBe("tester");
    expect((await loginWith(env, "wrong")).status).toBe(401);

    const now = new Date().toISOString();
    const career = { v: 1, started: now, updated: now, topics: { "0977:weimar": { grade: 3, runs: 3, last: now, lastScore: 1 } } };
    await call(env, "/api/career", { method: "POST", token: tester.token, body: JSON.stringify({ career }) });

    const student = (await (await loginWith(env, "let-me-in")).json()) as { token: string };
    expect(await (await call(env, "/api/career", { token: student.token })).json()).toEqual({ career: null });
    const parent = (await (await call(env, "/api/parent/login", { method: "POST", body: JSON.stringify({ password: "parent-pass" }) })).json()) as { token: string };
    const view = (await (await call(env, "/api/parent/sessions", { token: parent.token })).json()) as { career: unknown };
    expect(view.career).toBeNull(); // the parent view shows the student's career only
  });

  it("can open the Editor's desk on any topic", async () => {
    const env = makeEnv({ TESTER_PASSCODE: "tester-pass", DAILY_REQUEST_LIMIT: "50" });
    const questions = Array.from({ length: 3 }, (_, i) => ({ q: `Q${i}`, marks: 2, command: "state", scheme: ["a", "b"], model: "m" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseBody([JSON.stringify({ questions })]), { status: 200 })));
    const body = JSON.stringify({ code: "0606", topicId: "functions" });
    const tester = (await (await loginWith(env, "tester-pass")).json()) as { token: string };
    expect((await call(env, "/api/exam/start", { method: "POST", token: tester.token, body })).status).toBe(200);
    const student = (await (await loginWith(env, "let-me-in")).json()) as { token: string };
    expect((await call(env, "/api/exam/start", { method: "POST", token: student.token, body })).status).toBe(403);
  });
});
