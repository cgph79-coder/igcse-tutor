/**
 * Dispatches career: one career across every subject, kept on the device and on the Worker.
 * Shared by the web app and the Worker so both validate and merge it the same way.
 *
 * Each topic has a grade, 0–3. A run on a topic is played at the next level up (grade + 1,
 * at most 3). Finishing a run with 80%+ correct clears that level and raises the grade.
 * The career rank comes from grades across subjects, so promotion needs breadth.
 *
 * It holds progress only: grades, run counts, dates and the last score per topic. Never
 * anything he typed.
 */
import { SYLLABUSES } from "../syllabus/index";

export type Grade = 0 | 1 | 2 | 3;
export type Level = 1 | 2 | 3;

export interface TopicCareer {
  grade: Grade;
  runs: number;
  /** When it was last played (ISO). */
  last: string;
  /** Fraction correct on the last run, 0–1. */
  lastScore: number;
  /** Best mark at the Editor's desk (exam-style written answers), 0–1, if attempted. */
  exam?: number;
}

export interface Career {
  v: 1;
  started: string;
  updated: string;
  /** Keyed by `${code}:${topicId}`. */
  topics: Record<string, TopicCareer>;
}

export const CLEAR_FRACTION = 0.8;
/** The Editor's desk (exam-style questions marked by the tutor) opens on a topic at this grade. */
export const EXAM_UNLOCK_GRADE: Grade = 3;
/** A mark at or above this share of the marks counts as an Editor's desk pass (✍ on the map). */
export const EXAM_PASS = 0.7;
/** A topic needs a follow-up story when its last run went badly and it hasn't been played for this long. */
export const FOLLOW_UP_BELOW = 0.6;
export const FOLLOW_UP_AFTER_DAYS = 2;

export const RANKS = ["Cub reporter", "Staff reporter", "Senior correspondent", "Editor"] as const;
export type RankName = (typeof RANKS)[number];

/**
 * Promotion rules: how many topics need at least a given grade, and in how many subjects.
 * There are 81 topics across the four subjects (Nov 2026).
 */
export const PROMOTIONS: Array<{ rank: number; grade: Grade; topics: number; perSubject: number; subjects: number }> = [
  { rank: 1, grade: 1, topics: 8, perSubject: 1, subjects: 2 },
  { rank: 2, grade: 2, topics: 20, perSubject: 2, subjects: 4 },
  { rank: 3, grade: 3, topics: 30, perSubject: 4, subjects: 4 },
];

export const topicKey = (code: string, topicId: string) => `${code}:${topicId}`;

/** Every topic in the app, per syllabus code. */
export function topicsByCode(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of SYLLABUSES) out[s.code] = s.sections.flatMap((sec) => sec.topics.map((t) => t.id));
  return out;
}

function knownTopic(key: string): boolean {
  const [code, topicId] = key.split(":");
  return !!topicsByCode()[code]?.includes(topicId);
}

export function emptyCareer(now = new Date()): Career {
  const t = now.toISOString();
  return { v: 1, started: t, updated: t, topics: {} };
}

function isoOr(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

/** Validate a career from storage or the network. Unknown topics and bad values are dropped. */
export function cleanCareer(raw: unknown, now = new Date()): Career | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !r.topics || typeof r.topics !== "object") return null;
  const nowIso = now.toISOString();
  const topics: Record<string, TopicCareer> = {};
  for (const [key, val] of Object.entries(r.topics as Record<string, unknown>).slice(0, 500)) {
    if (!knownTopic(key) || !val || typeof val !== "object") continue;
    const t = val as Record<string, unknown>;
    const grade = Number(t.grade);
    const runs = Number(t.runs);
    const lastScore = Number(t.lastScore);
    if (![0, 1, 2, 3].includes(grade) || !Number.isInteger(runs) || runs < 0) continue;
    const exam = Number(t.exam);
    topics[key] = {
      grade: grade as Grade,
      runs: Math.min(runs, 100000),
      last: isoOr(t.last, nowIso),
      lastScore: Number.isFinite(lastScore) ? Math.min(1, Math.max(0, lastScore)) : 0,
      ...(t.exam !== undefined && Number.isFinite(exam) ? { exam: Math.min(1, Math.max(0, exam)) } : {}),
    };
  }
  return { v: 1, started: isoOr(r.started, nowIso), updated: isoOr(r.updated, nowIso), topics };
}

