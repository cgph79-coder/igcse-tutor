/**
 * IGCSE Tutor Worker — the only route between the web app and the LLM.
 *
 * Routes:
 *   POST /api/login                 { passcode }  → { token }   (student)
 *   POST /api/chat                  stream a tutor reply (SSE)
 *   POST /api/quiz-questions        { code, topicId, tier, count, level? } → { questions } (arcade games)
 *   GET  /api/career                → { career } (Dispatches career, progress only)
 *   POST /api/career                { career } → { career } merged with the stored copy
 *   POST /api/exam/start            { code, topicId, tier } → { runId, questions } (Editor's desk, topic at ★★★)
 *   POST /api/exam/mark             { runId, answers } → { results, got, max }
 *   POST /api/focus                 { blocks: [{ at, minutes, code }] } → { saved } (study timer)
 *   POST /api/feedback              { area, text, context? } → { ok } (in-app feedback)
 *   GET  /api/usage                 today's usage for the student
 *   POST /api/parent/login          { password }  → { token }   (parent)
 *   GET  /api/parent/sessions       list session logs
 *   GET  /api/parent/session?key=…  one session log
 *   GET  /api/parent/feedback       in-app feedback, newest first
 *   POST /api/parent/feedback/done  { id } → remove one feedback item (once it's in the log)
 *   GET  /api/health
 */
