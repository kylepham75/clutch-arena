# Clutch Arena: Question Generation & Summarization System Upgrade Plan

> **Status:** Design Locked (Post `/grill-me` Alignment) — Awaiting User "Proceed" Command  
> **Version:** 3.0.0-final  
> **Target Scope:** Unified OpenRouter Provider, Multi-Signal PDF Vision Triage, Quantitative Finance Solver, Blind MCQ Verification, 5-Step Note Numeric Gate, Content-Hash Caching, and COGS-Aware Quota Engine

---

## 1. Executive Summary & Core Architecture

This upgrade hardens Clutch Arena's document-to-MCQ (`lib/ai/generate-questions.ts`) and note summarization (`lib/ai/generate-notes.ts`) pipelines to achieve **<2% answer-key error rate**, **100% mathematical accuracy on core finance formulas**, and **predictable unit economics (>= 65–70% gross margin)**.

```text
[0] INGEST & DEDUPE     pptx (text, tables, speaker notes, OMML) | pdf (text layer + page geometry)
                        Drop slide N if >85% prefix of slide N+1 ($0 animation dedupe)
                                        │
[1] MULTI-SIGNAL        Flag page if <100 native chars OR image regions (>8% area each, >25% total)
    VISION TRIAGE       Crop equation regions (~1/10th tokens); cap at ~$0.03/deck (~25 Flash pages)
                        Cache OCR by page-image hash; expose per-page "Re-scan with Vision" UI
                                        │
[2] CONTENT HASH &      Compute content_hash (normalized text + page count + perceptual image hash)
    COGS PRE-FLIGHT     Cache hit = 0 credits ($0 COGS). Pre-flight reserve against 35% COGS ceiling
                                        │
        ┌───────────────────────────────┴───────────────────────────────┐
        ▼ (MCQ Pipeline)                                                ▼ (Notes Pipeline)
[3A] CONCEPT GROUP & GENERATE                                   [3B] LEDGER & NOTE SYNTHESIS
     Group contiguous slides by concept (temp 0.0)                   FormulaLedger + conventions pinned
     Over-generate +20% items (temp 0.2, top_p 0.95)                 Synthesize note sections (temp 0.1)
     Finance items emit Spec -> TS Solver computes key               5-Step Numeric Gate:
                                        │                              1. PATCH from verbatim quote ($0)
[4A] TWO-TIER MCQ VERIFICATION                                         2. RE-CITE if on another slide ($0)
     Tier 1: Deterministic quote match ($0)                            3. KEEP AS DERIVED (diff/ratio/%Δ) ($0)
     Tier 2: Cross-family Blind Solve (temp 0.0, keyless)              4. REPAIR residual (1 LLM attempt)
     Drop failed/ambiguous items; shuffle options in code              5. DROP + Section Gate (<8% / 8-20% / >20%)
```

---

## 2. OpenRouter Unified Provider & Cross-Family Pairing (`lib/ai/provider.ts`)

All LLM calls route through **OpenRouter** (`@openrouter/ai-sdk-provider`) using a single `OPENROUTER_API_KEY`. Per-provider SDKs (`@ai-sdk/google`, `@ai-sdk/openai`) are deprecated in this pipeline.

### Pairing & Slug Pinning Rules
1. **Pinned Slugs Only:** Never use `openrouter/auto`, never use `:free` variants, and never use the `:online` suffix (which injects external web results into grounded tasks).
2. **Strict Cross-Family Separation:**
   - **Generator Family:** Gemini family (pinned slug, e.g., `google/gemini-3.6-flash` / `google/gemini-4-argon`).
   - **Verifier Family:** OpenAI or Anthropic Claude family (pinned slug, e.g., `openai/gpt-6.1-terra` or `anthropic/claude-sonnet-5.5`).
   - **Verifier Fallback Guard:** Any fallback chain for the Verifier **must be restricted to non-Generator model families**. Falling back into the Generator's family is strictly prohibited so verification never silently loses independence.

### Non-Negotiable Per-Request Configuration
Every OpenRouter request must include:
```json
{
  "provider": {
    "require_parameters": true,
    "data_collection": "deny",
    "zdr": true
  }
}
```
- **Model Provenance & Cache Invalidation:** Log the actual `model` string **returned** by OpenRouter in response metadata (not merely the requested slug). Fold the served model slug into `pipeline_version` so cached question pools invalidate automatically if the underlying served model changes.
- **Real-Time COGS Attribution:** Capture `usage.cost` directly from OpenRouter's response and record it against the user's subscription period ledger.

