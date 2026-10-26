import { describe, expect, it } from "vitest";
import {
  checkFormulaEquivalence,
  evaluateAst,
  evaluateLatexExpression,
  normalizeLatexExpression,
  parseLatexEquation,
  parseLatexToAst,
  verifyNoteFormulasEquivalence,
} from "@/lib/notes/numeric-equivalence";
import type { FormulaLedgerEntry, NoteSection } from "@/lib/schemas/notes";

describe("Stage 4.2 Numeric-Equivalence Engine", () => {
  describe("LaTeX Normalization and AST Parsing", () => {
    it("strips visual wrappers and normalizes fractions", () => {
      const norm = normalizeLatexExpression(
        "\\displaystyle P_0 = \\frac{D_1}{R - g}"
      );
      expect(norm).toContain("((d_1) / (r - g))");
    });

    it("handles nested fractions properly", () => {
      const norm = normalizeLatexExpression("\\frac{1}{1 + \\frac{D_1}{P_0}}");
      expect(norm).toContain("((1) / (1 + ((d_1) / (p_0))))");
    });

    it("expands square root correctly", () => {
      const norm = normalizeLatexExpression("\\sqrt{s^2}");
      expect(norm).toContain("sqrt((s)^2)");

      const degreeNorm = normalizeLatexExpression("\\sqrt[3]{1 + R}");
      expect(degreeNorm).toContain("((1 + r) ^ (1 / (3)))");
    });

    it("parses text, mathrm, and greek commands to canonical variables", () => {
      const ast = parseLatexToAst(
        "\\text{ROE} = \\frac{\\text{Net Income}}{\\text{Total Equity}}"
      );
      expect(ast.type).toBe("equation");
      if (ast.type === "equation") {
        expect(ast.lhs).toEqual({ type: "variable", name: "var_roe" });
      }
    });

    it("treats \\sigma^2 and s^2 consistently as (\\sigma)^2 and (s)^2", () => {
      const ast = parseLatexToAst("s = \\sqrt{s^2}");
      expect(ast.type).toBe("equation");
      if (ast.type === "equation") {
        expect(ast.lhs).toEqual({ type: "variable", name: "s" });
        expect(ast.rhs.type).toBe("function");
        if (ast.rhs.type === "function") {
          expect(ast.rhs.name).toBe("sqrt");
          expect(ast.rhs.args[0]).toEqual({
            type: "binary",
            operator: "^",
            left: { type: "variable", name: "s" },
            right: { type: "number", value: 2 },
          });
        }
      }
    });

    it("inserts implicit multiplication for adjacent factors", () => {
      const ast1 = parseLatexToAst("2\\sigma");
      expect(ast1).toEqual({
        type: "binary",
        operator: "*",
        left: { type: "number", value: 2 },
        right: { type: "variable", name: "sigma" },
      });

      const ast2 = parseLatexToAst("P_0(R - g)");
      expect(ast2).toEqual({
        type: "binary",
        operator: "*",
        left: { type: "variable", name: "p_0" },
        right: {
          type: "binary",
          operator: "-",
          left: { type: "variable", name: "r" },
          right: { type: "variable", name: "g" },
        },
      });

      const ast3 = parseLatexToAst("(1 - T_C)R_D");
      expect(ast3).toEqual({
        type: "binary",
        operator: "*",
        left: {
          type: "binary",
          operator: "-",
          left: { type: "number", value: 1 },
          right: { type: "variable", name: "t_c" },
        },
        right: { type: "variable", name: "r_d" },
      });
    });

    it("expands finite summation over deterministic horizon", () => {
      const norm = normalizeLatexExpression("\\sum_{t=1}^N \\frac{CF_t}{(1+R)^t}");
      expect(norm).toContain("cf_1");
      expect(norm).toContain("cf_2");
      expect(norm).toContain("cf_3");
    });
  });

  describe("Safe Expression Evaluator", () => {
    it("evaluates basic arithmetic and variables", () => {
      const val = evaluateLatexExpression("P_0 + 2 * D_1", {
        p_0: 10,
        d_1: 2.5,
      });
      expect(val).toBe(15);
    });

    it("evaluates fractions and powers", () => {
      const val = evaluateLatexExpression("\\frac{D_1}{(R - g)^2}", {
        d_1: 4,
        r: 0.12,
        g: 0.02,
      });
      expect(val).toBeCloseTo(4 / Math.pow(0.10, 2), 5);
    });

    it("returns null on division by zero", () => {
      const val = evaluateLatexExpression("\\frac{D_1}{R - g}", {
        d_1: 5,
        r: 0.05,
        g: 0.05,
      });
      expect(val).toBeNull();
    });

    it("returns null on negative square root", () => {
      const val = evaluateLatexExpression("\\sqrt{-4}", {});
      expect(val).toBeNull();
    });
  });

  describe("Direct Formatting Variations Equivalence", () => {
    it("verifies \\frac{D_1}{R - g} vs D_1 / (R - g)", () => {
      const source = "P_0 = \\frac{D_1}{R - g}";
      const candidate = "P_0 = D_1 / (R - g)";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(false);
      expect(res.contradicts).toBe(false);
      expect(res.evaluable).toBe(true);
      expect(res.matchedSeeds).toBeGreaterThanOrEqual(6);
    });

    it("verifies \\left(\\frac{E}{V}\\right) R_E vs (E/V) \\times R_E", () => {
      const source = "WACC = \\left(\\frac{E}{V}\\right) R_E + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)";
      const candidate = "WACC = (E/V) \\times R_E + (D/V) \\times R_D \\times (1 - T_C)";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(false);
      expect(res.contradicts).toBe(false);
    });

    it("verifies outer dollar signs and spacing differences via fast path", () => {
      const source = "$$ P_0 = \\frac{D_1}{R - g} $$";
      const candidate = "P_0 = \\frac{D_{1}}{R - g}";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.contradicts).toBe(false);
    });
  });

  describe("Algebraic Rearrangements / Derived Forms", () => {
    const gordonSource = "P_0 = \\frac{D_1}{R - g}";

    it("verifies solving for R: R = \\frac{D_1}{P_0} + g", () => {
      const candidate = "R = \\frac{D_1}{P_0} + g";
      const res = checkFormulaEquivalence(gordonSource, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(true);
      expect(res.contradicts).toBe(false);
      expect(res.matchedSeeds).toBeGreaterThanOrEqual(6);
    });

    it("verifies solving for g: g = R - \\frac{D_1}{P_0}", () => {
      const candidate = "g = R - \\frac{D_1}{P_0}";
      const res = checkFormulaEquivalence(gordonSource, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(true);
      expect(res.contradicts).toBe(false);
    });

    it("verifies solving for D1: D_1 = P_0 (R - g)", () => {
      const candidate = "D_1 = P_0 (R - g)";
      const res = checkFormulaEquivalence(gordonSource, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(true);
      expect(res.contradicts).toBe(false);
    });

    it("verifies DuPont / ROE rearrangement: Net Income = ROE * Total Equity", () => {
      const source = "\\text{ROE} = \\frac{\\text{Net Income}}{\\text{Total Equity}}";
      const candidate = "\\text{Net Income} = \\text{ROE} \\times \\text{Total Equity}";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(true);
      expect(res.contradicts).toBe(false);
    });

    it("verifies CAPM rearrangement solving for beta", () => {
      const source = "R_E = R_f + \\beta_E (R_M - R_f)";
      const candidate = "\\beta_E = \\frac{R_E - R_f}{R_M - R_f}";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(true);
      expect(res.contradicts).toBe(false);
    });

    it("verifies sample standard deviation derived from sample variance: s = \\sqrt{s^2}", () => {
      const source = "s^2 = \\frac{1}{T-1}\\sum (R_t - \\bar{R})^2";
      const candidate = "s = \\sqrt{s^2}";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(true);
      expect(res.contradicts).toBe(false);
    });

    it("verifies direct standard deviation formula with square root of variance summand", () => {
      const source = "s^2 = \\frac{1}{T-1}\\sum (R_t - \\bar{R})^2";
      const candidate = "s = \\sqrt{\\frac{1}{T-1}\\sum (R_t - \\bar{R})^2}";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(true);
      expect(res.isRearrangement).toBe(true);
      expect(res.contradicts).toBe(false);
    });
  });

  describe("Contradiction Detection (contradicts: true)", () => {
    const gordonSource = "P_0 = \\frac{D_1}{R - g}";

    it("flags sign flip in denominator: P_0 = \\frac{D_1}{R + g}", () => {
      const candidate = "P_0 = \\frac{D_1}{R + g}";
      const res = checkFormulaEquivalence(gordonSource, candidate);

      expect(res.equivalent).toBe(false);
      expect(res.contradicts).toBe(true);
      expect(res.matchedSeeds).toBe(0);
      expect(res.reason).toMatch(/contradicts source equation/i);
    });

    it("flags sign flip in rearranged formula: R = \\frac{D_1}{P_0} - g", () => {
      const candidate = "R = \\frac{D_1}{P_0} - g";
      const res = checkFormulaEquivalence(gordonSource, candidate);

      expect(res.equivalent).toBe(false);
      expect(res.contradicts).toBe(true);
      expect(res.matchedSeeds).toBe(0);
      expect(res.reason).toMatch(/contradicts source equation/i);
    });

    it("flags denominator error in mean return: T-1 instead of T", () => {
      const source = "\\bar{R} = \\frac{1}{T}\\sum R_t";
      const candidate = "\\bar{R} = \\frac{1}{T-1}\\sum R_t";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(false);
      expect(res.contradicts).toBe(true);
      expect(res.matchedSeeds).toBe(0);
    });

    it("flags tax shield misplacement in WACC", () => {
      const source = "WACC = \\left(\\frac{E}{V}\\right) R_E + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)";
      const candidate = "WACC = \\left(\\frac{E}{V}\\right) R_E (1 - T_C) + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)";
      const res = checkFormulaEquivalence(source, candidate);

      expect(res.equivalent).toBe(false);
      expect(res.contradicts).toBe(true);
      expect(res.matchedSeeds).toBe(0);
    });

    it("flags inverted fraction: P_0 = \\frac{R - g}{D_1}", () => {
      const candidate = "P_0 = \\frac{R - g}{D_1}";
      const res = checkFormulaEquivalence(gordonSource, candidate);

      expect(res.equivalent).toBe(false);
      expect(res.contradicts).toBe(true);
      expect(res.matchedSeeds).toBe(0);
    });

    it("does NOT flag contradiction when variables are completely disjoint", () => {
      const candidate = "\\text{ROE} = \\frac{\\text{Net Income}}{\\text{Total Equity}}";
      const res = checkFormulaEquivalence(gordonSource, candidate);

      expect(res.equivalent).toBe(false);
      expect(res.contradicts).toBe(false);
      expect(res.reason).toMatch(/disjoint|non-overlapping/i);
    });
  });

  describe("verifyNoteFormulasEquivalence across Note Sections", () => {
    const mockLedger: FormulaLedgerEntry[] = [
      {
        id: "F1",
        slide: 3,
        raw: "P0 = D1 / (R - g)",
        latex: "P_0 = \\frac{D_1}{R - g}",
        origin: "omml",
        variables: [],
      },
      {
        id: "F2",
        slide: 5,
        raw: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
        latex: "WACC = \\left(\\frac{E}{V}\\right) R_E + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)",
        origin: "omml",
        variables: [],
      },
    ];

    it("accurately categorizes direct, derived, contradicted, and unverified formulas", () => {
      const mockSections: NoteSection[] = [
        {
          id: "sec-1",
          letter: "A",
          titleVi: "MÔ HÌNH CHIẾT KHẤU DÒNG CỔ TỨC",
          titleEn: "Dividend Discount Model",
          overview: "Valuation models",
          bulletPoints: [],
          formulas: [
            // Direct formula referencing F1
            {
              name: "",
              latex: "P_0 = \\frac{D_1}{R - g}",
              formulaRefs: ["F1"],
              variables: [],
            },
            // Derived formula referencing F1
            {
              name: "",
              latex: "R = \\frac{D_1}{P_0} + g",
              derivedFrom: ["F1"],
              variables: [],
            },
            // Contradicted formula referencing F1 (sign flip)
            {
              name: "",
              latex: "P_0 = \\frac{D_1}{R + g}",
              formulaRefs: ["F1"],
              variables: [],
            },
          ],
          subSections: [
            {
              heading: "CASE 2: Cost of Capital",
              bulletPoints: [],
              formulas: [
                // Unreferenced formula with no parent
                {
                  name: "",
                  latex: "\\text{ArbitraryFormula} = X + Y",
                  variables: [],
                },
              ],
            },
          ],
        },
      ];

      const report = verifyNoteFormulasEquivalence(mockSections, mockLedger);

      expect(report.directVerifiedCount).toBe(1);
      expect(report.derivedVerifiedCount).toBe(1);
      expect(report.contradictedFormulas).toBe(1);
      expect(report.unverifiedFormulas).toBe(1);
      expect(report.allPassed).toBe(false);

      expect(mockSections[0].formulas[0].status).toBe("verified");
      expect(mockSections[0].formulas[0].numericEquivalencePassed).toBe(true);

      expect(mockSections[0].formulas[1].status).toBe("derived");
      expect(mockSections[0].formulas[1].numericEquivalencePassed).toBe(true);

      expect(mockSections[0].formulas[2].status).toBe("contradicted");
      expect(mockSections[0].formulas[2].numericEquivalencePassed).toBe(false);
    });

    it("passes all when every formula is verified or validly derived", () => {
      const validSections: NoteSection[] = [
        {
          id: "sec-valid",
          letter: "A",
          titleVi: "VALUATION",
          titleEn: "Valuation",
          overview: "Overview",
          bulletPoints: [],
          formulas: [
            {
              name: "",
              latex: "P_0 = D_1 / (R - g)",
              formulaRefs: ["F1"],
              variables: [],
            },
            {
              name: "",
              latex: "R = \\frac{D_1}{P_0} + g",
              derivedFrom: ["F1"],
              variables: [],
            },
          ],
          subSections: [],
        },
      ];

      const report = verifyNoteFormulasEquivalence(validSections, mockLedger);
      expect(report.allPassed).toBe(true);
      expect(report.contradictedFormulas).toBe(0);
      expect(report.unverifiedFormulas).toBe(0);
      expect(report.directVerifiedCount).toBe(1);
      expect(report.derivedVerifiedCount).toBe(1);
    });
  });
});
