# IGCSE Tutor

An AI study and revision tutor for Cambridge IGCSE, built for one student first and structured so it could become a product later.

**Subjects:** Additional Mathematics (0606), Co-ordinated Sciences Double Award (0973), Computer Science (0984), History (0977, Option B with Germany, Russia and the USA).

**Modes:** Learn · Practise (original exam-style questions, marked) · Mark my answer · Quick quiz. Progress and a "weak topics" list are kept on the device.

**Photos and files:** tap 📎 to add up to 4 photos of handwritten work, a PDF, a Word (.docx) or a .txt file. Typed files are read on the phone and go through the normal tutor. Photos and scanned PDFs go to an image-reading model (Claude Sonnet via OpenRouter by default), which marks the work against the syllabus and mark-scheme principles.

## How it fits together

```
Phone / browser ──► GitHub Pages (web/)  ──►  Cloudflare Worker (worker/)  ──►  LLM provider
                    static site, no secrets     passcode check, daily caps,       (DeepSeek, OpenRouter,
                                                privacy filter, safeguarding,      or any OpenAI-compatible API)
                                                parent logs in KV (90 days)
```

- The **API key lives only in the Worker** as a Cloudflare secret. It is never in the website, the repo or the logs.
- Only your GitHub Pages site may call the Worker.
- Before any message reaches the AI, the Worker removes emails, phone numbers, addresses, postcodes, self-introduced names and any words you list in `BLOCKED_TERMS`.
- Clear self-harm or abuse messages get a fixed, kind reply with Childline (0800 1111) and are never sent to the AI. They're flagged in the parent view.

```
igcse-tutor/
├── web/                 the website (Vite + TypeScript)
├── worker/              the Cloudflare Worker (+ tests)
│   └── src/prompts/tutor.ts   the tutor's instructions
├── syllabus/            one JSON file per subject
├── docs/                BUILD_BRIEF.md, COMMERCIALISATION.md
└── private-reference/   your own papers/notes — gitignored, never uploaded
```

---

## Setup, step by step

You need: a Mac with **Node.js 22 or newer** (`node -v` to check; install from nodejs.org), your **Cloudflare** account, your **GitHub** account, and an API key from your LLM provider (DeepSeek: platform.deepseek.com → API keys).

All commands are run in Terminal from the project folder.

### 1. Install

```bash
npm install
```

### 2. Try it on your computer (optional)

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

Edit `worker/.dev.vars` and fill in your API key and some passcodes. Then, in two Terminal windows:

```bash
npm run dev:worker
```

```bash
npm run dev:web
```

Open http://localhost:5173/igcse-tutor/ and log in with the `TUTOR_PASSCODE` you chose.

### 3. Set up the Cloudflare Worker

Log in (opens your browser):

```bash
npx wrangler login
```

Create the storage for daily limits and parent logs:

```bash
npx wrangler kv namespace create TUTOR_KV --cwd worker
```

It prints an `id = "…"`. Copy that id into `worker/wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

Now add the secrets. Each command asks you to paste a value; nothing is saved in the repo.

```bash
npx wrangler secret put LLM_API_KEY --cwd worker
```

```bash
npx wrangler secret put TUTOR_PASSCODE --cwd worker
```

```bash
npx wrangler secret put PARENT_PASSWORD --cwd worker
```

```bash
npx wrangler secret put TOKEN_SECRET --cwd worker
```

For `TOKEN_SECRET`, paste a long random string. You can make one with:

```bash
openssl rand -hex 32
```

Optional but recommended: words that should always be removed before anything reaches the AI, such as your son's first name, surname and school, comma-separated:

```bash
npx wrangler secret put BLOCKED_TERMS --cwd worker
```

Deploy:

```bash
npm run deploy:worker
```

It prints your Worker's address, like `https://igcse-tutor-worker.<your-subdomain>.workers.dev`. Keep it for step 4.

> **Keep in mind:** use a different value for `TUTOR_PASSCODE` and `PARENT_PASSWORD`. Changing `TOKEN_SECRET` logs everyone out.

### 4. Put the website on GitHub Pages

1. Create an empty repository called `igcse-tutor` on GitHub (private or public; the website will be public either way, but only usable with the passcode).
2. Push this folder to it:

   ```bash
   git remote add origin https://github.com/cgph79-coder/igcse-tutor.git
   ```

   ```bash
   git push -u origin main
   ```

