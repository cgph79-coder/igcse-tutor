import type { McqQuestion } from "../api";

export interface AnswerRecord {
  question: McqQuestion;
  /** Index of the option he picked, or null if time ran out. */
  chosen: number | null;
  correct: boolean;
}

export interface GameResult {
  score: number;
  answers: AnswerRecord[];
  bestStreak: number;
  /** True if he quit before the round finished. */
  quit: boolean;
}

export interface GameOptions {
  questions: McqQuestion[];
  /** No time pressure: answers wait until he picks one. */
  calm: boolean;
  reducedMotion: boolean;
  /** Multiplies the time the answers take to land: 1 = normal, below 1 = faster (higher sectors). */
  speed: number;
  onEnd(result: GameResult): void;
}

/** Mounts a game into `stage` and returns a cleanup function. */
export type StartGame = (stage: HTMLElement, opts: GameOptions) => () => void;

export interface GameInfo {
  id: string;
  name: string;
  blurb: string;
  load: () => Promise<StartGame>;
}
