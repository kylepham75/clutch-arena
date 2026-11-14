import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateClutchNotePdfHtml,
  buildPrintableNotesHtml,
  exportClutchNotePdf,
  exportNotesToPdf,
  toPublishedHandout,
  renderTeachingBlockHtml,
  formatSlideList,
  renderSlideChip,
  renderItemStatusBadge,
  renderFormulaStatusBadge,
  renderDivergenceNoticeHtml,
  renderPdfFormula,
  cleanLatexForFallback,
  type PdfWatermarkOptions,
} from "@/lib/notes/export-pdf";
import { CLUTCH_ARENA_BRAND_NAME, CLUTCH_ARENA_ICON_DATA_URL } from "@/lib/notes/brand-assets";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import type { ClutchNote, NoteFormula, TeachingBlock } from "@/lib/schemas/notes";

describe("Clutch Arena Watermarked PDF Export Generator", () => {
  it("generates concise study handout HTML with watermark, boxed equations, subSections, and KaTeX", () => {
    const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE);

    // 1. Must include KaTeX stylesheet for vector math rendering (katex 0.19.0)
    expect(html).toContain("katex.min.css");
    expect(html).toContain("https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css");
    expect(html).not.toContain("katex@0.16.8");

    // 2. Must include official Clutch Arena branding & Pro note label
    expect(html).toContain("CLUTCH ARENA");
    expect(html).toContain("PRO NOTE");
    expect(html).toContain("Clutch Notes AI");

    // 3. Must include big centered watermark with Clutch Arena icon and name below
    expect(html).toContain("watermark-overlay");
    expect(html).toContain("watermark-center-badge");
    expect(html).toContain("watermark-big-icon");
    expect(html).toContain("watermark-name-below");
    expect(html).toContain("CLUTCH ARENA");
    expect(html).not.toContain("CLUTCH ARENA · PRO NOTES");

    // 4. Must include concise section headers & sub-case headings
    expect(html).toContain("CHAPTER 9: STOCK VALUATION");
    expect(html).toContain("NGUYÊN LÝ CƠ BẢN");
    expect(html).toContain("CÔNG THỨC TỔNG QUÁT");
    expect(html).toContain("CASE 1: Zero Growth Model");
    expect(html).toContain("CASE 2: Constant Growth Model");
    expect(html).toContain("VALUE OF PREFERENCE SHARE");

    // 5. Must include slide chips on sections from sourceSlides
    expect(html).toContain("Slide 4");
    expect(html).toContain("Slides 5–9, 23–26");
    expect(html).toContain("Slides 14–17");
    expect(html).toContain("Slides 18–22");

    // 6. Must include LaTeX rendered boxed formulas and "Trong đó:" variable block
    expect(html).toContain("pdf-formula-card");
    expect(html).toContain("Trong đó:");
    expect(html).toContain("pdf-variable-list");

    // 7. Must include crisp bordered Key Takeaways box with structured sub-bullets & boundary condition
    expect(html).toContain("pdf-takeaways-card");
    expect(html).toContain("KEY TAKEAWAYS");
    expect(html).toContain("Constant growth → Gordon model");
    expect(html).toContain("Make sure g &lt; R, otherwise the model breaks down");
    expect(html).toContain("katex");

    // 8. Must include A4 print CSS rules with page-break and orphan/widow hygiene
    expect(html).toContain("@page");
    expect(html).toContain("size: A4");
    expect(html).toContain("margin: 16mm 18mm 18mm 18mm");
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-inside: avoid");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("page-break-after: avoid");
    expect(html).toContain("break-after: avoid");
    expect(html).toContain("orphans: 3");
    expect(html).toContain("widows: 3");
  });

  describe("toPublishedHandout", () => {
    it("strips compiler QA debug fields (formulaLedger, omitted, verification) while preserving sections and divergence notices", () => {
      const legacyNote: ClutchNote = {
        ...SAMPLE_CLUTCH_NOTE,
        formulaLedger: [
          {
            id: "F1",
            slide: 4,
            raw: "P0 = D1/(1+R)",
            latex: "P_0 = \\frac{D_1}{1 + R}",
            variables: [],
            origin: "omml",
          },
        ],
        omitted: [
          {
            formulaId: "F2",
            reason: "Exercise drill",
          },
        ],
        verification: {
          status: "passed",
          repairAttempted: false,
          coverageRatio: 0.8,
          totalLedgerFormulas: 2,
          placedFormulaIds: ["F1"],
          uncapturedFormulaIds: ["F2"],
          unsupportedClaimsRemoved: 0,
          needsReviewCount: 1,
          contradictedFormulaCount: 0,
          evidenceMatchRatio: 1,
          numberGroundingPassed: true,
          ungroundedNumbers: [],
          symbolGroundingPassed: true,
          ungroundedSymbols: [],
          claimVerdicts: [],
          formulaResults: [],
          warnings: ["Warning 1"],
          divergenceNotices: [
            {
              ruleId: "div-pdf-1",
              packId: "pack-1",
              title: "PDF Divergence Rule",
              message: "Notice message for PDF",
              slide: 4,
            },
          ],
        },
      };

      const published = toPublishedHandout(legacyNote);

      expect((published as Record<string, unknown>).formulaLedger).toBeUndefined();
      expect((published as Record<string, unknown>).omitted).toBeUndefined();
      expect((published as Record<string, unknown>).verification).toBeUndefined();
      expect(published.divergenceNotices).toHaveLength(1);
      expect(published.divergenceNotices[0].title).toBe("PDF Divergence Rule");
    });
  });

  it("formats slide lists correctly into ranges", () => {
    expect(formatSlideList([])).toBe("");
    expect(formatSlideList([4])).toBe("Slide 4");
    expect(formatSlideList([5, 6, 7])).toBe("Slides 5–7");
    expect(formatSlideList([1, 2, 4, 5, 6, 10])).toBe("Slides 1–2, 4–6, 10");
    expect(formatSlideList([9, 5, 6, 5, 7, 8])).toBe("Slides 5–9");
  });

  it("renders slide chips for single, ranges, and custom labels", () => {
    expect(renderSlideChip(4)).toContain("Slide 4");
    expect(renderSlideChip(undefined, [5, 6, 7])).toContain("Slides 5–7");
    expect(renderSlideChip(undefined, undefined, "Custom Chip")).toContain("Custom Chip");
    expect(renderSlideChip()).toBe("");
  });

  it("renders status badges correctly for items and formulas, suppressing yellow needs_review badges", () => {
    expect(renderItemStatusBadge("contradicted")).toContain("pdf-status-contradicted");
    expect(renderItemStatusBadge("contradicted")).toContain("Contradicted");
    expect(renderItemStatusBadge("needs_review")).toBe("");
    expect(renderItemStatusBadge("unsupported")).toBe("");
    expect(renderItemStatusBadge("verified")).toBe("");

    const formulaVerified: NoteFormula = {
      name: "",
      latex: "P_0 = \\frac{D}{R}",
      variables: [],
      status: "verified",
    };
    expect(renderFormulaStatusBadge(formulaVerified)).toContain("pdf-status-verified");

    const formulaDerived: NoteFormula = {
      name: "",
      latex: "P_0 = \\frac{D}{R}",
      variables: [],
      status: "derived",
      derivedFrom: ["F1", "F2"],
    };
    expect(renderFormulaStatusBadge(formulaDerived)).toContain("Derived from F1, F2");

    const formulaDerivedSimple: NoteFormula = {
      name: "",
      latex: "P_0 = \\frac{D}{R}",
      variables: [],
      status: "derived",
    };
    expect(renderFormulaStatusBadge(formulaDerivedSimple)).toContain("Derived");

    const formulaReview: NoteFormula = {
      name: "",
      latex: "P_0 = \\frac{D}{R}",
      variables: [],
      status: "needs_review",
    };
    expect(renderFormulaStatusBadge(formulaReview)).toBe("");

    const formulaContradicted: NoteFormula = {
      name: "",
      latex: "P_0 = \\frac{D}{R}",
      variables: [],
      status: "contradicted",
    };
    expect(renderFormulaStatusBadge(formulaContradicted)).toContain("Contradicted");
  });

  it("renders divergence notice HTML with side-by-side KaTeX formulas", () => {
    const noticeHtml = renderDivergenceNoticeHtml({
      ruleId: "fin-rule-1",
      packId: "corp-fin",
      title: "Cost of Capital Notation Divergence",
      message: "The lecturer uses $k_e$ whereas standard textbooks use $R_e$.",
      slide: 14,
      lecturerForm: "k_e = \\frac{D_1}{P_0} + g",
      textbookForm: "R_e = \\frac{D_1}{P_0} + g",
    });

    expect(noticeHtml).toContain("pdf-divergence-card");
    expect(noticeHtml).toContain("Textbook Divergence Notice");
    expect(noticeHtml).toContain("Slide 14");
    expect(noticeHtml).toContain("Cost of Capital Notation Divergence");
    expect(noticeHtml).toContain("Lecturer's Form");
    expect(noticeHtml).toContain("Standard Textbook Form");
    expect(noticeHtml).toContain("katex");
  });

  describe("Teaching Blocks & Recipe HTML Rendering", () => {
    it("renders recipe block with structured recipe container and ordered step list", () => {
      const recipeBlock: TeachingBlock = {
        id: "recipe-tb-1",
        kind: "recipe",
        heading: "Gordon Growth 3-Step Valuation",
        text: "Follow these three steps:",
        steps: [
          "Find expected dividend D_1",
          "Determine discount rate R",
          "Calculate P_0 = D_1 / (R - g)",
        ],
        slideCitations: [7],
        supportAtomIds: [],
        supportMode: "faithful_paraphrase",
        formulaRefs: [],
        symbolBindingIds: [],
      };

      const html = renderTeachingBlockHtml(recipeBlock);
      expect(html).toContain("pdf-recipe-card");
      expect(html).toContain("Recipe");
      expect(html).toContain("Gordon Growth 3-Step Valuation");
      expect(html).toContain("pdf-recipe-steps");
      expect(html).toContain("Find expected dividend");
      expect(html).toContain("D_1");
      expect(html).toContain("Slide 7");
    });

    it("renders caution block with boundary condition styling", () => {
      const cautionBlock: TeachingBlock = {
        id: "caution-tb-1",
        kind: "caution",
        heading: "Boundary Condition Pitfall",
        text: "Requires R > g; otherwise denominator becomes negative.",
        slideCitations: [8],
        supportAtomIds: [],
        supportMode: "faithful_paraphrase",
        formulaRefs: [],
        symbolBindingIds: [],
      };

      const html = renderTeachingBlockHtml(cautionBlock);
      expect(html).toContain("pdf-caution-card");
      expect(html).toContain("Caution / Boundary");
      expect(html).toContain("Boundary Condition Pitfall");
      expect(html).toContain("Requires R &gt; g");
    });

    it("renders recipe subSections with pdf-recipe-card container", () => {
      const noteWithRecipeSub: ClutchNote = {
        ...SAMPLE_CLUTCH_NOTE,
        sections: [
          {
            id: "sec-rec-pdf",
            letter: "A",
            titleVi: "A. RECIPE SECTION",
            titleEn: "",
            overview: "",
            bulletPoints: [],
            subSections: [
              {
                heading: "Step-by-Step Calculation Recipe",
                leadIn: "Quy trình giải bài tập:",
                bulletPoints: ["Step 1: Compute g", "Step 2: Compute P_0"],
                formulas: [],
              },
            ],
            formulas: [],
            sourceSlides: [5],
          },
        ],
      };

      const html = generateClutchNotePdfHtml(noteWithRecipeSub);
      expect(html).toContain("pdf-recipe-card");
      expect(html).toContain("pdf-recipe-heading");
      expect(html).toContain("Step-by-Step Calculation Recipe");
      expect(html).toContain("pdf-recipe-steps");
      expect(html).toContain("Step 1: Compute g");
    });
  });

  it("renders enriched notes with grounded bullets, verified badges, divergence notices, and zero debug tables or yellow notices", () => {
    const enrichedNote: ClutchNote = {
      ...SAMPLE_CLUTCH_NOTE,
      verification: {
        status: "marked",
        repairAttempted: false,
        coverageRatio: 0.8,
        totalLedgerFormulas: 5,
        placedFormulaIds: ["F1", "F2"],
        uncapturedFormulaIds: ["F3"],
        unsupportedClaimsRemoved: 0,
        needsReviewCount: 1,
        contradictedFormulaCount: 1,
        evidenceMatchRatio: 0.9,
        numberGroundingPassed: true,
        ungroundedNumbers: [],
        symbolGroundingPassed: true,
        ungroundedSymbols: [],
        claimVerdicts: [],
        formulaResults: [],
        warnings: [
          "Slide 12: OCR detected low confidence table values.",
          "Slide 20: Mathematical contradiction between slide text and textbook convention.",
        ],
        divergenceNotices: [
          {
            ruleId: "global-div-1",
            packId: "corp-fin",
            title: "Global Notation Convention",
            message: "All rates expressed as annual nominal percentages unless stated.",
          },
          {
            ruleId: "sec-div-1",
            packId: "corp-fin",
            title: "Perpetuity Notation in Section A",
            message: "Section A uses PV whereas deck uses V_0.",
            slide: 4,
          },
        ],
      },
      formulaLedger: [
        {
          id: "F1",
          slide: 4,
          raw: "P0 = D1/(1+R) + P1/(1+R)",
          latex: "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
          variables: [],
          origin: "omml",
        },
        {
          id: "F3",
          slide: 12,
          raw: "EPS = Net Income / Shares",
          latex: "\\text{EPS} = \\frac{\\text{Net Income}}{\\text{Shares}}",
          label: "Earnings Per Share",
          variables: [],
          origin: "text",
          evidence: "Practice exercise #4 on slide 12",
          isExerciseOnly: true,
        },
      ],
      omitted: [
        {
          formulaId: "F3",
          reason: "Appeared solely in practice exercise #4 on slide 12",
        },
      ],
      sections: [
        {
          id: "sec-1",
          letter: "A",
          titleVi: "A. GROUNDED & VERIFIED VALUATION",
          titleEn: "",
          overview: "",
          bulletPoints: [],
          subSections: [],
          sourceSlides: [4],
          groundedBullets: [
            {
              text: "Dividends represent direct cash distributions to shareholders.",
              slide: 4,
              evidence: "Dividends paid quarterly",
              status: "verified",
            },
            {
              text: "Capital gains yield may turn negative in bear markets.",
              slide: 4,
              evidence: "Price depreciation risk",
              status: "needs_review",
              reviewReason: "Slide does not explicitly mention bear markets.",
            },
            {
              text: "Stock value is completely independent of future resale price.",
              slide: 4,
              evidence: "Resale price is part of one-period return",
              status: "contradicted",
              reviewReason: "Slide equation explicitly incorporates P_1.",
            },
          ],
          formulas: [
            {
              name: "Gordon Growth Equation",
              latex: "P_0 = \\frac{D_1}{R - g}",
              variables: [],
              slide: 7,
              status: "verified",
            },
            {
              name: "Derived Discount Rate",
              latex: "R = \\frac{D_1}{P_0} + g",
              variables: [],
              slide: 8,
              status: "derived",
              derivedFrom: ["F1"],
            },
            {
              name: "Flagged Formula",
              latex: "P_0 = \\frac{D_0}{R + g}",
              variables: [],
              slide: 9,
              status: "contradicted",
              reviewReason: "Denominator should be R - g, not R + g.",
              divergenceNotices: [
                {
                  ruleId: "div-formula-1",
                  packId: "corp-fin",
                  title: "Denominator Sign Error",
                  message: "Slides use addition instead of subtraction.",
                  lecturerForm: "P_0 = \\frac{D_0}{R + g}",
                  textbookForm: "P_0 = \\frac{D_1}{R - g}",
                  slide: 9,
                },
              ],
            },
            {
              name: "Needs Review Formula",
              latex: "g = b \\times \\text{ROE}",
              variables: [],
              slide: 10,
              status: "needs_review",
              reviewReason: "Variable b is not defined on slide 10.",
            },
          ],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              {
                point: "First takeaway point",
                subBullets: [],
                slide: 4,
                status: "verified",
              },
              {
                point: "Second takeaway point needs review",
                subBullets: [],
                slide: 5,
                status: "needs_review",
                reviewReason: "Unverified assumption on growth duration.",
              },
              {
                point: "Third takeaway point contradicted",
                subBullets: [],
                slide: 6,
                status: "contradicted",
                reviewReason: "Direct contradiction with Slide 6 note.",
              },
            ],
            boundaryConditions: "R > g strictly required",
            summaryPoints: [],
          },
        },
      ],
    };

    const html = generateClutchNotePdfHtml(enrichedNote);

    // 1. Elimination of Ingestion Warning Banner & Uncaptured Debug Section
    expect(html).not.toContain("pdf-warning-banner");
    expect(html).not.toContain("Ingestion & Verification Notices");
    expect(html).not.toContain("pdf-uncaptured-section");
    expect(html).not.toContain("Uncaptured Source Formulas");
    expect(html).not.toContain("Formula Omitted");
    expect(html).not.toContain("Formulas Omitted");
    expect(html).not.toContain("Earnings Per Share");

    // 2. Yellow Badge Elimination: Zero "Needs review" badges
    expect(html).not.toContain("Needs review");
    expect(html).not.toContain("Variable b is not defined on slide 10.");

    // 3. Global and Section Divergence Notices preserved
    expect(html).toContain("pdf-global-divergences");
    expect(html).toContain("Global Notation Convention");
    expect(html).toContain("pdf-section-divergences");
    expect(html).toContain("Perpetuity Notation in Section A");

    // 4. Slide Chips preserved
    expect(html).toContain("pdf-slide-chip");
    expect(html).toContain("Slide 4");
    expect(html).toContain("Slide 7");
    expect(html).toContain("Slide 8");
    expect(html).toContain("Slide 9");
    expect(html).toContain("Slide 10");

    // 5. Status Badges on Formulas preserved
    expect(html).toContain("pdf-status-verified");
    expect(html).toContain("Verified");
    expect(html).toContain("pdf-status-derived");
    expect(html).toContain("Derived from F1");
    expect(html).toContain("pdf-status-contradicted");
    expect(html).toContain("Contradicted");

    // 6. Formula Review Reasons for Contradicted preserved
    expect(html).toContain("Denominator should be R - g, not R + g.");

    // 7. Grounded Bullets with Slide Chips and Badges preserved
    expect(html).toContain("pdf-grounded-bullets");
    expect(html).toContain("Slide equation explicitly incorporates P_1.");

    // 8. Takeaway Items with Slide Chips and Badges preserved
    expect(html).toContain("Direct contradiction with Slide 6 note.");

    // 9. Formula-level Divergence Card preserved
    expect(html).toContain("Denominator Sign Error");
    expect(html).toContain("Standard Textbook Form");
    expect(html).toContain("Lecturer's Form");

    // 10. Boundary conditions rendered prominently in Key Takeaways
    expect(html).toContain("Boundary Condition:");
    expect(html).toContain("R &gt; g strictly required");
  });

  describe("Publication Boundary: Elimination of Uncaptured Debug Tables", () => {
    it("never renders uncaptured formula sections or uncaptured warnings even when passed legacy notes with uncapturedFormulaIds", () => {
      const legacyNoteWithUncaptured: ClutchNote = {
        ...SAMPLE_CLUTCH_NOTE,
        verification: {
          status: "marked",
          repairAttempted: false,
          coverageRatio: 0.5,
          totalLedgerFormulas: 3,
          placedFormulaIds: ["F1"],
          omittedByRuleFormulaIds: ["F2"],
          uncapturedFormulaIds: ["F3"],
          unsupportedClaimsRemoved: 0,
          needsReviewCount: 0,
          contradictedFormulaCount: 0,
          evidenceMatchRatio: 1,
          numberGroundingPassed: true,
          ungroundedNumbers: [],
          symbolGroundingPassed: true,
          ungroundedSymbols: [],
          claimVerdicts: [],
          formulaResults: [],
          warnings: ["Uncaptured formula IDs: F3"],
          divergenceNotices: [],
        },
        formulaLedger: [
          {
            id: "F1",
            slide: 4,
            raw: "P0 = D1/(1+R)",
            latex: "P_0 = \\frac{D_1}{1 + R}",
            variables: [],
            origin: "omml",
          },
          {
            id: "F2",
            slide: 5,
            raw: "R = (D1/P0) + g",
            latex: "R = \\frac{D_1}{P_0} + g",
            label: "Intermediate Derivation",
            variables: [],
            origin: "text",
          },
          {
            id: "F3",
            slide: 10,
            raw: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
            latex: "\\text{WACC} = \\frac{E}{V} R_e + \\frac{D}{V} R_d (1 - T_c)",
            label: "Cost of Capital",
            variables: [],
            origin: "text",
          },
        ],
        omitted: [
          {
            formulaId: "F2",
            status: "omitted_by_rule",
            reason: "Intermediate derivation rearrangement step",
          },
          {
            formulaId: "F3",
            status: "uncaptured_error",
            reason: "Unplaced core syllabus formula",
          },
        ],
      };

      const html = generateClutchNotePdfHtml(legacyNoteWithUncaptured);

      expect(html).not.toContain("pdf-uncaptured-section");
      expect(html).not.toContain("Uncaptured Source Formulas");
      expect(html).not.toContain("Formula Omitted");
      expect(html).not.toContain("Unplaced core syllabus formula");
      expect(html).not.toContain("pdf-warning-banner");
      expect(html).not.toContain("Uncaptured formula IDs");
    });

    it("ensures .pdf-formula-card CSS uses white-space: normal and overflow-wrap: break-word without overflow-x: auto", () => {
      const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE);

      // Verify .pdf-formula-card CSS rule block
      const formulaCardCssMatch = html.match(/\.pdf-formula-card\s*\{([^}]+)\}/);
      expect(formulaCardCssMatch).toBeDefined();
      const cssRules = formulaCardCssMatch![1];

      expect(cssRules).toContain("white-space: normal");
      expect(cssRules).toContain("overflow-wrap: break-word");
      expect(cssRules).toContain("word-break: break-word");
      expect(cssRules).not.toContain("overflow-x: auto");
      expect(cssRules).not.toContain("overflow-x: scroll");
    });

    it("renders all terms of long accounting formulas (Cash Identity) including 'Fixed Assets' without clipping", () => {
      const longFormulaNote: ClutchNote = {
        ...SAMPLE_CLUTCH_NOTE,
        sections: [
          {
            id: "sec-long-formula",
            letter: "A",
            titleVi: "A. CƠ CHẾ DÒNG TIỀN THEO BẢNG CÂN ĐỐI KẾ TOÁN",
            titleEn: "Cash Identity from Balance Sheet",
            overview: "Đồng nhất thức tiền mặt phân rã chi tiết nguồn và sử dụng vốn.",
            bulletPoints: [],
            subSections: [],
            sourceSlides: [10],
            formulas: [
              {
                name: "Full Balance Sheet Cash Identity",
                latex:
                  "\\text{Cash} = \\text{Long-Term Debt} + \\text{Equity} + \\text{Current Liabilities} - \\text{Other (non-cash) Current Assets} - \\text{Fixed Assets}",
                variables: [],
                slide: 10,
                status: "verified",
              },
            ],
          },
        ],
      };

      const html = generateClutchNotePdfHtml(longFormulaNote);

      expect(html).toContain("pdf-formula-card");
      expect(html).toContain("Cash");
      expect(html).toContain("Long-Term Debt");
      expect(html).toContain("Equity");
      expect(html).toContain("Current Liabilities");
      expect(html).toContain("Other (non-cash) Current Assets");
      expect(html).toContain("Fixed Assets");
    });
  });

  describe("Print Window Isolation & Zero Script Injection (SA-19)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("ensures buildPrintableNotesHtml output contains zero inline <script> tags", () => {
      const html = buildPrintableNotesHtml(SAMPLE_CLUTCH_NOTE);
      expect(html).not.toMatch(/<script[\s>]/i);
      expect(html).not.toContain("window.onload");
    });

    it("isolates printWindow.opener to null and triggers safe parent print in exportNotesToPdf", () => {
      const mockDocument = {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
      };
      const mockPrintWindow = {
        opener: "initial-parent-opener" as unknown,
        document: mockDocument,
        focus: vi.fn(),
        print: vi.fn(),
      };
      const openMock = vi.fn().mockReturnValue(mockPrintWindow);
      vi.stubGlobal("window", {
        open: openMock,
        location: { origin: "http://localhost:3000" },
      });

      vi.useFakeTimers();
      exportNotesToPdf(SAMPLE_CLUTCH_NOTE);

      expect(openMock).toHaveBeenCalledWith("", "_blank");
      expect(mockPrintWindow.opener).toBeNull();
      expect(mockDocument.open).toHaveBeenCalled();
      expect(mockDocument.write).toHaveBeenCalled();
      expect(mockDocument.close).toHaveBeenCalled();
      expect(mockPrintWindow.focus).toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(mockPrintWindow.print).toHaveBeenCalled();
    });
  });

  describe("KaTeX 0.19.0 & Robust Formula Fallback Hardening (Zero Raw katex-error Leaks)", () => {
    it("ensures katex@0.19.0 stylesheet matching package.json is embedded in generated HTML with zero references to 0.16.8", () => {
      const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE);
      expect(html).toContain("https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css");
      expect(html).not.toContain("katex@0.16.8");
    });

    it("hardens core formula blocks against broken LaTeX syntax and PUA symbols with zero katex-error leakage", () => {
      const noteWithEdgeCaseFormulas: ClutchNote = {
        ...SAMPLE_CLUTCH_NOTE,
        sections: [
          {
            id: "sec-edge",
            letter: "A",
            titleVi: "A. CÔNG THỨC KIỂM THỬ GIỚI HẠN",
            titleEn: "Edge-Case Formula Section",
            overview: "Kiểm tra tính an toàn khi gặp công thức chứa ký tự PUA và lỗi cú pháp LaTeX.",
            bulletPoints: [],
            subSections: [],
            sourceSlides: [5],
            formulas: [
              {
                name: "Broken Syntax Formula in Section",
                latex: "WACC = \\frac{E}{V} R_e + {\\brokenMacro",
                variables: [
                  {
                    symbol: "\\brokenSym{",
                    definition: "Broken variable symbol definition",
                  },
                ],
                slide: 5,
                status: "verified",
              },
              {
                name: "PUA Symbol Formula in Section",
                latex: "\\text{Growth} \uF0E1 = \uF061 + \uF062 \uF0B4 X",
                variables: [],
                slide: 5,
                status: "verified",
              },
            ],
          },
        ],
      };

      const html = generateClutchNotePdfHtml(noteWithEdgeCaseFormulas);

      // 1. Must NOT leak raw .katex-error markup or color:#cc0000
      expect(html).not.toContain("<span class=\"katex-error\"");
      expect(html).not.toContain("class=\"katex-error\"");
      expect(html).not.toContain("color:#cc0000");

      // 2. Broken formula and variable must use pdf-math-fallback
      expect(html).toContain("pdf-formula-card");
      expect(html).toContain("pdf-math-fallback");

      // 3. PUA symbols must be normalized to standard Unicode (↑, α, β, ×)
      expect(html).toContain("↑");
      expect(html).toContain("α");
      expect(html).toContain("β");
      expect(html).toContain("×");
    });

    it("verifies renderPdfFormula correctly renders valid KaTeX, normalizes PUA, and gracefully falls back on error", () => {
      // 1. Valid formula -> produces KaTeX output with zero katex-error
      const validHtml = renderPdfFormula("P_0 = \\frac{D_1}{R - g}", true);
      expect(validHtml).toContain("katex");
      expect(validHtml).not.toContain("katex-error");
      expect(validHtml).not.toContain("pdf-math-fallback");

      // 2. PUA symbols -> mapped and rendered cleanly
      const puaHtml = renderPdfFormula("\uF0E1 Rate = \uF0B4 5", true);
      expect(puaHtml).toContain("katex");
      expect(puaHtml).not.toContain("katex-error");
      expect(puaHtml).toContain("↑");
      expect(puaHtml).toContain("×");

      // 3. Broken LaTeX syntax -> fallback with .pdf-math-fallback, zero .katex-error
      const brokenHtml = renderPdfFormula("{unclosed brace only", true);
      expect(brokenHtml).toContain("pdf-math-fallback");
      expect(brokenHtml).toContain("unclosed brace only");
      expect(brokenHtml).not.toContain("<span class=\"katex-error\"");
      expect(brokenHtml).not.toContain("class=\"katex-error\"");

      // 4. Inline mode (displayMode = false) produces span.pdf-math-fallback
      const brokenInline = renderPdfFormula("k_e = \\broken{foo", false);
      expect(brokenInline).toContain("<span class=\"pdf-math-fallback\">");
      expect(brokenInline).not.toContain("<span class=\"katex-error\"");
      expect(brokenInline).not.toContain("class=\"katex-error\"");

      // 5. Empty or whitespace string returns empty string
      expect(renderPdfFormula("")).toBe("");
      expect(renderPdfFormula("   ")).toBe("");
    });

    it("verifies cleanLatexForFallback strips macros and formats math into human-readable text", () => {
      expect(cleanLatexForFallback("\\text{WACC} = \\frac{E}{V} R_e + \\frac{D}{V} R_d (1 - T_c)"))
        .toBe("WACC = (E / V) R_e + (D / V) R_d (1 - T_c)");

      expect(cleanLatexForFallback("P_0 = {broken"))
        .toBe("P_0 = broken");

      expect(cleanLatexForFallback("\\alpha \\times \\beta \\div \\gamma"))
        .toBe("α × β ÷ γ");

      expect(cleanLatexForFallback("\uF0E1 Return = \uF0B1 5%"))
        .toBe("↑ Return = ± 5%");
    });
  });

  describe("Tutor & Guild Tier Custom Watermarked PDF Exports", () => {
    it("renders custom watermark brand name and logo URL cleanly for tutor tier", () => {
      const options: PdfWatermarkOptions = {
        tier: "tutor",
        customBrandName: "IELTS Master Guild",
        customLogoUrl: "https://example.com/guild-logo.png",
      };

      const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE, options);

      // Centered watermark overlay checks
      expect(html).toContain("watermark-overlay");
      expect(html).toContain("watermark-center-badge");
      expect(html).toContain('<img src="https://example.com/guild-logo.png" class="watermark-big-icon" alt="IELTS Master Guild" />');
      expect(html).toContain('<div class="watermark-name-below">IELTS Master Guild</div>');

      // Top toolbar checks
      expect(html).toContain('<img src="https://example.com/guild-logo.png" class="brand-header-icon" alt="IELTS Master Guild" />');
      expect(html).toContain("<span>IELTS Master Guild · Clutch Notes AI</span>");

      // Footer checks
      expect(html).toContain("<div>IELTS Master Guild · Concise Study Handout</div>");

      // Default brand name must not appear in the watermark, toolbar title, or footer brand slot
      expect(html).not.toContain('<div class="watermark-name-below">CLUTCH ARENA</div>');
      expect(html).not.toContain("<span>CLUTCH ARENA · Clutch Notes AI</span>");
      expect(html).not.toContain("<div>CLUTCH ARENA · Concise Study Handout</div>");
    });

    it("enforces default CLUTCH ARENA watermark and logo when non-tutor tiers attempt custom branding override", () => {
      const nonTutorTiers = ["pro", "pro_monthly", "cram_pass", "contender"];

      for (const tier of nonTutorTiers) {
        const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE, {
          tier,
          customBrandName: "Unauthorized Guild Brand",
          customLogoUrl: "https://example.com/unauthorized.png",
        });

        // Must reject custom brand and enforce official branding
        expect(html).not.toContain("Unauthorized Guild Brand");
        expect(html).not.toContain("https://example.com/unauthorized.png");

        expect(html).toContain(`<div class="watermark-name-below">${CLUTCH_ARENA_BRAND_NAME}</div>`);
        expect(html).toContain(`<span>${CLUTCH_ARENA_BRAND_NAME} · Clutch Notes AI</span>`);
        expect(html).toContain(`<div>${CLUTCH_ARENA_BRAND_NAME} · Concise Study Handout</div>`);
        expect(html).toContain(CLUTCH_ARENA_ICON_DATA_URL);
      }
    });

    it("allows direct branding configuration when tier is omitted", () => {
      const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE, {
        customBrandName: "Direct Academy",
        customLogoUrl: "https://example.com/academy.png",
      });

      expect(html).toContain('<div class="watermark-name-below">Direct Academy</div>');
      expect(html).toContain("<span>Direct Academy · Clutch Notes AI</span>");
      expect(html).toContain("<div>Direct Academy · Concise Study Handout</div>");
      expect(html).toContain('<img src="https://example.com/academy.png" class="watermark-big-icon" alt="Direct Academy" />');
    });

    it("sanitizes customBrandName against HTML/XSS injection", () => {
      const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE, {
        tier: "tutor",
        customBrandName: "<script>alert('xss')</script>\"&'Test",
        customLogoUrl: "https://example.com/clean.png",
      });

      // Must be HTML-escaped
      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).toContain("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;&quot;&amp;&#039;Test");
    });

    it("falls back to default icon if customLogoUrl is not a safe protocol or format", () => {
      const unsafeUrls = [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,<script>alert(1)</script>",
        "blob:http://example.com/evil",
      ];

      for (const unsafeUrl of unsafeUrls) {
        const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE, {
          tier: "tutor",
          customBrandName: "Safe Tutor",
          customLogoUrl: unsafeUrl,
        });

        expect(html).not.toContain(unsafeUrl);
        expect(html).toContain(CLUTCH_ARENA_ICON_DATA_URL);
        expect(html).toContain('<div class="watermark-name-below">Safe Tutor</div>');
      }
    });

    it("supports data:image/ URIs and relative / paths for customLogoUrl", () => {
      const dataUri = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
      const htmlData = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE, {
        tier: "tutor",
        customBrandName: "SVG Guild",
        customLogoUrl: dataUri,
      });
      expect(htmlData).toContain(dataUri);

      const relPath = "/logos/guild-logo.png";
      const htmlRel = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE, {
        tier: "tutor",
        customBrandName: "Relative Path Guild",
        customLogoUrl: relPath,
      });
      expect(htmlRel).toContain(relPath);
    });

    it("passes watermark options through exportClutchNotePdf to popup print window", () => {
      const mockDocument = {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
      };
      const mockPrintWindow = {
        opener: "initial-parent-opener" as unknown,
        document: mockDocument,
        focus: vi.fn(),
        print: vi.fn(),
      };
      const openMock = vi.fn().mockReturnValue(mockPrintWindow);
      vi.stubGlobal("window", {
        open: openMock,
        location: { origin: "http://localhost:3000" },
      });

      exportClutchNotePdf(SAMPLE_CLUTCH_NOTE, {
        tier: "tutor",
        customBrandName: "Export Tutor Guild",
        customLogoUrl: "https://example.com/guild-icon.png",
      });

      expect(openMock).toHaveBeenCalledWith("", "_blank");
      expect(mockPrintWindow.opener).toBeNull();
      expect(mockDocument.write).toHaveBeenCalled();
      const writtenHtml = mockDocument.write.mock.calls[0][0];
      expect(writtenHtml).toContain("Export Tutor Guild");
      expect(writtenHtml).toContain("https://example.com/guild-icon.png");
    });
  });
});
