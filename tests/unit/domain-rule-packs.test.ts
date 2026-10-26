import { describe, expect, it } from "vitest";
import {
  DOMAIN_RULE_PACKS,
  corporateFinanceValuationPack,
  statisticsRiskReturnPack,
  workingCapitalAccountingPack,
  getDomainRulePack,
  getAllDomainRules,
  evaluateFormulaDivergence,
  annotateNoteWithDivergenceNotices,
  type DomainRuleMatchContext,
} from "@/lib/notes/domain-rule-packs";
import {
  textbookDivergenceNoticeSchema,
  type FormulaLedgerEntry,
  type NoteFormula,
  type NoteSection,
} from "@/lib/schemas/notes";

function makeFormula(f: Partial<NoteFormula> & { latex: string }): NoteFormula {
  return {
    name: f.name ?? "",
    latex: f.latex,
    variables: f.variables ?? [],
    leadText: f.leadText,
    description: f.description,
    formulaRefs: f.formulaRefs,
    derivedFrom: f.derivedFrom,
    slide: f.slide,
    origin: f.origin,
    confidence: f.confidence,
    status: f.status,
    reviewReason: f.reviewReason,
    divergenceNotices: f.divergenceNotices,
    numericEquivalencePassed: f.numericEquivalencePassed,
  };
}

function makeSection(
  sec: Partial<NoteSection> &
    Pick<NoteSection, "id" | "letter" | "titleVi" | "bulletPoints" | "formulas">,
): NoteSection {
  return {
    id: sec.id,
    letter: sec.letter,
    titleVi: sec.titleVi,
    titleEn: sec.titleEn ?? "",
    coreStatement: sec.coreStatement,
    overview: sec.overview ?? "",
    bulletPoints: sec.bulletPoints,
    groundedBullets: sec.groundedBullets,
    formulas: sec.formulas,
    subSections: sec.subSections ?? [],
    keyTakeaways: sec.keyTakeaways,
    sourceSlides: sec.sourceSlides,
  };
}

