import "katex/dist/katex.min.css";
import "./styles.css";
import { SYLLABUSES, findSyllabus, findTopic, type Syllabus } from "../../syllabus/index";
import { ApiError, loginAs, streamChat, type ChatMessage } from "./api";
import { extractScore, renderMarkdown } from "./render";
import { LocalProgressStore, prefs, type ProgressStore } from "./storage";
import { applyTheme, el, initTheme, nextTheme } from "./ui";
import { startUpdateCheck } from "./update-check";
import { formatDuration, initPomodoro, timerBar, timerButton } from "./pomodoro";
import { installCard, registerServiceWorker } from "./install";
import { flushFocus, queueFocus, startFocusSync } from "./focus-sync";
import { feedbackButton } from "./feedback";
import { ACCEPT, MAX_PHOTOS, onAttachmentWarning, readAttachment, type Attachment } from "./attachments";

type Mode = "learn" | "practise" | "mark" | "quiz";
const MODES: { id: Mode; label: string }[] = [
  { id: "learn", label: "Learn" },
  { id: "practise", label: "Practise" },
  { id: "mark", label: "Mark my answer" },
  { id: "quiz", label: "Quick quiz" },
];
const COMMAND_WORDS = ["state", "describe", "explain", "calculate", "suggest", "compare", "evaluate", "how far do you agree"];

const store: ProgressStore = new LocalProgressStore();

const state = {
  token: prefs.get("token"),
  view: "chat" as "chat" | "progress" | "arcade",
  code: prefs.get("code") ?? SYLLABUSES[0].code,
  tier: prefs.get("tier"),
  topicId: prefs.get("topic") ?? "",
  mode: (prefs.get("mode") as Mode) ?? "learn",
  difficulty: prefs.get("difficulty") ?? "standard",
  commandWord: prefs.get("commandWord") ?? "explain",
  setupOpen: true,
  sessionId: newSessionId(),
  messages: [] as ChatMessage[],
  busy: false,
  recorded: false,
  attachments: [] as Attachment[],
};

// The open conversation is kept on this device so a reload or refresh doesn't lose it.
// Photos are not kept (too large, and more private this way).
const CONVO_KEY = "conversation";
const CONVO_MAX_AGE = 24 * 60 * 60 * 1000;

function saveConversation() {
  if (!state.messages.length) return prefs.set(CONVO_KEY, null);
  const messages = state.messages.map((m) =>
    m.images?.length ? { role: m.role, content: `${m.content}\n📷 ${m.images.length} photo(s) — not kept after reload` } : m,
  );
  try {
    prefs.set(CONVO_KEY, JSON.stringify({ savedAt: Date.now(), sessionId: state.sessionId, recorded: state.recorded, messages }));
  } catch {
    /* storage full — conversation just won't survive a reload */
  }
}

function restoreConversation() {
  try {
    const raw = prefs.get(CONVO_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { savedAt: number; sessionId: string; recorded: boolean; messages: ChatMessage[] };
    if (Date.now() - saved.savedAt > CONVO_MAX_AGE || !Array.isArray(saved.messages)) return prefs.set(CONVO_KEY, null);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(saved.sessionId)) return prefs.set(CONVO_KEY, null);
    state.sessionId = saved.sessionId as typeof state.sessionId;
    state.recorded = saved.recorded;
    state.messages = saved.messages;
    state.setupOpen = state.messages.length === 0;
  } catch {
    prefs.set(CONVO_KEY, null);
  }
}

function newSessionId() {
  return crypto.randomUUID();
}

function syllabus(): Syllabus {
  return findSyllabus(state.code) ?? SYLLABUSES[0];
}

function currentTier(s = syllabus()): string | null {
  if (!s.tiers) return null;
  return state.tier && s.tiers.includes(state.tier) ? state.tier : s.defaultTier;
}

function visibleTopics(s = syllabus()) {
  const tier = currentTier(s);
  return s.sections.map((sec) => ({
    ...sec,
    topics: sec.topics.filter((t) => !(t.tier === "extended" && tier === "Core")),
  }));
}

