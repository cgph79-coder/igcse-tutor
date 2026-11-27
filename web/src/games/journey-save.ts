/** Saved runs of the journey game: one per topic, kept on this device only. */
import { prefs } from "../storage";
import { parseSave, type JourneyState } from "./journey-core";
import type { Desk } from "./journey-content";

const key = (code: string, topicId: string) => `journey:save:${code}:${topicId}`;

export function loadJourney(code: string, topicId: string): JourneyState | null {
  return parseSave(prefs.get(key(code, topicId)));
}

export function saveJourney(s: JourneyState) {
  prefs.set(key(s.code, s.topicId), s.phase === "ended" ? null : JSON.stringify(s));
}

export function clearJourney(code: string, topicId: string) {
  prefs.set(key(code, topicId), null);
}

/** Scenes already used on a desk, so new runs pick fresh ones (device only). */
export function loadSeenScenes(desk: Desk): string[] {
  try {
    const list = JSON.parse(prefs.get(`journey:seen:${desk}`) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveSeenScenes(desk: Desk, ids: string[]) {
  prefs.set(`journey:seen:${desk}`, JSON.stringify(ids));
}
