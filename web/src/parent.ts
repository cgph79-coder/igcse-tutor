import "katex/dist/katex.min.css";
import "./styles.css";
import { getJson, login, ApiError } from "./api";
import { WORKER_URL } from "./config";
import { renderMarkdown } from "./render";
import { el, initTheme } from "./ui";
import { startUpdateCheck } from "./update-check";
import { cleanCareer, coverage, followUps, nextRankNeeds, rankOf } from "../../shared/career";
import { findSyllabus, findTopic } from "../../syllabus/index";
import { EXAM_DATE } from "./config";

interface SessionSummary {
  key: string;
  updatedAt?: string;
  subject?: string;
  topic?: string;
  mode?: string;
  flagged?: boolean;
  count?: number;
}
interface FocusDay {
  day: string;
  minutes: number;
  blocks: number;
  subjects: Record<string, number>;
}
interface SessionsResponse {
  sessions: SessionSummary[];
  /** Last 14 days (UK), newest first. Older deploys of the Worker don't send it. */
  focus?: FocusDay[];
  /** The Dispatches career (progress only); null until he plays, missing on older Worker deploys. */
  career?: unknown;
  usageToday: { requests: number; tokens: number };
  limits: { requests: number; tokens: number };
  retentionDays: number;
}
interface FeedbackItem {
  id: string;
  at: string;
  area: "tutor" | "arcade" | "timer" | "other";
  text: string;
  context?: { build?: string; view?: string; code?: string; subject?: string; topic?: string; game?: string };
  redactions?: string[];
  flag?: "wellbeing" | "high";
}
interface SessionLog {
  subject: string;
  code: string;
  topic: string;
  tier: string | null;
  mode: string;
  startedAt: string;
  updatedAt: string;
  flags: string[];
  messages: { role: string; content: string; at: string; redactions?: string[] }[];
}

// The parent token lives only for this browser tab (sessionStorage) and expires after 12 hours.
const TOKEN_KEY = "igcse-tutor:parent-token";
let token: string | null = null;
try {
  token = sessionStorage.getItem(TOKEN_KEY);
} catch {
  /* ignore */
}

initTheme();
const root = document.getElementById("app")!;
const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

function setToken(t: string | null) {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function shell(...children: Node[]) {
  const header = el("header", { class: "top" }, el("h1", {}, "IGCSE ", el("span", {}, "Tutor"), " · Parent view"));
  if (token) {
    const out = el("button", { class: "icon-btn" }, "Log out");
    out.addEventListener("click", () => {
      setToken(null);
      showLogin();
    });
    header.append(out);
  }
  root.replaceChildren(el("div", { class: "app" }, header, ...children));
}

function handleError(ex: unknown, panel: HTMLElement) {
  if (ex instanceof ApiError && ex.status === 401) {
    setToken(null);
    showLogin();
    return;
  }
  panel.replaceChildren(el("p", { class: "flag" }, ex instanceof Error ? ex.message : "Something went wrong."));
}

function showLogin() {
  const input = el("input", { type: "password", placeholder: "Parent password", autocomplete: "current-password", "aria-label": "Parent password" }) as HTMLInputElement;
  const err = el("div", { class: "err", role: "alert" });
  const form = el("form", { class: "login" },
    el("h1", {}, "Parent view"),
    el("p", {}, "Review your child's tutor sessions."),
    input,
    el("button", { type: "submit" }, "Log in"),
    err,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      setToken(await login("/api/parent/login", { password: input.value }));
      showList();
    } catch (ex) {
      err.textContent = ex instanceof Error ? ex.message : "Couldn't log in.";
    }
  });
  shell(form);
  input.focus();
}

async function showList() {
  const panel = el("section", { class: "panel parent-list" }, el("p", { class: "meta" }, "Loading…"));
  const feedbackBox = el("div", { class: "feedback-box" });
  shell(panel);
  try {
    const data = await getJson<SessionsResponse>("/api/parent/sessions", token!);
    panel.replaceChildren(
      el("div", { class: "card" },
        el("strong", {}, "Today"),
        el("div", { class: "meta" },
          `${data.usageToday.requests} of ${data.limits.requests} messages · ` +
            `${data.usageToday.tokens.toLocaleString()} of ${data.limits.tokens.toLocaleString()} tokens. ` +
            `Logs are kept for ${data.retentionDays} days.`),
      ),
      ...(data.focus ? focusSection(data.focus) : []),
      ...careerSection(data.career),
      feedbackBox,
      el("h2", {}, `Sessions (${data.sessions.length})`),
    );
    void loadFeedback(feedbackBox);
    const flagged = data.sessions.filter((s) => s.flagged).length;
    if (flagged) panel.append(el("p", { class: "flag" }, `⚠ ${flagged} session(s) flagged for wellbeing or safeguarding.`));
    if (!data.sessions.length) panel.append(el("p", { class: "meta" }, "No sessions yet."));
    for (const s of data.sessions) {
      const card = el("div", { class: "card", tabindex: "0", role: "button" },
        el("strong", {}, `${s.subject ?? ""} — ${s.topic ?? ""}`),
        el("div", { class: "meta" }, `${fmt(s.updatedAt)} · ${s.mode ?? ""} · ${s.count ?? 0} messages`),
        s.flagged ? el("div", { class: "flag" }, "⚠ Flagged") : null,
      );
      const open = () => showSession(s.key);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && open());
      panel.append(card);
    }
  } catch (ex) {
    handleError(ex, panel);
  }
}

