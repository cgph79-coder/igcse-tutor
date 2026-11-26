/**
 * Safeguarding checks. The system prompt also tells the tutor how to respond to
 * wellbeing topics; this server-side check is a backstop for the clearest high-risk
 * phrases, which get a fixed, kind reply without going to the LLM at all.
 *
 * Patterns are first-person so history topics (e.g. "Hitler's suicide") don't trigger.
 */

const HIGH_RISK = [
  /\b(kill(ing)?|hurt(ing)?|harm(ing)?|cut(ting)?) (my ?self|myself)\b/i,
  /\bself[- ]?harm(ing)?\b/i,
  /\bsuicidal\b/i,
  /\b(i|i'm|im|i am) (going to|gonna|want to|wanna|thinking about|thinking of) (commit suicide|end it all|end my life|die)\b/i,
  /\b(want|wanna|wish i could|wish to) (to )?die\b/i,
  /\bend(ing)? my (own )?life\b/i,
  /\b(don'?t|do not) want to (be alive|live( anymore)?|exist)\b/i,
  /\b(someone|somebody|he|she|they|my \w+) (is|are|keeps?) (hurting|hitting|abusing|touching) me\b/i,
  /\bi('m| am) being (abused|hurt|hit)\b/i,
];

const WELLBEING = [
  /\b(i'?m|i am|feeling|feel) (so |really |very )?(sad|depressed|anxious|lonely|scared|stressed|overwhelmed|hopeless|worthless)\b/i,
  /\b(being )?bull(y|ied|ying)\b/i,
  /\bpanic attacks?\b/i,
  /\bcan'?t cope\b/i,
];

export type SafetyLevel = "none" | "wellbeing" | "high";

export function assessSafety(text: string): SafetyLevel {
  if (HIGH_RISK.some((re) => re.test(text))) return "high";
  if (WELLBEING.some((re) => re.test(text))) return "wellbeing";
  return "none";
}

export const HIGH_RISK_REPLY = [
  "I'm really glad you told me, and I'm sorry you're going through this. You matter, and you don't have to deal with it on your own.",
  "",
  "I'm only a study tutor, so I'm not the right one to help with this — but people are ready to listen right now:",
  "",
  "- **Talk to a parent or another adult you trust** today if you can.",
  "- **Childline: call 0800 1111** — free, confidential, any time, day or night. You can also chat online at childline.org.uk.",
  "- **If you are in danger right now, call 999.**",
  "",
  "Whenever you're ready to get back to revision, I'll be here.",
].join("\n");