function ensureTopic() {
  const s = syllabus();
  const all = visibleTopics(s).flatMap((sec) => sec.topics);
  if (!all.some((t) => t.id === state.topicId)) state.topicId = all[0]?.id ?? "";
}

function savePrefs() {
  prefs.set("code", state.code);
  prefs.set("tier", state.tier);
  prefs.set("topic", state.topicId);
  prefs.set("mode", state.mode);
  prefs.set("difficulty", state.difficulty);
  prefs.set("commandWord", state.commandWord);
}

function resetConversation() {
  state.sessionId = newSessionId();
  state.messages = [];
  state.recorded = false;
  saveConversation();
}

// ---------------- rendering ----------------

const root = document.getElementById("app")!;
initTheme();

let teardownView: (() => void) | null = null;

function render() {
  teardownView?.();
  teardownView = null;
  root.replaceChildren(state.token ? appView() : loginView());
}

function logOut() {
  prefs.set("token", null);
  state.token = null;
  render();
}

function loginView() {
  const input = el("input", { type: "password", placeholder: "Passcode", autocomplete: "current-password", "aria-label": "Passcode" }) as HTMLInputElement;
  const err = el("div", { class: "err", role: "alert" });
  const btn = el("button", { type: "submit" }, "Start studying");
  const form = el("form", { class: "login" },
    el("h1", {}, "IGCSE ", el("span", { style: "color:var(--accent)" }, "Tutor")),
    el("p", {}, "Enter the passcode to begin."),
    input, btn, err,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    btn.setAttribute("disabled", "");
    try {
      const who = await loginAs("/api/login", { passcode: input.value });
      // A different user on this device (e.g. a parent testing): don't mix their careers.
      if ((prefs.get("user") ?? "student") !== who.user) prefs.set("career:v1", null);
      prefs.set("user", who.user);
      state.token = who.token;
      prefs.set("token", state.token);
      render();
      void flushFocus(state.token);
    } catch (ex) {
      err.textContent = ex instanceof Error ? ex.message : "Couldn't log in.";
    } finally {
      btn.removeAttribute("disabled");
    }
  });
  setTimeout(() => input.focus(), 0);
  return el("div", { class: "app" }, form);
}

function appView() {
  ensureTopic();
  const themeBtn = el("button", { class: "icon-btn", title: "Switch light/dark", "aria-label": "Switch light or dark mode" }, "◐");
  themeBtn.addEventListener("click", () => applyTheme(nextTheme()));
  const progressBtn = el("button", { class: "icon-btn", "aria-pressed": String(state.view === "progress") }, "Progress");
  progressBtn.addEventListener("click", () => {
    state.view = state.view === "progress" ? "chat" : "progress";
    render();
  });
  const arcadeBtn = el("button", { class: "icon-btn", "aria-pressed": String(state.view === "arcade") }, "Arcade");
  arcadeBtn.addEventListener("click", () => {
    state.view = state.view === "arcade" ? "chat" : "arcade";
    render();
  });
  const newBtn = el("button", { class: "icon-btn", title: "Start a new conversation" }, "New");
  newBtn.addEventListener("click", () => {
    resetConversation();
    state.view = "chat";
    render();
  });

  const header = el("header", { class: "top" },
    el("h1", {}, el("span", { class: "brand-long" }, "IGCSE "), el("span", {}, "Tutor")),
    prefs.get("user") === "tester" ? el("span", { class: "tester-badge", title: "Logged in with the tester passcode: a separate user" }, "Tester") : null,
    newBtn, arcadeBtn, progressBtn, timerButton(), themeBtn,
  );
  const bar = timerBar();

  if (state.view === "arcade") {
    const panel = el("section", { class: "panel arcade" }, el("p", { class: "meta" }, "Loading…"));
    openArcade(panel);
    return el("div", { class: "app" }, header, bar, panel);
  }

  if (state.view === "progress") {
    const panel = el("section", { class: "panel" }, el("p", { class: "meta" }, "Loading…"));
    renderProgress(panel);
    return el("div", { class: "app" }, header, bar, panel);
  }
  return el("div", { class: "app" }, header, bar, setupView(), chatView(), composerView());
}

