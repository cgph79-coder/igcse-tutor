# IGCSE Tutor — development plan

Ideas queued for future work, roughly in priority order. Each has enough detail to start from.

## Feedback log

Quick fixes from using the app. **Check this first at the start of each work session.** Size: **S** = under an hour, do it now · **M** = a few hours, schedule it · **L** = becomes a numbered item below. Status: *new*, *doing*, *done* (with where it went), or *won't do* (with why).

| # | Date | From | Area | Feedback | Size | Status |
|---|------|------|------|----------|------|--------|
| F1 | 2026-11-26 | Student (via parent) | Arcade | Not enough time to read the question before the rocks start falling. | S | done: reading pause of 2–6 s with a progress bar (PR #4) |
| F2 | 2026-11-26 | Card review | Arcade cards | 2 wrong and 2 weak History cards out of 26 (see "Card quality" below). | M | done: 4 cards removed from the live bank; every new batch is now checked before use (PR #5) |

**Adding feedback:** add a row with the next number. Write what happened in the user's words, not the fix. Keep fixed items for a month, then move them to the bottom of this file's history (git keeps the rest).

**In-app feedback (built, Nov 2026).** He can send feedback from:
- a "Send feedback" card on Progress;
- a link at the bottom of the Arcade results screen;
- a **Report this card** link on every missed card. This opens the form with the card and its marked answer already filled in.

The form has an area (Tutor, Arcade, Timer, Other), up to 500 characters, and a "This happened just now" tick, on by default, that attaches the app version, screen, subject, topic and game. It never attaches the conversation.

It goes to `POST /api/feedback` (`worker/src/feedback.ts`): the same privacy filter as chat, wellbeing/safeguarding words flagged for the parent, 20 per day, kept for the log retention period. The parent view's **Feedback** list shows each item with **Copy as log row** (a ready-made row for the table above) and **Done** (removes it once it's in the log).

**Routine:** open the parent view → copy new items into this table (give each the next F-number, a size and a status) → press Done.

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

**Status (Nov 2026): first game live.** Built: `POST /api/quiz-questions` (validated JSON, options shuffled, up to 80 questions banked per topic in KV for 30 days, banked rounds still playable after the daily limit), the lazy-loaded **Arcade** view (`web/src/arcade.ts`), **Asteroid answers** (`web/src/games/asteroids.ts`), calm mode, reduced-motion support, results with explanations and "Learn this", scores in Progress (mode `arcade`), personal bests per topic and a daily streak on the device.
**Question set:** the arcade has its own bank of recall cards, written by a separate prompt (`buildQuizPrompt` in `worker/src/quiz.ts`) and stored under `qbank:cards-v2:…` in KV. Each card tests one core fact (term, definition, formula, rule, date, keyword) that he should recognise in a few seconds: a confirmation exercise like flashcards, not exam practice or a way to work through the modules. Questions are under ~100 characters and options under ~30. Negative questions ("Which is NOT…") are rejected, the difficulty is kept even, and each card's explanation is the fact to remember.
**Card quality (Nov 2026 review):** a review of the first 26 live cards (History 0977) found 2 wrong (the Nazi Party founding year; Volksgemeinschaft confused with uniting all Germans) and 2 weak (a filler option; a title with two defensible answers). Those 4 were removed from the live bank. Every new batch now goes through a **checking pass**: a second model call judges each card (wrong or not-best answer, a second defensible option, inaccurate details, opinion questions, filler options, repeated facts, off-topic), and only cards it explicitly passes are served and saved. If the check fails, that batch can be played once but is never saved. The writing prompt also asks for exact dates and names, real wrong options and no "main/most" questions. Logs show `valid=… checked=… passed=…` per batch (`npx wrangler tail`). Re-review a sample of live cards per subject now and then.
**Getting harder:** within a round, cards come easiest first (each card has a level: 1 essentials, 2 finer detail, 3 precise distinctions; about 3/4/3 per round). A banner announces each new level, and every card falls about 6.5% faster than the one before (card 10 is roughly 45% quicker), faster again on a streak. Calm mode keeps the harder cards but drops the timer. **Reading pause** (added after his first feedback): before the rocks move, each card holds for 2–6 s depending on how much text the question and answers have (LaTeX markup isn't counted), shown by a thin bar under the question. A level-up banner comes first and adds its own pause. He can answer during the pause and still gets the full time bonus. Tune with the `READ_*` constants in `web/src/games/asteroids.ts`. Between rounds, each topic has 5 **sectors**: scoring 8/10 or better moves him up one, and each sector starts about 10% faster.
**Synthesis (synthesis.com) as a reference:** public material says little about its game rules. What's described: fast, quick-thinking arcade games kept apart from tracked lessons; mastery before moving on; unlocking levels; and a "mistakes are expected" tone. We borrowed the level-up/unlock feel (sectors), mastery gating (8/10 to advance) and the tone on the results screen. Worth a hands-on look at their Arcade (free trial) before building the next games.
Next: Lane runner, Defend the base, Speed tiles (see also item 1b, the Dispatches story game) (each a new `StartGame` in `web/src/games/` plus an entry in `GAMES`); simple badges; optional sound toggle; spot-check real generated questions for accuracy in the first week.

## 1b. Story game: Dispatches (History text adventure)

**Goal:** a slower, story-led way to use the same recall cards. It's a text adventure in the journey-survival genre (our own design and name). He plays a young correspondent for a fictional London paper, travelling a route through the period he's studying and checking one fact at every stop.

**Status (Nov 2026): first version built, History (0977) only, one topic per run.**
- **Files:** `web/src/games/journey-core.ts` holds the rules (pure and tested in `web/test/journey.test.ts`). `journey-content.ts` holds the routes, scenes, incidents and the game name (`GAME_NAME`). `journey.ts` is the screen and `journey-save.ts` the save.
- **A run:** 10 stops (fewer if fewer cards come back; the destination is kept), one card per stop, easiest first. Resources: money, energy (out of 5), editor's trust (out of 6), contacts and days left (deadline 21 days for 10 stops). A right answer gains something and a wrong one costs something, depending on the scene. Between stops he can **press on**, **rest** (costs money, restores energy) or **write a quick piece** (earns money, costs energy). Then he picks how to travel: **express** (dear, fast), **local train**, or **hitch** (free, tiring, more road incidents).
- **Contacts:** spending one rules out two wrong answers. The card is still marked correct if he then gets it right, but scores 50 instead of 100.
- **Endings:** front page (trust 5+), published (3–4), page 9 (below 3). Arriving after the deadline drops it one level. If energy or trust hits 0 he's sent home or recalled before the end. Finished runs add a bonus for what's left.
- **Routes by section:** Germany (Munich → Berlin), Russia (Vladivostok → Moscow by rail), USA (Los Angeles → New York), the inter-war years (London → Geneva) and the Cold War (Washington → Moscow). Place names were chosen because they didn't change during the period. A general route covers anything else.
- **Accuracy:** the scenes are everyday reporter situations with **no historical claims**, so the only facts in the game are the arcade's checked cards. Keep it that way when adding scenes.
- **Saving:** the run is saved on the device after every step, one per topic. The Arcade shows **Continue** and **Start again**, and "Save & exit" is always available.
- **Fits the Arcade:** uses the same `/api/quiz-questions` cards (no extra AI cost), results screen, "Learn this", "Report this card", Progress scores (mode `arcade`) and personal bests. No timer, so calm mode doesn't apply. Keys 1–4 / A–D work.
- **Balance (simulated):** 70% of cards right gives a front page about 45% of the time. Half right gets him recalled about a quarter of the time.

**Next:**
- **Mixed runs:** one card from each topic in a section (e.g. the whole Germany depth study), using `buildRound` across topics. This needs a small Worker change (a list of topic ids, or a "section" option) and a section-level score in Progress.
- **More subjects:** each needs a setting (an expedition for the sciences, a ship's computer for Computer Science, supplies and distances for Add Maths) in `journey-content.ts`, and an entry in the game's `subjects`.
- **Richer story:** scenes tied to a topic (e.g. a Berlin hotel during hyperinflation for Weimar) would need checking like the cards. One option is for Claude to write a scene deck per topic once, run it through the checking pass, and bank it in KV.
- Ask him for feedback after his first few runs: is the length right (about 10–15 minutes), and is it too easy or too hard?

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

**Status (Nov 2026): built.** ⏱ in the header opens the timer (`web/src/pomodoro.ts`; timing logic in `pomodoro-core.ts` with tests in `web/test/`). It stores the end time, so it catches up after app switches and reloads, starting the break from when the focus really ended. A slim bar under the header shows phase, topic and countdown in every view. Alerts: on-screen message, a short chime, vibration, and a browser notification if allowed. Settings for lengths, sound and vibration. At the end of a break it offers "Start focus" or a recall round in the Arcade. Completed blocks are kept on the device and shown in Progress (today, this week, per subject).
Limits: phones pause web pages in the background, so the chime and notification fire when he comes back to the app, not exactly on time, unless the tab is still running. A true background alarm would need the app installed as a PWA with push notifications.
**Parent view (built, Nov 2026):** each finished focus block (end time, minutes, subject code; no topic text or content) goes to `POST /api/focus` through an on-device outbox (`web/src/focus-sync.ts`), so offline blocks are sent later. The Worker keeps one total per UK day (`focus:<user>:<day>` in KV, same retention as logs; a resent block is only counted once) and the parent view shows the last 7 days with minutes per subject and the previous week's total.

## Installable app (PWA)

**Status (Nov 2026): built.** The site can be added to a phone's home screen without an app store: a web app manifest (`web/public/manifest.webmanifest`), icons (`web/public/icons/`, made from the "IG" mark), iPhone home-screen tags, and a service worker (`web/public/sw.js`). Pages load network-first so new deploys show at once, built files are cached so the app opens offline, `version.json` is never cached, and Worker calls are never touched. Progress shows an "Install the app" card: the browser's install button on Android and desktop, Share → Add to Home Screen steps on iPhone. Timer notifications go through the service worker, which installed iPhone apps require (iOS 16.4+).
Note: on iPhone the installed app has its own storage, so he logs in again and progress starts fresh there.
**Next (optional): timer alarms that are on time in the background.** Web Push: the app subscribes when a focus block starts, and the Worker sends the push at the block's end time (Cloudflare Queues or a Durable Object alarm, with VAPID keys as Worker secrets). This works for installed web apps on iPhone and doesn't need the App Store.

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

## 4. Requests for more subjects and boards

**Goal:** let a student (or parent) ask for a subject or exam board the app doesn't cover yet, see what happened to the request, and have new subjects added through a checked, repeatable process rather than one-off work.

**How it would work:**
- **Asking:** a "Request a subject" link under the subject list (in the tutor settings, the Arcade and later the onboarding screen) opens a short form:
  - board (Cambridge, Pearson Edexcel, AQA, OCR, WJEC/Eduqas, other);
  - qualification (IGCSE, GCSE, A level, other);
  - subject;
  - syllabus code if known;
  - exam year;
  - an optional note ("Paper 2 only", "Foundation tier").

  No free-text personal details. The note goes through the same privacy filter as chat.
- **Storing:** `POST /api/requests` saves it in KV (`request:<id>`) with a status. One request per subject per board, so duplicates add a "+1" rather than a new entry. A daily cap stops spam.
- **Tracking:** the parent view gets a **Requests** list. Statuses are *requested → reviewing → drafting → ready to check → live*, or *declined* with a reason (e.g. "board doesn't publish a public specification", "too close to exams to add now"). The student sees the status of their own requests in the app.
- **Adding a subject (the repeatable part):**
  1. Claude drafts `syllabus/<board>-<code>-<years>.json` from the board's official specification, in its own words, with the section/topic structure, Core/Extended or Foundation/Higher split, papers, grading and calculator rules. It never copies the specification text, past papers or mark schemes.
  2. A validation script checks the file against the `Syllabus` type: unique ids, every topic has subtopics, and the tiers match.
  3. Subject guidance for the tutor prompt (`SUBJECT_GUIDANCE` in `worker/src/prompts/tutor.ts`): exam technique, units, the board's command words and how marking works (levels or points).
  4. A quality sample: a few tutor replies and two arcade batches per subject are reviewed (as in the November card review) before release.
  5. A parent/admin approves, the file is registered in `syllabus/index.ts`, and the request is marked *live* (the student is told).
- **Board differences to design for:** tier names (Core/Extended vs Foundation/Higher), grading (A*–G vs 9–1), command-word lists, paper structures and coursework. Add these as fields on the syllabus rather than special cases in code.
- **Links:** shares the subject catalogue and versioned syllabus files with onboarding (item 3). Once there are several students, request counts show which subjects to add first (see `COMMERCIALISATION.md`).

**Done when:** a student can request a subject in under 30 seconds and see its status; a parent sees all requests in one place; and adding an approved subject follows the checklist above, ending in a validated syllabus file and a reviewed quality sample.

## Model choices

- **Photo/PDF marking:** staying on **Claude Sonnet 5.5** (via OpenRouter) for reliability. It costs about 5–10p per multi-page marking. If cost needs optimising, try `anthropic/claude-haiku-5.5` (around 20× cheaper) by changing `LLM_VISION_MODEL` in `worker/wrangler.toml`, then compare marking quality in the parent logs for a week.
- **Text tutoring:** DeepSeek (cheapest). Can move to OpenRouter-hosted models if data location or quality needs it.

## Smaller follow-ups

- Re-check syllabus files if his exams move to 2028 (newer Cambridge syllabus versions exist).
- Move the project folder out of iCloud-synced Documents (iCloud created duplicate "name 2" files).
