/**
 * Provider-agnostic call to an OpenAI-compatible chat completions endpoint
 * (DeepSeek, OpenRouter, Anthropic's compatibility endpoint, OpenAI, …).
 * Switching provider = changing the base URL, model and API key.
 */
import type { Env } from "./env";
import type { ChatMessage } from "./history";

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface LlmTarget {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Text-only model for normal chat. */
export function textTarget(env: Env): LlmTarget {
  return { baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY };
}

/** Image-capable model for messages with photos, or null if photos aren't configured. */
export function visionTarget(env: Env): LlmTarget | null {
  if (!env.LLM_VISION_MODEL || !env.LLM_VISION_BASE_URL) return null;
  // Only reuse the main key if photos go to the same provider — never send a key to another service.
  const sameProvider = env.LLM_VISION_BASE_URL.replace(/\/+$/, "") === env.LLM_BASE_URL.replace(/\/+$/, "");
  const apiKey = env.LLM_VISION_API_KEY || (sameProvider ? env.LLM_API_KEY : "");
  return apiKey ? { baseUrl: env.LLM_VISION_BASE_URL, model: env.LLM_VISION_MODEL, apiKey } : null;
}

/** Convert a chat message to the OpenAI wire format (text + image parts). */
export function toLlmMessage(m: ChatMessage): LlmMessage {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      { type: "text", text: m.content || "Please check the work in this photo." },
      ...m.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ],
  };
}

/** Short, safe description of a provider error for the logs (no request content, no account details). */
export async function describeError(res: Response): Promise<string> {
  try {
    const j = (await res.clone().json()) as { error?: { message?: string; code?: string | number } };
    return `${res.status} ${String(j.error?.message ?? j.error?.code ?? "").slice(0, 160)}`.trim();
  } catch {
    return String(res.status);
  }
}

/**
 * Call the model. Many current models always "think" before replying, and that hidden thinking
 * counts against max_tokens. On OpenRouter we ask for low-effort thinking and add generous
 * headroom on top of the reply allowance, so the visible reply always has room. You only pay
 * for tokens actually used. If a provider rejects the reasoning setting, retry without it.
 */
export const THINKING_HEADROOM = 6000;

export async function callLlm(target: LlmTarget, messages: LlmMessage[], maxTokens: number): Promise<Response> {
  const url = target.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const isOpenRouter = /openrouter\.ai/.test(target.baseUrl);
  const attempts: Array<{ reasoning?: Record<string, unknown>; max_tokens: number }> = isOpenRouter
    ? [
        { reasoning: { effort: "low", exclude: true }, max_tokens: maxTokens + THINKING_HEADROOM },
        { max_tokens: maxTokens + THINKING_HEADROOM },
      ]
    : [{ max_tokens: maxTokens }];

  let res: Response | undefined;
  for (const [i, attempt] of attempts.entries()) {
    const body: Record<string, unknown> = {
      model: target.model,
      messages,
      max_tokens: attempt.max_tokens,
      temperature: 0.4,
      stream: true,
      stream_options: { include_usage: true },
    };
    // On OpenRouter, only use providers that don't store or train on prompts (he's a minor).
    if (isOpenRouter) body.provider = { data_collection: "deny" };
    if (attempt.reasoning) body.reasoning = attempt.reasoning;
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.apiKey}`,
        // Harmless for other providers; OpenRouter uses this to label usage.
        "X-Title": "IGCSE Tutor",
      },
      body: JSON.stringify(body),
    });
    // Only a "bad request" is worth retrying with different settings.
    if (res.ok || (res.status !== 400 && res.status !== 422) || i === attempts.length - 1) break;
    console.log(`llm attempt ${i + 1} rejected: ${await describeError(res)} — retrying with other reasoning settings`);
  }
  return res!;
}

export interface StreamResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
  reasoningTokens?: number;
  error?: string;
}

/**
 * Read an OpenAI-style SSE stream, calling onDelta for each piece of text.
 * Returns the full text and token usage (if the provider reported it).
 */
export async function readOpenAiStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => Promise<void> | void,
): Promise<StreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const result: StreamResult = { text: "" };
  let buffer = "";

  const handleLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const json = JSON.parse(data);
      const choice = json.choices?.[0];
      const delta: string | undefined = choice?.delta?.content;
      if (delta) {
        result.text += delta;
        await onDelta(delta);
      }
      if (choice?.finish_reason) result.finishReason = choice.finish_reason;
      if (json.usage) {
        result.promptTokens = json.usage.prompt_tokens;
        result.completionTokens = json.usage.completion_tokens;
        result.reasoningTokens = json.usage.completion_tokens_details?.reasoning_tokens;
      }
      // Some providers (e.g. OpenRouter) report mid-stream failures as an error object.
      if (json.error) result.error = String(json.error.message ?? json.error.code ?? "provider error");
    } catch {
      // Ignore keep-alive comments or malformed lines.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      await handleLine(line);
    }
  }
  if (buffer) await handleLine(buffer);
  return result;
}
