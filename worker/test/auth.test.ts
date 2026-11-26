import { describe, expect, it } from "vitest";
import { checkSecret, issueToken, verifyToken } from "../src/auth";

const SECRET = "a-very-long-test-secret-value-123";

describe("auth tokens", () => {
  it("issues a token that verifies", async () => {
    const t = await issueToken(SECRET, "student", "student", 60);
    const p = await verifyToken(SECRET, t);
    expect(p?.sub).toBe("student");
    expect(p?.role).toBe("student");
  });

  it("rejects a tampered token", async () => {
    const t = await issueToken(SECRET, "student", "student", 60);
    const [body, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ sub: "student", role: "parent", exp: 9999999999 }))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(await verifyToken(SECRET, `${forged}.${sig}`)).toBeNull();
    expect(await verifyToken(SECRET, `${body}.${sig}x`)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const t = await issueToken("another-secret-that-is-long", "student", "student", 60);
    expect(await verifyToken(SECRET, t)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const t = await issueToken(SECRET, "student", "student", 60, Date.now() - 120_000);
    expect(await verifyToken(SECRET, t)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyToken(SECRET, "not-a-token")).toBeNull();
    expect(await verifyToken(SECRET, null)).toBeNull();
  });

  it("refuses to issue with a weak secret", async () => {
    await expect(issueToken("short", "s", "student", 60)).rejects.toThrow();
  });

  it("compares passcodes correctly", async () => {
    expect(await checkSecret("abc123", "abc123")).toBe(true);
    expect(await checkSecret("abc124", "abc123")).toBe(false);
    expect(await checkSecret(undefined, "abc123")).toBe(false);
    expect(await checkSecret("abc", undefined)).toBe(false);
  });
});
