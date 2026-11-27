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
  return (await loginAs(path, body)).token;
}

/** Log in and learn which student user it was ("student", or "tester" for a parent testing the app). */
export async function loginAs(path: "/api/login" | "/api/parent/login", body: object): Promise<{ token: string; user: string }> {
  const res = await fetch(WORKER_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);
  const data = (await res.json()) as { token: string; user?: string };
  return { token: data.token, user: data.user ?? "student" };
}

export async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(WORKER_URL + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await errorFrom(res);
  return res.json() as Promise<T>;
}

export interface McqQuestion {
  q: string;
  options: string[];
  answer: number;
  explain: string;
  /** 1 = essentials, 2 = finer detail, 3 = precise distinctions. */
  level?: 1 | 2 | 3;
}

/** A batch of multiple-choice questions for the arcade games. */
export async function fetchQuizQuestions(
  token: string,
  req: { code: string; topicId: string; tier: string | null; count: number; level?: 1 | 2 | 3 },
): Promise<McqQuestion[]> {
  const res = await fetch(WORKER_URL + "/api/quiz-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw await errorFrom(res);
  return ((await res.json()) as { questions: McqQuestion[] }).questions;
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

/** Send this device's career; the Worker merges it with its copy and returns the result. */
export async function postCareer(token: string, career: unknown): Promise<unknown> {
  const res = await fetch(WORKER_URL + "/api/career", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ career }),
  });
  if (!res.ok) throw await errorFrom(res);
  return ((await res.json()) as { career: unknown }).career;
}

export interface ExamQuestionPublic {
  q: string;
  marks: number;
  command: string;
}

export interface ExamResult {
  q: string;
  answer: string;
  marks: number;
  max: number;
  feedback: string;
  scheme: string[];
  model: string;
}

async function postJson<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(WORKER_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json() as Promise<T>;
}

/** Editor's desk: three exam-style questions for a topic at ★★★ (mark schemes stay on the Worker). */
export function startExam(token: string, req: { code: string; topicId: string; tier: string | null }) {
  return postJson<{ runId: string; questions: ExamQuestionPublic[] }>("/api/exam/start", token, req);
}

export function markExam(token: string, runId: string, answers: string[]) {
  return postJson<{ got: number; max: number; results: ExamResult[] } | { safeguarding: true; message: string }>(
    "/api/exam/mark", token, { runId, answers });
}
