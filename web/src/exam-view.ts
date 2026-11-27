/**
 * The Editor's desk: three exam-style questions on a topic he has at ★★★, answered in writing and
 * marked by the tutor like an examiner. Answers are kept on the device as he types, so leaving
 * the screen or reloading doesn't lose them (the questions stay valid on the Worker for a day).
 */
import { ApiError, markExam, startExam, type ExamQuestionPublic, type ExamResult } from "./api";
import { EXAM_PASS, recordExam } from "../../shared/career";
import { loadCareer, saveCareer, syncCareer } from "./career-sync";
import { renderMarkdown } from "./render";
import { prefs } from "./storage";
import { el } from "./ui";

export interface ExamContext {
  token: string;
  code: string;
  topicId: string;
  topicTitle: string;
  tier: string | null;
  onBack(): void;
  onLearn(message: string): void;
  onAuthLost(): void;
}

interface Draft {
  runId: string;
  questions: ExamQuestionPublic[];
  answers: string[];
  at: string;
}

const DRAFT_HOURS = 20; // the Worker keeps a run for 24 hours
const draftKey = (code: string, topicId: string) => `exam:draft:${code}:${topicId}`;

function loadDraft(code: string, topicId: string): Draft | null {
  try {
    const d = JSON.parse(prefs.get(draftKey(code, topicId)) ?? "null") as Draft | null;
    if (!d || !Array.isArray(d.questions) || !Array.isArray(d.answers)) return null;
    return Date.now() - new Date(d.at).getTime() < DRAFT_HOURS * 3600000 ? d : null;
  } catch {
    return null;
  }
}

export function hasExamDraft(code: string, topicId: string): boolean {
  return loadDraft(code, topicId) !== null;
}

function inline(text: string, tag = "div", cls = "") {
  const node = el(tag, cls ? { class: cls } : {});
  node.innerHTML = renderMarkdown(text, true);
  return node;
}

const plain = (t: string) => t.replace(/\$/g, "");

