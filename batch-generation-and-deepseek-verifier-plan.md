# Clutch Arena: 5-Question Micro-Batching & DeepSeek Unified Verifier Plan

> **Status:** Stage 1, Stage 2 & Stage 3 Complete (All Stages Complete)  
> **Mode:** `/ponytail lite` + `/pm-orchestrator` Ready  
> **Target Scope:** OpenRouter/Vercel Routing Fix, 5-Question Micro-Batching & 30-Question Mixer, Resilient Per-Item Validation, and DeepSeek (`deepseek/deepseek-v4.1-flash-1017`) Hallucination + Deduplication Gate across Questions & Summarized Notes

---

## 1. Root Cause Analysis (Why 15+ Questions Currently Fails)

1. **Batch Output Token Truncation (`MAX_QUESTIONS_PER_BATCH = 10` + `maxOutputTokens: 4_096`):**
   - In `lib/ai/generate-questions.ts`, `MAX_QUESTIONS_PER_BATCH` is currently `10`. Requesting **15 questions** splits into `[8, 7]`, which after `+20%` over-generation (`computeOverGeneratedCount`) requests **10 and 9 items per batch**.
   - Every item in `generatedStudySchema` contains a base MCQ **plus** a full `conceptVariant` MCQ **plus** a rich `annotation` with verbatim `excerpt`. Thus 10 items = **20 full MCQs + 10 annotations (~4,500–6,000 JSON tokens)**.
   - However, `generateQuestions` hardcodes `maxOutputTokens: 4_096` (line 1172, ignoring the unused `8_192` variable on line 1047).
2. **OpenRouter Default Reasoning Token Burn on Vercel:**
   - The pinned OpenRouter models (`anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`, and `deepseek/deepseek-v4.1-flash-1017`) have internal reasoning enabled by default (`medium`/`high` effort). Without bounding reasoning effort (`reasoning: { effort: "low" }`) and raising `maxOutputTokens` to `8_192`, internal thinking tokens consume the `4,096` output budget and truncate the JSON stream mid-object (`NoObjectGeneratedError` $\to$ `INVALID_AI_OUTPUT`).
3. **All-or-Nothing Validation Crash (`badOutput` on Single-Item Defect):**
   - In `validateGeneratedStudy` (`lib/ai/generate-questions.ts`), if **even 1 question out of 30** has an unverified excerpt quote or duplicate option choice, `badOutput()` throws `INVALID_AI_OUTPUT` and discards the **entire 30-question pack** instead of dropping only the defective item.
4. **DeepSeek Verifier Missing Hallucination/Deduplication Checks & Unwired in Notes:**
   - `verifyQuestionsBlindly` (`lib/ai/verify-questions.ts`) checks `selectedIndex` and `isAmbiguous`, but does not check whether the question/explanation introduces **hallucinated outside knowledge** (`isGrounded: false`) or **semantic duplicate questions** (`duplicateOfId`) across merged batches.
   - `generateClutchNote` (`lib/ai/generate-notes.ts`) never wires `getVerifierModel()` (`deepseek/deepseek-v4.1-flash-1017`) by default when `OPENROUTER_API_KEY` is present, and `verifyNoteClaimsWithLlm` (`lib/notes/verifier-llm.ts`) does not flag duplicate bullets/takeaways across note sections.

---

## 2. Target Architecture

