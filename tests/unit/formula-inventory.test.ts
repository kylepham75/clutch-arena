import { describe, expect, it, vi } from "vitest";
import { generateObject, type LanguageModel } from "ai";
import {
  buildFormulaInventory,
  normalizeInventoryFormulaKey,
  cleanLatexEquation,
  convertUnicodeMath,
  isNumericPluginOrScalarAssignment,
  isNontrivialFormula,
  parseSlideNumber,
  chunkSlideSources,
  DEFAULT_EXTRACTION_CHUNK_SIZE,
  EXTRACTION_SYSTEM_PROMPT,
  buildChunkExtractionPrompt,
  extractChunkedSlideInventory,
  mergeFormulaLedger,
  buildMergedFormulaLedger,
  isFormulaGroundedOnSlide,
  type FormulaInventoryItem,
} from "@/lib/notes/formula-inventory";
import { parseSlideDeck } from "@/lib/notes/parse-slides";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import type {
  OcrTranscribedEquation,
  OmmlTranscribedEquation,
} from "@/lib/ingestion/parse-pptx";
import {
  extractionSchema,
  type ExtractedFormulaItem,
  type ExtractedSlideClaim,
} from "@/lib/schemas/notes";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

vi.mock("@/lib/ingestion/parse-pdf", () => ({
  parsePdf: vi.fn().mockResolvedValue({
    pageCount: 2,
    sources: [
      {
        id: "page-1",
        label: "Page 1",
        text: "Net Working Capital = Current Assets - Current Liabilities\nThis is sufficient text to meet the minimum character threshold.",
      },
      {
        id: "page-2",
        label: "Page 2",
        text: "P₀ = D₁ / (R − g)\nThis is sufficient text to meet the minimum character threshold.",
      },
    ],
    warnings: [],
  }),
}));

vi.mock("@/lib/ingestion/parse-pptx", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ingestion/parse-pptx")>();
  return {
    ...actual,
    parsePptx: vi.fn().mockResolvedValue({
      pageCount: 3,
      warnings: [],
      sources: [
        {
          id: "slide-1",
          label: "Slide 1",
          text: "Slide 1 with OMML equation: $P_0 = \\frac{D_1}{R - g}$\nThis meets minimum character count requirements.",
        },
        {
          id: "slide-2",
          label: "Slide 2",
          text: "Slide 2 with OCR equation: $NPV = \\sum \\frac{CF_t}{(1+r)^t}$\nThis meets minimum character count requirements.",
        },
        {
          id: "slide-3",
          label: "Slide 3",
          text: "Net Working Capital = Current Assets - Current Liabilities\nThis meets minimum character count requirements.",
        },
      ],
      ommlEquations: [
        {
          slide: 1,
          raw: "P_0 = D_1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "omml",
        },
      ],
      ocrEquations: [
        {
          slide: 2,
          raw: "NPV = sum CF_t / (1+r)^t",
          latex: "NPV = \\sum \\frac{CF_t}{(1+r)^t}",
          origin: "ocr",
          confidence: 0.92,
        },
      ],
    }),
  };
});

describe("normalizeInventoryFormulaKey", () => {
  it("strips whitespace and dollar signs", () => {
    const raw = "  $ P_0 = D_1 / (R - g) $  ";
    expect(normalizeInventoryFormulaKey(raw)).toBe("P_0=D_1/(R-g)");
  });

  it("strips font wrappers: text, mathrm, mathbf, boldsymbol", () => {
    const tex =
      "\\mathbf{P}_0 = \\frac{\\mathbf{D}_1}{\\mathrm{R} - \\boldsymbol{g}}";
    expect(normalizeInventoryFormulaKey(tex)).toBe("P_0=\\frac{D_1}{R-g}");
  });

  it("strips \\left and \\right delimiters", () => {
    const tex =
      "\\left( P_0 \\right) = \\left( \\frac{D_1}{R - g} \\right)";
    expect(normalizeInventoryFormulaKey(tex)).toBe("P_0=\\frac{D_1}{R-g}");
  });

  it("strips single-char braces {x} -> x while preserving multi-char braces", () => {
    const tex = "P_{0} = \\frac{D_{1}}{R - g}";
    expect(normalizeInventoryFormulaKey(tex)).toBe("P_0=\\frac{D_1}{R-g}");
  });

  it("strips outer parens on LHS and RHS", () => {
    const tex = "(P_0) = (D_1 / (R - g))";
    expect(normalizeInventoryFormulaKey(tex)).toBe("P_0=D_1/(R-g)");
  });

  it("preserves math operators ^, _, /, +, -, \\frac, \\sum, \\sqrt, \\prod", () => {
    const tex = "\\sigma^2 = \\frac{1}{N} \\sum_{i=1}^N (X_i - \\mu)^2 + c";
    const key = normalizeInventoryFormulaKey(tex);
    expect(key).toContain("^2");
    expect(key).toContain("\\frac");
    expect(key).toContain("\\sum_{i=1}^N");
    expect(key).toContain("+");
    expect(key).toContain("-");
  });

  it("equates different representations of the same formula", () => {
    const rep1 = "$P_0 = \\frac{D_1}{R - g}$";
    const rep2 =
      "\\mathbf{P}_{0} = \\left( \\frac{\\mathbf{D}_{1}}{R - g} \\right)";
    expect(normalizeInventoryFormulaKey(rep1)).toBe(
      normalizeInventoryFormulaKey(rep2),
    );
  });
});

