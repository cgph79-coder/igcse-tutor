/** Bindings and configuration available to the Worker. */
export interface Env {
  TUTOR_KV: KVNamespace;

  // Secrets (set with `wrangler secret put`)
  LLM_API_KEY: string;
  /** Key for the photo-reading model; falls back to LLM_API_KEY only if both use the same provider. */
  LLM_VISION_API_KEY?: string;
  TUTOR_PASSCODE: string;
  PARENT_PASSWORD: string;
  TOKEN_SECRET: string;
  BLOCKED_TERMS?: string;

  // Plain config (wrangler.toml [vars])
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  /** Model that can read images (used only when a message has photos). Empty = photos disabled. */
  LLM_VISION_BASE_URL?: string;
  LLM_VISION_MODEL?: string;
  ALLOWED_ORIGINS: string;
  MAX_TOKENS?: string;
  MAX_TOKENS_PHOTOS?: string;
  /** Max length of one batch of arcade-game questions. */
  MAX_TOKENS_QUIZ?: string;
  MAX_HISTORY_MESSAGES?: string;
  MAX_HISTORY_CHARS?: string;
  DAILY_REQUEST_LIMIT?: string;
  DAILY_TOKEN_LIMIT?: string;
  LOG_RETENTION_DAYS?: string;
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