describe("Domain Rule Packs (Stage 4.5)", () => {
  describe("Rule Registry & Schema Structure", () => {
    it("should export 3 built-in domain rule packs with expected IDs", () => {
      expect(DOMAIN_RULE_PACKS).toHaveLength(3);
      const packIds = DOMAIN_RULE_PACKS.map((p) => p.packId);
      expect(packIds).toEqual([
        "corporate-finance-valuation",
        "statistics-risk-return",
        "working-capital-accounting",
      ]);
    });

    it("should contain exactly 8 rules across all packs", () => {
      const allRules = getAllDomainRules();
      expect(allRules).toHaveLength(8);
      const ruleIds = allRules.map((r) => r.ruleId);
      expect(ruleIds).toEqual([
        "cf-growing-perpetuity-sign",
        "cf-one-period-exponent",
        "cf-growth-circular-price",
        "cf-wacc-equity-tax-shield",
        "stat-arithmetic-mean-denominator",
        "stat-sample-variance-denominator",
        "stat-sample-variance-prob-mix",
        "wc-days-in-year-360",
      ]);
    });

    it("should retrieve packs by getDomainRulePack()", () => {
      expect(getDomainRulePack("corporate-finance-valuation")).toBe(
        corporateFinanceValuationPack,
      );
      expect(getDomainRulePack("statistics-risk-return")).toBe(
        statisticsRiskReturnPack,
      );
      expect(getDomainRulePack("working-capital-accounting")).toBe(
        workingCapitalAccountingPack,
      );
      expect(getDomainRulePack("non-existent-pack")).toBeUndefined();
    });
  });

  describe("Pack 1: corporate-finance-valuation", () => {
    describe("Rule: cf-growing-perpetuity-sign", () => {
      it("flags growing perpetuity with + g in denominator", () => {
        const formula = makeFormula({
          latex: "P_0 = \\frac{D_1}{R + g}",
          slide: 14,
        });
        const ctx: DomainRuleMatchContext = {
          formula,
          sectionTitle: "Stock Valuation",
        };
        const notices = evaluateFormulaDivergence(ctx);

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("cf-growing-perpetuity-sign");
        expect(notices[0].packId).toBe("corporate-finance-valuation");
        expect(notices[0].message).toContain("uses (R + g) in the denominator");
        expect(notices[0].textbookForm).toBe("P_0 = \\frac{D_1}{R - g}");
        expect(notices[0].slide).toBe(14);
        expect(textbookDivergenceNoticeSchema.parse(notices[0])).toBeTruthy();
      });

      it("flags growing perpetuity with D_0(1+g)/(R+g) and slash notation", () => {
        const formula1 = makeFormula({
          latex: "P_0 = \\frac{D_0 (1 + g)}{R + g}",
        });
        const formula2 = makeFormula({
          latex: "P_0 = D_1 / (R + g)",
        });
        expect(
          evaluateFormulaDivergence({
            formula: formula1,
            sectionTitle: "DDM",
          }),
        ).toHaveLength(1);
        expect(
          evaluateFormulaDivergence({
            formula: formula2,
            sectionTitle: "DDM",
          }),
        ).toHaveLength(1);
      });

      it("does not flag textbook Gordon growth formula P_0 = D_1 / (R - g)", () => {
        const formula = makeFormula({
          latex: "P_0 = \\frac{D_1}{R - g}",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "DDM",
        });
        expect(notices).toHaveLength(0);
      });

      it("does not flag required return rearranged formula R = D_1/P_0 + g", () => {
        const formula = makeFormula({
          latex: "R = \\frac{D_1}{P_0} + g",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "DDM Components",
        });
        expect(notices).toHaveLength(0);
      });
    });

    describe("Rule: cf-one-period-exponent", () => {
      it("flags 1-period holding formula with multi-period exponent ^T or ^t", () => {
        const formula = makeFormula({
          latex: "P_0 = \\frac{D_1}{(1 + R)^T} + \\frac{P_1}{(1 + R)^T}",
          slide: 8,
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "1-Period Valuation",
        });

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("cf-one-period-exponent");
        expect(notices[0].message).toContain(
          "multi-period exponent (^T or ^t)",
        );
        expect(notices[0].textbookForm).toBe(
          "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
        );
      });

      it("does not flag standard 1-period textbook formula without exponent", () => {
        const formula = makeFormula({
          latex: "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "1-Period Valuation",
        });
        expect(notices).toHaveLength(0);
      });

      it("does not flag multi-period discounted dividend formula with summation", () => {
        const formula = makeFormula({
          latex:
            "P_0 = \\sum_{t=1}^{T} \\frac{D_t}{(1 + R)^t} + \\frac{P_T}{(1 + R)^T}",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "General Model",
        });
        expect(notices).toHaveLength(0);
      });
    });

    describe("Rule: cf-growth-circular-price", () => {
      it("flags growth rate g defined via price appreciation (P_1 - P_0)/P_0", () => {
        const formula = makeFormula({
          latex: "g = \\frac{P_1 - P_0}{P_0}",
          slide: 18,
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Estimating Growth Rate",
        });

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("cf-growth-circular-price");
        expect(notices[0].message).toContain(
          "defines g via price appreciation ((P_1 - P_0)/P_0)",
        );
        expect(notices[0].textbookForm).toBe(
          "g = \\text{Retention ratio} \\times \\text{ROE}",
        );
      });

      it("flags g defined with Delta P / P_0 or slash", () => {
        const formula1 = makeFormula({
          latex: "g = \\frac{\\Delta P}{P_0}",
        });
        const formula2 = makeFormula({
          latex: "g = (P_1 - P_0) / P_0",
        });
        expect(
          evaluateFormulaDivergence({
            formula: formula1,
            sectionTitle: "Growth",
          }),
        ).toHaveLength(1);
        expect(
          evaluateFormulaDivergence({
            formula: formula2,
            sectionTitle: "Growth",
          }),
        ).toHaveLength(1);
      });

      it("does not flag textbook sustainable growth formula g = Retention ratio * ROE", () => {
        const formula = makeFormula({
          latex: "g = \\text{Retention ratio} \\times \\text{ROE}",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Sustainable Growth",
        });
        expect(notices).toHaveLength(0);
      });

      it("does not flag capital gains yield formula when LHS is not g", () => {
        const formula = makeFormula({
          latex: "\\text{Capital Gains Yield} = \\frac{P_1 - P_0}{P_0}",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Returns",
        });
        expect(notices).toHaveLength(0);
      });
    });

    describe("Rule: cf-wacc-equity-tax-shield", () => {
      it("flags WACC formula applying (1 - T_C) to equity or preferred stock", () => {
        const formula = makeFormula({
          latex:
            "\\text{WACC} = \\left(\\frac{E}{V}\\right) R_E (1 - T_C) + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)",
          slide: 22,
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Cost of Capital",
        });

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("cf-wacc-equity-tax-shield");
        expect(notices[0].message).toContain(
          "applies the tax shield (1 - T_C) to equity or preferred stock",
        );
        expect(notices[0].textbookForm).toBe(
          "\\text{WACC} = \\left(\\frac{E}{V}\\right) R_E + \\left(\\frac{P}{V}\\right) R_P + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)",
        );
      });

      it("flags preferred stock term receiving tax shield in WACC", () => {
        const formula = makeFormula({
          latex:
            "\\text{WACC} = \\frac{E}{V} R_E + \\frac{P}{V} R_P (1 - T_C) + \\frac{D}{V} R_D (1 - T_C)",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "WACC",
        });
        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("cf-wacc-equity-tax-shield");
      });

      it("does not flag standard textbook WACC applying tax shield only to debt", () => {
        const formula = makeFormula({
          latex:
            "\\text{WACC} = \\left(\\frac{E}{V}\\right) R_E + \\left(\\frac{P}{V}\\right) R_P + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "WACC Calculation",
        });
        expect(notices).toHaveLength(0);
      });

      it("does not flag M&M Proposition II with taxes", () => {
        const formula = makeFormula({
          latex:
            "R_E = R_U + (R_U - R_D) \\left(\\frac{D}{E}\\right) (1 - T_C)",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Capital Structure Theory",
        });
        expect(notices).toHaveLength(0);
      });
    });
  });

  describe("Pack 2: statistics-risk-return", () => {
    describe("Rule: stat-arithmetic-mean-denominator", () => {
      it("flags arithmetic mean dividing by T - 1 or n - 1", () => {
        const formula = makeFormula({
          latex: "\\bar{R} = \\frac{1}{T - 1} \\sum_{t=1}^{T} R_t",
          slide: 5,
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Returns Statistics",
        });

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("stat-arithmetic-mean-denominator");
        expect(notices[0].message).toContain(
          "arithmetic mean divides by (T - 1)",
        );
        expect(notices[0].textbookForm).toBe(
          "\\bar{R} = \\frac{1}{T} \\sum_{t=1}^{T} R_t",
        );
      });

      it("does not flag textbook arithmetic mean dividing by T", () => {
        const formula = makeFormula({
          latex: "\\bar{R} = \\frac{1}{T} \\sum_{t=1}^{T} R_t",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Returns Statistics",
        });
        expect(notices).toHaveLength(0);
      });

      it("does not flag sample variance dividing by T - 1", () => {
        const formula = makeFormula({
          latex: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^{T} (R_t - \\bar{R})^2",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Variance Statistics",
        });
        // Sample variance dividing by T-1 is Bessel-corrected standard form
        expect(
          notices.some((n) => n.ruleId === "stat-arithmetic-mean-denominator"),
        ).toBe(false);
      });
    });

    describe("Rule: stat-sample-variance-denominator", () => {
      it("flags sample variance s^2 dividing by T instead of Bessel-corrected T - 1", () => {
        const formula = makeFormula({
          latex: "s^2 = \\frac{1}{T} \\sum_{t=1}^{T} (R_t - \\bar{R})^2",
          slide: 7,
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Risk & Variance",
        });

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("stat-sample-variance-denominator");
        expect(notices[0].message).toContain(
          "divides by T (population form) instead of (T - 1)",
        );
        expect(notices[0].textbookForm).toBe(
          "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^{T} (R_t - \\bar{R})^2",
        );
      });

      it("does not flag textbook Bessel-corrected sample variance", () => {
        const formula = makeFormula({
          latex: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^{T} (R_t - \\bar{R})^2",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Risk & Variance",
        });
        expect(notices).toHaveLength(0);
      });

      it("does not flag textbook population variance sigma^2 dividing by N", () => {
        const formula = makeFormula({
          latex: "\\sigma^2 = \\frac{1}{N} \\sum_{i=1}^{N} (R_i - \\mu)^2",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Population Parameters",
        });
        expect(notices).toHaveLength(0);
      });
    });

    describe("Rule: stat-sample-variance-prob-mix", () => {
      it("flags scenario variance mixing probability weights P_i with 1/T", () => {
        const formula = makeFormula({
          latex:
            "\\sigma^2 = \\frac{1}{T} \\sum_{i=1}^{S} P_i (R_i - E[R])^2",
          slide: 12,
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Scenario Risk",
        });

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("stat-sample-variance-prob-mix");
        expect(notices[0].message).toContain(
          "mixes probability weights P_i with sample-size division",
        );
        expect(notices[0].textbookForm).toBe(
          "\\sigma^2 = \\sum_{i} P_i (R_i - E[R])^2",
        );
      });

      it("flags s^2 symbol used for probability weighted scenario variance", () => {
        const formula = makeFormula({
          latex: "s^2 = \\sum_{i=1}^{S} P_i (R_i - E[R])^2",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Expected Variance",
        });

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("stat-sample-variance-prob-mix");
      });

      it("does not flag textbook scenario variance weighted purely by P_i", () => {
        const formula = makeFormula({
          latex: "\\sigma^2 = \\sum_{i=1}^{S} P_i (R_i - E[R])^2",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Expected Variance",
        });
        expect(notices).toHaveLength(0);
      });
    });
  });

  describe("Pack 3: working-capital-accounting", () => {
    describe("Rule: wc-days-in-year-360", () => {
      it("flags 360-day banker's year in DSO formula", () => {
        const formula = makeFormula({
          latex:
            "\\text{DSO} = \\frac{360}{\\text{Receivables Turnover}}",
          slide: 19,
        });
        const ctx: DomainRuleMatchContext = {
          formula,
          sectionTitle: "Working Capital Ratios",
        };
        const notices = evaluateFormulaDivergence(ctx);

        expect(notices).toHaveLength(1);
        expect(notices[0].ruleId).toBe("wc-days-in-year-360");
        expect(notices[0].packId).toBe("working-capital-accounting");
        expect(notices[0].message).toContain(
          "360-day banker's year convention",
        );
        expect(notices[0].textbookForm).toBe("365 \\text{ days}");
        expect(notices[0].slide).toBe(19);
      });

      it("flags 360 days in Cash Conversion Cycle and Inventory Period", () => {
        const formula1 = makeFormula({
          latex:
            "\\text{Inventory Period} = \\frac{360}{\\text{Inventory Turnover}}",
        });
        const formula2 = makeFormula({
          name: "Cash Conversion Cycle (360 day base)",
          latex:
            "\\text{CCC} = \\text{Inventory Period} + \\text{Receivables Period} - \\text{Payables Period}",
        });
        expect(
          evaluateFormulaDivergence({
            formula: formula1,
            sectionTitle: "Operating Cycle",
          }),
        ).toHaveLength(1);
      });

      it("does not flag textbook 365-day formulas", () => {
        const formula = makeFormula({
          latex:
            "\\text{DSO} = \\frac{365}{\\text{Receivables Turnover}}",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Working Capital",
        });
        expect(notices).toHaveLength(0);
      });

      it("does not flag non-financial equations containing 360", () => {
        const formula = makeFormula({
          latex: "\\theta = 360^\\circ",
        });
        const notices = evaluateFormulaDivergence({
          formula,
          sectionTitle: "Geometry Foundations",
        });
        expect(notices).toHaveLength(0);
      });
    });
  });

  describe("annotateNoteWithDivergenceNotices", () => {
    it("annotates note sections non-mutatingly and preserves latex verbatim", () => {
      const originalFormulaLatex = "P_0 = \\frac{D_1}{R + g}";
      const rawSections: NoteSection[] = [
        makeSection({
          id: "sec-1",
          letter: "A",
          titleVi: "MÔ HÌNH CHIẾT KHẤU CỔ TỨC",
          titleEn: "Dividend Discount Model",
          overview: "Các mô hình định giá cổ tức căn bản.",
          bulletPoints: ["Cổ tức tăng trưởng đều g."],
          formulas: [
            makeFormula({
              latex: originalFormulaLatex,
              variables: [
                { symbol: "P_0", definition: "Giá cổ phiếu hiện tại" },
                { symbol: "D_1", definition: "Cổ tức kỳ tới" },
              ],
              formulaRefs: ["F1"],
              slide: 14,
            }),
          ],
          subSections: [
            {
              heading: "CASE 2: Constant Growth",
              bulletPoints: ["Mô hình Gordon."],
              formulas: [
                makeFormula({
                  latex: "g = \\frac{P_1 - P_0}{P_0}",
                  variables: [],
                  formulaRefs: ["F2"],
                  slide: 15,
                }),
              ],
            },
          ],
        }),
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 14,
          raw: "P_0 = D_1 / (R + g)",
          latex: "P_0 = \\frac{D_1}{R + g}",
          origin: "omml",
          variables: [],
        },
        {
          id: "F2",
          slide: 15,
          raw: "g = (P_1 - P_0)/P_0",
          latex: "g = \\frac{P_1 - P_0}{P_0}",
          origin: "omml",
          variables: [],
        },
      ];

      const result = annotateNoteWithDivergenceNotices(rawSections, ledger);

      // Verify original sections remain strictly unmutated
      expect(rawSections[0].formulas[0].divergenceNotices).toBeUndefined();
      expect(
        rawSections[0].subSections![0].formulas[0].divergenceNotices,
      ).toBeUndefined();

      // Verify cloned sections received divergence notices
      const clonedFormula1 = result.sections[0].formulas[0];
      const clonedFormula2 = result.sections[0].subSections![0].formulas[0];

      expect(clonedFormula1.divergenceNotices).toBeDefined();
      expect(clonedFormula1.divergenceNotices).toHaveLength(1);
      expect(clonedFormula1.divergenceNotices![0].ruleId).toBe(
        "cf-growing-perpetuity-sign",
      );

      // Strictly verify Locked Product Decision #4: latex must NEVER be auto-rewritten!
      expect(clonedFormula1.latex).toBe(originalFormulaLatex);
      expect(clonedFormula2.latex).toBe("g = \\frac{P_1 - P_0}{P_0}");

      expect(clonedFormula2.divergenceNotices).toBeDefined();
      expect(clonedFormula2.divergenceNotices).toHaveLength(1);
      expect(clonedFormula2.divergenceNotices![0].ruleId).toBe(
        "cf-growth-circular-price",
      );

      // Verify aggregated notices list
      expect(result.notices).toHaveLength(2);
      expect(result.notices.map((n) => n.ruleId)).toEqual([
        "cf-growing-perpetuity-sign",
        "cf-growth-circular-price",
      ]);
      expect(result.notices[0].slide).toBe(14);
      expect(result.notices[1].slide).toBe(15);
    });

    it("leaves standard textbook notes with zero divergence notices", () => {
      const cleanSections: NoteSection[] = [
        makeSection({
          id: "sec-clean",
          letter: "A",
          titleVi: "ĐỊNH GIÁ CHUẨN",
          overview: "Mô hình chuẩn sách giáo khoa.",
          bulletPoints: ["Không có biến thể."],
          formulas: [
            makeFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              variables: [],
              slide: 10,
            }),
            makeFormula({
              latex:
                "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^{T} (R_t - \\bar{R})^2",
              variables: [],
              slide: 11,
            }),
          ],
        }),
      ];

      const result = annotateNoteWithDivergenceNotices(cleanSections);
      expect(result.notices).toHaveLength(0);
      expect(result.sections[0].formulas[0].divergenceNotices).toBeUndefined();
      expect(result.sections[0].formulas[1].divergenceNotices).toBeUndefined();
    });
  });
});
