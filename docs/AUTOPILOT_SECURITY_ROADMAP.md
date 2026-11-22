# Clutch Arena — Autopilot Security Hardening Roadmap

> **Purpose:** Atomic, machine-readable remediation queue derived from [`brief.md`](../brief.md) (Backlog #1–#4) and [`antigravity-audit-2026-11-16.md`](../antigravity-audit-2026-11-16.md) for unattended Hermes + `agy` overnight runs.
> **Baseline Verified (2026-11-17):** `npm run typecheck` passes (`0` errors) and `npm test` passes (`65` files, `1554` tests, including `tests/unit/pptx-parser.test.ts`).
> **Hard Rules:** Follow [`AGENTS.md`](../AGENTS.md). One task per `agy/<task-id>` branch, never merge to `main`, never touch `.env*` / `supabase/migrations/*` / `package.json` dependencies, and never weaken assertions or add `any` / `@ts-ignore` / `.skip(`.

---

## Stage 1: High-Priority Endpoint & Realtime Auth

- [x] **Task 1.1:** Secure POST /api/repair in `app/api/repair/route.ts` and update unit tests in `tests/unit/repair-api.test.ts`.
  - Enforce `isAllowedOrigin`, `verifyAuthToken`, `checkRateLimit`, and the unified rolling `%` quota lifecycle (`checkAndReserveDeckQuota`, `recordDeckGenerationCogs`, `rollbackDeckQuotaReservation` on failure/abort) before calling `generateObject`.
  - Preserve existing deterministic-only fallback and schema validation behavior covered by `tests/unit/repair-api.test.ts`, and add test coverage for rejected origins, unauthenticated calls, rate limits, and quota rollback on LLM errors.
  - Verify: `npm run typecheck && npx vitest run tests/unit/repair-api.test.ts tests/unit/quota-api.test.ts`

- [x] **Task 1.2:** Fail-close PartyServer internal auth and WebSocket `INIT_ROOM` in `party/arena.ts` and `app/api/arena/rooms/route.ts`, updating `tests/unit/arena-room.test.ts` and `tests/unit/party-arena-parity.test.ts`.
  - Update `isInternalAuthorized()` in `party/arena.ts` to fail closed whenever `PARTYKIT_INTERNAL_SECRET` is missing (remove the `providedSecret === "1"` fallback) and compare tokens with constant-time `timingSafeEqual` (or WebCrypto subtle/constant-time helper compatible with Cloudflare Workers).
  - Require server-minted authorization for WebSocket `INIT_ROOM` in `party/arena.ts` and pass it from `app/api/arena/rooms/route.ts`, keeping `party/arena.ts` and `lib/multiplayer/room-manager.ts` parity intact.
  - Verify: `npm run typecheck && npx vitest run tests/unit/arena-room.test.ts tests/unit/party-arena-parity.test.ts tests/unit/arena-action-forward.test.ts`

---

## Stage 2: Supabase RLS Separation, CSRF Origin & Distributed Rate Limits

- [x] **Task 2.1:** Split user-scoped vs admin Supabase server helpers in `lib/supabase/server.ts` and update server callers (`lib/auth/server-guard.ts`, `lib/multiplayer/room-manager.ts`, `lib/payments/payos.ts`, `lib/payments/polar.ts`, `lib/telemetry/recorder.ts`).
  - Keep `getSupabaseServerClient(token)` strictly user-scoped when a user token is passed (using `NEXT_PUBLIC_SUPABASE_ANON_KEY` + forwarding `Authorization: Bearer <token>`) so RLS is never bypassed accidentally.
  - Export an explicit `getSupabaseAdminClient()` restricted to service-role operations (webhooks, quota ledger, account cascade deletion, telemetry persistence) and preserve `null` returns when Supabase env vars are missing.
  - Verify: `npm run typecheck && npx vitest run tests/unit/payos.test.ts tests/unit/usd-checkout-and-webhook.test.ts tests/unit/telemetry.test.ts tests/unit/account-deletion.test.ts`

- [x] **Task 2.2:** Harden `isAllowedOrigin` CSRF validation in `lib/utils.ts` and add unit tests in `tests/unit/origin-guard.test.ts`.
  - Stop blindly returning `true` when the `Origin` header is absent on state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`), and validate against a canonical configured origin allowlist (`NEXT_PUBLIC_SITE_URL` / `VERCEL_URL` / request URL origin / local dev hosts) instead of trusting raw spoofable `x-forwarded-host` / `x-forwarded-proto` headers.
  - Verify all existing route tests that call handlers without an `Origin` header (`tests/unit/notes-api.test.ts`, `tests/unit/quota-api.test.ts`, `tests/unit/telemetry.test.ts`) pass with explicit test expectations.
  - Verify: `npm run typecheck && npx vitest run tests/unit/origin-guard.test.ts tests/unit/notes-api.test.ts tests/unit/quota-api.test.ts tests/unit/telemetry.test.ts`

- [x] **Task 2.3:** Add distributed `@upstash/ratelimit` checks to `app/api/arena/rooms/route.ts`, `app/api/arena/rooms/[code]/join/route.ts`, `app/api/arena/rooms/[code]/action/route.ts`, and `lib/telemetry/recorder.ts`, updating `tests/unit/telemetry.test.ts` and `tests/unit/rate-limit.test.ts`.
  - Apply `checkRateLimit` to room creation, join, and action API handlers.
  - Back `checkTelemetryRateLimit` (or telemetry handler rate limiting in `lib/telemetry/handler.ts` / `lib/telemetry/recorder.ts`) with distributed `@upstash/ratelimit` while keeping the deterministic in-memory fallback when Upstash credentials are absent in local dev/tests.
  - Verify: `npm run typecheck && npx vitest run tests/unit/telemetry.test.ts tests/unit/rate-limit.test.ts tests/unit/rate-limit-prod.test.ts`

---

## Stage 3: Error Sanitization, CSP/CORS & Platform Config Hygiene

- [x] **Task 3.1:** Sanitize raw upstream `err.message` responses in `app/api/payments/payos/create/route.ts`, `app/api/payments/payos/verify/route.ts`, `app/api/payments/usd/create/route.ts`, `app/api/webhooks/payos/route.ts`, `app/api/webhooks/polar/route.ts`, `app/api/auth/account/route.ts`, and `party/arena.ts`.
  - Log full diagnostic error details server-side (or via Sentry) and return sanitized error codes/generic messages to HTTP/WebSocket clients without leaking PayOS, Polar, or Supabase internal error text.
  - Verify: `npm run typecheck && npx vitest run tests/unit/payos.test.ts tests/unit/usd-checkout-and-webhook.test.ts tests/unit/account-deletion.test.ts tests/unit/arena-room.test.ts`

- [x] **Task 3.2:** Sanitize raw `err.message` responses in `app/api/arena/rooms/route.ts`, `app/api/arena/rooms/[code]/action/route.ts`, `app/api/arena/rooms/[code]/join/route.ts`, and `app/api/notes/generate/route.ts` (line 722 fallback).
  - Return safe generic client messages and structured error codes while logging internal exception context server-side.
  - Verify: `npm run typecheck && npx vitest run tests/unit/notes-api.test.ts tests/unit/arena-action-forward.test.ts tests/unit/arena-room.test.ts`

- [x] **Task 3.3:** Tighten CSP in `next.config.ts` and pin `CORS_HEADERS` in `party/arena.ts`.
  - Replace wildcard `Access-Control-Allow-Origin: "*"` in `party/arena.ts` with an allowed-origin helper/env check covering production domain + localhost dev.
  - Tighten `next.config.ts` `connect-src` and `script-src` as strictly as Next.js 15, KaTeX, Sentry, Supabase, and PartySocket allow without breaking production builds (`npm run build`).
  - Verify: `npm run typecheck && npx vitest run tests/unit/party-arena-parity.test.ts && npm run build`

- [x] **Task 3.4:** Scope `vercel.json` function limits and include `party/worker.ts` in `tsconfig.json`.
  - Scope `vercel.json` `maxDuration: 300` and `memory: 1024` specifically to `app/api/ingest/**/*` and `app/api/notes/generate/**/*` instead of `app/api/**/*`, keeping standard routes at sensible defaults.
  - Remove `party/worker.ts` from `tsconfig.json` `exclude` (fixing any resulting TypeScript issues in `party/worker.ts`) so `npm run typecheck` covers the Cloudflare Worker entry point.
  - Verify: `npm run typecheck && npm test`

---

## Human-Approval Follow-Ups (Do Not Run Unattended in Autopilot)

- Add a sanitized `.env.example` covering all required env var names (no real values) referenced by `README.md`.
- Remove retired `partykit` dependency (`package.json`), `partykit.json`, `party:setup` script, and `scripts/deploy-partykit.ps1` once confirmed unused in Cloudflare Workers deploy.
- Review and merge approved `agy/*` branches into `main`, then run `npm run test:e2e`.
