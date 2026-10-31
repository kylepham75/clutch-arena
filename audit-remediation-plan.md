# Clutch Arena: Audit Remediation & Quality Hardening Roadmap

> **Target:** Remediate all 13 findings from `/ponytail-audit` across Security, COGS Quotas, Multiplayer Sync, Pipeline Deduplication, and Lean Codebase Cleanup.
> **Orchestrator:** `/pm-orchestrator` with dynamic effort-aware routing.

---

## Stage 1: Security & Database Hardening (Findings 1, 2, 4)
- [x] **Task 1.1:** Restrict Supabase RLS policies on `profiles`, `user_profiles` (tier elevation) and `shared_deck_cache` (public insert/update poisoning) in a new migration `supabase/migrations/20261031_security_hardening.sql`.
- [x] **Task 1.2:** Eliminate `body.userId` fallback hijack in `app/api/payments/payos/verify/route.ts` and `lib/payments/payos.ts`; verify caller owns the order before fulfillment.

---

## Stage 2: Quota, COGS & Memory Bounding (Findings 3, 5, 6, 13)
- [x] **Task 2.1:** Wire `checkAndReserveDeckQuota`, `recordDeckGenerationCogs`, `getSharedDeckCache`, and `setSharedDeckCache` into `lib/ingestion/handler.ts`, `lib/ingestion/multi-handler.ts`, and `app/api/notes/generate/route.ts`.
- [x] **Task 2.2:** Add bounded LRU/FIFO eviction caps to memory caches (`pdfVisionCache`, `sharedDeckMemoryStore`, `userQuotaMemoryStore`, `localMemoryStore`) in `lib/rate-limit.ts` and `lib/ingestion/parse-pdf.ts` to prevent OOM under load.
- [x] **Task 2.3:** Pass `auth.tier` to `getModel(auth.tier)` in `lib/coach/handler.ts` so paid users get their promised priority AI model.

---

## Stage 3: Game Pipeline & Multiplayer Sync (Findings 7, 8, 9, 10)
- [x] **Task 3.1:** Forward `/action` requests to PartyKit in `app/api/arena/rooms/[code]/action/route.ts` when `getPartyHost()` is configured.
- [x] **Task 3.2:** Align `party/arena.ts` with `room-manager.ts`: enforce tier player caps, add stale lobby room cleanup (>15m), and compute class analytics on podium.
- [x] **Task 3.3:** Prevent double-execution of `applyFinanceSolverToItem` in `lib/ai/generate-questions.ts` during blind verification pipeline.

---

## Stage 4: Codebase Lean Cleanup & Regression (Findings 11, 12)
- [x] **Task 4.1:** Unify and streamline tier resolution logic between `lib/auth/server-guard.ts` and `lib/pricing/tiers.ts`.
- [x] **Task 4.2:** Delete `app/globals.css.bak`, `app/layout.tsx.bak`, remove dead `groupSlidesByConceptWithLlm`, and prune unused package imports.
- [x] **Task 4.3:** Run full static audit, `npm run typecheck`, and comprehensive Vitest regression test suite across all modified modules.
