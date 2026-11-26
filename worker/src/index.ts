/**
 * IGCSE Tutor Worker — the only route between the web app and the LLM.
 *
 * Routes:
 *   POST /api/login                 { passcode }  → { token }   (student)
 *   POST /api/chat                  stream a tutor reply (SSE)
 *   GET  /api/usage                 today's usage for the student
 *   POST /api/parent/login          { password }  → { token }   (parent)
 *   GET  /api/parent/sessions       list session logs
 *   GET  /api/parent/session?key=…  one session log
 *   GET  /api/health
 */
import { bearer, checkSecret, issueToken, verifyToken, type Role, type TokenPayload } from "./auth";
import { num, type Env } from "./env";
import { sanitizeMessages, trimHistory } from "./history";
import { callLlm, readOpenAiStream, type LlmMessage } from "./llm";
import { appendToLog, listLogs, SESSION_ID, type LogMessage } from "./logs";
import { parseBlockedTerms, stripPii } from "./pii";
import { buildSystemPrompt, COMMAND_WORDS, type CommandWord, type Difficulty, type Mode } from "./prompts/tutor";
import {
  estimateTokens,
  getUsage,
  isOverLimit,
  LIMIT_MESSAGE,
  loginThrottled,
  recordLoginFailure,
  recordUsage,
} from "./ratelimit";
import { assessSafety, HIGH_RISK_REPLY } from "./safety";
import { findSyllabus, findTopic } from "../../syllabus/index";

const STUDENT_ID = "student"; // single user for now; becomes a real user id with accounts
const STUDENT_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
const PARENT_TOKEN_TTL = 60 * 60 * 12; // 12 hours
const MODES: Mode[] = ["learn", "practise", "mark", "quiz"];
const DIFFICULTIES: Difficulty[] = ["foundation", "standard", "challenging"];

// ---------- helpers ----------

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin && allowedOrigins(env).includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(request: Request, env: Env, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(request, env) },
  });
}

async function requireRole(request: Request, env: Env, role: Role): Promise<TokenPayload | null> {
  const payload = await verifyToken(env.TOKEN_SECRET, bearer(request));
  return payload && payload.role === role ? payload : null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

// ---------- handlers ----------

async function handleLogin(request: Request, env: Env, role: Role): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (await loginThrottled(env.TUTOR_KV, ip)) {
    return json(request, env, { error: "Too many attempts. Please wait an hour and try again." }, 429);
  }
  const body = await readJson(request);
  const expected = role === "student" ? env.TUTOR_PASSCODE : env.PARENT_PASSWORD;
  const submitted = role === "student" ? body?.passcode : body?.password;
  if (!(await checkSecret(submitted, expected))) {
    await recordLoginFailure(env.TUTOR_KV, ip);
    return json(request, env, { error: "That passcode isn't right." }, 401);
  }
  const token = await issueToken(
    env.TOKEN_SECRET,
    role === "student" ? STUDENT_ID : "parent",
    role,
    role === "student" ? STUDENT_TOKEN_TTL : PARENT_TOKEN_TTL,
  );
  return json(request, env, { token });
}

