import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizePdfMathSymbols } from "@/lib/notes/pdf-symbol-normalizer";
import { sortAndGroupPdfTextItems } from "@/lib/notes/client-extract-slides";
import {
  cleanLatexEquation,
  convertUnicodeMath,
  extractTextFormulas,
  buildFormulaInventory,
  mergeFormulaLedger,
  isNontrivialFormula,
  isDanglingOrEmptySideEquation,
  isNumericPluginOrScalarAssignment,
  isPureProsePhrase,
  normalizeInventoryFormulaKey,
} from "@/lib/notes/formula-inventory";
import {
  verifyFormulaCoverage,
  verifyFormulaSymbolSet,
  extractFormulaSymbols,
  OMITTED_BY_RULE_REASON_REGEX,
} from "@/lib/notes/deterministic-verifiers";
import {
  repairCorruptedLatex,
  wrapBareEnglishInLatex,
  cleanVietnameseSigmaTypos,
  formatAccountingFormula,
  renderKatexSafe,
} from "@/lib/math/latex";
import {
  injectLedgerFormulasById,
  applyHallucinationShield,
} from "@/lib/ai/generate-notes";
import {
  runVerificationGate,
  applyMarkPolicyAndGate,
  isCleanValidLatexFormula,
  buildTargetedRepairPrompt,
  executeVerificationPipeline,
  type VerificationPipelineReport,
} from "@/lib/notes/verification-gate";
import {
  generateClutchNotePdfHtml,
  renderFormulaStatusBadge,
  renderPdfFormula,
  cleanLatexForFallback,
} from "@/lib/notes/export-pdf";
import type {
  ClutchNote,
  NoteSection,
  NoteFormula,
  FormulaLedgerEntry,
  GroundedBullet,
  SynthesisOmittedFormula,
} from "@/lib/schemas/notes";
import type { SourceBlock } from "@/lib/schemas/ingestion";

// Type-safe factory helpers ensuring all required schema properties are complete
function createTestFormula(
  overrides: Partial<NoteFormula> & { latex: string },
): NoteFormula {
  return {
    name: overrides.name ?? "",
    leadText: overrides.leadText,
    latex: overrides.latex,
    description: overrides.description,
    variables: overrides.variables ?? [],
    formulaRefs: overrides.formulaRefs,
    derivedFrom: overrides.derivedFrom,
    slide: overrides.slide,
    origin: overrides.origin,
    confidence: overrides.confidence,
    status: overrides.status,
    reviewReason: overrides.reviewReason,
    numericEquivalencePassed: overrides.numericEquivalencePassed,
    divergenceNotices: overrides.divergenceNotices,
  };
}

function createTestSection(
  overrides: Partial<NoteSection> & {
    id: string;
    letter: string;
    titleVi: string;
  },
): NoteSection {
  return {
    id: overrides.id,
    letter: overrides.letter,
    titleVi: overrides.titleVi,
    titleEn: overrides.titleEn ?? "",
    coreStatement: overrides.coreStatement,
    overview: overrides.overview ?? "",
    bulletPoints: overrides.bulletPoints ?? [],
    groundedBullets: overrides.groundedBullets,
    formulas: overrides.formulas ?? [],
    subSections: overrides.subSections ?? [],
    keyTakeaways: overrides.keyTakeaways ?? null,
    sourceSlides: overrides.sourceSlides ?? [],
  };
}