describe("convertUnicodeMath", () => {
  it("converts Unicode subscripts and superscripts", () => {
    const input = "P₀ = D₁ / (1 + r)¹ + P₁ / (1 + r)¹";
    const converted = convertUnicodeMath(input);
    expect(converted).toBe("P_0 = D_1 / (1 + r)^1 + P_1 / (1 + r)^1");
  });

  it("converts Unicode Greek letters and symbols", () => {
    const input = "σ² = ∑ Pᵢ × (Rᵢ − E[R])²";
    const converted = convertUnicodeMath(input);
    expect(converted).toContain("\\sigma^2");
    expect(converted).toContain("\\sum");
    expect(converted).toContain("\\times");
    expect(converted).toContain("-");
  });
});

describe("isNumericPluginOrScalarAssignment", () => {
  it("detects pure numeric lines starting with '='", () => {
    expect(
      isNumericPluginOrScalarAssignment("= 2.50 / (0.10 - 0.05) = $50"),
    ).toBe(true);
    expect(isNumericPluginOrScalarAssignment("= 100 / 0.10 = 1000")).toBe(true);
  });

  it("detects trivial scalar assignments", () => {
    expect(isNumericPluginOrScalarAssignment("t = 1")).toBe(true);
    expect(isNumericPluginOrScalarAssignment("r = 10%")).toBe(true);
    expect(isNumericPluginOrScalarAssignment("P = $50")).toBe(true);
    expect(isNumericPluginOrScalarAssignment("n = 5")).toBe(true);
  });

  it("keeps formulas with symbolic expressions on RHS", () => {
    expect(isNumericPluginOrScalarAssignment("P_0 = D_1 / (R - g)")).toBe(
      false,
    );
    expect(
      isNumericPluginOrScalarAssignment(
        "Net Working Capital = Current Assets - Current Liabilities",
      ),
    ).toBe(false);
    expect(
      isNumericPluginOrScalarAssignment(
        "Inventory Period = 365 / Inventory Turnover",
      ),
    ).toBe(false);
  });
});

describe("parseSlideNumber", () => {
  it("parses slide number from id or label", () => {
    expect(
      parseSlideNumber({ id: "slide-5", label: "Slide 5", text: "" }, 0),
    ).toBe(5);
    expect(
      parseSlideNumber({ id: "page_12", label: "Page 12", text: "" }, 0),
    ).toBe(12);
    expect(
      parseSlideNumber({ id: "custom", label: "Slide 8", text: "" }, 0),
    ).toBe(8);
    expect(
      parseSlideNumber({ id: "custom", label: "Intro", text: "" }, 3),
    ).toBe(4);
  });
});

