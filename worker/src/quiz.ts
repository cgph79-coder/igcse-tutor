/**
 * Recall cards for the arcade games: a question set of their own, separate from the
 * tutor's Practise and Quick quiz modes. The model writes original cards as strict JSON;
 * we validate every field, shuffle the options, and keep a small bank per topic in KV so
 * most rounds cost nothing.
 */
import type { Syllabus, Section, Topic } from "../../syllabus/index";

export interface McqQuestion {
  q: string;
  options: string[];
  answer: number;
  explain: string;
  /** 1 = core essentials, 2 = finer detail, 3 = precise distinctions between close ideas. */
  level: 1 | 2 | 3;
}

// Limits leave room for LaTeX markup; the prompt asks for much shorter text.
export const MAX_Q = 160;
export const MAX_OPTION = 60;
export const MAX_EXPLAIN = 240;
/** Negative or catch-all questions don't work as quick recall cards. */
const UNSUITED_Q = [/\b(NOT|EXCEPT)\b/, /\bwhich\b[^?]*\b(not|isn't|is incorrect|is false)\b|\btrue or false\b/i];
const BANK_MAX = 80;
const BANK_TTL = 60 * 60 * 24 * 30; // 30 days
/** With at least this many banked questions, most rounds are served from the bank. */
const BANK_SERVE_MIN = 30;

/**
 * The arcade uses its own question set: quick "confirmation" cards, like flashcards with four
 * answers. They check he can instantly recall the key facts of a topic he has already studied.
 * They are not exam questions, and they don't teach. Each card has a level (1–3) so a round can
 * get harder as it goes; the game adds time pressure on top.
 */
export function buildQuizPrompt(o: { syllabus: Syllabus; section: Section; topic: Topic; tier: string | null; count: number }): string {
  const { syllabus: s, section, topic } = o;
  const isCore = s.tiers && (o.tier ?? s.defaultTier) === "Core";
  const content = [...topic.subtopics, ...(isCore ? [] : (topic.extended ?? []))];
  const tierLabel = s.tiers ? `${o.tier ?? s.defaultTier} tier` : "single tier";
  return `You write recall cards for a revision arcade game. The student is 16 and studying ${s.boardName} IGCSE ${s.subject} (${s.code}), ${tierLabel}.
Topic: ${section.title} → ${topic.title}.
Syllabus content for this topic: ${content.join("; ")}.
Course notes: ${s.notes}

PURPOSE: these work like flashcards with four answers. They confirm he can instantly recall the key facts of a topic he has already studied. They are NOT exam questions and NOT a lesson. He answers each one in a few seconds while the answers drift towards him on screen.

Write ${o.count} ORIGINAL cards. Each card tests ONE core fact he must know cold for this topic, such as:
- a key term from its definition, or the definition from its term
- a formula, equation, unit, symbol or standard result
- a rule, law, property or classification
- a cause, effect, consequence or example that the syllabus expects him to know
- a key date, person or event (History), or a keyword, data type or pseudocode construct (Computer Science)
- a value he can see without working, e.g. the next term of 2, 5, 8, …

Rules:
- Readable at a glance: a question under 100 characters, every option under 30 characters (a word, short phrase, number or short formula).
- He must be able to recognise the answer immediately. No calculations beyond mental arithmetic you can do instantly, no multi-step reasoning, no "show that", no data or graphs.
- Phrase every question positively. Never "Which is NOT…", "EXCEPT", "true or false", "all of the above" or "none of the above".
- The 4 options are the same kind of thing with a similar length, so the right one doesn't stand out. Wrong options are common confusions or mix-ups for this topic.
- Exactly one option is correct, and no other option could reasonably be argued to be correct. Make sure every fact is accurate and on this syllabus${s.tiers ? " and tier" : ""}.
- Be exact with dates, names, numbers and titles. Where a fact is often confused (e.g. an organisation founded under one name and renamed later, or a person holding two titles), word the question so only one answer fits, or choose a different fact.
- Avoid "main", "most" or "best" questions unless the answer is the standard textbook one.
- Every wrong option must be a real, plausible item of the same kind (a real person, date, term or value). No filler such as "X's deputy" or joke options.
- The explanation must agree with the marked answer.
- Cover the whole topic: no two cards test the same fact.
- Give every card a "level", still as quick recall (harder means more precise, not longer):
  1 = the essentials anyone revising this topic must know;
  2 = finer detail: exact wording, conditions, units, less obvious terms;
  3 = precise distinctions between closely related ideas, where the wrong options are very tempting${s.tiers && !isCore ? " (Extended content fits here)" : ""}.
  Write roughly a third at each level.
- Use LaTeX for maths: $...$ inline only. No Markdown, images or tables.
- "explain" is the fact to remember, in one short sentence (under 150 characters), like the back of a flashcard.
- Don't copy past-paper questions.

Reply with ONLY this JSON, nothing else:
{"questions":[{"q":"...","options":["...","...","...","..."],"answer":0,"explain":"...","level":1}]}
"answer" is the 0-based index of the correct option. "level" is 1, 2 or 3.`;
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

/** Validate one question; returns null if anything is off. */
export function validateQuestion(raw: unknown): McqQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const q = cleanString(r.q, MAX_Q);
  const explain = cleanString(r.explain, MAX_EXPLAIN) ?? "";
  if (!q || UNSUITED_Q.some((re) => re.test(q)) || !Array.isArray(r.options) || r.options.length !== 4) return null;
  const options = r.options.map((o) => cleanString(typeof o === "number" ? String(o) : o, MAX_OPTION));
  if (options.some((o) => o === null)) return null;
  if (new Set(options.map((o) => o!.toLowerCase())).size !== 4) return null;
  if (options.some((o) => /\b(all|none) of the above\b/i.test(o!))) return null;
  const answer = Number(r.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null;
  const lv = Number(r.level);
  const level = (lv === 1 || lv === 2 || lv === 3 ? lv : 2) as 1 | 2 | 3;
  return { q, options: options as string[], answer, explain, level };
}

/** Pull the questions out of a model reply (tolerates code fences or chatter around the JSON). */
export function parseQuestions(text: string): McqQuestion[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (data as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: McqQuestion[] = [];
  for (const item of list) {
    const v = validateQuestion(item);
    if (v && !seen.has(v.q.toLowerCase())) {
      seen.add(v.q.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

/** Shuffle the options so the correct answer isn't always in the same place. */
export function shuffleOptions(q: McqQuestion, rand = Math.random): McqQuestion {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

/**
 * Pick a round that gets harder as it goes: about 30% level 1, 40% level 2, 30% level 3
 * (topped up from other levels if one is short), ordered easiest first, shuffled within a level.
 */
export function buildRound(pool: McqQuestion[], n: number, rand = Math.random): McqQuestion[] {
  const byLevel = [1, 2, 3].map((l) => sample(pool.filter((q) => q.level === l), pool.length, rand));
  const want = [Math.round(n * 0.3), n - Math.round(n * 0.3) * 2, Math.round(n * 0.3)];
  const picked: McqQuestion[] = [];
  byLevel.forEach((list, i) => picked.push(...list.splice(0, want[i])));
  const rest = sample(byLevel.flat(), n, rand);
  picked.push(...rest.slice(0, Math.max(0, n - picked.length)));
  return picked.sort((a, b) => a.level - b.level);
}

export function sample<T>(list: T[], n: number, rand = Math.random): T[] {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function bankKey(code: string, tier: string | null, topicId: string) {
  // "cards" keeps the arcade's own set apart from anything else; bump the version if the card style changes.
  return `qbank:cards-v3:${code}:${tier ?? "-"}:${topicId}`;
}

export async function readBank(kv: KVNamespace, key: string): Promise<McqQuestion[]> {
  const raw = await kv.get<unknown>(key, "json");
  if (!Array.isArray(raw)) return [];
  return raw.map(validateQuestion).filter((q): q is McqQuestion => q !== null);
}

export async function addToBank(kv: KVNamespace, key: string, fresh: McqQuestion[]): Promise<void> {
  const bank = await readBank(kv, key);
  const seen = new Set(bank.map((q) => q.q.toLowerCase()));
  for (const q of fresh) if (!seen.has(q.q.toLowerCase())) bank.push(q);
  await kv.put(key, JSON.stringify(bank.slice(-BANK_MAX)), { expirationTtl: BANK_TTL });
}

/** Serve from the bank most of the time once it's big enough, so the questions stay varied but cheap. */
export function shouldServeFromBank(bankSize: number, count: number, rand = Math.random): boolean {
  return bankSize >= Math.max(BANK_SERVE_MIN, count) && rand() < 0.75;
}

/**
 * Second pass: the model checks a batch of cards before they are used or saved. A card stays
 * only if the checker explicitly passes it, so a garbled or missing verdict counts as a reject.
 */
export function buildCheckPrompt(o: { syllabus: Syllabus; section: Section; topic: Topic; tier: string | null }, cards: McqQuestion[]): string {
  const { syllabus: s, section, topic } = o;
  const list = cards
    .map((c, i) => `${i}. ${c.q}\n   Options: ${c.options.map((x, j) => `(${j}) ${x}`).join("  ")}\n   Marked correct: (${c.answer})\n   Explanation: ${c.explain}`)
    .join("\n");
  return `You are a careful ${s.boardName} IGCSE ${s.subject} (${s.code}) examiner checking revision cards for a 16-year-old before he sees them.
Topic: ${section.title} → ${topic.title}.

Each card is a quick four-option recall question. REJECT a card if ANY of these is true:
- The marked answer is wrong, or is not the best answer.
- Another option could also reasonably be marked correct (for example a different but defensible date, name or title).
- A date, number, name or term in the question, options or explanation is inaccurate, or the explanation contradicts the marked answer.
- The question depends on opinion ("main", "most", "best") and the marked answer isn't the standard textbook answer.
- An option is obvious filler that nobody would choose (e.g. "X's deputy", a joke option).
- It tests the same fact as an earlier card in this list.
- It is outside this topic or beyond IGCSE level.
Otherwise PASS it. When unsure, REJECT. Check each fact yourself; don't trust the explanation.

Cards:
${list}

Reply with ONLY this JSON, one verdict per card, nothing else:
{"verdicts":[{"i":0,"ok":true},{"i":1,"ok":false,"reason":"short reason"}]}`;
}

/** Indices of the cards the checker passed. Anything unclear is treated as rejected; null if the reply is unusable. */
export function parseVerdicts(text: string, count: number): Set<number> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (data as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(list)) return null;
  const passed = new Set<number>();
  for (const v of list) {
    const r = v as { i?: unknown; ok?: unknown };
    const i = Number(r?.i);
    if (Number.isInteger(i) && i >= 0 && i < count && r.ok === true) passed.add(i);
  }
  return passed;
}
