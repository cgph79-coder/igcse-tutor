/** Bindings and configuration available to the Worker. */
export interface Env {
  TUTOR_KV: KVNamespace;

  // Secrets (set with `wrangler secret put`)
  LLM_API_KEY: string;
  TUTOR_PASSCODE: string;
  PARENT_PASSWORD: string;
  TOKEN_SECRET: string;
  BLOCKED_TERMS?: string;

  // Plain config (wrangler.toml [vars])
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  ALLOWED_ORIGINS: string;
  MAX_TOKENS?: string;
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
