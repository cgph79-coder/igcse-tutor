import { describe, expect, it } from "vitest";
import { stripPii } from "../src/pii";

describe("PII stripping", () => {
  it("removes emails", () => {
    const r = stripPii("email me at sam.jones@example.co.uk please");
    expect(r.text).toBe("email me at [email] please");
    expect(r.redactions).toContain("email");
  });

  it("removes UK and international phone numbers", () => {
    expect(stripPii("call 07700 900123").text).toBe("call [phone]");
    expect(stripPii("ring +44 20 7946 0958 now").text).toContain("[phone]");
    expect(stripPii("+1-202-555-0143").text).toBe("[phone]");
  });

  it("leaves ordinary numbers, years and maths alone", () => {
    const s = "In 1919 the treaty cost 6600 million pounds; solve 3x + 4 = 25 and 12 345 × 2";
    expect(stripPii(s).text).toBe(s);
  });

  it("removes postcodes and street addresses", () => {
    const r = stripPii("I live at 42 Acacia Avenue, London SW1A 1AA");
    expect(r.text).not.toContain("Acacia");
    expect(r.text).not.toContain("SW1A");
    expect(r.redactions).toEqual(expect.arrayContaining(["address", "postcode"]));
  });

  it("removes self-introduced names", () => {
    expect(stripPii("Hi, my name is Oliver Smith").text).toBe("Hi, my name is [name]");
    expect(stripPii("call me Ollie").text).toBe("call me [name]");
  });

  it("keeps historical names", () => {
    const s = "Why did Hitler and Stalin sign the Nazi-Soviet Pact?";
    expect(stripPii(s).text).toBe(s);
  });

  it("removes configured blocked terms case-insensitively", () => {
    const r = stripPii("At ZEBEDEE school we did this", ["Zebedee"]);
    expect(r.text).toBe("At [name] school we did this");
  });

  it("removes social profile links", () => {
    expect(stripPii("see https://instagram.com/someone123").text).toBe("see [link]");
  });
});