/** The Dispatches career: rank, coverage per subject and topics needing a follow-up. */
function careerSection(raw: unknown): HTMLElement[] {
  const c = cleanCareer(raw);
  if (!c || !Object.keys(c.topics).length) return [];
  const next = nextRankNeeds(c);
  const last = Object.values(c.topics).reduce((m, t) => (t.last > m ? t.last : m), "");
  const rows = coverage(c, EXAM_DATE).map((sc) =>
    el("div", { class: "focus-day" },
      el("div", { class: "focus-day-head" },
        el("span", {}, findSyllabus(sc.code)?.subject ?? sc.code),
        el("span", { class: "meta" }, `${sc.atGrade[0]}/${sc.topics} started · ★★ ${sc.atGrade[1]} · ★★★ ${sc.atGrade[2]}`),
      ),
      sc.behind ? el("div", { class: "flag" }, "Behind the pace for the exams") : null,
    ),
  );
  const weak = followUps(c).slice(0, 5).map((f) => {
    const s = findSyllabus(f.code);
    return `${s ? findTopic(s, f.topicId)?.topic.title ?? f.topicId : f.topicId} (${Math.round(f.lastScore * 100)}%)`;
  });
  return [
    el("div", { class: "card focus-card" },
      el("strong", {}, `Dispatches career: ${rankOf(c)}`),
      el("div", { class: "meta" },
        (next ? `Next: ${next.rank} (needs ${next.text}). ` : "Top rank reached. ") + `Last played ${fmt(last)}.`),
      ...rows,
      weak.length ? el("div", { class: "meta" }, `Needs a follow-up: ${weak.join("; ")}.`) : null,
    ),
    el("p", { class: "meta" }, "Each topic has three levels (★); he clears one with 80%+ on a finished run. Only progress is stored, nothing he types."),
  ];
}

function duration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Study-timer time per day: totals and subjects only, no content. */
function focusSection(days: FocusDay[]): HTMLElement[] {
  const week = days.slice(0, 7);
  const prevWeek = days.slice(7, 14);
  const sum = (ds: FocusDay[]) => ds.reduce((n, d) => n + d.minutes, 0);
  const max = Math.max(...week.map((d) => d.minutes), 1);
  const dayName = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

  const card = el("div", { class: "card focus-card" },
    el("strong", {}, `Last 7 days: ${duration(sum(week))} focused`),
    el("div", { class: "meta" },
      `${week.reduce((n, d) => n + d.blocks, 0)} focus blocks · previous 7 days: ${duration(sum(prevWeek))}`),
  );
  for (const d of week) {
    const subjects = Object.entries(d.subjects).sort((a, b) => b[1] - a[1]).map(([s, m]) => `${s} ${duration(m)}`).join(" · ");
    card.append(el("div", { class: "focus-day" },
      el("div", { class: "focus-day-head" },
        el("span", {}, dayName(d.day)),
        el("span", { class: "meta" }, d.minutes ? `${duration(d.minutes)} · ${d.blocks} block${d.blocks === 1 ? "" : "s"}` : "—"),
      ),
      el("div", { class: "bar" }, el("div", { style: `width:${Math.round((d.minutes / max) * 100)}%` })),
      subjects ? el("div", { class: "meta" }, subjects) : null,
    ));
  }
  return [
    el("h2", {}, "Study timer"),
    card,
    el("p", { class: "meta" }, "Completed focus blocks from the study timer. Blocks done offline appear once his device reconnects."),
  ];
}

const AREA_LABEL: Record<FeedbackItem["area"], string> = { tutor: "Tutor", arcade: "Arcade", timer: "Timer", other: "Other" };

/** A row for the feedback log table in docs/ROADMAP.md, ready to paste. */
function logRow(f: FeedbackItem): string {
  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const where = [f.context?.subject, f.context?.topic, f.context?.game].filter(Boolean).join(" · ");
  const area = AREA_LABEL[f.area] + (where ? ` (${where})` : "");
  return `| F? | ${f.at.slice(0, 10)} | Student (app) | ${cell(area)} | ${cell(f.text)} | ? | new |`;
}

