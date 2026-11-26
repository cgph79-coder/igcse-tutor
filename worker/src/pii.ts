/**
 * Strip obvious personal information before anything is sent to the LLM.
 *
 * This is a best-effort filter, not a guarantee. It removes:
 *  - email addresses, phone numbers, UK postcodes, street addresses
 *  - URLs that could identify accounts (social profiles)
 *  - names introduced in common ways ("my name is X", "I'm called X", "call me X")
 *  - any extra terms configured in the BLOCKED_TERMS secret (e.g. his name, his school)
 *
 * Historical names in schoolwork ("Hitler", "Stalin") are untouched, because we only
 * remove names that are introduced as the speaker's own or are explicitly configured.
 */

export interface PiiResult {
  text: string;
  redactions: string[]; // categories removed, for the parent log (never the values)
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Phone numbers: +44 7700 900123, 07700900123, (020) 7946 0958, +1-202-555-0143 …
const PHONE = /(?<![\w.])(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}(?![\w.])/g;
const UK_POSTCODE = /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/gi;
const STREET =
  /\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][a-z]+\s+){1,3}(?:Road|Rd|Street|St|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Way|Crescent|Court|Ct|Place|Pl|Gardens|Terrace|Grove|Hill|Mews|Square|Boulevard|Blvd)\b\.?/g;
const SOCIAL = /\bhttps?:\/\/(?:www\.)?(?:instagram|facebook|tiktok|snapchat|x|twitter|linkedin|discord)\.[a-z.]+\/\S+/gi;
const INTRO_NAME =
  /\b(my name is|my name's|i am called|i'm called|call me|this is|my (?:mum|mom|dad|brother|sister|friend|teacher)(?:'s name)? is)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/gi;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripPii(input: string, blockedTerms: string[] = []): PiiResult {
  const redactions = new Set<string>();
  let text = input;

  const sub = (re: RegExp, label: string, replacement = `[${label}]`) => {
    text = text.replace(re, () => {
      redactions.add(label);
      return replacement;
    });
  };

  sub(EMAIL, "email");
  sub(SOCIAL, "link");
  sub(STREET, "address");
  sub(UK_POSTCODE, "postcode");
  // Phone: only redact runs with 9+ digits so maths like "3 400 + 2 100" or years survive.
  text = text.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 9) return m;
    redactions.add("phone");
    return "[phone]";
  });
  text = text.replace(INTRO_NAME, (m, intro: string, name: string) => {
    // Only treat it as a name if it's capitalised in the original (e.g. "this is Fred", not "this is Newton's law").
    if (!/^[A-Z]/.test(name)) return m;
    if (intro.toLowerCase() === "this is" && /law|equation|question|answer|because|the|a|an/i.test(name.split(/\s+/)[0]))
      return m;
    redactions.add("name");
    return `${intro} [name]`;
  });

  for (const term of blockedTerms.map((t) => t.trim()).filter((t) => t.length >= 2)) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
    if (re.test(text)) {
      redactions.add("name");
      text = text.replace(re, "[name]");
    }
  }

  return { text, redactions: [...redactions] };
}

export function parseBlockedTerms(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
