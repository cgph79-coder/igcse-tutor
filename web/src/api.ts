import { WORKER_URL } from "./config";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Photos (JPEG data URLs) attached to a user message. */
  images?: string[];
}

export interface ChatRequest {
  sessionId: string;
  code: string;
  topicId: string;
  tier: string | null;
  mode: string;
  difficulty?: string;
  commandWord?: string;
  quizLength?: number;
  messages: ChatMessage[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind?: string,
  ) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: { error?: string; message?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (body.error === "limit") return new ApiError(body.message ?? "Daily limit reached.", res.status, "limit");
  return new ApiError(body.error ?? `Something went wrong (${res.status}).`, res.status);
}

export async function login(path: "/api/login" | "/api/parent/login", body: object): Promise<string> {
  const res = await fetch(WORKER_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);
  return ((await res.json()) as { token: string }).token;
}

export async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(WORKER_URL + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await errorFrom(res);
  return res.json() as Promise<T>;
}

/** Send a chat request and call onDelta as the reply streams in. */
export async function streamChat(
  token: string,
  req: ChatRequest,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ truncated?: boolean; safeguarding?: boolean }> {
  const res = await fetch(WORKER_URL + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw await errorFrom(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: { truncated?: boolean; safeguarding?: boolean } = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith("data:")) continue;
      const evt = JSON.parse(chunk.slice(5).trim());
      if (evt.type === "delta") onDelta(evt.text);
      else if (evt.type === "done") final = evt;
      else if (evt.type === "error") throw new ApiError(evt.message, 502);
    }
  }
  return final;
}