/**
 * Combine two copies (device and Worker). Grades only ever go up, so taking the higher grade
 * never loses progress, whichever copy is newer. The rest comes from the more recent play.
 */
export function mergeCareers(a: Career | null, b: Career | null): Career {
  if (!a) return b ?? emptyCareer();
  if (!b) return a;
  const topics: Record<string, TopicCareer> = { ...a.topics };
  for (const [key, tb] of Object.entries(b.topics)) {
    const ta = topics[key];
    if (!ta) {
      topics[key] = tb;
      continue;
    }
    const recent = tb.last > ta.last ? tb : ta;
    const exam = Math.max(ta.exam ?? -1, tb.exam ?? -1);
    topics[key] = {
      grade: Math.max(ta.grade, tb.grade) as Grade,
      runs: Math.max(ta.runs, tb.runs),
      last: recent.last,
      lastScore: recent.lastScore,
      ...(exam >= 0 ? { exam } : {}),
    };
  }
  return {
    v: 1,
    started: a.started < b.started ? a.started : b.started,
    updated: a.updated > b.updated ? a.updated : b.updated,
    topics,
  };
}

export function gradeOf(c: Career, code: string, topicId: string): Grade {
  return c.topics[topicKey(code, topicId)]?.grade ?? 0;
}

/** The level his next run on this topic is played at. */
export function levelFor(c: Career, code: string, topicId: string): Level {
  return Math.min(3, gradeOf(c, code, topicId) + 1) as Level;
}

export interface RunResult {
  code: string;
  topicId: string;
  level: Level;
  got: number;
  total: number;
  /** False if he was sent home, recalled or left early. */
  finished: boolean;
}

/** Record a finished run. Returns the new career and what changed. */
export function recordRun(
  c: Career,
  r: RunResult,
  now = new Date(),
): { career: Career; cleared: boolean; newGrade: Grade; promotedTo: RankName | null } {
  const key = topicKey(r.code, r.topicId);
  const before = c.topics[key] ?? { grade: 0 as Grade, runs: 0, last: now.toISOString(), lastScore: 0 };
  const score = r.total > 0 ? r.got / r.total : 0;
  const cleared = r.finished && r.total > 0 && score >= CLEAR_FRACTION;
  const grade = (cleared && r.level > before.grade ? r.level : before.grade) as Grade;
  const career: Career = {
    ...c,
    updated: now.toISOString(),
    topics: { ...c.topics, [key]: { grade, runs: before.runs + 1, last: now.toISOString(), lastScore: score } },
  };
  const was = rankIndex(c);
  const is = rankIndex(career);
  return { career, cleared, newGrade: grade, promotedTo: is > was ? RANKS[is] : null };
}

export function examUnlocked(c: Career, code: string, topicId: string): boolean {
  return gradeOf(c, code, topicId) >= EXAM_UNLOCK_GRADE;
}

/** Record a marked Editor's desk attempt (best mark is kept). */
export function recordExam(c: Career, code: string, topicId: string, fraction: number, now = new Date()): { career: Career; best: boolean } {
  const key = topicKey(code, topicId);
  const before = c.topics[key];
  if (!before) return { career: c, best: false };
  const f = Math.min(1, Math.max(0, fraction));
  const best = before.exam === undefined || f > before.exam;
  return {
    career: { ...c, updated: now.toISOString(), topics: { ...c.topics, [key]: { ...before, exam: best ? f : before.exam } } },
    best,
  };
}