---

## 3. Hyperparameter & Temperature Configuration

| Stage | Temperature | Sampling Config | Reason |
| :--- | :---: | :--- | :--- |
| **Concept Grouping & Formula Extraction** | `0.0` | `temperature: 0.0` | Deterministic slide boundary and formula parameter extraction. |
| **Slide Summary Notes (`generate-notes.ts`)** | `0.1` | `temperature: 0.1`, `top_p: 0.9` | Strictly grounded to slide text; suppresses external extrapolation. |
| **MCQ Item Generation (`generate-questions.ts`)** | `0.2` | `temperature: 0.2`, `top_p: 0.95` | Keeps verbatim quotes exact while enabling lexical variety and misconception distractors. |
| **Deterministic Quote & Math Solvers** | N/A (Code) | TypeScript / Regex | Zero-cost verification and exact financial calculation. |
| **Cross-Family Blind Verifier** | `0.0` | `temperature: 0.0` | Pure greedy decoding (argmax) for independent keyless solving. |

---

## 4. Multi-Signal PDF Vision Triage & Per-Page OCR (`lib/ingestion/parse-pdf.ts`)

1. **Multi-Signal Per-Page Detection:**
   - Flag a PDF page if it has **$<100$ native characters** OR if it contains **substantial image regions ($>8\%$ page area each, or $>25\%$ combined area)** on an otherwise text-rich page (catching pasted formula/table screenshots on finance slides).
2. **Equation Crop Fast-Path:**
   - For isolated formula/equation image regions on text-rich pages, crop only the formula bounding box and send that crop to Gemini Flash Vision ($\sim 1/10\text{th}$ the tokens and higher LaTeX fidelity than full-page OCR).
3. **Cost-Bounded Auto-OCR & Explicit UI Surfacing:**
   - Cap auto-OCR by cost budget (**$\sim \$0.03/\text{deck}$**, equivalent to $\sim 25$ full Flash pages).
   - If a deck exceeds the cap, surface an explicit banner: *"48 of 60 pages needed OCR; processed first 25 — click to re-scan remaining"* (never degrade silently).
   - Cache vision output by **page-image SHA-256 hash** so re-scans and repeat uploads cost $\$0.00$.
4. **Per-Page Manual "Re-scan with Vision" UI:**
   - Render a per-page **"Re-scan with Vision"** button right next to that page's extracted-text preview so students can inspect and re-process individual slides.
5. **Hard Gate on Failed Vision Pages:**
   - Any flagged page that fails vision re-processing marks items derived from it as `low_confidence`, and those items are **dropped at the verification gate** (never shipped with a warning).

---

## 5. Question Generating System Upgrades (`lib/ai/generate-questions.ts`)

1. **Concept-First Slide Grouping (Replaces `partitionSourcesAcrossBatches`):**
   - Group contiguous slides into 8–15 coherent conceptual units before batching so multi-slide worked examples (e.g., 3-slide DCF walkthroughs) are never sliced in half.
2. **Psychometric Prompt & Schema Hardening (`lib/ai/prompts.ts`):**
   - Ban negation stems (`EXCEPT`, `NOT`, `all of the above`, `none of the above`).
   - Cap generation at $\le 2$ items per slide (anti-coverage pressure; returning fewer items is explicitly permitted).
   - Require `source_slide`, verbatim `quote`, and `distractor_rationale` (testing specific student misconceptions).
3. **Quantitative Finance Solver Engine (`lib/math/finance-solver.ts`):**
   - **Rule: The LLM never computes a number that becomes an answer key.**
   - For quantitative items (both Base questions and `conceptVariant` remixes), the LLM emits a structured calculation spec:
     - Supported core solvers: `tvm` (PV/FV/Rate/Nper), `annuity` (ordinary vs. due), `perpetuity` / `ddm` (Gordon Growth), `bond_price` & `ytm`, `npv` / `irr`, `wacc`, `capm`.
     - Includes `params` and `distractor_modes` (e.g., `"annual_instead_of_semiannual"`, `"beginning_instead_of_end_of_period"`, `"forgot_to_discount_face"`).
   - Unit-tested TypeScript functions compute the exact answer and the 3 misconception distractors, verifying that all 4 options differ by more than rounding tolerance.