function setupView() {
  const s = syllabus();
  const wrap = el("section", { class: "setup", "aria-label": "Study settings" });

  const summary = `${s.subject} · ${findTopic(s, state.topicId)?.topic.title ?? ""} · ${MODES.find((m) => m.id === state.mode)?.label}`;
  const toggle = el("button", { class: "collapse-toggle", "aria-expanded": String(state.setupOpen) },
    state.setupOpen ? "Hide settings ▲" : `${summary} ▼`);
  toggle.addEventListener("click", () => {
    state.setupOpen = !state.setupOpen;
    render();
  });
  wrap.append(toggle);
  if (!state.setupOpen) return wrap;

  const changed = () => {
    savePrefs();
    if (state.messages.length) resetConversation();
    render();
  };

  // Subject
  const subjectSel = el("select", { "aria-label": "Subject" }) as HTMLSelectElement;
  for (const sy of SYLLABUSES) subjectSel.append(el("option", { value: sy.code }, `${sy.subject} (${sy.code})`));
  subjectSel.value = state.code;
  subjectSel.addEventListener("change", () => {
    state.code = subjectSel.value;
    state.topicId = "";
    changed();
  });

  // Topic
  const topicSel = el("select", { "aria-label": "Topic" }) as HTMLSelectElement;
  for (const sec of visibleTopics(s)) {
    const group = el("optgroup", { label: sec.title });
    for (const t of sec.topics) group.append(el("option", { value: t.id }, t.title));
    topicSel.append(group);
  }
  topicSel.value = state.topicId;
  topicSel.addEventListener("change", () => {
    state.topicId = topicSel.value;
    changed();
  });

  wrap.append(el("div", { class: "row" },
    el("label", { class: "field" }, "Subject", subjectSel),
    el("label", { class: "field" }, "Topic", topicSel),
  ));

  // Tier
  if (s.tiers) {
    const seg = el("div", { class: "segmented", role: "group", "aria-label": "Tier" });
    for (const t of s.tiers) {
      const b = el("button", { type: "button", "aria-pressed": String(currentTier(s) === t) }, t);
      b.addEventListener("click", () => {
        state.tier = t;
        changed();
      });
      seg.append(b);
    }
    wrap.append(el("label", { class: "field" }, "Tier (Extended is needed for the top grades)", seg));
  }

  // Mode
  const modes = el("div", { class: "segmented", role: "group", "aria-label": "Mode" });
  for (const m of MODES) {
    const b = el("button", { type: "button", "aria-pressed": String(state.mode === m.id) }, m.label);
    b.addEventListener("click", () => {
      state.mode = m.id;
      changed();
    });
    modes.append(b);
  }
  wrap.append(el("label", { class: "field" }, "Mode", modes));

  if (state.mode === "practise") {
    const diff = el("select", { "aria-label": "Difficulty" }) as HTMLSelectElement;
    for (const d of ["foundation", "standard", "challenging"]) diff.append(el("option", { value: d }, d[0].toUpperCase() + d.slice(1)));
    diff.value = state.difficulty;
    diff.addEventListener("change", () => {
      state.difficulty = diff.value;
      savePrefs();
    });
    const cw = el("select", { "aria-label": "Command word" }) as HTMLSelectElement;
    for (const c of COMMAND_WORDS) cw.append(el("option", { value: c }, c[0].toUpperCase() + c.slice(1)));
    cw.value = state.commandWord;
    cw.addEventListener("change", () => {
      state.commandWord = cw.value;
      savePrefs();
    });
    wrap.append(el("div", { class: "row" },
      el("label", { class: "field" }, "Difficulty", diff),
      el("label", { class: "field" }, "Command word", cw),
    ));
  }

  const topic = findTopic(s, state.topicId)?.topic;
  if (topic?.verify || s.verify) {
    wrap.append(el("div", { class: "verify-note" }, "Topic list still being checked against the official syllabus."));
  }
  return wrap;
}

