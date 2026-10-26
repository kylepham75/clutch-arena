# Clutch Notes — Hallucination Shield v3 Roadmap

**Governing principle:** Code never authors academic content. The uploaded slides are the single source of truth. The shield **verifies, cites, flags, or rejects** — it never "corrects" toward a textbook.

## Locked Product Decisions (2026-10-26)
1. **Gate failure → MARK, don't block.** Show the note with unsupported/uncertain items flagged "Needs review" (unsupported claims removed). Hard-fail only on formulas that CONTRADICT the source.
2. **Exercises are NOT kept.** Notes must be as light as possible: drop worked examples, numbers, and walkthroughs. *Exception:* any formula that appears **only** inside an exercise is still a taught formula and must be captured as a boxed formula (formula coverage is non-negotiable).
3. **Cost:** 2–3× LLM calls per note (extraction + synthesis + verifier) is approved for paid tiers.
4. **Textbook-divergence notices are shown to students** (e.g. "Your lecturer's formula differs from the standard textbook form"), never auto-rewritten.

---

## Stage 1 — Stop the Bleeding (remove code-authored content, silent loss, regex corruption)
- [x] **1.1** Remove `SAMPLE_CLUTCH_NOTE` fallback in `generateClutchNote`; throw `IngestionError("AI_NOT_CONFIGURED", …, 503)`.
- [x] **1.2** Remove all content-injection blocks (Ch.9 P_N / deferred preferred / Dividend-Yield bullets; Ch.10/11/26 safeguard injections) and all whole-formula / regex rewrites in `shieldFormula` + `cleanTypoString` math rewrites + Ch.9 canonical header remapping. Replace with a non-mutating `lintFormula` that returns warnings (shadow log only for now).
- [x] **1.3** Fix silent section loss in `consolidateFragmentedSections` (unmatched + duplicate A/B sections must be merged, never dropped) and remove blind deletion in `deduplicateSectionC`.
- [x] **1.4** Make `normalizeFormulaKey` structure-preserving; scope Vietnamese diacritic repair to Vietnamese tokens only and never apply it to LaTeX.
- [x] **1.5** Surface parser `warnings` through `/api/notes/generate` → UI banner; cap JSON `sources` size and `focus` length; delimit `focus` in the prompt.
- [x] **1.6** Rewrite prompt: remove textbook formula catalogues and forced canonical section templates; source-only grounding; drop exercises but capture exercise-only formulas; remove "2–3 pages / 3–5 sections" hard caps that force formula loss (keep brevity for prose only).
- [x] **1.7** Regression tests for every audited bug (B1–B6, C1–C3) + update tests that asserted injected/rewritten content.

## Stage 2 — Lossless Ingestion
- [x] **2.1** OMML → LaTeX converter in `parse-pptx.ts` (fractions, sub/sup, n-ary, radicals, delimiters).
- [x] **2.2** Image/OLE equation detection + Gemini vision math transcription (`origin: "ocr"`, confidence).
- [x] **2.3** Deterministic formula inventory `lib/notes/formula-inventory.ts` (ID, slide, raw, LaTeX, origin).

## Stage 3 — Grounded Generation
- [x] **3.1** `extractionSchema` + `synthesisSchema` (`formulaRefs`, `derivedFrom`, per-bullet `slide` + `evidence`, `omitted[]`).
- [x] **3.2** Chunked extraction pass (~8 slides/chunk, temp 0) → merged Formula Ledger.
- [x] **3.3** Ledger-bound synthesis; code injects ledger LaTeX by ID.

## Stage 4 — Verification & Gate
- [x] **4.1** Deterministic verifiers: coverage, evidence-quote match, number grounding, symbol-set.
- [x] **4.2** Numeric-equivalence engine (derived forms, source-vs-note).
- [x] **4.3** Independent verifier LLM (per-claim SUPPORTED / UNSUPPORTED / CONTRADICTED).
- [x] **4.4** Gate + targeted repair loop (max 1) + `ClutchNote.verification` record; MARK policy.
- [x] **4.5** Domain rule packs as lint-only "textbook divergence" notices (student-visible).

## Stage 5 — UX & Evaluation
- [x] **5.1** Renderer + PDF: slide chips, Verified / Derived / Needs-review badges, divergence notices, "Uncaptured source formulas" box, ingestion-warning banner.
- [x] **5.2** Golden eval set (~8 real decks) + CI thresholds: formula recall ≥ 0.98, placed-formula equivalence 100%, unsupported claims 0, injected content 0.
