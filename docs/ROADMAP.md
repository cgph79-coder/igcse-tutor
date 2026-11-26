# IGCSE Tutor — development plan

Ideas queued for future work, roughly in priority order. Each has enough detail to start from.

## 1. Arcade-style quiz games

**Goal:** make revision more fun by turning multiple-choice recall into short arcade games, using the same syllabus topics and progress tracking as the rest of the app.

**Inspiration:** Astra Nova's approach of wrapping real learning in game mechanics. The games themselves should be our own designs (own names, art and rules), not copies of any existing game.

**Ideas for game formats** (each a 2–5 minute round, one topic at a time):
- **Asteroid answers** — four answer "asteroids" drift in; steer and shoot the correct one before they reach you. Speed rises with streaks.
- **Lane runner** — run through three lanes, each gate labelled with an answer; switch into the right lane in time.
- **Defend the base** — wrong answers let an enemy through; three lives per round.
- **Speed tiles** — tap the right answer tile as the timer shrinks; combo multipliers for streaks.

**How it would work:**
- Questions: the Worker asks the model for a batch of original multiple-choice questions (e.g. 15) for the chosen topic and tier in strict JSON (question, 4 options, correct index, one-line explanation, optional LaTeX). Validate the JSON on the Worker and cache batches per topic in KV to keep cost down.
- Games: plain canvas or DOM animation in `web/`, lazy-loaded so the main app stays fast. Touch-first controls for phones, keyboard on desktop. No sound by default, with an optional toggle.
- After each round: show the questions he got wrong with explanations, a "Learn this" button that opens the tutor on that topic, and record the score through the existing `ProgressStore` so it feeds the "weak topics" view.
- Motivation: personal bests per topic, daily streaks and simple badges, stored on the device. No leaderboards or social features (privacy and the Children's Code).
- Accessibility: a "calm mode" without time pressure; respects reduced-motion settings.

**Done when:** he can pick a subject and topic, play a round on his phone, see corrections afterwards, and his scores appear in Progress.

## 2. Pomodoro study timer

**Goal:** help him study in focused blocks with proper breaks.

**How it would work:**
- A timer button in the header opens a small panel: start a 25-minute focus block, then a 5-minute break; every 4th break is 15 minutes. Lengths adjustable in settings.
- A compact countdown stays visible while he uses the tutor or games, and shows which topic the block is for.
- End-of-block alert: on-screen message plus optional sound and vibration (and a browser notification if he allows it). The timer must survive switching apps or reloading. Store the end time, not a running counter.
- During breaks, suggest stepping away from the screen. Optionally offer a quick 5-question quiz at the start of the next block to recall the last topic.
- Track completed focus blocks per day and per subject in the `ProgressStore`, and show them on the Progress page (e.g. "6 focus blocks today, 2½ hours this week").
- Optional for the parent view: total focus time per day, without message content.

**Done when:** he can run focus/break cycles on his phone that keep correct time across app switches, with alerts at each change and focus time shown in Progress.

## 3. Student onboarding: subjects, exam year and syllabus updates

**Goal:** when a student first opens the app, they choose their subjects and exam session (e.g. June 2027), and the app makes sure the matching syllabus versions are in place and stay current.

**When to build it:** before adding a second student, or by **September 2027** (ahead of any 2028 exam entries), whichever comes first. Until then the current single-student setup (2025–2027 / 2027–2028 syllabuses) is correct.

**How it would work:**
- **Onboarding screen:** board (Cambridge to start), subjects from a catalogue, tier where relevant, and exam series/year. Saved to the student profile (on the device now, in the database once accounts exist, see `COMMERCIALISATION.md`).
- **Versioned syllabus files:** one file per code *and* version, e.g. `cambridge-0973-2025-2027.json`, `cambridge-0973-2028-2029.json`. The profile's exam year picks the right version for the topic picker, prompts and marking.
- **Syllabus checker:** a scheduled Cloudflare Worker job (e.g. monthly) checks the official Cambridge subject pages for the student's subjects and spots new syllabus versions, updates or "changes to this syllabus" notices.
- **Updating content:** when something new appears, Claude drafts an updated topic file in its own words from the official PDF (Core/Supplement split included), and a parent or admin approves it before it goes live. The app never copies syllabus text wholesale and never ships papers or mark schemes.
- **Notification:** the parent view (and later an email) flags "New syllabus version for 0973 — review update".

**Done when:** a new student can pick subjects and exam year in under a minute, the tutor uses the right syllabus version for that year, and new Cambridge syllabus versions are detected and turned into reviewed updates without manual searching.

## Model choices

- **Photo/PDF marking:** staying on **Claude Sonnet 5.5** (via OpenRouter) for reliability. It costs about 5–10p per multi-page marking. If cost needs optimising, try `anthropic/claude-haiku-5.5` (around 20× cheaper) by changing `LLM_VISION_MODEL` in `worker/wrangler.toml`, then compare marking quality in the parent logs for a week.
- **Text tutoring:** DeepSeek (cheapest). Can move to OpenRouter-hosted models if data location or quality needs it.

## Smaller follow-ups

- Re-check syllabus files if his exams move to 2028 (newer Cambridge syllabus versions exist).
- Move the project folder out of iCloud-synced Documents (iCloud created duplicate "name 2" files).