import { bearer, checkSecret, issueToken, verifyToken, type Role, type TokenPayload } from "./auth";
import { num, type Env } from "./env";
import { hasImages, keepLatestImages, sanitizeMessages, trimHistory } from "./history";
import { callLlm, describeError, readOpenAiStream, textTarget, toLlmMessage, visionTarget, type LlmMessage } from "./llm";
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
import { cleanBlocks, getFocusDays, recordFocusBlocks } from "./focus";
import { deleteFeedback, listFeedback, saveFeedback } from "./feedback";
import { getCareer, saveCareer } from "./career";
import {
  buildExamPrompt,
  buildMarkPrompt,
  countRun,
  MAX_ANSWER,
  newRunId,
  parseExamQuestions,
  parseMarks,
  publicQuestions,
  runsToday,
  saveRun,
  takeRun,
} from "./exam";
import { examUnlocked } from "../../shared/career";
import {
  addToBank,
  bankKey,
  buildCheckPrompt,
  buildQuizPrompt,
  buildLevelRound,
  buildRound,
  parseQuestions,
  parseVerdicts,
  readBank,
  shouldServeFromBank,
  shuffleOptions,
  type McqQuestion,
} from "./quiz";
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
  const photoCount = latest.images?.length ?? 0;
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
    // Photos are never stored in the logs — only a note that they were sent.
    content: photoCount ? `${latest.content}\n[${photoCount} photo(s) attached]`.trim() : latest.content,
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

  const withImages = keepLatestImages(messages);
  const history = trimHistory(withImages, num(env.MAX_HISTORY_MESSAGES, 16), num(env.MAX_HISTORY_CHARS, 24000));
  const usesPhotos = hasImages(history);
  const target = usesPhotos ? visionTarget(env) : textTarget(env);
  if (!target) {
    await writer.close();
    return json(request, env, { error: "Photo checking isn't switched on yet. Please type your answer instead, or ask a parent to set it up." }, 400);
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
    hasImages: usesPhotos,
  });
  const llmMessages: LlmMessage[] = [{ role: "system", content: system }, ...history.map(toLlmMessage)];

  let upstream: Response;
  try {
    // Marking (especially several photographed pages) needs more room than a teaching reply.
    const maxTokens = usesPhotos ? num(env.MAX_TOKENS_PHOTOS, 2000) : num(env.MAX_TOKENS, 800) + (mode === "mark" ? 400 : 0);
    upstream = await callLlm(target, llmMessages, maxTokens);
  } catch {
    return json(request, env, { error: "The tutor service couldn't be reached. Please try again in a moment." }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    // Log only the provider's short error message; never show it to the student.
    console.log(`LLM error model=${target.model} ${await describeError(upstream)}`);
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
        // Diagnostics only — never message content.
        console.log(
          `llm model=${target.model} finish=${result.finishReason ?? "?"} prompt=${result.promptTokens ?? "?"} ` +
            `completion=${result.completionTokens ?? "?"} reasoning=${result.reasoningTokens ?? 0} chars=${result.text.length}` +
            (result.error ? ` error=${result.error.slice(0, 120)}` : ""),
        );
        if (!result.text.trim()) {
          await write({ type: "error", message: "The tutor didn't manage to reply that time. Please send it again." });
        } else {
          await write({ type: "done", truncated: result.finishReason === "length" });
        }
      } catch {
        await write({ type: "error", message: "The reply was interrupted. Please try again." }).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
      const text = result?.text ?? "";
      const tokens =
        (result?.promptTokens ??
          estimateTokens(system + history.map((m) => m.content).join("")) +
            history.reduce((n, m) => n + (m.images?.length ?? 0) * 1600, 0)) +
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

/** A batch of multiple-choice questions for the arcade games (JSON, not streamed). */
async function handleQuizQuestions(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);

  const body = await readJson(request);
  const syllabus = body && findSyllabus(String(body.code ?? ""));
  const found = syllabus && findTopic(syllabus, String(body?.topicId ?? ""));
  if (!body || !syllabus || !found) return json(request, env, { error: "Bad request." }, 400);
  const tier =
    syllabus.tiers && typeof body.tier === "string" && syllabus.tiers.includes(body.tier)
      ? body.tier
      : syllabus.defaultTier;
  const count = Math.min(15, Math.max(5, Math.round(Number(body.count) || 10)));
  // Career runs ask for one level of card; otherwise a round gets harder as it goes.
  const level = [1, 2, 3].includes(Number(body.level)) ? (Number(body.level) as 1 | 2 | 3) : null;
  const round = (pool: McqQuestion[]) => (level ? buildLevelRound(pool, count, level) : buildRound(pool, count));

  const key = bankKey(syllabus.code, tier, found.topic.id);
  const bank = await readBank(env.TUTOR_KV, key);
  if (shouldServeFromBank(bank.length, count)) {
    return json(request, env, { questions: round(bank).map((q) => shuffleOptions(q)), source: "bank" });
  }

  const limits = { requests: num(env.DAILY_REQUEST_LIMIT, 150), tokens: num(env.DAILY_TOKEN_LIMIT, 400000) };
  if (isOverLimit(await getUsage(env.TUTOR_KV, user.sub), limits)) {
    // Out of AI budget for today, but banked questions still let him play.
    if (bank.length >= 5) {
      return json(request, env, { questions: round(bank).map((q) => shuffleOptions(q)), source: "bank" });
    }
    return json(request, env, { error: "limit", message: LIMIT_MESSAGE }, 429);
  }

  const system = buildQuizPrompt({ syllabus, section: found.section, topic: found.topic, tier, count: count + 5 });
  const messages: LlmMessage[] = [
    { role: "system", content: system },
    { role: "user", content: "Write the questions now." },
  ];
  const target = textTarget(env);
  let upstream: Response;
  try {
    upstream = await callLlm(target, messages, num(env.MAX_TOKENS_QUIZ, 3000));
  } catch {
    return json(request, env, { error: "The question service couldn't be reached. Please try again in a moment." }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    console.log(`LLM quiz error model=${target.model} ${await describeError(upstream)}`);
    return json(request, env, { error: "Couldn't get questions right now. Please try again in a moment." }, 502);
  }
  const result = await readOpenAiStream(upstream.body, () => {});
  const written = parseQuestions(result.text);
  let tokens = (result.promptTokens ?? estimateTokens(system)) + (result.completionTokens ?? estimateTokens(result.text));

  // Second pass: have the model check every card; only cards it explicitly passes are kept and saved.
  let fresh: McqQuestion[] = written;
  let checked = false;
  if (written.length) {
    const checkPrompt = buildCheckPrompt({ syllabus, section: found.section, topic: found.topic, tier }, written);
    try {
      const res = await callLlm(target, [{ role: "system", content: checkPrompt }, { role: "user", content: "Check the cards now." }], num(env.MAX_TOKENS_QUIZ_CHECK, 1500));
      if (res.ok && res.body) {
        const check = await readOpenAiStream(res.body, () => {});
        tokens += (check.promptTokens ?? estimateTokens(checkPrompt)) + (check.completionTokens ?? estimateTokens(check.text));
        const passed = parseVerdicts(check.text, written.length);
        if (passed) {
          fresh = written.filter((_, i) => passed.has(i));
          checked = true;
        }
      } else {
        console.log(`LLM quiz check error model=${target.model} ${await describeError(res)}`);
      }
    } catch {
      /* checker unreachable: handled below */
    }
  }
  await recordUsage(env.TUTOR_KV, user.sub, tokens);
  console.log(
    `llm quiz model=${target.model} finish=${result.finishReason ?? "?"} valid=${written.length} ` +
      `checked=${checked} passed=${checked ? fresh.length : "-"} tokens=${tokens}`,
  );

  // Unchecked cards may still be played this once, but are never saved for future rounds.
  if (checked && fresh.length) await addToBank(env.TUTOR_KV, key, fresh);
  // A fresh batch has only about a third of its cards at any one level, so career runs also draw on the bank.
  const questions = fresh.length >= 5 && !level ? round(fresh) : round([...fresh, ...bank]);
  if (questions.length < 5) {
    return json(request, env, { error: "Couldn't make good questions that time. Please try again." }, 502);
  }
  return json(request, env, { questions: questions.map((q) => shuffleOptions(q)), source: "new" });
}

/** Finished study-timer blocks: time, length and subject only. Doesn't count towards the daily limit. */
async function handleFocus(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);
  const body = await readJson(request);
  if (!body || !Array.isArray(body.blocks)) return json(request, env, { error: "Bad request." }, 400);
  const saved = await recordFocusBlocks(env.TUTOR_KV, user.sub, cleanBlocks(body.blocks), num(env.LOG_RETENTION_DAYS, 90));
  return json(request, env, { saved });
}

/** The Dispatches career: GET returns the stored copy; POST merges the device's copy into it. */
async function handleCareer(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);
  if (request.method === "GET") return json(request, env, { career: await getCareer(env.TUTOR_KV, user.sub) });
  const body = await readJson(request);
  const career = await saveCareer(env.TUTOR_KV, user.sub, body?.career);
  return career ? json(request, env, { career }) : json(request, env, { error: "Bad request." }, 400);
}

