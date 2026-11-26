/**
 * Dispatches: a text journey for History. He plays a newspaper correspondent travelling a route
 * through the period he's studying. Every stop has a scene built around one recall card; the
 * answer changes money, energy, the editor's trust and contacts. Between stops he chooses whether
 * to rest or work and how to travel. No timer: it's a reading game, played at his own pace.
 * The run is saved after every step, so he can leave and carry on later.
 */
import { renderMarkdown } from "../render";
import { el } from "../ui";
import {
  answerCard,
  askContact,
  campChoices,
  chooseCamp,
  chooseTravel,
  continueFromIncident,
  continueFromOutcome,
  currentCard,
  daysLeft,
  isFinalStop,
  MAX_STAMINA,
  MAX_TRUST,
  newJourney,
  sceneText,
  travelChoices,
  type Choice,
  type JourneyState,
} from "./journey-core";
import type { Effect } from "./journey-content";
import { clearJourney, loadJourney, saveJourney } from "./journey-save";
import type { GameOptions, StartGame } from "./types";

const LABELS = ["A", "B", "C", "D"];
const RES_NAMES: Record<keyof Effect, string> = { funds: "£", stamina: "energy", trust: "trust", contacts: "contact", days: "day" };

function inline(text: string, tag = "span", cls = "") {
  const node = el(tag, cls ? { class: cls } : {});
  node.innerHTML = renderMarkdown(text, true);
  return node;
}

/** "+2 £ · −1 energy · +1 day" */
export function describeEffect(e: Effect): string {
  return (Object.entries(e) as Array<[keyof Effect, number]>)
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const sign = v > 0 ? "+" : "−";
      const n = Math.abs(v);
      const name = k === "contacts" || k === "days" ? `${RES_NAMES[k]}${n === 1 ? "" : "s"}` : RES_NAMES[k];
      return k === "funds" ? `${sign}£${n}` : `${sign}${n} ${name}`;
    })
    .join(" · ");
}

