# Rolling `%` Credit Quota Migration Roadmap (Antigravity-Style)

> **PM & Swarm Execution Protocol:** Governed by `.agents/rules/pm-rules.md` (`/pm-orchestrator`) and coordinated via `/swarm` with disjoint file ownership and an independent `verifier` worker per stage.

## Confirmed Product Architecture

1. **Rolling Window Schedule:**
   - **Paid Tiers (`cram_pass`, `pro_monthly`, `pro`, `tutor`):** `24h` primary rolling window + `7d` (`168h`) weekly anti-drain guard + finite cycle `cogsCeilingUsd` backstop.
   - **Free Tier (`contender` & guest):** `3d` (`72h`) rolling window + `30d` (`720h`) anti-abuse guard (`$0.32`).
2. **Metered Features & Access:**
   - **Shared Rolling Pool:** Deck generation, Clutch Notes synthesis, Vision OCR, and AI Coach all draw from the same rolling `%` quota pool.
   - **Shared Cache (`shared_deck_cache`):** Cached decks and cached Clutch Notes cost **`0%` quota (`$0`)** and remain accessible even at `0%` remaining.
   - **Free Tier Unlocks:** Signed-in `contender` accounts can generate **1-section concise Clutch Notes** and **unlimited AI Coach follow-ups inside their 3d `%` quota** (legacy `2/run` Coach debrief cap removed; guests get `UNAUTHENTICATED` 401 on Notes). `canExportCheatSheet` remains Paid-only and `freeRegenerationsPerDeck` (`1 / 3 / 5`) remains active (`REGENERATION_LIMIT_EXCEEDED`).
3. **UI Representation:**
   - Strictly **`0–100%` remaining bar + `"Resets in Xh Ym"` countdown** (plus Eco-mode indicator when `<= 30%`). Zero raw USD amounts or integer deck/note counts shown.

---

## Stage 1: Core Rolling Quota Engine, Schema & Payment Resets

- [x] **1.1 Database Migration:** Add `window_started_at`, `window_spent_usd`, `window_reserved_usd`, `weekly_started_at`, `weekly_spent_usd`, `weekly_reserved_usd` columns on `public.user_quota_ledgers` (`supabase/migrations/20261112_rolling_credit_quota.sql`).
- [x] **1.2 Pricing & Rolling Config:** Replace integer credit/note/debrief count fields on `TierLimits` with `RollingQuotaConfig`, `getRegionalWindowBudget`, `getRegionalGuardBudget`, `formatQuotaPercentBadge`, `formatQuotaResetCountdown`, and updated `PRICING_PLANS` copy (`lib/pricing/tiers.ts`).
- [x] **1.3 Core Quota Ledger & Burst Shield:** Implement `computeRollingQuotaSnapshot`, `getRollingQuotaSnapshot`, `toClientQuota`, `checkAndReserveDeckQuota` / `checkAndReserveActionQuota`, `recordDeckGenerationCogs` / `recordActionCogs`, `rollbackDeckQuotaReservation`, and convert `checkRateLimit` into short anti-spam burst guards (`lib/rate-limit.ts`).
- [x] **1.4 Auth Guard & Quota Endpoint:** Permit authenticated `contender` in `verifyNotesAccess` (`lib/auth/notes-guard.ts`) and expose `GET /api/quota` (`app/api/quota/route.ts`).
- [x] **1.5 Telemetry, Slide OCR Surface & Payment Resets:** Add `onTelemetry` cost callback to `generateClutchNote` (`lib/ai/generate-notes.ts`), expose `pageVisionStatus` on `ParsedSlideDeck` (`lib/notes/parse-slides.ts`), and reset rolling window columns on PayOS/Polar order fulfillment (`lib/payments/payos.ts`, `lib/payments/polar.ts`).

---

## Stage 2: Backend API Routes & Stream Handler Wiring

