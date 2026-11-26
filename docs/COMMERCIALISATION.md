# Turning IGCSE Tutor into a paid product

The current build is a personal tool for one student. The code is already split so that the main pieces can be swapped, but a paid, multi-user product needs the changes below. **This is not legal advice**; get a UK solicitor who knows education technology and data protection before launch.

## 1. Accounts

- **Now:** one shared passcode → signed token (`worker/src/auth.ts`), single user id `"student"`.
- **Change:** replace `auth.ts` with a real identity provider (e.g. Cloudflare Access, Auth0, Clerk, Supabase Auth). Tokens then carry a real user id, and everything keyed by user (`usage:<user>`, `log:<user>:…`) works unchanged.
- **Parents and children:** parent accounts that create and manage linked child accounts. Parent-held consent (see §4).
- **Schools:** organisation accounts, teacher dashboards and class groups if selling to schools.

## 2. Payments

- Stripe (Checkout + Billing) for subscriptions; parents pay, never the child.
- Store the plan on the user and enforce plan-based limits in `ratelimit.ts` instead of the fixed `DAILY_*` values.
- Handle VAT (Stripe Tax), refunds, failed payments and cancellation.

## 3. Database

- **Now:** progress in `localStorage` behind the `ProgressStore` interface (`web/src/storage.ts`); usage and logs in Cloudflare KV.
- **Change:** a relational database (Cloudflare D1 or Postgres) for users, subscriptions, progress, scores and logs. Add a `ProgressStore` implementation that calls new Worker endpoints. KV's eventual consistency is fine for one user but not for billing-grade usage counting; use Durable Objects or the database for that.
- Backups, data export and account deletion on request.

## 4. UK GDPR and the ICO Children's Code

The Age Appropriate Design Code (Children's Code) applies to online services likely to be accessed by under-18s in the UK. Key duties:

- **DPIA:** do a Data Protection Impact Assessment before launch.
- **Best interests of the child** as a primary consideration in design.
- **High privacy by default:** no profiling, no nudge techniques, no geolocation, data minimisation (the PII filter and no-analytics approach already help).
- **Lawful basis and consent:** in the UK a child can consent to an online service at 13, but for a paid service parents will be the contracting party. Be clear about the lawful basis for processing.
- **Transparency:** privacy information written for teenagers as well as parents.
- **Parental controls:** if parents can see logs, the child must be told clearly (an always-visible notice in the app).
- **Retention:** define and enforce retention periods (currently 90 days for logs).
- **Data subject rights:** access, correction, deletion, portability.
- **Security:** encryption, access controls, breach procedures (72-hour ICO reporting).
- Register with the ICO and pay the data protection fee.
- Consider **safeguarding policy**, a designated safeguarding lead, and how flagged conversations are escalated, especially if selling to schools.
- Watch the **Online Safety Act** duties for services accessible to children.

## 5. LLM provider terms for under-18 users

- Check each provider's terms and usage policies before launch; several restrict or set conditions on products used by minors.
- **Anthropic:** organisations may build products for under-18s only with additional safeguards (e.g. age-appropriate content controls, safety messaging, monitoring) and in line with its usage policy.
- **OpenAI:** has its own requirements for apps used by minors.
- **DeepSeek:** check current terms on minors and on commercial use; data is stored in the PRC.
- Prefer providers offering zero data retention / no training on API data, and record this in the DPIA.

## 5a. Photos of children's work

- Photos can contain names, faces, school logos or handwriting, which the text privacy filter can't remove. Consider on-device face/text redaction before upload, and say clearly in the privacy notice that images are processed by a third-party AI provider.
- Keep the current rule of never storing images; if stored for parent review, set short retention and encrypt at rest (e.g. R2 with lifecycle rules).
- Check each vision provider's terms for images of minors and confirm zero data retention.

## 6. Data residency and transfers

- **DeepSeek direct** stores data in China. Transfers of UK personal data there need a lawful transfer mechanism and a transfer risk assessment, which is hard to justify for children's data. Strongly prefer UK/EU/US hosting.
- **OpenRouter:** route only to providers in acceptable jurisdictions (provider allow-lists) and check OpenRouter's own logging settings.
- **Cloudflare:** Workers run globally; use Cloudflare's Data Localisation Suite or jurisdictional restrictions if EU/UK residency is required for stored data (KV/D1/R2).
- List all sub-processors in the privacy notice.

## 7. Content and quality

- **Copyright:** keep the rule that no past papers or mark schemes ship in the product. Licensing material from exam boards or publishers is a separate commercial conversation.
- **Syllabus accuracy:** have a subject specialist review every `syllabus/*.json` (`"verify": true` items first) and the subject guidance in `tutor.ts`.
- **Evaluation:** build a test set of questions and model answers per subject to check marking accuracy before changing models or prompts.
- **Trademarks:** "Cambridge" and "IGCSE" are trade marks of Cambridge University Press & Assessment. Don't imply endorsement; check how to describe compatibility.

## 8. Reference material

`private-reference/` is gitignored. To use it in a product, licensed material would be indexed server-side (e.g. Cloudflare Vectorize) and retrieved per question, with licences recorded. Nothing from that folder should ever be bundled into the website.

## 9. Operations

- Monitoring and alerting (errors, cost per user, provider outages), with no message content in logs.
- Per-user and global spend caps at the provider.
- Abuse protection (Cloudflare Turnstile on sign-up, rate limits by IP).
- Status page, support email, terms of service, refund policy, accessibility (WCAG 2.2 AA).
