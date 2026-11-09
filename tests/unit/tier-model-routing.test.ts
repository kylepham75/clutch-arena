import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_GENERATOR_SLUG,
  PRIORITY_GENERATOR_SLUG,
  DEFAULT_VERIFIER_SLUG,
  DEFAULT_VISION_SLUG,
  OPENROUTER_PRIVACY_PROVIDER_CONFIG,
  OPENROUTER_VERIFIER_PROVIDER_CONFIG,
  getModelFamily,
  assertCrossFamilyVerifier,
  getOpenRouterGeneratorModel,
  getNoteSummarizerModel,
  getDistillerModel,
  getVerifierModel,
  computePipelineVersion,
  extractOpenRouterProvenance,
  assertPromptTokenCliff,
  estimateTokenCount,
  HAIKU_TOKEN_CLIFF_THRESHOLD,
  HAIKU_5_5_DECK_COST_USD,
  DEEPSEEK_VERIFIER_COST_USD,
  SONNET_5_5_UNCOMPRESSED_COST_USD,
  SONNET_5_5_CASCADED_COST_USD,
  HAIKU_TO_SONNET_CASCADE_DECK_COST_USD,
  DIRECT_HAIKU_VERIFIED_DECK_COST_USD,
  SONNET_MAX_INPUT_TOKENS,
  assertSonnetInputTokenGuard,
  computeDeckStageCostBreakdown,
} from "@/lib/ai/provider";
import {
  MCQ_GENERATION_TEMPERATURE,
  capExplanationToTwoSentences,
} from "@/lib/ai/generate-questions";
import { TIER_LIMITS, PRICING_PLANS } from "@/lib/pricing/tiers";
import { stripAnswerKeyForBlindSolve } from "@/lib/ai/verify-questions";

