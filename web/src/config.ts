/** URL of the Cloudflare Worker, set at build time (VITE_WORKER_URL). */
export const WORKER_URL = (import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787").replace(/\/+$/, "");

/**
 * Roughly when his written exams start (Cambridge June 2027 series). Used by the Dispatches
 * career to pace coverage. Change it if his exam year changes.
 */
export const EXAM_DATE = "2027-05-01";
