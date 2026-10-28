import { describe, expect, it } from "vitest";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import type {
  FormulaLedgerEntry,
  KeyTakeawaysItem,
  NoteFormula,
  NoteSection,
  SynthesisOmittedFormula,
} from "@/lib/schemas/notes";
import {
  extractDomainNumbers,
  extractFormulaSymbols,
  runDeterministicVerifiers,
  verifyEvidenceQuoteMatch,
  verifyFormulaCoverage,
  verifyFormulaSymbolSet,
  verifyNumberGrounding,
  verifySectionEvidenceQuotes,
} from "@/lib/notes/deterministic-verifiers";

function createTestFormula(
  overrides: Partial<NoteFormula> & { latex: string },
): NoteFormula {
  return {
    name: "",
    variables: [],
    ...overrides,
  };
}

function createTestTakeawayItem(
  overrides: Partial<KeyTakeawaysItem> & { point: string },
): KeyTakeawaysItem {
  return {
    subBullets: [],
    ...overrides,
  };
}

function createTestSection(
  overrides: Partial<NoteSection> & { letter: string; titleVi: string },
): NoteSection {
  return {
    id: `sec_${overrides.letter.toLowerCase()}`,
    titleEn: "",
    overview: "",
    bulletPoints: [],
    formulas: [],
    subSections: [],
    ...overrides,
  };
}

