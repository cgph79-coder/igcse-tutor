import "katex/dist/katex.min.css";
import "./styles.css";
import { getJson, login, ApiError } from "./api";
import { renderMarkdown } from "./render";
import { el, initTheme } from "./ui";
import { startUpdateCheck } from "./update-check";

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
  usageToday: { requests: number; tokens: number };
  limits: { requests: number; tokens: number };
  retentionDays: number;
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
      el("h2", {}, `Sessions (${data.sessions.length})`),
    );
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
