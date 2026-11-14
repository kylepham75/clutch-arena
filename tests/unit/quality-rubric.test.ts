import { describe, expect, it } from "vitest";
import {
  evaluateCompilerQualityRubric,
  hasRawArrowsOutsideText,
  hasUnbalancedBraces,
  verifyConditionPreservation,
  verifyManifestCoverage,
  verifyReferenceIntegrity,
  verifyStrictKatexCompile,
  verifySymbolFirstUseHygiene,
} from "@/lib/notes/quality-rubric";
import type {
  AcceptedFormula,
  DocumentBlueprint,
  FormulaCandidate,
  NoteSection,
  SectionDraft,
  SourceAtom,
  SymbolBinding,
} from "@/lib/schemas/notes";

describe("Quality Rubric: Reference Integrity Verifier", () => {
  const sampleAcceptedFormulas: AcceptedFormula[] = [
    {
      id: "F1",
      slide: 3,
      kind: "formula",
      displayLatex: "P_0 = \\frac{D_1}{R - g}",
      raw: "P0 = D1 / (R - g)",
      origin: "omml",
      evidenceIds: [],
      symbolBindingIds: ["SB1", "SB2"],
      conditionAtomIds: ["A1"],
      sourceVariantIds: [],
      revision: 1,
    },
  ];

  const sampleAtoms: SourceAtom[] = [
    {
      id: "A1",
      slide: 3,
      kind: "boundary_condition",
      topic: "Valuation",
      content: "g < R",
      evidence: "g must be strictly less than R",
    },
  ];

  const sampleSymbolBindings: SymbolBinding[] = [
    {
      id: "SB1",
      scopeId: "global",
      symbolLatex: "P_0",
      meaning: "Current stock price",
      slide: 3,
      evidenceIds: [],
    },
    {
      id: "SB2",
      scopeId: "global",
      symbolLatex: "D_1",
      meaning: "Next period dividend",
      slide: 3,
      evidenceIds: [],
    },
  ];

  it("passes when all formulaRefs, supportAtomIds, and symbolBindingIds resolve cleanly", () => {
    const drafts: SectionDraft[] = [
      {
        id: "draft-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC ĐỊNH GIÁ",
        sourceSlides: [3],
        blocks: [
          {
            id: "blk-1",
            kind: "case",
            text: "Mô hình tăng trưởng đều",
            slideCitations: [3],
            supportAtomIds: ["A1"],
            supportMode: "faithful_paraphrase",
            formulaRefs: ["F1"],
            symbolBindingIds: ["SB1", "SB2"],
          },
        ],
      },
    ];

    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC ĐỊNH GIÁ",
        titleEn: "",
        overview: "Tổng quan",
        bulletPoints: ["Điểm quan trọng"],
        formulas: [
          {
            name: "Gordon Model",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            slide: 3,
            variables: [
              { symbol: "P_0", definition: "Current stock price" },
              { symbol: "D_1", definition: "Next period dividend" },
            ],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifyReferenceIntegrity({
      sectionDrafts: drafts,
      sections,
      acceptedFormulas: sampleAcceptedFormulas,
      atoms: sampleAtoms,
      symbolBindings: sampleSymbolBindings,
    });

    expect(result.passed).toBe(true);
    expect(result.unresolvedFormulaRefs).toEqual([]);
    expect(result.unresolvedAtomIds).toEqual([]);
    expect(result.unresolvedSymbolBindingIds).toEqual([]);
    expect(result.defects).toHaveLength(0);
  });

  it("fails and emits MISSING_FORMULA defect when block references non-existent formulaRef", () => {
    const drafts: SectionDraft[] = [
      {
        id: "draft-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC ĐỊNH GIÁ",
        sourceSlides: [3],
        blocks: [
          {
            id: "blk-1",
            kind: "case",
            text: "Mô hình",
            slideCitations: [3],
            supportAtomIds: ["A1"],
            supportMode: "faithful_paraphrase",
            formulaRefs: ["F99"], // Does not exist
            symbolBindingIds: ["SB1"],
          },
        ],
      },
    ];

    const result = verifyReferenceIntegrity({
      sectionDrafts: drafts,
      acceptedFormulas: sampleAcceptedFormulas,
      atoms: sampleAtoms,
      symbolBindings: sampleSymbolBindings,
    });

    expect(result.passed).toBe(false);
    expect(result.unresolvedFormulaRefs).toContain("F99");
    expect(result.defects.some((d) => d.defectType === "MISSING_FORMULA")).toBe(true);
  });

  it("fails and emits UNSUPPORTED_CLAUSE defect when block references non-existent supportAtomId", () => {
    const drafts: SectionDraft[] = [
      {
        id: "draft-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC ĐỊNH GIÁ",
        sourceSlides: [3],
        blocks: [
          {
            id: "blk-1",
            kind: "case",
            text: "Mô hình",
            slideCitations: [3],
            supportAtomIds: ["A999"], // Does not exist
            supportMode: "faithful_paraphrase",
            formulaRefs: ["F1"],
            symbolBindingIds: ["SB1"],
          },
        ],
      },
    ];

    const result = verifyReferenceIntegrity({
      sectionDrafts: drafts,
      acceptedFormulas: sampleAcceptedFormulas,
      atoms: sampleAtoms,
      symbolBindings: sampleSymbolBindings,
    });

    expect(result.passed).toBe(false);
    expect(result.unresolvedAtomIds).toContain("A999");
    expect(result.defects.some((d) => d.defectType === "UNSUPPORTED_CLAUSE")).toBe(true);
  });

  it("fails and emits SYMBOL_DEFINITION_MISPLACED when referencing non-existent symbolBindingId", () => {
    const acceptedWithGhostBinding: AcceptedFormula[] = [
      {
        ...sampleAcceptedFormulas[0],
        symbolBindingIds: ["SB_GHOST"],
      },
    ];

    const result = verifyReferenceIntegrity({
      acceptedFormulas: acceptedWithGhostBinding,
      atoms: sampleAtoms,
      symbolBindings: sampleSymbolBindings,
    });

    expect(result.passed).toBe(false);
    expect(result.unresolvedSymbolBindingIds).toContain("SB_GHOST");
    expect(
      result.defects.some((d) => d.defectType === "SYMBOL_DEFINITION_MISPLACED"),
    ).toBe(true);
  });
});

describe("Quality Rubric: Manifest Coverage Verifier", () => {
  const blueprint: DocumentBlueprint = {
    title: "TEST NOTE",
    subject: "Finance",
    primaryLanguage: "bilingual",
    executiveSummary: "Summary",
    sections: [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CƠ SỞ",
        sourceSlides: [1, 2],
        requiredFormulaIds: ["F1", "F2"],
        requiredAtomIds: ["A1"],
        symbolScopeId: "global",
        targetBlockBudget: 5,
      },
    ],
    glossary: [],
  };

  const acceptedFormulas: AcceptedFormula[] = [
    {
      id: "F1",
      slide: 1,
      kind: "formula",
      displayLatex: "P_0 = \\frac{D_1}{R - g}",
      raw: "P0 = D1 / (R - g)",
      origin: "omml",
      evidenceIds: [],
      symbolBindingIds: [],
      conditionAtomIds: [],
      sourceVariantIds: [],
      revision: 1,
    },
    {
      id: "F2",
      slide: 2,
      kind: "formula",
      displayLatex: "R = \\frac{D_1}{P_0} + g",
      raw: "R = D1 / P0 + g",
      origin: "omml",
      evidenceIds: [],
      symbolBindingIds: [],
      conditionAtomIds: [],
      sourceVariantIds: [],
      revision: 1,
    },
  ];

  it("passes when all required formula IDs and atoms are covered across sections", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CƠ SỞ",
        titleEn: "",
        overview: "Overview statement",
        bulletPoints: ["Bullet point with A1 evidence"],
        formulas: [
          {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            variables: [],
          },
          // Matched by normalized key
          {
            name: "",
            latex: "R = \\frac{D_1}{P_0} + g",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const atoms: SourceAtom[] = [
      {
        id: "A1",
        slide: 1,
        kind: "boundary_condition",
        topic: "Valuation",
        content: "g < R",
        evidence: "Bullet point with A1 evidence",
      },
    ];

    const result = verifyManifestCoverage({
      blueprint,
      sections,
      acceptedFormulas,
      atoms,
    });

    expect(result.passed).toBe(true);
    expect(result.missingFormulaIds).toHaveLength(0);
    expect(result.missingAtomIds).toHaveLength(0);
    expect(result.defects).toHaveLength(0);
  });

  it("fails and records MISSING_FORMULA defect when a required formula is not rendered", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CƠ SỞ",
        titleEn: "",
        overview: "Overview",
        bulletPoints: ["Bullet with A1"],
        formulas: [
          {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            variables: [],
          },
          // F2 is omitted!
        ],
        subSections: [],
      },
    ];

    const atoms: SourceAtom[] = [
      {
        id: "A1",
        slide: 1,
        kind: "boundary_condition",
        topic: "Valuation",
        content: "g < R",
        evidence: "Bullet with A1",
      },
    ];

    const result = verifyManifestCoverage({
      blueprint,
      sections,
      acceptedFormulas,
      atoms,
    });

    expect(result.passed).toBe(false);
    expect(result.missingFormulaIds).toEqual(["F2"]);
    expect(result.defects.some((d) => d.defectType === "MISSING_FORMULA" && d.requiredFormulaId === "F2")).toBe(true);
  });
});

