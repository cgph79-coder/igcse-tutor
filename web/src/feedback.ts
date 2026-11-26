/**
 * "Send feedback": a quick note about the app that appears in the parent view, ready to copy
 * into the feedback log (docs/ROADMAP.md). Optionally attaches app details (version, screen,
 * subject, topic, game), never the conversation.
 */
import { WORKER_URL } from "./config";
import { el } from "./ui";

declare const __BUILD_ID__: string;

export type FeedbackArea = "tutor" | "arcade" | "timer" | "other";

export interface FeedbackOptions {
  token: string;
  /** Area picked to start with. */
  area: FeedbackArea;
  /** App details to attach if he ticks "This happened just now". */
  context: { view: string; code?: string; topic?: string; game?: string };
  /** Text to start with (e.g. the card being reported). */
  text?: string;
  onAuthLost?(): void;
}

const AREAS: { id: FeedbackArea; label: string }[] = [
  { id: "tutor", label: "Tutor" },
  { id: "arcade", label: "Arcade" },
  { id: "timer", label: "Timer" },
  { id: "other", label: "Other" },
];
const MAX = 500;

let dialog: HTMLDialogElement | null = null;

export function openFeedback(o: FeedbackOptions) {
  if (!dialog) {
    dialog = el("dialog", { class: "pomo-panel feedback-panel", "aria-label": "Send feedback" }) as HTMLDialogElement;
    dialog.addEventListener("click", (e) => e.target === dialog && dialog!.close());
    document.body.append(dialog);
  }
  let area = o.area;

  const close = el("button", { type: "button", class: "pomo-close", "aria-label": "Close" }, "×");
  close.addEventListener("click", () => dialog!.close());

  const seg = el("div", { class: "segmented", role: "group", "aria-label": "What is it about?" });
  const paint = () => seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.area === area)));
  for (const a of AREAS) {
    const b = el("button", { type: "button", "data-area": a.id }, a.label);
    b.addEventListener("click", () => {
      area = a.id;
      paint();
    });
    seg.append(b);
  }
  paint();

  const text = el("textarea", {
    rows: "3",
    maxlength: String(MAX),
    placeholder: "What happened, or what would make it better? e.g. “The rocks are too fast on level 3.”",
    "aria-label": "Your feedback",
  }) as HTMLTextAreaElement;
  text.value = (o.text ?? "").slice(0, MAX);
  const counter = el("div", { class: "meta feedback-count" }, `${text.value.length}/${MAX}`);
  text.addEventListener("input", () => (counter.textContent = `${text.value.length}/${MAX}`));

  const attach = el("input", { type: "checkbox" }) as HTMLInputElement;
  attach.checked = true;
  const where = [o.context.topic, o.context.game].filter(Boolean).join(" · ");
  const attachLabel = el("label", { class: "check" }, attach, ` This happened just now${where ? ` (${where})` : ""}`);

  const status = el("p", { class: "meta", role: "status" });
  const send = el("button", { type: "submit", class: "play-btn" }, "Send") as HTMLButtonElement;
  const form = el("form", { class: "feedback-form" },
    el("label", { class: "field" }, "What is it about?", seg),
    el("label", { class: "field" }, "Your feedback", text),
    counter,
    attachLabel,
    el("p", { class: "meta" }, "Don't include your name or other personal details. Your parent will see this."),
    send,
    status,
  ) as HTMLFormElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (value.length < 3) {
      status.textContent = "Please write a few words first.";
      return;
    }
    send.disabled = true;
    status.textContent = "Sending…";
    try {
      const res = await fetch(WORKER_URL + "/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.token}` },
        body: JSON.stringify({
          area,
          text: value,
          ...(attach.checked ? { context: { ...o.context, build: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "" } } : {}),
        }),
      });
      if (res.status === 401) {
        dialog!.close();
        o.onAuthLost?.();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't send that. Please try again.");
      }
      dialog!.replaceChildren(close, el("h2", {}, "Thank you! 🙌"), el("p", {}, "Your feedback has been sent. It really helps make the app better."));
      setTimeout(() => dialog?.open && dialog.close(), 2500);
    } catch (ex) {
      status.textContent = ex instanceof Error && ex.message !== "Failed to fetch" ? ex.message : "You seem to be offline. Please try again when you're connected.";
      send.disabled = false;
    }
  });

  dialog.replaceChildren(close, el("h2", {}, "Send feedback"), form);
  dialog.showModal();
  setTimeout(() => {
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  }, 0);
}

/** A small "Send feedback" link button. */
export function feedbackButton(label: string, getOptions: () => FeedbackOptions | null): HTMLElement {
  const b = el("button", { type: "button", class: "link-btn" }, label);
  b.addEventListener("click", () => {
    const o = getOptions();
    if (o) openFeedback(o);
  });
  return b;
}
