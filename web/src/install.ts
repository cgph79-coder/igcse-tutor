/**
 * Installing the tutor as a home-screen app (PWA): registers the service worker, and offers an
 * install tip on the Progress page — the browser's own install button where there is one
 * (Android, desktop Chrome/Edge), or Share → Add to Home Screen instructions on iPhone/iPad.
 */
import { prefs } from "./storage";
import { el } from "./ui";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: InstallPromptEvent | null = null;

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  const register = () =>
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      /* not fatal: the site still works, just not offline */
    });
  // Register after the page has loaded so it doesn't slow the first visit.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button on the Progress page instead of the browser's banner
    deferredPrompt = e as InstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => (deferredPrompt = null));
}

/** Show a notification, through the service worker where possible (required in installed iPhone apps). */
export async function showNotification(title: string, body: string): Promise<void> {
  const opts = { body, tag: "igcse-tutor-timer", icon: `${import.meta.env.BASE_URL}icons/icon-192.png` };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) return await reg.showNotification(title, opts);
    new Notification(title, opts);
  } catch {
    /* not allowed here; the on-screen alert still shows */
  }
}

/** The install card for the Progress page, or null if it's installed, dismissed or not possible. */
export function installCard(): HTMLElement | null {
  if (isStandalone() || prefs.get("install:hidden") === "1") return null;
  const ios = isIos();
  if (!ios && !deferredPrompt) return null;

  const hide = el("button", { type: "button", class: "icon-btn" }, "Hide");
  const card = el("div", { class: "card install-card" },
    el("strong", {}, "Install the app"),
    ios
      ? el("p", { class: "meta" },
          "In Safari, tap the Share button, then “Add to Home Screen”. It opens full-screen from its own icon, and the study timer can send notifications.")
      : el("p", { class: "meta" }, "Add the tutor to your home screen so it opens like an app."),
    ios
      ? el("p", { class: "meta" },
          "The installed app keeps its own progress, separate from Safari, so you'll log in again and your scores start fresh there.")
      : "",
  );
  const row = el("div", { class: "install-actions" });
  if (!ios && deferredPrompt) {
    const install = el("button", { type: "button", class: "play-btn" }, "Install app");
    install.addEventListener("click", async () => {
      const p = deferredPrompt;
      if (!p) return;
      deferredPrompt = null;
      await p.prompt();
      card.remove();
    });
    row.append(install);
  }
  hide.addEventListener("click", () => {
    prefs.set("install:hidden", "1");
    card.remove();
  });
  row.append(hide);
  card.append(row);
  return card;
}