describe("Free vs Paid Tier Benefit & Model Routing Specification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Model Routing (OpenRouter Slugs)", () => {
    it("routes free tier generator to anthropic/claude-haiku-5.5", () => {
      expect(DEFAULT_GENERATOR_SLUG).toBe("anthropic/claude-haiku-5.5");
      expect(getModelFamily(DEFAULT_GENERATOR_SLUG)).toBe("anthropic");
    });

    it("routes paid tier generator to anthropic/claude-sonnet-5.5", () => {
      expect(PRIORITY_GENERATOR_SLUG).toBe("anthropic/claude-sonnet-5.5");
      expect(getModelFamily(PRIORITY_GENERATOR_SLUG)).toBe("anthropic");
    });

    it("routes note summarizer to the same model as the tier's generator", () => {
      // Mock OpenRouter key
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-mock-key");
      delete process.env.OPENROUTER_GENERATOR_MODEL;
      delete process.env.OPENROUTER_PRIORITY_MODEL;
      delete process.env.OPENROUTER_PAID_GENERATOR_MODEL;
      delete process.env.OPENROUTER_FREE_GENERATOR_MODEL;

      // Free tier note summarizer: Haiku 5.5
      const freeSummarizer = getNoteSummarizerModel("contender");
      expect(freeSummarizer.modelId).toBe("anthropic/claude-haiku-5.5");

      // Paid tier note summarizer: Sonnet 5.5
      const paidSummarizer = getNoteSummarizerModel("pro");
      expect(paidSummarizer.modelId).toBe("anthropic/claude-sonnet-5.5");

      const cramSummarizer = getNoteSummarizerModel("cram_pass");
      expect(cramSummarizer.modelId).toBe("anthropic/claude-sonnet-5.5");

      const tutorSummarizer = getNoteSummarizerModel("tutor");
      expect(tutorSummarizer.modelId).toBe("anthropic/claude-sonnet-5.5");
    });

    it("routes verifier for both tiers to deepseek/deepseek-v4.1-flash-1017", () => {
      expect(DEFAULT_VERIFIER_SLUG).toBe("deepseek/deepseek-v4.1-flash-1017");
      expect(getModelFamily(DEFAULT_VERIFIER_SLUG)).toBe("deepseek");

      // Verifier must differ in family from generator
      expect(getModelFamily(DEFAULT_VERIFIER_SLUG)).not.toBe(
        getModelFamily(DEFAULT_GENERATOR_SLUG),
      );
      expect(getModelFamily(DEFAULT_VERIFIER_SLUG)).not.toBe(
        getModelFamily(PRIORITY_GENERATOR_SLUG),
      );

      // Verifier pairing check
      expect(() =>
        assertCrossFamilyVerifier(DEFAULT_GENERATOR_SLUG, DEFAULT_VERIFIER_SLUG),
      ).not.toThrow();
      expect(() =>
        assertCrossFamilyVerifier(PRIORITY_GENERATOR_SLUG, DEFAULT_VERIFIER_SLUG),
      ).not.toThrow();
    });

    it("strictly prevents verifier from ever using or falling back into Anthropic", () => {
      expect(() =>
        getVerifierModel({
          generatorSlug: "google/gemini-3.6-flash",
          modelOverride: "anthropic/claude-haiku-5.5",
        }),
      ).toThrow(/Anthropic family/i);

      expect(() =>
        getVerifierModel({
          generatorSlug: "google/gemini-3.6-flash",
          modelOverride: "anthropic/claude-sonnet-5.5",
        }),
      ).toThrow(/Anthropic family/i);
    });

    it("routes vision for flagged pages to Gemini Flash 2.5 lite", () => {
      expect(DEFAULT_VISION_SLUG).toBe("google/gemini-2.5-flash-lite");
      expect(getModelFamily(DEFAULT_VISION_SLUG)).toBe("google");
    });
  });

  describe("2. Configuration & Parameter Enforcement", () => {
    it("enforces generator temperature between 0.3 and 0.4", () => {
      expect(MCQ_GENERATION_TEMPERATURE).toBeGreaterThanOrEqual(0.3);
      expect(MCQ_GENERATION_TEMPERATURE).toBeLessThanOrEqual(0.4);
    });

    it("enforces verifier temperature 0.0, isolated call, and strips answer key", () => {
      const sampleQuestion = {
        id: "q-101",
        question: "What is the cost of equity under CAPM?",
        options: ["rf + beta * MRP", "D1 / P0 + g", "EBIT / Total Assets", "Net Income / Sales"] as [string, string, string, string],
        correctIndex: 0,
        explanation: "CAPM states r = rf + beta * (rm - rf).",
        financeSpec: { solver: "capm" },
        distractorRationale: "Common trap is using DDM for non-dividend firms.",
      };

      const stripped = stripAnswerKeyForBlindSolve([sampleQuestion]);
      expect(stripped).toHaveLength(1);
      expect(stripped[0]).toEqual({
        id: "q-101",
        question: "What is the cost of equity under CAPM?",
        options: ["rf + beta * MRP", "D1 / P0 + g", "EBIT / Total Assets", "Net Income / Sales"],
      });
      expect((stripped[0] as any).correctIndex).toBeUndefined();
      expect((stripped[0] as any).explanation).toBeUndefined();
      expect((stripped[0] as any).financeSpec).toBeUndefined();
      expect((stripped[0] as any).distractorRationale).toBeUndefined();
    });

    it("caps explanations strictly at 2 sentences (output cost mitigation)", () => {
      // 1 sentence remains untouched
      expect(capExplanationToTwoSentences("This is a concise explanation.")).toBe(
        "This is a concise explanation.",
      );

      // 2 sentences remain untouched
      expect(
        capExplanationToTwoSentences(
          "First sentence explains the concept. Second sentence reinforces the key rule.",
        ),
      ).toBe(
        "First sentence explains the concept. Second sentence reinforces the key rule.",
      );

      // 3+ sentences are capped to 2
      expect(
        capExplanationToTwoSentences(
          "First sentence is here. Second sentence follows immediately! Third sentence would burn excessive output tokens? Fourth sentence should definitely be dropped.",
        ),
      ).toBe("First sentence is here. Second sentence follows immediately!");

      // Empty string
      expect(capExplanationToTwoSentences("")).toBe("");
    });

    it("enforces OpenRouter privacy flags and verifier allow_fallbacks = false", () => {
      expect(OPENROUTER_PRIVACY_PROVIDER_CONFIG.require_parameters).toBe(true);
      expect(OPENROUTER_PRIVACY_PROVIDER_CONFIG.data_collection).toBe("deny");
      expect(OPENROUTER_PRIVACY_PROVIDER_CONFIG.zdr).toBe(true);

      expect(OPENROUTER_VERIFIER_PROVIDER_CONFIG.require_parameters).toBe(true);
      expect(OPENROUTER_VERIFIER_PROVIDER_CONFIG.data_collection).toBe("deny");
      expect(OPENROUTER_VERIFIER_PROVIDER_CONFIG.zdr).toBe(true);
      expect(OPENROUTER_VERIFIER_PROVIDER_CONFIG.allow_fallbacks).toBe(false);
    });

    it("logs the model string RETURNED, not requested, and folds into pipeline_version", () => {
      const rawMetadata = {
        response: {
          modelId: "anthropic/claude-haiku-5.5:exact-build-2026",
          usage: { cost: 0.00045 },
        },
      };

      const prov = extractOpenRouterProvenance(rawMetadata);
      expect(prov.servedModel).toBe("anthropic/claude-haiku-5.5:exact-build-2026");
      expect(prov.costUsd).toBe(0.00045);

      const pipelineVer = computePipelineVersion(
        prov.servedModel!,
        "deepseek/deepseek-v4.1-flash-1017:served-id",
      );
      expect(pipelineVer).toContain("anthropic/claude-haiku-5.5:exact-build-2026");
      expect(pipelineVer).toContain("deepseek/deepseek-v4.1-flash-1017:served-id");
    });
  });

  describe("3. Caps (Free vs Paid Tier Benefit)", () => {
    it("configures free tier (contender) caps: 2 decks, 10 items, 1 regen, verification ON", () => {
      const free = TIER_LIMITS.contender;
      expect(free.newDeckCredits).toBe(2);
      expect(free.maxQuestionsPerRun).toBe(10);
      expect(free.freeRegenerationsPerDeck).toBe(1);
      expect(free.canUseClutchNotes).toBe(true);
      expect(free.maxNotesPerDay).toBe(1); // 1 short summary note
    });

    it("configures paid tier (cram_pass, pro) caps: 5/30 decks, 30 items, 3/5 regens, verification ON", () => {
      const cram = TIER_LIMITS.cram_pass;
      expect(cram.newDeckCredits).toBe(5);
      expect(cram.sonnetProDeckCredits).toBe(5);
      expect(cram.haikuOverflowDeckCredits).toBe(10);
      expect(cram.maxQuestionsPerRun).toBe(30);
      expect(cram.freeRegenerationsPerDeck).toBe(3);

      const pro = TIER_LIMITS.pro;
      expect(pro.newDeckCredits).toBe(30);
      expect(pro.sonnetProDeckCredits).toBe(30);
      expect(pro.haikuOverflowDeckCredits).toBe(60);
      expect(pro.maxQuestionsPerRun).toBe(30);
      expect(pro.freeRegenerationsPerDeck).toBe(5);
    });

    it("presents distinct tier benefits in PRICING_PLANS", () => {
      const contenderPlan = PRICING_PLANS.find((p) => p.id === "contender")!;
      expect(contenderPlan.featuresEn.some((f) => f.includes("10 questions"))).toBe(true);
      expect(contenderPlan.featuresEn.some((f) => f.includes("2 document deck credits"))).toBe(true);
      expect(contenderPlan.featuresEn.some((f) => f.includes("no distractor rationale"))).toBe(true);

      const proPlan = PRICING_PLANS.find((p) => p.id === "pro")!;
      expect(proPlan.featuresEn.some((f) => f.includes("30 questions"))).toBe(true);
      expect(proPlan.featuresEn.some((f) => f.includes("30 Sonnet Pro deck credits"))).toBe(true);
      expect(proPlan.featuresEn.some((f) => f.includes("60 Fast-Track Haiku overflow decks"))).toBe(true);
      expect(proPlan.featuresEn.some((f) => f.includes("Full distractor rationale"))).toBe(true);
    });
  });

  describe("4. Assertion: 90K Token Cliff Warning for Haiku 5.5", () => {
    it("estimates token count at ~4 characters per token", () => {
      expect(estimateTokenCount("a".repeat(400))).toBe(100);
      expect(estimateTokenCount("")).toBe(0);
    });

    it("warns if any prompt exceeds 90K tokens (to avoid Haiku 100K 5x price cliff)", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Under 90K tokens (~360,000 characters)
      const safeText = "a".repeat(100_000); // ~25,000 tokens
      const safeCheck = assertPromptTokenCliff(safeText, "anthropic/claude-haiku-5.5");
      expect(safeCheck.isCliffWarning).toBe(false);
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      // Exceeds 90K tokens (~364,000 characters = 91,000 tokens)
      const cliffText = "a".repeat(364_000);
      const cliffCheck = assertPromptTokenCliff(cliffText, "anthropic/claude-haiku-5.5");
      expect(cliffCheck.isCliffWarning).toBe(true);
      expect(cliffCheck.estimatedTokens).toBeGreaterThan(HAIKU_TOKEN_CLIFF_THRESHOLD);
      expect(cliffCheck.warning).toContain("buy a Cram Pass or upgrade to Pro");
      expect(cliffCheck.customerMessage).toBe(
        "This document exceeds the free plan limit. Please buy a 7-Day Cram Pass or upgrade to Pro plan to proceed.",
      );
      expect(cliffCheck.customerMessage).not.toContain("90,000");
      expect(cliffCheck.customerMessage).not.toContain("token");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Haiku 5.5 has a 5x price cliff at 100K"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("buy a Cram Pass or upgrade to Pro plan to proceed"),
      );

      consoleWarnSpy.mockRestore();
    });

    it("throws TIER_UPGRADE_REQUIRED when throwOnExceeded is set for free tier exceeding 90K tokens", () => {
      const cliffText = "a".repeat(364_000);
      expect(() => {
        assertPromptTokenCliff(cliffText, "anthropic/claude-haiku-5.5", {
          tier: "contender",
          throwOnExceeded: true,
        });
      }).toThrowError(/exceeds the free plan limit.*buy a 7-Day Cram Pass or upgrade to Pro/);
    });
  });

  describe("5. 2-Stage Haiku -> Sonnet Compression Cascade & SONNET_MAX_INPUT_TOKENS Guard", () => {
    it("exports accurate per-stage and per-deck cost constants and SONNET_MAX_INPUT_TOKENS = 8_000", () => {
      expect(HAIKU_5_5_DECK_COST_USD).toBe(0.0146);
      expect(DEEPSEEK_VERIFIER_COST_USD).toBe(0.0135);
      expect(SONNET_5_5_UNCOMPRESSED_COST_USD).toBe(0.370);
      expect(SONNET_5_5_CASCADED_COST_USD).toBe(0.085);
      expect(HAIKU_TO_SONNET_CASCADE_DECK_COST_USD).toBe(0.113);
      expect(DIRECT_HAIKU_VERIFIED_DECK_COST_USD).toBe(0.028);
      expect(SONNET_MAX_INPUT_TOKENS).toBe(8_000);
    });

    it("routes Stage 1 Distiller model to anthropic/claude-haiku-5.5", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-mock-key");
      delete process.env.OPENROUTER_DISTILLER_MODEL;

      const distiller = getDistillerModel();
      expect(distiller.modelId).toBe("anthropic/claude-haiku-5.5");
      expect(distiller.model.modelId).toBe("anthropic/claude-haiku-5.5");
    });

    it("guards Sonnet 5.5 prompts at <= 8,000 tokens and warns + truncates prompts > 8,000 tokens while leaving Haiku 5.5 untouched", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // 32,000 chars = 8,000 tokens (within limit)
      const safeSonnetPrompt = "x".repeat(32_000);
      const safeResult = assertSonnetInputTokenGuard(
        safeSonnetPrompt,
        "anthropic/claude-sonnet-5.5",
      );
      expect(safeResult.withinLimit).toBe(true);
      expect(safeResult.estimatedTokens).toBe(8_000);
      expect(safeResult.maxTokens).toBe(8_000);
      expect(safeResult.truncatedPromptText).toHaveLength(32_000);
      expect(safeResult.warning).toBeUndefined();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      // 40,000 chars = 10,000 tokens (exceeds limit for Sonnet 5.5)
      const oversizedSonnetPrompt = "y".repeat(40_000);
      const exceededResult = assertSonnetInputTokenGuard(
        oversizedSonnetPrompt,
        "anthropic/claude-sonnet-5.5",
      );
      expect(exceededResult.withinLimit).toBe(false);
      expect(exceededResult.estimatedTokens).toBe(10_000);
      expect(exceededResult.maxTokens).toBe(8_000);
      expect(exceededResult.truncatedPromptText).toHaveLength(32_000);
      expect(exceededResult.warning).toContain(
        "exceeds SONNET_MAX_INPUT_TOKENS=8000",
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Truncating to 8000 tokens to protect unit economics"),
      );

      consoleWarnSpy.mockClear();

      // 40,000 chars on Haiku 5.5 is untouched by Sonnet token guard
      const haikuResult = assertSonnetInputTokenGuard(
        oversizedSonnetPrompt,
        "anthropic/claude-haiku-5.5",
      );
      expect(haikuResult.withinLimit).toBe(true);
      expect(haikuResult.estimatedTokens).toBe(10_000);
      expect(haikuResult.truncatedPromptText).toHaveLength(40_000);
      expect(haikuResult.warning).toBeUndefined();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it("computes structured stage cost breakdown for cache hits, cascaded Sonnet decks, and direct Haiku decks", () => {
      const cachedBreakdown = computeDeckStageCostBreakdown({
        cacheHit: true,
        cascaded: true,
      });
      expect(cachedBreakdown).toEqual({
        stage1_haiku_usd: 0,
        stage2_sonnet_usd: 0,
        stage3_deepseek_usd: 0,
        total_deck_usd: 0,
        cache_hit: true,
        cascaded: false,
      });

      const cascadedBreakdown = computeDeckStageCostBreakdown({
        cacheHit: false,
        cascaded: true,
      });
      expect(cascadedBreakdown).toEqual({
        stage1_haiku_usd: 0.0146,
        stage2_sonnet_usd: 0.085,
        stage3_deepseek_usd: 0.0135,
        total_deck_usd: 0.1131,
        cache_hit: false,
        cascaded: true,
      });

      const directHaikuBreakdown = computeDeckStageCostBreakdown({
        cacheHit: false,
        cascaded: false,
      });
      expect(directHaikuBreakdown).toEqual({
        stage1_haiku_usd: 0.0146,
        stage2_sonnet_usd: 0,
        stage3_deepseek_usd: 0.0135,
        total_deck_usd: 0.0281,
        cache_hit: false,
        cascaded: false,
      });
    });
  });
});