3. On GitHub, open the repo → **Settings → Pages** → under "Build and deployment", set **Source** to **GitHub Actions**.
4. **Settings → Secrets and variables → Actions → Variables tab → New repository variable**: name `WORKER_URL`, value = the Worker address from step 3.
5. **Actions** tab → "Deploy web app to GitHub Pages" → **Run workflow** (it also runs on every push).

The site will be at **https://cgph79-coder.github.io/igcse-tutor/**, and the parent view at **https://cgph79-coder.github.io/igcse-tutor/parent/**.

If your GitHub username or the repo name is different, update `ALLOWED_ORIGINS` in `worker/wrangler.toml` to `https://<username>.github.io` and run `npm run deploy:worker` again.

---

## Everyday changes

### Change the AI provider

Edit `worker/wrangler.toml`:

| Provider | `LLM_BASE_URL` | `LLM_MODEL` (example) |
|---|---|---|
| DeepSeek direct (data stored in China) | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenRouter (choose US-hosted providers) | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat` or `anthropic/claude-sonnet-5.5` |
| Anthropic direct | `https://api.anthropic.com/v1` | `claude-sonnet-5-5` |

Then put the new provider's key in place and redeploy:

```bash
npx wrangler secret put LLM_API_KEY --cwd worker
```

```bash
npm run deploy:worker
```

Model names change over time; check the provider's model list if you get an error.

### Photo checking (OpenRouter)

Photos need a model that can read images; DeepSeek can't. By default they go to Claude Sonnet through OpenRouter (about 1.5p per photo checked). Everything else stays on DeepSeek.

1. Sign up at openrouter.ai, add credit (e.g. $10, auto top-up off), switch off prompt training/logging in **Settings → Privacy**, and create a key under **Keys** with a credit limit.
2. Give the key to the Worker:

   ```bash
   npx wrangler secret put LLM_VISION_API_KEY --cwd worker
   ```

Until that key is set, the app tells him photo checking isn't switched on yet. To use a cheaper model, change `LLM_VISION_MODEL` in `worker/wrangler.toml` (e.g. `anthropic/claude-haiku-5.5`) and run `npm run deploy:worker`.

Privacy: photos are shrunk on the phone, sent only through your Worker, and never stored — the parent log shows "[1 photo(s) attached]" plus the tutor's feedback. The privacy filter can't remove names written in a photo, so the app reminds him to crop them out, and the tutor is told to ignore any it sees. On OpenRouter the Worker asks for providers that don't store or train on prompts.

### Change the daily limits or reply length

In `worker/wrangler.toml`: `DAILY_REQUEST_LIMIT`, `DAILY_TOKEN_LIMIT`, `MAX_TOKENS`, `MAX_HISTORY_MESSAGES`. Then `npm run deploy:worker`. Days reset at midnight UK time.

### Add a subject

See [`syllabus/README.md`](syllabus/README.md): copy a JSON file, fill in the topics, add one line to `syllabus/index.ts`, then push (the website rebuilds) and run `npm run deploy:worker`. For better exam technique, add a short entry for the new code in `SUBJECT_GUIDANCE` in `worker/src/prompts/tutor.ts`.

### Check the syllabus topics

Anything marked `"verify": true` in `syllabus/*.json` is something to check against the official Cambridge syllabus PDF.

### Run the tests

```bash
npm test
```

---

## Privacy and safety

- No analytics, no trackers, no third-party scripts. Progress is stored only on his device.
- Parent logs hold the privacy-filtered text (what the AI saw) and are deleted automatically 90 days after the session's last message.
- The privacy filter is best-effort. `BLOCKED_TERMS` is the most reliable way to stop specific names reaching the AI.
- If the provider stores data abroad (DeepSeek direct stores in China), the schoolwork itself still goes there.

## Copyright

Exam-board past papers and mark schemes are copyrighted. **Never commit them.** All questions are written by the AI. Put any private reference material in `private-reference/` — git ignores everything in it.

## Troubleshooting

- **"That passcode isn't right"** — re-set it with `npx wrangler secret put TUTOR_PASSCODE --cwd worker`. After 10 wrong tries the Worker blocks that network for an hour.
- **Login works but nothing happens / network error** — `WORKER_URL` in GitHub is wrong, or `ALLOWED_ORIGINS` doesn't match your site's address.
- **"The tutor isn't set up correctly"** — the API key is wrong or the account is out of credit.
- **See what the Worker is doing** — `npx wrangler tail --cwd worker` (message contents are never logged).