```text
User Request (e.g., 15, 20, or 30 Questions)
        │
        ▼
[1] 5-QUESTION MICRO-BATCHING (MAX_QUESTIONS_PER_BATCH = 5)
    - 15 questions -> 3 batches of 5 (+20% buffer = 6 items/batch)
    - 30 questions -> 6 batches of 5 (+20% buffer = 6 items/batch)
    - Each batch ~2,000 JSON tokens << 8,192 maxOutputTokens (zero truncation)
    - OpenRouter reasoning capped at effort: "low" for fast structured JSON
    - Resilient batch execution: partial batch failure never aborts healthy batches
        │
        ▼
[2] CROSS-BATCH MIXER & PRE-FILTER (mergeAndDeduplicateBatches)
    - Interleave items across conceptual slide partitions for balanced topic coverage
    - Fast deterministic stem/concept deduplication before LLM verification
        │
        ▼
[3] DEEPSEEK UNIFIED VERIFIER (deepseek/deepseek-v4.1-flash-1017)
    ├── (3A) Question Packs (lib/ai/verify-questions.ts):
    │        1. Blind Solve: selectedIndex === correctIndex & !isAmbiguous
    │        2. Hallucination Check: isGrounded === true against sourceText
    │        3. Duplicate Check: duplicateOfId === null across the mixed pack
    │        -> Silently drop any failed, hallucinated, or duplicate question
    │
    └── (3B) Summarized Notes (lib/notes/verifier-llm.ts & generate-notes.ts):
             1. Auto-enable DeepSeek verifier when OPENROUTER_API_KEY is configured
             2. Hallucination Check: SUPPORTED vs UNSUPPORTED / CONTRADICTED against slides
             3. Duplicate Check: flag & strip duplicate bullets/takeaways across sections
```

---

## 3. Implementation Roadmap & Atomic Tasks (`/pm-orchestrator`)

### Stage 1: OpenRouter Vercel Routing & 5-Question Micro-Batching Engine
- [x] **Task 1.1:** Harden OpenRouter routing & token configuration in `lib/ai/provider.ts` — pass `reasoning: { effort: "low" }` in OpenRouter model settings so reasoning tokens never truncate structured JSON output, and ensure OpenRouter fallback stays prioritized ahead of legacy direct SDK keys when `OPENROUTER_API_KEY` is set.
- [x] **Task 1.2:** Upgrade `lib/ai/generate-questions.ts` to 5-question micro-batches (`MAX_QUESTIONS_PER_BATCH = 5`), wire `maxOutputTokens` (`8_192` for OpenRouter/Gemini, `4_096` for Groq), use resilient batch gathering (`Promise.allSettled`) with round-robin cross-batch mixing in `mergeAndDeduplicateBatches`, and convert per-question citation/option defects in `validateGeneratedStudy` from hard-throwing `badOutput()` to skipping the defective item (only throwing if `0` valid questions remain).

### Stage 2: DeepSeek Verifier Upgrade (Solve + Anti-Hallucination + Deduplication)
- [x] **Task 2.1:** Upgrade `lib/ai/verify-questions.ts` (`blindVerificationVerdictSchema`, `buildBlindVerificationPrompt`, and `filterBlindVerifiedQuestions`) so the DeepSeek verifier (`deepseek/deepseek-v4.1-flash-1017`) simultaneously: (a) blind-solves each question & `conceptVariant`, (b) verifies `isGrounded: boolean` against `sourceText` to reject hallucinated facts, and (c) identifies semantic duplicates (`duplicateOfId: string | null`) across the mixed 20–30 question pack, chunking verifier calls safely so large 30-question packs never truncate.
- [x] **Task 2.2:** Upgrade `lib/schemas/notes.ts`, `lib/notes/verifier-llm.ts`, `lib/notes/verification-gate.ts`, and `lib/ai/generate-notes.ts` to auto-enable the DeepSeek verifier (`getVerifierModel()`) on Clutch Notes when `OPENROUTER_API_KEY` is configured, and add cross-section duplicate claim/bullet/takeaway detection (`isDuplicate` / deterministic + LLM deduplication) alongside hallucination removal.

### Stage 3: Unit & Regression Verification Suite
- [x] **Task 3.1:** Update and add unit tests in `tests/unit/ingestion-generation.test.ts` and `tests/verifier-llm.test.ts` verifying: (a) 5-question micro-batching splits 15 into `[5, 5, 5]` and 30 into six 5-question batches, (b) single-item bad citations/options drop the item instead of failing the pack, and (c) DeepSeek verifier drops hallucinated and duplicated items in both question packs and Clutch Notes.
