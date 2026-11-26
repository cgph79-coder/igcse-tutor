# Claude Code build prompt: IGCSE AI Tutor

Paste everything below the line into Claude Code in an empty folder.

---

I want to build an AI tutor web app for my 16-year-old son's IGCSE study and revision. Build it as a personal tool first, but make the architecture clean enough to commercialise later. Before you write any code, ask me the questions in "Ask me first", then show me a short plan and wait for my go-ahead.

## Ask me first
1. Which exam board (Cambridge International or Pearson Edexcel International) and which subjects/syllabus codes?
2. Which LLM provider to start with: DeepSeek direct, DeepSeek via a US/EU host (e.g. OpenRouter), or another provider. DeepSeek direct stores data in China, so I may prefer a hosted alternative.
3. The name of the app and the GitHub repo.

## Stack and hosting
- **Front end:** static site (Vite + TypeScript, no heavy framework unless you justify one) deployed to GitHub Pages via a GitHub Actions workflow.
- **Backend:** a Cloudflare Worker (Wrangler, TypeScript) that acts as the only route to the LLM. I already have Cloudflare and GitHub accounts.
- **API key:** stored only as a Worker secret (`wrangler secret put`). It must never appear in the front-end code, the repo or logs.
- **Provider abstraction:** call an OpenAI-compatible chat completions endpoint, configured by env vars (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`). Switching provider must need only a config change.
- **Streaming:** stream responses through the Worker to the UI.

## Access control and cost limits
- Simple access for now: a passcode checked by the Worker (store it as a secret) that issues a signed session token. Design this so it can later be swapped for proper user accounts.
- Restrict CORS to the GitHub Pages origin.
- Add a daily token/request cap per user in Cloudflare KV, with a friendly message when he reaches it.
- Set a max-tokens limit per response and trim conversation history so costs stay predictable.

## Privacy and safety (he is a minor)
- Never send personal data to the LLM. The Worker should strip obvious personal information (names, emails, phone numbers, addresses) from messages before forwarding them.
- Don't collect analytics or use third-party trackers.
- Write the session logs as JSON to Cloudflare KV or R2 so I, as the parent, can review them through a password-protected `/parent` view. Keep them for 90 days.
- The tutor stays on educational topics. If he raises anything about wellbeing or safety, it responds kindly, suggests he talks to a parent or trusted adult, and gives the Childline number (0800 1111).

## Core features (MVP)
1. **Subject/topic picker** driven by a config file (`syllabus/<board>-<code>.json`) listing the syllabus topics and subtopics, with a Core/Extended tier flag where relevant. Fill these in from the official public syllabus topic headings, written in your own words, and mark any you're unsure of as `"verify": true` for me to check.
2. **Tutor modes:**
   - *Learn*: explains a topic step by step and checks understanding.
   - *Practise*: sets original exam-style questions at a chosen difficulty and command word (state, describe, explain, calculate), shows the marks available, and then marks his answer.
   - *Mark my answer*: he pastes his question and answer, and it marks them against mark-scheme principles with feedback on how to gain the missing marks.
   - *Quick quiz*: 5–10 rapid-recall questions on a topic.
3. **Maths and science rendering:** KaTeX for LaTeX, and Markdown rendering that is sanitised (DOMPurify).
4. **Progress tracking:** record topics covered and quiz scores per topic in localStorage to begin with, behind a storage interface so it can move to a database later. A simple "weak topics" view should show the lowest-scoring topics.
5. **Mobile-friendly UI:** clean and calm, works well on a phone, with a dark mode.

## Tutor system prompt
Put this in `worker/prompts/tutor.ts` as a template filled with board, subject, syllabus code, tier, topic and mode. Starting draft (improve it, but keep the intent):

> You are a patient, encouraging IGCSE tutor for {board} {subject} ({code}), {tier} tier, currently on: {topic}. Your student is 16.
> - Teach rather than tell. Ask what he already knows, give hints before answers, and only show a full worked solution after a genuine attempt or if he asks twice.
> - Keep strictly to the {code} syllabus content and terminology. If something is beyond the syllabus, say so briefly.
> - Use exam technique: point out command words, mark allocation, units, significant figures and the key words examiners look for.
> - When marking, award marks point by point as a mark scheme would, say exactly where marks were lost, and show a model answer.
> - Keep each response short (under about 150 words unless working requires more), then end with one question or a next step.
> - Use LaTeX for all maths.
> - Be honest. If he's wrong, say so clearly and kindly. Never invent facts. If you're unsure, say so.
> - Stay on schoolwork. Don't ask for or repeat personal information.
> - Mode: {mode-specific instructions}.

## Copyright
Exam-board past papers and mark schemes are copyrighted. **Do not commit them to the repo or bundle them in the app.** All questions must be originals written by the model. Build the app so that I can later add my own private reference material in a gitignored folder if I choose.

## Repo structure and quality
- Monorepo: `/web`, `/worker`, `/syllabus`, `/docs`.
- `README.md` should give step-by-step setup for someone who isn't a full-time developer: local dev, setting Worker secrets, deploying the Worker, enabling GitHub Pages, changing provider, and adding a subject.
- `.env.example` with no real values. Make sure secrets are gitignored.
- Basic tests for the Worker (auth, rate limiting, PII stripping, prompt building).
- `docs/COMMERCIALISATION.md` noting what would need to change for a paid multi-user product: accounts, payments, a database, UK GDPR and the ICO Children's Code, provider terms on under-18 users, and data residency.

## How to work
- Plan first, then build in small, testable steps, committing after each one with clear messages.
- Get the Worker plus a minimal chat page working end to end before building the features.
- Tell me exactly what to run at each point where I need to do something myself (logins, secrets, DNS).
- At the end, give me a short checklist to test it on my phone.
