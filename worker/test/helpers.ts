/** In-memory stand-ins for Cloudflare KV and ExecutionContext. */
export class MemoryKV {
  store = new Map<string, { value: string; metadata?: unknown }>();
  async get(key: string, type?: "json" | "text") {
    const v = this.store.get(key);
    if (!v) return null;
    return type === "json" ? JSON.parse(v.value) : v.value;
  }
  async put(key: string, value: string, opts?: { metadata?: unknown }) {
    this.store.set(key, { value, metadata: opts?.metadata });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list(opts: { prefix?: string }) {
    const keys = [...this.store.entries()]
      .filter(([k]) => k.startsWith(opts.prefix ?? ""))
      .map(([name, v]) => ({ name, metadata: v.metadata }));
    return { keys, list_complete: true, cursor: "" };
  }
}

export function makeCtx() {
  const tasks: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => tasks.push(p), passThroughOnException() {} } as unknown as ExecutionContext,
    settle: () => Promise.all(tasks),
  };
}

export function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    TUTOR_KV: new MemoryKV() as unknown as KVNamespace,
    LLM_API_KEY: "test-key",
    TUTOR_PASSCODE: "let-me-in",
    PARENT_PASSWORD: "parent-pass",
    TOKEN_SECRET: "a-very-long-test-secret-value-123",
    BLOCKED_TERMS: "Zebedee",
    LLM_BASE_URL: "https://llm.example/v1",
    LLM_MODEL: "test-model",
    ALLOWED_ORIGINS: "https://site.example",
    DAILY_REQUEST_LIMIT: "3",
    DAILY_TOKEN_LIMIT: "100000",
    ...overrides,
  };
}

export function sseBody(chunks: string[], usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}\n\n`);
  lines.push("data: [DONE]\n\n");
  return new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(l));
      c.close();
    },
  });
}