describe("Quality Rubric: Strict KaTeX Compile Verifier", () => {
  it("passes cleanly on valid LaTeX equations and inline math", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. HỢP LỆ",
        titleEn: "",
        overview: "Overview with $NPV > 0$ rule.",
        bulletPoints: ["Make sure $g < R$ holds."],
        formulas: [
          {
            name: "Gordon Model",
            latex: "P_0 = \\frac{D_1}{R - g}",
            variables: [
              { symbol: "P_0", definition: "Stock price" },
              { symbol: "D_1", definition: "Dividend" },
            ],
          },
        ],
        subSections: [
          {
            heading: "Sub topic",
            bulletPoints: [],
            formulas: [
              {
                name: "",
                latex: "R = \\frac{D_1}{P_0} + g",
                variables: [],
              },
            ],
          },
        ],
      },
    ];

    const result = verifyStrictKatexCompile({ sections });
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.defects).toHaveLength(0);
    expect(result.totalChecked).toBeGreaterThan(0);
  });

  it("rejects empty LaTeX math expression", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TEST",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "   ",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifyStrictKatexCompile({ sections });
    expect(result.passed).toBe(false);
    expect(result.failures[0].error).toContain("Empty LaTeX math expression");
    expect(result.defects[0].defectType).toBe("KATEX_SYNTAX_ERROR");
  });

  it("rejects dangling relation operator equations like 'P_0 ='", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TEST",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "P_0 =",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifyStrictKatexCompile({ sections });
    expect(result.passed).toBe(false);
    expect(result.failures[0].error).toContain("Dangling relation operator");
    expect(result.defects[0].defectType).toBe("KATEX_SYNTAX_ERROR");
  });

  it("rejects unbalanced curly braces in LaTeX", () => {
    expect(hasUnbalancedBraces("x + {y")).toBe(true);
    expect(hasUnbalancedBraces("x + y}")).toBe(true);
    expect(hasUnbalancedBraces("\\frac{1}{2}")).toBe(false);
    expect(hasUnbalancedBraces("\\{ x \\}")).toBe(false);

    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TEST",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifyStrictKatexCompile({ sections });
    expect(result.passed).toBe(false);
    expect(result.failures[0].error).toContain("Unbalanced curly braces");
    expect(result.defects[0].defectType).toBe("KATEX_SYNTAX_ERROR");
  });

  it("rejects raw unescaped '=>' or '->' outside \\text{...}", () => {
    expect(hasRawArrowsOutsideText("P_0 => D_1")).toBe(true);
    expect(hasRawArrowsOutsideText("A -> B")).toBe(true);
    expect(hasRawArrowsOutsideText("\\text{A -> B}")).toBe(false);
    expect(hasRawArrowsOutsideText("A \\implies B")).toBe(false);
    expect(hasRawArrowsOutsideText("x <= y")).toBe(false);
    expect(hasRawArrowsOutsideText("x >= y")).toBe(false);

    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TEST",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "P_0 \\Rightarrow D_1 => R",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifyStrictKatexCompile({ sections });
    expect(result.passed).toBe(false);
    expect(result.failures[0].error).toContain("Raw unescaped '=>' or '->'");
  });

  it("rejects genuine KaTeX compile errors like unknown control sequences", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TEST",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "P_0 = \\unknownmacro{xyz}",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifyStrictKatexCompile({ sections });
    expect(result.passed).toBe(false);
    expect(result.failures[0].error).toContain("Undefined control sequence");
  });
});

