export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Photos of work, as data URLs (JPEG/PNG/WebP). Only on user messages. */
  images?: string[];
}

export const MAX_IMAGES_PER_MESSAGE = 6;
export const MAX_IMAGE_CHARS = 2_000_000; // ≈1.5 MB per photo once base64-encoded
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Validate and clean the message list sent by the browser. Returns null if anything is malformed. */
export function sanitizeMessages(input: unknown, maxMessageChars = 12000): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200) return null;
  const out: ChatMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== "object") return null;
    const { role, content, images } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const msg: ChatMessage = { role, content: content.slice(0, maxMessageChars) };
    if (images !== undefined) {
      if (role !== "user" || !Array.isArray(images) || images.length > MAX_IMAGES_PER_MESSAGE) return null;
      for (const img of images) {
        if (typeof img !== "string" || img.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(img)) return null;
      }
      if (images.length) msg.images = images as string[];
    }
    out.push(msg);
  }
  if (out[out.length - 1].role !== "user") return null;
  return out;
}

/**
 * Keep photos only on the most recent message that has any, so follow-up questions
 * about the same photo still work but old photos don't get re-sent (and re-billed).
 */
export function keepLatestImages(messages: ChatMessage[]): ChatMessage[] {
  let found = false;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (!m.images?.length) continue;
    if (found) {
      const { images, ...rest } = m;
      out[i] = { ...rest, content: `${rest.content}\n[${images.length} photo(s) shared earlier]`.trim() };
    }
    found = true;
  }
  return out;
}

export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.images?.length);
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
