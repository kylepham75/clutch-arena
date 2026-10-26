import { describe, it, expect } from "vitest";
import {
  generateClutchNotePdfHtml,
  formatSlideList,
  renderSlideChip,
  renderItemStatusBadge,
  renderFormulaStatusBadge,
  renderDivergenceNoticeHtml,
  getUncapturedFormulas,
} from "@/lib/notes/export-pdf";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import type { ClutchNote, NoteFormula } from "@/lib/schemas/notes";

describe("Clutch Arena Watermarked PDF Export Generator", () => {
  it("generates concise study handout HTML with watermark, boxed equations, subSections, and KaTeX", () => {
    const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE);

    // 1. Must include KaTeX stylesheet for vector math rendering
    expect(html).toContain("katex.min.css");

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

    // 7. Must include crisp bordered Key Takeaways box with structured sub-bullets
    expect(html).toContain("pdf-takeaways-card");
    expect(html).toContain("KEY TAKEAWAYS");
    expect(html).toContain("Constant growth → Gordon model");
    expect(html).toContain("otherwise the model breaks down");
    expect(html).toContain("katex");

    // 8. Must include print CSS rules with page-break-inside avoid
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-inside: avoid");
    expect(html).toContain("break-inside: avoid");
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

  it("renders status badges correctly for items and formulas", () => {
    expect(renderItemStatusBadge("contradicted")).toContain("pdf-status-contradicted");
    expect(renderItemStatusBadge("contradicted")).toContain("Contradicted");
    expect(renderItemStatusBadge("needs_review")).toContain("pdf-status-review");
    expect(renderItemStatusBadge("needs_review")).toContain("Needs review");
    expect(renderItemStatusBadge("unsupported")).toContain("pdf-status-review");
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
    expect(renderFormulaStatusBadge(formulaReview)).toContain("Needs review");

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

  it("renders enriched notes with grounded bullets, verification badges, divergence notices, warning banners, and uncaptured formulas", () => {
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
            summaryPoints: [],
          },
        },
      ],
    };

    const html = generateClutchNotePdfHtml(enrichedNote);

    // 1. Ingestion Warning Banner
    expect(html).toContain("pdf-warning-banner");
    expect(html).toContain("Ingestion & Verification Notices");
    expect(html).toContain("2 Notices");
    expect(html).toContain("OCR detected low confidence table values");
    expect(html).toContain("Mathematical contradiction between slide text");
    expect(html).toContain("Formulas or tables from these slides should be double-checked");

    // 2. Global and Section Divergence Notices
    expect(html).toContain("pdf-global-divergences");
    expect(html).toContain("Global Notation Convention");
    expect(html).toContain("pdf-section-divergences");
    expect(html).toContain("Perpetuity Notation in Section A");

    // 3. Slide Chips
    expect(html).toContain("pdf-slide-chip");
    expect(html).toContain("Slide 4");
    expect(html).toContain("Slide 7");
    expect(html).toContain("Slide 8");
    expect(html).toContain("Slide 9");
    expect(html).toContain("Slide 10");

    // 4. Status Badges on Formulas
    expect(html).toContain("pdf-status-verified");
    expect(html).toContain("Verified");
    expect(html).toContain("pdf-status-derived");
    expect(html).toContain("Derived from F1");
    expect(html).toContain("pdf-status-review");
    expect(html).toContain("Needs review");
    expect(html).toContain("pdf-status-contradicted");
    expect(html).toContain("Contradicted");

    // 5. Formula Review Reasons
    expect(html).toContain("Denominator should be R - g, not R + g.");
    expect(html).toContain("Variable b is not defined on slide 10.");

    // 6. Grounded Bullets with Slide Chips and Badges
    expect(html).toContain("pdf-grounded-bullets");
    expect(html).toContain("Slide does not explicitly mention bear markets.");
    expect(html).toContain("Slide equation explicitly incorporates P_1.");

    // 7. Takeaway Items with Slide Chips and Badges
    expect(html).toContain("Unverified assumption on growth duration.");
    expect(html).toContain("Direct contradiction with Slide 6 note.");

    // 8. Formula-level Divergence Card
    expect(html).toContain("Denominator Sign Error");
    expect(html).toContain("Standard Textbook Form");
    expect(html).toContain("Lecturer's Form");

    // 9. Uncaptured Source Formulas Section
    expect(html).toContain("pdf-uncaptured-section");
    expect(html).toContain("Uncaptured Source Formulas");
    expect(html).toContain("1 Formula Omitted");
    expect(html).toContain("F3");
    expect(html).toContain("Earnings Per Share");
    expect(html).toContain("Appeared solely in practice exercise #4 on slide 12");

    // 10. Required CSS Classes Verification
    expect(html).toContain(".pdf-slide-chip");
    expect(html).toContain(".pdf-status-badge");
    expect(html).toContain(".pdf-status-verified");
    expect(html).toContain(".pdf-status-derived");
    expect(html).toContain(".pdf-status-review");
    expect(html).toContain(".pdf-status-contradicted");
    expect(html).toContain(".pdf-divergence-card");
    expect(html).toContain(".pdf-uncaptured-section");
    expect(html).toContain(".pdf-warning-banner");
  });

  it("extracts uncaptured formulas correctly", () => {
    const noteWithLedger: ClutchNote = {
      ...SAMPLE_CLUTCH_NOTE,
      verification: {
        status: "passed",
        repairAttempted: false,
        coverageRatio: 0.5,
        totalLedgerFormulas: 2,
        placedFormulaIds: ["F1"],
        uncapturedFormulaIds: ["F2"],
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
        warnings: [],
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
          slide: 15,
          raw: "g = ROE * b",
          latex: "g = \\text{ROE} \\times b",
          variables: [],
          origin: "text",
          evidence: "Appendix slide 15",
        },
      ],
      omitted: [
        {
          formulaId: "F2",
          reason: "Moved to supplementary appendix",
        },
      ],
    };

    const uncaptured = getUncapturedFormulas(noteWithLedger);
    expect(uncaptured).toHaveLength(1);
    expect(uncaptured[0].id).toBe("F2");
    expect(uncaptured[0].slide).toBe(15);
    expect(uncaptured[0].reason).toBe("Moved to supplementary appendix");
  });
});
