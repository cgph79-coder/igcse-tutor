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
  /** Story games: how the run ended, shown on the results screen. */
  title?: string;
  summary?: string;
}

export interface GameOptions {
  questions: McqQuestion[];
  /** No time pressure: answers wait until he picks one. */
  calm: boolean;
  reducedMotion: boolean;
  /** Multiplies the time the answers take to land: 1 = normal, below 1 = faster (higher sectors). */
  speed: number;
  /** The topic being played (story games use the section for their setting). */
  topic: { code: string; sectionId: string; topicId: string; topicTitle: string };
  /** Pick up a saved run instead of starting a new one (questions is then empty). */
  resume?: boolean;
  onEnd(result: GameResult): void;
  /** Leave without finishing; the game has saved the run. */
  onExit?(): void;
}

/** Mounts a game into `stage` and returns a cleanup function. */
export type StartGame = (stage: HTMLElement, opts: GameOptions) => () => void;

export interface GameInfo {
  id: string;
  name: string;
  blurb: string;
  /** Subject codes the game is offered for; all subjects if missing. */
  subjects?: string[];
  /** False for games without speed sectors (story games). */
  sectors?: boolean;
  /** Cards to ask for (the Worker allows up to 15); the round length if missing. */
  cards?: number;
  /** Runs count towards the Dispatches career (cards come at the topic's career level). */
  career?: boolean;
  /** Shown while the cards load. */
  loading?: string;
  /** True if there's a saved run for this topic that can be resumed. */
  hasSave?(code: string, topicId: string): boolean;
  load: () => Promise<StartGame>;
}