describe("Quality Rubric: Condition Preservation Verifier", () => {
  const sampleAtom: SourceAtom = {
    id: "atom-cond-1",
    slide: 4,
    kind: "boundary_condition",
    topic: "Stock Valuation",
    content: "g < R",
    evidence: "The dividend growth rate g must be less than the required return R",
  };

  it("passes when boundary condition is preserved accurately in section text", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ",
        titleEn: "",
        overview: "Overview",
        bulletPoints: [
          "Điều kiện tiên quyết: tăng trưởng $g < R$ để mô hình có nghĩa.",
        ],
        formulas: [],
        subSections: [],
        sourceSlides: [4],
      },
    ];

    const result = verifyConditionPreservation({
      sections,
      atoms: [sampleAtom],
    });

    expect(result.passed).toBe(true);
    expect(result.missingConditions).toHaveLength(0);
    expect(result.defects).toHaveLength(0);
  });

  it("fails and emits MISSING_CONDITION when condition inequality is inverted (e.g. g < R inverted to g > R)", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ",
        titleEn: "",
        overview: "Overview",
        bulletPoints: [
          // Inverted condition!
          "Điều kiện: $g > R$ để mô hình áp dụng được.",
        ],
        formulas: [],
        subSections: [],
        sourceSlides: [4],
      },
    ];

    const result = verifyConditionPreservation({
      sections,
      atoms: [sampleAtom],
    });

    expect(result.passed).toBe(false);
    expect(result.missingConditions).toHaveLength(1);
    expect(result.missingConditions[0].reason).toContain("inverted");
    expect(result.defects[0].defectType).toBe("MISSING_CONDITION");
  });

  it("fails and emits MISSING_CONDITION when NPV > 0 is inverted to NPV < 0", () => {
    const npvAtom: SourceAtom = {
      id: "atom-npv",
      slide: 5,
      kind: "boundary_condition",
      topic: "Capital Budgeting",
      content: "NPV > 0",
      evidence: "Accept project if NPV > 0",
    };

    const sections: NoteSection[] = [
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. QUY TẮC NPV",
        titleEn: "",
        overview: "Chấp nhận dự án khi $NPV < 0$.", // Inverted!
        bulletPoints: [],
        formulas: [],
        subSections: [],
        sourceSlides: [5],
      },
    ];

    const result = verifyConditionPreservation({
      sections,
      atoms: [npvAtom],
    });

    expect(result.passed).toBe(false);
    expect(result.missingConditions[0].reason).toContain("inverted");
    expect(result.defects.some((d) => d.defectType === "MISSING_CONDITION")).toBe(true);
  });

  it("passes when condition is preserved via text token overlap (>= 40%)", () => {
    const proseCondition: SourceAtom = {
      id: "atom-prose-cond",
      slide: 2,
      kind: "boundary_condition",
      topic: "Gordon Model",
      content: "Only applies to mature dividend paying firms with constant growth",
      evidence: "Mature dividend paying firms only",
    };

    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. MÔ HÌNH",
        titleEn: "",
        overview: "Overview",
        bulletPoints: [
          "Mô hình chỉ áp dụng cho mature dividend paying firms có constant growth ổn định.",
        ],
        formulas: [],
        subSections: [],
        sourceSlides: [2],
      },
    ];

    const result = verifyConditionPreservation({
      sections,
      atoms: [proseCondition],
    });

    expect(result.passed).toBe(true);
  });
});

