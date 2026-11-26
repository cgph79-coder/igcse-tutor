import { describe, expect, it } from "vitest";
import { getUsage, isOverLimit, recordUsage, ukDay, loginThrottled, recordLoginFailure } from "../src/ratelimit";
import { MemoryKV } from "./helpers";

describe("daily usage caps", () => {
  it("counts requests and tokens per day", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await recordUsage(kv, "student", 500);
    await recordUsage(kv, "student", 250);
    expect(await getUsage(kv, "student")).toEqual({ requests: 2, tokens: 750 });
  });

  it("keeps users and days separate", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    const d1 = new Date("2026-03-01T12:00:00Z");
    const d2 = new Date("2026-03-02T12:00:00Z");
    await recordUsage(kv, "a", 10, d1);
    expect(await getUsage(kv, "a", d2)).toEqual({ requests: 0, tokens: 0 });
    expect(await getUsage(kv, "b", d1)).toEqual({ requests: 0, tokens: 0 });
  });

  it("flags when either limit is reached", () => {
    const limits = { requests: 10, tokens: 1000 };
    expect(isOverLimit({ requests: 9, tokens: 999 }, limits)).toBe(false);
    expect(isOverLimit({ requests: 10, tokens: 0 }, limits)).toBe(true);
    expect(isOverLimit({ requests: 0, tokens: 1000 }, limits)).toBe(true);
  });

  it("rolls the day over at midnight UK time (BST)", () => {
    // 23:30 UTC on 1 July is 00:30 BST on 2 July
    expect(ukDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(ukDay(new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-01");
  });

  it("throttles repeated failed logins", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    for (let i = 0; i < 3; i++) await recordLoginFailure(kv, "1.2.3.4");
    expect(await loginThrottled(kv, "1.2.3.4", 3)).toBe(true);
    expect(await loginThrottled(kv, "5.6.7.8", 3)).toBe(false);
  });
});
