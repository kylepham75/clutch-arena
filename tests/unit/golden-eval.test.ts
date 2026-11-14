import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clutchNoteSchema, type ClutchNote, type NoteFormula } from "@/lib/schemas/notes";
import {
  GOLDEN_DECKS,
  DECK_1_STOCK_VALUATION,
  DECK_2_RISK_AND_RETURN,
  DECK_3_WACC,
  DECK_4_ELASTICITY,
  DECK_5_MONOPOLY,
  DECK_6_IS_LM,
  DECK_7_BOND_VALUATION,
  DECK_8_OLS_REGRESSION,
  type GoldenDeckDefinition,
  COMPILER_V2_CI_THRESHOLDS,
  evaluateCompilerGoldenDeck,
  runCompilerGoldenBenchmarkSuite,
  create105SlideLateDeckFixture,
  type CompilerDeckEvalResult,
  type CompilerSuiteEvalReport,
} from "@/lib/notes/eval/golden-decks";
import {
  evaluateGoldenDeck,
  runGoldenEvalSuite,
  CI_THRESHOLDS,
} from "@/lib/notes/eval/golden-eval";
import {
  OPENROUTER_PRIVACY_PROVIDER_CONFIG,
  OPENROUTER_PROVIDER_OPTIONS,
  getOpenRouterRequestConfig,
  assertPinnedOpenRouterSlug,
  isPinnedOpenRouterSlug,
  getModelFamily,
  assertCrossFamilyVerifier,
  computePipelineVersion,
  extractOpenRouterProvenance,
  PIPELINE_BASE_VERSION,
  DEFAULT_GENERATOR_SLUG,
  DEFAULT_VERIFIER_SLUG,
  FALLBACK_VERIFIER_SLUG,
} from "@/lib/ai/provider";
import {
  solveFinanceSpec,
  evaluateFinanceSpecValue,
  solveTvm,
  solveAnnuity,
  solvePerpetuity,
  solveDdm,
  solveBondPrice,
  solveYtm,
  solveNpv,
  solveIrr,
  solveWacc,
  solveCapm,
  formatFinanceValue,
  applyFinanceSolverToItem,
  type FinanceCalculationSpec,
} from "@/lib/math/finance-solver";
import {
  stripAnswerKeyForBlindSolve,
  filterBlindVerifiedQuestions,
  buildBlindVerificationPrompt,
  getConceptVariantBlindId,
  type VerifiableQuestionInput,
  type BlindVerificationVerdict,
} from "@/lib/ai/verify-questions";
import {
  resolveBulletNumericStep,
  runBulletNumericCascade,
} from "@/lib/notes/deterministic-verifiers";
import {
  evaluateSectionDropRate,
  runSectionQualityGate,
  buildTargetedRepairPrompt,
} from "@/lib/notes/verification-gate";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import type { NoteSection, GroundedBullet } from "@/lib/schemas/notes";

function cloneNote(note: ClutchNote): ClutchNote {
  return JSON.parse(JSON.stringify(note));
}

