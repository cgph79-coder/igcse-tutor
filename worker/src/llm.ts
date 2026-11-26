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

export async function callLlm(target: LlmTarget, messages: LlmMessage[], maxTokens: number): Promise<Response> {
  const url = target.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body: Record<string, unknown> = {
    model: target.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.4,
    stream: true,
    stream_options: { include_usage: true },
  };
  // On OpenRouter, only use providers that don't store or train on prompts (he's a minor).
  if (/openrouter\.ai/.test(target.baseUrl)) body.provider = { data_collection: "deny" };
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${target.apiKey}`,
      // Harmless for other providers; OpenRouter uses this to label usage.
      "X-Title": "IGCSE Tutor",
    },
    body: JSON.stringify(body),
  });
}

export interface StreamResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
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
      }
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
