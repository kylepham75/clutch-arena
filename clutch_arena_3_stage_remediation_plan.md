# Clutch Arena: 3-Stage Pre-Launch & Expansion Remediation Plan

This execution plan divides every technical, compliance, and monetization fix identified in the **Clutch Arena** (`v0.2.2 / v0.2.4`) audit into **3 sequential stages**, complete with exact file targets, acceptance criteria, and copy-paste prompts you can feed directly into **Antigravity** for each stage.

## Overview of the 3 Stages

| Stage | Execution Gate | Included Fixes | Target Files | Est. Effort |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1: Critical Launch Blockers (P0)** | **Gate 1:** Must finish before sharing any public link in university Zalo or Facebook groups | 1. Deploy [PartyKit](https://docs.partykit.io/) production host<br>2. Lock checkout UI to Vietnam [PayOS VietQR](https://payos.vn/) (with ROW waitlist banner)<br>3. Publish `/terms` & `/privacy` pages ([OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr) & [Vietnam Decree 13](https://english.luatvietnam.vn/decree-no-13-2023-nd-cp-dated-april-17-2023-of-the-government-on-personal-data-protection-249791-doc1.html)) | `party/arena.ts`, `hooks/use-arena-room.ts`, `components/pricing/pricing-modal.tsx`, `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/layout.tsx` | **3.0 Hours** |
| **Stage 2: Pre-Scale & Viral Safeguards (P1)** | **Gate 2:** Must finish before running 50-player campus tournaments or paid traffic | 4. Enforce [Upstash Redis](https://upstash.com/pricing/redis) rate limiting in production<br>5. Add OpenGraph (`og:image`), `sitemap.ts` & `robots.ts`<br>6. Install [Sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/) error & webhook monitoring<br>7. Build self-serve account cascade deletion on [Supabase](https://supabase.com/) | `lib/rate-limit.ts`, `app/layout.tsx`, `app/sitemap.ts`, `app/robots.ts`, `sentry.client.config.ts`, `sentry.server.config.ts`, `app/api/auth/account/route.ts`, `components/auth/user-profile-button.tsx` | **4.0 Hours** |
| **Stage 3: Retention Polish & Global Expansion (P2)** | **Gate 3:** Execute during Days 7–30 after validating Vietnam finals conversion | 8. Display pass expiry countdown & remaining deck credits in Profile UI<br>9. Wire live USD checkout via [Polar.sh](https://polar.sh/docs/merchant-of-record/fees) or [Lemon Squeezy](https://www.lemonsqueezy.com/pricing) & unlock Tutor Tier | `components/auth/auth-dialog.tsx`, `components/pricing/pricing-modal.tsx`, `lib/pricing/tiers.ts#L481` | **2.5 Hours** |

## Stage 1: Critical Launch Blockers (P0 — Complete Before Any Public Traffic)

**Goal:** Eliminate silent production failures (broken multi-device arena rooms and fake USD payment errors) and satisfy payment gateway and data privacy rules (~3.0 hours total).

- [x] **1.1 Deploy Production PartyKit Edge Server & Host Verification Guards (`0.5 hr`)**
  - **Problem:** `NEXT_PUBLIC_PARTYKIT_HOST` is blank in `.env.local`, causing `hooks/use-arena-room.ts` to fall back to Server-Sent Events (`/api/arena/rooms/[code]/stream`) backed by an in-memory `Map` in `lib/multiplayer/room-manager.ts`. On serverless functions, separate devices hit separate lambda instances and cannot see each other in the same room.
  - **Required Fix:**
    - Verify `party/arena.ts` configuration and party scripts (`npm run party:deploy`).
    - Add startup/build-time validation in `next.config.ts` or environment check that warns in dev and enforces `NEXT_PUBLIC_PARTYKIT_HOST` in production.
    - In `hooks/use-arena-room.ts`, display a runtime developer warning banner when falling back to SSE due to missing PartyKit host.

- [x] **1.2 Lock Checkout Modal to Vietnam VietQR & Fix ROW Dead-End (`1.0 hr`)**
  - **Problem:** `lib/pricing/tiers.ts` displays USD pricing (`$4.99`, `$9.99`, `$29.00`), but `components/pricing/pricing-modal.tsx` only invokes [PayOS VietQR](https://payos.vn/docs/api/). When an international user clicks "Verify Payment", the UI shows a misleading `"Payment not yet confirmed by the server"` error before falling back to an early-access form.
  - **Required Fix:**
    - In `components/pricing/pricing-modal.tsx`, separate the Vietnam (VND) flow from the Rest-of-World (USD) flow cleanly.
    - When a user selects or views USD pricing prior to Stage 3, replace the "Verify Payment" button directly with a clean **"Early Access Live in Vietnam (VietQR) — Join the Global USD Card Waitlist"** CTA that submits directly to the early-access lead capture endpoint without throwing a fake payment verification error.

- [x] **1.3 Publish Terms of Service & Privacy Policy Routes (`1.5 hrs`)**
  - **Problem:** No `/terms` or `/privacy` routes exist in the App Router, violating [PayOS VietQR](https://payos.vn/) merchant requirements and [Vietnam Government Decree No. 13/2023/ND-CP on Personal Data Protection](https://english.luatvietnam.vn/decree-no-13-2023-nd-cp-dated-april-17-2023-of-the-government-on-personal-data-protection-249791-doc1.html).
  - **Required Fix:**
    - Create `app/terms/page.tsx` and `app/privacy/page.tsx` in bilingual English/Vietnamese (`lib/i18n/context.tsx`).
    - Explicitly state that all student-uploaded lecture slides are processed via [OpenRouter Zero Data Retention (`zdr: true`)](https://openrouter.ai/docs/guides/features/zdr), are never used to train public LLMs, and that `shared_deck_cache` stores only de-identified derived practice questions rather than redistributing raw copyrighted PDFs.
    - Disclose sub-processors ([OpenRouter](https://openrouter.ai/), [Supabase](https://supabase.com/), [PayOS](https://payos.vn/), [Upstash Redis](https://upstash.com/redis)) and link `/terms` and `/privacy` in `app/layout.tsx`, `components/pricing/pricing-modal.tsx`, and `components/auth/auth-dialog.tsx`.

### Copy-Paste Prompt for Antigravity (Stage 1)
> Execute Stage 1 (P0 Launch Blockers) across the codebase:
> 1. Create `app/terms/page.tsx` and `app/privacy/page.tsx` matching our dark-mode UI and bilingual EN/VI dictionary (`lib/i18n/context.tsx`). Document that uploads use OpenRouter Zero Data Retention (`zdr: true`), are never used for public LLM training, that `shared_deck_cache` caches only derived study items, and that VND payments are processed via PayOS VietQR in compliance with Vietnam Decree 13/2023/ND-CP. Add links to `/terms` and `/privacy` in `app/layout.tsx`, `components/pricing/pricing-modal.tsx`, and `components/auth/auth-dialog.tsx`.
> 2. In `components/pricing/pricing-modal.tsx`, fix the Rest-of-World (USD) checkout dead-end: when currency/region is USD (and live USD card rails are not yet enabled via env flag), do not trigger the PayOS QR verification flow or display `"Payment not yet confirmed by the server"`. Instead, render a clean "Early Access Live in Vietnam (VietQR) — Join Global USD Card Launch Waitlist" state with direct email capture.
> 3. In `hooks/use-arena-room.ts` and `next.config` / startup validation, add a check that logs a critical error if `NEXT_PUBLIC_PARTYKIT_HOST` is missing in production, and verify the `npm run party:deploy` configuration in `party/arena.ts`. Run relevant unit tests to confirm 0 regressions.

## Stage 2: Pre-Scale & Viral Safeguards (P1 — Complete Before Campus Tournaments or Ad Spend)

**Goal:** Protect your [OpenRouter](https://openrouter.ai/pricing) token budget from parallel cold-start abuse, maximize viral link click-through in Zalo and Discord groups, and establish production error visibility and GDPR/[Decree 13](https://www.dlapiperdataprotection.com/?t=law&c=VN) data deletion (~4.0 hours total).

- [x] **2.1 Enforce Production Upstash Redis Rate Limiting (`0.25 hr`)**
- **Problem:** In `lib/rate-limit.ts`, if `UPSTASH_REDIS_REST_URL` or `KV_REST_API_URL` is missing, rate limiting silently degrades to an in-memory sliding window that resets across serverless cold starts and parallel instances.
- **Required Fix:**
  - Provision a serverless database on [Upstash Redis](https://upstash.com/docs/redis/overall/getstarted) and populate `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in production environment variables.
  - Update `lib/rate-limit.ts` to throw a hard startup/configuration error when `NODE_ENV === 'production'` and Redis environment variables are absent.

- [x] **2.2 Add Social OpenGraph Cards, Sitemap & Robots.txt (`0.75 hr`)**
- **Problem:** `app/layout.tsx` lacks `openGraph.images` and Twitter Card tags, so viral Base64 pack links (`#pack=...`) and Arena room invites shared in Zalo, Messenger, or Discord render as plain text URLs. No `app/sitemap.ts` or `app/robots.ts` exists.
- **Required Fix:**
  - Configure `metadata.openGraph` and `metadata.twitter` in `app/layout.tsx` pointing to `/clutch-arena-full.png` with compelling bilingual preview titles (*"Clutch Arena — Convert 200 Lecture Slides into a 60s Exam Battle & 2-Page Formula Sheet"*).
  - Create `app/sitemap.ts` and `app/robots.ts` to index public landing and legal routes while disallowing `/api/` and private user routes.

- [x] **2.3 Integrate Sentry Exception & Webhook Telemetry (`1.0 hr`)**
- **Problem:** Production errors only output to `console.error` and `app/error.tsx`, leaving you blind to transient [OpenRouter](https://openrouter.ai/) 502 timeouts, PDF parsing failures, or [PayOS API](https://payos.vn/docs/api/) HMAC webhook errors.
- **Required Fix:**
  - Install [`@sentry/nextjs`](https://docs.sentry.io/platforms/javascript/guides/nextjs/) and configure `sentry.client.config.ts` and `sentry.server.config.ts`.
  - Add explicit `Sentry.captureException` hooks inside `app/api/payments/payos/create`, the PayOS webhook handler, `app/api/ingest/route.ts`, and `lib/ai/verify-questions.ts`.

- [x] **2.4 Implement Self-Serve Account & Data Cascade Deletion (`2.0 hrs`)**
- **Problem:** Users have no self-serve way to delete their account and uploaded study packs, requiring manual intervention on [Supabase](https://supabase.com/) to satisfy [Vietnam Decree 13](https://english.luatvietnam.vn/decree-no-13-2023-nd-cp-dated-april-17-2023-of-the-government-on-personal-data-protection-249791-doc1.html) and GDPR "Right to be Forgotten" requests.
- **Required Fix:**
  - Create `DELETE /api/auth/account/route.ts` authenticated via the user's active session.
  - Cascade-delete the user's records across `user_study_packs`, `user_runs`, `profiles`, and Supabase Auth (`supabase.auth.admin.deleteUser`).
  - Add a two-step confirmation "Delete Account & Study Data" action inside `components/auth/user-profile-button.tsx` and `components/auth/auth-dialog.tsx`.

### Copy-Paste Prompt for Antigravity (Stage 2)
> Execute Stage 2 (P1 Pre-Scale & Viral Safeguards) across the codebase:
> 1. In `lib/rate-limit.ts`, add a production guard so that if `NODE_ENV === 'production'` and both `UPSTASH_REDIS_REST_URL` and `KV_REST_API_URL` are missing, the module throws an explicit configuration error rather than silently degrading to an in-memory map.
> 2. In `app/layout.tsx`, add complete OpenGraph (`og:image` pointing to `/clutch-arena-full.png`, `og:title`, `og:description`) and Twitter `summary_large_image` metadata so links shared on Zalo and Discord render rich preview cards. Create `app/sitemap.ts` and `app/robots.ts`.
> 3. Implement `app/api/auth/account/route.ts` (`DELETE`) to authenticate the current user and cascade-delete their data from `user_study_packs`, `user_runs`, `profiles`, and Supabase Auth, and wire a confirmation UI in `components/auth/user-profile-button.tsx` and `components/auth/auth-dialog.tsx`.
> 4. Scaffold `@sentry/nextjs` error capture (`sentry.client.config.ts`, `sentry.server.config.ts`) and instrument the PayOS webhook, ingestion routes, and AI verification pipeline to report exceptions. Write and run unit tests for the new account deletion route and rate-limit guard.

## Stage 3: Retention Polish & Global Expansion (P2 — Days 7–30 Post-Launch)

**Goal:** Increase upgrades from the 7-Day Cram Pass (`69,000đ`) to the 4-Month Semester Pro Pass (`299,000đ`), open self-serve USD card checkout globally, and unlock the high-margin B2B2C Tutor & Guild tier (~2.5 hours total).

- [x] **3.1 Display Pass Expiry Countdown & Quota Meter in Profile UI (`0.5 hr`)**
- **Problem:** Paid users cannot see how many days/hours remain on their 7-Day Cram Pass or how many deck/note credits remain in their cycle inside `components/auth/auth-dialog.tsx`.
- **Required Fix:**
  - Render an active tier badge, remaining deck/note quota bar (`e.g., 3 of 5 Cram Pass decks remaining`), and an expiration countdown timer inside `components/auth/auth-dialog.tsx` and `components/auth/user-profile-button.tsx`, accompanied by a 1-click **"Upgrade to Semester Pro (299,000đ)"** button.

- [x] **3.2 Wire Global USD Merchant of Record & Unlock Tutor Tier (`2.0 hrs`)**
- **Problem:** International students (`$4.99` Cram Pass / `$29.00` Semester Pro) and B2B2C TAs/Tutors (`399,000đ/mo` or `$24.99/mo` Tutor & Guild tier in `lib/pricing/tiers.ts#L481`) are currently gated from self-serve checkout.
- **Required Fix:**
  - Integrate [Polar.sh](https://polar.sh/docs/merchant-of-record/introduction) or [Lemon Squeezy](https://docs.lemonsqueezy.com/help/payments/merchant-of-record) as your global Merchant of Record (handling international Visa, Mastercard, Apple Pay, and global VAT/sales tax compliance automatically).
  - Flip the **Tutor & Guild Tier** (`lib/pricing/tiers.ts#L481`) from `"Coming Soon"` to active in `components/pricing/pricing-modal.tsx` so IELTS, SAT, CFA, and university TAs can self-subscribe to 50-player Arena rooms and custom watermarked PDF exports.

### Copy-Paste Prompt for Antigravity (Stage 3)
> Execute Stage 3 (Retention Polish & Global Expansion) across the codebase:
> 1. In `components/auth/auth-dialog.tsx` and `components/auth/user-profile-button.tsx`, display the user's current tier (`Contender`, `7-Day Cram Pass`, `Clutch Pro`, `Tutor & Guild`), exact expiration date/countdown for active passes, remaining monthly/pass deck and note quotas, and a direct upgrade CTA to `Clutch Pro Semester`.
> 2. Create a checkout & webhook integration for our Rest-of-World (USD) Merchant of Record (Polar.sh / Lemon Squeezy) alongside PayOS VietQR, routing VND tiers to PayOS and USD tiers (`$4.99`, `$9.99`, `$29.00`, `$24.99`) to the USD checkout URL with signed webhook entitlement sync into Supabase.
> 3. In `lib/pricing/tiers.ts#L481` and `components/pricing/pricing-modal.tsx`, enable the `Tutor & Guild` tier (`399,000đ/mo` VN and `$24.99/mo` ROW) for self-serve checkout and verify its 50-player Arena room entitlement and custom watermarked PDF export permissions across the test suite.