let chatEl: HTMLElement;

function chatView() {
  chatEl = el("main", { class: "chat", "aria-live": "polite" });
  if (state.messages.length === 0) {
    chatEl.append(emptyState());
  } else {
    for (const m of state.messages) chatEl.append(messageBubble(m));
  }
  requestAnimationFrame(() => (chatEl.scrollTop = chatEl.scrollHeight));
  return chatEl;
}

function emptyState() {
  const s = syllabus();
  const topic = findTopic(s, state.topicId)?.topic;
  const starts: Record<Mode, string[]> = {
    learn: ["Teach me this from the start", "I know the basics — test me", "What do examiners look for here?"],
    practise: ["Give me a question"],
    mark: [],
    quiz: ["Start the quiz"],
  };
  const hint: Record<Mode, string> = {
    learn: "I'll explain step by step and check you've got it.",
    practise: "I'll set an original exam-style question, then mark your answer.",
    mark: "Paste or photograph the question (with marks, e.g. [4]) and your answer, and I'll mark it like an examiner. Tap 📎 to add a photo or file.",
    quiz: "Quick-fire recall questions — answer them all in one go.",
  };
  const qs = el("div", { class: "quick-starts" });
  for (const t of starts[state.mode]) {
    const b = el("button", { type: "button" }, t);
    b.addEventListener("click", () => send(t));
    qs.append(b);
  }
  return el("div", { class: "empty" },
    el("h2", {}, topic?.title ?? s.subject),
    el("p", {}, hint[state.mode]),
    qs,
  );
}

function messageBubble(m: ChatMessage, typing = false) {
  const div = el("div", { class: `msg ${m.role}${typing ? " typing" : ""}` });
  fillBubble(div, m);
  return div;
}

function fillBubble(div: HTMLElement, m: ChatMessage) {
  if (m.role === "user") {
    div.textContent = m.content;
    if (m.images?.length) {
      const row = el("div", { class: "thumbs" });
      for (const src of m.images) row.append(el("img", { src, alt: "Photo of work", class: "thumb" }));
      div.append(row);
    }
    return;
  }
  const { text, score } = extractScore(m.content);
  div.innerHTML = renderMarkdown(text);
  if (score) div.append(el("div", { class: "score-chip" }, `Score: ${score.got}/${score.max}`));
}

function addNotice(text: string, kind: "notice" | "error" = "notice") {
  chatEl.querySelector(".empty")?.remove();
  chatEl.append(el("div", { class: `msg ${kind}`, role: kind === "error" ? "alert" : "status" }, text));
  chatEl.scrollTop = chatEl.scrollHeight;
}

let textarea: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;

let trayEl: HTMLElement;

function renderTray() {
  trayEl.replaceChildren();
  trayEl.classList.toggle("hidden", state.attachments.length === 0);
  if (!state.attachments.length) return;
  const items = el("div", { class: "tray-items" });
  state.attachments.forEach((a, i) => {
    const remove = el("button", { type: "button", class: "tray-remove", "aria-label": `Remove ${a.name}` }, "×");
    remove.addEventListener("click", () => {
      state.attachments.splice(i, 1);
      renderTray();
    });
    items.append(el("div", { class: "tray-item" },
      a.kind === "image" ? el("img", { src: a.dataUrl, alt: a.name, class: "thumb" }) : el("span", { class: "file-chip" }, `📄 ${a.name}`),
      remove,
    ));
  });
  trayEl.append(items, el("div", { class: "tray-hint" }, "Crop out your name and school before sending. Photos aren't saved."));
}