/** Read one complete (non-streamed) reply from the text model; null on any failure. */
async function askText(env: Env, system: string, user: string, maxTokens: number): Promise<{ text: string; tokens: number } | null> {
  const target = textTarget(env);
  try {
    const res = await callLlm(target, [{ role: "system", content: system }, { role: "user", content: user }], maxTokens);
    if (!res.ok || !res.body) {
      console.log(`LLM exam error model=${target.model} ${await describeError(res)}`);
      return null;
    }
    const r = await readOpenAiStream(res.body, () => {});
    return { text: r.text, tokens: (r.promptTokens ?? estimateTokens(system)) + (r.completionTokens ?? estimateTokens(r.text)) };
  } catch {
    return null;
  }
}

const EXAM_LIMIT_MESSAGE = "That's all the Editor's desk for today. It costs more than the other games. Try again tomorrow, or practise in the tutor.";

/** Editor's desk: three exam-style questions for a topic he has at ★★★. Mark schemes stay on the Worker. */
async function handleExamStart(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);
  const body = await readJson(request);
  const syllabus = body && findSyllabus(String(body.code ?? ""));
  const found = syllabus && findTopic(syllabus, String(body?.topicId ?? ""));
  if (!body || !syllabus || !found) return json(request, env, { error: "Bad request." }, 400);
  const tier =
    syllabus.tiers && typeof body.tier === "string" && syllabus.tiers.includes(body.tier) ? body.tier : syllabus.defaultTier;

  const career = await getCareer(env.TUTOR_KV, user.sub);
  if (!career || !examUnlocked(career, syllabus.code, found.topic.id)) {
    return json(request, env, { error: "The Editor's desk opens once this topic has three stars." }, 403);
  }
  const limits = { requests: num(env.DAILY_REQUEST_LIMIT, 150), tokens: num(env.DAILY_TOKEN_LIMIT, 400000) };
  if (isOverLimit(await getUsage(env.TUTOR_KV, user.sub), limits)) {
    return json(request, env, { error: "limit", message: LIMIT_MESSAGE }, 429);
  }
  if ((await runsToday(env.TUTOR_KV, user.sub)) >= num(env.EXAM_DAILY_LIMIT, 4)) {
    return json(request, env, { error: "limit", message: EXAM_LIMIT_MESSAGE }, 429);
  }

  const o = { syllabus, section: found.section, topic: found.topic, tier };
  const reply = await askText(env, buildExamPrompt(o), "Write the questions now.", num(env.MAX_TOKENS_EXAM, 2500));
  if (reply) await recordUsage(env.TUTOR_KV, user.sub, reply.tokens);
  const questions = reply ? parseExamQuestions(reply.text) : [];
  if (!questions.length) return json(request, env, { error: "The editor couldn't set questions that time. Please try again." }, 502);

  const runId = newRunId();
  await saveRun(env.TUTOR_KV, user.sub, runId, { code: syllabus.code, topicId: found.topic.id, tier, createdAt: new Date().toISOString(), questions });
  await countRun(env.TUTOR_KV, user.sub);
  return json(request, env, { runId, questions: publicQuestions(questions) });
}

