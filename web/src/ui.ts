import { prefs } from "./storage";

type Child = Node | string | null | undefined | false;

/** Tiny DOM helper. Strings become text nodes (never HTML), so it's XSS-safe by default. */
export function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

export type Theme = "system" | "light" | "dark";

export function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  prefs.set("theme", theme);
}

export function initTheme() {
  applyTheme((prefs.get("theme") as Theme) ?? "system");
}

/** Cycle to whichever theme is visibly different from what's showing now. */
export function nextTheme(): Theme {
  const current = document.documentElement.getAttribute("data-theme");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const showingDark = current ? current === "dark" : systemDark;
  return showingDark ? "light" : "dark";
}