function composerView() {
  onAttachmentWarning((msg) => addNotice(msg));
  textarea = el("textarea", {
    rows: "1",
    placeholder: state.mode === "mark" ? "Type, or tap 📎 for a photo…" : "Type your answer or question…",
    "aria-label": "Message",
    enterkeyhint: "send",
  }) as HTMLTextAreaElement;
  sendBtn = el("button", { class: "send-btn", type: "submit" }, "Send") as HTMLButtonElement;

  const fileInput = el("input", { type: "file", accept: ACCEPT, multiple: "", class: "hidden", "aria-hidden": "true" }) as HTMLInputElement;
  const attachBtn = el("button", { type: "button", class: "attach-btn", title: "Add a photo or file", "aria-label": "Add a photo or file" }, "📎") as HTMLButtonElement;
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    attachBtn.disabled = true;
    attachBtn.textContent = "…";
    for (const f of files) {
      try {
        const added = await readAttachment(f);
        for (const a of added) {
          if (a.kind === "image" && state.attachments.filter((x) => x.kind === "image").length >= MAX_PHOTOS) {
            addNotice(`You can send up to ${MAX_PHOTOS} photos at once.`);
            break;
          }
          state.attachments.push(a);
        }
      } catch (ex) {
        addNotice(ex instanceof Error ? ex.message : "Couldn't read that file.", "error");
      }
    }
    attachBtn.disabled = false;
    attachBtn.textContent = "📎";
    renderTray();
  });

  trayEl = el("div", { class: "tray hidden" });
  renderTray();
  const row = el("form", { class: "composer" }, attachBtn, fileInput, textarea, sendBtn) as HTMLFormElement;
  const autosize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", (e) => {
    // Enter sends on desktop; on phones Enter makes a new line and the Send button sends.
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      row.requestSubmit();
    }
  });
  row.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text && state.attachments.length === 0) return;
    const attachments = state.attachments;
    state.attachments = [];
    renderTray();
    textarea.value = "";
    autosize();
    send(text, attachments);
  });
  return el("div", { class: "composer-wrap" }, trayEl, row);
}

/** Only the most recent photos are re-sent; older ones are dropped to keep uploads small. */
function forSending(messages: ChatMessage[]): ChatMessage[] {
  let seen = false;
  return messages
    .slice()
    .reverse()
    .map((m) => {
      if (!m.images?.length) return m;
      if (seen) return { role: m.role, content: m.content };
      seen = true;
      return m;
    })
    .reverse();
}