/** Mark the three answers together, log the run for the parent view, and return marks with the schemes. */
async function handleExamMark(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);
  const body = await readJson(request);
  const rawAnswers = Array.isArray(body?.answers) ? body!.answers : null;
  if (!body || !rawAnswers || rawAnswers.length > 10) return json(request, env, { error: "Bad request." }, 400);
  const runId = String(body.runId ?? "");
  const run = await takeRun(env.TUTOR_KV, user.sub, runId);
  if (!run) return json(request, env, { error: "This set of questions has expired. Start a new one from the career map." }, 404);
  const syllabus = findSyllabus(run.code)!;
  const found = findTopic(syllabus, run.topicId)!;

  // Same privacy filter and safeguarding check as the tutor chat.
  const blocked = parseBlockedTerms(env.BLOCKED_TERMS);
  const raw = run.questions.map((_, i) => String(rawAnswers[i] ?? "").slice(0, MAX_ANSWER).trim());
  const cleaned = raw.map((a) => stripPii(a, blocked));
  const answers = cleaned.map((r) => r.text);
  const redactions = [...new Set(cleaned.flatMap((r) => r.redactions))];
  const safety = assessSafety(raw.join("\n"));
  const flags = safety === "none" ? [] : [safety === "high" ? "safeguarding-high" : "wellbeing"];
  const retention = num(env.LOG_RETENTION_DAYS, 90);
  const logBase = { id: `exam-${runId}`, userId: user.sub, subject: syllabus.subject, code: syllabus.code, topic: found.topic.title, tier: run.tier, mode: "editor's desk" };
  const transcript = run.questions.map((q, i) => `Q${i + 1} [${q.marks}] ${q.q}\nAnswer: ${answers[i] || "(blank)"}`).join("\n\n");
  const userLog: LogMessage = { role: "user", content: transcript, at: new Date().toISOString(), ...(redactions.length ? { redactions } : {}) };

  if (safety === "high") {
    await appendToLog(env.TUTOR_KV, logBase, [userLog, { role: "assistant", content: HIGH_RISK_REPLY, at: new Date().toISOString() }], flags, retention);
    return json(request, env, { safeguarding: true, message: HIGH_RISK_REPLY });
  }

  const o = { syllabus, section: found.section, topic: found.topic, tier: run.tier };
  const reply = await askText(env, buildMarkPrompt(o, run.questions, answers), "Mark the answers now.", num(env.MAX_TOKENS_EXAM_MARK, 1500));
  if (reply) await recordUsage(env.TUTOR_KV, user.sub, reply.tokens);
  const marks = reply ? parseMarks(reply.text, run.questions) : null;
  if (!marks) {
    // Put the run back so he can try marking again without losing his answers.
    await saveRun(env.TUTOR_KV, user.sub, runId, run);
    return json(request, env, { error: "The editor couldn't mark that just now. Please try again." }, 502);
  }
  const got = marks.reduce((n, m) => n + m.marks, 0);
  const max = marks.reduce((n, m) => n + m.max, 0);
  const summary = marks.map((m, i) => `Q${i + 1}: ${m.marks}/${m.max}. ${m.feedback}`).join("\n") + `\nTotal: ${got}/${max}`;
  await appendToLog(env.TUTOR_KV, logBase, [userLog, { role: "assistant", content: summary, at: new Date().toISOString() }], flags, retention);
  return json(request, env, {
    got,
    max,
    results: marks.map((m, i) => ({ ...m, q: run.questions[i].q, answer: answers[i], scheme: run.questions[i].scheme, model: run.questions[i].model })),
  });
}

