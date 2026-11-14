import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import type {
  ClutchNote,
  PublishedHandout,
  TeachingBlock,
  NoteFormula,
  TextbookDivergenceNotice,
} from "@/lib/schemas/notes";

// In-memory TSX module loader that transpiles TypeScript & JSX on the fly
// adhering strictly to zero modifications outside authorized files.
const moduleCache = new Map<string, unknown>();

function loadTsxModule<T = Record<string, unknown>>(relPath: string): T {
  let fullPath = path.resolve(relPath);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    if (fs.existsSync(`${fullPath}.ts`)) fullPath = `${fullPath}.ts`;
    else if (fs.existsSync(`${fullPath}.tsx`)) fullPath = `${fullPath}.tsx`;
    else if (fs.existsSync(path.join(fullPath, "index.ts"))) {
      fullPath = path.join(fullPath, "index.ts");
    } else if (fs.existsSync(path.join(fullPath, "index.tsx"))) {
      fullPath = path.join(fullPath, "index.tsx");
    }
  }

  if (moduleCache.has(fullPath)) {
    return moduleCache.get(fullPath) as T;
  }

  const sourceCode = fs.readFileSync(fullPath, "utf8");
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const mod = { exports: {} as Record<string, unknown> };
  moduleCache.set(fullPath, mod.exports);

  const customRequire = (id: string) => {
    if (id === "react") {
      return Object.assign({ default: React }, React);
    }
    if (id.startsWith("@/")) {
      return loadTsxModule(id.replace("@/", "./"));
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(id);
  };

  const fn = new Function("require", "module", "exports", transpiled.outputText);
  fn(customRequire, mod, mod.exports);
  moduleCache.set(fullPath, mod.exports);

  return mod.exports as T;
}

interface NoteRendererModule {
  toPublishedHandout: (note: ClutchNote | PublishedHandout) => PublishedHandout;
  TeachingBlockView: React.ComponentType<{
    block: TeachingBlock;
    formulasById?: Map<string, NoteFormula>;
  }>;
  formatSlideList: (slides: number[]) => string;
  SlideChip: React.ComponentType<{ slide?: number; slides?: number[]; label?: string }>;
  ItemStatusChip: React.ComponentType<{ status?: string; reviewReason?: string }>;
  FormulaStatusBadge: React.ComponentType<{ formula: NoteFormula }>;
  TextbookDivergenceCard: React.ComponentType<{ notice: TextbookDivergenceNotice }>;
  NoteRenderer: React.ComponentType<{
    note: ClutchNote | PublishedHandout;
    onReset: () => void;
    onCreateQuiz?: (questionCount?: number) => void;
    isCreatingQuiz?: boolean;
    canExportPdf?: boolean;
    onUpgradeClick?: () => void;
  }>;
}

const {
  toPublishedHandout,
  TeachingBlockView,
  formatSlideList,
  SlideChip,
  ItemStatusChip,
  FormulaStatusBadge,
  TextbookDivergenceCard,
  NoteRenderer,
} = loadTsxModule<NoteRendererModule>("components/notes/note-renderer.tsx");