### Execution & Effort Routing Plan
| # | Roadmap Target | Authorized Write Files | Tier | Model | Effort |
| :- | :--- | :--- | :-: | :--- | :-: |
| 2.1 | Wire Notes API to rolling `%` quota | `app/api/notes/generate/route.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 2.2 | Migrate Coach handler from 2/run & cycle ceiling to rolling `%` quota | `lib/coach/handler.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 2.3 | Wire single & multi ingestion handlers to rolling `%` quota + OCR gating | `lib/ingestion/handler.ts`, `lib/ingestion/multi-handler.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 2.V | Stage 2 QC/QA audit & backend typecheck verification | Read-only verification + `npm run typecheck` (scoped check) | T2 | `gemini-3.8-flash-high` | `high` |

### Tasks
- [x] **2.1 Clutch Notes API Integration (`app/api/notes/generate/route.ts`):**
  - Remove remaining `rateLimitMeta` (`dailyLimit`, `dailyRemaining`) references across multipart/cached/final responses.
  - Pre-check `getRollingQuotaSnapshot(userIdentifier, effectiveTier, billingRegion)` before un-cached `parseSlideDeck` and pass `{ maxAutoOcrBudgetUsd: 0 }` when `!preSnapshot.allowVisionOcr`.
  - Pass `actionKind: "notes"`, `region: billingRegion`, and tier-appropriate `estimatedCostUsd` (`0.015` Free, `0.02` Paid) to `checkAndReserveDeckQuota`; return `429` with `quota: toClientQuota(quotaResult.quota)` when denied.
  - Track actual cost via `generateClutchNote({ ..., onTelemetry })` plus `parsedDeck?.pageVisionStatus` sum and settle with `recordDeckGenerationCogs`, returning `quota: toClientQuota(...)` on both `200` (including `0%`-cost cache hits) and `429` responses, and `actionKind: "notes"` in `rollbackDeckQuotaReservation`.
- [x] **2.2 AI Coach Stream Handler Migration (`lib/coach/handler.ts`):**
  - Replace legacy `ledger.cogsSpentUsd + ledger.cogsReservedUsd >= ledger.cogsCeilingUsd` check and `maxCoachDebriefRepliesPerRun` / `COACH_DEBRIEF_LIMIT_REACHED` (`403`) checks with unified `quotaReservation` (`actionKind: "coach"`, `estimatedCostUsd: 0.004`, `region: getAuthoritativeBillingRegion(request)`).
  - Return HTTP `429` with `error.code = quotaResult.reason ?? "COGS_CEILING_EXCEEDED"`, `upgradeRequired: true`, and `quota: toClientQuota(quotaResult.quota)` when depleted.
  - Settle actual cost in `onFinish` (preferring `extractOpenRouterProvenance(event).costUsd` when `> 0`, else token formula) via `recordCogs(rateLimitKey, auth.tier, costUsd, reservedCostUsd, billingRegion)` and roll back via `rollbackQuota` on `onError` / upstream exceptions (preserving test bypass compatibility when quota deps are un-injected).
- [x] **2.3 Ingestion & Multi-Ingestion Quota Wiring (`lib/ingestion/handler.ts`, `lib/ingestion/multi-handler.ts`):**
  - Use `getAuthoritativeBillingRegion(request)` (`billingRegion`) and pass `actionKind: "deck"`, `region: billingRegion` into `quotaReservation(...)` and `recordCogs(...)`.
  - In `lib/ingestion/handler.ts`, when `!cachedParsedDoc && options.operation === "generate" && !isQuotaTestBypass`, check `getRollingQuotaSnapshot` and pass `parsePdfOptions: { maxAutoOcrBudgetUsd: 0 }` if `!preSnapshot.allowVisionOcr`.
  - Update legacy `"max 2 uploads per week"` / `"Daily upload limit reached"` copy on `checkRateLimit` `429` responses to burst-shield messaging, use `quotaResult.reservedCostUsd ?? reservedCostUsd`, and attach `quota: toClientQuota(...)` on `200` (including cached hits when `!isQuotaTestBypass`) and `429` responses.
- [x] **2.V Stage 2 QC/QA Verification:** `0` TypeScript errors in `app/api/**` and `lib/**`; `47/47` ingestion & shared-cache tests passed; zero raw USD or count leaks in backend responses (`21/24` in `coach-handler.test.ts`, with the 3 legacy `getUserLedger`/`COACH_DEBRIEF_LIMIT_REACHED` cases scoped to Stage 4).

---

## Stage 3: Client Quota Hook, UI Meters & Bilingual Copy

### Shared Client Interface Contract
- **`QuotaState` / `ClientQuotaSummary` (`hooks/use-user-tier.ts`):**
  `{ remainingPct: number; usedPct: number; resetsAt: string | null; windowHours: number; bottleneckScope: "window" | "weekly" | "cycle"; mode: "normal" | "caution" | "haiku_overflow" | "cached_only" }`
- **`ProfileQuotaSummary` (`hooks/use-user-tier.ts`):**
  `{ remainingPct: number; usedPct: number; quotaLabel: string; resetCountdown: string | null; statusTone: "healthy" | "caution" | "critical"; isDegraded: boolean; tierLabel: string; showUpgradeToSemesterPro: boolean }`
- **Window Event Sync:** `broadcastQuotaUpdate(quota: ClientQuotaSummary)` dispatches `"clutch:quota-updated"`, subscribed inside `useUserTier()`, exposing `quotaState`, `refreshQuota()`, and `updateQuotaFromResponse(quota)`.

### Execution & Effort Routing Plan
| # | Roadmap Target | Authorized Write Files | Tier | Model | Effort |
| :- | :--- | :--- | :-: | :--- | :-: |
| 3.1 | Refactor quota hook & summary helper | `hooks/use-user-tier.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 3.2 | Auth profile badge & single AI Quota meter | `components/auth/user-profile-button.tsx`, `components/auth/auth-dialog.tsx` | T2 | `gemini-3.8-flash-high` | `high` |
| 3.3 | Unlock Notes panel & PDF gate | `components/notes/clutch-notes-panel.tsx`, `components/notes/note-renderer.tsx` | T2 | `gemini-3.8-flash-high` | `high` |
| 3.4 | Remove Coach 2/run lockout & sync Upload/Coach quotas | `components/workspace/coach-panel.tsx`, `components/workspace/upload-panel.tsx` | T2 | `gemini-3.8-flash-high` | `high` |
| 3.5 | Bilingual EN/VI quota copy cleanup | `lib/i18n/translations.ts` | T1 | `gemini-3.8-flash-low` | `low` |
| 3.V | Stage 3 QC/QA audit & app typecheck verification | Read-only verification + `npm run typecheck` | T2 | `gemini-3.8-flash-high` | `high` |

### Tasks
- [x] **3.1 Quota Hook & Summary Refactor (`hooks/use-user-tier.ts`):** Replace `deckCreditsRemaining`/`deckCreditsTotal`/`notesPerDay` summary fields with `QuotaState` fetching `/api/quota`, subscribing to `"clutch:quota-updated"`, exposing `refreshQuota()` + `updateQuotaFromResponse()`, and exporting `broadcastQuotaUpdate()` + `computeProfileQuotaSummary()`.
- [x] **3.2 Auth UI Meter (`components/auth/user-profile-button.tsx`, `components/auth/auth-dialog.tsx`):** Replace `{deckCreditsRemaining}/{deckCreditsTotal} decks` badge with compact `%` indicator (`>30%` green, `11–30%` amber, `<=10%` red) and replace dual Deck + Notes count bars in `AuthDialog` with a single Antigravity-style **AI Quota** bar (`X% remaining`, `"Resets in Xh Ym"`, Eco-mode badge, Upgrade CTA).
- [x] **3.3 Clutch Notes Panel & PDF Gate (`components/notes/clutch-notes-panel.tsx`, `components/notes/note-renderer.tsx`):** Allow signed-in Free users (`contender`) to open the dropzone and synthesize notes (prompting sign-in only if `!user`), replace `dailyUsage/dailyNoteLimit` counter with live `%` pill + countdown, call `updateQuotaFromResponse(data.quota)`, and gate Export PDF button in `note-renderer.tsx` on `limits.canExportCheatSheet`.
- [x] **3.4 Coach & Upload Panel Quota Sync (`components/workspace/coach-panel.tsx`, `components/workspace/upload-panel.tsx`):** Remove `limits.maxCoachDebriefRepliesPerRun` / `localStorage` debrief counter from `CoachPanel`, call `refreshQuota()` / `updateQuotaFromResponse()` on run/response completion, and render reset countdown + Upgrade CTA on `429` quota exhaustion.
- [x] **3.5 Bilingual Copy Cleanup (`lib/i18n/translations.ts`):** Update EN & VI keys for rolling `%` quota, countdown labels, Notes Free-tier teaser, and Coach unlimited-inside-quota messaging (zero stale deck/note counts or `2/run` strings).
- [x] **3.V Stage 3 QC/QA Verification:** `0` TypeScript errors across `app/**`, `components/**`, `hooks/**`, and `lib/**`; `36/36` tests passed in `tests/unit/i18n.test.ts` (11/11) and `tests/unit/note-renderer.test.ts` (25/25); static audit confirmed zero `TODO`/`FIXME`/placeholders, zero legacy quota symbols, and zero raw USD or `2/run` leaks (remaining TS errors are isolated to the 5 pre-Stage-4 test files).

---

## Stage 4: Unit Test Migration, New Coverage & Full QC/QA

### Execution & Effort Routing Plan
| # | Roadmap Target | Authorized Write Files | Tier | Model | Effort |
| :- | :--- | :--- | :-: | :--- | :-: |
| 4.1 | Update core pricing, UI quota summary, routing & rate-limit specs + add `/api/quota` spec | `tests/unit/pricing-and-tiers.test.ts`, `tests/unit/profile-quota-ui.test.ts`, `tests/unit/tier-model-routing.test.ts`, `tests/unit/rate-limit.test.ts`, `tests/unit/quota-api.test.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 4.2 | Update Notes, Coach, Ingestion & PayOS specs for rolling `%` quota | `tests/unit/notes-pro-guard.test.ts`, `tests/unit/notes-rate-limit.test.ts`, `tests/unit/notes-api.test.ts`, `tests/unit/coach-handler.test.ts`, `tests/unit/ingestion-handler.test.ts`, `tests/unit/multi-ingestion.test.ts`, `tests/unit/payos.test.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 4.V | Final full-repo QC/QA (`npm run typecheck` + Vitest suite + grep audit for zero USD/count leaks) | Read-only verification + test commands | T2 | `gemini-3.8-flash-high` | `high` |

### Tasks
- [x] **4.1 Core Quota & API Endpoint Tests:** Update `pricing-and-tiers.test.ts`, `profile-quota-ui.test.ts`, `tier-model-routing.test.ts`, and `rate-limit.test.ts`; create `tests/unit/quota-api.test.ts` covering `24h`/`7d` paid vs `72h` free rollover, `0%` shared cache hits, Eco-mode `<=30%` step-down, rollback, `freeRegenerationsPerDeck`, and zero raw USD exposure.
- [x] **4.2 Route & Handler Integration Tests:** Update `notes-pro-guard.test.ts` (authenticated Free allowed, guest 401, privilege escalation still blocked), `notes-rate-limit.test.ts`, `notes-api.test.ts`, `coach-handler.test.ts`, `ingestion-handler.test.ts`, `multi-ingestion.test.ts`, and `payos.test.ts`.
- [x] **4.3 Final Typecheck & Full Test Pass:** `npm run typecheck` exits `0` and all affected/rolling-quota Vitest suites pass with zero regressions (`12/12` Stage 4 files, `317/317` tests passed; full `npm test` `59/60` files, `1381/1382` passed, with `1` pre-existing failure in untouched `tests/unit/pptx-parser.test.ts:1284` from `HEAD`).

---

## Stage 5: Hardening — Routing Parity, Cache Isolation, Ledger Invalidations & Client Cleanup

### Execution & Effort Routing Plan
| # | Roadmap Target | Authorized Write Files | Tier | Model | Effort |
| :- | :--- | :--- | :-: | :--- | :-: |
| 5.1 | Unify `isPaidTier` helper (`pro_monthly` Sonnet routing & 90K cliff fix) + drop deprecated `maxCoachDebriefRepliesPerRun` | `lib/pricing/tiers.ts`, `lib/ai/provider.ts`, `lib/ai/prompts.ts`, `lib/ai/generate-questions.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 5.2 | Isolate Clutch Notes `shared_deck_cache` by note format tier & strip raw `cogsCeilingUsd` from PayOS verify response | `app/api/notes/generate/route.ts`, `app/api/payments/payos/verify/route.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 5.3 | Add Redis/memory ledger cache invalidation on payment fulfillment, uplift `maxRegenerations` on upgrade, pass `billingRegion` on single rollback & remove deprecated Coach debrief exports | `lib/rate-limit.ts`, `lib/payments/payos.ts`, `lib/payments/polar.ts`, `lib/coach/handler.ts`, `lib/ingestion/handler.ts` | T3 | `claude-sonnet-5.5-high` | `high` |
| 5.4 | Add Vision OCR budget/preview gating & `billingRegion` rollback to multi-document ingestion | `lib/ingestion/parse-multi-documents.ts`, `lib/ingestion/multi-handler.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 5.5 | Remove client `GUEST_LIMIT = 2` integer counters/badges & hard-coded `299,000đ` upgrade CTA | `lib/auth/context.tsx`, `components/auth/user-profile-button.tsx`, `components/auth/auth-dialog.tsx`, `components/workspace/upload-panel.tsx` | T2 | `gemini-3.8-flash-high` | `high` |
| 5.6 | Update & expand Vitest coverage for Stage 5 hardening invariants | `tests/unit/tier-model-routing.test.ts`, `tests/unit/notes-api.test.ts`, `tests/unit/payos.test.ts`, `tests/unit/rate-limit.test.ts`, `tests/unit/multi-ingestion.test.ts`, `tests/unit/ingestion-handler.test.ts` | T2 | `gemini-3.8-flash-high` | `high` |
| 5.V | Stage 5 QC/QA audit (`npm run typecheck`, static grep audit & affected Vitest suites) | Read-only verification + test commands | T2 | `gemini-3.8-flash-high` | `high` |

### Tasks
- [x] **5.1 Paid-Tier Routing & Cliff Unification (`pro_monthly`):** Export `isPaidTier(tier)` from `lib/pricing/tiers.ts` (covering `cram_pass`, `pro_monthly`, `pro`, `tutor`), wire it through `lib/ai/provider.ts`, `lib/ai/prompts.ts`, and `lib/ai/generate-questions.ts` so `pro_monthly` gets Priority Sonnet routing, distractor rationales, and >90K token handling; remove deprecated `maxCoachDebriefRepliesPerRun` from `TierLimits`.
- [x] **5.2 Notes Cache Isolation & PayOS Verify Sanitization:** Separate Free 1-section vs. Paid multi-section Clutch Notes in `shared_deck_cache` via `pipelineVersion` (`notes-free-v1` vs `notes-v1`) inside `app/api/notes/generate/route.ts`, and remove raw `cogsCeilingUsd` exposure from `app/api/payments/payos/verify/route.ts`.
- [x] **5.3 Ledger Cache Invalidation, Upgrade Uplift & Coach Cleanup:** Export `invalidateUserQuotaLedgerCache(userId)` in `lib/rate-limit.ts` and invoke it after Supabase ledger upserts in `lib/payments/payos.ts` and `lib/payments/polar.ts`; compare `Math.max(existingUnlock.maxRegenerations, tierLimits.freeRegenerationsPerDeck)` on regeneration checks; pass `reservedBillingRegion` into single-ingestion `rollbackQuota`; remove deprecated `checkAndReserveCoachDebriefReply` / `rollbackCoachDebriefReply` and unused `lib/coach/handler.ts` import/dep.
- [x] **5.4 Multi-Ingestion OCR Gating & Region Rollback:** Forward optional `parsePdfOptions` through `parseMultiDocuments` (`lib/ingestion/parse-multi-documents.ts`), mirror single-file `allowVisionOcr` + `preview` `maxAutoOcrBudgetUsd: 0` gating in `lib/ingestion/multi-handler.ts`, and pass `reservedBillingRegion` into `rollbackQuota`.
- [x] **5.5 Client Guest Counter & Upgrade Copy Cleanup:** Replace client-side `GUEST_LIMIT = 2` (`X/2`) badges and local pack cap in `lib/auth/context.tsx`, `components/auth/user-profile-button.tsx`, `components/auth/auth-dialog.tsx`, and `components/workspace/upload-panel.tsx` with rolling `%` quota status and dynamic regional plan pricing in the Upgrade CTA.
- [x] **5.6 Stage 5 Hardening Tests:** Extend `tier-model-routing.test.ts`, `notes-api.test.ts`, `payos.test.ts`, `rate-limit.test.ts`, `multi-ingestion.test.ts`, and `ingestion-handler.test.ts` to assert all Stage 5 fixes (`203/203` tests passing across those 6 suites).
- [x] **5.V Final Stage 5 QC/QA Gate:** `npm run typecheck` exits `0`, zero stale `GUEST_LIMIT`/raw `cogsCeilingUsd` leaks remain, and all 14 Stage 4/5 Vitest suites passed (`14/14` files, `359/359` tests passed).
