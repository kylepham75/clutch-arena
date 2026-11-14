import { describe, it, expect, vi } from "vitest";
import {
  ensureBlueprintArtifactOwnership,
  buildDeterministicBlueprintFallback,
  planDocumentBlueprint,
  ensureSectionDraftFormulaCoverage,
  buildDeterministicSectionDraft,
  writeSectionDraftsParallel,
  applyFirstUseSymbolBindingsToSections,
  compileNoteDocument,
  renderDocumentMarkdown,
} from "@/lib/ai/note-compiler";
import {
  type AcceptedFormula,
  type BlueprintSectionPlan,
  type DocumentBlueprint,
  type SectionDraft,
  type SourceAtom,
  type SymbolBinding,
  type TriagedSlide,
  type FormulaCandidate,
  type NoteSection,
  clutchNoteSchema,
  publishedHandoutSchema,
} from "@/lib/schemas/notes";
import type { FinancialConventionPin } from "@/lib/ai/prompts-notes";

describe("Global Blueprint Planning", () => {
  it("assigns unowned AcceptedFormulas and SourceAtoms to matching sections", () => {
    const includedSlides: TriagedSlide[] = [
      {
        slide: 10,
        label: "Slide 10: General Valuation",
        tags: ["CONCEPT", "FORMULA"],
        disposition: "INCLUDE",
        reason: "Core formula",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "P_0 = D_1 / (1 + R)",
      },
      {
        slide: 20,
        label: "Slide 20: Dividend Models",
        tags: ["CONCEPT", "FORMULA"],
        disposition: "INCLUDE",
        reason: "Core formula",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "P_0 = D_1 / (R - g)",
      },
    ];

    const acceptedFormulas: AcceptedFormula[] = [
      {
        id: "F1",
        slide: 10,
        kind: "formula",
        displayLatex: "P_0 = \\frac{D_1}{1 + R}",
        raw: "P_0 = D_1 / (1 + R)",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_1"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
      {
        id: "F2",
        slide: 20,
        kind: "formula",
        displayLatex: "P_0 = \\frac{D_1}{R - g}",
        raw: "P_0 = D_1 / (R - g)",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_2"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
    ];

    const atoms: SourceAtom[] = [
      {
        id: "S10:A1",
        slide: 10,
        kind: "concept",
        topic: "Valuation",
        content: "Nguyên lý hiện giá dòng tiền tương lai.",
        evidence: "Present value of future cash flows.",
      },
      {
        id: "S20:A1",
        slide: 20,
        kind: "rule",
        topic: "Gordon Model",
        content: "Điều kiện áp dụng g < R.",
        evidence: "Requires g < R.",
      },
    ];

    // Initial mock blueprint where requiredFormulaIds and requiredAtomIds are empty
    const mockBlueprint: DocumentBlueprint = {
      title: "STOCK VALUATION",
      subject: "Corporate Finance",
      primaryLanguage: "bilingual",
      executiveSummary: "Tóm tắt định giá cổ phiếu.",
      sections: [
        {
          id: "sec-a-1",
          letter: "A",
          titleVi: "A. NGUYÊN LÝ ĐỊNH GIÁ",
          titleEn: "Valuation Principles",
          sourceSlides: [10],
          requiredFormulaIds: [],
          requiredAtomIds: [],
          symbolScopeId: "sec-a",
          targetBlockBudget: 6,
        },
        {
          id: "sec-b-2",
          letter: "B",
          titleVi: "B. MÔ HÌNH CHIẾT KHẤU CỔ TỨC",
          titleEn: "Dividend Discount Models",
          sourceSlides: [20],
          requiredFormulaIds: [],
          requiredAtomIds: [],
          symbolScopeId: "sec-b",
          targetBlockBudget: 6,
        },
      ],
      glossary: [],
    };

    const result = ensureBlueprintArtifactOwnership(mockBlueprint, {
      acceptedFormulas,
      atoms,
      includedSlides,
      totalSlideCount: 25,
      isShortNote: false,
    });

    // Verify F1 and S10:A1 assigned to Section A
    expect(result.sections[0].requiredFormulaIds).toContain("F1");
    expect(result.sections[0].requiredAtomIds).toContain("S10:A1");

    // Verify F2 and S20:A1 assigned to Section B
    expect(result.sections[1].requiredFormulaIds).toContain("F2");
    expect(result.sections[1].requiredAtomIds).toContain("S20:A1");
  });

  it("guarantees late-deck ownership on a 105-slide deck where late slides 95–105 (CAPM F31, F32) were omitted", () => {
    const includedSlides: TriagedSlide[] = [
      {
        slide: 10,
        label: "Slide 10: Risk and Return Overview",
        tags: ["CONCEPT"],
        disposition: "INCLUDE",
        reason: "Core",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "Overview of expected returns.",
      },
      {
        slide: 50,
        label: "Slide 50: Portfolio Risk",
        tags: ["CONCEPT", "FORMULA"],
        disposition: "INCLUDE",
        reason: "Core",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "Portfolio variance and diversification.",
      },
      {
        slide: 95,
        label: "Slide 95: CAPM and SML",
        tags: ["CONCEPT", "FORMULA"],
        disposition: "INCLUDE",
        reason: "Late deck model",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "E(R_i) = R_f + \\beta_i (E(R_m) - R_f)",
      },
      {
        slide: 105,
        label: "Slide 105: Beta Estimation",
        tags: ["FORMULA", "EXAM_HINT"],
        disposition: "INCLUDE",
        reason: "Late deck formula",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "\\beta_i = Cov(R_i, R_m) / \\sigma_m^2",
      },
    ];

    const acceptedFormulas: AcceptedFormula[] = [
      {
        id: "F1",
        slide: 10,
        kind: "formula",
        displayLatex: "E(R) = \\sum p_i R_i",
        raw: "E(R) = sum p_i R_i",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: [],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
      {
        id: "F31",
        slide: 95,
        kind: "formula",
        displayLatex: "E(R_i) = R_f + \\beta_i (E(R_m) - R_f)",
        raw: "E(R_i) = R_f + beta_i (E(R_m) - R_f)",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_CAPM"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
      {
        id: "F32",
        slide: 105,
        kind: "formula",
        displayLatex: "\\beta_i = \\frac{\\text{Cov}(R_i, R_m)}{\\sigma_m^2}",
        raw: "beta_i = Cov(R_i, R_m) / sigma_m^2",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_BETA"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
    ];

    const atoms: SourceAtom[] = [
      {
        id: "S95:A1",
        slide: 95,
        kind: "rule",
        topic: "CAPM",
        content: "Mô hình định giá tài sản vốn CAPM phản ánh phần bù rủi ro hệ thống.",
        evidence: "CAPM reflects systematic risk premium.",
      },
      {
        id: "S105:A1",
        slide: 105,
        kind: "concept",
        topic: "Beta",
        content: "Hệ số beta đo lường độ nhạy cảm đối với rủi ro thị trường.",
        evidence: "Beta measures sensitivity to market risk.",
      },
    ];

    // Mock planner omitted slides 95-105 completely
    const mockBlueprint: DocumentBlueprint = {
      title: "RISK AND RETURN",
      subject: "Corporate Finance",
      primaryLanguage: "bilingual",
      executiveSummary: "Tóm tắt rủi ro và tỷ suất sinh lời.",
      sections: [
        {
          id: "sec-a-1",
          letter: "A",
          titleVi: "A. TỔNG QUAN TỶ SUẤT SINH LỜI",
          sourceSlides: [10],
          requiredFormulaIds: ["F1"],
          requiredAtomIds: [],
          symbolScopeId: "sec-a",
          targetBlockBudget: 6,
        },
        {
          id: "sec-b-2",
          letter: "B",
          titleVi: "B. RỦI RO DANH MỤC",
          sourceSlides: [50],
          requiredFormulaIds: [],
          requiredAtomIds: [],
          symbolScopeId: "sec-b",
          targetBlockBudget: 6,
        },
      ],
      glossary: [],
    };

    const result = ensureBlueprintArtifactOwnership(mockBlueprint, {
      acceptedFormulas,
      atoms,
      includedSlides,
      totalSlideCount: 105,
      isShortNote: false,
    });

    // Confirm that a late-deck section (Section C) is deterministically added
    expect(result.sections.length).toBe(3);
    const lateSection = result.sections[2];
    expect(lateSection.letter).toBe("C");
    expect(lateSection.sourceSlides).toEqual(expect.arrayContaining([95, 105]));
    expect(lateSection.requiredFormulaIds).toEqual(expect.arrayContaining(["F31", "F32"]));
    expect(lateSection.requiredAtomIds).toEqual(expect.arrayContaining(["S95:A1", "S105:A1"]));
  });

  it("merges late-deck slides into final section when isShortNote is true", () => {
    const includedSlides: TriagedSlide[] = [
      {
        slide: 1,
        label: "Slide 1: Core",
        tags: ["CONCEPT"],
        disposition: "INCLUDE",
        reason: "Core",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "Core concept",
      },
      {
        slide: 85,
        label: "Slide 85: Late Topic",
        tags: ["FORMULA"],
        disposition: "INCLUDE",
        reason: "Late",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "Late formula",
      },
    ];

    const acceptedFormulas: AcceptedFormula[] = [
      {
        id: "F10",
        slide: 85,
        kind: "formula",
        displayLatex: "WACC = w_d r_d (1 - T_c) + w_e r_e",
        raw: "WACC = w_d r_d (1 - T_c) + w_e r_e",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: [],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
    ];

    const mockBlueprint: DocumentBlueprint = {
      title: "FREE TIER NOTE",
      subject: "Finance",
      primaryLanguage: "bilingual",
      executiveSummary: "Bản tóm tắt ngắn.",
      sections: [
        {
          id: "sec-a-1",
          letter: "A",
          titleVi: "A. BẢN TỔNG HỢP TRỌNG TÂM",
          sourceSlides: [1],
          requiredFormulaIds: [],
          requiredAtomIds: [],
          symbolScopeId: "global",
          targetBlockBudget: 6,
        },
      ],
      glossary: [],
    };

    const result = ensureBlueprintArtifactOwnership(mockBlueprint, {
      acceptedFormulas,
      atoms: [],
      includedSlides,
      totalSlideCount: 100,
      isShortNote: true,
    });

    expect(result.sections.length).toBe(1);
    expect(result.sections[0].sourceSlides).toContain(85);
    expect(result.sections[0].requiredFormulaIds).toContain("F10");
  });

  it("buildDeterministicBlueprintFallback generates valid blueprint partition", () => {
    const slides: TriagedSlide[] = Array.from({ length: 20 }, (_, i) => ({
      slide: i + 1,
      label: `Slide ${i + 1}: Topic ${i + 1}`,
      tags: ["CONCEPT"],
      disposition: "INCLUDE",
      reason: "Core",
      requiresVisionAdjudication: false,
      extractedRecipeSteps: [],
      cleanedText: `Slide content ${i + 1}`,
    }));

    const blueprint = buildDeterministicBlueprintFallback({
      fileName: "Chapter_7_Bond_Valuation.pptx",
      totalSlideCount: 20,
      includedSlides: slides,
      acceptedFormulas: [],
      atoms: [],
      isShortNote: false,
    });

    expect(blueprint.sections.length).toBeGreaterThanOrEqual(3);
    expect(blueprint.sections.length).toBeLessThanOrEqual(10);
    expect(blueprint.sections[0].letter).toBe("A");
    expect(blueprint.sections[1].letter).toBe("B");
    expect(blueprint.sections[2].letter).toBe("C");
  });

  it("planDocumentBlueprint falls back to deterministic blueprint when model omitted", async () => {
    const slides: TriagedSlide[] = [
      {
        slide: 1,
        label: "Slide 1: Intro",
        tags: ["CONCEPT"],
        disposition: "INCLUDE",
        reason: "Core",
        requiresVisionAdjudication: false,
        extractedRecipeSteps: [],
        cleanedText: "Introduction",
      },
    ];

    const blueprint = await planDocumentBlueprint({
      fileName: "Test.pptx",
      totalSlideCount: 1,
      includedSlides: slides,
      acceptedFormulas: [],
      atoms: [],
      isShortNote: true,
    });

    expect(blueprint.sections.length).toBe(1);
    expect(blueprint.sections[0].letter).toBe("A");
  });
});

describe("Parallel Section Writing & Formula Coverage", () => {
  it("executes with bounded concurrency (4–6 max active) and preserves exact section order A..H", async () => {
    const sectionLetters = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const blueprint: DocumentBlueprint = {
      title: "EXTENSIVE VALUATION",
      subject: "Finance",
      primaryLanguage: "bilingual",
      executiveSummary: "Executive summary.",
      sections: sectionLetters.map((letter, i) => ({
        id: `sec-${letter.toLowerCase()}-${i + 1}`,
        letter,
        titleVi: `${letter}. PHẦN ${letter}`,
        sourceSlides: [i + 1],
        requiredFormulaIds: [],
        requiredAtomIds: [],
        symbolScopeId: `sec-${letter.toLowerCase()}`,
        targetBlockBudget: 4,
      })),
      glossary: [],
    };

    let activeCount = 0;
    let maxActiveCount = 0;

    const mockSectionWriterFn = vi.fn(
      async (sectionPlan: BlueprintSectionPlan): Promise<SectionDraft> => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 25));
        activeCount--;

        return {
          id: sectionPlan.id,
          letter: sectionPlan.letter,
          titleVi: sectionPlan.titleVi,
          sourceSlides: sectionPlan.sourceSlides,
          blocks: [
            {
              id: `${sectionPlan.id}-block-1`,
              kind: "intuition",
              heading: sectionPlan.titleVi,
              text: `Nội dung phần ${sectionPlan.letter}`,
              slideCitations: sectionPlan.sourceSlides,
              supportAtomIds: [],
              supportMode: "faithful_paraphrase",
              formulaRefs: [],
              symbolBindingIds: [],
            },
          ],
        };
      },
    );

    const drafts = await writeSectionDraftsParallel({
      fileName: "Deck.pptx",
      blueprint,
      slides: sectionLetters.map((_, i) => ({
        slide: i + 1,
        label: `Slide ${i + 1}`,
        text: `Slide text ${i + 1}`,
      })),
      acceptedFormulas: [],
      atoms: [],
      symbolBindings: [],
      concurrency: 5,
      sectionWriterFn: mockSectionWriterFn,
    });

    // Check bounded concurrency: max active tasks must be <= 5
    expect(maxActiveCount).toBeLessThanOrEqual(5);
    expect(maxActiveCount).toBeGreaterThanOrEqual(2);

    // Check exact preservation of blueprint section order A..H
    expect(drafts.map((d) => d.letter)).toEqual(sectionLetters);
  });

  it("post-write formula coverage enforcement injects missed requiredFormulaIds", () => {
    const sectionPlan: BlueprintSectionPlan = {
      id: "sec-a-1",
      letter: "A",
      titleVi: "A. CÔNG THỨC TRỌNG TÂM",
      sourceSlides: [1, 2],
      requiredFormulaIds: ["F1", "F2"],
      requiredAtomIds: [],
      symbolScopeId: "sec-a",
      targetBlockBudget: 4,
    };

    const acceptedFormulas: AcceptedFormula[] = [
      {
        id: "F1",
        slide: 1,
        kind: "formula",
        displayLatex: "P_0 = \\frac{D_1}{R - g}",
        raw: "P_0 = D_1 / (R - g)",
        origin: "text",
        label: "Gordon Growth",
        evidenceIds: [],
        symbolBindingIds: ["SYM_1"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
      {
        id: "F2",
        slide: 2,
        kind: "formula",
        displayLatex: "g = b \\times \\text{ROE}",
        raw: "g = b * ROE",
        origin: "text",
        label: "Sustainable Growth",
        evidenceIds: [],
        symbolBindingIds: ["SYM_2"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
    ];

    // Section writer returned draft containing ONLY F1
    const draftOmittingF2: SectionDraft = {
      id: "sec-a-1",
      letter: "A",
      titleVi: "A. CÔNG THỨC TRỌNG TÂM",
      sourceSlides: [1, 2],
      blocks: [
        {
          id: "sec-a-1-b1",
          kind: "case",
          heading: "Gordon Growth",
          text: "Áp dụng công thức Gordon.",
          slideCitations: [1],
          supportAtomIds: [],
          supportMode: "faithful_paraphrase",
          formulaRefs: ["F1"],
          symbolBindingIds: ["SYM_1"],
        },
      ],
    };

    const repairedDraft = ensureSectionDraftFormulaCoverage(
      draftOmittingF2,
      sectionPlan,
      acceptedFormulas,
      [],
    );

    const allPlacedFormulaIds = repairedDraft.blocks.flatMap((b) => b.formulaRefs);
    expect(allPlacedFormulaIds).toContain("F1");
    expect(allPlacedFormulaIds).toContain("F2");
  });

  it("buildDeterministicSectionDraft produces structured teaching blocks", () => {
    const sectionPlan: BlueprintSectionPlan = {
      id: "sec-a-1",
      letter: "A",
      titleVi: "A. CƠ CHẾ VÀ QUY TRÌNH",
      sourceSlides: [5],
      requiredFormulaIds: ["F1"],
      requiredAtomIds: ["S5:A1", "S5:R1", "S5:B1"],
      symbolScopeId: "sec-a",
      targetBlockBudget: 6,
    };

    const formulas: AcceptedFormula[] = [
      {
        id: "F1",
        slide: 5,
        kind: "formula",
        displayLatex: "NPV = \\sum_{t=1}^n \\frac{CF_t}{(1 + r)^t} - CF_0",
        raw: "NPV = sum CF_t / (1 + r)^t - CF_0",
        origin: "text",
        label: "Net Present Value",
        evidenceIds: [],
        symbolBindingIds: [],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
    ];

    const atoms: SourceAtom[] = [
      {
        id: "S5:A1",
        slide: 5,
        kind: "concept",
        topic: "NPV Rule",
        content: "NPV đo lường giá trị gia tăng ròng của dự án đầu tư.",
        evidence: "NPV measures net value added.",
      },
      {
        id: "S5:R1",
        slide: 5,
        kind: "procedure",
        topic: "NPV Calculation",
        content: "Bước 1: Dự phóng dòng tiền. Bước 2: Chiết khấu về hiện giá.",
        evidence: "Step 1: Forecast. Step 2: Discount.",
        isWorkedExampleDerived: true,
      },
      {
        id: "S5:B1",
        slide: 5,
        kind: "boundary_condition",
        topic: "Decision Boundary",
        content: "Quy tắc chấp nhận dự án: Chấp nhận nếu và chỉ nếu NPV > 0.",
        evidence: "Accept project iff NPV > 0.",
      },
    ];

    const draft = buildDeterministicSectionDraft(
      sectionPlan,
      [{ slide: 5, label: "Slide 5", text: "NPV content" }],
      formulas,
      atoms,
    );

    const kinds = draft.blocks.map((b) => b.kind);
    expect(kinds).toContain("intuition");
    expect(kinds).toContain("recipe");
    expect(kinds).toContain("case");
    expect(kinds).toContain("caution");
    expect(kinds).toContain("takeaway");
  });
});

describe("Deterministic Document Compiler", () => {
  it("enforces first-use 'Trong đó:' variable definitions in reading order across sections", () => {
    const symbolBindings: SymbolBinding[] = [
      {
        id: "SYM_1",
        scopeId: "global",
        symbolLatex: "P_0",
        meaning: "Giá cổ phiếu hiện tại ở thời điểm t = 0",
        slide: 5,
        evidenceIds: [],
      },
      {
        id: "SYM_2",
        scopeId: "global",
        symbolLatex: "D_1",
        meaning: "Cổ tức kỳ vọng nhận được ở năm 1",
        slide: 5,
        evidenceIds: [],
      },
      {
        id: "SYM_3",
        scopeId: "global",
        symbolLatex: "g",
        meaning: "Tốc độ tăng trưởng cổ tức dài hạn",
        slide: 15,
        evidenceIds: [],
      },
      {
        id: "SYM_4",
        scopeId: "sec-c",
        symbolLatex: "R",
        meaning: "Tỷ suất sinh lời đòi hỏi của cổ phiếu ưu đãi",
        slide: 25,
        evidenceIds: [],
      },
    ];

    const acceptedFormulas: AcceptedFormula[] = [
      {
        id: "F1",
        slide: 5,
        kind: "formula",
        displayLatex: "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
        raw: "P_0 = D_1 / (1 + R) + P_1 / (1 + R)",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_1", "SYM_2"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
      {
        id: "F2",
        slide: 15,
        kind: "formula",
        displayLatex: "P_0 = \\frac{D_1}{R - g}",
        raw: "P_0 = D_1 / (R - g)",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_1", "SYM_2", "SYM_3"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
      {
        id: "F3",
        slide: 25,
        kind: "formula",
        displayLatex: "P_p = \\frac{D}{R}",
        raw: "P_p = D / R",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_4"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
    ];

    const mockSections: NoteSection[] = [
      {
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. NGUYÊN LÝ ĐỊNH GIÁ",
        titleEn: "Valuation Principles",
        sourceSlides: [5],
        formulas: [
          {
            name: "F1",
            latex: "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
            formulaRefs: ["F1"],
            variables: [],
          },
        ],
        overview: "",
        bulletPoints: ["Nguyên lý dòng tiền"],
        subSections: [],
      },
      {
        id: "sec-b-2",
        letter: "B",
        titleVi: "B. MÔ HÌNH GORDON",
        titleEn: "Gordon Model",
        sourceSlides: [15],
        formulas: [
          {
            name: "F2",
            latex: "P_0 = \\frac{D_1}{R - g}",
            formulaRefs: ["F2"],
            variables: [],
          },
        ],
        overview: "",
        bulletPoints: ["Mô hình tăng trưởng đều"],
        subSections: [],
      },
      {
        id: "sec-c-3",
        letter: "C",
        titleVi: "C. CỔ PHIẾU ƯU ĐÃI",
        titleEn: "Preferred Stock",
        sourceSlides: [25],
        formulas: [
          {
            name: "F3",
            latex: "P_p = \\frac{D}{R}",
            formulaRefs: ["F3"],
            variables: [],
          },
        ],
        overview: "",
        bulletPoints: ["Định giá cổ phiếu ưu đãi"],
        subSections: [],
      },
    ];

    const { sections, firstUseSymbolMap } = applyFirstUseSymbolBindingsToSections(
      mockSections,
      acceptedFormulas,
      symbolBindings,
    );

    // Formula F1 in Section A defines P_0 (SYM_1) and D_1 (SYM_2)
    const f1Vars = sections[0].formulas[0].variables;
    expect(f1Vars).toHaveLength(2);
    expect(f1Vars.map((v) => v.symbol)).toEqual(["P_0", "D_1"]);

    // Formula F2 in Section B references SYM_1, SYM_2, and SYM_3 (g)
    // F2.variables must contain ONLY g (SYM_3) with zero duplicates of P_0 or D_1
    const f2Vars = sections[1].formulas[0].variables;
    expect(f2Vars).toHaveLength(1);
    expect(f2Vars[0].symbol).toBe("g");
    expect(f2Vars[0].definition).toBe("Tốc độ tăng trưởng cổ tức dài hạn");

    // Formula F3 in Section C introduces SYM_4 (same glyph R in a new scopeId: "sec-c" with distinct meaning)
    // F3.variables must include the new scoped definition
    const f3Vars = sections[2].formulas[0].variables;
    expect(f3Vars).toHaveLength(1);
    expect(f3Vars[0].symbol).toBe("R");
    expect(f3Vars[0].definition).toBe("Tỷ suất sinh lời đòi hỏi của cổ phiếu ưu đãi");

    // Check firstUseSymbolMap records
    expect(firstUseSymbolMap["SYM_1"]).toEqual({ sectionLetter: "A", formulaId: "F1" });
    expect(firstUseSymbolMap["SYM_2"]).toEqual({ sectionLetter: "A", formulaId: "F1" });
    expect(firstUseSymbolMap["SYM_3"]).toEqual({ sectionLetter: "B", formulaId: "F2" });
    expect(firstUseSymbolMap["SYM_4"]).toEqual({ sectionLetter: "C", formulaId: "F3" });
  });

  it("compiles recipe, case, and caution blocks into valid ClutchNote and PublishedHandout", () => {
    const acceptedFormulas: AcceptedFormula[] = [
      {
        id: "F1",
        slide: 12,
        kind: "formula",
        displayLatex: "P_0 = \\frac{D_1}{R - g}",
        raw: "P_0 = D_1 / (R - g)",
        label: "Gordon Model",
        origin: "text",
        evidenceIds: [],
        symbolBindingIds: ["SYM_1"],
        conditionAtomIds: [],
        sourceVariantIds: [],
        revision: 1,
      },
    ];

    const symbolBindings: SymbolBinding[] = [
      {
        id: "SYM_1",
        scopeId: "global",
        symbolLatex: "P_0",
        meaning: "Giá cổ phiếu",
        slide: 12,
        evidenceIds: [],
      },
    ];

    const atoms: SourceAtom[] = [
      {
        id: "S12:A1",
        slide: 12,
        kind: "concept",
        topic: "Stock Valuation",
        content: "Giá trị cổ phiếu dựa trên dòng cổ tức tương lai.",
        evidence: "Stock value depends on future dividends.",
      },
    ];

    const blueprint: DocumentBlueprint = {
      title: "STOCK VALUATION",
      subject: "Finance",
      primaryLanguage: "bilingual",
      executiveSummary: "Tóm tắt định giá cổ phiếu.",
      sections: [
        {
          id: "sec-a-1",
          letter: "A",
          titleVi: "A. MÔ HÌNH ĐỊNH GIÁ",
          sourceSlides: [12],
          requiredFormulaIds: ["F1"],
          requiredAtomIds: ["S12:A1"],
          symbolScopeId: "sec-a",
          targetBlockBudget: 6,
        },
      ],
      glossary: [],
    };

    const sectionDrafts: SectionDraft[] = [
      {
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. MÔ HÌNH ĐỊNH GIÁ",
        sourceSlides: [12],
        blocks: [
          {
            id: "b1",
            kind: "intuition",
            heading: "Bản chất định giá",
            text: "Giá trị cổ phiếu là hiện giá của toàn bộ dòng cổ tức kỳ vọng trong tương lai.",
            slideCitations: [12],
            supportAtomIds: ["S12:A1"],
            supportMode: "faithful_paraphrase",
            formulaRefs: [],
            symbolBindingIds: [],
          },
          {
            id: "b2",
            kind: "recipe",
            heading: "Quy trình tính toán 3 bước",
            text: "Các bước giải bài toán mô hình Gordon:",
            steps: [
              "Bước 1: Xác định cổ tức năm tới D_1 = D_0 * (1 + g)",
              "Bước 2: Kiểm tra điều kiện biên g < R",
              "Bước 3: Áp dụng công thức P_0 = D_1 / (R - g)",
            ],
            slideCitations: [12],
            supportAtomIds: ["S12:A1"],
            supportMode: "example_abstraction",
            formulaRefs: ["F1"],
            symbolBindingIds: ["SYM_1"],
          },
          {
            id: "b3",
            kind: "caution",
            heading: "Cạm bẫy thi cử",
            text: "Lưu ý không dùng D_0 ở tử số thay cho D_1, và luôn đảm bảo g < R.",
            steps: ["Bẫy D_0 vs D_1", "Điều kiện g < R"],
            slideCitations: [12],
            supportAtomIds: [],
            supportMode: "faithful_paraphrase",
            formulaRefs: [],
            symbolBindingIds: [],
          },
          {
            id: "b4",
            kind: "takeaway",
            heading: "Điểm chốt",
            text: "Khi g tăng thì P_0 tăng; mô hình vô nghiệm khi g >= R.",
            slideCitations: [12],
            supportAtomIds: [],
            supportMode: "faithful_paraphrase",
            formulaRefs: [],
            symbolBindingIds: [],
          },
        ],
      },
    ];

    const conventions: FinancialConventionPin[] = [
      {
        category: "compounding",
        label: "Annual Compounding",
        slide: 12,
        rawMatch: "annual compounding",
      },
    ];

    const excludedCandidates: FormulaCandidate[] = [
      {
        id: "F_DUP",
        slide: 12,
        raw: "P = D / R",
        proposedLatex: "P = \\frac{D}{R}",
        origin: "text",
        kind: "general_formula",
        state: "EXCLUDED_WITH_REASON",
        exclusionReason: "Trùng lặp với công thức F1",
        warnings: [],
      },
    ];

    const result = compileNoteDocument({
      fileName: "Stock_Valuation.pptx",
      blueprint,
      sectionDrafts,
      acceptedFormulas,
      atoms,
      symbolBindings,
      financialConventions: conventions,
      excludedCandidates,
      totalSlideCount: 30,
    });

    // Verify formula displayLatex verbatim
    const compiledFormula = result.clutchNote.sections[0].subSections?.[0]?.formulas?.[0];
    expect(compiledFormula?.latex).toBe("P_0 = \\frac{D_1}{R - g}");

    // Verify clutchNote passes schema
    const parsedClutch = clutchNoteSchema.safeParse(result.clutchNote);
    expect(parsedClutch.success).toBe(true);
    expect(result.clutchNote.formulaLedger).toBeDefined();
    expect(result.clutchNote.formulaLedger?.length).toBe(1);
    expect(result.clutchNote.omitted?.length).toBe(1);

    // Verify publishedHandout passes schema and has zero formulaLedger or omitted fields
    const parsedHandout = publishedHandoutSchema.safeParse(result.publishedHandout);
    expect(parsedHandout.success).toBe(true);
    expect((result.publishedHandout as any).formulaLedger).toBeUndefined();
    expect((result.publishedHandout as any).omitted).toBeUndefined();

    // Verify placed formulas tracking
    expect(result.placedFormulaIds).toContain("F1");
    expect(result.missingRequiredFormulaIds).toHaveLength(0);

    // Verify rawMarkdown generation
    expect(result.clutchNote.rawMarkdown).toContain("# STOCK VALUATION");
    expect(result.clutchNote.rawMarkdown).toContain("## A. MÔ HÌNH ĐỊNH GIÁ");
  });
});