describe("Stage 5.2 Golden Evaluation Set & CI Thresholds", () => {
  describe("Schema Conformance", () => {
    it("all 8 gold notes strictly satisfy clutchNoteSchema", () => {
      for (const deck of GOLDEN_DECKS) {
        const parsed = clutchNoteSchema.safeParse(deck.goldNote);
        expect(
          parsed.success,
          `Gold note for deck ${deck.id} failed clutchNoteSchema validation: ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true);
      }
    });

    it("has exactly 8 golden decks covering the full university curriculum", () => {
      expect(GOLDEN_DECKS).toHaveLength(8);
      const expectedIds = [
        "deck-1-stock-valuation",
        "deck-2-risk-and-return",
        "deck-3-cost-of-capital-wacc",
        "deck-4-price-elasticity",
        "deck-5-monopoly-market-power",
        "deck-6-is-lm-macroeconomics",
        "deck-7-bond-valuation-duration",
        "deck-8-ols-econometrics",
      ];
      expect(GOLDEN_DECKS.map((d) => d.id)).toEqual(expectedIds);
    });
  });

  describe("Individual Golden Deck CI Evaluations", () => {
    it("Deck 1 (Stock Valuation & DDM) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(
        DECK_1_STOCK_VALUATION,
        DECK_1_STOCK_VALUATION.goldNote,
      );
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("Deck 2 (Risk, Return & CAPM) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(
        DECK_2_RISK_AND_RETURN,
        DECK_2_RISK_AND_RETURN.goldNote,
      );
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("Deck 3 (Cost of Capital & WACC) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(DECK_3_WACC, DECK_3_WACC.goldNote);
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("Deck 4 (Price Elasticity of Demand & Supply) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(DECK_4_ELASTICITY, DECK_4_ELASTICITY.goldNote);
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("Deck 5 (Monopoly & Market Power) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(DECK_5_MONOPOLY, DECK_5_MONOPOLY.goldNote);
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("Deck 6 (Goods Market & Money Market IS-LM) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(DECK_6_IS_LM, DECK_6_IS_LM.goldNote);
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("Deck 7 (Bond Valuation & Duration) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(
        DECK_7_BOND_VALUATION,
        DECK_7_BOND_VALUATION.goldNote,
      );
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("Deck 8 (OLS Regression) passes all CI thresholds", () => {
      const result = evaluateGoldenDeck(
        DECK_8_OLS_REGRESSION,
        DECK_8_OLS_REGRESSION.goldNote,
      );
      expect(result.passed).toBe(true);
      expect(result.formulaRecall).toBeGreaterThanOrEqual(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.placedEquivalenceRatio).toBe(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE);
      expect(result.unsupportedClaimCount).toBe(0);
      expect(result.injectedContentCount).toBe(0);
      expect(result.missingFormulaIds).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("Suite Aggregation (runGoldenEvalSuite)", () => {
    it("evaluates all 8 decks and reports 100% CI compliance", () => {
      const suiteReport = runGoldenEvalSuite(GOLDEN_DECKS);

      expect(suiteReport.passed).toBe(true);
      expect(suiteReport.totalDecks).toBe(8);
      expect(suiteReport.passedDecks).toBe(8);
      expect(suiteReport.failedDecks).toBe(0);
      expect(suiteReport.averageRecall).toBeGreaterThanOrEqual(0.98);
      expect(suiteReport.averageEquivalence).toBe(1.0);
      expect(suiteReport.totalUnsupportedClaims).toBe(0);
      expect(suiteReport.totalInjectedContent).toBe(0);
      expect(suiteReport.violations).toHaveLength(0);
    });
  });

  describe("Negative Test Cases & Regression Traps", () => {
    it("fails recall threshold when an essential formula is dropped", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);

      // Remove Gordon Growth formulas (F4 and F5) from section C
      const secC = compromisedNote.sections.find((s) => s.letter === "C");
      expect(secC).toBeDefined();

      if (secC && secC.subSections) {
        secC.subSections = secC.subSections.filter(
          (sub) => !sub.heading.includes("Constant Growth"),
        );
      }

      const result = evaluateGoldenDeck(DECK_1_STOCK_VALUATION, compromisedNote);

      expect(result.passed).toBe(false);
      expect(result.formulaRecall).toBeLessThan(CI_THRESHOLDS.MIN_FORMULA_RECALL);
      expect(result.missingFormulaIds).toContain("F4");
      expect(result.missingFormulaIds).toContain("F5");
      expect(result.violations.some((v) => v.includes("Formula recall"))).toBe(true);
    });

    it("fails placed equivalence threshold when a formula has a sign flip or mathematical contradiction", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);

      // Introduce a sign flip in Gordon Growth formula: P_0 = D_1 / (R + g) instead of (R - g)
      const secC = compromisedNote.sections.find((s) => s.letter === "C");
      expect(secC).toBeDefined();

      const gordonSub = secC?.subSections?.find((sub) =>
        sub.heading.includes("Constant Growth"),
      );
      expect(gordonSub).toBeDefined();

      if (gordonSub) {
        const f4 = gordonSub.formulas.find((f) => f.formulaRefs?.includes("F4"));
        if (f4) {
          f4.latex = "P_0 = \\frac{D_1}{R + g}"; // Contradiction
          f4.status = "contradicted";
          f4.reviewReason = "Sign flip addition in denominator";
        }
      }

      const result = evaluateGoldenDeck(DECK_1_STOCK_VALUATION, compromisedNote);

      expect(result.passed).toBe(false);
      expect(result.placedEquivalenceRatio).toBeLessThan(
        CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE,
      );
      expect(
        result.violations.some(
          (v) =>
            v.includes("Placed-formula equivalence") ||
            v.includes("contradicted"),
        ),
      ).toBe(true);
    });

    it("fails unsupported claims threshold when a bullet has non-matching or fabricated evidence", () => {
      const compromisedNote = cloneNote(DECK_2_RISK_AND_RETURN.goldNote);

      // Add a hallucinated bullet with fabricated evidence not found on any slide
      const secA = compromisedNote.sections[0];
      secA.groundedBullets?.push({
        text: "Quantum arbitrage eliminates all market risk simultaneously",
        slide: 1,
        evidence: "Quantum arbitrage eliminates all market risk simultaneously",
        status: "verified",
        verdict: "SUPPORTED",
      });

      const result = evaluateGoldenDeck(DECK_2_RISK_AND_RETURN, compromisedNote);

      expect(result.passed).toBe(false);
      expect(result.unsupportedClaimCount).toBeGreaterThan(0);
      expect(
        result.violations.some((v) => v.includes("Unsupported claim count")),
      ).toBe(true);
    });

    it("fails unsupported claims threshold when a claim is explicitly marked UNSUPPORTED", () => {
      const compromisedNote = cloneNote(DECK_3_WACC.goldNote);

      // Mark an existing bullet as UNSUPPORTED
      const secA = compromisedNote.sections[0];
      if (secA.groundedBullets && secA.groundedBullets.length > 0) {
        secA.groundedBullets[0].verdict = "UNSUPPORTED";
        secA.groundedBullets[0].status = "unsupported";
      }

      const result = evaluateGoldenDeck(DECK_3_WACC, compromisedNote);

      expect(result.passed).toBe(false);
      expect(result.unsupportedClaimCount).toBeGreaterThan(0);
      expect(
        result.violations.some((v) => v.includes("Unsupported claim count")),
      ).toBe(true);
    });

    it("fails injected content threshold when textbook catalogue formulas are injected", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);

      // Inject forbidden textbook formula P_N = D_{N+1} / (R - g)
      const secB = compromisedNote.sections[1];
      const injectedFormula: NoteFormula = {
        name: "Injected Textbook Terminal Price",
        latex: "P_N = \\frac{D_{N+1}}{R - g}",
        variables: [],
        status: "verified",
      };
      secB.formulas.push(injectedFormula);

      const result = evaluateGoldenDeck(DECK_1_STOCK_VALUATION, compromisedNote);

      expect(result.passed).toBe(false);
      expect(result.injectedContentCount).toBeGreaterThan(0);
      expect(
        result.violations.some((v) => v.includes("Injected content count")),
      ).toBe(true);
    });

    it("fails injected content threshold when ungrounded arbitrary formulas are placed in note", () => {
      const compromisedNote = cloneNote(DECK_4_ELASTICITY.goldNote);

      // Inject ungrounded arbitrary formula
      const secA = compromisedNote.sections[0];
      secA.formulas.push({
        name: "Completely Ungrounded Formula",
        latex: "Z = \\frac{A + B}{C \\times D}",
        variables: [],
        status: "verified",
      });

      const result = evaluateGoldenDeck(DECK_4_ELASTICITY, compromisedNote);

      expect(result.passed).toBe(false);
      expect(result.injectedContentCount).toBeGreaterThan(0);
    });

    it("suite fails completely if even one deck fails CI thresholds", () => {
      const compromisedDeck: GoldenDeckDefinition = {
        ...DECK_1_STOCK_VALUATION,
        goldNote: cloneNote(DECK_1_STOCK_VALUATION.goldNote),
      };

      // Corrupt the note in compromisedDeck: drop section B formulas and section C subSections
      compromisedDeck.goldNote.sections[1].formulas = [];
      compromisedDeck.goldNote.sections[2].subSections = [];

      const testSuite = [
        compromisedDeck,
        DECK_2_RISK_AND_RETURN,
        DECK_3_WACC,
      ];

      const report = runGoldenEvalSuite(testSuite);

      expect(report.passed).toBe(false);
      expect(report.failedDecks).toBe(1);
      expect(report.passedDecks).toBe(2);
      expect(report.violations.length).toBeGreaterThan(0);
    });
  });
});

describe("OpenRouter Unified Provider Architecture & Privacy Headers", () => {
  it("strictly enforces OpenRouter privacy headers (require_parameters, data_collection: deny, zdr: true)", () => {
    expect(OPENROUTER_PRIVACY_PROVIDER_CONFIG).toEqual({
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
    });

    expect(OPENROUTER_PROVIDER_OPTIONS).toEqual({
      provider: OPENROUTER_PRIVACY_PROVIDER_CONFIG,
    });

    const requestConfig = getOpenRouterRequestConfig();
    expect(requestConfig.provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
    });
  });

  it("rejects dynamic, free, and web-augmented OpenRouter slugs (:free, :online, openrouter/auto)", () => {
    const invalidSlugs = [
      "google/gemini-2.0-flash:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "openai/gpt-4o:online",
      "openrouter/auto",
      "openrouter/auto:nitro",
      "",
      "   ",
    ];

    for (const slug of invalidSlugs) {
      expect(() => assertPinnedOpenRouterSlug(slug)).toThrow();
      expect(isPinnedOpenRouterSlug(slug)).toBe(false);
    }

    const validPinnedSlugs = [
      "google/gemini-3.6-flash",
      "anthropic/claude-sonnet-5.5",
      "openai/gpt-6.1-terra",
      "google/gemini-4-argon",
      DEFAULT_GENERATOR_SLUG,
      DEFAULT_VERIFIER_SLUG,
      FALLBACK_VERIFIER_SLUG,
    ];

    for (const slug of validPinnedSlugs) {
      expect(() => assertPinnedOpenRouterSlug(slug)).not.toThrow();
      expect(isPinnedOpenRouterSlug(slug)).toBe(true);
    }
  });

  it("enforces cross-family separation and rejects same-family pairing", () => {
    expect(getModelFamily("google/gemini-3.6-flash")).toBe("google");
    expect(getModelFamily("anthropic/claude-sonnet-5.5")).toBe("anthropic");
    expect(getModelFamily("openai/gpt-6.1-terra")).toBe("openai");
    expect(getModelFamily("deepseek/deepseek-v4.1-flash")).toBe("deepseek");
    expect(getModelFamily("deepseek/deepseek-v4.1-flash-1017")).toBe("deepseek");
    expect(getModelFamily("qwen/qwen-2.5-72b-instruct")).toBe("qwen");

    expect(() =>
      assertCrossFamilyVerifier("google/gemini-3.6-flash", "google/gemini-4-argon"),
    ).toThrow(/cross-family pairing is required/i);

    expect(() =>
      assertCrossFamilyVerifier(
        "anthropic/claude-sonnet-5.5",
        "anthropic/claude-3-5-haiku-20241022",
      ),
    ).toThrow(/cross-family pairing is required/i);

    expect(() =>
      assertCrossFamilyVerifier("openai/gpt-4o", "openai/gpt-6.1-terra"),
    ).toThrow(/cross-family pairing is required/i);

    expect(() =>
      assertCrossFamilyVerifier(
        "google/gemini-3.6-flash",
        "anthropic/claude-sonnet-5.5",
      ),
    ).not.toThrow();

    expect(() =>
      assertCrossFamilyVerifier(
        "google/gemini-3.6-flash",
        "openai/gpt-6.1-terra",
      ),
    ).not.toThrow();

    expect(() =>
      assertCrossFamilyVerifier(
        "anthropic/claude-sonnet-5.5",
        "openai/gpt-6.1-terra",
      ),
    ).not.toThrow();
  });

  it("cross-family verifier fallback guard never falls back to the generator family", () => {
    const generator = "google/gemini-3.6-flash";
    const primaryVerifier = DEFAULT_VERIFIER_SLUG;
    const fallbackVerifier = FALLBACK_VERIFIER_SLUG;

    expect(getModelFamily(generator)).toBe("google");
    expect(getModelFamily(primaryVerifier)).toBe("deepseek");
    expect(getModelFamily(fallbackVerifier)).toBe("openai");

    expect(() =>
      assertCrossFamilyVerifier(generator, primaryVerifier),
    ).not.toThrow();
    expect(() =>
      assertCrossFamilyVerifier(generator, fallbackVerifier),
    ).not.toThrow();

    const invalidGoogleFallback = "google/gemini-4-argon";
    expect(() =>
      assertCrossFamilyVerifier(generator, invalidGoogleFallback),
    ).toThrow(/cross-family/i);
  });

  it("folds served-model provenance cleanly into pipeline_version", () => {
    expect(PIPELINE_BASE_VERSION).toBe("3.0.0-final");

    const fullVersion = computePipelineVersion(
      "google/gemini-3.6-flash",
      "anthropic/claude-sonnet-5.5",
    );
    expect(fullVersion).toBe(
      "3.0.0-final+google/gemini-3.6-flash+anthropic/claude-sonnet-5.5",
    );

    const genOnlyVersion = computePipelineVersion("google/gemini-3.6-flash");
    expect(genOnlyVersion).toBe("3.0.0-final+google/gemini-3.6-flash");

    const fallbackUnknown = computePipelineVersion("");
    expect(fallbackUnknown).toBe("3.0.0-final+unknown");
  });

  it("extracts OpenRouter served model provenance and usage.cost across response shapes", () => {
    const shape1 = {
      model: "anthropic/claude-sonnet-5.5",
      usage: { cost: 0.00345 },
    };
    const p1 = extractOpenRouterProvenance(shape1);
    expect(p1.servedModel).toBe("anthropic/claude-sonnet-5.5");
    expect(p1.costUsd).toBe(0.00345);

    const shape2 = {
      rawResponse: {
        model: "openai/gpt-6.1-terra",
        usage: { cost: "0.00125" },
      },
      provider: "OpenRouter",
    };
    const p2 = extractOpenRouterProvenance(shape2);
    expect(p2.servedModel).toBe("openai/gpt-6.1-terra");
    expect(p2.costUsd).toBe(0.00125);
    expect(p2.providerName).toBe("OpenRouter");

    const shape3 = {
      providerMetadata: {
        openrouter: {
          model: "google/gemini-3.6-flash",
          cost: 0.0005,
        },
      },
    };
    const p3 = extractOpenRouterProvenance(shape3);
    expect(p3.servedModel).toBe("google/gemini-3.6-flash");
    expect(p3.costUsd).toBe(0.0005);

    expect(extractOpenRouterProvenance(null)).toEqual({
      servedModel: null,
      costUsd: 0,
    });
    expect(extractOpenRouterProvenance({})).toEqual({
      servedModel: null,
      costUsd: 0,
    });
  });
});

describe("Golden Evaluation: Quantitative Finance Solver & Misconception Distractors", () => {
  it("solves Time Value of Money (TVM) specifications with mathematical precision", () => {
    const fv = solveTvm({ pv: 1000, rate: 0.08, nper: 5, target: "fv" });
    expect(Math.abs(fv - 1469.328)).toBeLessThan(0.01);
    expect(formatFinanceValue(fv, "$", 2)).toBe("$1,469.33");

    const pv = solveTvm({ fv: 1469.328, rate: 0.08, nper: 5, target: "pv" });
    expect(Math.abs(pv - 1000)).toBeLessThan(0.01);

    const pmt = solveTvm({ pv: 100000, rate: 0.06 / 12, nper: 360, target: "pmt" });
    expect(Math.abs(pmt - 599.55)).toBeLessThan(0.05);

    const nper = solveTvm({ pv: 1000, fv: 2000, rate: 0.07, target: "nper" });
    expect(Math.abs(nper - 10.24)).toBeLessThan(0.05);

    const rate = solveTvm({ pv: 1000, fv: 1500, nper: 5, target: "rate" });
    expect(Math.abs(rate - 0.08447)).toBeLessThan(0.001);
  });

  it("solves Ordinary Annuity and Annuity Due (PV & FV)", () => {
    const ordPv = solveAnnuity({ pmt: 500, rate: 0.06, nper: 8, target: "pv" });
    expect(Math.abs(ordPv - 3104.91)).toBeLessThan(0.05);

    const duePv = solveAnnuity({ pmt: 500, rate: 0.06, nper: 8, isDue: true, target: "pv" });
    expect(Math.abs(duePv - 3291.20)).toBeLessThan(0.05);
    expect(Math.abs(duePv - ordPv * 1.06)).toBeLessThan(0.01);

    const ordFv = solveAnnuity({ pmt: 500, rate: 0.06, nper: 8, target: "fv" });
    expect(Math.abs(ordFv - 4948.73)).toBeLessThan(0.05);

    const dueFv = solveAnnuity({ pmt: 500, rate: 0.06, nper: 8, isDue: true, target: "fv" });
    expect(Math.abs(dueFv - 5245.66)).toBeLessThan(0.05);
  });

  it("solves Level Perpetuity and Growing Perpetuity", () => {
    const levelPv = solvePerpetuity({ cashFlow: 60, rate: 0.05 });
    expect(levelPv).toBe(1200);

    const growPv = solvePerpetuity({ cashFlow: 60, rate: 0.08, growth: 0.03 });
    expect(growPv).toBe(1200);
  });

  it("solves Dividend Discount Model (DDM / Gordon Growth)", () => {
    const p1 = solveDdm({ d1: 3.0, costOfEquity: 0.1, growth: 0.04 });
    expect(p1).toBeCloseTo(50.0, 2);

    const p0 = solveDdm({ d0: 2.884615, costOfEquity: 0.1, growth: 0.04, isD0: true });
    expect(Math.abs(p0 - 50.0)).toBeLessThan(0.01);

    const reqRate = solveDdm({ price: 50, d1: 3.0, growth: 0.04, target: "rate" });
    expect(Math.abs(reqRate - 0.1)).toBeLessThan(1e-6);
  });

  it("solves Bond Price and Yield to Maturity (YTM)", () => {
    const annualPrice = solveBondPrice({
      faceValue: 1000,
      couponRate: 0.07,
      rate: 0.05,
      nper: 10,
      frequency: 1,
    });
    expect(Math.abs(annualPrice - 1154.43)).toBeLessThan(0.05);

    const semiPrice = solveBondPrice({
      faceValue: 1000,
      couponRate: 0.08,
      rate: 0.06,
      nper: 5,
      frequency: 2,
    });
    expect(Math.abs(semiPrice - 1085.3)).toBeLessThan(0.05);

    const solvedYtm = solveYtm({
      price: 1085.3,
      faceValue: 1000,
      couponRate: 0.08,
      nper: 5,
      frequency: 2,
    });
    expect(Math.abs(solvedYtm - 0.06)).toBeLessThan(0.001);
  });

  it("solves Net Present Value (NPV) and Internal Rate of Return (IRR)", () => {
    const npv = solveNpv({
      initialInvestment: 5000,
      cashFlows: [1500, 2000, 2500, 1000],
      rate: 0.08,
    });
    expect(Math.abs(npv - 823.18)).toBeLessThan(0.05);

    const irr = solveIrr({
      initialInvestment: 5000,
      cashFlows: [1500, 2000, 2500, 1000],
    });
    expect(Math.abs(irr - 0.1532)).toBeLessThan(0.001);
  });

  it("solves Weighted Average Cost of Capital (WACC) and CAPM", () => {
    const wacc = solveWacc({
      equityWeight: 0.7,
      debtWeight: 0.3,
      costOfEquity: 0.11,
      costOfDebt: 0.05,
      taxRate: 0.2,
    });
    expect(Math.abs(wacc - 0.089)).toBeLessThan(1e-6);

    const capm = solveCapm({
      riskFreeRate: 0.04,
      beta: 1.25,
      marketReturn: 0.12,
    });
    expect(Math.abs(capm - 0.14)).toBeLessThan(1e-6);
  });

  it("enforces misconception distractors and rounding tolerance invariant in solveFinanceSpec", () => {
    const spec: FinanceCalculationSpec = {
      solver: "wacc",
      params: {
        equityWeight: 0.5,
        debtWeight: 0.5,
        costOfEquity: 0.12,
        costOfDebt: 0.08,
        taxRate: 0.35,
      },
      unit: "%",
      decimals: 2,
      distractor_modes: ["forgot_tax_shield", "swapped_weights"],
    };

    const res = solveFinanceSpec(spec);

    expect(res.correctValue).toBe(0.086);
    expect(res.correctOption).toBe("8.60%");
    expect(res.correctIndex).toBe(0);
    expect(res.options).toHaveLength(4);
    expect(res.distractorOptions).toHaveLength(3);

    const uniqueFormatted = new Set(res.options);
    expect(uniqueFormatted.size).toBe(4);

    const allNumeric = [res.correctValue, ...res.distractorValues];
    const tolerance = Math.max(Math.pow(10, -(2 + 2)), 1e-6);
    for (let i = 0; i < allNumeric.length; i++) {
      for (let j = i + 1; j < allNumeric.length; j++) {
        expect(Math.abs(allNumeric[i] - allNumeric[j])).toBeGreaterThan(tolerance);
      }
    }

    expect(res.options).toContain("10.00%");
    expect(res.formulaLatex).toContain("WACC");
  });

  it("applyFinanceSolverToItem patches options and correctIndex cleanly", () => {
    const rawQuestion = {
      id: "q-wacc",
      question: "Calculate WACC for the given firm.",
      options: ["Stub A", "Stub B", "Stub C", "Stub D"],
      correctIndex: 3,
    };

    const spec: FinanceCalculationSpec = {
      solver: "capm",
      params: {
        riskFreeRate: 0.03,
        beta: 1.2,
        marketReturn: 0.1,
      },
      unit: "%",
      decimals: 2,
    };

    const patched = applyFinanceSolverToItem(rawQuestion, spec);
    expect(patched.correctIndex).toBe(0);
    expect(patched.options[0]).toBe("11.40%");
    expect(patched.options).toHaveLength(4);
    expect(new Set(patched.options).size).toBe(4);
  });
});

describe("Golden Evaluation: Blind MCQ Verification & Adversarial Filtering", () => {
  it("stripAnswerKeyForBlindSolve strips correctIndex, explanations, and quotes while retaining stem and options", () => {
    const items: VerifiableQuestionInput[] = [
      {
        id: "q-test-1",
        question: "What is the primary objective of financial management?",
        options: [
          "Maximizing current revenue",
          "Maximizing shareholder wealth",
          "Minimizing tax payments",
          "Maximizing employee headcount",
        ],
        correctIndex: 1,
        explanation: "Wealth maximization accounts for risk and time value.",
        quote: "Corporate goal is wealth maximization.",
        excerpt: "Corporate Finance Ch.1",
        conceptVariant: {
          question: "Which goal properly reflects long-term firm value creation?",
          options: [
            "Maximizing market share at all costs",
            "Maximizing common stock intrinsic value",
            "Minimizing capital expenditures",
            "Maximizing book value of assets",
          ],
          correctIndex: 1,
          explanation: "Intrinsic value creation reflects shareholder wealth.",
        },
      },
    ];

    const stripped = stripAnswerKeyForBlindSolve(items, {
      includeConceptVariants: true,
    });

    expect(stripped).toHaveLength(2);

    const basePayload = stripped[0];
    expect(basePayload.id).toBe("q-test-1");
    expect(basePayload.question).toBe("What is the primary objective of financial management?");
    expect(basePayload.options).toHaveLength(4);
    expect((basePayload as any).correctIndex).toBeUndefined();
    expect((basePayload as any).explanation).toBeUndefined();
    expect((basePayload as any).quote).toBeUndefined();

    const variantPayload = stripped[1];
    expect(variantPayload.id).toBe("q-test-1::conceptVariant");
    expect(variantPayload.question).toBe("Which goal properly reflects long-term firm value creation?");
    expect((variantPayload as any).correctIndex).toBeUndefined();
    expect((variantPayload as any).explanation).toBeUndefined();
  });

  it("filterBlindVerifiedQuestions drops questions when verifier disagrees or reports ambiguity", () => {
    const questions: VerifiableQuestionInput[] = [
      {
        id: "q-agree",
        question: "What is beta in CAPM?",
        options: ["Market risk", "Default risk", "Liquidity risk", "Exchange risk"],
        correctIndex: 0,
      },
      {
        id: "q-disagree",
        question: "What does Gordon Growth model estimate?",
        options: ["Stock price", "Bond yield", "Option delta", "IRR"],
        correctIndex: 0,
      },
      {
        id: "q-ambiguous",
        question: "Is high financial leverage beneficial?",
        options: ["Yes always", "No never", "Depends on ROIC vs cost of debt", "Only in recession"],
        correctIndex: 2,
      },
      {
        id: "q-with-variant-pass",
        question: "What is duration of a zero-coupon bond?",
        options: ["Equal to maturity", "Half of maturity", "Zero", "Double maturity"],
        correctIndex: 0,
        conceptVariant: {
          question: "For a 10-year zero coupon bond, Macaulay duration is:",
          options: ["5 years", "10 years", "7.5 years", "15 years"],
          correctIndex: 1,
        },
      },
      {
        id: "q-with-variant-fail",
        question: "What does NPV represent?",
        options: ["Net dollar value created", "Accounting profit", "Payback period", "Yield"],
        correctIndex: 0,
        conceptVariant: {
          question: "A positive NPV project:",
          options: ["Adds value", "Destroys value", "Breaks even", "Is impossible"],
          correctIndex: 0,
        },
      },
      {
        id: "q-solver-skip",
        question: "Calculate FV: PV=1000, r=5%, n=2",
        options: ["$1,102.50", "$1,050.00", "$1,200.00", "$950.00"],
        correctIndex: 0,
        solverComputed: true,
      },
    ];

    const verdicts: BlindVerificationVerdict[] = [
      { id: "q-agree", selectedIndex: 0, isAmbiguous: false, confidence: "high", reason: "Verified" },
      { id: "q-disagree", selectedIndex: 1, isAmbiguous: false, confidence: "high", reason: "Disagreed" },
      { id: "q-ambiguous", selectedIndex: 2, isAmbiguous: true, confidence: "high", reason: "Two options defensible" },
      { id: "q-with-variant-pass", selectedIndex: 0, isAmbiguous: false, confidence: "high", reason: "Verified" },
      { id: "q-with-variant-pass::conceptVariant", selectedIndex: 1, isAmbiguous: false, confidence: "high", reason: "Verified" },
      { id: "q-with-variant-fail", selectedIndex: 0, isAmbiguous: false, confidence: "high", reason: "Verified" },
      { id: "q-with-variant-fail::conceptVariant", selectedIndex: 1, isAmbiguous: false, confidence: "high", reason: "Wrong variant option" },
    ];

    const res = filterBlindVerifiedQuestions(questions, verdicts, {
      skipSolverComputed: true,
    });

    expect(res.verifiedIds).toContain("q-agree");
    expect(res.verifiedIds).toContain("q-with-variant-pass");
    expect(res.verifiedIds).toContain("q-solver-skip");

    expect(res.droppedIds).toContain("q-disagree");
    expect(res.droppedIds).toContain("q-ambiguous");
    expect(res.droppedIds).toContain("q-with-variant-fail");

    expect(res.verifiedQuestions).toHaveLength(3);
  });

  it("buildBlindVerificationPrompt constructs keyless adversarial verification prompt", () => {
    const samplePayload = [
      {
        id: "item-1",
        question: "What is the cost of equity under DDM?",
        options: ["D1/P0 + g", "D0/P0", "Rf + Beta*ERP", "WACC - Rd"] as [string, string, string, string],
      },
    ];

    const prompt = buildBlindVerificationPrompt(samplePayload);
    expect(prompt).toContain("adversarial blind exam verifier");
    expect(prompt).toContain("selectedIndex to -1");
    expect(prompt).toContain("isAmbiguous to true");
    expect(prompt).toContain("item-1");
  });
});

describe("Golden Evaluation: 5-Step Numeric Resolution Cascade & Section Gate", () => {
  it("resolveBulletNumericStep executes Step 1 (PATCH) for minor typo/formatting differences", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "The operating margin reached 25.5% during the quarter due to cost controls.",
      },
    ];

    const bullet: GroundedBullet = {
      text: "The operating margin reached 24.5% during the quarter due to cost controls.",
      slide: 1,
      evidence: "The operating margin reached 25.5% during the quarter due to cost controls.",
      status: "verified",
    };

    const res = resolveBulletNumericStep(bullet, sources);
    expect(res.action).toBe("PATCH");
    expect(res.bullet.text).toContain("25.5%");
    expect(res.bullet.status).toBe("verified");
  });

  it("resolveBulletNumericStep executes Step 2 (RE_CITE) when number is located on another slide", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Corporate governance principles and executive overview.",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "In fiscal year 2025, consolidated revenue expanded to $85 million.",
      },
    ];

    const bullet: GroundedBullet = {
      text: "Consolidated revenue expanded to $85 million.",
      slide: 1,
      evidence: "Corporate governance principles and executive overview.",
      status: "verified",
    };

    const res = resolveBulletNumericStep(bullet, sources);
    expect(res.action).toBe("RE_CITE");
    expect(res.bullet.slide).toBe(2);
    expect(res.bullet.status).toBe("verified");
  });

  it("resolveBulletNumericStep executes Step 3 (KEEP_AS_DERIVED) for algebraic derivations", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "The company reported total assets of $100M and total liabilities of $35M.",
      },
    ];

    const bullet: GroundedBullet = {
      text: "Total equity value is $65M.",
      slide: 1,
      evidence: "The company reported total assets of $100M and total liabilities of $35M.",
      status: "verified",
    };

    const res = resolveBulletNumericStep(bullet, sources);
    expect(res.action).toBe("KEEP_AS_DERIVED");
    expect(res.bullet.status).toBe("derived");
  });

  it("resolveBulletNumericStep executes Step 4 (REPAIR) and Step 5 (DROP) for ungrounded numbers", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Introductory overview of capital budgeting.",
      },
    ];

    const bullet: GroundedBullet = {
      text: "Global benchmark return stands at 79.4%.",
      slide: 1,
      evidence: "Introductory overview of capital budgeting.",
      status: "verified",
    };

    const repairRes = resolveBulletNumericStep(bullet, sources, undefined, {
      dropResidual: false,
    });
    expect(repairRes.action).toBe("REPAIR");
    expect(repairRes.ungroundedNumbers).toContain("79.4%");

    const dropRes = resolveBulletNumericStep(bullet, sources, undefined, {
      dropResidual: true,
    });
    expect(dropRes.action).toBe("DROP");
  });

  it("buildTargetedRepairPrompt formats concise defects without altering valid sections", () => {
    const prompt = buildTargetedRepairPrompt({
      sections: [],
      contradictedFormulas: [
        {
          latex: "P_0 = \\frac{D_1}{r + g}",
          parentLedgerLatex: "P_0 = \\frac{D_1}{r - g}",
          parentLedgerId: "F4",
          reason: "Sign flip addition in denominator",
        },
      ],
      uncapturedFormulas: [
        {
          id: "F6",
          latex: "WACC = w_e r_e + w_d r_d (1 - T)",
          slide: 3,
        },
      ],
      contradictedClaims: [
        {
          claimId: "c-1",
          text: "Beta measures diversifiable risk",
          slide: 2,
          reason: "Beta measures systematic non-diversifiable risk",
        },
      ],
    });

    expect(prompt).toContain("CONTRADICTED FORMULAS");
    expect(prompt).toContain("UNCAPTURED SOURCE FORMULAS");
    expect(prompt).toContain("CONTRADICTED CONCEPTUAL CLAIMS");
    expect(prompt).toContain("Sign flip addition");
  });

  it("evaluateSectionDropRate enforces progressive 3-tier action gate", () => {
    expect(evaluateSectionDropRate(10, 0)).toEqual({
      dropRate: 0,
      action: "SHIP",
    });

    const r1 = evaluateSectionDropRate(15, 1);
    expect(r1.action).toBe("SHIP");
    expect(r1.dropRate).toBeCloseTo(0.067, 2);

    const r2 = evaluateSectionDropRate(15, 2);
    expect(r2.action).toBe("SHIP_AND_REGEN_BACKGROUND");

    const r3 = evaluateSectionDropRate(15, 4);
    expect(r3.action).toBe("RETRY_OR_OMIT");
  });

  it("runSectionQualityGate ships valid sections, queues background regens, and omits >20% failure sections", async () => {
    const initialSections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "Khái niệm cốt lõi",
        titleEn: "Core Concepts",
        overview: "",
        bulletPoints: [],
        subSections: [],
        formulas: [],
        groundedBullets: Array.from({ length: 10 }, (_, i) => ({
          text: `Point A-${i}`,
          slide: 1,
          evidence: `Evidence for point A-${i}`,
          status: "verified",
        })),
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "Mô hình định giá",
        titleEn: "Valuation Models",
        overview: "",
        bulletPoints: [],
        subSections: [],
        formulas: [],
        groundedBullets: Array.from({ length: 10 }, (_, i) => ({
          text: `Point B-${i}`,
          slide: 2,
          evidence: `Evidence for point B-${i}`,
          status: "verified",
        })),
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "Ứng dụng thực tế",
        titleEn: "Practical Applications",
        overview: "",
        bulletPoints: [],
        subSections: [],
        formulas: [],
        groundedBullets: Array.from({ length: 10 }, (_, i) => ({
          text: `Point C-${i}`,
          slide: 3,
          evidence: `Evidence for point C-${i}`,
          status: "verified",
        })),
      },
    ];

    const verifiedSections = JSON.parse(JSON.stringify(initialSections)) as NoteSection[];
    verifiedSections[1].groundedBullets = verifiedSections[1].groundedBullets?.slice(0, 9);
    verifiedSections[2].groundedBullets = verifiedSections[2].groundedBullets?.slice(0, 6);

    const gateRes = await runSectionQualityGate({
      initialSections,
      verifiedSections,
      perSectionDroppedCounts: { A: 0, B: 1, C: 4 },
    });

    const decA = gateRes.decisions.find((d) => d.sectionLetter === "A")!;
    expect(decA.action).toBe("SHIP");
    expect(decA.omitted).toBe(false);

    const decB = gateRes.decisions.find((d) => d.sectionLetter === "B")!;
    expect(decB.action).toBe("SHIP_AND_REGEN_BACKGROUND");
    expect(gateRes.backgroundRegenSections).toContain("B");

    const decC = gateRes.decisions.find((d) => d.sectionLetter === "C")!;
    expect(decC.action).toBe("RETRY_OR_OMIT");
    expect(decC.omitted).toBe(true);
    expect(gateRes.omittedNotices.length).toBeGreaterThan(0);
    expect(gateRes.omittedNotices[0]).toContain("Section C");

    expect(gateRes.sections.map((s) => s.letter)).toEqual(["A", "B"]);
  });
});

describe("Stage 4.2: 10-Metric Compiler Golden Benchmark Suite", () => {
  describe("Suite Aggregation & 100% CI Compliance", () => {
    it("all 8 golden decks pass evaluateCompilerGoldenDeck with 100% compliance across all 10 metrics", () => {
      for (const deck of GOLDEN_DECKS) {
        const result = evaluateCompilerGoldenDeck(deck, deck.goldNote);
        expect(
          result.passed,
          `Deck ${deck.id} failed 10-metric compiler CI evaluation: ${result.violations.join(" | ")}`,
        ).toBe(true);
        expect(result.formulaDiscoveryRecall).toBeGreaterThanOrEqual(
          COMPILER_V2_CI_THRESHOLDS.MIN_FORMULA_DISCOVERY_RECALL,
        );
        expect(result.requiredArtifactInclusionRate).toBe(
          COMPILER_V2_CI_THRESHOLDS.MIN_REQUIRED_ARTIFACT_INCLUSION,
        );
        expect(result.firstUseSymbolHygieneRate).toBe(
          COMPILER_V2_CI_THRESHOLDS.MIN_FIRST_USE_SYMBOL_HYGIENE,
        );
        expect(result.lateDeckCoverageRate).toBe(
          COMPILER_V2_CI_THRESHOLDS.MIN_LATE_DECK_COVERAGE,
        );
        expect(result.paraphraseAcceptanceRate).toBe(
          COMPILER_V2_CI_THRESHOLDS.MIN_PARAPHRASE_ACCEPTANCE,
        );
        expect(result.placedFormulaEquivalenceRate).toBe(
          COMPILER_V2_CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE,
        );
        expect(result.conditionPreservationRate).toBe(
          COMPILER_V2_CI_THRESHOLDS.MIN_CONDITION_PRESERVATION,
        );
        expect(result.strictKatexCompileRate).toBe(
          COMPILER_V2_CI_THRESHOLDS.MIN_STRICT_KATEX_COMPILE,
        );
        expect(result.unsupportedClaimCount).toBe(
          COMPILER_V2_CI_THRESHOLDS.MAX_UNSUPPORTED_CLAIMS,
        );
        expect(result.publicationHygienePassed).toBe(
          COMPILER_V2_CI_THRESHOLDS.REQUIRE_PUBLICATION_HYGIENE,
        );
        expect(result.violations).toHaveLength(0);
      }
    });

    it("runCompilerGoldenBenchmarkSuite evaluates all 8 decks and reports 100% compliance", () => {
      const suiteReport = runCompilerGoldenBenchmarkSuite(GOLDEN_DECKS);

      expect(suiteReport.passed).toBe(true);
      expect(suiteReport.totalDecks).toBe(8);
      expect(suiteReport.passedDecks).toBe(8);
      expect(suiteReport.failedDecks).toBe(0);
      expect(suiteReport.averageDiscoveryRecall).toBeGreaterThanOrEqual(0.98);
      expect(suiteReport.averageArtifactInclusion).toBe(1.0);
      expect(suiteReport.averageSymbolHygiene).toBe(1.0);
      expect(suiteReport.averageLateDeckCoverage).toBe(1.0);
      expect(suiteReport.averageParaphraseAcceptance).toBe(1.0);
      expect(suiteReport.averagePlacedEquivalence).toBe(1.0);
      expect(suiteReport.averageConditionPreservation).toBe(1.0);
      expect(suiteReport.averageStrictKatexCompile).toBe(1.0);
      expect(suiteReport.totalUnsupportedClaims).toBe(0);
      expect(suiteReport.allPublicationHygienePassed).toBe(true);
      expect(suiteReport.violations).toHaveLength(0);
    });
  });

  describe("Metric 1: Formula Discovery Recall (>= 0.98)", () => {
    it("reports >= 0.98 formula discovery recall across all 8 golden decks", () => {
      for (const deck of GOLDEN_DECKS) {
        const result = evaluateCompilerGoldenDeck(deck, deck.goldNote);
        expect(result.formulaDiscoveryRecall).toBeGreaterThanOrEqual(0.98);
        expect(result.missingFormulaIds).toHaveLength(0);
      }
    });

    it("fails recall threshold when an essential placed formula is missing", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Remove Gordon Growth formula F4 from section C
      const secC = compromisedNote.sections.find((s) => s.letter === "C");
      expect(secC).toBeDefined();
      if (secC?.subSections) {
        secC.subSections = secC.subSections.filter(
          (sub) => !sub.heading.includes("Constant Growth"),
        );
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );

      expect(result.passed).toBe(false);
      expect(result.formulaDiscoveryRecall).toBeLessThan(0.98);
      expect(result.missingFormulaIds).toContain("F4");
      expect(result.missingFormulaIds).toContain("F5");
      expect(
        result.violations.some((v) => v.includes("Formula discovery recall")),
      ).toBe(true);
    });
  });

  describe("Metric 2: Required-Artifact Inclusion Rate (=== 1.0)", () => {
    it("reports 100% required artifact inclusion across all 8 golden decks", () => {
      for (const deck of GOLDEN_DECKS) {
        const result = evaluateCompilerGoldenDeck(deck, deck.goldNote);
        expect(result.requiredArtifactInclusionRate).toBe(1.0);
        expect(result.missingArtifactIds).toHaveLength(0);
      }
    });

    it("fails inclusion rate when a required formula is omitted", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Drop formula F7 from section C subSection Case 3
      const secC = compromisedNote.sections.find((s) => s.letter === "C");
      const case3 = secC?.subSections?.find((sub) =>
        sub.heading.includes("Non-Constant"),
      );
      expect(case3).toBeDefined();
      if (case3) {
        case3.formulas = case3.formulas.filter(
          (f) => !f.formulaRefs?.includes("F7"),
        );
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );

      expect(result.passed).toBe(false);
      expect(result.requiredArtifactInclusionRate).toBeLessThan(1.0);
      expect(result.missingArtifactIds).toContain("formula:F7");
      expect(
        result.violations.some((v) => v.includes("Required artifact inclusion")),
      ).toBe(true);
    });

    it("fails inclusion rate when a required conceptual keyword is missing", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Remove all mentions of "sustainable growth" from section D
      const secD = compromisedNote.sections.find((s) => s.letter === "D");
      expect(secD).toBeDefined();
      if (secD) {
        secD.titleVi = "D. THAM SỐ KHÁC";
        secD.titleEn = "Other Parameters";
        secD.overview = "";
        secD.groundedBullets = [];
        secD.bulletPoints = [];
        secD.formulas = [];
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );

      expect(result.passed).toBe(false);
      expect(result.requiredArtifactInclusionRate).toBeLessThan(1.0);
      expect(result.missingArtifactIds).toContain("concept:sustainable growth");
    });
  });

  describe("Metric 3: First-Use Symbol Hygiene Rate (=== 1.0)", () => {
    it("reports 100% first-use symbol hygiene with zero duplicate variable definitions in all 8 decks", () => {
      for (const deck of GOLDEN_DECKS) {
        const result = evaluateCompilerGoldenDeck(deck, deck.goldNote);
        expect(result.firstUseSymbolHygieneRate).toBe(1.0);
        expect(result.duplicateSymbolDefinitions).toHaveLength(0);
      }
    });

    it("fails first-use symbol hygiene when a variable symbol is redundantly re-defined in a later formula", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Re-define $R$ (already defined in F1 in section B) inside formula F3 in section C
      const secC = compromisedNote.sections.find((s) => s.letter === "C");
      const case1 = secC?.subSections?.find((sub) =>
        sub.heading.includes("Zero Growth"),
      );
      expect(case1).toBeDefined();
      if (case1 && case1.formulas.length > 0) {
        case1.formulas[0].variables.push({
          symbol: "R",
          definition: "Required rate of return (duplicate definition)",
        });
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );

      expect(result.passed).toBe(false);
      expect(result.firstUseSymbolHygieneRate).toBeLessThan(1.0);
      expect(result.duplicateSymbolDefinitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ symbol: "R", sectionLetter: "C" }),
        ]),
      );
      expect(
        result.violations.some((v) => v.includes("First-use symbol hygiene")),
      ).toBe(true);
    });

    it("fails first-use symbol hygiene when symbol $P_0$ is re-defined later in section D", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Re-define $P_0$ in F9 of section D
      const secD = compromisedNote.sections.find((s) => s.letter === "D");
      expect(secD).toBeDefined();
      if (secD && secD.formulas.length > 1) {
        secD.formulas[1].variables.push({
          symbol: "P_0",
          definition: "Current stock price (redundant)",
        });
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );

      expect(result.passed).toBe(false);
      expect(result.firstUseSymbolHygieneRate).toBeLessThan(1.0);
      expect(result.duplicateSymbolDefinitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ symbol: "P_0", sectionLetter: "D" }),
        ]),
      );
    });
  });

  describe("Metric 4: Late-Deck CAPM & Topic Coverage (=== 1.0)", () => {
    it("Deck 2 (Risk, Return & CAPM) achieves 100% late-deck coverage for CAPM and Portfolio Beta", () => {
      const result = evaluateCompilerGoldenDeck(
        DECK_2_RISK_AND_RETURN,
        DECK_2_RISK_AND_RETURN.goldNote,
      );
      expect(result.lateDeckCoverageRate).toBe(1.0);
      expect(result.uncoveredLateDeckItems).toHaveLength(0);
    });

    it("105-slide Corporate Finance fixture achieves 100% late-deck coverage on slides 85–105", () => {
      const fixture = create105SlideLateDeckFixture();
      expect(fixture.slideCount).toBe(105);
      expect(fixture.lateDeckTopics?.minSlide).toBe(85);

      const result = evaluateCompilerGoldenDeck(fixture, fixture.goldNote);
      expect(result.passed).toBe(true);
      expect(result.lateDeckCoverageRate).toBe(1.0);
      expect(result.uncoveredLateDeckItems).toHaveLength(0);
    });

    it("fails late-deck coverage when late sections (slides >= 85) are truncated from the 105-slide deck", () => {
      const fixture = create105SlideLateDeckFixture();
      const truncatedNote = cloneNote(fixture.goldNote);

      // Truncate section B which contains late-deck slides 85-105
      truncatedNote.sections = truncatedNote.sections.filter(
        (s) => !s.sourceSlides?.some((num) => num >= 85),
      );

      const result = evaluateCompilerGoldenDeck(fixture, truncatedNote);
      expect(result.passed).toBe(false);
      expect(result.lateDeckCoverageRate).toBeLessThan(1.0);
      expect(result.uncoveredLateDeckItems.length).toBeGreaterThan(0);
      expect(
        result.uncoveredLateDeckItems.some((item) =>
          item.includes("Late-deck slides"),
        ),
      ).toBe(true);
      expect(
        result.violations.some((v) => v.includes("Late-deck coverage rate")),
      ).toBe(true);
    });
  });

  describe("Metric 5: Paraphrase Acceptance Rate (=== 1.0)", () => {
    it("reports 100% paraphrase acceptance across all 8 golden decks", () => {
      for (const deck of GOLDEN_DECKS) {
        const result = evaluateCompilerGoldenDeck(deck, deck.goldNote);
        expect(result.paraphraseAcceptanceRate).toBe(1.0);
        expect(result.failedParaphraseClaims).toHaveLength(0);
      }
    });

    it("correctly validates faithful_paraphrase, supported_combination, and example_abstraction", () => {
      const deck1 = DECK_1_STOCK_VALUATION;
      expect(deck1.paraphraseCases).toBeDefined();
      expect(deck1.paraphraseCases!.length).toBeGreaterThanOrEqual(4);

      const modes = deck1.paraphraseCases!.map((c) => c.supportMode);
      expect(modes).toContain("faithful_paraphrase");
      expect(modes).toContain("supported_combination");
      expect(modes).toContain("example_abstraction");

      const result = evaluateCompilerGoldenDeck(deck1, deck1.goldNote);
      expect(result.paraphraseAcceptanceRate).toBe(1.0);
    });

    it("rejects genuinely ungrounded claims without false-positive acceptance", () => {
      const deck2 = DECK_2_RISK_AND_RETURN;
      const ungroundedCase = deck2.paraphraseCases?.find(
        (c) => c.expectedSupported === false,
      );
      expect(ungroundedCase).toBeDefined();
      expect(ungroundedCase!.claim).toContain("cryptocurrency arbitrage");

      const result = evaluateCompilerGoldenDeck(deck2, deck2.goldNote);
      expect(result.paraphraseAcceptanceRate).toBe(1.0);
      expect(result.failedParaphraseClaims).toHaveLength(0);
    });
  });

  describe("Metrics 6–10: Equivalence, Condition Preservation, Strict KaTeX, Zero Unsupported, Publication Hygiene", () => {
    it("Metric 6 (Equivalence): detects mathematical contradictions and sign flips", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Flip sign in Gordon Growth formula denominator to (R + g)
      const secC = compromisedNote.sections.find((s) => s.letter === "C");
      const gordonSub = secC?.subSections?.find((sub) =>
        sub.heading.includes("Constant Growth"),
      );
      expect(gordonSub).toBeDefined();
      if (gordonSub) {
        const f4 = gordonSub.formulas.find((f) => f.formulaRefs?.includes("F4"));
        if (f4) {
          f4.latex = "P_0 = \\frac{D_1}{R + g}";
          f4.status = "contradicted";
        }
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );
      expect(result.passed).toBe(false);
      expect(result.placedFormulaEquivalenceRate).toBeLessThan(1.0);
      expect(result.inequivalentFormulas.length).toBeGreaterThan(0);
    });

    it("Metric 7 (Condition Preservation): detects boundary condition inequality inversion (R < g vs R > g)", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Invert boundary condition in Section C bullet from R > g to R < g
      const secC = compromisedNote.sections.find((s) => s.letter === "C");
      const gordonSub = secC?.subSections?.find((sub) =>
        sub.heading.includes("Constant Growth"),
      );
      expect(gordonSub).toBeDefined();
      if (gordonSub && gordonSub.groundedBullets) {
        gordonSub.groundedBullets = gordonSub.groundedBullets.map((b) => ({
          ...b,
          text: "Crucial boundary condition: required return R must be strictly less than growth rate g (R < g)",
        }));
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );
      expect(result.passed).toBe(false);
      expect(result.conditionPreservationRate).toBeLessThan(1.0);
      expect(result.invertedConditions.length).toBeGreaterThan(0);
    });

    it("Metric 8 (Strict KaTeX Compile): detects invalid KaTeX syntax, raw arrows, and unbalanced braces", () => {
      const compromisedNote = cloneNote(DECK_1_STOCK_VALUATION.goldNote);
      // Inject unbalanced brace into formula in section B
      const secB = compromisedNote.sections.find((s) => s.letter === "B");
      expect(secB).toBeDefined();
      if (secB && secB.formulas.length > 0) {
        secB.formulas[0].latex = "P_0 = \\frac{D_1 + P_1}{1 + R"; // Missing closing brace
      }

      const result = evaluateCompilerGoldenDeck(
        DECK_1_STOCK_VALUATION,
        compromisedNote,
      );
      expect(result.passed).toBe(false);
      expect(result.strictKatexCompileRate).toBeLessThan(1.0);
      expect(result.katexCompileFailures.length).toBeGreaterThan(0);
      expect(
        result.katexCompileFailures.some((f) => f.includes("Unbalanced curly braces")),
      ).toBe(true);
    });

    it("Metric 9 (Unsupported Claims): flags hallucinated bullets with missing or non-matching evidence", () => {
      const compromisedNote = cloneNote(DECK_3_WACC.goldNote);
      // Add a hallucinated bullet to section A
      compromisedNote.sections[0].groundedBullets?.push({
        text: "WACC is completely irrelevant when investing in high-risk cryptocurrencies",
        slide: 1,
        evidence: "WACC is completely irrelevant when investing in high-risk cryptocurrencies",
        status: "verified",
        verdict: "SUPPORTED",
      });

      const result = evaluateCompilerGoldenDeck(DECK_3_WACC, compromisedNote);
      expect(result.passed).toBe(false);
      expect(result.unsupportedClaimCount).toBeGreaterThan(0);
      expect(
        result.violations.some((v) => v.includes("Unsupported claim count")),
      ).toBe(true);
    });

    it("Metric 10 (Publication Hygiene): confirms toPublishedHandout strips debug fields and contains zero noise", () => {
      for (const deck of GOLDEN_DECKS) {
        const result = evaluateCompilerGoldenDeck(deck, deck.goldNote);
        expect(result.publicationHygienePassed).toBe(true);
      }
    });
  });
});

