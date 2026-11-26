/**
 * Provider-agnostic call to an OpenAI-compatible chat completions endpoint
 * (DeepSeek, OpenRouter, Anthropic's compatibility endpoint, OpenAI, …).
 * Switching provider = changing LLM_BASE_URL, LLM_MODEL and the LLM_API_KEY secret.
 */
import type { Env } from "./env";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callLlm(env: Env, messages: LlmMessage[], maxTokens: number): Promise<Response> {
  const url = env.LLM_BASE_URL.replace(/\/+$/, "") + "/chat/completions";
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LLM_API_KEY}`,
      // Harmless for other providers; OpenRouter uses these to label usage.
      "X-Title": "IGCSE Tutor",
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.4,
      stream: true,
      stream_options: { include_usage: true },
    }),
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
