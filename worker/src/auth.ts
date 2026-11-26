/**
 * Minimal signed session tokens (HMAC-SHA256), shaped like a tiny JWT.
 *
 * This is deliberately isolated behind `issueToken` / `verifyToken` / `checkSecret`
 * so it can later be replaced by real user accounts (e.g. an auth provider) without
 * touching the rest of the Worker.
 */

export type Role = "student" | "parent";

export interface TokenPayload {
  sub: string; // user id (single student for now)
  role: Role;
  exp: number; // unix seconds
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function issueToken(
  secret: string,
  sub: string,
  role: Role,
  ttlSeconds: number,
  now = Date.now(),
): Promise<string> {
  if (!secret || secret.length < 16) throw new Error("TOKEN_SECRET is missing or too short");
  const payload: TokenPayload = { sub, role, exp: Math.floor(now / 1000) + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken(
  secret: string,
  token: string | null | undefined,
  now = Date.now(),
): Promise<TokenPayload | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    if (payload.role !== "student" && payload.role !== "parent") return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time comparison of a submitted secret against the expected one. */
export async function checkSecret(submitted: unknown, expected: string | undefined): Promise<boolean> {
  if (typeof submitted !== "string" || !expected) return false;
  // Compare HMACs of both values so timing doesn't leak length or content.
  const key = await hmacKey("igcse-tutor-compare");
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(submitted)),
    crypto.subtle.sign("HMAC", key, enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}
