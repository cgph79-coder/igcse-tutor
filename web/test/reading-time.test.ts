import { describe, expect, it } from "vitest";
import { readingTimeMs } from "../src/games/asteroids";

describe("reading pause", () => {
  it("gives short cards the minimum and long cards more, up to a cap", () => {
    expect(readingTimeMs("$x^2$?", ["1", "2", "3", "4"])).toBe(2000);
    const medium = readingTimeMs("What is the unit of electrical resistance?", ["ohm", "volt", "ampere", "watt"]);
    expect(medium).toBeGreaterThan(3000);
    expect(medium).toBeLessThan(4000);
    expect(readingTimeMs("x".repeat(200), ["y".repeat(30), "y".repeat(30), "y".repeat(30), "y".repeat(30)])).toBe(6000);
  });

  it("doesn't count LaTeX markup as reading", () => {
    const plain = readingTimeMs("The sum to infinity of a GP with ratio r is", ["a/(1-r)", "a/(1+r)", "ar", "a(1-r)"]);
    const latex = readingTimeMs("The sum to infinity of a GP with ratio $r$ is", ["$\\frac{a}{1-r}$", "$\\frac{a}{1+r}$", "$ar$", "$a(1-r)$"]);
    expect(Math.abs(plain - latex)).toBeLessThan(300);
  });
});