async function copy(text: string, button: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied ✓";
  } catch {
    window.prompt("Copy this row:", text);
  }
}

async function loadFeedback(box: HTMLElement) {
  let items: FeedbackItem[];
  try {
    items = (await getJson<{ feedback: FeedbackItem[] }>("/api/parent/feedback", token!)).feedback;
  } catch (ex) {
    if (ex instanceof ApiError && ex.status === 401) return handleError(ex, box);
    return box.replaceChildren(); // older Worker without feedback: just leave it out
  }
  const flagged = items.filter((f) => f.flag).length;
  box.replaceChildren(
    el("h2", {}, `Feedback (${items.length})`),
    el("p", { class: "meta" },
      items.length
        ? "Copy a row into the Feedback log in docs/ROADMAP.md, then press Done to clear it."
        : "No feedback yet. He can send it from Progress or the Arcade results screen."),
    flagged ? el("p", { class: "flag" }, `⚠ ${flagged} item(s) mention wellbeing or safety. Please read them.`) : "",
  );
  for (const f of items) {
    const ctx = f.context;
    const details = [ctx?.subject, ctx?.topic, ctx?.game, ctx?.view && `screen: ${ctx.view}`, ctx?.build && `version ${ctx.build}`]
      .filter(Boolean)
      .join(" · ");
    const copyBtn = el("button", { type: "button", class: "icon-btn" }, "Copy as log row");
    copyBtn.addEventListener("click", () => copy(logRow(f), copyBtn));
    const done = el("button", { type: "button", class: "icon-btn" }, "Done");
    const card = el("div", { class: "card" },
      el("div", { class: "feedback-head" },
        el("strong", {}, AREA_LABEL[f.area]),
        el("span", { class: "meta" }, fmt(f.at)),
      ),
      f.flag ? el("div", { class: "flag" }, f.flag === "high" ? "⚠ Safeguarding words: please read and check in with him" : "⚠ Mentions wellbeing") : null,
      el("p", { class: "feedback-text" }, f.text),
      details ? el("div", { class: "meta" }, details) : null,
      f.redactions?.length ? el("div", { class: "meta" }, `Removed for privacy: ${f.redactions.join(", ")}`) : null,
      el("div", { class: "feedback-actions" }, copyBtn, done),
    );
    done.addEventListener("click", async () => {
      done.setAttribute("disabled", "");
      try {
        const res = await fetch(WORKER_URL + "/api/parent/feedback/done", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: f.id }),
        });
        if (!res.ok) throw new Error();
        card.remove();
        const h = box.querySelector("h2");
        if (h) h.textContent = `Feedback (${box.querySelectorAll(".card").length})`;
      } catch {
        done.removeAttribute("disabled");
        done.textContent = "Try again";
      }
    });
    box.append(card);
  }
}

async function showSession(key: string) {
  const back = el("button", { class: "icon-btn" }, "← All sessions");
  back.addEventListener("click", showList);
  const panel = el("section", { class: "panel" }, back, el("p", { class: "meta" }, "Loading…"));
  shell(panel);
  try {
    const log = await getJson<SessionLog>(`/api/parent/session?key=${encodeURIComponent(key)}`, token!);
    panel.replaceChildren(
      back,
      el("h2", {}, `${log.subject} (${log.code}) — ${log.topic}`),
      el("p", { class: "meta" }, `${log.mode}${log.tier ? ` · ${log.tier}` : ""} · ${fmt(log.startedAt)} to ${fmt(log.updatedAt)}`),
    );
    if (log.flags.length) {
      panel.append(el("p", { class: "flag" },
        `⚠ ${log.flags.map((f) => (f === "safeguarding-high" ? "Safeguarding concern — fixed Childline reply shown" : "Wellbeing mentioned")).join("; ")}`));
    }
    for (const m of log.messages) {
      const body = el("div", {});
      if (m.role === "assistant") body.innerHTML = renderMarkdown(m.content.replace(/\[\[\s*SCORE:[^\]]*\]\]/gi, ""));
      else body.textContent = m.content;
      panel.append(el("div", { class: "log-msg" },
        el("div", { class: "who" }, `${m.role === "user" ? "Student" : "Tutor"} · ${fmt(m.at)}` +
          (m.redactions?.length ? ` · removed: ${m.redactions.join(", ")}` : "")),
        body,
      ));
    }
  } catch (ex) {
    handleError(ex, panel);
  }
}

if (token) showList();
else showLogin();
startUpdateCheck(() => true);