/** A short note about the app from the student, for the parent view and the feedback log. */
async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, env, "student");
  if (!user) return json(request, env, { error: "Please log in again." }, 401);
  const body = await readJson(request);
  if (!body) return json(request, env, { error: "Bad request." }, 400);
  const result = await saveFeedback(
    env.TUTOR_KV,
    user.sub,
    { area: body.area, text: body.text, context: body.context },
    parseBlockedTerms(env.BLOCKED_TERMS),
    num(env.LOG_RETENTION_DAYS, 90),
  );
  return result.ok ? json(request, env, { ok: true }) : json(request, env, { error: result.error }, result.status);
}

async function handleParentFeedback(request: Request, env: Env): Promise<Response> {
  if (!(await requireRole(request, env, "parent"))) return json(request, env, { error: "Please log in." }, 401);
  return json(request, env, { feedback: await listFeedback(env.TUTOR_KV) });
}

async function handleParentFeedbackDone(request: Request, env: Env): Promise<Response> {
  if (!(await requireRole(request, env, "parent"))) return json(request, env, { error: "Please log in." }, 401);
  const body = await readJson(request);
  const ok = await deleteFeedback(env.TUTOR_KV, String(body?.id ?? ""));
  return ok ? json(request, env, { ok: true }) : json(request, env, { error: "Bad id." }, 400);
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
  const [sessions, usage, focus, career] = await Promise.all([
    listLogs(env.TUTOR_KV),
    getUsage(env.TUTOR_KV, STUDENT_ID),
    getFocusDays(env.TUTOR_KV, STUDENT_ID, 14),
    getCareer(env.TUTOR_KV, STUDENT_ID),
  ]);
  return json(request, env, {
    sessions,
    focus,
    career,
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
        case "POST /api/quiz-questions":
          return await handleQuizQuestions(request, env);
        case "GET /api/career":
        case "POST /api/career":
          return await handleCareer(request, env);
        case "POST /api/exam/start":
          return await handleExamStart(request, env);
        case "POST /api/exam/mark":
          return await handleExamMark(request, env);
        case "POST /api/feedback":
          return await handleFeedback(request, env);
        case "GET /api/parent/feedback":
          return await handleParentFeedback(request, env);
        case "POST /api/parent/feedback/done":
          return await handleParentFeedbackDone(request, env);
        case "POST /api/focus":
          return await handleFocus(request, env);
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
