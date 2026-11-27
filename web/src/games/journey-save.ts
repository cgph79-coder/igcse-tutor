/** Saved runs of the journey game: one per topic, kept on this device only. */
import { prefs } from "../storage";
import { parseSave, type JourneyState } from "./journey-core";

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