describe("NoteRenderer Helper Functions & Subcomponents", () => {
  describe("toPublishedHandout", () => {
    it("strips compiler debug fields (formulaLedger, omitted, verification) while preserving sections and divergenceNotices", () => {
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
              ruleId: "div-1",
              packId: "pack-1",
              title: "Divergence Title",
              message: "Divergence Message",
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
      expect(published.divergenceNotices[0].title).toBe("Divergence Title");
      expect(published.sections).toHaveLength(SAMPLE_CLUTCH_NOTE.sections.length);
    });

    it("strips noisy needs_review / unsupported statuses and reviewReason strings while preserving verified and derived", () => {
      const dirtyNote: ClutchNote = {
        ...SAMPLE_CLUTCH_NOTE,
        sections: [
          {
            id: "sec-test",
            letter: "A",
            titleVi: "A. TEST SECTION",
            titleEn: "",
            overview: "",
            bulletPoints: [],
            groundedBullets: [
              {
                text: "Verified bullet",
                slide: 1,
                evidence: "Ev 1",
                status: "verified",
              },
              {
                text: "Noisy bullet",
                slide: 2,
                evidence: "Ev 2",
                status: "needs_review",
                reviewReason: "Noisy reason",
              },
            ],
            formulas: [
              {
                name: "Verified formula",
                latex: "F_1",
                variables: [],
                status: "verified",
              },
              {
                name: "Derived formula",
                latex: "F_2",
                variables: [],
                status: "derived",
                derivedFrom: ["F1"],
              },
              {
                name: "Noisy formula",
                latex: "F_3",
                variables: [],
                status: "needs_review",
                reviewReason: "Flagged noisy",
              },
            ],
            subSections: [],
            keyTakeaways: {
              title: "KEY TAKEAWAYS",
              items: [
                {
                  point: "Takeaway 1",
                  subBullets: [],
                  status: "needs_review",
                  reviewReason: "Noisy takeaway",
                },
              ],
              summaryPoints: [],
            },
            sourceSlides: [1, 2],
          },
        ],
      };

      const published = toPublishedHandout(dirtyNote);
      const sec = published.sections[0];

      // Bullets
      expect(sec.groundedBullets![0].status).toBe("verified");
      expect(sec.groundedBullets![1].status).toBeUndefined();
      expect(sec.groundedBullets![1].reviewReason).toBeUndefined();

      // Formulas
      expect(sec.formulas[0].status).toBe("verified");
      expect(sec.formulas[1].status).toBe("derived");
      expect(sec.formulas[2].status).toBeUndefined();
      expect(sec.formulas[2].reviewReason).toBeUndefined();

      // Takeaways
      expect(sec.keyTakeaways!.items![0].status).toBeUndefined();
      expect(sec.keyTakeaways!.items![0].reviewReason).toBeUndefined();
    });
  });

  describe("formatSlideList", () => {
    it("returns empty string for empty array or no slides", () => {
      expect(formatSlideList([])).toBe("");
    });

    it("formats single slide", () => {
      expect(formatSlideList([4])).toBe("Slide 4");
    });

    it("formats contiguous range of slides", () => {
      expect(formatSlideList([5, 6, 7])).toBe("Slides 5–7");
      expect(formatSlideList([10, 11, 12, 13])).toBe("Slides 10–13");
    });

    it("formats multiple non-contiguous ranges and singletons", () => {
      expect(formatSlideList([5, 6, 7, 8, 9, 23, 24, 25, 26])).toBe(
        "Slides 5–9, 23–26",
      );
      expect(formatSlideList([1, 2, 4, 6, 7, 8])).toBe("Slides 1–2, 4, 6–8");
      expect(formatSlideList([1, 3, 5])).toBe("Slides 1, 3, 5");
    });

    it("deduplicates and sorts slide numbers automatically", () => {
      expect(formatSlideList([9, 5, 6, 5, 7, 8])).toBe("Slides 5–9");
      expect(formatSlideList([20, 4, 20, 5, 4])).toBe("Slides 4–5, 20");
    });
  });

  describe("SlideChip", () => {
    it("renders single slide chip", () => {
      const html = renderToStaticMarkup(React.createElement(SlideChip, { slide: 4 }));
      expect(html).toContain("Slide 4");
    });

    it("renders multiple slide chip using formatted range", () => {
      const html = renderToStaticMarkup(
        React.createElement(SlideChip, { slides: [5, 6, 7] }),
      );
      expect(html).toContain("Slides 5–7");
    });

    it("renders custom label override when provided", () => {
      const html = renderToStaticMarkup(
        React.createElement(SlideChip, { label: "Appendix Slide 12" }),
      );
      expect(html).toContain("Appendix Slide 12");
    });

    it("returns null when no slide info provided", () => {
      const html = renderToStaticMarkup(React.createElement(SlideChip, {}));
      expect(html).toBe("");
    });
  });

  describe("ItemStatusChip", () => {
    it("renders Contradicted badge with reviewReason tooltip", () => {
      const html = renderToStaticMarkup(
        React.createElement(ItemStatusChip, {
          status: "contradicted",
          reviewReason: "Contradicts slide 6 equation",
        }),
      );
      expect(html).toContain("Contradicted");
      expect(html).toContain('title="Contradicts slide 6 equation"');
    });

    it("suppresses Needs review badge for needs_review and unsupported status (returns null)", () => {
      const htmlNeedsReview = renderToStaticMarkup(
        React.createElement(ItemStatusChip, {
          status: "needs_review",
          reviewReason: "Symbol not in legend",
        }),
      );
      expect(htmlNeedsReview).toBe("");

      const htmlUnsupported = renderToStaticMarkup(
        React.createElement(ItemStatusChip, {
          status: "unsupported",
        }),
      );
      expect(htmlUnsupported).toBe("");
    });

    it("returns null for verified or undefined status", () => {
      const verifiedHtml = renderToStaticMarkup(
        React.createElement(ItemStatusChip, { status: "verified" }),
      );
      expect(verifiedHtml).toBe("");

      const undefinedHtml = renderToStaticMarkup(
        React.createElement(ItemStatusChip, {}),
      );
      expect(undefinedHtml).toBe("");
    });
  });

  describe("FormulaStatusBadge", () => {
    it("renders Verified badge", () => {
      const html = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "P_0 = \\frac{D}{R}",
            variables: [],
            status: "verified",
          },
        }),
      );
      expect(html).toContain("Verified");
    });

    it("renders Derived from ledger refs badge", () => {
      const html = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "R = \\frac{D_1}{P_0} + g",
            variables: [],
            status: "derived",
            derivedFrom: ["F1", "F2"],
          },
        }),
      );
      expect(html).toContain("Derived from F1, F2");
    });

    it("renders generic Derived badge when no derivedFrom array is present", () => {
      const html = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "R = \\frac{D_1}{P_0} + g",
            variables: [],
            status: "derived",
          },
        }),
      );
      expect(html).toContain("Derived");
      expect(html).not.toContain("Derived from");
    });

    it("suppresses yellow Needs review and unsupported badges (returns null)", () => {
      const htmlNeedsReview = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            variables: [],
            status: "needs_review",
          },
        }),
      );
      expect(htmlNeedsReview).toBe("");

      const htmlUnsupported = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            variables: [],
            status: "unsupported",
          },
        }),
      );
      expect(htmlUnsupported).toBe("");
    });

    it("renders Contradicted badge", () => {
      const html = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "P_0 = \\frac{D_0}{R + g}",
            variables: [],
            status: "contradicted",
          },
        }),
      );
      expect(html).toContain("Contradicted");
    });

    it("returns null when status is undefined and not derived", () => {
      const html = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            variables: [],
          },
        }),
      );
      expect(html).toBe("");
    });
  });

  describe("TeachingBlockView", () => {
    it("renders recipe block with structured recipe container and numbered step list", () => {
      const html = renderToStaticMarkup(
        React.createElement(TeachingBlockView, {
          block: {
            id: "recipe-1",
            kind: "recipe",
            heading: "5-Step DDM Calculation",
            text: "Follow these steps to compute intrinsic value:",
            steps: [
              "Estimate dividend growth rate g",
              "Compute required return R",
              "Apply Gordon model formula",
            ],
            slideCitations: [7],
            supportAtomIds: [],
            supportMode: "faithful_paraphrase",
            formulaRefs: [],
            symbolBindingIds: [],
          },
        }),
      );

      expect(html).toContain("note-recipe-card");
      expect(html).toContain("Recipe");
      expect(html).toContain("5-Step DDM Calculation");
      expect(html).toContain("Estimate dividend growth rate g");
      expect(html).toContain("Apply Gordon model formula");
      expect(html).toContain("Slide 7");
    });

    it("renders caution block with boundary condition styling", () => {
      const html = renderToStaticMarkup(
        React.createElement(TeachingBlockView, {
          block: {
            id: "caution-1",
            kind: "caution",
            heading: "Model Boundary Condition",
            text: "Gordon Growth model breaks down if R <= g.",
            slideCitations: [8],
            supportAtomIds: [],
            supportMode: "faithful_paraphrase",
            formulaRefs: [],
            symbolBindingIds: [],
          },
        }),
      );

      expect(html).toContain("note-caution-card");
      expect(html).toContain("Caution / Boundary");
      expect(html).toContain("Model Boundary Condition");
      expect(html).toContain("Gordon Growth model breaks down if R &lt;= g.");
    });
  });

  describe("TextbookDivergenceCard", () => {
    it("renders notice header, title, message, and KaTeX forms", () => {
      const html = renderToStaticMarkup(
        React.createElement(TextbookDivergenceCard, {
          notice: {
            ruleId: "fin-rule-1",
            packId: "corp-fin",
            title: "Cost of Capital Notation Divergence",
            message: "The lecturer uses k_e whereas standard textbooks use R_e.",
            slide: 14,
            lecturerForm: "k_e = \\frac{D_1}{P_0} + g",
            textbookForm: "R_e = \\frac{D_1}{P_0} + g",
          },
        }),
      );

      expect(html).toContain("Textbook Divergence Notice");
      expect(html).toContain("Slide 14");
      expect(html).toContain("Cost of Capital Notation Divergence");
      expect(html).toContain("Lecturer&#x27;s Form");
      expect(html).toContain("Standard Textbook Form");
      expect(html).toContain("katex");
    });
  });
});