describe("buildFormulaInventory", () => {
  it("assigns sequential deterministic IDs (F1, F2, F3) in slide order", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-3",
        label: "Slide 3",
        text: "P_0 = D_1 / (R - g)",
      },
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Net Working Capital = Current Assets - Current Liabilities",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "g = Retention ratio × ROE",
      },
    ];

    const inventory = buildFormulaInventory(sources);
    expect(inventory).toHaveLength(3);

    // Sorted by slide ascending: 1, 2, 3
    expect(inventory[0].id).toBe("F1");
    expect(inventory[0].slide).toBe(1);
    expect(inventory[0].latex).toContain("Net Working Capital");

    expect(inventory[1].id).toBe("F2");
    expect(inventory[1].slide).toBe(2);
    expect(inventory[1].latex).toContain("Retention ratio");

    expect(inventory[2].id).toBe("F3");
    expect(inventory[2].slide).toBe(3);
    expect(inventory[2].latex).toContain("P_0");
  });

  it("preserves origin: 'omml' when ommlEquations match source text $...$", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Dividend growth model: $P_0 = \\frac{D_1}{R - g}$",
      },
    ];
    const ommlEquations: OmmlTranscribedEquation[] = [
      {
        slide: 1,
        raw: "P_0 = D_1 / (R - g)",
        latex: "P_0 = \\frac{D_1}{R - g}",
        origin: "omml",
      },
    ];

    const inventory = buildFormulaInventory({ sources, ommlEquations });
    expect(inventory).toHaveLength(1);
    expect(inventory[0].id).toBe("F1");
    expect(inventory[0].origin).toBe("omml");
    expect(inventory[0].raw).toBe("P_0 = D_1 / (R - g)");
    expect(inventory[0].latex).toBe("P_0 = \\frac{D_1}{R - g}");
  });

  it("filters out trivial non-formula single tokens in OMML", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Slide content",
      },
    ];
    const ommlEquations: OmmlTranscribedEquation[] = [
      {
        slide: 1,
        raw: "R",
        latex: "R",
        origin: "omml",
      },
      {
        slide: 1,
        raw: "g",
        latex: "g",
        origin: "omml",
      },
      {
        slide: 1,
        raw: "P_0 = D_1 / (R - g)",
        latex: "P_0 = \\frac{D_1}{R - g}",
        origin: "omml",
      },
    ];

    const inventory = buildFormulaInventory({ sources, ommlEquations });
    expect(inventory).toHaveLength(1);
    expect(inventory[0].latex).toBe("P_0 = \\frac{D_1}{R - g}");
  });

  it("preserves origin: 'ocr' and propagates confidence", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Image equation: $NPV = \\sum_{t=1}^T \\frac{CF_t}{(1+r)^t} - CF_0$",
      },
    ];
    const ocrEquations: OcrTranscribedEquation[] = [
      {
        slide: 2,
        raw: "NPV = sum CF_t / (1+r)^t - CF_0",
        latex: "NPV = \\sum_{t=1}^T \\frac{CF_t}{(1+r)^t} - CF_0",
        origin: "ocr",
        confidence: 0.94,
      },
    ];

    const inventory = buildFormulaInventory({ sources, ocrEquations });
    expect(inventory).toHaveLength(1);
    expect(inventory[0].origin).toBe("ocr");
    expect(inventory[0].confidence).toBe(0.94);
    expect(inventory[0].slide).toBe(2);
  });

  it("extracts origin: 'text' from inline $...$ LaTeX", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "The CAPM equation is $R = R_f + \\beta \\times (R_M - R_f)$ for any asset.",
      },
    ];

    const inventory = buildFormulaInventory(sources);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].origin).toBe("text");
    expect(inventory[0].latex).toContain("R_f + \\beta \\times (R_M - R_f)");
  });

  it("extracts plain-text formulas with Unicode subscripts, superscripts, and math symbols", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Constant growth: P₀ = D₁ / (R − g)",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Portfolio variance: σ² = ∑ Pᵢ × (Rᵢ − E[R])²",
      },
    ];

    const inventory = buildFormulaInventory(sources);
    expect(inventory).toHaveLength(2);

    expect(inventory[0].slide).toBe(1);
    expect(inventory[0].origin).toBe("text");
    expect(inventory[0].latex).toBe("P_0 = D_1 / (R - g)");

    expect(inventory[1].slide).toBe(2);
    expect(inventory[1].origin).toBe("text");
    expect(inventory[1].latex).toContain(
      "\\sigma^2 = \\sum P_i \\times (R_i - E[R])^2",
    );
  });

  it("extracts accounting and financial word equations", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "• Net Working Capital = Current Assets - Current Liabilities",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "• Sustainable growth rate: g = Retention ratio × ROE",
      },
    ];

    const inventory = buildFormulaInventory(sources);
    expect(inventory).toHaveLength(2);

    expect(inventory[0].latex).toBe(
      "\\text{Net Working Capital} = \\text{Current Assets} - \\text{Current Liabilities}",
    );
    expect(inventory[1].latex).toContain(
      "\\text{Retention ratio} \\times \\text{ROE}",
    );
  });

  it("captures taught formulas in exercise slides while ignoring numeric plug-ins and scalars", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-4",
        label: "Slide 4",
        text: [
          "Exercise 1: Stock Price Calculation",
          "Use P_0 = D_1 / (R - g) to find price",
          "= 2.50 / (0.10 - 0.05) = $50",
          "t = 1",
          "r = 10%",
        ].join("\n"),
      },
    ];

    const inventory = buildFormulaInventory(sources);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].id).toBe("F1");
    expect(inventory[0].slide).toBe(4);
    expect(inventory[0].raw).toBe("P_0 = D_1 / (R - g)");
    expect(inventory[0].latex).toBe("P_0 = D_1 / (R - g)");
  });

  it("strips trailing prose parentheticals while preserving math parentheses", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "P_0 = D_1 / (R - g) (assuming constant dividend growth)",
      },
    ];

    const inventory = buildFormulaInventory(sources);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].latex).toBe("P_0 = D_1 / (R - g)");
    expect(inventory[0].latex).not.toContain("assuming");
  });

  it("deduplicates identical formulas within the same slide", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: [
          "Constant growth model: P_0 = D_1 / (R - g)",
          "Recall that P_0 = D_1 / (R - g)",
          "Use P_0 = D_1 / (R - g) for valuation",
        ].join("\n"),
      },
    ];

    const inventory = buildFormulaInventory(sources);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].id).toBe("F1");
  });
});