async function send(text: string, attachments: Attachment[] = []) {
  if (state.busy || !state.token) return;
  const s = syllabus();
  const found = findTopic(s, state.topicId);
  if (!found) return;

  state.busy = true;
  sendBtn.disabled = true;
  if (state.setupOpen && state.messages.length === 0) state.setupOpen = false; // give the chat room on phones
  document.querySelector(".setup")?.replaceWith(setupView());

  const images = attachments.filter((a) => a.kind === "image").map((a) => a.dataUrl);
  const fileText = attachments
    .filter((a): a is Extract<Attachment, { kind: "text" }> => a.kind === "text")
    .map((a) => `\n\n[From file: ${a.name}]\n${a.text}`)
    .join("");
  const content = (text || (images.length ? "Please check my work in the photo." : "")) + fileText;
  const userMsg: ChatMessage = { role: "user", content, ...(images.length ? { images } : {}) };
  state.messages.push(userMsg);
  saveConversation();
  chatEl.querySelector(".empty")?.remove();
  chatEl.append(messageBubble(userMsg));
  const reply: ChatMessage = { role: "assistant", content: "" };
  const bubble = messageBubble(reply, true);
  // Photo marking can take a while before the first words appear.
  if (images.length) bubble.append(el("span", { class: "thinking-note" }, "Reading your work — this can take up to a minute…"));
  chatEl.append(bubble);
  chatEl.scrollTop = chatEl.scrollHeight;

  if (!state.recorded) {
    state.recorded = true;
    store.recordStudy({ code: s.code, topicId: found.topic.id, topicTitle: found.topic.title, subject: s.subject });
  }

  let pending = false;
  try {
    const result = await streamChat(
      state.token,
      {
        sessionId: state.sessionId,
        code: s.code,
        topicId: found.topic.id,
        tier: currentTier(s),
        mode: state.mode,
        difficulty: state.mode === "practise" ? state.difficulty : undefined,
        commandWord: state.mode === "practise" ? state.commandWord : undefined,
        messages: forSending(state.messages),
      },
      (delta) => {
        reply.content += delta;
        if (!pending) {
          pending = true;
          requestAnimationFrame(() => {
            pending = false;
            const nearBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
            fillBubble(bubble, reply);
            if (nearBottom) chatEl.scrollTop = chatEl.scrollHeight;
          });
        }
      },
    );
    bubble.classList.remove("typing");
    fillBubble(bubble, reply);
    state.messages.push(reply);
    saveConversation();
    if (result.truncated) {
      const btn = el("button", { type: "button", class: "continue-btn" }, "Continue ▸");
      const note = el("div", { class: "msg notice", role: "status" }, "That reply was long, so it stopped early. ", btn);
      btn.addEventListener("click", () => {
        note.remove();
        send("Please continue from exactly where you stopped.");
      });
      chatEl.append(note);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    const { score } = extractScore(reply.content);
    if (score && state.mode !== "learn") {
      store.recordScore({
        code: s.code, topicId: found.topic.id, topicTitle: found.topic.title, subject: s.subject,
        mode: state.mode, got: score.got, max: score.max,
      });
    }
  } catch (ex) {
    bubble.remove();
    state.messages.pop(); // let him resend
    saveConversation();
    if (ex instanceof ApiError && ex.status === 401) return logOut();
    if (ex instanceof ApiError && ex.kind === "limit") addNotice(ex.message);
    else addNotice(ex instanceof Error ? ex.message : "Something went wrong.", "error");
    textarea.value = text;
    state.attachments = attachments;
    renderTray();
  } finally {
    state.busy = false;
    sendBtn.disabled = false;
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

async function openArcade(panel: HTMLElement) {
  const token = state.token;
  if (!token) return;
  let cancelled = false;
  teardownView = () => (cancelled = true);
  let mountArcade;
  try {
    ({ mountArcade } = await import("./arcade"));
  } catch {
    if (!cancelled) panel.replaceChildren(el("p", { class: "err" }, "Couldn't load the arcade. Check your connection and try again."));
    return;
  }
  if (cancelled) return;
  ensureTopic();
  teardownView = mountArcade(panel, {
    token,
    code: state.code,
    topicId: state.topicId,
    tier: currentTier(),
    store,
    onTopicChange(code, topicId) {
      if (code === state.code && topicId === state.topicId) return;
      state.code = code;
      state.topicId = topicId;
      if (state.messages.length) resetConversation();
      savePrefs();
    },
    onLearn(code, topicId, message) {
      state.code = code;
      state.topicId = topicId;
      state.mode = "learn";
      state.view = "chat";
      state.setupOpen = false;
      resetConversation();
      savePrefs();
      render();
      send(message);
    },
    onAuthLost: logOut,
  });
}

async function renderProgress(panel: HTMLElement) {
  const [all, weak, focus] = await Promise.all([store.all(), store.weakest(5), store.focusLog()]);
  panel.replaceChildren();

  const install = installCard();
  if (install) panel.append(install);

  panel.append(el("h2", {}, "Focus time"));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7)); // Monday
  const since = (d: Date) => focus.filter((r) => new Date(r.at) >= d);
  const sum = (rs: typeof focus) => rs.reduce((n, r) => n + r.minutes, 0);
  const today = since(startOfToday);
  const week = since(startOfWeek);
  if (focus.length === 0) {
    panel.append(el("p", { class: "meta" }, "No focus blocks yet. Tap ⏱ at the top to start a 25-minute focus block."));
  } else {
    const bySubject = new Map<string, number>();
    for (const r of week) bySubject.set(r.subject, (bySubject.get(r.subject) ?? 0) + r.minutes);
    panel.append(el("div", { class: "card" },
      el("strong", {}, `${today.length} focus block${today.length === 1 ? "" : "s"} today · ${formatDuration(sum(today))}`),
      el("div", { class: "meta" }, `This week: ${week.length} block${week.length === 1 ? "" : "s"} · ${formatDuration(sum(week))}`),
      ...[...bySubject].sort((a, b) => b[1] - a[1]).map(([subject, mins]) => el("div", { class: "meta" }, `${subject}: ${formatDuration(mins)}`)),
    ));
  }

  panel.append(el("h2", { style: "margin-top:24px" }, "Weak topics"));

  if (weak.length === 0) {
    panel.append(el("p", { class: "meta" }, "No scores yet. Try Practise, Quick quiz or the Arcade — your marks will show here."));
  }
  for (const t of weak) {
    const pct = Math.round(t.average * 100);
    const card = el("div", { class: "card" },
      el("strong", {}, t.topicTitle),
      el("div", { class: "meta" }, `${t.subject} · ${pct}% over last ${Math.min(5, t.scores.length)} attempt(s)`),
      el("div", { class: `bar${pct < 50 ? " low" : ""}` }, el("div", { style: `width:${pct}%` })),
    );
    const go = el("button", { class: "icon-btn", style: "margin-top:8px" }, "Revise this");
    go.addEventListener("click", () => {
      state.code = t.code;
      state.topicId = t.topicId;
      state.mode = "learn";
      state.view = "chat";
      state.setupOpen = true;
      resetConversation();
      savePrefs();
      render();
    });
    card.append(go);
    panel.append(card);
  }

  panel.append(el("h2", { style: "margin-top:24px" }, "Topics covered"));
  if (all.length === 0) panel.append(el("p", { class: "meta" }, "Nothing yet — pick a topic and start."));
  for (const t of all) {
    const last = t.scores.at(-1);
    panel.append(el("div", { class: "card" },
      el("strong", {}, t.topicTitle),
      el("div", { class: "meta" },
        `${t.subject} · ${t.sessions} session(s) · last ${new Date(t.lastStudied).toLocaleDateString("en-GB")}` +
          (last ? ` · latest score ${last.got}/${last.max}` : ""),
      ),
    ));
  }

  panel.append(el("div", { class: "card feedback-card", style: "margin-top:24px" },
    el("strong", {}, "Something not right, or an idea?"),
    el("div", { class: "meta" }, "Tell us about the tutor, the Arcade or the timer. It goes to your parent's view."),
    feedbackButton("Send feedback", () => {
      if (!state.token) return null;
      const s = syllabus();
      return {
        token: state.token,
        area: "other",
        context: { view: "progress", code: s.code, topic: findTopic(s, state.topicId)?.topic.title },
        onAuthLost: logOut,
      };
    }),
  ));

  const clear = el("button", { class: "icon-btn", style: "margin-top:16px" }, "Clear progress on this device");
  clear.addEventListener("click", async () => {
    if (confirm("Clear all progress saved on this device?")) {
      await store.clear();
      renderProgress(panel);
    }
  });
  const logout = el("button", { class: "icon-btn", style: "margin:16px 0 0 8px" }, "Log out");
  logout.addEventListener("click", logOut);
  panel.append(clear, logout);
}

registerServiceWorker();
restoreConversation();
initPomodoro({
  store,
  currentTopic() {
    const s = syllabus();
    ensureTopic();
    const found = findTopic(s, state.topicId);
    return found ? { code: s.code, subject: s.subject, topicId: found.topic.id, topicTitle: found.topic.title } : null;
  },
  openArcade(code, topicId) {
    state.code = code;
    state.topicId = topicId;
    state.view = "arcade";
    savePrefs();
    render();
  },
  onFocusRecorded(r) {
    queueFocus(r);
    void flushFocus(state.token);
  },
});
startFocusSync(() => state.token);
render();
startUpdateCheck(
  () => !state.busy && state.messages.length === 0 && state.attachments.length === 0 && !(textarea?.value ?? "").trim(),
  () => {
    const btn = el("button", { type: "button" }, "Update");
    btn.addEventListener("click", () => location.reload()); // the conversation is saved, so nothing is lost
    document.querySelector(".app")?.prepend(el("div", { class: "update-bar", role: "status" }, "A new version is ready. ", btn));
  },
);