async function handleChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);

  const limits = { requests: num(env.DAILY_REQUEST_LIMIT, 150), tokens: num(env.DAILY_TOKEN_LIMIT, 400000) };
  if (isOverLimit(await getUsage(env.TUTOR_KV, user.sub), limits)) {
    return json(request, env, { error: "limit", message: LIMIT_MESSAGE }, 429);
  }

  const body = await readJson(request);
  if (!body) return json(request, env, { error: "Bad request." }, 400);

  const syllabus = findSyllabus(String(body.code ?? ""));
  const found = syllabus && findTopic(syllabus, String(body.topicId ?? ""));
  const mode = body.mode as Mode;
  const sessionId = String(body.sessionId ?? "");
  const rawMessages = sanitizeMessages(body.messages);
  if (!syllabus || !found || !MODES.includes(mode) || !SESSION_ID.test(sessionId) || !rawMessages) {
    return json(request, env, { error: "Bad request." }, 400);
  }
  const tier =
    syllabus.tiers && typeof body.tier === "string" && syllabus.tiers.includes(body.tier)
      ? body.tier
      : syllabus.defaultTier;
  const difficulty = DIFFICULTIES.includes(body.difficulty as Difficulty) ? (body.difficulty as Difficulty) : undefined;
  const commandWord = COMMAND_WORDS.includes(body.commandWord as CommandWord)
    ? (body.commandWord as CommandWord)
    : undefined;

  // Privacy: strip personal info from every user message before it goes anywhere.
  const blocked = parseBlockedTerms(env.BLOCKED_TERMS);
  let lastRedactions: string[] = [];
  const messages = rawMessages.map((m, i) => {
    if (m.role !== "user") return m;
    const r = stripPii(m.content, blocked);
    if (i === rawMessages.length - 1) lastRedactions = r.redactions;
    return { ...m, content: r.text };
  });
  const latest = messages[messages.length - 1];
  const safety = assessSafety(rawMessages[rawMessages.length - 1].content);
  const flags = safety === "none" ? [] : [safety === "high" ? "safeguarding-high" : "wellbeing"];

  const now = new Date();
  const logBase = {
    id: sessionId,
    userId: user.sub,
    subject: syllabus.subject,
    code: syllabus.code,
    topic: found.topic.title,
    tier,
    mode,
  };
  const retention = num(env.LOG_RETENTION_DAYS, 90);
  const userLog: LogMessage = {
    role: "user",
    content: latest.content,
    at: now.toISOString(),
    ...(lastRedactions.length ? { redactions: lastRedactions } : {}),
  };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const write = (obj: unknown) => writer.write(encoder.encode(sse(obj)));
  const headers = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(request, env),
  };

  // Safeguarding backstop: clear high-risk messages get a fixed, kind reply and never go to the LLM.
  if (safety === "high") {
    ctx.waitUntil(
      (async () => {
        await write({ type: "delta", text: HIGH_RISK_REPLY });
        await write({ type: "done", safeguarding: true });
        await writer.close();
        await recordUsage(env.TUTOR_KV, user.sub, 0);
        await appendToLog(
          env.TUTOR_KV,
          logBase,
          [userLog, { role: "assistant", content: HIGH_RISK_REPLY, at: new Date().toISOString() }],
          flags,
          retention,
        );
      })(),
    );
    return new Response(readable, { headers });
  }

  const system = buildSystemPrompt({
    syllabus,
    section: found.section,
    topic: found.topic,
    tier,
    mode,
    difficulty,
    commandWord,
    quizLength: typeof body.quizLength === "number" ? body.quizLength : undefined,
  });
  const history = trimHistory(messages, num(env.MAX_HISTORY_MESSAGES, 16), num(env.MAX_HISTORY_CHARS, 24000));
  const llmMessages: LlmMessage[] = [{ role: "system", content: system }, ...history];

  let upstream: Response;
  try {
    upstream = await callLlm(env, llmMessages, num(env.MAX_TOKENS, 800));
  } catch {
    return json(request, env, { error: "The tutor service couldn't be reached. Please try again in a moment." }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    // Don't echo provider error bodies (they can contain account details).
    console.log(`LLM error status ${upstream.status}`);
    const msg =
      upstream.status === 401 || upstream.status === 402
        ? "The tutor isn't set up correctly (API key or credit). Please ask a parent to check."
        : "The tutor is busy right now. Please try again in a moment.";
    return json(request, env, { error: msg }, 502);
  }

  ctx.waitUntil(
    (async () => {
      let result;
      try {
        result = await readOpenAiStream(upstream.body!, (text) => write({ type: "delta", text }));
        await write({ type: "done", truncated: result.finishReason === "length" });
      } catch {
        await write({ type: "error", message: "The reply was interrupted. Please try again." }).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
      const text = result?.text ?? "";
      const tokens =
        (result?.promptTokens ?? estimateTokens(system + history.map((m) => m.content).join(""))) +
        (result?.completionTokens ?? estimateTokens(text));
      await recordUsage(env.TUTOR_KV, user.sub, tokens);
      await appendToLog(
        env.TUTOR_KV,
        logBase,
        [userLog, { role: "assistant", content: text, at: new Date().toISOString() }],
        flags,
        retention,
      );
    })(),
  );

  return new Response(readable, { headers });
}

async function handleUsage(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);
  const usage = await getUsage(env.TUTOR_KV, user.sub);
  return json(request, env, {
    usage,
    limits: { requests: num(env.DAILY_REQUEST_LIMIT, 150), tokens: num(env.DAILY_TOKEN_LIMIT, 400000) },
  });
}

async function handleParentSessions(request: Request, env: Env): Promise<Response> {
  if (!(await requireRole(request, env, "parent"))) return json(request, env, { error: "Please log in." }, 401);
  const [sessions, usage] = await Promise.all([listLogs(env.TUTOR_KV), getUsage(env.TUTOR_KV, STUDENT_ID)]);
  return json(request, env, {
    sessions,
    usageToday: usage,
    limits: { requests: num(env.DAILY_REQUEST_LIMIT, 150), tokens: num(env.DAILY_TOKEN_LIMIT, 400000) },
    retentionDays: num(env.LOG_RETENTION_DAYS, 90),
  });
}

async function handleParentSession(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await requireRole(request, env, "parent"))) return json(request, env, { error: "Please log in." }, 401);
  const key = url.searchParams.get("key") ?? "";
  if (!/^log:[A-Za-z0-9-]+:[A-Za-z0-9-]{8,64}$/.test(key)) return json(request, env, { error: "Bad key." }, 400);
  const log = await env.TUTOR_KV.get(key, "json");
  return log ? json(request, env, log) : json(request, env, { error: "Not found." }, 404);
}

// ---------- router ----------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    // Browsers always send Origin on cross-site requests; refuse other sites outright.
    if (origin && !allowedOrigins(env).includes(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      switch (`${request.method} ${url.pathname}`) {
        case "GET /api/health":
          return json(request, env, { ok: true });
        case "POST /api/login":
          return await handleLogin(request, env, "student");
        case "POST /api/chat":
          return await handleChat(request, env, ctx);
        case "GET /api/usage":
          return await handleUsage(request, env);
        case "POST /api/parent/login":
          return await handleLogin(request, env, "parent");
        case "GET /api/parent/sessions":
          return await handleParentSessions(request, env);
        case "GET /api/parent/session":
          return await handleParentSession(request, env, url);
        default:
          return json(request, env, { error: "Not found." }, 404);
      }
    } catch (err) {
      console.log(`Unhandled error: ${err instanceof Error ? err.name : "unknown"}`);
      return json(request, env, { error: "Something went wrong. Please try again." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