describe("NoteRenderer Component Integration", () => {
  it("renders SAMPLE_CLUTCH_NOTE default handout cleanly", () => {
    const html = renderToStaticMarkup(
      React.createElement(NoteRenderer, {
        note: SAMPLE_CLUTCH_NOTE,
        onReset: () => {},
      }),
    );

    // Header & Toolbar
    expect(html).toContain("New Deck");
    expect(html).toContain("27 Slides → 3 Pages");
    expect(html).toContain("89% Noise Stripped");
    expect(html).toContain("Copy Markdown");
    expect(html).toContain("Export PDF");

    // Title & Sections
    expect(html).toContain("CHAPTER 9: STOCK VALUATION");
    expect(html).toContain("Corporate Finance — Clutch Notes AI");
    expect(html).toContain("A. NGUYÊN LÝ CƠ BẢN");
    expect(html).toContain("B. CÔNG THỨC TỔNG QUÁT");
    expect(html).toContain("C. DDM (DIVIDEND DISCOUNT MODEL)");
    expect(html).toContain("D. PARAMETERS IN DIVIDEND DISCOUNT MODEL");
    expect(html).toContain("E. VALUE OF PREFERENCE SHARE");

    // Watermark & KaTeX
    expect(html).toContain("Clutch Arena");
    expect(html).toContain("katex");
    expect(html).toContain("KEY TAKEAWAYS");
    expect(html).toContain("Constant growth → Gordon model");
  });

  it("renders divergence cards, verified badges, derived badges, and boundary conditions without yellow badges or debug tables", () => {
    const enrichedNote: ClutchNote = {
      ...SAMPLE_CLUTCH_NOTE,
      verification: {
        status: "marked",
        repairAttempted: false,
        coverageRatio: 0.75,
        totalLedgerFormulas: 4,
        placedFormulaIds: ["F1", "F2"],
        uncapturedFormulaIds: ["F4"],
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
          raw: "P0 = D1/(1+R)",
          latex: "P_0 = \\frac{D_1}{1 + R}",
          variables: [],
          origin: "omml",
        },
        {
          id: "F4",
          slide: 16,
          raw: "b = 1 - Payout Ratio",
          latex: "b = 1 - \\text{Payout Ratio}",
          label: "Plowback Ratio Definition",
          variables: [],
          origin: "text",
          evidence: "Slide 16 footnote",
          isExerciseOnly: true,
        },
      ],
      omitted: [
        {
          formulaId: "F4",
          reason: "Appeared solely in footnote of slide 16",
        },
      ],
      sections: [
        {
          id: "sec-a",
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
          ],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              {
                point: "First verified takeaway",
                subBullets: [],
                slide: 4,
                status: "verified",
              },
              {
                point: "Second takeaway needs review",
                subBullets: [],
                slide: 5,
                status: "needs_review",
                reviewReason: "Unverified assumption on growth duration.",
              },
            ],
            boundaryConditions: "Make sure g < R, otherwise the model breaks down",
            summaryPoints: [],
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(NoteRenderer, {
        note: enrichedNote,
        onReset: () => {},
      }),
    );

    // 1. Debug UI Elimination: Zero Warning Banner & Zero Uncaptured Section
    expect(html).not.toContain("Ingestion &amp; Verification Notices");
    expect(html).not.toContain("Ingestion & Verification Notices");
    expect(html).not.toContain("Uncaptured Source Formulas");
    expect(html).not.toContain("Formula Omitted");
    expect(html).not.toContain("Formulas Omitted");
    expect(html).not.toContain("Plowback Ratio Definition");

    // 2. Yellow Badge Elimination: Zero "Needs review" badges
    expect(html).not.toContain("Needs review");
    expect(html).not.toContain("Slide does not explicitly mention bear markets.");
    expect(html).not.toContain("Unverified assumption on growth duration.");

    // 3. Global and Section Textbook Divergence Notices preserved
    expect(html).toContain("Global Notation Convention");
    expect(html).toContain("All rates expressed as annual nominal percentages unless stated.");
    expect(html).toContain("Perpetuity Notation in Section A");

    // 4. Slide Chips preserved
    expect(html).toContain("Slide 4");
    expect(html).toContain("Slide 7");
    expect(html).toContain("Slide 8");
    expect(html).toContain("Slide 9");

    // 5. Verified, Derived, and Contradicted badges preserved
    expect(html).toContain("Verified");
    expect(html).toContain("Derived from F1");
    expect(html).toContain("Contradicted");

    // 6. Contradicted Review Reasons preserved
    expect(html).toContain("Denominator should be R - g, not R + g.");
    expect(html).toContain("Slide equation explicitly incorporates P_1.");

    // 7. Formula-level Divergence Card preserved
    expect(html).toContain("Denominator Sign Error");
    expect(html).toContain("Slides use addition instead of subtraction.");

    // 8. Prominent Boundary Conditions preserved in Takeaways
    expect(html).toContain("Boundary Condition:");
    expect(html).toContain("Make sure g &lt; R, otherwise the model breaks down");
  });

  describe("Structured Recipes and Section Blocks", () => {
    it("renders recipe subSections with structured recipe card and numbered steps", () => {
      const noteWithRecipe: ClutchNote = {
        ...SAMPLE_CLUTCH_NOTE,
        sections: [
          {
            id: "sec-recipe",
            letter: "A",
            titleVi: "A. QUY TRÌNH TÍNH TOÁN DDM",
            titleEn: "DDM Step-by-Step Recipe",
            overview: "",
            bulletPoints: [],
            subSections: [
              {
                heading: "Quy trình 3 bước định giá cổ phiếu (Calculation Recipe)",
                leadIn: "Thực hiện lần lượt các bước:",
                bulletPoints: [
                  "Bước 1: Dự phóng dòng cổ tức kỳ vọng D_1",
                  "Bước 2: Xác định tỷ suất chiết khấu R",
                  "Bước 3: Chiết khấu về hiện tại P_0",
                ],
                formulas: [],
              },
            ],
            formulas: [],
            sourceSlides: [5],
          },
        ],
      };

      const html = renderToStaticMarkup(
        React.createElement(NoteRenderer, {
          note: noteWithRecipe,
          onReset: () => {},
        }),
      );

      expect(html).toContain("note-recipe-card");
      expect(html).toContain("note-recipe-heading");
      expect(html).toContain("Quy trình 3 bước định giá cổ phiếu");
      expect(html).toContain("Bước 1: Dự phóng dòng cổ tức kỳ vọng");
      expect(html).toContain("D_1");
    });

    it("renders optional teaching blocks on section cleanly", () => {
      const noteWithBlocks = {
        ...SAMPLE_CLUTCH_NOTE,
        sections: [
          {
            ...SAMPLE_CLUTCH_NOTE.sections[0],
            blocks: [
              {
                id: "b-1",
                kind: "recipe" as const,
                heading: "Section Level Recipe Block",
                text: "Recipe steps:",
                steps: ["Step A", "Step B"],
                slideCitations: [4],
                supportAtomIds: [],
                supportMode: "faithful_paraphrase" as const,
                formulaRefs: [],
                symbolBindingIds: [],
              },
            ],
          },
        ],
      };

      const html = renderToStaticMarkup(
        React.createElement(NoteRenderer, {
          note: noteWithBlocks,
          onReset: () => {},
        }),
      );

      expect(html).toContain("note-recipe-card");
      expect(html).toContain("Section Level Recipe Block");
      expect(html).toContain("Step A");
    });
  });

  describe("PublishedHandout Boundary: Elimination of Debug & Uncaptured Sections", () => {
    it("never renders uncaptured formula sections or uncaptured warnings even when passed legacy notes", () => {
      const noteMixedOmitted: ClutchNote = {
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
            label: "Intermediate Rearrangement",
            variables: [],
            origin: "text",
          },
          {
            id: "F3",
            slide: 10,
            raw: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
            latex: "\\text{WACC} = \\frac{E}{V} R_e + \\frac{D}{V} R_d (1 - T_c)",
            label: "Firm Cost of Capital",
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
            reason: "Core syllabus equation unplaced",
          },
        ],
      };

      const html = renderToStaticMarkup(
        React.createElement(NoteRenderer, {
          note: noteMixedOmitted,
          onReset: () => {},
        }),
      );

      // Student publication layer must be 100% clean of uncaptured debug sections
      expect(html).not.toContain("Uncaptured Source Formulas");
      expect(html).not.toContain("Formula Omitted");
      expect(html).not.toContain("Uncaptured formula IDs");
      expect(html).not.toContain("Core syllabus equation unplaced");
    });

    it("renders Quiz Deck creation CTA button and banner only when onCreateQuiz prop is provided", () => {
      const htmlWithoutQuiz = renderToStaticMarkup(
        React.createElement(NoteRenderer, {
          note: SAMPLE_CLUTCH_NOTE,
          onReset: () => {},
        }),
      );
      expect(htmlWithoutQuiz).not.toContain("Create Quiz Deck");
      expect(htmlWithoutQuiz).not.toContain("Turn this Revision Note into a Practice Quiz");

      const htmlWithQuiz = renderToStaticMarkup(
        React.createElement(NoteRenderer, {
          note: SAMPLE_CLUTCH_NOTE,
          onReset: () => {},
          onCreateQuiz: () => {},
          isCreatingQuiz: false,
        }),
      );
      expect(htmlWithQuiz).toContain("Create Quiz Deck");
      expect(htmlWithQuiz).toContain("Turn this Revision Note into a Practice Quiz");
      expect(htmlWithQuiz).toContain("Active Recall Practice");

      const htmlCreatingQuiz = renderToStaticMarkup(
        React.createElement(NoteRenderer, {
          note: SAMPLE_CLUTCH_NOTE,
          onReset: () => {},
          onCreateQuiz: () => {},
          isCreatingQuiz: true,
        }),
      );
      expect(htmlCreatingQuiz).toContain("Generating Quiz...");
    });
  });
});
