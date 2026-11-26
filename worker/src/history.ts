export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Validate and clean the message list sent by the browser. */
export function sanitizeMessages(input: unknown, maxMessageChars = 8000): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200) return null;
  const out: ChatMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    out.push({ role, content: content.slice(0, maxMessageChars) });
  }
  if (out[out.length - 1].role !== "user") return null;
  return out;
}

/**
 * Keep only the most recent messages within both a count and a character budget,
 * so each request's cost stays predictable. Always keeps the latest user message
 * and makes sure the trimmed history starts with a user turn.
 */
export function trimHistory(messages: ChatMessage[], maxMessages: number, maxChars: number): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (kept.length >= maxMessages) break;
    if (kept.length > 0 && chars + m.content.length > maxChars) break;
    kept.unshift(m);
    chars += m.content.length;
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}