describe("Quality Rubric: Symbol First-Use Hygiene Verifier", () => {
  const sampleAcceptedFormulas: AcceptedFormula[] = [
    {
      id: "F1",
      slide: 1,
      kind: "formula",
      displayLatex: "P_0 = \\frac{D_1}{R - g}",
      raw: "P0 = D1 / (R - g)",
      origin: "omml",
      evidenceIds: [],
      symbolBindingIds: ["SB_P0", "SB_D1"],
      conditionAtomIds: [],
      sourceVariantIds: [],
      revision: 1,
    },
    {
      id: "F2",
      slide: 2,
      kind: "formula",
      displayLatex: "R = \\frac{D_1}{P_0} + g",
      raw: "R = D1 / P0 + g",
      origin: "omml",
      evidenceIds: [],
      symbolBindingIds: ["SB_R"],
      conditionAtomIds: [],
      sourceVariantIds: [],
      revision: 1,
    },
  ];

  const sampleBindings: SymbolBinding[] = [
    {
      id: "SB_P0",
      scopeId: "global",
      symbolLatex: "P_0",
      meaning: "Price today",
      slide: 1,
      evidenceIds: [],
    },
    {
      id: "SB_D1",
      scopeId: "global",
      symbolLatex: "D_1",
      meaning: "Next dividend",
      slide: 1,
      evidenceIds: [],
    },
  ];

  it("passes when symbols are defined on their first use in reading order", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC 1",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            variables: [
              { symbol: "P_0", definition: "Price today" },
              { symbol: "D_1", definition: "Next dividend" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. CÔNG THỨC 2",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "R = \\frac{D_1}{P_0} + g",
            formulaRefs: ["F2"],
            // P_0 and D_1 already defined earlier, so not redefined here
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifySymbolFirstUseHygiene({
      sections,
      acceptedFormulas: sampleAcceptedFormulas,
      symbolBindings: sampleBindings,
    });

    expect(result.passed).toBe(true);
    expect(result.duplicateDefinitions).toHaveLength(0);
    expect(result.misplacedDefinitions).toHaveLength(0);
    expect(result.defects).toHaveLength(0);
  });

  it("fails and emits SYMBOL_DEFINITION_MISPLACED on duplicate definition within the same scope", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC 1",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            variables: [
              { symbol: "P_0", definition: "Price today" },
            ],
          },
          {
            name: "",
            latex: "P_0 = \\frac{D_0 (1+g)}{R - g}",
            formulaRefs: ["F1"],
            // Duplicate definition of P_0!
            variables: [
              { symbol: "P_0", definition: "Price today duplicate" },
            ],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifySymbolFirstUseHygiene({
      sections,
      acceptedFormulas: sampleAcceptedFormulas,
      symbolBindings: sampleBindings,
    });

    expect(result.passed).toBe(false);
    expect(result.duplicateDefinitions).toHaveLength(1);
    expect(result.duplicateDefinitions[0].symbol).toBe("P_0");
    expect(result.defects.some((d) => d.defectType === "SYMBOL_DEFINITION_MISPLACED")).toBe(true);
  });

  it("fails and emits SYMBOL_DEFINITION_MISPLACED when a definition is delayed to a later formula", () => {
    const sections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CÔNG THỨC 1",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            // P_0 is used here but omitted from variables!
            variables: [
              { symbol: "D_1", definition: "Next dividend" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. CÔNG THỨC 2",
        titleEn: "",
        overview: "",
        bulletPoints: [],
        formulas: [
          {
            name: "",
            latex: "R = \\frac{D_1}{P_0} + g",
            formulaRefs: ["F2"],
            // P_0 is defined here for the first time, which is late!
            variables: [
              { symbol: "P_0", definition: "Price today" },
            ],
          },
        ],
        subSections: [],
      },
    ];

    const result = verifySymbolFirstUseHygiene({
      sections,
      acceptedFormulas: sampleAcceptedFormulas,
      symbolBindings: sampleBindings,
    });

    expect(result.passed).toBe(false);
    expect(result.misplacedDefinitions).toHaveLength(1);
    expect(result.misplacedDefinitions[0].symbol).toBe("P_0");
    expect(result.misplacedDefinitions[0].expectedSectionLetter).toBe("A");
    expect(result.misplacedDefinitions[0].actualSectionLetter).toBe("B");
    expect(result.defects.some((d) => d.defectType === "SYMBOL_DEFINITION_MISPLACED")).toBe(true);
  });
});

