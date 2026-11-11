import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

import { generateObject } from "ai";
import { IngestionError } from "@/lib/ingestion/errors";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  noteVerificationRecordSchema,
  clutchNoteSchema,
  type NoteSection,
  type NoteFormula,
  type FormulaLedgerEntry,
  type SynthesisOmittedFormula,
  type SynthesisSection,
} from "@/lib/schemas/notes";
import {
  runVerificationGate,
  applyMarkPolicyAndGate,
  buildTargetedRepairPrompt,
  executeVerificationPipeline,
  evaluateSectionDropRate,
  runSectionQualityGate,
  extractFinancialConventions,
  pinConventionsToSections,
  type FinancialConventionPin,
} from "@/lib/notes/verification-gate";
import { buildNotesPrompt } from "@/lib/ai/prompts-notes";
import { generateClutchNote } from "@/lib/ai/generate-notes";

function createSection(
  partial: Partial<NoteSection> & Pick<NoteSection, "id" | "letter" | "titleVi">,
): NoteSection {
  return {
    titleEn: "",
    overview: "",
    bulletPoints: [],
    formulas: [],
    subSections: [],
    keyTakeaways: null,
    sourceSlides: [1],
    ...partial,
  };
}

function createFormula(
  partial: Partial<NoteFormula> & Pick<NoteFormula, "latex">,
): NoteFormula {
  return {
    name: "",
    variables: [],
    ...partial,
  };
}

