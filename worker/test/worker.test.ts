import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { makeCtx, makeEnv, MemoryKV, sseBody } from "./helpers";
import { assessSafety } from "../src/safety";
import { trimHistory } from "../src/history";

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

const chatBody = (content: string) =>
  JSON.stringify({
    sessionId: "session-1234",
    code: "0606",
    topicId: "series",
    mode: "learn",
    messages: [{ role: "user", content }],
  });

afterEach(() => vi.unstubAllGlobals());

describe("worker routes", () => {
  it("rejects a wrong passcode and accepts the right one", async () => {
    const env = makeEnv();
    const { ctx } = makeCtx();
    const bad = await worker.fetch(
      req("/api/login", { method: "POST", body: JSON.stringify({ passcode: "nope" }) }),
      env as never,
      ctx,
    );
    expect(bad.status).toBe(401);
    expect(await login(env)).toMatch(/\./);
  });

  it("blocks other origins", async () => {
    const env = makeEnv();
    const { ctx } = makeCtx();
    const r = new Request("https://worker.example/api/health", { headers: { Origin: "https://evil.example" } });
    expect((await worker.fetch(r, env as never, ctx)).status).toBe(403);
  });

  it("sets CORS headers for the allowed origin", async () => {
    const env = makeEnv();
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/health"), env as never, ctx);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("requires a token for chat", async () => {
    const env = makeEnv();
    const { ctx } = makeCtx();
    const res = await worker.fetch(req("/api/chat", { method: "POST", body: chatBody("hi") }), env as never, ctx);
    expect(res.status).toBe(401);
  });

  it("streams a reply, strips PII before the LLM, logs and counts usage", async () => {
    const env = makeEnv();
    const token = await login(env);
    const fetchMock = vi.fn(async () => new Response(sseBody(["Hello", " there"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, settle } = makeCtx();
    const res = await worker.fetch(
      req("/api/chat", { method: "POST", token, body: chatBody("my name is Zebedee, email z@x.com. What is an AP?") }),
      env as never,
      ctx,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    await settle();
    expect(text).toContain('"text":"Hello"');
    expect(text).toContain('"type":"done"');

    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const userMsg = sent.messages[sent.messages.length - 1].content;
    expect(userMsg).not.toContain("Zebedee");
    expect(userMsg).not.toContain("z@x.com");
    expect(sent.messages[0].role).toBe("system");
    expect(sent.max_tokens).toBeGreaterThan(0);
    // API key goes in the header, never the body
    expect(JSON.stringify(sent)).not.toContain("test-key");

    const kv = env.TUTOR_KV as unknown as MemoryKV;
    const log = JSON.parse(kv.store.get("log:student:session-1234")!.value);
    expect(log.messages).toHaveLength(2);
    expect(log.messages[1].content).toBe("Hello there");
    expect(JSON.stringify(log)).not.toContain("Zebedee");
  });

  it("returns a friendly message once the daily cap is reached", async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: "1" });
    const token = await login(env);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseBody(["ok"]), { status: 200 })));
    const first = makeCtx();
    await (await worker.fetch(req("/api/chat", { method: "POST", token, body: chatBody("q1") }), env as never, first.ctx)).text();
    await first.settle();
    const second = makeCtx();
    const res = await worker.fetch(req("/api/chat", { method: "POST", token, body: chatBody("q2") }), env as never, second.ctx);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { message: string }).message).toMatch(/study limit/);
  });

  it("answers high-risk safeguarding messages without calling the LLM and flags the log", async () => {
    const env = makeEnv();
    const token = await login(env);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, settle } = makeCtx();
    const res = await worker.fetch(
      req("/api/chat", { method: "POST", token, body: chatBody("honestly I want to kill myself") }),
      env as never,
      ctx,
    );
    const text = await res.text();
    await settle();
    expect(text).toContain("0800 1111");
    expect(fetchMock).not.toHaveBeenCalled();
    const kv = env.TUTOR_KV as unknown as MemoryKV;
    expect(JSON.parse(kv.store.get("log:student:session-1234")!.value).flags).toContain("safeguarding-high");
  });

  it("lets only the parent read logs", async () => {
    const env = makeEnv();
    const studentToken = await login(env);
    const { ctx } = makeCtx();
    const denied = await worker.fetch(req("/api/parent/sessions", { token: studentToken }), env as never, ctx);
    expect(denied.status).toBe(401);
    const loginRes = await worker.fetch(
      req("/api/parent/login", { method: "POST", body: JSON.stringify({ password: "parent-pass" }) }),
      env as never,
      ctx,
    );
    const { token } = (await loginRes.json()) as { token: string };
    const ok = await worker.fetch(req("/api/parent/sessions", { token }), env as never, ctx);
    expect(ok.status).toBe(200);
  });
});

describe("safety detection", () => {
  it("flags first-person high-risk phrases", () => {
    expect(assessSafety("I want to die")).toBe("high");
    expect(assessSafety("i've been self harming")).toBe("high");
  });
  it("does not flag history content", () => {
    expect(assessSafety("Why did Hitler commit suicide in 1945?")).toBe("none");
    expect(assessSafety("How many people died in the famine?")).toBe("none");
  });
  it("flags general wellbeing", () => {
    expect(assessSafety("I'm really stressed about exams")).toBe("wellbeing");
  });
});

describe("history trimming", () => {
  it("keeps the most recent messages within limits, starting with a user turn", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    const t = trimHistory(msgs, 4, 10000);
    expect(t.map((m) => m.content)).toEqual(["m6", "m7", "m8", "m9"]);
    expect(t[0].role).toBe("user");
    expect(t[t.length - 1].content).toBe("m9");
  });
  it("respects the character budget", () => {
    const msgs = [
      { role: "user" as const, content: "x".repeat(500) },
      { role: "assistant" as const, content: "y".repeat(500) },
      { role: "user" as const, content: "short" },
    ];
    expect(trimHistory(msgs, 10, 600)).toEqual([{ role: "user", content: "short" }]);
  });
});