export function renderEditorsDesk(panel: HTMLElement, x: ExamContext) {
  let alive = true;
  const back = () => {
    alive = false;
    x.onBack();
  };

  function frame(...children: Array<HTMLElement | null>) {
    const b = el("button", { type: "button", class: "icon-btn" }, "Career map");
    b.addEventListener("click", back);
    panel.replaceChildren(
      el("div", { class: "career-top" }, el("h2", {}, "✍ Editor's desk"), b),
      el("p", { class: "meta" }, x.topicTitle),
      ...children.filter((c): c is HTMLElement => c !== null),
    );
    panel.scrollTop = 0;
  }

  function failed(ex: unknown, retry: () => void) {
    if (ex instanceof ApiError && ex.status === 401) return x.onAuthLost();
    const again = el("button", { type: "button", class: "play-btn" }, "Try again");
    again.addEventListener("click", retry);
    frame(el("p", { class: ex instanceof ApiError && ex.kind === "limit" ? "" : "err" }, ex instanceof Error ? ex.message : "Something went wrong."), again);
  }

  function intro() {
    const go = el("button", { type: "button", class: "play-btn" }, "Get the questions");
    go.addEventListener("click", fetchQuestions);
    frame(
      el("div", { class: "card" },
        el("p", {}, "You know this topic cold. Now the editor wants a feature on it, written like exam answers."),
        el("p", {}, "You'll get three exam-style questions, getting harder. Answer each one as you would in the exam: the marks in brackets show how much to write. The tutor marks your answers like an examiner and shows the mark scheme."),
        el("p", { class: "meta" }, `Score ${Math.round(EXAM_PASS * 100)}% or more to earn ✍ on this topic. Up to 4 a day. Your answers are saved as you type.`),
      ),
      go,
    );
  }

  async function fetchQuestions() {
    frame(el("div", { class: "arcade-loading", role: "status" }, el("div", { class: "loader-rock", "aria-hidden": "true" }), el("p", {}, "The editor is writing your questions…")));
    try {
      await syncCareer(x.token); // make sure the Worker knows about the three stars
      const set = await startExam(x.token, { code: x.code, topicId: x.topicId, tier: x.tier });
      if (!alive) return;
      const draft: Draft = { runId: set.runId, questions: set.questions, answers: set.questions.map(() => ""), at: new Date().toISOString() };
      prefs.set(draftKey(x.code, x.topicId), JSON.stringify(draft));
      answer(draft);
    } catch (ex) {
      if (alive) failed(ex, fetchQuestions);
    }
  }

  function answer(draft: Draft) {
    const boxes = draft.questions.map((q, i) => {
      const box = el("textarea", { rows: String(Math.min(10, 2 + q.marks * 2)), "aria-label": `Answer to question ${i + 1}`, maxlength: "1500" }) as HTMLTextAreaElement;
      box.value = draft.answers[i] ?? "";
      box.addEventListener("input", () => {
        draft.answers[i] = box.value;
        prefs.set(draftKey(x.code, x.topicId), JSON.stringify(draft));
      });
      return box;
    });
    const send = el("button", { type: "button", class: "play-btn" }, "Send to the editor");
    send.addEventListener("click", () => {
      const blanks = draft.answers.filter((a) => !a.trim()).length;
      if (blanks && !confirm(`${blanks === 1 ? "One answer is" : `${blanks} answers are`} blank. Send anyway?`)) return;
      mark(draft);
    });
    frame(
      ...draft.questions.map((q, i) =>
        el("div", { class: "card exam-q" },
          el("div", { class: "exam-q-head" }, el("strong", {}, `Question ${i + 1}`), el("span", { class: "score-chip" }, `${q.marks} mark${q.marks === 1 ? "" : "s"}`)),
          inline(q.q, "div", "exam-q-text"),
          boxes[i],
        )),
      el("p", { class: "meta" }, "Type maths plainly, e.g. x^2 + 3x = 10, or (x+2)/(x-1)."),
      send,
    );
  }

  async function mark(draft: Draft) {
    frame(el("div", { class: "arcade-loading", role: "status" }, el("div", { class: "loader-rock", "aria-hidden": "true" }), el("p", {}, "The editor is marking your answers…")));
    try {
      const res = await markExam(x.token, draft.runId, draft.answers);
      if (!alive) return;
      prefs.set(draftKey(x.code, x.topicId), null);
      if ("safeguarding" in res) {
        const done = el("button", { type: "button", class: "icon-btn" }, "Career map");
        done.addEventListener("click", back);
        return frame(inline(res.message, "div", "card"), done);
      }
      results(res.got, res.max, res.results);
    } catch (ex) {
      if (!alive) return;
      // An expired run can't be marked; start afresh. Anything else: the answers are still saved.
      if (ex instanceof ApiError && ex.status === 404) prefs.set(draftKey(x.code, x.topicId), null);
      failed(ex, () => (ex instanceof ApiError && ex.status === 404 ? intro() : mark(draft)));
    }
  }

  function results(got: number, max: number, items: ExamResult[]) {
    const fraction = max ? got / max : 0;
    const before = loadCareer();
    const prev = before.topics[`${x.code}:${x.topicId}`]?.exam;
    const { career, best } = recordExam(before, x.code, x.topicId, fraction);
    saveCareer(career);
    void syncCareer(x.token).catch(() => {});
    const pct = Math.round(fraction * 100);
    const passed = fraction >= EXAM_PASS;
    const again = el("button", { type: "button", class: "play-btn" }, "New questions");
    again.addEventListener("click", fetchQuestions);
    const done = el("button", { type: "button", class: "icon-btn" }, "Career map");
    done.addEventListener("click", back);
    frame(
      el("div", { class: "results-head" },
        el("h2", {}, passed ? "Front-page feature!" : "The editor wants a rewrite"),
        el("div", { class: "results-score" }, `${got}/${max}`),
        el("div", { class: "meta" }, `${pct}%` + (passed ? " · ✍ earned on this topic" : ` · ${Math.round(EXAM_PASS * 100)}% earns ✍`)),
        best && prev !== undefined ? el("div", { class: "score-chip" }, "Your best mark on this topic!") : null,
      ),
      el("div", { class: "results-actions" }, again, done),
      ...items.map((r, i) => {
        const learn = el("button", { type: "button", class: "icon-btn" }, "Go through it with the tutor");
        learn.addEventListener("click", () =>
          x.onLearn(`I practised this exam question: "${plain(r.q)}" [${r.max} marks]. My answer was: "${plain(r.answer) || "(blank)"}". ` +
            `It got ${r.marks}/${r.max}. Can you show me how to get full marks?`));
        return el("div", { class: "card review-card exam-result" },
          el("div", { class: "exam-q-head" }, el("strong", {}, `Question ${i + 1}`), el("span", { class: `score-chip${r.marks < r.max ? " partial" : ""}` }, `${r.marks}/${r.max}`)),
          inline(r.q, "div", "review-q"),
          el("div", { class: "exam-answer" }, el("span", { class: "meta" }, "Your answer: "), r.answer ? el("span", {}, r.answer) : el("em", {}, "blank")),
          r.feedback ? el("p", {}, r.feedback) : null,
          el("details", {},
            el("summary", {}, "Mark scheme and model answer"),
            el("ul", {}, ...r.scheme.map((p) => inline(p, "li"))),
            inline(`**Model answer:** ${r.model}`, "div"),
          ),
          learn,
        );
      }),
    );
  }

  const draft = loadDraft(x.code, x.topicId);
  if (draft) answer(draft);
  else intro();
  return () => {
    alive = false;
  };
}