4. **Over-Generate +20% & Cross-Family Blind Verification (`lib/ai/verify-questions.ts`):**
   - Request $+20\%$ extra items in the initial generation batch.
   - Strip `correctIndex`, `explanation`, and `quote`, then send `{ question, options }` to the cross-family **Blind Verifier** (`temperature: 0.0`).
   - **Silently drop** any item where the blind solver disagrees with the key or flags multi-answer ambiguity (zero retry latency).
5. **Code-Level Option Shuffling:**
   - Deterministically shuffle the 4 options in code after verification and recompute `correctIndex` to eliminate LLM position/length bias (favoring B/C).

---

## 6. Note Summarizing System Upgrades (`lib/ai/generate-notes.ts`, `lib/notes/verification-gate.ts`)

Building on the existing `FormulaLedger` and `verification-gate.ts`:

1. **Unit-Aware Numeric Normalization:**
   - Explicitly normalize units, not just punctuation: `5.8%` $\to$ `0.058`, whereas `5.8 bps` $\to$ `0.00058` (preventing `%` vs. `bps` or `$M` vs. `$B` false passes).
2. **5-Step Per-Bullet Numeric Resolution Cascade (`lib/notes/deterministic-verifiers.ts`):**
   - **Step 1 — PATCH (Deterministic, $0):** If the bullet's verbatim quote contains the true number AND mapping is unambiguous (matching number-count in bullet vs. quote + high positional non-numeric token similarity), patch the number in place. *Guard: Never patch if a bullet has $2+$ mismatched numbers.*
   - **Step 2 — RE-CITE (Deterministic, $0):** If the number is absent from the cited `[Slide X]` but exists on another slide with matching context, fix the slide citation and keep the bullet.
   - **Step 3 — KEEP AS DERIVED (Deterministic, $0):** If the number equals a difference ($a - b$), ratio ($a / b$), or percent change ($(b - a)/a$) of two numbers on the cited slide (within rounding tolerance), keep the bullet and tag it as `derived`.
   - **Step 4 — REPAIR (LLM, 1 Attempt):** Route *only* the residual bullets that failed Steps 1–3 into `TargetedRepairPrompt`.
   - **Step 5 — DROP:** Strip any bullet that still fails after the single repair pass.
3. **Section-Level Quality Gate (`lib/notes/verification-gate.ts`):**
   - `drop_rate < 8%` $\to$ Ship section immediately.
   - `8% <= drop_rate <= 20%` $\to$ Ship section + trigger 1 background regeneration of that section at higher effort.
   - `drop_rate > 20%` $\to$ Discard section and retry once with stricter grounding; if it fails twice, omit the section and display an explicit notice telling the student which section was omitted (never ship a silently holey note).
4. **Financial Convention Pinning (`lib/ai/prompts-notes.ts`):**
   - Extract and pin slide conventions (`30/360 vs. Actual/365`, `annual vs. semiannual compounding`, `beginning vs. end of period`) into section headers so worked examples retain their boundary assumptions.

---

## 7. Caching, Credits & COGS-Aware Quota Engine (`lib/pricing/tiers.ts`, `lib/rate-limit.ts`)

1. **Unit = Distinct Document (`content_hash`), Not Generation Event:**
   - Compute `content_hash` = hash of `(normalized extracted text + page count + perceptual image hashes)`, with `file_sha256` as a fast-path check so re-saved/re-exported PDFs still hit the cache.
   - **1 Deck Credit unlocks the entire document:** MCQ study pack, Clutch Notes summary, flashcards, and up to $N$ regenerations. Unified UI counter displays *"4 of 12 decks used"*.
2. **Cache Hits Are Free (0 Credits):**
   - Cross-user Supabase table (`shared_deck_cache`) + in-memory fallback stores a verified pool of **35 MCQs** (serving randomized 25-item subsets) and the verified Clutch Note, keyed by `(content_hash, language, mode, focus_hash, pipeline_version)`.
   - Uploading a deck that hits `shared_deck_cache` consumes **0 deck credits** and incurs **$0.00 COGS**.
3. **Subscription Caps & Anti-Scraping Burst Limits:**
   - **7-Day Cram Pass ($3.99):** `12` new-deck credits | `4` decks/day burst limit | `3` free regenerations/deck.
   - **Semester Pro Pass ($29.00):** `60` new-deck credits | `6` decks/day burst limit | `5` free regenerations/deck.
   - All counters are persisted durably in **Supabase / Upstash Redis** (never reset on serverless cold starts).