describe("Chapter 10 Regression Suite — Capital Markets & Pricing of Risk (105 Slides)", () => {
  // =========================================================================
  // CASE 1: Out-of-Order PDF Stream & PUA Symbol Glyph Reconstruction
  // =========================================================================
  describe("1. Out-of-order PDF stream and PUA Symbol glyph reconstruction", () => {
    it("maps all Chapter 10 PUA Symbol glyphs and Windows control codepoints to standard Unicode", () => {
      // PUA symbols from MathType / PowerPoint in Chapter 10:
      // \uF0B4 (×), \uF0B8 (÷), \uF0E5 (∑), \uF0D6 (√), \uF0B1 (±), \uF05B ([), \uF05D (]), \uF02D (−)
      // Greek PUA symbols: \uF073 (σ), \uF062 (β), \uF044 (Δ), \uF053 (Σ)
      // Arrows: \uF0E0 (→), \uF0E1 (↑), \uF0E2 (↓), \uF0DC (⇒)
      const rawPuaStream =
        "R_E = r_f + \uF062_i \uF0B4 \uF05B E(R_M) \uF02D r_f \uF05D \uF0B1 \uF073_i \uF0B8 \uF0D6 T \uF0E5 R_t \uF0E0 \uF0DC";

      const normalized = normalizePdfMathSymbols(rawPuaStream);

      expect(normalized).toContain("×");
      expect(normalized).toContain("÷");
      expect(normalized).toContain("∑");
      expect(normalized).toContain("√");
      expect(normalized).toContain("±");
      expect(normalized).toContain("[");
      expect(normalized).toContain("]");
      expect(normalized).toContain("−");
      expect(normalized).toContain("β");
      expect(normalized).toContain("σ");
      expect(normalized).toContain("→");
      expect(normalized).toContain("⇒");

      // Verify no remaining PUA codepoints (U+E000..U+F8FF) or replacement chars (U+FFFD)
      expect(/[\uE000-\uF8FF\uFFFD]/.test(normalized)).toBe(false);
    });

    it("sanitizes unmapped PUA codepoints and control characters while preserving valid line breaks", () => {
      const dirtyText = "Slide 10\r\nHeading\t\uE123\uF888\uFFFDContent\x00\x08 with\nLine 2";
      const cleaned = normalizePdfMathSymbols(dirtyText);

      expect(cleaned).not.toContain("\r");
      expect(cleaned).not.toContain("\t");
      expect(cleaned).not.toContain("\uE123");
      expect(cleaned).not.toContain("\uF888");
      expect(cleaned).not.toContain("\uFFFD");
      expect(cleaned).not.toContain("\x00");
      expect(cleaned).not.toContain("\x08");
      expect(cleaned).toContain("Slide 10\nHeading Content with\nLine 2");
    });

    it("reconstructs out-of-order PDF stream items with stacked fractions and baseline-shifted inline subscripts", () => {
      // Simulate raw PDF items from Slide 24 / Slide 54 with:
      // 1. Scrambled stream order
      // 2. Baseline shift (dy between 2pt and 6pt) on subscripts: R_{t+1}, Div_{t+1}, P_{t+1}, \sigma^2, R_E
      // 3. PUA multiplication glyph \uF0B4 and brackets \uF05B, \uF05D
      const scrambledPdfItems = [
        // Subscript 't+1' lower baseline (y=296, fontSize=9) appearing earlier in stream
        {
          str: "t+1",
          transform: [9, 0, 0, 9, 32, 296],
          width: 14,
          height: 9,
          hasEOL: false,
        },
        // Anchor 'R' (y=300, fontSize=14) appearing later
        {
          str: "R",
          transform: [14, 0, 0, 14, 20, 300],
          width: 11,
          height: 14,
          hasEOL: false,
        },
        // Equals sign '=' (y=300, fontSize=14)
        {
          str: "=",
          transform: [14, 0, 0, 14, 52, 300],
          width: 9,
          height: 14,
          hasEOL: false,
        },
        // Fraction numerator 'Div' (y=300, fontSize=12)
        {
          str: "Div",
          transform: [12, 0, 0, 12, 68, 300],
          width: 20,
          height: 12,
          hasEOL: false,
        },
        // Numerator subscript 't+1' (y=297, fontSize=8)
        {
          str: "t+1",
          transform: [8, 0, 0, 8, 89, 297],
          width: 12,
          height: 8,
          hasEOL: false,
        },
        // Plus '+' (y=300, fontSize=12)
        {
          str: "+",
          transform: [12, 0, 0, 12, 106, 300],
          width: 9,
          height: 12,
          hasEOL: false,
        },
        // 'P' (y=300, fontSize=12)
        {
          str: "P",
          transform: [12, 0, 0, 12, 118, 300],
          width: 9,
          height: 12,
          hasEOL: false,
        },
        // Subscript 't+1' on P (y=297, fontSize=8)
        {
          str: "t+1",
          transform: [8, 0, 0, 8, 128, 297],
          width: 12,
          height: 8,
          hasEOL: false,
        },
        // PUA minus \uF02D (y=300, fontSize=12)
        {
          str: "\uF02D",
          transform: [12, 0, 0, 12, 144, 300],
          width: 8,
          height: 12,
          hasEOL: false,
        },
        // 'P' (y=300, fontSize=12)
        {
          str: "P",
          transform: [12, 0, 0, 12, 155, 300],
          width: 9,
          height: 12,
          hasEOL: false,
        },
        // Subscript 't' on P (y=297, fontSize=8)
        {
          str: "t",
          transform: [8, 0, 0, 8, 165, 297],
          width: 6,
          height: 8,
          hasEOL: false,
        },
        // Second line: Slide 54 CAPM formula with PUA multiplication and brackets
        // Heading line at y=350 (top-most in visual space)
        {
          str: "CAPM Model:",
          transform: [16, 0, 0, 16, 20, 350],
          width: 90,
          height: 16,
          hasEOL: true,
        },
        // Lower line at y=250: E[R_i] = r_f + \beta_i \times [E[R_M] - r_f]
        {
          str: "E[R_i]",
          transform: [12, 0, 0, 12, 20, 250],
          width: 35,
          height: 12,
          hasEOL: false,
        },
        {
          str: "=",
          transform: [12, 0, 0, 12, 60, 250],
          width: 8,
          height: 12,
          hasEOL: false,
        },
        {
          str: "r_f",
          transform: [12, 0, 0, 12, 72, 250],
          width: 16,
          height: 12,
          hasEOL: false,
        },
        {
          str: "+",
          transform: [12, 0, 0, 12, 92, 250],
          width: 8,
          height: 12,
          hasEOL: false,
        },
        {
          str: "\uF062_i", // PUA beta
          transform: [12, 0, 0, 12, 104, 250],
          width: 18,
          height: 12,
          hasEOL: false,
        },
        {
          str: "\uF0B4", // PUA \times
          transform: [12, 0, 0, 12, 126, 250],
          width: 10,
          height: 12,
          hasEOL: false,
        },
        {
          str: "\uF05B", // PUA [
          transform: [12, 0, 0, 12, 140, 250],
          width: 6,
          height: 12,
          hasEOL: false,
        },
        {
          str: "E[R_M] − r_f",
          transform: [12, 0, 0, 12, 148, 250],
          width: 70,
          height: 12,
          hasEOL: false,
        },
        {
          str: "\uF05D", // PUA ]
          transform: [12, 0, 0, 12, 222, 250],
          width: 6,
          height: 12,
          hasEOL: false,
        },
      ];

      const result = sortAndGroupPdfTextItems(scrambledPdfItems);

      // Verify line ordering:
      // Line 1: y=350 -> "CAPM Model:"
      // Line 2: y=300/296 -> clustered "R t+1 = Div t+1 + P t+1 − P t"
      // Line 3: y=250 -> "E[R_i]=r_f+β_i×[E[R_M] − r_f]"
      const lines = result.split("\n");
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe("CAPM Model:");
      expect(lines[1]).toContain("R");
      expect(lines[1]).toContain("t+1");
      expect(lines[1]).toContain("Div");
      expect(lines[1]).toContain("=");
      expect(lines[1]).toContain("−"); // PUA \uF02D mapped to standard minus

      expect(lines[2]).toContain("E[R_i]");
      expect(lines[2]).toContain("r_f");
      expect(lines[2]).toContain("β_i");
      expect(lines[2]).toContain("×");
      expect(lines[2]).toContain("E[R_M] − r_f");
    });
  });

  // =========================================================================
  // CASE 2: Formula Inventory Filtering & Symbolic Equation Retention
  // =========================================================================
  describe("2. Formula inventory filtering and symbolic equation retention", () => {
    it("filters out dangling and empty-side relation fragments ('T =', 'S ==', '= 0.12')", () => {
      expect(isDanglingOrEmptySideEquation("T =")).toBe(true);
      expect(isDanglingOrEmptySideEquation("S ==")).toBe(true);
      expect(isDanglingOrEmptySideEquation("= 0.12")).toBe(true);
      expect(isDanglingOrEmptySideEquation("= 0.15")).toBe(true);
      expect(isDanglingOrEmptySideEquation("() =")).toBe(true);
      expect(isDanglingOrEmptySideEquation("= ()")).toBe(true);
      expect(isDanglingOrEmptySideEquation("=")).toBe(true);
      expect(isDanglingOrEmptySideEquation("==")).toBe(true);
      expect(isDanglingOrEmptySideEquation("===")).toBe(true);
      expect(isDanglingOrEmptySideEquation("R =")).toBe(true);

      // Valid equations must NOT be marked dangling
      expect(isDanglingOrEmptySideEquation("E[R_i] = r_f + \\beta_i (E[R_M] - r_f)")).toBe(false);
      expect(isDanglingOrEmptySideEquation("P_0 = \\frac{D_1}{R - g}")).toBe(false);
    });

    it("filters out multi-word prose equations and slide labels (F22, F26, F27)", () => {
      // Descriptive callout from Slide 38: (Average of Independent, Identical Risks) =
      expect(isPureProsePhrase("Average of Independent, Identical Risks")).toBe(true);
      expect(isPureProsePhrase("This is a summary of the model relationship")).toBe(true);
      expect(isPureProsePhrase("Definition of the capital asset pricing framework")).toBe(true);

      // Financial accounting metrics should NOT be flagged as prose
      expect(isPureProsePhrase("Net Working Capital")).toBe(false);
      expect(isPureProsePhrase("Current Assets")).toBe(false);
      expect(isPureProsePhrase("Current Liabilities")).toBe(false);

      // Formula with prose on one side is rejected as non-trivial formula
      const proseFormula = "(Average of Independent, Identical Risks) = Variance of portfolio";
      expect(isNontrivialFormula(proseFormula)).toBe(false);
    });

    it("filters out Chapter 10 prose equations (F22, F26, F27) while retaining symbolic CAPM", () => {
      const slideWithProse = `
Slide 38:
F22: (Average of Independent, Identical Risks) =
F26: Market Portfolio = Portfolio of all traded assets in the economy
F27: Beta = Sensitivity of an asset to market risk
CAPM: E[R_i] = r_f + \\beta_i (E[R_{Mkt}] - r_f)
      `;

      const formulas = extractTextFormulas(slideWithProse);
      const latices = formulas.map((f) => f.latex);

      expect(latices.some((l) => l.includes("E[R_i]") && l.includes("\\beta_i"))).toBe(true);
      expect(latices.some((l) => l.includes("Independent, Identical Risks"))).toBe(false);
      expect(latices.some((l) => l.includes("Portfolio of all traded assets"))).toBe(false);
      expect(latices.some((l) => l.includes("Sensitivity of an asset"))).toBe(false);
    });

    it("filters out multi-term numeric plug-in drills and trivial scalar assignments", () => {
      // Multi-term arithmetic calculations
      expect(isNumericPluginOrScalarAssignment("= (0.21 + 0.05 + 0.14) / 5")).toBe(true);
      expect(
        isNumericPluginOrScalarAssignment("\\bar{R} = (0.21 - 0.05 + 0.14) / 3 = 0.10"),
      ).toBe(true);
      expect(
        isNumericPluginOrScalarAssignment("0.26 = 0.04 + 1.1 \\times (0.24 - 0.04)"),
      ).toBe(true);
      expect(
        isNumericPluginOrScalarAssignment("\\sqrt{(0.12 - 0.08)^2 + (0.05 - 0.08)^2} = 0.05"),
      ).toBe(true);
      expect(isNumericPluginOrScalarAssignment("Var = (0.2056)^2 = 0.04227")).toBe(true);

      // Trivial scalar assignments
      expect(isNumericPluginOrScalarAssignment("P = 50")).toBe(true);
      expect(isNumericPluginOrScalarAssignment("P_0 = $50")).toBe(true);
      expect(isNumericPluginOrScalarAssignment("r = 10%")).toBe(true);
      expect(isNumericPluginOrScalarAssignment("n = 5")).toBe(true);
      expect(isNumericPluginOrScalarAssignment("g = 0.05")).toBe(true);
      expect(isNumericPluginOrScalarAssignment("t = 1")).toBe(true);

      // Symbolic general formulas are NOT numeric plug-ins
      expect(
        isNumericPluginOrScalarAssignment("E[R_i] = r_f + \\beta_i (E[R_{Mkt}] - r_f)"),
      ).toBe(false);
      expect(
        isNumericPluginOrScalarAssignment(
          "\\text{Var}(R_P) = w_1^2 \\sigma_1^2 + w_2^2 \\sigma_2^2 + 2 w_1 w_2 \\text{Cov}(R_1, R_2)",
        ),
      ).toBe(false);
      expect(
        isNumericPluginOrScalarAssignment(
          "R_{t+1} = \\frac{Div_{t+1} + P_{t+1} - P_t}{P_t}",
        ),
      ).toBe(false);
    });

    it("extractTextFormulas extracts valid symbolic Chapter 10 formulas and ignores drills", () => {
      const slideText = `
Slide 24: Realized Return
The total realized return is:
R_{t+1} = (Div_{t+1} + P_{t+1} - P_t) / P_t
Exercise drill: R = (0.21 + 0.05 + 0.14) / 3 = 0.1333
Notice that: T =
Slide 35: Portfolio Risk
Var(R_P) = w_1^2 \uF073_1^2 + w_2^2 \uF073_2^2 + 2 w_1 w_2 Cov(R_1, R_2)
Plugin: Var = (0.2056)^2 = 0.04227
Slide 54: The Capital Asset Pricing Model (CAPM)
E[R_i] = r_f + \uF062_i \uF0B4 (E[R_M] - r_f)
Calculate with beta: 0.26 = 0.04 + 1.1 \uF0B4 (0.24 - 0.04)
Callout: (Average of Independent, Identical Risks) =
      `;

      const extracted = extractTextFormulas(slideText);

      // Must extract: Realized return, Portfolio Variance, CAPM
      const latices = extracted.map((e) => e.latex);

      expect(latices.some((l) => l.includes("R_{t+1}") && l.includes("Div"))).toBe(true);
      expect(latices.some((l) => l.includes("Var(R_P)") || l.includes("w_1^2"))).toBe(true);
      expect(latices.some((l) => l.includes("E[R_i]") && l.includes("r_f"))).toBe(true);

      // Must NOT extract dangling, drills, or prose
      expect(latices.some((l) => l === "T =" || l.startsWith("T ="))).toBe(false);
      expect(latices.some((l) => l.includes("0.1333") || l.includes("0.2056"))).toBe(false);
      expect(latices.some((l) => l.includes("Average of Independent"))).toBe(false);
    });

    it("buildFormulaInventory and mergeFormulaLedger construct deduplicated inventory with sequential IDs", () => {
      const sources: SourceBlock[] = [
        {
          id: "slide-24",
          label: "Slide 24",
          text: "R_{t+1} = (Div_{t+1} + P_{t+1} - P_t) / P_t",
        },
        {
          id: "slide-35",
          label: "Slide 35",
          text: "\\text{Var}(R_P) = w_1^2 \\sigma_1^2 + w_2^2 \\sigma_2^2 + 2 w_1 w_2 \\text{Cov}(R_1, R_2)",
        },
        {
          id: "slide-54",
          label: "Slide 54",
          text: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)\nT = \n(Average of Independent, Identical Risks) =",
        },
      ];

      const inventory = buildFormulaInventory(sources);

      expect(inventory.length).toBe(3);
      expect(inventory[0].id).toBe("F1");
      expect(inventory[0].slide).toBe(24);
      expect(inventory[1].id).toBe("F2");
      expect(inventory[1].slide).toBe(35);
      expect(inventory[2].id).toBe("F3");
      expect(inventory[2].slide).toBe(54);

      // Merge into ledger
      const ledger = mergeFormulaLedger({
        deterministicInventory: inventory,
        sources,
      });

      expect(ledger.length).toBe(3);
      expect(ledger.map((l) => l.id)).toEqual(["F1", "F2", "F3"]);
    });
  });

  // =========================================================================
  // CASE 3: Unicode Vietnamese Omission Classification & Slide 24 Grounding
  // =========================================================================
  describe("3. Unicode Vietnamese omission classification and Slide 24 symbol grounding", () => {
    it("matches Vietnamese omission reason to OMITTED_BY_RULE_REASON_REGEX without false uncaptured errors", () => {
      const vietnameseReason = "Ví dụ số cụ thể của BFI, không phải công thức tổng quát";
      expect(OMITTED_BY_RULE_REASON_REGEX.test(vietnameseReason)).toBe(true);

      const additionalReasons = [
        "bài tập số thay vào công thức",
        "tính cụ thể cho ví dụ minh họa",
        "biến đổi trung gian từ công thức tổng quát",
        "rút gọn đại số không cần ghi nhớ",
        "duplicate of CAPM equation",
        "intermediate algebraic derivation",
      ];
      for (const r of additionalReasons) {
        expect(OMITTED_BY_RULE_REASON_REGEX.test(r)).toBe(true);
      }
    });

    it("verifyFormulaCoverage correctly classifies Vietnamese numerical examples as omitted_by_rule", () => {
      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 24,
          raw: "R_{t+1} = (Div_{t+1} + P_{t+1} - P_t) / P_t",
          latex: "R_{t+1} = \\frac{Div_{t+1} + P_{t+1} - P_t}{P_t}",
          origin: "text",
          variables: [],
        },
        {
          id: "F2",
          slide: 25,
          raw: "R_{BFI} = (0.21 + 0.05) / 2 = 0.13",
          latex: "R_{BFI} = \\frac{0.21 + 0.05}{2} = 0.13",
          origin: "text",
          variables: [],
          isExerciseOnly: true,
        },
        {
          id: "F3",
          slide: 54,
          raw: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
          latex: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
          origin: "text",
          variables: [],
        },
      ];

      // Note sections only place F1 and F3
      const sections: NoteSection[] = [
        createTestSection({
          id: "sec-a",
          letter: "A",
          titleVi: "A. LỢI SUẤT THỰC HIỆN",
          bulletPoints: ["Lợi suất thực hiện của cổ phiếu bao gồm cổ tức và chênh lệch giá"],
          formulas: [
            createTestFormula({
              name: "Realized Return",
              latex: "R_{t+1} = \\frac{Div_{t+1} + P_{t+1} - P_t}{P_t}",
              formulaRefs: ["F1"],
              slide: 24,
            }),
          ],
        }),
        createTestSection({
          id: "sec-b",
          letter: "B",
          titleVi: "B. MÔ HÌNH ĐỊNH GIÁ TÀI SẢN VỐN (CAPM)",
          bulletPoints: ["Lợi suất kỳ vọng tỷ lệ thuận với rủi ro hệ thống beta"],
          formulas: [
            createTestFormula({
              name: "CAPM",
              latex: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
              formulaRefs: ["F3"],
              slide: 54,
            }),
          ],
        }),
      ];

      // Omitted list with Vietnamese classification for F2
      const omitted: SynthesisOmittedFormula[] = [
        {
          formulaId: "F2",
          reason: "Ví dụ số cụ thể của BFI, không phải công thức tổng quát",
        },
      ];

      const coverage = verifyFormulaCoverage(sections, ledger, omitted);

      expect(coverage.placedIds).toEqual(["F1", "F3"]);
      expect(coverage.omittedByRuleIds).toEqual(["F2"]);
      expect(coverage.uncapturedErrorIds).toEqual([]); // 0 false uncaptured errors!
      expect(coverage.coverageRatio).toBe(2 / 3);
    });

    it("grounds Slide 24 split-subscript variables (R_{t+1}, Div_{t+1}, P_{t+1}, P_t) against extracted slide text", () => {
      // Slide 24 source block where subscripts might have spaces or split tokens
      const sources: SourceBlock[] = [
        {
          id: "slide-24",
          label: "Slide 24",
          text: `
Slide 24: Realized Return of a Stock
The total return R t+1 consists of the dividend yield Div t+1 / P t and the capital gain (P t+1 - P t) / P t.
In summary:
R t+1 = (Div t+1 + P t+1 - P t) / P t
Where Div t+1 is the dividend, P t is initial price, and P t+1 is end price.
          `,
        },
      ];

      const formula = createTestFormula({
        name: "Realized Return",
        latex: "R_{t+1} = \\frac{Div_{t+1} + P_{t+1} - P_t}{P_t}",
        slide: 24,
      });

      // Extract symbols from the LaTeX formula
      const extractedSymbols = extractFormulaSymbols(formula.latex);
      expect(extractedSymbols).toContain("R_t+1");
      expect(extractedSymbols).toContain("Div_t+1");
      expect(extractedSymbols).toContain("P_t+1");
      expect(extractedSymbols).toContain("P_t");

      // Verify symbol grounding against Slide 24
      const symbolResult = verifyFormulaSymbolSet(formula, sources);

      expect(symbolResult.passed).toBe(true);
      expect(symbolResult.ungroundedSymbols).toEqual([]);
    });
  });

  // =========================================================================
  // CASE 4: Ledger Injection, Mark Policy & Verification Gate Repair Loop
  // =========================================================================
  describe("4. Ledger injection, mark policy, and verification gate repair", () => {
    it("refuses corrupted ledger overrides ('T =', 'S ==') preserving clean synthesized formulas", () => {
      const corruptedLedger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 54,
          raw: "T =",
          latex: "T =",
          origin: "text",
          variables: [],
        },
        {
          id: "F2",
          slide: 55,
          raw: "S ==",
          latex: "S ==",
          origin: "text",
          variables: [],
        },
      ];

      const sections: NoteSection[] = [
        createTestSection({
          id: "sec-a",
          letter: "A",
          titleVi: "A. CAPM",
          bulletPoints: ["Mô hình CAPM giải thích tỷ suất sinh lời kỳ vọng"],
          formulas: [
            createTestFormula({
              name: "CAPM Equation",
              latex: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
              formulaRefs: ["F1"],
              slide: 54,
            }),
          ],
        }),
      ];

      const { sections: processed, placedIds } = injectLedgerFormulasById(
        sections,
        corruptedLedger,
      );

      // f.latex must NOT be overwritten with "T ="!
      expect(processed[0].formulas[0].latex).toBe("E[R_i] = r_f + \\beta_i (E[R_M] - r_f)");
      // Invalid entry F1 should not be marked placed
      expect(placedIds.has("F1")).toBe(false);
    });

    it("applyMarkPolicyAndGate refuses bogus Verified badges on invalid formulas", () => {
      const sources: SourceBlock[] = [
        {
          id: "slide-54",
          label: "Slide 54",
          text: "Slide 54: CAPM Model\nE[R_i] = r_f + beta_i (E[R_M] - r_f)",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 54,
          raw: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
          latex: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
          origin: "text",
          variables: [],
        },
      ];

      // Note with a corrupted formula "T ="
      const sectionsWithCorrupt: NoteSection[] = [
        createTestSection({
          id: "sec-a",
          letter: "A",
          titleVi: "A. CAPM",
          bulletPoints: ["CAPM overview"],
          formulas: [
            createTestFormula({
              name: "Bogus Formula",
              latex: "T =",
              formulaRefs: ["F1"],
              slide: 54,
            }),
          ],
        }),
      ];

      const pipelineReport: VerificationPipelineReport = {
        annotatedSections: sectionsWithCorrupt,
        divergenceNotices: [],
        deterministicReport: {
          passed: false,
          coverage: {
            totalLedgerCount: 1,
            placedIds: [],
            uncapturedIds: ["F1"],
            coverageRatio: 0,
            duplicateOmittedIds: [],
            omittedByRuleIds: [],
            uncapturedErrorIds: ["F1"],
          },
          evidence: {
            totalChecked: 1,
            matchedCount: 1,
            matchRatio: 1,
            failedBullets: [],
            failedTakeaways: [],
          },
          numbers: { passed: true, ungroundedNumbers: [], checkedNumbers: [] },
          symbols: {
            passed: true,
            totalFormulasChecked: 1,
            ungroundedSymbols: [],
            perFormulaResults: [
              {
                latex: "T =",
                slide: 54,
                passed: true,
                extractedSymbols: ["T"],
                ungroundedSymbols: [],
              },
            ],
          },
          summary: {
            coverageRatio: 0,
            evidenceMatchRatio: 1,
            numberGroundingPassed: true,
            symbolGroundingPassed: true,
            warnings: [],
          },
        },
        equivalenceReport: {
          formulaResults: [
            {
              formula: sectionsWithCorrupt[0].formulas[0],
              parentLedgerEntries: ledger,
              result: {
                equivalent: false,
                contradicts: false,
                reason: "Invalid equation",
                isRearrangement: false,
                evaluable: false,
                matchedSeeds: 0,
                totalSeeds: 0,
              },
            },
          ],
          contradictedFormulas: 0,
        } as unknown as VerificationPipelineReport["equivalenceReport"],
        claims: [],
      };

      const result = applyMarkPolicyAndGate({
        sections: sectionsWithCorrupt,
        sources,
        ledger,
        pipelineReport,
        repairAttempted: false,
      });

      const badFormula = result.sections[0].formulas[0];
      // Status must be needs_review, NEVER verified!
      expect(badFormula.status).toBe("needs_review");
      expect(badFormula.reviewReason).toContain("deterministic validity check");

      // Badge rendering must emit "Needs review", NEVER "Verified"
      const badgeHtml = renderFormulaStatusBadge(badFormula);
      expect(badgeHtml).toContain("Needs review");
      expect(badgeHtml).not.toContain("Verified");
    });

    it("runVerificationGate triggers targeted repair when core formulas (F31–F33, F37) are uncaptured", async () => {
      const sources: SourceBlock[] = [
        {
          id: "slide-60",
          label: "Slide 60",
          text: "Beta estimation and market risk: beta_i = Cov(R_i, R_M) / Var(R_M)",
        },
        {
          id: "slide-65",
          label: "Slide 65",
          text: "Security Market Line: E[R_i] = r_f + beta_i (E[R_M] - r_f)",
        },
        {
          id: "slide-70",
          label: "Slide 70",
          text: "Cost of Capital with CAPM: r = r_f + beta (r_M - r_f)",
        },
        {
          id: "slide-85",
          label: "Slide 85",
          text: "Weighted average cost of capital: WACC = (E/V) r_E + (D/V) r_D (1 - T_C)",
        },
      ];

      // Authoritative ledger with core formulas F31, F32, F33, F37
      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F31",
          slide: 60,
          raw: "\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\text{Var}(R_M)}",
          latex: "\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\text{Var}(R_M)}",
          label: "Beta Definition",
          origin: "text",
          variables: [],
        },
        {
          id: "F32",
          slide: 65,
          raw: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
          latex: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
          label: "SML Equation",
          origin: "text",
          variables: [],
        },
        {
          id: "F33",
          slide: 70,
          raw: "r_i = r_f + \\beta_i (r_M - r_f)",
          latex: "r_i = r_f + \\beta_i (r_M - r_f)",
          label: "Cost of Capital",
          origin: "text",
          variables: [],
        },
        {
          id: "F37",
          slide: 85,
          raw: "WACC = \\frac{E}{V} r_E + \\frac{D}{V} r_D (1 - T_C)",
          latex: "WACC = \\frac{E}{V} r_E + \\frac{D}{V} r_D (1 - T_C)",
          label: "WACC",
          origin: "text",
          variables: [],
        },
      ];

      // Note sections initially missing F31–F33, F37 (empty formulas)
      const initialSections: NoteSection[] = [
        createTestSection({
          id: "sec-a",
          letter: "A",
          titleVi: "A. TỔNG QUAN RỦI RO THỊ TRƯỜNG",
          bulletPoints: ["Rủi ro thị trường được đo lường bằng hệ số beta trên Slide 60"],
          formulas: [],
          sourceSlides: [60, 65, 70, 85],
        }),
      ];

      // Mock repairFn that places the missing formulas when called
      let capturedRepairPrompt = "";
      const mockRepairFn = vi.fn().mockImplementation(async (prompt: string) => {
        capturedRepairPrompt = prompt;
        return [
          createTestSection({
            id: "sec-a",
            letter: "A",
            titleVi: "A. TỔNG QUAN RỦI RO THỊ TRƯỜNG",
            bulletPoints: ["Rủi ro thị trường được đo lường bằng hệ số beta trên Slide 60"],
            formulas: [
              createTestFormula({
                name: "Beta Definition",
                latex: "\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\text{Var}(R_M)}",
                formulaRefs: ["F31"],
                slide: 60,
              }),
              createTestFormula({
                name: "SML Equation",
                latex: "E[R_i] = r_f + \\beta_i (E[R_M] - r_f)",
                formulaRefs: ["F32"],
                slide: 65,
              }),
              createTestFormula({
                name: "Cost of Capital",
                latex: "r_i = r_f + \\beta_i (r_M - r_f)",
                formulaRefs: ["F33"],
                slide: 70,
              }),
              createTestFormula({
                name: "WACC",
                latex: "WACC = \\frac{E}{V} r_E + \\frac{D}{V} r_D (1 - T_C)",
                formulaRefs: ["F37"],
                slide: 85,
              }),
            ],
            sourceSlides: [60, 65, 70, 85],
          }),
        ];
      });

      const result = await runVerificationGate({
        sections: initialSections,
        sources,
        ledger,
        options: {
          repairFn: mockRepairFn,
          maxRepairAttempts: 1,
          throwOnContradictedFormula: false,
        },
      });

      // Verify repair was triggered
      expect(mockRepairFn).toHaveBeenCalledTimes(1);
      expect(result.repairAttempted).toBe(true);

      // Verify repair prompt specifically contained F31, F32, F33, F37
      expect(capturedRepairPrompt).toContain("F31");
      expect(capturedRepairPrompt).toContain("F32");
      expect(capturedRepairPrompt).toContain("F33");
      expect(capturedRepairPrompt).toContain("F37");

      // Verify final sections contain all 4 repaired formulas
      expect(result.sections[0].formulas.length).toBe(4);
      expect(result.verification.placedFormulaIds).toContain("F31");
      expect(result.verification.placedFormulaIds).toContain("F32");
      expect(result.verification.placedFormulaIds).toContain("F33");
      expect(result.verification.placedFormulaIds).toContain("F37");
    });
  });

  // =========================================================================
  // CASE 5: LaTeX Repair, Bare English Wrapping, 10 Sections & Zero KaTeX Error
  // =========================================================================
  describe("5. LaTeX repair, bare English wrapping, 10-section preservation, and PDF HTML export", () => {
    it("repairs truncated commands ('frac{', 'pm', 'times') and Slide 54 Vietnamese equation prose", () => {
      // Truncated/corrupted commands from JSON escaping
      const inputCorrupted =
        "rac{D_1}{P_0} + g, \\text{Return} pm 5%, 2.5 imes 10, \\Sigma ất, tỷ \\Sigma ất";

      const repaired = repairCorruptedLatex(inputCorrupted);

      expect(repaired).toContain("\\frac{D_1}{P_0}");
      expect(repaired).toContain("\\pm");
      expect(repaired.replace(/\s+/g, " ")).toContain("\\pm 5%");
      expect(repaired).toContain("2.5 \\times 10");

      // Slide 54 Vietnamese Sigma typography typos
      expect(repaired).toContain("suất");
      expect(repaired).toContain("tỷ suất");
      expect(repaired).not.toContain("\\Sigma ất");
    });

    it("wraps multi-word financial prose and arrows in LaTeX without breaking symbols", () => {
      const input = "Expected Return = Risk-Free Rate + Beta times Market Risk Premium -> Long-Term Debt";
      const wrapped = wrapBareEnglishInLatex(input);

      expect(wrapped).toContain("\\text{Expected Return}");
      expect(wrapped).toContain("\\text{Risk-Free Rate}");
      expect(wrapped).toContain("\\text{Market Risk Premium}");
      expect(wrapped).toContain("\\text{Long-Term Debt}");
      expect(wrapped).toContain("\\rightarrow");
    });

    it("preserves all 10 sections of a 105-slide deck (Slides 1–105) without premature truncation", () => {
      // Construct a 10-section note covering Chapter 10 (Slides 1 to 105)
      const tenSections: NoteSection[] = [
        createTestSection({ id: "sec-a", letter: "A", titleVi: "A. LỢI SUẤT LỊCH SỬ VÀ RỦI RO", bulletPoints: ["Point A"], sourceSlides: [1, 10] }),
        createTestSection({ id: "sec-b", letter: "B", titleVi: "B. PHƯƠNG SAI VÀ ĐỘ LỆCH CHUẨN", bulletPoints: ["Point B"], sourceSlides: [11, 20] }),
        createTestSection({ id: "sec-c", letter: "C", titleVi: "C. RỦI RO PHI HỆ THỐNG VÀ ĐA DẠNG HÓA", bulletPoints: ["Point C"], sourceSlides: [21, 35] }),
        createTestSection({ id: "sec-d", letter: "D", titleVi: "D. RỦI RO HỆ THỐNG VÀ THỊ TRƯỜNG", bulletPoints: ["Point D"], sourceSlides: [36, 45] }),
        createTestSection({ id: "sec-e", letter: "E", titleVi: "E. HỆ SỐ BETA VÀ ĐO LƯỜNG RỦI RO", bulletPoints: ["Point E"], sourceSlides: [46, 55] }),
        createTestSection({ id: "sec-f", letter: "F", titleVi: "F. MÔ HÌNH ĐỊNH GIÁ TÀI SẢN VỐN (CAPM)", bulletPoints: ["Point F"], sourceSlides: [56, 68] }),
        createTestSection({ id: "sec-g", letter: "G", titleVi: "G. ĐƯỜNG THỊ TRƯỜNG CHỨNG KHOÁN (SML)", bulletPoints: ["Point G"], sourceSlides: [69, 78] }),
        createTestSection({ id: "sec-h", letter: "H", titleVi: "H. PHẦN BÙ RỦI RO VÀ LÃI SUẤT PHI RỦI RO", bulletPoints: ["Point H"], sourceSlides: [79, 88] }),
        createTestSection({ id: "sec-i", letter: "I", titleVi: "I. ỨNG DỤNG CAPM TRONG ĐỊNH GIÁ VỐN", bulletPoints: ["Point I"], sourceSlides: [89, 98] }),
        createTestSection({ id: "sec-j", letter: "J", titleVi: "J. TỔNG KẾT VÀ BÀI HỌC THỰC TIỄN", bulletPoints: ["Point J"], sourceSlides: [99, 105] }),
      ];

      const slideText = "Chapter 10: Capital Markets & Pricing of Risk (105 Slides total)";
      const processed = applyHallucinationShield(tenSections, slideText);

      // Must keep all 10 sections intact!
      expect(processed.length).toBe(10);
      expect(processed.map((s) => s.letter)).toEqual([
        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
      ]);
      expect(processed[9].titleVi).toContain("TỔNG KẾT VÀ BÀI HỌC THỰC TIỄN");
    });

    it("generateClutchNotePdfHtml renders katex@0.19.0 stylesheet and zero .katex-error markup dumps", () => {
      const sampleNote: ClutchNote = {
        id: "note-ch10",
        title: "CHAPTER 10: CAPITAL MARKETS & PRICING OF RISK",
        originalFileName: "Chapter10_Corporate_Finance.pdf",
        subject: "Corporate Finance",
        createdAt: "2026-11-11T00:00:00.000Z",
        originalSlideCount: 105,
        estimatedDistilledPages: 3,
        noiseReductionRate: 85,
        executiveSummary: "Core summary of risk, return, diversification, and the CAPM model.",
        sections: [
          createTestSection({
            id: "sec-a",
            letter: "A",
            titleVi: "A. MÔ HÌNH CAPM VÀ LỢI SUẤT KỲ VỌNG",
            coreStatement: "Expected return is linearly related to systematic risk measured by Beta.",
            overview: "Core formula for portfolio management:",
            bulletPoints: ["Beta measures sensitivity to market portfolio movements."],
            groundedBullets: [
              {
                text: "Beta measures sensitivity to market portfolio movements.",
                slide: 54,
                evidence: "Beta measures sensitivity to market portfolio movements",
                status: "verified",
              },
            ],
            formulas: [
              createTestFormula({
                name: "CAPM Equation",
                latex: "E[R_i] = r_f + \\beta_i (E[R_{Mkt}] - r_f)",
                slide: 54,
                status: "verified",
                variables: [
                  { symbol: "E[R_i]", definition: "Tỷ suất sinh lời kỳ vọng của tài sản i" },
                  { symbol: "r_f", definition: "Lãi suất phi rủi ro" },
                  { symbol: "\\beta_i", definition: "Hệ số beta của tài sản i" },
                  { symbol: "E[R_{Mkt}]", definition: "Tỷ suất sinh lời kỳ vọng của danh mục thị trường" },
                ],
              }),
              // A formula with intentionally complex syntax that would break naive parsers
              createTestFormula({
                name: "Portfolio Variance",
                latex: "\\sigma_P^2 = \\sum_{i=1}^N \\sum_{j=1}^N w_i w_j \\sigma_{ij}",
                slide: 35,
                status: "verified",
                variables: [],
              }),
            ],
            sourceSlides: [35, 54],
            keyTakeaways: {
              title: "KEY TAKEAWAYS",
              items: [
                {
                  point: "Only systematic risk is compensated with higher expected return.",
                  slide: 54,
                  subBullets: ["Unsystematic risk can be eliminated via diversification."],
                  status: "verified",
                },
              ],
              summaryPoints: [],
            },
          }),
        ],
      };

      const html = generateClutchNotePdfHtml(sampleNote);

      // Verify KaTeX 0.19.0 stylesheet link
      expect(html).toContain("https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css");

      // Verify HTML structure
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("CHAPTER 10: CAPITAL MARKETS &amp; PRICING OF RISK");
      expect(html).toContain("A. MÔ HÌNH CAPM VÀ LỢI SUẤT KỲ VỌNG");
      expect(html).toContain("pdf-formula-card");

      // Verify ZERO .katex-error markup dumps or red error text in HTML body
      const bodyHtml = html.slice(html.indexOf("<body>"));
      expect(bodyHtml).not.toContain("katex-error");
      expect(bodyHtml).not.toContain("#cc0000");

      // Also test that deliberate malformed LaTeX degrades cleanly to pdf-math-fallback without .katex-error
      const malformedLatex = "\\frac{incomplete}{";
      const renderedMalformed = renderPdfFormula(malformedLatex, true);
      expect(renderedMalformed).toContain("pdf-math-fallback");
      expect(renderedMalformed).not.toContain("katex-error");
    });
  });
});
