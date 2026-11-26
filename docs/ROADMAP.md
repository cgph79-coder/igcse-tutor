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

## Smaller follow-ups

- Re-check syllabus files if his exams move to 2028 (newer Cambridge syllabus versions exist).
- Move the project folder out of iCloud-synced Documents (iCloud created duplicate "name 2" files).