4. **Pre-Flight COGS Ceiling & Progressive Degradation:**
   - Cumulative COGS ceiling = **35% of plan net revenue** (`$1.25` on 7-day pass; `$9.75` on Semester pass).
   - Estimate cost before each uncached call and reserve against the user's COGS budget:
     - **`< 70%` of ceiling:** Full pipeline (normal vision + cross-family verification + 25–35 items).
     - **`70% – 90%` of ceiling:** Gentle degradation (skip borderline vision pages, cheaper generator slug, 20 items, concise explanations).
     - **`90% – 100%` of ceiling:** Hard degradation (native text-only, deterministic verification only, 15 items).
     - **`> 100%` of ceiling:** Halt fresh LLM generation, continue serving all cached pools (`$0` COGS), and display a transparent notice that cached class decks remain available.

---

## 8. Implementation Roadmap & Atomic Tasks

### Stage 1: OpenRouter Provider & Durable Cache/Quota Foundation
- [x] **Task 1.1:** Install `@openrouter/ai-sdk-provider` and refactor `lib/ai/provider.ts` for pinned cross-family slugs, mandatory privacy headers (`require_parameters: true`, `data_collection: "deny"`, `zdr: true`), served-model logging, and `usage.cost` extraction.
- [x] **Task 1.2:** Create Supabase migration `supabase/migrations/20261031_shared_cache_and_cogs_quotas.sql` + durable quota/COGS state manager in `lib/pricing/tiers.ts` and `lib/rate-limit.ts` (`content_hash` cache, 12/60 deck credits, 4/6 daily burst, 35% COGS degradation ladder).

### Stage 2: Ingestion, Animation Dedupe & Multi-Signal PDF Vision
- [x] **Task 2.1:** Add $>85\%$ prefix animation slide deduplication and `content_hash` computation in `lib/notes/parse-slides.ts` and `lib/ingestion/`.
- [x] **Task 2.2:** Upgrade `lib/ingestion/parse-pdf.ts` with multi-signal detection ($<100$ chars or $>8\% / >25\%$ image area), formula region cropping, $\$0.03/\text{deck}$ cost cap with UI banner, page-image hash cache, and per-page "Re-scan with Vision" support.

### Stage 3: Question Generating System Upgrade
- [x] **Task 3.1:** Build `lib/math/finance-solver.ts` with unit-tested solvers (`tvm`, `annuity`, `ddm`, `bond_price`, `npv`, `wacc`, `capm`) and named-mistake distractor generators.
- [x] **Task 3.2:** Upgrade `lib/ai/prompts.ts` and `lib/ai/generate-questions.ts` with concept-first grouping (`temp: 0.0`), $+20\%$ over-generation (`temp: 0.2, top_p: 0.95`), negation bans, $\le 2$ items/slide cap, finance spec integration, and code-level option shuffling.
- [x] **Task 3.3:** Build `lib/ai/verify-questions.ts` for cross-family keyless blind solving (`temp: 0.0`) and silent dropping of failed/ambiguous items.

### Stage 4: Note Summarizing System Upgrade
- [x] **Task 4.1:** Implement unit-aware numeric normalization (`%` vs. `bps` vs. currency) and the 5-Step Per-Bullet Numeric Resolution Cascade (`PATCH` $\to$ `RE-CITE` $\to$ `KEEP AS DERIVED` $\to$ `REPAIR` $\to$ `DROP`) in `lib/notes/deterministic-verifiers.ts`.
- [x] **Task 4.2:** Add the Section-Level Quality Gate (`<8%` ship, `8–20%` regen once, `>20%` retry/omit with notice) and Financial Convention Pinning in `lib/notes/verification-gate.ts` and `lib/ai/prompts-notes.ts`.

### Stage 5: Regression & Golden Evaluation Suite
- [x] **Task 5.1:** Update `tests/deterministic-verifiers.test.ts`, `tests/verification-gate.test.ts`, `tests/pricing-and-tiers.test.ts`, and `tests/golden-eval.test.ts` to cover all new gates, solvers, OpenRouter headers, and COGS degradation tiers.

---

## 9. Next Steps

> **All design decisions are resolved and locked.**  
> Reply with **"Proceed with the upgrade"** (or specify a Stage) to begin implementation.
