import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import type {
  ClutchNote,
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
  formatSlideList: (slides: number[]) => string;
  SlideChip: React.ComponentType<{ slide?: number; slides?: number[]; label?: string }>;
  ItemStatusChip: React.ComponentType<{ status?: string; reviewReason?: string }>;
  FormulaStatusBadge: React.ComponentType<{ formula: NoteFormula }>;
  TextbookDivergenceCard: React.ComponentType<{ notice: TextbookDivergenceNotice }>;
  NoteRenderer: React.ComponentType<{ note: ClutchNote; onReset: () => void }>;
}

const {
  formatSlideList,
  SlideChip,
  ItemStatusChip,
  FormulaStatusBadge,
  TextbookDivergenceCard,
  NoteRenderer,
} = loadTsxModule<NoteRendererModule>("components/notes/note-renderer.tsx");

describe("NoteRenderer Helper Functions & Subcomponents", () => {
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

    it("renders Needs review badge for needs_review status", () => {
      const html = renderToStaticMarkup(
        React.createElement(ItemStatusChip, {
          status: "needs_review",
          reviewReason: "Symbol not in legend",
        }),
      );
      expect(html).toContain("Needs review");
      expect(html).toContain('title="Symbol not in legend"');
    });

    it("renders Needs review badge for unsupported status", () => {
      const html = renderToStaticMarkup(
        React.createElement(ItemStatusChip, {
          status: "unsupported",
        }),
      );
      expect(html).toContain("Needs review");
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

    it("renders Needs review badge", () => {
      const html = renderToStaticMarkup(
        React.createElement(FormulaStatusBadge, {
          formula: {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            variables: [],
            status: "needs_review",
          },
        }),
      );
      expect(html).toContain("Needs review");
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

  it("renders Stage 5.1 verification features: warning banners, divergence cards, badges, and uncaptured formulas", () => {
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

    // 1. Ingestion Warning Banner
    expect(html).toContain("Ingestion &amp; Verification Notices");
    expect(html).toContain("2 Notices");
    expect(html).toContain("OCR detected low confidence table values");
    expect(html).toContain("Mathematical contradiction between slide text");
    expect(html).toContain("Formulas or tables from these slides should be double-checked");

    // 2. Global and Section Textbook Divergence Notices
    expect(html).toContain("Global Notation Convention");
    expect(html).toContain("All rates expressed as annual nominal percentages unless stated.");
    expect(html).toContain("Perpetuity Notation in Section A");

    // 3. Slide Chips
    expect(html).toContain("Slide 4");
    expect(html).toContain("Slide 7");
    expect(html).toContain("Slide 8");
    expect(html).toContain("Slide 9");

    // 4. Verification Badges
    expect(html).toContain("Verified");
    expect(html).toContain("Derived from F1");
    expect(html).toContain("Needs review");
    expect(html).toContain("Contradicted");

    // 5. Review Reasons & Explanations
    expect(html).toContain("Denominator should be R - g, not R + g.");
    expect(html).toContain("Review note: ");
    expect(html).toContain("Slide does not explicitly mention bear markets.");
    expect(html).toContain("Slide equation explicitly incorporates P_1.");
    expect(html).toContain("Unverified assumption on growth duration.");

    // 6. Formula-level Divergence Card
    expect(html).toContain("Denominator Sign Error");
    expect(html).toContain("Slides use addition instead of subtraction.");

    // 7. Dedicated Uncaptured Source Formulas Section
    expect(html).toContain("Uncaptured Source Formulas");
    expect(html).toContain("1 Formula Omitted");
    expect(html).toContain("F4");
    expect(html).toContain("Plowback Ratio Definition");
    expect(html).toContain("Slide 16");
    expect(html).toContain("Appeared solely in footnote of slide 16");
  });
});