/** Topics with an Editor's desk pass, per syllabus code. */
export function examPasses(c: Career): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, t] of Object.entries(c.topics)) {
    if ((t.exam ?? 0) < EXAM_PASS) continue;
    const code = key.split(":")[0];
    out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

/** Topics at or above a grade, per syllabus code. */
function countAtGrade(c: Career, grade: Grade): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, t] of Object.entries(c.topics)) {
    if (t.grade < grade) continue;
    const code = key.split(":")[0];
    out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

function meets(c: Career, p: (typeof PROMOTIONS)[number]): boolean {
  const counts = countAtGrade(c, p.grade);
  const total = Object.values(counts).reduce((n, x) => n + x, 0);
  const subjects = Object.values(counts).filter((x) => x >= p.perSubject).length;
  return total >= p.topics && subjects >= p.subjects;
}

export function rankIndex(c: Career): number {
  let rank = 0;
  for (const p of PROMOTIONS) {
    if (!meets(c, p)) break;
    rank = p.rank;
  }
  return rank;
}

export function rankOf(c: Career): RankName {
  return RANKS[rankIndex(c)];
}

const STARS = ["", "★", "★★", "★★★"];

/** What he needs for the next rank, in words; null at the top. */
export function nextRankNeeds(c: Career): { rank: RankName; text: string; done: number; needed: number } | null {
  const p = PROMOTIONS.find((x) => x.rank === rankIndex(c) + 1);
  if (!p) return null;
  const counts = countAtGrade(c, p.grade);
  const done = Math.min(p.topics, Object.values(counts).reduce((n, x) => n + x, 0));
  const subjectsOk = Object.values(counts).filter((x) => x >= p.perSubject).length;
  const parts = [`${p.topics} topics at ${STARS[p.grade]} (${done} so far)`];
  parts.push(
    p.subjects === 4
      ? `at least ${p.perSubject} in every subject`
      : `in at least ${p.subjects} subjects`,
  );
  if (subjectsOk < p.subjects && p.subjects < 4) parts[1] += ` (${subjectsOk} so far)`;
  return { rank: RANKS[p.rank], text: parts.join(", "), done, needed: p.topics };
}

/** Topics whose last run went badly a couple of days ago or more, worst first. */
export function followUps(c: Career, now = new Date()): Array<{ code: string; topicId: string; lastScore: number }> {
  const cutoff = now.getTime() - FOLLOW_UP_AFTER_DAYS * 86400000;
  return Object.entries(c.topics)
    .filter(([, t]) => t.lastScore < FOLLOW_UP_BELOW && new Date(t.last).getTime() <= cutoff)
    .map(([key, t]) => {
      const [code, topicId] = key.split(":");
      return { code, topicId, lastScore: t.lastScore };
    })
    .sort((a, b) => a.lastScore - b.lastScore);
}

export interface SubjectCoverage {
  code: string;
  topics: number;
  /** Topics at each grade or above: [≥1, ≥2, ≥3]. */
  atGrade: [number, number, number];
  /** Share of topics started (grade ≥ 1), 0–1. */
  coverage: number;
  /** True if coverage is well behind the time gone between starting the career and the exams. */
  behind: boolean;
}

/** Coverage per subject, and whether it's falling behind the exam calendar. */
export function coverage(c: Career, examDate: string, now = new Date()): SubjectCoverage[] {
  const start = new Date(c.started).getTime();
  const end = new Date(examDate).getTime();
  const elapsed = end > start ? Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))) : 1;
  return Object.entries(topicsByCode()).map(([code, ids]) => {
    const grades = ids.map((id) => gradeOf(c, code, id));
    const atGrade: [number, number, number] = [1, 2, 3].map((g) => grades.filter((x) => x >= g).length) as [number, number, number];
    const cov = ids.length ? atGrade[0] / ids.length : 0;
    // A little slack, and no nagging in the first fortnight.
    const behind = now.getTime() - start > 14 * 86400000 && cov < elapsed - 0.15;
    return { code, topics: ids.length, atGrade, coverage: cov, behind };
  });
}

export function weeksUntil(examDate: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(examDate).getTime() - now.getTime()) / (7 * 86400000)));
}