export const startJourney: StartGame = (stage, opts: GameOptions) => {
  const t = opts.topic;
  let state: JourneyState;
  const saved = opts.resume ? loadJourney(t.code, t.topicId) : null;
  try {
    state = saved ?? newJourney({ ...t, cards: opts.questions });
  } catch {
    stage.replaceChildren(el("p", { class: "err" }, "Not enough cards for a journey on this topic yet. Try again in a moment."));
    return () => {};
  }
  let fresh = !saved; // show the assignment briefing once at the start
  let keyHandler: ((i: number) => void) | null = null;

  const hud = el("div", { class: "journey-hud" });
  const body = el("div", { class: "journey-body", "aria-live": "polite" });
  const exitBtn = el("button", { type: "button", class: "hud-quit" }, "Save & exit");
  exitBtn.addEventListener("click", () => {
    saveJourney(state);
    cleanup();
    opts.onExit?.();
  });
  const root = el("div", { class: "journey" }, el("div", { class: "journey-top" }, hud, exitBtn), body);
  stage.replaceChildren(root);

  function set(next: JourneyState) {
    if (next === state) return;
    state = next;
    saveJourney(state);
    if (state.phase === "ended") return finish();
    render();
  }

  function stat(icon: string, label: string, value: string, warn = false) {
    return el("span", { class: `jstat${warn ? " warn" : ""}`, title: label, "aria-label": `${label}: ${value}` }, `${icon} ${value}`);
  }

  function renderHud() {
    const r = state.res;
    const left = daysLeft(state);
    hud.replaceChildren(
      stat("💷", "Money", `£${r.funds}`, r.funds < 1),
      stat("⚡", "Energy", `${r.stamina}/${MAX_STAMINA}`, r.stamina <= 1),
      stat("⭐", "Editor's trust", `${r.trust}/${MAX_TRUST}`, r.trust <= 1),
      stat("📇", "Contacts", String(r.contacts)),
      stat("⏳", "Days left", left >= 0 ? String(left) : `${-left} late`, left < 2),
    );
  }

  function route() {
    const dots = state.stops.map((name, i) =>
      el("li", { class: i < state.stop ? "done" : i === state.stop ? "here" : "", title: name }, el("span", { class: "sr-only" }, name)));
    return el("div", { class: "journey-route" },
      el("div", { class: "journey-place" }, el("strong", {}, state.stops[state.stop]),
        el("span", { class: "meta" }, ` · stop ${state.stop + 1} of ${state.stops.length} · heading for ${state.stops.at(-1)}`)),
      el("ol", { class: "route-dots", "aria-hidden": "true" }, ...dots),
    );
  }

  function deltaLine(e: Effect) {
    const d = describeEffect(e);
    return d ? el("p", { class: "journey-delta" }, d) : null;
  }

  function choiceList(choices: Choice[], pick: (id: string) => void) {
    const buttons = choices.map((c, i) => {
      const b = el("button", { type: "button", class: "journey-choice" },
        el("span", { class: "choice-key", "aria-hidden": "true" }, String(i + 1)),
        el("span", { class: "choice-text" },
          el("strong", {}, c.label),
          el("span", { class: "meta" }, c.disabled ?? [c.detail, describeEffect(c.effect)].filter(Boolean).join(" ")),
        ),
      ) as HTMLButtonElement;
      b.disabled = !!c.disabled;
      b.addEventListener("click", () => pick(c.id));
      return b;
    });
    keyHandler = (i) => buttons[i] && !buttons[i].disabled && buttons[i].click();
    return el("div", { class: "journey-choices" }, ...buttons);
  }

  function continueButton(label: string, go: () => void) {
    const b = el("button", { type: "button", class: "play-btn journey-next" }, label);
    b.addEventListener("click", go);
    keyHandler = (i) => i === 0 && go();
    return b;
  }

  function render() {
    keyHandler = null;
    renderHud();
    const parts: Array<HTMLElement | null> = [route()];

    if (fresh && state.phase === "scene" && state.stop === 0) {
      parts.push(
        el("div", { class: "journey-brief" },
          el("p", {}, state.intro),
          el("p", {}, "Your story: ", el("em", {}, state.topicTitle)),
          el("p", { class: "meta" },
            `You have ${state.deadline} days. Every stop has a fact to check: get it right and the editor trusts you more. ` +
              "Stuck? A contact can rule out two wrong answers. Run out of energy or trust and you're sent home."),
        ),
        continueButton("Start the assignment", () => {
          fresh = false;
          render();
        }),
      );
    } else if (state.phase === "scene") {
      const card = currentCard(state);
      const options = card.options.map((o, i) => {
        const out = state.ruledOut?.includes(i);
        const b = el("button", { type: "button", class: `journey-option${out ? " out" : ""}` },
          el("span", { class: "choice-key", "aria-hidden": "true" }, LABELS[i]),
          el("span", { class: "sr-only" }, `Answer ${LABELS[i]}: `),
          inline(o),
        ) as HTMLButtonElement;
        b.disabled = !!out;
        b.addEventListener("click", () => set(answerCard(state, i)));
        return b;
      });
      keyHandler = (i) => options[i] && !options[i].disabled && options[i].click();
      const contact = el("button", { type: "button", class: "link-btn" },
        state.ruledOut ? "Your contact ruled out two answers" : `Ask a contact (${state.res.contacts} left)`) as HTMLButtonElement;
      contact.disabled = !!state.ruledOut || state.res.contacts < 1;
      contact.addEventListener("click", () => set(askContact(state)));
      parts.push(
        el("p", { class: "journey-scene" }, sceneText(state)),
        el("div", { class: "journey-card" }, inline(card.q, "div", "journey-q"), el("div", { class: "journey-options" }, ...options)),
        el("div", { class: "journey-help" }, contact),
      );
    } else if (state.phase === "outcome") {
      const last = state.answers.at(-1)!;
      const card = last.question;
      parts.push(
        el("div", { class: `journey-verdict ${last.correct ? "good" : "bad"}` },
          el("strong", {}, last.correct ? "Correct." : "Not quite."),
          " ",
          last.correct ? null : el("span", {}, "The answer is ", inline(card.options[card.answer], "strong"), ". "),
          card.explain ? inline(card.explain) : null,
        ),
        el("p", { class: "journey-scene" }, state.message),
        deltaLine(state.delta),
        continueButton(isFinalStop(state) ? "File your story" : "Continue", () => set(continueFromOutcome(state))),
      );
    } else if (state.phase === "camp") {
      parts.push(
        el("p", { class: "journey-scene" }, `Evening in ${state.stops[state.stop]}. What now?`),
        choiceList(campChoices(state), (id) => set(chooseCamp(state, id))),
      );
    } else if (state.phase === "travel") {
      parts.push(
        deltaLine(state.delta),
        el("p", { class: "journey-scene" }, `How will you get to ${state.stops[state.stop + 1]}?`),
        choiceList(travelChoices(state), (id) => set(chooseTravel(state, id))),
      );
    } else if (state.phase === "incident") {
      parts.push(
        el("p", { class: "journey-scene" }, "On the road: ", state.message),
        deltaLine(state.delta),
        continueButton(`Arrive in ${state.stops[state.stop]}`, () => set(continueFromIncident(state))),
      );
    }
    body.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    body.scrollTop = 0;
    (body.querySelector("button:not(:disabled)") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  function finish() {
    cleanup();
    clearJourney(t.code, t.topicId);
    opts.onEnd({
      score: state.score,
      answers: state.answers,
      bestStreak: state.bestStreak,
      quit: !!state.ending?.onRoute,
      title: state.ending?.title,
      summary: state.ending?.text,
    });
  }

  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key.length !== 1) return;
    const k = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
    if (k >= 0 && keyHandler) {
      e.preventDefault();
      keyHandler(k);
    }
  }

  function cleanup() {
    document.removeEventListener("keydown", onKey);
  }

  document.addEventListener("keydown", onKey);
  saveJourney(state);
  render();
  return cleanup;
};

