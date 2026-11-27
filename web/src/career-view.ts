/**
 * The Dispatches career map: his rank, what the next promotion needs, follow-up stories, and
 * every topic in every subject with its grade. Picking a topic starts a Dispatches run there.
 */
import { SYLLABUSES, findSyllabus, findTopic } from "../../syllabus/index";
import {
  coverage,
  examUnlocked,
  followUps,
  gradeOf,
  levelFor,
  nextRankNeeds,
  rankOf,
  weeksUntil,
  type Career,
  type Grade,
} from "../../shared/career";
import { EXAM_DATE } from "./config";
import { deskFor } from "./games/journey-content";
import { el } from "./ui";
import { hasExamDraft } from "./exam-view";

const DESK_NAMES = { history: "History desk", science: "Science desk", tech: "Tech desk", data: "Data desk" } as const;

export function stars(g: Grade): string {
  return "★".repeat(g) + "☆".repeat(3 - g);
}

function bar(fraction: number, label: string) {
  const fill = el("div", { class: "career-bar-fill" });
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  return el("div", { class: "career-bar", role: "img", "aria-label": label }, fill);
}

/** A one-card summary for the Arcade lobby. */
export function careerSummary(c: Career, openMap: () => void): HTMLElement {
  const next = nextRankNeeds(c);
  const btn = el("button", { type: "button", class: "icon-btn" }, "Career map");
  btn.addEventListener("click", openMap);
  return el("div", { class: "card career-summary" },
    el("div", { class: "game-card-text" },
      el("strong", {}, `📰 ${rankOf(c)}`),
      el("div", { class: "meta" }, next ? `Next: ${next.rank}. Needs ${next.text}.` : "Top rank. You run the paper."),
      next ? bar(next.done / next.needed, `${next.done} of ${next.needed}`) : null,
    ),
    btn,
  );
}

export function renderCareerMap(
  panel: HTMLElement,
  c: Career,
  o: { onPlay(code: string, topicId: string): void; onEditor(code: string, topicId: string): void; onBack(): void },
) {
  const back = el("button", { type: "button", class: "icon-btn" }, "Arcade");
  back.addEventListener("click", o.onBack);
  const next = nextRankNeeds(c);
  const weeks = weeksUntil(EXAM_DATE);
  const play = (code: string, topicId: string, label = "Play") => {
    const b = el("button", { type: "button", class: "play-btn small" }, label);
    b.addEventListener("click", () => o.onPlay(code, topicId));
    return b;
  };

  const follow = followUps(c).slice(0, 5).flatMap((f) => {
    const s = findSyllabus(f.code);
    const t = s && findTopic(s, f.topicId)?.topic;
    if (!s || !t) return [];
    return [el("div", { class: "career-row" },
      el("div", { class: "career-row-text" }, el("span", {}, t.title), el("span", { class: "meta" }, `${s.subject} · last time ${Math.round(f.lastScore * 100)}%`)),
      play(f.code, f.topicId),
    )];
  });

  const cov = coverage(c, EXAM_DATE);
  const desks = SYLLABUSES.map((s) => {
    const sc = cov.find((x) => x.code === s.code)!;
    const sections = s.sections.map((sec) =>
      el("div", { class: "career-section" },
        el("div", { class: "career-section-title" }, sec.title),
        ...sec.topics.map((t) => {
          const g = gradeOf(c, s.code, t.id);
          const exam = c.topics[`${s.code}:${t.id}`]?.exam;
          let editor: HTMLElement | null = null;
          if (examUnlocked(c, s.code, t.id)) {
            editor = el("button", { type: "button", class: "icon-btn editor-btn" }, hasExamDraft(s.code, t.id) ? "✍ Continue" : "✍ Editor");
            editor.addEventListener("click", () => o.onEditor(s.code, t.id));
          }
          return el("div", { class: "career-row" },
            el("div", { class: "career-row-text" },
              el("span", {}, t.title),
              el("span", { class: "meta" },
                g === 3
                  ? `${stars(g)} mastered` + (exam !== undefined ? ` · ✍ best ${Math.round(exam * 100)}%` : " · Editor's desk open")
                  : `${stars(g)} · next run: level ${levelFor(c, s.code, t.id)}`),
            ),
            el("div", { class: "career-row-actions" }, editor, play(s.code, t.id, g === 3 ? "Replay" : "Play")),
          );
        }),
      ),
    );
    const details = el("details", { class: "career-desk-topics" }, el("summary", {}, "Topics"), ...sections);
    return el("div", { class: `card career-desk${sc.behind ? " behind" : ""}` },
      el("div", { class: "career-desk-head" },
        el("strong", {}, `${DESK_NAMES[deskFor(s.code)]} · ${s.subject}`),
        el("span", { class: "meta" }, `${sc.atGrade[0]} of ${sc.topics} topics started`),
      ),
      bar(sc.coverage, `${Math.round(sc.coverage * 100)}% of topics started`),
      el("div", { class: "meta" }, `★ ${sc.atGrade[0]} · ★★ ${sc.atGrade[1]} · ★★★ ${sc.atGrade[2]}`),
      sc.behind ? el("div", { class: "career-behind" }, "Falling behind for your exams. Try a topic here next.") : null,
      details,
    );
  });

  panel.replaceChildren(...[
    el("div", { class: "career-top" }, el("h2", {}, "Your career"), back),
    el("div", { class: "card career-rank" },
      el("div", { class: "career-rank-name" }, `📰 ${rankOf(c)}`),
      el("div", { class: "meta" }, "at the London Courier"),
      next ? el("p", {}, `Next: ${next.rank}. Needs ${next.text}.`) : el("p", {}, "You're the Editor. Replay any topic to stay sharp."),
      next ? bar(next.done / next.needed, `${next.done} of ${next.needed}`) : null,
      weeks > 0 ? el("p", { class: "meta" }, `${weeks} weeks until your exams.`) : null,
    ),
    el("p", { class: "meta" },
      "Every topic has three levels. Score 80% or more on a finished Dispatches run to clear a level and earn a star. Promotion needs stars across your subjects. " +
        "At ★★★ a topic opens the ✍ Editor's desk: exam-style questions marked by the tutor."),
    follow.length ? el("div", { class: "card career-follow" }, el("strong", {}, "Your editor wants follow-ups on:"), ...follow) : null,
    ...desks,
  ].filter((n): n is HTMLElement => n !== null));
}