describe("Quality Rubric: End-to-End Evaluation & QAReport Status Classification", () => {
  const blueprint: DocumentBlueprint = {
    title: "VALUATION MASTER",
    subject: "Corporate Finance",
    primaryLanguage: "bilingual",
    executiveSummary: "Executive summary",
    sections: [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. MÔ HÌNH CƠ BẢN",
        sourceSlides: [1],
        requiredFormulaIds: ["F1"],
        requiredAtomIds: ["A1"],
        symbolScopeId: "global",
        targetBlockBudget: 3,
      },
    ],
    glossary: [],
  };

  const acceptedFormulas: AcceptedFormula[] = [
    {
      id: "F1",
      slide: 1,
      kind: "formula",
      displayLatex: "P_0 = \\frac{D_1}{R - g}",
      raw: "P0 = D1 / (R - g)",
      origin: "omml",
      evidenceIds: [],
      symbolBindingIds: ["SB1"],
      conditionAtomIds: ["A1"],
      sourceVariantIds: [],
      revision: 1,
    },
  ];

  const atoms: SourceAtom[] = [
    {
      id: "A1",
      slide: 1,
      kind: "boundary_condition",
      topic: "Valuation",
      content: "g < R",
      evidence: "Must satisfy g < R",
    },
  ];

  const symbolBindings: SymbolBinding[] = [
    {
      id: "SB1",
      scopeId: "global",
      symbolLatex: "P_0",
      meaning: "Price today",
      slide: 1,
      evidenceIds: [],
    },
  ];

  const validSectionDrafts: SectionDraft[] = [
    {
      id: "sec-a",
      letter: "A",
      titleVi: "A. MÔ HÌNH CƠ BẢN",
      sourceSlides: [1],
      blocks: [
        {
          id: "blk-1",
          kind: "case",
          text: "Mô hình g < R",
          slideCitations: [1],
          supportAtomIds: ["A1"],
          supportMode: "faithful_paraphrase",
          formulaRefs: ["F1"],
          symbolBindingIds: ["SB1"],
        },
      ],
    },
  ];

  const validSections: NoteSection[] = [
    {
      id: "sec-a",
      letter: "A",
      titleVi: "A. MÔ HÌNH CƠ BẢN",
      titleEn: "",
      overview: "Overview",
      bulletPoints: ["Điều kiện $g < R$"],
      formulas: [
        {
          name: "Gordon Model",
          latex: "P_0 = \\frac{D_1}{R - g}",
          formulaRefs: ["F1"],
          slide: 1,
          variables: [{ symbol: "P_0", definition: "Price today" }],
        },
      ],
      subSections: [],
      sourceSlides: [1],
    },
  ];

  it("evaluates to READY when all 5 pillars pass with zero defects", () => {
    const report = evaluateCompilerQualityRubric({
      blueprint,
      sectionDrafts: validSectionDrafts,
      sections: validSections,
      acceptedFormulas,
      atoms,
      symbolBindings,
    });

    expect(report.passed).toBe(true);
    expect(report.qaReport.status).toBe("READY");
    expect(report.qaReport.missingRequiredFormulaIds).toHaveLength(0);
    expect(report.qaReport.defects).toHaveLength(0);
  });

  it("evaluates to FAILED when required formulas are missing or KaTeX errors occur", () => {
    const brokenSections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. MÔ HÌNH CƠ BẢN",
        titleEn: "",
        overview: "Overview",
        bulletPoints: [],
        formulas: [
          {
            name: "Broken KaTeX",
            latex: "\\frac{1}{", // KaTeX compile error!
            formulaRefs: ["F1"],
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const report = evaluateCompilerQualityRubric({
      blueprint,
      sectionDrafts: validSectionDrafts,
      sections: brokenSections,
      acceptedFormulas,
      atoms,
      symbolBindings,
    });

    expect(report.passed).toBe(false);
    expect(report.qaReport.status).toBe("FAILED");
  });

  it("evaluates to LAYOUT_OVERFLOW when section draft exceeds targetBlockBudget", () => {
    const overfullDrafts: SectionDraft[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. MÔ HÌNH CƠ BẢN",
        sourceSlides: [1],
        blocks: [
          { id: "b1", kind: "case", text: "t1", slideCitations: [1], supportAtomIds: ["A1"], formulaRefs: ["F1"], symbolBindingIds: ["SB1"], supportMode: "faithful_paraphrase" },
          { id: "b2", kind: "case", text: "t2", slideCitations: [1], supportAtomIds: ["A1"], formulaRefs: ["F1"], symbolBindingIds: ["SB1"], supportMode: "faithful_paraphrase" },
          { id: "b3", kind: "case", text: "t3", slideCitations: [1], supportAtomIds: ["A1"], formulaRefs: ["F1"], symbolBindingIds: ["SB1"], supportMode: "faithful_paraphrase" },
          { id: "b4", kind: "case", text: "t4", slideCitations: [1], supportAtomIds: ["A1"], formulaRefs: ["F1"], symbolBindingIds: ["SB1"], supportMode: "faithful_paraphrase" }, // 4 > targetBlockBudget (3)
        ],
      },
    ];

    const report = evaluateCompilerQualityRubric({
      blueprint,
      sectionDrafts: overfullDrafts,
      sections: validSections,
      acceptedFormulas,
      atoms,
      symbolBindings,
    });

    expect(report.passed).toBe(false);
    expect(report.qaReport.status).toBe("LAYOUT_OVERFLOW");
    expect(report.defects.some((d) => d.defectType === "SECTION_OVERFULL")).toBe(true);
  });

  it("evaluates to NEEDS_SOURCE_REVIEW when condition or symbol defects exist without hard compiler failures", () => {
    const invertedConditionSections: NoteSection[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. MÔ HÌNH CƠ BẢN",
        titleEn: "",
        overview: "Overview",
        bulletPoints: ["Điều kiện $g > R$"], // Inverted!
        formulas: [
          {
            name: "Gordon Model",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F1"],
            variables: [{ symbol: "P_0", definition: "Price today" }],
          },
        ],
        subSections: [],
        sourceSlides: [1],
      },
    ];

    const report = evaluateCompilerQualityRubric({
      blueprint,
      sectionDrafts: validSectionDrafts,
      sections: invertedConditionSections,
      acceptedFormulas,
      atoms,
      symbolBindings,
    });

    expect(report.passed).toBe(false);
    expect(report.qaReport.status).toBe("NEEDS_SOURCE_REVIEW");
    expect(report.defects.some((d) => d.defectType === "MISSING_CONDITION")).toBe(true);
  });
});