describe("Deterministic Verifiers", () => {
  const sampleLedger: FormulaLedgerEntry[] = [
    {
      id: "F1",
      slide: 3,
      raw: "P_0 = D_1 / (R - g)",
      latex: "P_0 = \\frac{D_1}{R - g}",
      origin: "text",
      label: "Gordon Growth Model",
      variables: [
        { symbol: "P_0", definition: "Current stock price" },
        { symbol: "D_1", definition: "Next dividend" },
        { symbol: "R", definition: "Discount rate" },
        { symbol: "g", definition: "Constant dividend growth rate" },
      ],
      evidence: "Gordon Growth Model: P_0 = D_1 / (R - g)",
    },
    {
      id: "F2",
      slide: 4,
      raw: "R = (D_1 / P_0) + g",
      latex: "R = \\frac{D_1}{P_0} + g",
      origin: "text",
      label: "Required Return",
      variables: [
        { symbol: "R", definition: "Required return" },
        { symbol: "D_1", definition: "Next dividend" },
        { symbol: "P_0", definition: "Current price" },
        { symbol: "g", definition: "Growth rate" },
      ],
      evidence: "Rearranging DGM: R = (D_1 / P_0) + g",
    },
    {
      id: "F3",
      slide: 5,
      raw: "P_0 = D / R",
      latex: "P_0 = \\frac{D}{R}",
      origin: "text",
      label: "Zero Growth Model (Perpetuity)",
      variables: [
        { symbol: "P_0", definition: "Current price" },
        { symbol: "D", definition: "Constant dividend" },
        { symbol: "R", definition: "Discount rate" },
      ],
      evidence: "Zero Growth Model: P_0 = D / R",
    },
  ];

  const sampleSources: SourceBlock[] = [
    {
      id: "slide_1",
      label: "Slide 1",
      text: "Introduction to Stock Valuation. Asset value equals the present value of expected cash flows.",
    },
    {
      id: "slide_3",
      label: "Slide 3",
      text: "Dividend Discount Model: P_0 = D_1 / (R - g). Applies when growth rate g is constant and strictly less than required return R.",
    },
    {
      id: "slide_4",
      label: "Slide 4",
      text: "Components of Required Return: Rearranging DGM yields R = (D_1 / P_0) + g, dividend yield plus capital gains yield.",
    },
    {
      id: "slide_5",
      label: "Slide 5",
      text: "Zero Growth Model: P_0 = D / R where dividends are a level perpetuity. Year convention is 365 days with tax rate of 25%.",
    },
  ];

  describe("verifyFormulaCoverage", () => {
    it("reports 100% coverage when all ledger formulas are directly referenced", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "CÔNG THỨC ĐỊNH GIÁ",
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              formulaRefs: ["F1"],
            }),
            createTestFormula({
              latex: "R = \\frac{D_1}{P_0} + g",
              formulaRefs: ["F2"],
            }),
            createTestFormula({
              latex: "P_0 = \\frac{D}{R}",
              formulaRefs: ["F3"],
            }),
          ],
        }),
      ];

      const res = verifyFormulaCoverage(sections, sampleLedger);
      expect(res.totalLedgerCount).toBe(3);
      expect(res.placedIds).toEqual(["F1", "F2", "F3"]);
      expect(res.uncapturedIds).toEqual([]);
      expect(res.coverageRatio).toBe(1);
    });

    it("recognizes formulas placed via derivedFrom", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "CÔNG THỨC ĐỊNH GIÁ",
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              formulaRefs: ["F1"],
            }),
            createTestFormula({
              latex: "R - g = \\frac{D_1}{P_0}",
              derivedFrom: ["F2"],
            }),
            createTestFormula({
              latex: "P_0 = \\frac{D}{R}",
              formulaRefs: ["F3"],
            }),
          ],
        }),
      ];

      const res = verifyFormulaCoverage(sections, sampleLedger);
      expect(res.placedIds).toContain("F2");
      expect(res.uncapturedIds).toEqual([]);
      expect(res.coverageRatio).toBe(1);
    });

    it("recognizes formulas placed via normalized LaTeX or raw math string", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "CÔNG THỨC ĐỊNH GIÁ",
          formulas: [
            // No formulaRefs, but latex matches F1
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
            }),
          ],
          subSections: [
            {
              heading: "CASE 1",
              bulletPoints: [],
              formulas: [
                // matches F3 raw / latex
                createTestFormula({
                  latex: "P_0 = \\frac{D}{R}",
                }),
              ],
            },
          ],
        }),
      ];

      const res = verifyFormulaCoverage(sections, sampleLedger);
      expect(res.placedIds).toContain("F1");
      expect(res.placedIds).toContain("F3");
      expect(res.uncapturedIds).toEqual(["F2"]);
      expect(res.coverageRatio).toBeCloseTo(2 / 3);
    });

    it("identifies omitted formulas with duplicate reasons vs genuinely uncaptured", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "CÔNG THỨC ĐỊNH GIÁ",
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              formulaRefs: ["F1"],
            }),
          ],
        }),
      ];

      const omitted: SynthesisOmittedFormula[] = [
        {
          formulaId: "F2",
          reason: "Duplicate rearrangement of Gordon Growth Model in F1",
        },
        {
          formulaId: "F3",
          reason: "Out of scope for this lecture summary",
        },
      ];

      const res = verifyFormulaCoverage(sections, sampleLedger, omitted);
      expect(res.placedIds).toEqual(["F1"]);
      expect(res.duplicateOmittedIds).toEqual(["F2"]);
      expect(res.uncapturedIds).toEqual(["F2", "F3"]);
      expect(res.coverageRatio).toBeCloseTo(1 / 3);
    });

    it("returns coverageRatio 1 when ledger is empty", () => {
      const res = verifyFormulaCoverage([], []);
      expect(res.totalLedgerCount).toBe(0);
      expect(res.coverageRatio).toBe(1);
      expect(res.uncapturedIds).toEqual([]);
    });
  });

  describe("verifyEvidenceQuoteMatch", () => {
    it("passes on exact quote match in target slide", () => {
      const quote = "Dividend Discount Model: P_0 = D_1 / (R - g)";
      const res = verifyEvidenceQuoteMatch(quote, 3, sampleSources);

      expect(res.slideFound).toBe(true);
      expect(res.exactMatch).toBe(true);
      expect(res.tokenOverlap).toBe(1);
      expect(res.matched).toBe(true);
    });

    it("passes with normalized math and Unicode symbols", () => {
      // Sources has P_0 = D_1 / (R - g). Quote has unicode subscript & dash: P₀ = D₁ / (R − g)
      const quote = "P₀ = D₁ / (R − g)";
      const res = verifyEvidenceQuoteMatch(quote, 3, sampleSources);

      expect(res.slideFound).toBe(true);
      expect(res.exactMatch).toBe(true);
      expect(res.matched).toBe(true);
    });

    it("passes with fuzzy token overlap above 0.75 for multi-token quotes", () => {
      // 5 tokens, 4 match the slide text
      const quote = "dividend discount model constant growth";
      const res = verifyEvidenceQuoteMatch(quote, 3, sampleSources);

      expect(res.slideFound).toBe(true);
      expect(res.tokenOverlap).toBeGreaterThanOrEqual(0.75);
      expect(res.matched).toBe(true);
    });

    it("requires 100% token overlap for short 1-2 token quotes", () => {
      // Single token found
      const singleMatch = verifyEvidenceQuoteMatch("perpetuity", 5, sampleSources);
      expect(singleMatch.matched).toBe(true);
      expect(singleMatch.tokenOverlap).toBe(1);

      // 2 tokens: one present, one absent
      const partialShort = verifyEvidenceQuoteMatch("perpetuity bond", 5, sampleSources);
      expect(partialShort.tokenOverlap).toBe(0.5);
      expect(partialShort.matched).toBe(false);
    });

    it("rejects fabricated quotes not present on the slide", () => {
      const fabricatedQuote = "Tesla reported a massive increase in electric vehicle sales";
      const res = verifyEvidenceQuoteMatch(fabricatedQuote, 3, sampleSources);

      expect(res.slideFound).toBe(true);
      expect(res.exactMatch).toBe(false);
      expect(res.tokenOverlap).toBe(0);
      expect(res.matched).toBe(false);
    });

    it("handles non-existent slide number by setting slideFound to false", () => {
      const res = verifyEvidenceQuoteMatch("Some quote", 99, sampleSources);
      expect(res.slideFound).toBe(false);
      expect(res.matched).toBe(false);
    });
  });

  describe("verifySectionEvidenceQuotes", () => {
    it("verifies grounded bullets and key takeaways across sections", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "MÔ HÌNH DGM",
          groundedBullets: [
            {
              text: "Công thức DGM áp dụng khi tốc độ tăng trưởng cổ tức g là hằng số",
              slide: 3,
              evidence: "Applies when growth rate g is constant and strictly less than required return R.",
            },
          ],
          subSections: [
            {
              heading: "CASE 1: Zero Growth",
              bulletPoints: [],
              groundedBullets: [
                {
                  text: "Cổ tức đều vô hạn là một khoản niên kim vĩnh viễn (perpetuity)",
                  slide: 5,
                  evidence: "Zero Growth Model: P_0 = D / R where dividends are a level perpetuity.",
                },
              ],
              formulas: [],
            },
          ],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              createTestTakeawayItem({
                point: "Tỷ suất sinh lời bao gồm dividend yield và capital gains yield",
                slide: 4,
                evidence: "dividend yield plus capital gains yield.",
              }),
            ],
            summaryPoints: [],
          },
        }),
      ];

      const res = verifySectionEvidenceQuotes(sections, sampleSources);
      expect(res.totalChecked).toBe(3);
      expect(res.matchedCount).toBe(3);
      expect(res.matchRatio).toBe(1);
      expect(res.failedBullets).toHaveLength(0);
      expect(res.failedTakeaways).toHaveLength(0);
    });

    it("flags failed bullets and takeaways with incorrect evidence or wrong slide", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "PHÂN TÍCH",
          groundedBullets: [
            {
              text: "Nội dung sai",
              slide: 3,
              evidence: "Fabricated evidence statement about interest rates",
            },
          ],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              createTestTakeawayItem({
                point: "Takeaway không tồn tại trên slide",
                slide: 4,
                evidence: "Completely fictitious claim",
              }),
            ],
            summaryPoints: [],
          },
        }),
      ];

      const res = verifySectionEvidenceQuotes(sections, sampleSources);
      expect(res.totalChecked).toBe(2);
      expect(res.matchedCount).toBe(0);
      expect(res.matchRatio).toBe(0);
      expect(res.failedBullets).toHaveLength(1);
      expect(res.failedBullets[0].sectionLetter).toBe("A");
      expect(res.failedTakeaways).toHaveLength(1);
      expect(res.failedTakeaways[0].sectionLetter).toBe("A");
    });

    it("verifies takeaway items missing slide/evidence by matching point against sourceSlides", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          sourceSlides: [3, 4],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              createTestTakeawayItem({
                // No slide or evidence, but text matches slide 3 content
                point: "growth rate g is constant and strictly less than required return R",
              }),
            ],
            summaryPoints: [],
          },
        }),
      ];

      const res = verifySectionEvidenceQuotes(sections, sampleSources);
      expect(res.totalChecked).toBe(1);
      expect(res.matchedCount).toBe(1);
      expect(res.matchRatio).toBe(1);
    });
  });

  describe("extractDomainNumbers and verifyNumberGrounding", () => {
    it("ignores structural numbering, step labels, and benign math constants", () => {
      const text = `
        CASE 1: Zero Growth Model.
        Step 1: Calculate the present value.
        Slide 5 shows that 1 + R is the discount factor.
        We assume 1 - T_C for tax shields and g = 0 in perpetuity.
        1. First consideration (1) 1-period 1 năm 2 giai đoạn.
        Dividend payout is 100% of earnings.
      `;

      const numbers = extractDomainNumbers(text);
      expect(numbers).toEqual([]);
    });

    it("extracts domain quantitative figures: percentages, currency, day counts, years, decimals", () => {
      const text = `
        Stock price is $4.50 with a dividend yield of 25%.
        Day count convention is 360 days in year 2025.
        Growth multiplier is 2.5x with decimal factor 0.25 and 1,000 shares.
      `;

      const numbers = extractDomainNumbers(text);
      expect(numbers).toContain("4.50");
      expect(numbers).toContain("25%");
      expect(numbers).toContain("360");
      expect(numbers).toContain("2025");
      expect(numbers).toContain("2.5");
      expect(numbers).toContain("0.25");
      expect(numbers).toContain("1000");
    });

    it("recognizes percentage vs decimal equivalence between note and slide", () => {
      // Slide 5 has tax rate of 25%. Note writes 0.25.
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "THUẾ SUẤT",
          overview: "Thuế suất doanh nghiệp áp dụng là 0.25 theo quy định.",
        }),
      ];

      const res = verifyNumberGrounding(sections, sampleSources, sampleLedger);
      expect(res.checkedNumbers).toContain("0.25");
      expect(res.passed).toBe(true);
      expect(res.ungroundedNumbers).toEqual([]);
    });

    it("recognizes thousand separator comma normalization", () => {
      const sourcesWithCommas: SourceBlock[] = [
        {
          id: "slide_10",
          label: "Slide 10",
          text: "Total investment outlay is 1,000 USD.",
        },
      ];

      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "VỐN ĐẦU TƯ",
          overview: "Tổng chi phí là 1000 USD.",
        }),
      ];

      const res = verifyNumberGrounding(sections, sourcesWithCommas);
      expect(res.passed).toBe(true);
      expect(res.ungroundedNumbers).toEqual([]);
    });

    it("catches hallucinated or discordant numbers", () => {
      // Slide 5 has 365 days and 25%. Note claims 360 days and 28% and $4.50.
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "QUY ƯỚC",
          overview: "Áp dụng quy ước 360 ngày với mức thuế 28% và giá $4.50.",
        }),
      ];

      const res = verifyNumberGrounding(sections, sampleSources, sampleLedger);
      expect(res.passed).toBe(false);
      expect(res.ungroundedNumbers).toContain("360");
      expect(res.ungroundedNumbers).toContain("28%");
      expect(res.ungroundedNumbers).toContain("4.50");
    });
  });

  describe("extractFormulaSymbols and verifyFormulaSymbolSet", () => {
    it("extracts subscripted variables, Greek letters, and standalone variables", () => {
      const latex = "P_0 = \\frac{D_1}{R - g} + \\beta_i (R_M - R_f) + \\sigma^2";
      const symbols = extractFormulaSymbols(latex);

      expect(symbols).toContain("P_0");
      expect(symbols).toContain("D_1");
      expect(symbols).toContain("R");
      expect(symbols).toContain("g");
      expect(symbols).toContain("\\beta_i");
      expect(symbols).toContain("R_M");
      expect(symbols).toContain("R_f");
      expect(symbols).toContain("\\sigma^2");
    });

    it("extracts text terms and acronyms wrapped in \\text{...}", () => {
      const latex = "\\text{ROE} = \\frac{\\text{Net Income}}{\\text{Total Equity}}";
      const symbols = extractFormulaSymbols(latex);

      expect(symbols).toContain("ROE");
      expect(symbols).toContain("Net Income");
      expect(symbols).toContain("Total Equity");
    });

    it("ignores bound summation dummy indices", () => {
      const latex = "P_0 = \\sum_{t=1}^n \\frac{CF_t}{(1 + R)^t}";
      const symbols = extractFormulaSymbols(latex);

      expect(symbols).toContain("P_0");
      expect(symbols).toContain("n");
      expect(symbols).toContain("CF_t");
      expect(symbols).toContain("R");
      // Dummy index t bound by \sum_{t=1} should not appear as standalone variable
      expect(symbols).not.toContain("t");
    });

    it("passes verification when all formula symbols are grounded in slides or ledger", () => {
      const formula: NoteFormula = createTestFormula({
        latex: "P_0 = \\frac{D_1}{R - g}",
        slide: 3,
        formulaRefs: ["F1"],
      });

      const res = verifyFormulaSymbolSet(formula, sampleSources, sampleLedger);
      expect(res.passed).toBe(true);
      expect(res.ungroundedSymbols).toEqual([]);
    });

    it("catches hallucinated symbols absent from slides and ledger", () => {
      // Formula introduces lambda and T_C (corporate tax) not present on Slide 3
      const formula: NoteFormula = createTestFormula({
        latex: "P_0 = \\frac{D_1}{R - g} + \\lambda \\cdot T_C",
        slide: 3,
        formulaRefs: ["F1"],
      });

      const res = verifyFormulaSymbolSet(formula, sampleSources, sampleLedger);
      expect(res.passed).toBe(false);
      expect(res.ungroundedSymbols).toContain("\\lambda");
      expect(res.ungroundedSymbols).toContain("T_C");
    });
  });

  describe("runDeterministicVerifiers", () => {
    it("runs consolidated verification and passes for a high-quality grounded note", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "ĐỊNH GIÁ CỔ PHIẾU DGM",
          sourceSlides: [3, 4],
          coreStatement: "Giá trị cổ phiếu bằng hiện giá của các dòng cổ tức kỳ vọng tương lai.",
          groundedBullets: [
            {
              text: "Mô hình DGM yêu cầu g là hằng số và g < R",
              slide: 3,
              evidence: "Applies when growth rate g is constant and strictly less than required return R.",
            },
          ],
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              slide: 3,
              formulaRefs: ["F1"],
            }),
            createTestFormula({
              latex: "R = \\frac{D_1}{P_0} + g",
              slide: 4,
              formulaRefs: ["F2"],
            }),
          ],
          subSections: [
            {
              heading: "CASE 1: Zero Growth",
              bulletPoints: [],
              groundedBullets: [
                {
                  text: "Trường hợp không tăng trưởng là dòng tiền đều vĩnh viễn",
                  slide: 5,
                  evidence: "Zero Growth Model: P_0 = D / R where dividends are a level perpetuity.",
                },
              ],
              formulas: [
                createTestFormula({
                  latex: "P_0 = \\frac{D}{R}",
                  slide: 5,
                  formulaRefs: ["F3"],
                }),
              ],
            },
          ],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              createTestTakeawayItem({
                point: "Tỷ suất sinh lời bao gồm dividend yield và capital gains yield",
                slide: 4,
                evidence: "dividend yield plus capital gains yield.",
              }),
            ],
            summaryPoints: [],
          },
        }),
      ];

      const report = runDeterministicVerifiers({
        sections,
        sources: sampleSources,
        ledger: sampleLedger,
      });

      expect(report.passed).toBe(true);
      expect(report.coverage.coverageRatio).toBe(1);
      expect(report.evidence.matchRatio).toBe(1);
      expect(report.numbers.passed).toBe(true);
      expect(report.symbols.passed).toBe(true);
      expect(report.summary.warnings).toEqual([]);
    });

    it("fails verification and aggregates warnings when gates are violated", () => {
      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          overview: "Giá cổ phiếu là $99.99 và tỷ lệ 95% theo quy ước 360 ngày.",
          groundedBullets: [
            {
              text: "Nội dung bịa",
              slide: 3,
              evidence: "Fabricated quote never on slide 3",
            },
          ],
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g} + \\alpha \\cdot \\lambda",
              slide: 3,
            }),
          ],
        }),
      ];

      const report = runDeterministicVerifiers({
        sections,
        sources: sampleSources,
        ledger: sampleLedger,
      });

      expect(report.passed).toBe(false);
      expect(report.coverage.coverageRatio).toBeLessThan(0.8);
      expect(report.evidence.matchRatio).toBeLessThan(0.8);
      expect(report.numbers.passed).toBe(false);
      expect(report.symbols.passed).toBe(false);
      expect(report.summary.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Regression Tests: Bug 1 (omittedByRuleIds vs uncapturedErrorIds in verifyFormulaCoverage & runDeterministicVerifiers)", () => {
    it("distinguishes omittedByRuleIds (status: 'omitted_by_rule', intermediate derivation rearrangements, duplicate identities, numerical exercise drills) vs uncapturedErrorIds", () => {
      const testLedger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 3,
          raw: "P_0 = D_1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
        {
          id: "F2",
          slide: 3,
          raw: "R - g = D_1 / P_0",
          latex: "R - g = \\frac{D_1}{P_0}",
          origin: "text",
          label: "Intermediate derivation rearrangement",
          variables: [],
        },
        {
          id: "F3",
          slide: 4,
          raw: "NWC = CA - CL",
          latex: "\\text{NWC} = \\text{CA} - \\text{CL}",
          origin: "text",
          variables: [],
        },
        {
          id: "F4",
          slide: 3,
          raw: "P_0 = 2.50 / (0.10 - 0.05) = $50",
          latex: "P_0 = \\frac{2.50}{0.10 - 0.05} = 50",
          origin: "text",
          isExerciseOnly: true,
          variables: [],
        },
        {
          id: "F5",
          slide: 6,
          raw: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
          latex: "\\text{WACC} = \\frac{E}{V} R_e + \\frac{D}{V} R_d (1 - T_c)",
          origin: "text",
          variables: [],
        },
      ];

      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          sourceSlides: [3],
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              slide: 3,
              formulaRefs: ["F1"],
            }),
          ],
        }),
      ];

      const omitted: any[] = [
        {
          formulaId: "F2",
          status: "omitted_by_rule",
          reason: "Intermediate derivation rearrangement of Gordon Growth Model",
        },
        {
          formulaId: "F3",
          reason: "Duplicate identity already covered in section",
        },
        // F4 is exercise drill with isExerciseOnly: true and numeric plug-ins on placed slide 3
        {
          formulaId: "F5",
          status: "uncaptured_error",
          reason: "Accidentally uncaptured formula",
        },
      ];

      const coverage = verifyFormulaCoverage(sections, testLedger, omitted);

      expect(coverage.placedIds).toEqual(["F1"]);
      expect(coverage.omittedByRuleIds).toContain("F2");
      expect(coverage.omittedByRuleIds).toContain("F3");
      expect(coverage.omittedByRuleIds).toContain("F4");
      expect(coverage.uncapturedErrorIds).toEqual(["F5"]);
      expect(coverage.uncapturedErrorIds).not.toContain("F2");
      expect(coverage.uncapturedErrorIds).not.toContain("F3");
      expect(coverage.uncapturedErrorIds).not.toContain("F4");
    });

    it("does NOT emit 'Uncaptured formula IDs' warning when all unplaced formulas are omitted_by_rule", () => {
      const testLedger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 3,
          raw: "P_0 = D_1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
          evidence: "P_0 = D_1 / (R - g)",
        },
        {
          id: "F2",
          slide: 3,
          raw: "R = (D_1 / P_0) + g",
          latex: "R = \\frac{D_1}{P_0} + g",
          origin: "text",
          variables: [],
          evidence: "R = (D_1 / P_0) + g",
        },
      ];

      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          sourceSlides: [3],
          groundedBullets: [
            {
              text: "Mô hình DGM",
              slide: 3,
              evidence: "Dividend Discount Model: P_0 = D_1 / (R - g).",
            },
          ],
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              slide: 3,
              formulaRefs: ["F1"],
            }),
          ],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              createTestTakeawayItem({
                point: "Dividend Discount Model",
                slide: 3,
                evidence: "Dividend Discount Model: P_0 = D_1 / (R - g).",
              }),
            ],
            summaryPoints: [],
          },
        }),
      ];

      const omitted: any[] = [
        {
          formulaId: "F2",
          status: "omitted_by_rule",
          reason: "Intermediate algebraic derivation rearrangement step",
        },
      ];

      const report = runDeterministicVerifiers({
        sections,
        sources: sampleSources,
        ledger: testLedger,
        omitted,
      });

      expect(report.coverage.omittedByRuleIds).toEqual(["F2"]);
      expect(report.coverage.uncapturedErrorIds).toEqual([]);
      const hasUncapturedWarning = report.summary.warnings.some((w) =>
        w.startsWith("Uncaptured formula IDs"),
      );
      expect(hasUncapturedWarning).toBe(false);
    });

    it("DOES emit 'Uncaptured formula IDs' warning only for uncaptured_error formulas", () => {
      const testLedger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 3,
          raw: "P_0 = D_1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
        {
          id: "F2",
          slide: 3,
          raw: "R = (D_1 / P_0) + g",
          latex: "R = \\frac{D_1}{P_0} + g",
          origin: "text",
          variables: [],
        },
        {
          id: "F3",
          slide: 5,
          raw: "P_0 = D / R",
          latex: "P_0 = \\frac{D}{R}",
          origin: "text",
          variables: [],
        },
      ];

      const sections: NoteSection[] = [
        createTestSection({
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          sourceSlides: [3],
          formulas: [
            createTestFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              slide: 3,
              formulaRefs: ["F1"],
            }),
          ],
        }),
      ];

      const omitted: any[] = [
        {
          formulaId: "F2",
          status: "omitted_by_rule",
          reason: "Duplicate identity",
        },
        {
          formulaId: "F3",
          status: "uncaptured_error",
          reason: "Failed to place core formula",
        },
      ];

      const report = runDeterministicVerifiers({
        sections,
        sources: sampleSources,
        ledger: testLedger,
        omitted,
      });

      expect(report.coverage.omittedByRuleIds).toEqual(["F2"]);
      expect(report.coverage.uncapturedErrorIds).toEqual(["F3"]);

      const uncapturedWarning = report.summary.warnings.find((w) =>
        w.startsWith("Uncaptured formula IDs"),
      );
      expect(uncapturedWarning).toBeDefined();
      expect(uncapturedWarning).toBe("Uncaptured formula IDs: F3");
      expect(uncapturedWarning).not.toContain("F2");
    });
  });
});
