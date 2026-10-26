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
} from "@/lib/notes/verification-gate";
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
});