describe("parseSlideDeck end-to-end integration", () => {
  it("populates formulaInventory on PDF decks", async () => {
    const file = new File(
      [
        "%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF",
      ],
      "lecture.pdf",
      { type: "application/pdf" },
    );

    const result = await parseSlideDeck(file);
    expect(result.formulaInventory).toBeDefined();
    expect(result.formulaInventory).toHaveLength(2);
    expect(result.formulaInventory[0].id).toBe("F1");
    expect(result.formulaInventory[0].slide).toBe(1);
    expect(result.formulaInventory[0].origin).toBe("text");
    expect(result.formulaInventory[1].id).toBe("F2");
    expect(result.formulaInventory[1].slide).toBe(2);
    expect(result.formulaInventory[1].origin).toBe("text");
  });

  it("populates formulaInventory on PPTX decks with OMML, OCR, and text formulas", async () => {
    const file = new File([new Uint8Array(200)], "lecture.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    const result = await parseSlideDeck(file);
    expect(result.formulaInventory).toBeDefined();
    expect(result.formulaInventory).toHaveLength(3);

    // Slide 1 has OMML
    expect(result.formulaInventory[0].id).toBe("F1");
    expect(result.formulaInventory[0].slide).toBe(1);
    expect(result.formulaInventory[0].origin).toBe("omml");

    // Slide 2 has OCR
    expect(result.formulaInventory[1].id).toBe("F2");
    expect(result.formulaInventory[1].slide).toBe(2);
    expect(result.formulaInventory[1].origin).toBe("ocr");
    expect(result.formulaInventory[1].confidence).toBe(0.92);

    // Slide 3 has text
    expect(result.formulaInventory[2].id).toBe("F3");
    expect(result.formulaInventory[2].slide).toBe(3);
    expect(result.formulaInventory[2].origin).toBe("text");
  });
});

describe("Stage 3.2: Chunked Extraction Pass & Merged Formula Ledger", () => {
  describe("chunkSlideSources", () => {
    it("splits 20 slides into 3 chunks of [8, 8, 4] sorted by 1-based slide number", () => {
      const shuffledNumbers = [
        14, 2, 7, 19, 1, 20, 8, 12, 5, 16, 3, 10, 15, 6, 18, 4, 11, 9, 17, 13,
      ];
      const sources: SourceBlock[] = shuffledNumbers.map((num) => ({
        id: `slide-${num}`,
        label: `Slide ${num}`,
        text: `Slide ${num} content`,
      }));

      const chunks = chunkSlideSources(sources);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toHaveLength(8);
      expect(chunks[1]).toHaveLength(8);
      expect(chunks[2]).toHaveLength(4);

      // Verify each chunk is strictly sorted by 1-based slide number
      expect(chunks[0].map((c) => c.slide)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(chunks[1].map((c) => c.slide)).toEqual([
        9, 10, 11, 12, 13, 14, 15, 16,
      ]);
      expect(chunks[2].map((c) => c.slide)).toEqual([17, 18, 19, 20]);
    });

    it("returns empty array when sources is empty", () => {
      expect(chunkSlideSources([])).toEqual([]);
    });

    it("supports custom chunkSize parameter", () => {
      const sources: SourceBlock[] = Array.from({ length: 11 }, (_, i) => ({
        id: `slide-${i + 1}`,
        label: `Slide ${i + 1}`,
        text: `Content ${i + 1}`,
      }));

      const chunks = chunkSlideSources(sources, 5);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toHaveLength(5);
      expect(chunks[1]).toHaveLength(5);
      expect(chunks[2]).toHaveLength(1);
    });
  });

  describe("isFormulaGroundedOnSlide", () => {
    const slideText =
      "Constant growth valuation: P_0 = D_1 / (R - g)\nWhere P_0 is stock price today and ROE affects growth.";

    it("returns true when verbatim evidence quote is in slide text", () => {
      const item: ExtractedFormulaItem = {
        slide: 1,
        raw: "P_0 = D_1 / (R - g)",
        latex: "P_0 = \\frac{D_1}{R - g}",
        label: "Gordon Growth",
        variables: [],
        evidence: "Constant growth valuation: P_0 = D_1 / (R - g)",
        isExerciseOnly: false,
      };
      expect(isFormulaGroundedOnSlide(item, slideText)).toBe(true);
    });

    it("returns true when raw equation matches slide text", () => {
      const item: ExtractedFormulaItem = {
        slide: 1,
        raw: "P_0 = D_1 / (R - g)",
        latex: "P_0 = \\frac{D_1}{R - g}",
        label: "Gordon Growth",
        variables: [],
        evidence: "Arbitrary summary note",
        isExerciseOnly: false,
      };
      expect(isFormulaGroundedOnSlide(item, slideText)).toBe(true);
    });

    it("returns true when variable token matches slide text", () => {
      const item: ExtractedFormulaItem = {
        slide: 1,
        raw: "P = D / (R - g)",
        latex: "P = \\frac{D}{R - g}",
        label: "",
        variables: [{ symbol: "ROE", definition: "Return on equity" }],
        evidence: "Summary note",
        isExerciseOnly: false,
      };
      expect(isFormulaGroundedOnSlide(item, slideText)).toBe(true);
    });

    it("returns false for completely ungrounded formula", () => {
      const item: ExtractedFormulaItem = {
        slide: 1,
        raw: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
        latex: "WACC = \\frac{E}{V} R_e + \\frac{D}{V} R_d (1 - T_c)",
        label: "WACC",
        variables: [{ symbol: "WACC", definition: "Weighted average cost of capital" }],
        evidence: "Weighted average cost of capital formula",
        isExerciseOnly: false,
      };
      expect(isFormulaGroundedOnSlide(item, slideText)).toBe(false);
    });

    it("returns false when slide text is empty", () => {
      const item: ExtractedFormulaItem = {
        slide: 1,
        raw: "P_0 = D_1 / (R - g)",
        latex: "P_0 = \\frac{D_1}{R - g}",
        label: "",
        variables: [],
        evidence: "P_0 = D_1 / (R - g)",
        isExerciseOnly: false,
      };
      expect(isFormulaGroundedOnSlide(item, "")).toBe(false);
    });
  });

  describe("buildChunkExtractionPrompt & EXTRACTION_SYSTEM_PROMPT", () => {
    it("formats slide chunk boundaries, numbers, and labels in prompt", () => {
      const chunk = [
        {
          slide: 1,
          source: { id: "s-1", label: "Intro", text: "Introduction to finance" },
        },
        {
          slide: 2,
          source: { id: "s-2", label: "Formulas", text: "P_0 = D_1 / (R - g)" },
        },
      ];

      const prompt = buildChunkExtractionPrompt(chunk);
      expect(prompt).toContain("CHUNK SLIDES: 1, 2");
      expect(prompt).toContain("=== SLIDE 1 [Intro] ===");
      expect(prompt).toContain("Introduction to finance");
      expect(prompt).toContain("=== SLIDE 2 [Formulas] ===");
      expect(prompt).toContain("P_0 = D_1 / (R - g)");
    });

    it("contains strict source grounding and clean LaTeX rules in system prompt", () => {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("STRICT SOURCE GROUNDING");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("Clean LaTeX representation WITHOUT surrounding dollar signs");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("DO NOT extract trivial numeric calculation steps or plug-in lines");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("isExerciseOnly");
    });
  });

  describe("extractChunkedSlideInventory", () => {
    it("calls generateObject once per 8-slide chunk with temperature: 0 and schema: extractionSchema, filters out numeric plug-in lines and out-of-chunk slide numbers, and aggregates formulas & claims", async () => {
      const mockModel = { id: "mock-model" } as unknown as LanguageModel;
      const sources: SourceBlock[] = Array.from({ length: 10 }, (_, i) => ({
        id: `slide-${i + 1}`,
        label: `Slide ${i + 1}`,
        text: `Slide ${i + 1} content text`,
      }));

      vi.mocked(generateObject)
        .mockReset()
        .mockResolvedValueOnce({
          object: {
            formulas: [
              // Valid formula on slide 2
              {
                slide: 2,
                raw: "P_0 = D_1 / (R - g)",
                latex: "P_0 = \\frac{D_1}{R - g}",
                label: "Constant Growth DGM",
                variables: [
                  { symbol: "P_0", definition: "Current stock price" },
                  { symbol: "D_1", definition: "Next dividend" },
                ],
                evidence: "Constant Growth DGM: P_0 = D_1 / (R - g)",
                isExerciseOnly: false,
              },
              // Valid formula with outer dollar signs on slide 3 -> outer $ stripped
              {
                slide: 3,
                raw: "g = b * ROE",
                latex: "$$g = b \\times \\text{ROE}$$",
                label: "Sustainable Growth",
                variables: [],
                evidence: "g = b * ROE",
                isExerciseOnly: false,
              },
              // Numeric plug-in line on slide 2 -> filtered out
              {
                slide: 2,
                raw: "= 2.50 / (0.10 - 0.05) = $50",
                latex: "= 2.50 / (0.10 - 0.05) = 50",
                label: "",
                variables: [],
                evidence: "Plug in numbers",
                isExerciseOnly: true,
              },
              // Trivial scalar assignment on slide 4 -> filtered out
              {
                slide: 4,
                raw: "t = 1",
                latex: "t = 1",
                label: "",
                variables: [],
                evidence: "Time t = 1",
                isExerciseOnly: true,
              },
              // Out-of-chunk slide formula (slide 15 not in chunk 1 [1..8]) -> filtered out
              {
                slide: 15,
                raw: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
                latex: "WACC = \\frac{E}{V} R_e + \\frac{D}{V} R_d (1 - T_c)",
                label: "WACC",
                variables: [],
                evidence: "WACC formula",
                isExerciseOnly: false,
              },
            ],
            claims: [
              {
                slide: 1,
                topic: "Valuation Principle",
                claim: "Stock value equals PV of future dividends",
                evidence: "Stock value equals PV of future dividends",
              },
              // Out-of-chunk claim (slide 12 not in chunk 1) -> filtered out
              {
                slide: 12,
                topic: "Capital Structure",
                claim: "Irrelevant in perfect markets",
                evidence: "Modigliani-Miller theorem",
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          object: {
            formulas: [
              // Valid formula on slide 9 (in chunk 2 [9..10])
              {
                slide: 9,
                raw: "PV = C / r",
                latex: "PV = \\frac{C}{r}",
                label: "Perpetuity",
                variables: [{ symbol: "C", definition: "Cash flow" }],
                evidence: "Perpetuity formula: PV = C / r",
                isExerciseOnly: true,
              },
            ],
            claims: [
              {
                slide: 10,
                topic: "Perpetuity Assumption",
                claim: "Cash flows continue indefinitely",
                evidence: "Cash flows continue indefinitely",
              },
            ],
          },
        } as any);

      const result = await extractChunkedSlideInventory({
        sources,
        model: mockModel,
      });

      // 10 slides split into 2 chunks [8, 2] -> 2 generateObject calls
      expect(generateObject).toHaveBeenCalledTimes(2);
      expect(generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
          schema: extractionSchema,
          temperature: 0,
          system: EXTRACTION_SYSTEM_PROMPT,
        }),
      );

      expect(result.chunkCount).toBe(2);
      expect(result.formulas).toHaveLength(3);

      // Formulas sorted by slide ascending
      expect(result.formulas[0].slide).toBe(2);
      expect(result.formulas[0].latex).toBe("P_0 = \\frac{D_1}{R - g}");
      expect(result.formulas[0].label).toBe("Constant Growth DGM");

      expect(result.formulas[1].slide).toBe(3);
      expect(result.formulas[1].latex).toBe("g = b \\times \\text{ROE}");

      expect(result.formulas[2].slide).toBe(9);
      expect(result.formulas[2].latex).toBe("PV = \\frac{C}{r}");
      expect(result.formulas[2].isExerciseOnly).toBe(true);

      // Claims aggregated and sorted by slide ascending
      expect(result.claims).toHaveLength(2);
      expect(result.claims[0].slide).toBe(1);
      expect(result.claims[0].topic).toBe("Valuation Principle");
      expect(result.claims[1].slide).toBe(10);
      expect(result.claims[1].topic).toBe("Perpetuity Assumption");
    });

    it("returns empty result when sources is empty", async () => {
      const mockModel = { id: "mock-model" } as unknown as LanguageModel;
      const result = await extractChunkedSlideInventory({
        sources: [],
        model: mockModel,
      });
      expect(result).toEqual({ formulas: [], claims: [], chunkCount: 0 });
    });
  });

  describe("mergeFormulaLedger", () => {
    it("preserves deterministic omml/ocr/text entries' latex and origin, enriches them with label, variables, evidence, and isExerciseOnly from matching LLM extractions, appends novel grounded LLM formulas with origin: 'llm', rejects ungrounded LLM formulas whose evidence/tokens are absent from the slide, deduplicates across slides, and assigns sequential 'F1', 'F2', ... IDs", () => {
      const sources: SourceBlock[] = [
        {
          id: "slide-1",
          label: "Slide 1",
          text: "Slide 1: Valuation basics\nP_0 = D_1 / (R - g)\nWhere P_0 is stock price",
        },
        {
          id: "slide-2",
          label: "Slide 2",
          text: "Slide 2: Capital budgeting\nNPV = sum CF_t / (1+r)^t - CF_0",
        },
        {
          id: "slide-3",
          label: "Slide 3",
          text: "Slide 3: Sustainable growth rate: g = Retention ratio × ROE\nWhere ROE is return on equity.",
        },
        {
          id: "slide-4",
          label: "Slide 4",
          text: "Slide 4: Worked example using P_0 = D_1 / (R - g)",
        },
      ];

      const deterministicInventory: FormulaInventoryItem[] = [
        {
          id: "F1",
          slide: 1,
          raw: "P_0 = D_1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          origin: "omml",
        },
        {
          id: "F2",
          slide: 2,
          raw: "NPV = sum CF_t / (1+r)^t - CF_0",
          latex: "NPV = \\sum_{t=1}^T \\frac{CF_t}{(1+r)^t} - CF_0",
          origin: "ocr",
          confidence: 0.94,
        },
      ];

      const extractedFormulas: ExtractedFormulaItem[] = [
        // 1. Matches F1 (deterministic OMML): should enrich F1 without changing its origin or latex
        {
          slide: 1,
          raw: "P_0 = D_1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          label: "Gordon Growth Model",
          variables: [
            { symbol: "P_0", definition: "Current stock price" },
            { symbol: "D_1", definition: "Dividend next year" },
          ],
          evidence: "Slide 1: Valuation basics: P_0 = D_1 / (R - g)",
          isExerciseOnly: false,
        },
        // 2. Novel grounded formula on slide 3: should be appended with origin: "llm"
        {
          slide: 3,
          raw: "g = Retention ratio × ROE",
          latex: "g = \\text{Retention ratio} \\times \\text{ROE}",
          label: "Sustainable Growth Rate",
          variables: [{ symbol: "ROE", definition: "Return on equity" }],
          evidence: "Sustainable growth rate: g = Retention ratio × ROE",
          isExerciseOnly: false,
        },
        // 3. Ungrounded hallucinated formula on slide 1: absent from slide 1 text -> rejected!
        {
          slide: 1,
          raw: "C = S * N(d1) - K * e^(-rt) * N(d2)",
          latex: "C = S N(d_1) - K e^{-rt} N(d_2)",
          label: "Black-Scholes Model",
          variables: [{ symbol: "d_1", definition: "Delta factor" }],
          evidence: "European call option pricing formula",
          isExerciseOnly: false,
        },
        // 4. Duplicate formula on slide 4 (matches F1): should be deduplicated across slides
        {
          slide: 4,
          raw: "P_0 = D_1 / (R - g)",
          latex: "P_0 = \\frac{D_1}{R - g}",
          label: "Gordon Model Exercise",
          variables: [],
          evidence: "Worked example using P_0 = D_1 / (R - g)",
          isExerciseOnly: true,
        },
      ];

      const ledger = mergeFormulaLedger({
        deterministicInventory,
        extractedFormulas,
        sources,
      });

      // Expected ledger items:
      // F1: Gordon Growth Model (OMML, slide 1)
      // F2: NPV (OCR, slide 2)
      // F3: Sustainable Growth Rate (LLM, slide 3)
      // (Black-Scholes rejected, slide 4 duplicate merged/deduplicated)
      expect(ledger).toHaveLength(3);
      expect(ledger.map((e) => e.id)).toEqual(["F1", "F2", "F3"]);

      // Verify F1 properties
      expect(ledger[0].id).toBe("F1");
      expect(ledger[0].slide).toBe(1);
      expect(ledger[0].origin).toBe("omml");
      expect(ledger[0].latex).toBe("P_0 = \\frac{D_1}{R - g}");
      expect(ledger[0].raw).toBe("P_0 = D_1 / (R - g)");
      expect(ledger[0].label).toBe("Gordon Growth Model");
      expect(ledger[0].evidence).toBe(
        "Slide 1: Valuation basics: P_0 = D_1 / (R - g)",
      );
      expect(ledger[0].variables).toEqual([
        { symbol: "P_0", definition: "Current stock price" },
        { symbol: "D_1", definition: "Dividend next year" },
      ]);
      expect(ledger[0].isExerciseOnly).toBe(false);

      // Verify F2 properties
      expect(ledger[1].id).toBe("F2");
      expect(ledger[1].slide).toBe(2);
      expect(ledger[1].origin).toBe("ocr");
      expect(ledger[1].confidence).toBe(0.94);

      // Verify F3 properties (novel grounded LLM formula)
      expect(ledger[2].id).toBe("F3");
      expect(ledger[2].slide).toBe(3);
      expect(ledger[2].origin).toBe("llm");
      expect(ledger[2].latex).toBe(
        "g = \\text{Retention ratio} \\times \\text{ROE}",
      );
      expect(ledger[2].label).toBe("Sustainable Growth Rate");
      expect(ledger[2].variables).toEqual([
        { symbol: "ROE", definition: "Return on equity" },
      ]);

      // Verify ungrounded Black-Scholes formula is NOT in ledger
      const hasBlackScholes = ledger.some((entry) =>
        entry.latex.includes("N(d_1)"),
      );
      expect(hasBlackScholes).toBe(false);
    });
  });

  describe("buildMergedFormulaLedger", () => {
    it("integrates buildFormulaInventory + extractChunkedSlideInventory + mergeFormulaLedger end-to-end with model", async () => {
      const mockModel = { id: "test-model" } as unknown as LanguageModel;
      const sources: SourceBlock[] = [
        {
          id: "slide-1",
          label: "Slide 1",
          text: "Dividend valuation: $P_0 = \\frac{D_1}{R - g}$",
        },
        {
          id: "slide-2",
          label: "Slide 2",
          text: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)\nFirm cost of capital calculation",
        },
      ];

      vi.mocked(generateObject)
        .mockReset()
        .mockResolvedValueOnce({
          object: {
            formulas: [
              {
                slide: 1,
                raw: "P_0 = D_1 / (R - g)",
                latex: "P_0 = \\frac{D_1}{R - g}",
                label: "Gordon Growth Model",
                variables: [{ symbol: "P_0", definition: "Stock price" }],
                evidence: "Dividend valuation: $P_0 = \\frac{D_1}{R - g}$",
                isExerciseOnly: false,
              },
              {
                slide: 2,
                raw: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
                latex: "WACC = \\frac{E}{V} R_e + \\frac{D}{V} R_d (1 - T_c)",
                label: "WACC",
                variables: [{ symbol: "WACC", definition: "Cost of capital" }],
                evidence: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
                isExerciseOnly: false,
              },
            ],
            claims: [
              {
                slide: 1,
                topic: "Valuation",
                claim: "Stock value depends on future dividends",
                evidence: "Dividend valuation",
              },
            ],
          },
        } as any);

      const result = await buildMergedFormulaLedger({
        sources,
        model: mockModel,
      });

      expect(result.chunkCount).toBe(1);
      expect(result.claims).toHaveLength(1);
      expect(result.ledger).toHaveLength(2);

      // Slide 1 formula was discovered deterministically by buildFormulaInventory (text),
      // then enriched with label & variables by LLM extraction pass
      expect(result.ledger[0].id).toBe("F1");
      expect(result.ledger[0].slide).toBe(1);
      expect(result.ledger[0].origin).toBe("text");
      expect(result.ledger[0].label).toBe("Gordon Growth Model");
      expect(result.ledger[0].variables).toEqual([
        { symbol: "P_0", definition: "Stock price" },
      ]);

      // Slide 2 formula was also extracted and merged
      expect(result.ledger[1].id).toBe("F2");
      expect(result.ledger[1].slide).toBe(2);
      expect(result.ledger[1].label).toBe("WACC");
    });

    it("falls back to deterministic inventory without calling model when model is not provided", async () => {
      const sources: SourceBlock[] = [
        {
          id: "slide-1",
          label: "Slide 1",
          text: "P_0 = D_1 / (R - g)",
        },
      ];

      vi.mocked(generateObject).mockReset();

      const result = await buildMergedFormulaLedger({ sources });
      expect(generateObject).not.toHaveBeenCalled();
      expect(result.chunkCount).toBe(0);
      expect(result.claims).toEqual([]);
      expect(result.ledger).toHaveLength(1);
      expect(result.ledger[0].id).toBe("F1");
      expect(result.ledger[0].origin).toBe("text");
      expect(result.ledger[0].latex).toBe("P_0 = D_1 / (R - g)");
    });
  });
});

