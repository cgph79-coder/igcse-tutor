/** URL of the Cloudflare Worker, set at build time (VITE_WORKER_URL). */
export const WORKER_URL = (import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787").replace(/\/+$/, "");
