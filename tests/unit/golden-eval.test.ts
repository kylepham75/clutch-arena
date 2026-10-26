import { describe, it, expect } from "vitest";
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
} from "@/lib/notes/eval/golden-decks";
import {
  evaluateGoldenDeck,
  runGoldenEvalSuite,
  CI_THRESHOLDS,
} from "@/lib/notes/eval/golden-eval";

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
