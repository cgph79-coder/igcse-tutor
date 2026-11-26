import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { keepLatestImages, sanitizeMessages } from "../src/history";
import { buildSystemPrompt } from "../src/prompts/tutor";
import { findSyllabus, findTopic } from "../../syllabus/index";
import { makeCtx, makeEnv, MemoryKV, sseBody } from "./helpers";

const ORIGIN = "https://site.example";
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const visionEnv = () =>
  makeEnv({
    LLM_VISION_BASE_URL: "https://openrouter.ai/api/v1",
    LLM_VISION_MODEL: "vision-model",
    LLM_VISION_API_KEY: "vision-key",
  });

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

const body = (messages: unknown[]) =>
  JSON.stringify({ sessionId: "photo-session-1", code: "0606", topicId: "series", mode: "mark", messages });

afterEach(() => vi.unstubAllGlobals());

describe("photo uploads", () => {
  it("sends photos to the vision model as image parts, with no-data-collection routing", async () => {
    const env = visionEnv();
    const token = await login(env);
    const fetchMock = vi.fn(async () => new Response(sseBody(["Looks good"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, settle } = makeCtx();
    const res = await worker.fetch(
      req("/api/chat", { method: "POST", token, body: body([{ role: "user", content: "Mark this", images: [IMG] }]) }),
      env as never,
      ctx,
    );
    await res.text();
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer vision-key");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("vision-model");
    expect(sent.provider).toEqual({ data_collection: "deny" });
    const last = sent.messages[sent.messages.length - 1];
    expect(last.content[0]).toEqual({ type: "text", text: "Mark this" });
    expect(last.content[1]).toEqual({ type: "image_url", image_url: { url: IMG } });
    expect(sent.messages[0].content).toContain("PHOTOS OF WORK");

    // The parent log notes the photo but never stores it.
    const log = (env.TUTOR_KV as unknown as MemoryKV).store.get("log:student:photo-session-1")!.value;
    expect(log).toContain("1 photo(s) attached");
    expect(log).not.toContain("base64");
  });

  it("keeps text-only chat on the normal model", async () => {
    const env = visionEnv();
    const token = await login(env);
    const fetchMock = vi.fn(async () => new Response(sseBody(["ok"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, settle } = makeCtx();
    await (
      await worker.fetch(req("/api/chat", { method: "POST", token, body: body([{ role: "user", content: "hi" }]) }), env as never, ctx)
    ).text();
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect(JSON.parse(init.body as string).messages[0].content).not.toContain("PHOTOS OF WORK");
  });

  it("explains kindly when photo checking isn't configured", async () => {
    const env = makeEnv();
    const token = await login(env);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = makeCtx();
    const res = await worker.fetch(
      req("/api/chat", { method: "POST", token, body: body([{ role: "user", content: "", images: [IMG] }]) }),
      env as never,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Photo checking/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends the main key to a different photo provider", async () => {
    const env = makeEnv({ LLM_VISION_BASE_URL: "https://openrouter.ai/api/v1", LLM_VISION_MODEL: "vision-model" });
    const token = await login(env);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = makeCtx();
    const res = await worker.fetch(
      req("/api/chat", { method: "POST", token, body: body([{ role: "user", content: "x", images: [IMG] }]) }),
      env as never,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects anything that isn't a small JPEG/PNG/WebP data URL", () => {
    const msg = (images: unknown) => [{ role: "user", content: "x", images }];
    expect(sanitizeMessages(msg([IMG]))).not.toBeNull();
    expect(sanitizeMessages(msg(["https://example.com/a.jpg"]))).toBeNull();
    expect(sanitizeMessages(msg(["data:image/svg+xml;base64,PHN2Zz4="]))).toBeNull();
    expect(sanitizeMessages(msg([IMG, IMG, IMG, IMG, IMG]))).toBeNull();
    expect(sanitizeMessages(msg(["data:image/jpeg;base64," + "A".repeat(2_000_001)]))).toBeNull();
    expect(sanitizeMessages([{ role: "assistant", content: "x", images: [IMG] }, { role: "user", content: "y" }])).toBeNull();
  });

  it("only re-sends the most recent photos", () => {
    const out = keepLatestImages([
      { role: "user", content: "first", images: [IMG] },
      { role: "assistant", content: "feedback" },
      { role: "user", content: "second", images: [IMG, IMG] },
      { role: "assistant", content: "feedback" },
      { role: "user", content: "follow-up question" },
    ]);
    expect(out[0].images).toBeUndefined();
    expect(out[0].content).toContain("1 photo(s) shared earlier");
    expect(out[2].images).toHaveLength(2);
  });

  it("adds photo instructions to the prompt only when photos are present", () => {
    const s = findSyllabus("0977")!;
    const f = findTopic(s, "weimar")!;
    const base = { syllabus: s, section: f.section, topic: f.topic, tier: null, mode: "mark" as const };
    expect(buildSystemPrompt({ ...base, hasImages: true })).toContain("Ignore any names");
    expect(buildSystemPrompt(base)).not.toContain("PHOTOS OF WORK");
  });
});