describe("Stage 4.4 Verification Gate & Targeted Repair Loop", () => {
  beforeEach(() => {
    vi.mocked(generateObject).mockReset();
  });

  describe("MARK Policy & Claim Pruning", () => {
    it("removes UNSUPPORTED claims from bullets, coreStatement, and takeaways and tracks unsupportedClaimsRemoved", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Stock valuation principles. Dividend discount model DDM evaluates future dividends.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ CỔ PHIẾU",
        coreStatement: "This core statement is completely made up and unsupported.",
        formulas: [
          createFormula({
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            slide: 1,
          }),
        ],
        groundedBullets: [
          {
            text: "Dividend discount model DDM evaluates future dividends",
            slide: 1,
            evidence: "Dividend discount model DDM evaluates future dividends",
          },
          {
            text: "Random unsupported bullet about crypto tokens",
            slide: 1,
            evidence: "Crypto tokens yield 500% APY",
          },
        ],
        bulletPoints: [
          "Dividend discount model DDM evaluates future dividends",
          "Random unsupported bullet about crypto tokens",
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          items: [
            {
              point: "Valid takeaway grounded in slide",
              subBullets: [],
              slide: 1,
              evidence: "Stock valuation principles",
            },
            {
              point: "Unsupported takeaway about arbitrage trading",
              subBullets: [],
              slide: 1,
              evidence: "High frequency arbitrage guaranteed",
            },
          ],
          summaryPoints: [],
        },
      });

      // Mock verifier LLM output
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          verdicts: [
            {
              claimId: "C1", // Core statement
              slide: 1,
              verdict: "UNSUPPORTED",
              reason: "Not found on slide 1",
            },
            {
              claimId: "C2", // First bullet
              slide: 1,
              verdict: "SUPPORTED",
              reason: "Directly matches slide text",
            },
            {
              claimId: "C3", // Second bullet
              slide: 1,
              verdict: "UNSUPPORTED",
              reason: "Crypto tokens not discussed in corporate finance slides",
            },
            {
              claimId: "C4", // Takeaway 1
              slide: 1,
              verdict: "SUPPORTED",
              reason: "Matches slide 1 principles",
            },
            {
              claimId: "C5", // Takeaway 2
              slide: 1,
              verdict: "UNSUPPORTED",
              reason: "Arbitrage not mentioned",
            },
          ],
        },
      } as any);

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          enableVerifierLlm: true,
          verifierModel: {} as any,
          maxRepairAttempts: 0,
        },
      });

      // Verification record assertions
      expect(result.verification.unsupportedClaimsRemoved).toBe(3); // coreStatement + 1 bullet + 1 takeaway
      expect(result.sections[0].coreStatement).toBeUndefined();
      expect(result.sections[0].groundedBullets?.length).toBe(1);
      expect(result.sections[0].groundedBullets?.[0].text).toContain("Dividend discount model DDM");
      expect(result.sections[0].bulletPoints).toEqual([
        "Dividend discount model DDM evaluates future dividends",
      ]);
      expect(result.sections[0].keyTakeaways?.items?.length).toBe(1);
      expect(result.sections[0].keyTakeaways?.items?.[0].point).toBe("Valid takeaway grounded in slide");

      // Overall status should be marked because unsupported claims were removed
      expect(result.verification.status).toBe("marked");
      expect(noteVerificationRecordSchema.safeParse(result.verification).success).toBe(true);
    });

    it("enforces the guardrail: does NOT remove the last bullet if it would leave an entire section with 0 content and 0 formulas", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Intro slide without formulas.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [];

      // Section with NO coreStatement, NO formulas, NO subSections, NO takeaways, and only 1 bullet
      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. GIỚI THIỆU CHUNG",
        coreStatement: "",
        formulas: [],
        subSections: [],
        keyTakeaways: null,
        groundedBullets: [
          {
            text: "Only bullet in section that LLM says is unsupported",
            slide: 1,
            evidence: "Some unmatched evidence quote",
          },
        ],
        bulletPoints: ["Only bullet in section that LLM says is unsupported"],
      });

      // Mock LLM verifier returning UNSUPPORTED for C1
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          verdicts: [
            {
              claimId: "C1",
              slide: 1,
              verdict: "UNSUPPORTED",
              reason: "Slide does not mention this intro bullet",
            },
          ],
        },
      } as any);

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          enableVerifierLlm: true,
          verifierModel: {} as any,
          maxRepairAttempts: 0,
        },
      });

      // Guardrail triggered: bullet kept, marked needs_review, not removed
      expect(result.sections[0].groundedBullets?.length).toBe(1);
      expect(result.sections[0].groundedBullets?.[0].status).toBe("needs_review");
      expect(result.sections[0].groundedBullets?.[0].reviewReason).toContain("Unsupported claim preserved");
      expect(result.verification.unsupportedClaimsRemoved).toBe(0);
      expect(result.verification.needsReviewCount).toBeGreaterThan(0);
      expect(result.verification.status).toBe("marked");
    });
  });

  describe("Uncertain & Needs-Review Flagging", () => {
    it("flags formulas with ungrounded symbols or low-confidence OCR with needs_review", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Slide text with standard variables P_0, D_1, R, g.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. CÔNG THỨC",
        formulas: [
          // Formula 1: OCR origin with low confidence (< 0.75)
          createFormula({
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            origin: "ocr",
            confidence: 0.55,
            slide: 1,
          }),
          // Formula 2: Invented symbol \Omega_k not in slides or ledger
          createFormula({
            latex: "\\Omega_k = \\frac{\\Psi_{xyz}}{R}",
            slide: 1,
          }),
        ],
      });

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          skipVerifierLlm: true,
          maxRepairAttempts: 0,
        },
      });

      const f1 = result.sections[0].formulas[0];
      const f2 = result.sections[0].formulas[1];

      expect(f1.status).toBe("needs_review");
      expect(f1.reviewReason).toContain("Low confidence OCR");

      expect(f2.status).toBe("needs_review");
      expect(f2.reviewReason).toContain("Ungrounded symbols");

      expect(result.verification.needsReviewCount).toBeGreaterThanOrEqual(2);
      expect(result.verification.status).toBe("marked");
    });

    it("flags bullets whose evidence quote fails source matching with needs_review", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Actual slide 1 content about cost of capital WACC.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [];

      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. TỔNG QUAN",
        groundedBullets: [
          {
            text: "Bullet with fabricated quote",
            slide: 1,
            evidence: "completely fabricated quote that does not appear in any slide text anywhere",
          },
        ],
        bulletPoints: ["Bullet with fabricated quote"],
      });

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          skipVerifierLlm: true,
          maxRepairAttempts: 0,
        },
      });

      expect(result.sections[0].groundedBullets?.[0].status).toBe("needs_review");
      expect(result.sections[0].groundedBullets?.[0].reviewReason).toContain("Evidence quote failed source match");
      expect(result.verification.needsReviewCount).toBe(1);
    });

    it("marks verified direct formulas as 'verified' and valid derived formulas as 'derived'", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Gordon Growth model P_0 = D_1 / (R - g). Required return R = D_1 / P_0 + g.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. CÔNG THỨC",
        formulas: [
          // Direct ledger formula
          createFormula({
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            slide: 1,
          }),
          // Derived formula (rearrangement for R)
          createFormula({
            latex: "R = \\frac{D_1}{P_0} + g",
            derivedFrom: ["F1"],
            slide: 1,
          }),
        ],
      });

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          skipVerifierLlm: true,
          maxRepairAttempts: 0,
        },
      });

      const direct = result.sections[0].formulas[0];
      const derived = result.sections[0].formulas[1];

      expect(direct.status).toBe("verified");
      expect(derived.status).toBe("derived");
      expect(derived.numericEquivalencePassed).toBe(true);
      expect(result.verification.contradictedFormulaCount).toBe(0);
    });
  });

  describe("Hard-Fail ONLY on Contradicted Formulas", () => {
    it("throws IngestionError 422 FORMULA_CONTRADICTS_SOURCE when a formula mathematically contradicts the source slides", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Gordon constant growth model P_0 = D_1 / (R - g).",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      // Note formula has fatal sign contradiction in denominator: R + g instead of R - g
      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. CÔNG THỨC",
        formulas: [
          createFormula({
            latex: "P_0 = \\frac{D_1}{R + g}",
            formulaRefs: ["F1"],
            slide: 1,
          }),
        ],
      });

      await expect(
        runVerificationGate({
          sections: [section],
          sources,
          ledger,
          options: {
            skipVerifierLlm: true,
            maxRepairAttempts: 0,
            throwOnContradictedFormula: true,
          },
        }),
      ).rejects.toThrow(IngestionError);

      try {
        await runVerificationGate({
          sections: [section],
          sources,
          ledger,
          options: {
            skipVerifierLlm: true,
            maxRepairAttempts: 0,
            throwOnContradictedFormula: true,
          },
        });
      } catch (err: any) {
        expect(err.code).toBe("FORMULA_CONTRADICTS_SOURCE");
        expect(err.status).toBe(422);
      }
    });

    it("does NOT throw when throwOnContradictedFormula: false, but records status: 'failed' and contradictedFormulaCount > 0", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Gordon constant growth model P_0 = D_1 / (R - g).",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. CÔNG THỨC",
        formulas: [
          createFormula({
            latex: "P_0 = \\frac{D_1}{R + g}",
            formulaRefs: ["F1"],
            slide: 1,
          }),
        ],
      });

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          skipVerifierLlm: true,
          maxRepairAttempts: 0,
          throwOnContradictedFormula: false,
        },
      });

      expect(result.verification.status).toBe("failed");
      expect(result.verification.contradictedFormulaCount).toBe(1);
      expect(result.sections[0].formulas[0].status).toBe("contradicted");
    });
  });

  describe("Targeted Repair Loop (max 1)", () => {
    it("triggers repair when a ledger formula is uncaptured and successfully repairs into 'repaired' status", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Gordon Growth model P_0 = D_1 / (R - g). Zero growth model P_0 = D / R.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
        {
          id: "F2",
          slide: 1,
          raw: "P0 = D / R",
          latex: "P_0 = \\frac{D}{R}",
          origin: "text",
          variables: [],
        },
      ];

      // Initial section only placed F1, missed F2 (uncaptured)
      const initialSection = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ",
        formulas: [
          createFormula({
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            slide: 1,
          }),
        ],
      });

      let repairCallCount = 0;
      let capturedRepairPrompt = "";

      const repairFn = vi.fn().mockImplementation(async (prompt: string) => {
        repairCallCount++;
        capturedRepairPrompt = prompt;

        // Return repaired sections that include both F1 and F2
        return [
          {
            letter: "A",
            titleVi: "A. ĐỊNH GIÁ",
            coreStatement: "",
            overview: "",
            bullets: [],
            formulas: [
              {
                formulaRefs: ["F1"],
                derivedFrom: [],
                leadText: "Gordon constant growth model:",
                latex: "P_0 = \\frac{D_1}{R - g}",
                description: "",
                variables: [],
              },
              {
                formulaRefs: ["F2"],
                derivedFrom: [],
                leadText: "Zero growth model:",
                latex: "P_0 = \\frac{D}{R}",
                description: "",
                variables: [],
              },
            ],
            subSections: [],
            takeaways: [],
            sourceSlides: [1],
          },
        ];
      });

      const result = await runVerificationGate({
        sections: [initialSection],
        sources,
        ledger,
        options: {
          repairFn,
          maxRepairAttempts: 1,
          skipVerifierLlm: true,
        },
      });

      expect(repairCallCount).toBe(1);
      expect(capturedRepairPrompt).toContain("UNCAPTURED SOURCE FORMULAS");
      expect(capturedRepairPrompt).toContain("F2");
      expect(result.repairAttempted).toBe(true);

      // Repaired note now has both F1 and F2 placed
      expect(result.sections[0].formulas.length).toBe(2);
      expect(result.sections[0].formulas.some((f) => f.formulaRefs?.includes("F1"))).toBe(true);
      expect(result.sections[0].formulas.some((f) => f.formulaRefs?.includes("F2"))).toBe(true);

      // Clean post-repair state gives "repaired" status
      expect(result.verification.status).toBe("repaired");
      expect(result.verification.coverageRatio).toBe(1);
    });

    it("enforces max 1 repair pass even if repair output still has issues", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Slide text.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      const initialSection = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ",
        formulas: [], // Missed F1
      });

      let repairCallCount = 0;
      const repairFn = vi.fn().mockImplementation(async () => {
        repairCallCount++;
        // Repair output still forgets F1
        return [
          {
            letter: "A",
            titleVi: "A. ĐỊNH GIÁ",
            coreStatement: "",
            overview: "",
            bullets: [],
            formulas: [],
            subSections: [],
            takeaways: [],
            sourceSlides: [1],
          },
        ];
      });

      const result = await runVerificationGate({
        sections: [initialSection],
        sources,
        ledger,
        options: {
          repairFn,
          maxRepairAttempts: 5, // Even if maxRepairAttempts > 1, gate caps at 1 pass
          skipVerifierLlm: true,
        },
      });

      expect(repairCallCount).toBe(1);
      expect(result.repairAttempted).toBe(true);
      // F1 is still uncaptured, so status is "marked"
      expect(result.verification.status).toBe("marked");
      expect(result.verification.uncapturedFormulaIds).toEqual(["F1"]);
    });

    it("gracefully catches repair failures without crashing the verification gate", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Slide text.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      const initialSection = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ",
        formulas: [],
      });

      const repairFn = vi.fn().mockRejectedValue(new Error("LLM Rate limit / network timeout"));

      const result = await runVerificationGate({
        sections: [initialSection],
        sources,
        ledger,
        options: {
          repairFn,
          skipVerifierLlm: true,
        },
      });

      // Handled gracefully: repair was attempted, did not crash, proceeds to mark
      expect(result.repairAttempted).toBe(true);
      expect(result.verification.status).toBe("marked");
      expect(result.verification.uncapturedFormulaIds).toEqual(["F1"]);
    });
  });

  describe("Textbook Divergence Notices", () => {
    it("preserves formula LaTeX verbatim and attaches divergence notices for student visibility", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Lecturer wrote growing perpetuity with plus sign P_0 = D_1 / (R + g)",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R + g)",
          latex: "P_0 = \\frac{D_1}{R + g}", // Lecturer's idiosyncratic slide formula
          origin: "text",
          variables: [],
        },
      ];

      const section = createSection({
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. GROWING PERPETUITY",
        formulas: [
          createFormula({
            latex: "P_0 = \\frac{D_1}{R + g}",
            formulaRefs: ["F1"],
            slide: 1,
          }),
        ],
      });

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          skipVerifierLlm: true,
          maxRepairAttempts: 0,
          throwOnContradictedFormula: false,
        },
      });

      const formula = result.sections[0].formulas[0];
      // LaTeX must NOT be auto-rewritten
      expect(formula.latex).toBe("P_0 = \\frac{D_1}{R + g}");

      // Divergence notice attached
      expect(formula.divergenceNotices).toBeDefined();
      expect(formula.divergenceNotices?.length).toBeGreaterThan(0);
      expect(formula.divergenceNotices?.[0].ruleId).toBe("cf-growing-perpetuity-sign");
      expect(formula.divergenceNotices?.[0].textbookForm).toContain("R - g");

      // Appears in overall verification record
      expect(result.verification.divergenceNotices.some((n) => n.ruleId === "cf-growing-perpetuity-sign")).toBe(true);
    });
  });

  describe("buildTargetedRepairPrompt", () => {
    it("formats contradicted formulas, uncaptured formulas, and claims clearly", () => {
      const prompt = buildTargetedRepairPrompt({
        sections: [
          createSection({
            id: "sec-a-1",
            letter: "A",
            titleVi: "A. VALUATION",
          }),
        ],
        contradictedFormulas: [
          {
            latex: "P_0 = \\frac{D_1}{R + g}",
            parentLedgerLatex: "P_0 = \\frac{D_1}{R - g}",
            parentLedgerId: "F1",
            reason: "Denominator has addition instead of subtraction",
          },
        ],
        uncapturedFormulas: [
          {
            id: "F3",
            slide: 2,
            latex: "P_0 = \\frac{D}{R}",
            label: "Zero Growth Model",
          },
        ],
        contradictedClaims: [
          {
            claimId: "C2",
            text: "Dividends grow at rate R",
            slide: 1,
            reason: "Growth rate is g, discount rate is R",
          },
        ],
        warnings: ["Sample variance was divided by T instead of T - 1"],
      });

      expect(prompt).toContain("TARGETED STUDY NOTE REPAIR REQUEST");
      expect(prompt).toContain("CONTRADICTED FORMULAS (MUST FIX)");
      expect(prompt).toContain("P_0 = \\frac{D_1}{R - g}");
      expect(prompt).toContain("UNCAPTURED SOURCE FORMULAS (MUST PLACE)");
      expect(prompt).toContain("F3");
      expect(prompt).toContain("CONTRADICTED CONCEPTUAL CLAIMS");
      expect(prompt).toContain("C2");
      expect(prompt).toContain("ADDITIONAL DEFECT WARNINGS");
    });
  });

  describe("End-to-End generateClutchNote with Verification Gate", () => {
    it("runs generateClutchNote and populates note.verification strictly conforming to clutchNoteSchema", async () => {
      vi.mocked(generateObject).mockReset();

      // Mock 1: Extraction
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          formulas: [
            {
              slide: 1,
              raw: "P0 = D1 / (R - g)",
              latex: "P_0 = \\frac{D_1}{R - g}",
              label: "Gordon Growth",
              variables: [
                { symbol: "P_0", definition: "Current stock price" },
                { symbol: "D_1", definition: "Next dividend" },
              ],
              evidence: "Gordon Growth model gives P_0 = D_1 / (R - g)",
              isExerciseOnly: false,
            },
          ],
          claims: [
            {
              slide: 1,
              topic: "Stock Valuation",
              claim: "Stock value is the present value of future dividends",
              evidence: "Stock Valuation",
            },
          ],
        },
      } as any);

      // Mock 2: Synthesis
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          title: "CHAPTER 9: STOCK VALUATION",
          subject: "Corporate Finance",
          estimatedDistilledPages: 2,
          noiseReductionRate: 85,
          executiveSummary: "Clean stock valuation handout.",
          sections: [
            {
              letter: "A",
              titleVi: "A. CÔNG THỨC ĐỊNH GIÁ",
              coreStatement: "Asset value equals the present value of expected cash flows.",
              overview: "Overview of dividend models.",
              bullets: [
                {
                  text: "Stock value is the present value of future dividends",
                  slide: 1,
                  evidence: "Stock Valuation",
                },
              ],
              formulas: [
                {
                  formulaRefs: ["F1"],
                  derivedFrom: [],
                  leadText: "Gordon model:",
                  latex: "P_0 = \\frac{D_1}{R - g}",
                  description: "",
                  variables: [],
                },
              ],
              subSections: [],
              takeaways: [],
              sourceSlides: [1],
            },
          ],
          omitted: [],
        },
      } as any);

      const note = await generateClutchNote({
        fileName: "Corporate_Finance.pptx",
        slideCount: 1,
        sources: [
          {
            id: "slide-1",
            label: "Slide 1",
            text: "Stock Valuation Principles. Gordon constant growth model gives P_0 and D_1.",
          },
        ],
        modelOverride: {} as any,
      });

      // Verification record must be present
      expect(note.verification).toBeDefined();
      expect(note.verification?.totalLedgerFormulas).toBe(1);
      expect(note.verification?.placedFormulaIds).toEqual(["F1"]);
      expect(note.verification?.uncapturedFormulaIds).toEqual([]);
      expect(note.verification?.contradictedFormulaCount).toBe(0);
      expect(note.verification?.coverageRatio).toBe(1);

      // Entire note strictly valid against clutchNoteSchema
      const parseRes = clutchNoteSchema.safeParse(note);
      expect(parseRes.success).toBe(true);
    });
  });

  describe("Section-Level Quality Gate Thresholds", () => {
    describe("evaluateSectionDropRate", () => {
      it("returns action 'SHIP' when drop rate is strictly less than 8% (< 8%)", () => {
        // 0 / 10 = 0%
        expect(evaluateSectionDropRate(10, 0)).toEqual({
          dropRate: 0,
          action: "SHIP",
        });

        // 1 / 20 = 5% (< 8%)
        const res = evaluateSectionDropRate(20, 1);
        expect(res.dropRate).toBe(0.05);
        expect(res.action).toBe("SHIP");

        // 7 / 100 = 7% (< 8%)
        expect(evaluateSectionDropRate(100, 7).action).toBe("SHIP");
      });

      it("returns action 'SHIP_AND_REGEN_BACKGROUND' when drop rate is between 8% and 20% inclusive", () => {
        // 8 / 100 = 8% (lower bound)
        const res8 = evaluateSectionDropRate(100, 8);
        expect(res8.dropRate).toBe(0.08);
        expect(res8.action).toBe("SHIP_AND_REGEN_BACKGROUND");

        // 1 / 10 = 10%
        const res10 = evaluateSectionDropRate(10, 1);
        expect(res10.dropRate).toBe(0.1);
        expect(res10.action).toBe("SHIP_AND_REGEN_BACKGROUND");

        // 2 / 10 = 20% (upper bound)
        const res20 = evaluateSectionDropRate(10, 2);
        expect(res20.dropRate).toBe(0.2);
        expect(res20.action).toBe("SHIP_AND_REGEN_BACKGROUND");
      });

      it("returns action 'RETRY_OR_OMIT' when drop rate exceeds 20% (> 20%)", () => {
        // 3 / 10 = 30% (> 20%)
        const res30 = evaluateSectionDropRate(10, 3);
        expect(res30.dropRate).toBe(0.3);
        expect(res30.action).toBe("RETRY_OR_OMIT");

        // 5 / 10 = 50%
        const res50 = evaluateSectionDropRate(10, 5);
        expect(res50.dropRate).toBe(0.5);
        expect(res50.action).toBe("RETRY_OR_OMIT");
      });
    });

    describe("runSectionQualityGate", () => {
      it("ships section immediately when drop rate is < 8%", async () => {
        const initialSection = createSection({
          id: "sec-a",
          letter: "A",
          titleVi: "A. CƠ CẤU VỐN",
          bulletPoints: Array(15).fill("Grounded bullet point"),
          groundedBullets: Array(15).fill({
            text: "Grounded bullet point",
            slide: 1,
            evidence: "Grounded evidence",
          }),
        });

        // 1 dropped out of 15 (6.7% drop rate < 8%)
        const verifiedSection = {
          ...initialSection,
          bulletPoints: Array(14).fill("Grounded bullet point"),
          groundedBullets: Array(14).fill({
            text: "Grounded bullet point",
            slide: 1,
            evidence: "Grounded evidence",
          }),
        };

        const onRegen = vi.fn();
        const gateRes = await runSectionQualityGate({
          initialSections: [initialSection],
          verifiedSections: [verifiedSection],
          onBackgroundRegenSection: onRegen,
        });

        expect(gateRes.sections.length).toBe(1);
        expect(gateRes.decisions[0].action).toBe("SHIP");
        expect(gateRes.decisions[0].omitted).toBe(false);
        expect(gateRes.backgroundRegenSections).toEqual([]);
        expect(onRegen).not.toHaveBeenCalled();
      });

      it("ships section and triggers background regeneration when drop rate is between 8% and 20%", async () => {
        const initialSection = createSection({
          id: "sec-b",
          letter: "B",
          titleVi: "B. ĐỊNH GIÁ TRÁI PHIẾU",
          bulletPoints: Array(10).fill("Grounded bullet point"),
          groundedBullets: Array(10).fill({
            text: "Grounded bullet point",
            slide: 1,
            evidence: "Grounded evidence",
          }),
        });

        // 1 dropped out of 10 (10% drop rate -> 8% - 20%)
        const verifiedSection = {
          ...initialSection,
          bulletPoints: Array(9).fill("Grounded bullet point"),
          groundedBullets: Array(9).fill({
            text: "Grounded bullet point",
            slide: 1,
            evidence: "Grounded evidence",
          }),
        };

        const onRegen = vi.fn();
        const gateRes = await runSectionQualityGate({
          initialSections: [initialSection],
          verifiedSections: [verifiedSection],
          onBackgroundRegenSection: onRegen,
        });

        expect(gateRes.sections.length).toBe(1);
        expect(gateRes.decisions[0].action).toBe("SHIP_AND_REGEN_BACKGROUND");
        expect(gateRes.decisions[0].omitted).toBe(false);
        expect(gateRes.backgroundRegenSections).toEqual(["B"]);
        expect(onRegen).toHaveBeenCalledWith(verifiedSection);
      });

      it("retries once with stricter grounding and keeps retried section when retry succeeds", async () => {
        const initialSection = createSection({
          id: "sec-c",
          letter: "C",
          titleVi: "C. CHI PHÍ SỬ DỤNG VỐN",
          bulletPoints: Array(10).fill("Original bullet"),
          groundedBullets: Array(10).fill({
            text: "Original bullet",
            slide: 1,
            evidence: "Evidence",
          }),
        });

        // 4 dropped out of 10 (40% drop rate > 20%)
        const verifiedSection = {
          ...initialSection,
          bulletPoints: Array(6).fill("Original bullet"),
          groundedBullets: Array(6).fill({
            text: "Original bullet",
            slide: 1,
            evidence: "Evidence",
          }),
        };

        const retriedSection = {
          ...initialSection,
          overview: "Regenerated with strict source grounding",
          bulletPoints: ["Strict bullet 1", "Strict bullet 2", "Strict bullet 3"],
          groundedBullets: [
            { text: "Strict bullet 1", slide: 1, evidence: "Evidence 1" },
            { text: "Strict bullet 2", slide: 1, evidence: "Evidence 2" },
            { text: "Strict bullet 3", slide: 1, evidence: "Evidence 3" },
          ],
        };

        let capturedPrompt = "";
        const retryFn = vi.fn().mockImplementation(async (sec: NoteSection, prompt: string) => {
          capturedPrompt = prompt;
          return retriedSection;
        });

        const gateRes = await runSectionQualityGate({
          initialSections: [initialSection],
          verifiedSections: [verifiedSection],
          retrySectionFn: retryFn,
        });

        expect(retryFn).toHaveBeenCalledTimes(1);
        expect(capturedPrompt).toContain("strict source slide grounding only");
        expect(gateRes.sections.length).toBe(1);
        expect(gateRes.sections[0].overview).toBe("Regenerated with strict source grounding");
        expect(gateRes.decisions[0].action).toBe("RETRY_OR_OMIT");
        expect(gateRes.decisions[0].omitted).toBe(false);
        expect(gateRes.omittedNotices).toEqual([]);
      });

      it("omits section with student-facing omission notice when drop rate > 20% and retry fails/null", async () => {
        const initialSection = createSection({
          id: "sec-d",
          letter: "D",
          titleVi: "D. HOÁN ĐỔI LÃI SUẤT",
          bulletPoints: Array(10).fill("Original bullet"),
          groundedBullets: Array(10).fill({
            text: "Original bullet",
            slide: 1,
            evidence: "Evidence",
          }),
        });

        // 3 dropped out of 10 (30% drop rate > 20%)
        const verifiedSection = {
          ...initialSection,
          bulletPoints: Array(7).fill("Original bullet"),
          groundedBullets: Array(7).fill({
            text: "Original bullet",
            slide: 1,
            evidence: "Evidence",
          }),
        };

        // retrySectionFn returns null (failed retry)
        const retryFn = vi.fn().mockResolvedValue(null);

        const gateRes = await runSectionQualityGate({
          initialSections: [initialSection],
          verifiedSections: [verifiedSection],
          retrySectionFn: retryFn,
        });

        expect(retryFn).toHaveBeenCalledTimes(1);
        expect(gateRes.sections.length).toBe(0);
        expect(gateRes.decisions[0].omitted).toBe(true);
        expect(gateRes.decisions[0].action).toBe("RETRY_OR_OMIT");
        expect(gateRes.decisions[0].notice).toContain(
          "Section D (D. HOÁN ĐỔI LÃI SUẤT) was omitted because >20% of its synthesized claims could not be verified against source slides.",
        );
        expect(gateRes.omittedNotices).toHaveLength(1);
        expect(gateRes.omittedNotices[0]).toBe(gateRes.decisions[0].notice);
      });
    });

    describe("runVerificationGate with enforceSectionQualityGate", () => {
      it("integrates section quality gate decisions and omitted notices into VerificationGateResult", async () => {
        const sources: SourceBlock[] = [
          {
            id: "s1",
            label: "Slide 1",
            text: "Gordon Growth model P_0 = D_1 / (R - g).",
          },
        ];

        const ledger: FormulaLedgerEntry[] = [
          {
            id: "F1",
            slide: 1,
            raw: "P0 = D1 / (R - g)",
            latex: "P_0 = \\frac{D_1}{R - g}",
            origin: "text",
            variables: [],
          },
        ];

        // Section A has 10 bullets, but 3 residual ungrounded bullets that will be dropped by Step 5
        const sectionA = createSection({
          id: "sec-a",
          letter: "A",
          titleVi: "A. ĐỊNH GIÁ",
          formulas: [
            createFormula({
              latex: "P_0 = \\frac{D_1}{R - g}",
              formulaRefs: ["F1"],
              slide: 1,
            }),
          ],
          groundedBullets: [
            { text: "Valid bullet 1", slide: 1, evidence: "Gordon Growth" },
            { text: "Valid bullet 2", slide: 1, evidence: "Gordon Growth" },
            { text: "Valid bullet 3", slide: 1, evidence: "Gordon Growth" },
            { text: "Valid bullet 4", slide: 1, evidence: "Gordon Growth" },
            { text: "Valid bullet 5", slide: 1, evidence: "Gordon Growth" },
            { text: "Valid bullet 6", slide: 1, evidence: "Gordon Growth" },
            { text: "Valid bullet 7", slide: 1, evidence: "Gordon Growth" },
            // Ungrounded bullets dropped by Step 5
            { text: "Ungrounded claim with number 99.1%", slide: 1, evidence: "Gordon Growth" },
            { text: "Ungrounded claim with number 99.2%", slide: 1, evidence: "Gordon Growth" },
            { text: "Ungrounded claim with number 99.3%", slide: 1, evidence: "Gordon Growth" },
          ],
          bulletPoints: [
            "Valid bullet 1",
            "Valid bullet 2",
            "Valid bullet 3",
            "Valid bullet 4",
            "Valid bullet 5",
            "Valid bullet 6",
            "Valid bullet 7",
            "Ungrounded claim with number 99.1%",
            "Ungrounded claim with number 99.2%",
            "Ungrounded claim with number 99.3%",
          ],
        });

        const onRegen = vi.fn();
        const result = await runVerificationGate({
          sections: [sectionA],
          sources,
          ledger,
          options: {
            skipVerifierLlm: true,
            maxRepairAttempts: 0,
            enforceSectionQualityGate: true,
            onBackgroundRegenSection: onRegen,
          },
        });

        // 3 dropped out of 10 = 30% drop rate > 20% -> retrySectionFn was not provided, so omitted!
        expect(result.decisions).toBeDefined();
        expect(result.decisions?.[0].sectionLetter).toBe("A");
        expect(result.decisions?.[0].omitted).toBe(true);
        expect(result.omittedNotices?.length).toBe(1);
        expect(result.omittedSectionNotices?.length).toBe(1);
        expect(result.sections.length).toBe(0);
      });
    });
  });

  describe("Financial Convention Pinning", () => {
    describe("extractFinancialConventions", () => {
      it("extracts day count conventions (30/360, Actual/365, Actual/360, Actual/Actual)", () => {
        const slides = [
          {
            label: "Slide 1",
            slide: 1,
            text: "Bond accrual uses 30/360 day count convention in US corporate bond markets.",
          },
          {
            label: "Slide 2",
            slide: 2,
            text: "Money market instruments use Actual/365 or Act/360 convention.",
          },
          {
            label: "Slide 3",
            slide: 3,
            text: "Treasury bond coupon calculations use Act/Act day count convention.",
          },
        ];

        const pins = extractFinancialConventions(slides);
        expect(pins.some((p) => p.category === "day_count" && p.label === "30/360")).toBe(true);
        expect(pins.some((p) => p.category === "day_count" && p.label === "Actual/365")).toBe(true);
        expect(pins.some((p) => p.category === "day_count" && p.label === "Actual/360")).toBe(true);
        expect(pins.some((p) => p.category === "day_count" && p.label === "Actual/Actual")).toBe(true);
      });

      it("extracts compounding frequency conventions (annual, semiannual, quarterly, monthly, continuous)", () => {
        const slides = [
          {
            label: "Slide 1",
            slide: 1,
            text: "Annual percentage rate with semiannual compounding for treasury notes.",
          },
          {
            label: "Slide 2",
            slide: 2,
            text: "Bank deposits feature monthly compounding or continuous compounding.",
          },
          {
            label: "Slide 3",
            slide: 3,
            text: "Commercial paper yields are compounded quarterly or compounded annually.",
          },
          {
            label: "Slide 4",
            slide: 4,
            text: "Trái phiếu doanh nghiệp ghép lãi bán niên theo quy chuẩn.",
          },
        ];

        const pins = extractFinancialConventions(slides);
        expect(pins.some((p) => p.category === "compounding" && p.label === "Semiannual Compounding")).toBe(true);
        expect(pins.some((p) => p.category === "compounding" && p.label === "Monthly Compounding")).toBe(true);
        expect(pins.some((p) => p.category === "compounding" && p.label === "Continuous Compounding")).toBe(true);
        expect(pins.some((p) => p.category === "compounding" && p.label === "Quarterly Compounding")).toBe(true);
        expect(pins.some((p) => p.category === "compounding" && p.label === "Annual Compounding")).toBe(true);
      });

      it("extracts timing conventions (beginning of period / annuity due vs end of period / ordinary annuity)", () => {
        const slides = [
          {
            label: "Slide 1",
            slide: 1,
            text: "Lease payments are made at the beginning of each period (annuity due).",
          },
          {
            label: "Slide 2",
            slide: 2,
            text: "Bond coupon payments are received at the end of each period (ordinary annuity).",
          },
          {
            label: "Slide 3",
            slide: 3,
            text: "Các khoản thanh toán phát sinh đầu kỳ so với cuối kỳ.",
          },
        ];

        const pins = extractFinancialConventions(slides);
        expect(pins.some((p) => p.category === "timing" && p.label.includes("Beginning of Period"))).toBe(true);
        expect(pins.some((p) => p.category === "timing" && p.label.includes("End of Period"))).toBe(true);
      });
    });

    describe("pinConventionsToSections", () => {
      it("pins detected conventions cleanly into section overview", () => {
        const sections: NoteSection[] = [
          createSection({
            id: "sec-a",
            letter: "A",
            titleVi: "A. ĐỊNH GIÁ NIÊN KIM",
            sourceSlides: [1],
            overview: "Tổng quan định giá niên kim.",
          }),
        ];

        const conventions: FinancialConventionPin[] = [
          {
            category: "day_count",
            label: "30/360",
            slide: 1,
            rawMatch: "30/360",
          },
          {
            category: "compounding",
            label: "Semiannual Compounding",
            slide: 1,
            rawMatch: "semiannual compounding",
          },
          {
            category: "timing",
            label: "Beginning of Period (Annuity Due)",
            slide: 1,
            rawMatch: "beginning of period",
          },
        ];

        const updated = pinConventionsToSections(sections, conventions);
        expect(updated[0].overview).toContain("[Conventions:");
        expect(updated[0].overview).toContain("30/360");
        expect(updated[0].overview).toContain("Semiannual Compounding");
        expect(updated[0].overview).toContain("Beginning of Period (Annuity Due)");
      });

      it("avoids redundant pinning if convention is already mentioned in section text", () => {
        const sections: NoteSection[] = [
          createSection({
            id: "sec-b",
            letter: "B",
            titleVi: "B. QUY ƯỚC 30/360",
            sourceSlides: [1],
            overview: "Áp dụng quy ước 30/360 ngày cho toàn bộ tính toán trái phiếu.",
          }),
        ];

        const conventions: FinancialConventionPin[] = [
          {
            category: "day_count",
            label: "30/360",
            slide: 1,
            rawMatch: "30/360",
          },
        ];

        const updated = pinConventionsToSections(sections, conventions);
        // Already mentioned in overview, so no duplicate [Conventions: 30/360] tag added
        expect(updated[0].overview).not.toContain("[Conventions:");
      });
    });

    describe("runVerificationGate convention pinning integration", () => {
      it("pins conventions and exposes pinnedConventions in result", async () => {
        const sources: SourceBlock[] = [
          {
            id: "s1",
            label: "Slide 1",
            text: "Fixed income notes use 30/360 day count with semiannual compounding.",
          },
        ];

        const ledger: FormulaLedgerEntry[] = [];

        const section = createSection({
          id: "sec-a",
          letter: "A",
          titleVi: "A. CỐ ĐỊNH THU NHẬP",
          sourceSlides: [1],
          overview: "Định giá chứng khoán nợ.",
          groundedBullets: [
            { text: "Bullet text", slide: 1, evidence: "Fixed income notes" },
          ],
          bulletPoints: ["Bullet text"],
        });

        const result = await runVerificationGate({
          sections: [section],
          sources,
          ledger,
          options: {
            skipVerifierLlm: true,
            maxRepairAttempts: 0,
            pinConventions: true,
          },
        });

        expect(result.pinnedConventions).toBeDefined();
        expect(result.pinnedConventions?.length).toBeGreaterThanOrEqual(2);
        expect(result.sections[0].overview).toContain("[Conventions:");
        expect(result.sections[0].overview).toContain("30/360");
        expect(result.sections[0].overview).toContain("Semiannual Compounding");
      });
    });

    describe("buildNotesPrompt convention integration", () => {
      it("includes <pinned_conventions> block in prompt when slide deck contains conventions", () => {
        const slides = [
          {
            label: "Slide 1",
            slide: 1,
            text: "Bond valuation under 30/360 day count with semiannual compounding and ordinary annuity payments at end of period.",
          },
        ];

        const prompt = buildNotesPrompt({
          fileName: "Bond_Valuation.pptx",
          slides,
        });

        expect(prompt).toContain("<pinned_conventions>");
        expect(prompt).toContain("30/360");
        expect(prompt).toContain("Semiannual Compounding");
        expect(prompt).toContain("End of Period (Ordinary Annuity)");
        expect(prompt).toContain("Financial Convention Pinning");
      });
    });
  });

  describe("Deterministic Formula Validity & Targeted Repair Triggering", () => {
    it("applyMarkPolicyAndGate refuses to stamp verified on corrupted or dangling formulas (T =, S ==, KaTeX error) even when formulaRefs is non-empty", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Stock Valuation Principles. Time horizon T and state S.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "T =",
          latex: "T =",
          origin: "ocr",
          variables: [],
        },
        {
          id: "F2",
          slide: 1,
          raw: "S ==",
          latex: "S ==",
          origin: "ocr",
          variables: [],
        },
        {
          id: "F3",
          slide: 1,
          raw: "\\frac{A}{",
          latex: "\\frac{A}{",
          origin: "ocr",
          variables: [],
        },
        {
          id: "F4",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      const section = createSection({
        id: "sec-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC ĐỊNH GIÁ",
        sourceSlides: [1],
        formulas: [
          createFormula({
            latex: "T =",
            formulaRefs: ["F1"],
            slide: 1,
          }),
          createFormula({
            latex: "S ==",
            formulaRefs: ["F2"],
            slide: 1,
          }),
          createFormula({
            latex: "\\frac{A}{",
            formulaRefs: ["F3"],
            slide: 1,
          }),
          createFormula({
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F4"],
            slide: 1,
          }),
        ],
      });

      const pipelineReport = await executeVerificationPipeline({
        sections: [section],
        sources,
        ledger,
        options: { skipVerifierLlm: true },
      });

      const result = applyMarkPolicyAndGate({
        sections: [section],
        sources,
        ledger,
        pipelineReport,
        repairAttempted: false,
      });

      const formulas = result.sections[0].formulas;
      // Formula 1 ("T ="): must be needs_review, not verified!
      expect(formulas[0].status).toBe("needs_review");
      expect(formulas[0].reviewReason).toContain("deterministic validity");

      // Formula 2 ("S =="): must be needs_review, not verified!
      expect(formulas[1].status).toBe("needs_review");
      expect(formulas[1].reviewReason).toContain("deterministic validity");

      // Formula 3 ("\frac{A}{"): must be needs_review, not verified!
      expect(formulas[2].status).toBe("needs_review");
      expect(formulas[2].reviewReason).toContain("deterministic validity");

      // Formula 4 ("P_0 = \frac{D_1}{R - g}"): valid, must be verified!
      expect(formulas[3].status).toBe("verified");

      // The 3 corrupted formulas incremented needsReviewCount
      expect(result.needsReviewCount).toBeGreaterThanOrEqual(3);
    });

    it("runVerificationGate invokes repairFn when critical core formulas (uncaptured_error) occur", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Risk and return fundamentals. CAPM equation: E(Ri) = Rf + Beta_i * (E(RM) - Rf).",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "E(Ri) = Rf + Beta_i * (E(RM) - Rf)",
          latex: "E(R_i) = R_f + \\beta_i [E(R_M) - R_f]",
          origin: "text",
          variables: [],
        },
        {
          id: "F2",
          slide: 1,
          raw: "Beta_i = Cov(Ri, RM) / Var(RM)",
          latex: "\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}",
          origin: "text",
          variables: [],
        },
      ];

      // Note initially only captures F1; F2 is completely missing and NOT in omitted list (uncaptured_error!)
      const section = createSection({
        id: "sec-a",
        letter: "A",
        titleVi: "A. MÔ HÌNH CAPM",
        sourceSlides: [1],
        formulas: [
          createFormula({
            latex: "E(R_i) = R_f + \\beta_i [E(R_M) - R_f]",
            formulaRefs: ["F1"],
            slide: 1,
          }),
        ],
        bulletPoints: ["Khái niệm CAPM cơ bản."],
        groundedBullets: [
          { text: "Khái niệm CAPM cơ bản.", slide: 1, evidence: "Risk and return fundamentals" },
        ],
      });

      let repairFnCalled = false;
      let repairPromptReceived = "";

      const repairFn = vi.fn(async (prompt: string) => {
        repairFnCalled = true;
        repairPromptReceived = prompt;

        // Return repaired section that now includes missing formula F2
        return [
          createSection({
            id: "sec-a",
            letter: "A",
            titleVi: "A. MÔ HÌNH CAPM",
            sourceSlides: [1],
            formulas: [
              createFormula({
                latex: "E(R_i) = R_f + \\beta_i [E(R_M) - R_f]",
                formulaRefs: ["F1"],
                slide: 1,
              }),
              createFormula({
                latex: "\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}",
                formulaRefs: ["F2"],
                slide: 1,
              }),
            ],
            bulletPoints: ["Khái niệm CAPM cơ bản."],
            groundedBullets: [
              { text: "Khái niệm CAPM cơ bản.", slide: 1, evidence: "Risk and return fundamentals" },
            ],
          }),
        ];
      });

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          repairFn,
          maxRepairAttempts: 1,
          skipVerifierLlm: true,
        },
      });

      expect(repairFnCalled).toBe(true);
      expect(repairPromptReceived).toContain("UNCAPTURED SOURCE FORMULAS");
      expect(repairPromptReceived).toContain("F2");
      expect(result.repairAttempted).toBe(true);
      expect(result.verification.placedFormulaIds).toContain("F1");
      expect(result.verification.placedFormulaIds).toContain("F2");
      expect(result.verification.uncapturedFormulaIds.length).toBe(0);
    });

    it("runVerificationGate invokes repairFn when critical formula symbol errors occur", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Discounted cash flow model using price P_0, dividend D_1, discount rate R and growth rate g.",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P0 = D1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "text",
          variables: [],
        },
      ];

      // Note has a formula with ungrounded hallucinated symbol \psi_{mystery} not present on the slide
      const section = createSection({
        id: "sec-a",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ",
        sourceSlides: [1],
        formulas: [
          createFormula({
            latex: "P_0 = \\frac{D_1}{R - g} + \\psi_{mystery}",
            slide: 1,
          }),
        ],
        bulletPoints: ["Định giá chiết khấu dòng tiền."],
        groundedBullets: [
          { text: "Định giá chiết khấu dòng tiền.", slide: 1, evidence: "Discounted cash flow model" },
        ],
      });

      let repairFnCalled = false;
      const repairFn = vi.fn(async (_prompt: string) => {
        repairFnCalled = true;
        // Repair fixes the ungrounded symbol back to clean P_0 = \frac{D_1}{R - g}
        return [
          createSection({
            id: "sec-a",
            letter: "A",
            titleVi: "A. ĐỊNH GIÁ",
            sourceSlides: [1],
            formulas: [
              createFormula({
                latex: "P_0 = \\frac{D_1}{R - g}",
                formulaRefs: ["F1"],
                slide: 1,
              }),
            ],
            bulletPoints: ["Định giá chiết khấu dòng tiền."],
            groundedBullets: [
              { text: "Định giá chiết khấu dòng tiền.", slide: 1, evidence: "Discounted cash flow model" },
            ],
          }),
        ];
      });

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          repairFn,
          maxRepairAttempts: 1,
          skipVerifierLlm: true,
        },
      });

      expect(repairFnCalled).toBe(true);
      expect(result.repairAttempted).toBe(true);
      expect(result.sections[0].formulas[0].latex).toBe("P_0 = \\frac{D_1}{R - g}");
    });

    it("runVerificationGate invokes repairModel when repairFn is omitted but repairModel is provided", async () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "CAPM model E(R) = Rf + Beta * (RM - Rf).",
        },
      ];

      const ledger: FormulaLedgerEntry[] = [
        {
          id: "F1",
          slide: 1,
          raw: "E(R) = Rf + Beta * (RM - Rf)",
          latex: "E(R) = R_f + \\beta (R_M - R_f)",
          origin: "text",
          variables: [],
        },
      ];

      // Missing F1 entirely -> uncaptured_error
      const section = createSection({
        id: "sec-a",
        letter: "A",
        titleVi: "A. CAPM",
        sourceSlides: [1],
        formulas: [],
        bulletPoints: ["Giới thiệu mô hình CAPM."],
        groundedBullets: [
          { text: "Giới thiệu mô hình CAPM.", slide: 1, evidence: "CAPM model" },
        ],
      });

      // Mock generateObject return for the repairModel pass
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          title: "CHAPTER 11: CAPM",
          subject: "Corporate Finance",
          estimatedDistilledPages: 2,
          noiseReductionRate: 85,
          executiveSummary: "Repaired CAPM handout.",
          sections: [
            {
              titleVi: "A. CAPM",
              overview: "Tổng quan mô hình.",
              coreStatement: "Rủi ro hệ thống quyết định lợi suất.",
              bullets: [
                { text: "Giới thiệu mô hình CAPM.", slide: 1, evidence: "CAPM model" },
              ],
              formulas: [
                {
                  formulaRefs: ["F1"],
                  derivedFrom: [],
                  leadText: "Công thức CAPM:",
                  latex: "E(R) = R_f + \\beta (R_M - R_f)",
                  description: "",
                  variables: [],
                },
              ],
              subSections: [],
              takeaways: [],
              sourceSlides: [1],
            },
          ],
          omitted: [],
        },
      } as any);

      const mockModel = { modelId: "test-repair-model" } as any;

      const result = await runVerificationGate({
        sections: [section],
        sources,
        ledger,
        options: {
          repairModel: mockModel,
          maxRepairAttempts: 1,
          skipVerifierLlm: true,
        },
      });

      expect(vi.mocked(generateObject)).toHaveBeenCalled();
      expect(result.repairAttempted).toBe(true);
      expect(result.verification.placedFormulaIds).toContain("F1");
    });
  });
});
