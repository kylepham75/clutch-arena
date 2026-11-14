import { describe, it, expect } from "vitest";
import {
  detectVisionAdjudicationNeed,
  extractGeneralizableRecipeFromExample,
  stripWorkedArithmeticNoise,
  triageSlide,
  triageSlideDeck,
} from "../../lib/notes/slide-triage";
import {
  triagedSlideSchema,
  sourceAtomSchema,
  type TriagedSlide,
  type SourceAtom,
} from "../../lib/schemas/notes";
import type { SourceBlock } from "../../lib/schemas/ingestion";

describe("Slide Triage & Region Classification", () => {
  describe("detectVisionAdjudicationNeed", () => {
    it("detects Private Use Area (PUA) glyphs and replacement characters", () => {
      const puaSlide = "Required return: R = \uF0B4 10% and sum \uF0E5 D_t";
      const result = detectVisionAdjudicationNeed(puaSlide);
      expect(result.needed).toBe(true);
      expect(result.reasons.some((r) => r.includes("Private Use Area"))).toBe(true);

      const replacementSlide = "The terminal value is \uFFFD and box □ ▯";
      const repResult = detectVisionAdjudicationNeed(replacementSlide);
      expect(repResult.needed).toBe(true);
      expect(repResult.reasons.some((r) => r.includes("replacement characters"))).toBe(true);
    });

    it("detects dangling mathematical operators at line ends or standalone equals", () => {
      const danglingEquals = "Consider the horizon time\nT =\nNext step";
      const res1 = detectVisionAdjudicationNeed(danglingEquals);
      expect(res1.needed).toBe(true);
      expect(res1.reasons.some((r) => r.includes("Dangling mathematical operators"))).toBe(true);

      const standaloneDoubleEquals = "Value calculation:\nS ==\nResult";
      const res2 = detectVisionAdjudicationNeed(standaloneDoubleEquals);
      expect(res2.needed).toBe(true);

      const orphanEquals = "Expected Return\n= 0.12";
      const res3 = detectVisionAdjudicationNeed(orphanEquals);
      expect(res3.needed).toBe(true);

      const longDanglingPhrase = "(Average of Independent, Identical Risks) =";
      const res4 = detectVisionAdjudicationNeed(longDanglingPhrase);
      expect(res4.needed).toBe(true);
    });

    it("detects sparse formula and diagram placeholder slides", () => {
      const sparseFormula = "Formula:\n";
      const res1 = detectVisionAdjudicationNeed(sparseFormula);
      expect(res1.needed).toBe(true);
      expect(res1.reasons.some((r) => r.includes("Sparse text with formula/diagram indicator"))).toBe(true);

      const sparseVietnamese = "Công thức định giá:";
      const res2 = detectVisionAdjudicationNeed(sparseVietnamese);
      expect(res2.needed).toBe(true);

      const sparseExhibit = "Exhibit 9.1";
      const res3 = detectVisionAdjudicationNeed(sparseExhibit);
      expect(res3.needed).toBe(true);
    });

    it("passes clean, well-formed slides without triggering vision adjudication", () => {
      const cleanSlide =
        "CHAPTER 9: STOCK VALUATION\nThe price of a stock is the present value of all expected future dividends.\nP_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}";
      const result = detectVisionAdjudicationNeed(cleanSlide);
      expect(result.needed).toBe(false);
      expect(result.reasons).toEqual([]);
    });
  });

  describe("extractGeneralizableRecipeFromExample", () => {
    it("extracts multi-step procedure while stripping company numbers and dollar plug-ins", () => {
      const exampleText = `
        Example 9.5: Non-Constant Growth Stock Valuation
        Suppose Company ABC is currently paying dividend D_0 = $2.00.
        Step 1: Calculate the dividends during the high-growth period (D_1, D_2, D_3) using g_1
        Step 2: Estimate the terminal stock price at Year 3 using Constant Growth Model: P_3 = D_4 / (R - g_2)
        Step 3: Discount all cash flows (D_1, D_2, D_3 and P_3) back to Year 0 at discount rate R to find P_0
        = 2.50 / (0.10 - 0.05) = 50
      `;

      const steps = extractGeneralizableRecipeFromExample(exampleText);
      expect(steps.length).toBe(3);
      expect(steps[0]).toContain("Step 1: Calculate the dividends during the high-growth period");
      expect(steps[0]).toContain("D_1, D_2, D_3");
      expect(steps[1]).toContain("Step 2: Estimate the terminal stock price at Year 3");
      expect(steps[1]).toContain("P_3 = D_4 / (R - g_2)");
      expect(steps[2]).toContain("Step 3: Discount all cash flows");
      expect(steps[2]).toContain("back to Year 0 at discount rate R to find P_0");
      expect(steps.some((s) => s.includes("2.50 / (0.10 - 0.05)"))).toBe(false);
    });

    it("extracts numbered action steps", () => {
      const numberedText = `
        Practice Problem: Two-Stage DDM
        1. Calculate the present value of non-constant dividends
        2. Compute the terminal price P_t = D_{t+1} / (R - g)
        3. Discount the terminal price to present value Year 0
        4. Sum all present values to obtain stock price P_0
      `;

      const steps = extractGeneralizableRecipeFromExample(numberedText);
      expect(steps.length).toBe(4);
      expect(steps[0]).toContain("Calculate the present value of non-constant dividends");
      expect(steps[1]).toContain("P_t = D_{t+1} / (R - g)");
      expect(steps[3]).toContain("obtain stock price P_0");
    });

    it("extracts sequence-word procedure sentences", () => {
      const sequenceText = `
        Valuation Method:
        First, find the terminal value P_N = D_{N+1} / (R - g).
        Then, discount all expected future dividends and P_N back to Year 0 using rate R.
        Finally, sum the discounted cash flows to determine current price P_0.
      `;

      const steps = extractGeneralizableRecipeFromExample(sequenceText);
      expect(steps.length).toBe(3);
      expect(steps[0]).toContain("First, find the terminal value P_N = D_{N+1} / (R - g)");
      expect(steps[1]).toContain("Then, discount all expected future dividends");
      expect(steps[2]).toContain("Finally, sum the discounted cash flows to determine current price P_0");
    });

    it("returns empty array for pure arithmetic plug-in slides with no steps", () => {
      const plugInOnly = `
        Example:
        P_0 = 2.50 / (0.10 - 0.05) = 50
        0.26 = 0.04 + 1.1 * (0.24 - 0.04)
      `;
      const steps = extractGeneralizableRecipeFromExample(plugInOnly);
      expect(steps).toEqual([]);
    });
  });

  describe("stripWorkedArithmeticNoise", () => {
    it("strips pure numeric substitution lines and administrative boilerplate", () => {
      const dirtyText = [
        "CHAPTER 9: COMMON STOCK VALUATION",
        "The value of a share of stock is the present value of all future dividends.",
        "P_0 = D_1 / (R - g)",
        "= (0.21 - 0.05 + 0.14) / 3 = 0.10",
        "0.26 = 0.04 + 1.1 × (0.24 - 0.04)",
        "= 2.50 / (0.10 - 0.05) = 50",
        "Requires R > g, otherwise the model breaks down",
        "Where: D_1 = dividend next year, R = required return, g = growth rate",
        "© Pearson Education 2024. All rights reserved.",
        "Scan QR code for attendance",
        "Slide 12 of 45",
      ].join("\n");

      const cleaned = stripWorkedArithmeticNoise(dirtyText);

      expect(cleaned).toContain("CHAPTER 9: COMMON STOCK VALUATION");
      expect(cleaned).toContain("The value of a share of stock is the present value of all future dividends.");
      expect(cleaned).toContain("P_0 = D_1 / (R - g)");
      expect(cleaned).toContain("Requires R > g, otherwise the model breaks down");
      expect(cleaned).toContain("Where: D_1 = dividend next year, R = required return, g = growth rate");

      // Verify stripped noise
      expect(cleaned).not.toContain("= (0.21 - 0.05 + 0.14) / 3 = 0.10");
      expect(cleaned).not.toContain("0.26 = 0.04 + 1.1 × (0.24 - 0.04)");
      expect(cleaned).not.toContain("= 2.50 / (0.10 - 0.05) = 50");
      expect(cleaned).not.toContain("Pearson Education");
      expect(cleaned).not.toContain("Scan QR code");
      expect(cleaned).not.toContain("Slide 12 of 45");
    });

    it("preserves accounting identities and symbolic formulas", () => {
      const accountingText = [
        "Net Working Capital = Current Assets - Current Liabilities",
        "Operating Cycle = Inventory Period + Accounts Receivable Period",
        "Cash Cycle = Operating Cycle - Accounts Payable Period",
        "g < R",
      ].join("\n");

      const cleaned = stripWorkedArithmeticNoise(accountingText);
      expect(cleaned).toContain("Net Working Capital = Current Assets - Current Liabilities");
      expect(cleaned).toContain("Operating Cycle = Inventory Period + Accounts Receivable Period");
      expect(cleaned).toContain("Cash Cycle = Operating Cycle - Accounts Payable Period");
      expect(cleaned).toContain("g < R");
    });
  });

  describe("triageSlide & triageSlideDeck", () => {
    it("1. classifies pure administrative noise (cover slide, attendance QR, Q&A) as EXCLUDE_NOISE", () => {
      const coverSource: SourceBlock = {
        id: "s1",
        label: "Slide 1",
        text: "Corporate Finance - Chapter 9\nInstructor: Dr. Jane Doe\nEmail: jane.doe@university.edu\nOffice Hours: Mon/Wed 2-4 PM",
      };
      const triagedCover = triageSlide(coverSource, 0);
      expect(triagedCover.tags).toContain("ADMIN");
      expect(triagedCover.disposition).toBe("EXCLUDE_NOISE");
      expect(triagedSlideSchema.parse(triagedCover)).toBeDefined();

      const qrSource: SourceBlock = {
        id: "s2",
        label: "Slide 2",
        text: "Attendance Check-in\nScan QR Code to mark your attendance for today's lecture.",
      };
      const triagedQR = triageSlide(qrSource, 1);
      expect(triagedQR.tags).toContain("ADMIN");
      expect(triagedQR.disposition).toBe("EXCLUDE_NOISE");

      const qnaSource: SourceBlock = {
        id: "s3",
        label: "Slide 3",
        text: "Thank you for listening!\nAny Questions? Q&A Session\nSee you next week!",
      };
      const triagedQnA = triageSlide(qnaSource, 2);
      expect(triagedQnA.tags).toContain("ADMIN");
      expect(triagedQnA.disposition).toBe("EXCLUDE_NOISE");
    });

    it("2. classifies Agenda / Learning Objectives slide as PLANNING_SIGNAL_ONLY", () => {
      const agendaSource: SourceBlock = {
        id: "s4",
        label: "Slide 4",
        text: "Chapter 9 Agenda:\n1. Basic Principles of Stock Valuation\n2. The Dividend Growth Model (Gordon Model)\n3. Non-constant Growth Stocks\n4. Preferred Stock Valuation",
      };
      const triagedAgenda = triageSlide(agendaSource, 3);
      expect(triagedAgenda.tags).toContain("ADMIN");
      expect(triagedAgenda.disposition).toBe("PLANNING_SIGNAL_ONLY");
      expect(triagedSlideSchema.parse(triagedAgenda)).toBeDefined();

      const objectivesSource: SourceBlock = {
        id: "s5",
        label: "Slide 5",
        text: "Learning Objectives:\n- Understand how stock prices depend on future dividends\n- Apply the Constant Growth DDM to value common stock\n- Solve multi-stage dividend discount problems",
      };
      const triagedObj = triageSlide(objectivesSource, 4);
      expect(triagedObj.tags).toContain("ADMIN");
      expect(triagedObj.disposition).toBe("PLANNING_SIGNAL_ONLY");
    });

    it("3. preserves mixed slide (administrative note + critical exam rule / formula) as INCLUDE", () => {
      const mixedSource: SourceBlock = {
        id: "s6",
        label: "Slide 6",
        text: "Midterm Exam Tip & Course Announcement:\nNote: For the Gordon Growth Model, make sure Requires R > g, otherwise the model breaks down!\nAttendance link is posted in the LMS.",
      };
      const triagedMixed = triageSlide(mixedSource, 5);
      expect(triagedMixed.tags).toContain("ADMIN");
      expect(triagedMixed.tags).toContain("EXAM_HINT");
      expect(triagedMixed.disposition).toBe("INCLUDE");
      expect(triagedMixed.reason).toContain("Mixed slide");
      expect(triagedSlideSchema.parse(triagedMixed)).toBeDefined();
    });

    it("4. classifies worked example with multi-stage procedure as EXTRACT_RECIPE_ONLY", () => {
      const exampleSource: SourceBlock = {
        id: "s7",
        label: "Slide 7",
        text: [
          "Example: Non-Constant Growth Valuation",
          "Suppose Company XYZ pays dividends with high initial growth.",
          "Step 1: Calculate the dividends during the high-growth period (D_1, D_2, D_3)",
          "Step 2: Estimate the terminal stock price at Year 3 using Constant Growth Model: P_3 = D_4 / (R - g)",
          "Step 3: Discount all cash flows (D_1, D_2, D_3 and P_3) back to Year 0 at discount rate R to find P_0",
          "= 2.50 / (0.10 - 0.05) = 50",
        ].join("\n"),
      };
      const triagedExample = triageSlide(exampleSource, 6);
      expect(triagedExample.tags).toContain("WORKED_EXAMPLE");
      expect(triagedExample.disposition).toBe("EXTRACT_RECIPE_ONLY");
      expect(triagedExample.extractedRecipeSteps.length).toBe(3);
      expect(triagedExample.cleanedText).not.toContain("= 2.50 / (0.10 - 0.05) = 50");
      expect(triagedSlideSchema.parse(triagedExample)).toBeDefined();
    });

    it("5. classifies pure arithmetic plug-in slide as EXCLUDE_NOISE", () => {
      const pureArithmeticSource: SourceBlock = {
        id: "s8",
        label: "Slide 8",
        text: "Exercise Solution:\n0.26 = 0.04 + 1.1 * (0.24 - 0.04)\n= 0.26",
      };
      const triagedArithmetic = triageSlide(pureArithmeticSource, 7);
      expect(triagedArithmetic.tags).toContain("WORKED_EXAMPLE");
      expect(triagedArithmetic.disposition).toBe("EXCLUDE_NOISE");
      expect(triagedArithmetic.extractedRecipeSteps).toEqual([]);
      expect(triagedSlideSchema.parse(triagedArithmetic)).toBeDefined();
    });

    it("6. consolidates animation build sequence (Slide 10 subset -> Slide 11 superset)", () => {
      const sources: SourceBlock[] = [
        {
          id: "s10",
          label: "Slide 10",
          text: "Dividend Discount Model\n- Stock value equals present value of future dividends\n- Constant growth assumption simplifies valuation",
        },
        {
          id: "s11",
          label: "Slide 11",
          text: "Dividend Discount Model\n- Stock value equals present value of future dividends\n- Constant growth assumption simplifies valuation\n- Constant growth formula: P_0 = D_1 / (R - g)\n- Requires R > g for model validity",
        },
      ];

      const deckResult = triageSlideDeck(sources);
      expect(deckResult.slides.length).toBe(2);

      const slide10 = deckResult.slides[0];
      const slide11 = deckResult.slides[1];

      expect(slide10.disposition).toBe("CONSOLIDATE_BUILD");
      expect(slide10.reason).toContain("consolidated into slide 11");
      expect(slide11.disposition).toBe("INCLUDE");

      expect(deckResult.excludedSlideNumbers).toContain(10);
      expect(deckResult.includedSlides.map((s) => s.slide)).toContain(11);
    });

    it("7. validates every TriagedSlide and SourceAtom against Zod schemas and checks ID formatting", () => {
      const sources: SourceBlock[] = [
        {
          id: "s1",
          label: "Slide 1",
          text: "Corporate Finance\nInstructor: Dr. John\nOffice hours Mon 2-4",
        },
        {
          id: "s2",
          label: "Slide 2",
          text: "Agenda:\n1. Gordon Growth Model\n2. Multi-stage Growth",
        },
        {
          id: "s3",
          label: "Slide 3",
          text: "Gordon Growth Model: P_0 = D_1 / (R - g)\nRequires R > g, otherwise the model breaks down!\nNote: Always check dividend timing D_0 vs D_1.",
        },
        {
          id: "s4",
          label: "Slide 4",
          text: "Example: Two-Stage DDM\nStep 1: Calculate the non-constant dividends D_1, D_2\nStep 2: Calculate terminal value P_2 = D_3 / (R - g)\nStep 3: Discount back to Year 0 to find P_0\n= 100 / 0.10 = 1000",
        },
        {
          id: "s5",
          label: "Slide 5",
          text: "Practice:\n0.26 = 0.04 + 1.1 * (0.24 - 0.04)",
        },
      ];

      const result = triageSlideDeck(sources);

      // Validate all slides
      expect(result.slides.length).toBe(5);
      result.slides.forEach((slide) => {
        const validated = triagedSlideSchema.parse(slide);
        expect(validated).toBeDefined();
      });

      // Verify partitions
      expect(result.includedSlides.length).toBe(1);
      expect(result.includedSlides[0].slide).toBe(3);
      expect(result.planningSignalSlides.length).toBe(1);
      expect(result.planningSignalSlides[0].slide).toBe(2);
      expect(result.excludedSlideNumbers).toContain(1); // Admin noise
      expect(result.excludedSlideNumbers).toContain(5); // Pure arithmetic

      // Validate all atoms
      expect(result.extractedAtoms.length).toBeGreaterThan(0);
      result.extractedAtoms.forEach((atom) => {
        const validated = sourceAtomSchema.parse(atom);
        expect(validated).toBeDefined();

        // Check ID formatting: S<slide>:R<n> or S<slide>:B<n>
        expect(atom.id).toMatch(/^S\d+:[RB]\d+$/);

        if (atom.kind === "procedure") {
          expect(atom.id).toMatch(/^S\d+:R\d+$/);
          expect(atom.isWorkedExampleDerived).toBe(true);
        } else if (atom.kind === "boundary_condition" || atom.kind === "exam_hint") {
          expect(atom.id).toMatch(/^S\d+:B\d+$/);
          expect(atom.isWorkedExampleDerived).toBe(false);
        }
      });

      // Verify specific recipe atoms from Slide 4
      const recipeAtoms = result.extractedAtoms.filter((a) => a.slide === 4);
      expect(recipeAtoms.length).toBe(3);
      expect(recipeAtoms[0].id).toBe("S4:R1");
      expect(recipeAtoms[1].id).toBe("S4:R2");
      expect(recipeAtoms[2].id).toBe("S4:R3");

      // Verify boundary/hint atoms from Slide 3
      const hintAtoms = result.extractedAtoms.filter((a) => a.slide === 3);
      expect(hintAtoms.length).toBeGreaterThan(0);
      expect(hintAtoms[0].id).toBe("S3:B1");
    });

    it("8. retains substantive slides titled 'Chapter X Overview' as INCLUDE instead of dropping as ADMIN noise", () => {
      const substantiveChapterSlide: SourceBlock = {
        id: "s9",
        label: "Slide 9",
        text: "Chapter 10 Overview\nFirms choose capital structure by trading off the present value of interest tax shields against financial distress and agency costs.",
      };
      const triaged = triageSlide(substantiveChapterSlide, 0);
      expect(triaged.tags).toContain("CONCEPT");
      expect(triaged.disposition).toBe("INCLUDE");
    });
  });
});
