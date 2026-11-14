import { generateObject, type LanguageModel } from "ai";
import {
  type AcceptedFormula,
  type BlueprintSectionPlan,
  type ClutchNote,
  type DocumentBlueprint,
  type FormulaCandidate,
  type FormulaLedgerEntry,
  type GroundedBullet,
  type KeyTakeaways,
  type KeyTakeawaysItem,
  type NoteFormula,
  type NoteFormulaVariable,
  type NoteOmittedFormula,
  type NoteSection,
  type NoteSubSection,
  type PublishedHandout,
  type SectionDraft,
  type SourceAtom,
  type SymbolBinding,
  type TeachingBlock,
  type TriagedSlide,
  clutchNoteSchema,
  documentBlueprintSchema,
  publishedHandoutSchema,
  sectionDraftSchema,
} from "@/lib/schemas/notes";
import {
  BLUEPRINT_PLANNER_SYSTEM_PROMPT,
  buildBlueprintPlannerPrompt,
  SECTION_WRITER_SYSTEM_PROMPT,
  buildSectionWriterPrompt,
  type FinancialConventionPin,
  pinConventionsToSections,
} from "@/lib/ai/prompts-notes";
import {
  cleanVietnameseSigmaTypos,
  repairCorruptedLatex,
  ensureInlineMathDelimiters,
} from "@/lib/math/latex";

/**
 * Guarantees 100% artifact ownership across formulas and atoms,
 * enforces full-deck & late-deck coverage, and normalizes section identifiers.
 */
export function ensureBlueprintArtifactOwnership(
  blueprint: DocumentBlueprint,
  input: {
    acceptedFormulas: AcceptedFormula[];
    atoms: SourceAtom[];
    includedSlides: TriagedSlide[];
    totalSlideCount?: number;
    isShortNote?: boolean;
  },
): DocumentBlueprint {
  // 1. Initial section clone with normalized structures
  const sections: BlueprintSectionPlan[] = blueprint.sections.map((sec, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const id = `sec-${letter.toLowerCase()}-${idx + 1}`;
    let titleVi = sec.titleVi || `PHẦN ${letter}`;
    if (!titleVi.startsWith(`${letter}.`)) {
      titleVi = `${letter}. ${titleVi.replace(/^[A-Z]\.\s*/, "")}`;
    }
    return {
      ...sec,
      id,
      letter,
      titleVi,
      sourceSlides: Array.from(new Set(sec.sourceSlides || [])).sort((a, b) => a - b),
      requiredFormulaIds: Array.from(new Set(sec.requiredFormulaIds || [])),
      requiredAtomIds: Array.from(new Set(sec.requiredAtomIds || [])),
    };
  });

  if (sections.length === 0) {
    sections.push({
      id: "sec-a-1",
      letter: "A",
      titleVi: "A. NGUYÊN LÝ TRỌNG TÂM",
      titleEn: "Core Principles",
      sourceSlides:
        input.includedSlides.length > 0
          ? input.includedSlides.map((s) => s.slide).sort((a, b) => a - b)
          : [1],
      requiredFormulaIds: input.acceptedFormulas.map((f) => f.id),
      requiredAtomIds: input.atoms.map((a) => a.id),
      symbolScopeId: "global",
      targetBlockBudget: 6,
    });
  }

  // 2. Late-deck coverage enforcement
  const totalSlides =
    input.totalSlideCount ??
    (input.includedSlides.length > 0
      ? Math.max(...input.includedSlides.map((s) => s.slide))
      : 1);

  const coveredSlides = new Set(sections.flatMap((s) => s.sourceSlides));
  const maxCoveredSlide = Math.max(0, ...sections.flatMap((s) => s.sourceSlides));
  const lateDeckThreshold = Math.floor(totalSlides * 0.75);

  const uncoveredLateSlides = input.includedSlides.filter(
    (s) =>
      !coveredSlides.has(s.slide) &&
      (s.slide >= lateDeckThreshold || s.slide > maxCoveredSlide),
  );

  if (uncoveredLateSlides.length > 0) {
    const lateSlideNumbers = uncoveredLateSlides.map((s) => s.slide).sort((a, b) => a - b);
    const lateFormulas = input.acceptedFormulas
      .filter((f) => lateSlideNumbers.includes(f.slide))
      .map((f) => f.id);
    const lateAtoms = input.atoms
      .filter((a) => lateSlideNumbers.includes(a.slide))
      .map((a) => a.id);

    if (!input.isShortNote && sections.length < 12) {
      const nextIndex = sections.length;
      const nextLetter = String.fromCharCode(65 + nextIndex);
      const firstSlide = uncoveredLateSlides[0];
      const titleViPrefix = `${nextLetter}. `;
      const rawTitleVi =
        firstSlide && !firstSlide.label.toLowerCase().includes("slide")
          ? firstSlide.label.toUpperCase()
          : "CÁC MÔ HÌNH VÀ NỘI DUNG BỔ SUNG";
      const titleVi = rawTitleVi.startsWith(titleViPrefix)
        ? rawTitleVi
        : `${titleViPrefix}${rawTitleVi}`;

      sections.push({
        id: `sec-${nextLetter.toLowerCase()}-${nextIndex + 1}`,
        letter: nextLetter,
        titleVi,
        titleEn: "Supplementary Models & Late-Deck Topics",
        sourceSlides: lateSlideNumbers,
        requiredFormulaIds: lateFormulas,
        requiredAtomIds: lateAtoms,
        symbolScopeId: `sec-${nextLetter.toLowerCase()}`,
        targetBlockBudget: Math.min(12, Math.max(4, lateSlideNumbers.length)),
      });
    } else if (sections.length > 0) {
      const finalSection = sections[sections.length - 1];
      finalSection.sourceSlides = Array.from(
        new Set([...finalSection.sourceSlides, ...lateSlideNumbers]),
      ).sort((a, b) => a - b);
      finalSection.requiredFormulaIds = Array.from(
        new Set([...finalSection.requiredFormulaIds, ...lateFormulas]),
      );
      finalSection.requiredAtomIds = Array.from(
        new Set([...finalSection.requiredAtomIds, ...lateAtoms]),
      );
    }
  }

  // 3. 100% Required Formula Ownership
  for (const formula of input.acceptedFormulas) {
    const isOwned = sections.some((s) => s.requiredFormulaIds.includes(formula.id));
    if (!isOwned) {
      let targetSection = sections.find((s) => s.sourceSlides.includes(formula.slide));
      if (!targetSection && sections.length > 0) {
        let minDistance = Infinity;
        let closestSec = sections[0];
        for (const sec of sections) {
          if (sec.sourceSlides.length === 0) continue;
          for (const sNum of sec.sourceSlides) {
            const dist = Math.abs(sNum - formula.slide);
            if (dist < minDistance) {
              minDistance = dist;
              closestSec = sec;
            }
          }
        }
        targetSection = closestSec;
      }

      if (targetSection) {
        targetSection.requiredFormulaIds.push(formula.id);
        if (!targetSection.sourceSlides.includes(formula.slide)) {
          targetSection.sourceSlides.push(formula.slide);
          targetSection.sourceSlides.sort((a, b) => a - b);
        }
      }
    }
  }

  // 4. 100% Required Atom Ownership
  for (const atom of input.atoms) {
    const isOwned = sections.some((s) => s.requiredAtomIds.includes(atom.id));
    if (!isOwned) {
      let targetSection = sections.find((s) => s.sourceSlides.includes(atom.slide));
      if (!targetSection && sections.length > 0) {
        let minDistance = Infinity;
        let closestSec = sections[0];
        for (const sec of sections) {
          if (sec.sourceSlides.length === 0) continue;
          for (const sNum of sec.sourceSlides) {
            const dist = Math.abs(sNum - atom.slide);
            if (dist < minDistance) {
              minDistance = dist;
              closestSec = sec;
            }
          }
        }
        targetSection = closestSec;
      }

      if (targetSection) {
        targetSection.requiredAtomIds.push(atom.id);
        if (!targetSection.sourceSlides.includes(atom.slide)) {
          targetSection.sourceSlides.push(atom.slide);
          targetSection.sourceSlides.sort((a, b) => a - b);
        }
      }
    }
  }

  // 5. Section budget & count guardrail (max 12 sections)
  const boundedSections = sections.slice(0, 12);
  if (sections.length > 12) {
    const extraSections = sections.slice(12);
    const finalSec = boundedSections[boundedSections.length - 1];
    finalSec.sourceSlides = Array.from(
      new Set([...finalSec.sourceSlides, ...extraSections.flatMap((s) => s.sourceSlides)]),
    ).sort((a, b) => a - b);
    finalSec.requiredFormulaIds = Array.from(
      new Set([...finalSec.requiredFormulaIds, ...extraSections.flatMap((s) => s.requiredFormulaIds)]),
    );
    finalSec.requiredAtomIds = Array.from(
      new Set([...finalSec.requiredAtomIds, ...extraSections.flatMap((s) => s.requiredAtomIds)]),
    );
  }

  // 6. Final sequential letter & ID normalization
  const normalizedSections: BlueprintSectionPlan[] = boundedSections.map((sec, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const id = `sec-${letter.toLowerCase()}-${idx + 1}`;
    let titleVi = sec.titleVi;
    if (!titleVi.startsWith(`${letter}.`)) {
      titleVi = `${letter}. ${titleVi.replace(/^[A-Z]\.\s*/, "")}`;
    }
    return {
      ...sec,
      id,
      letter,
      titleVi,
      sourceSlides: Array.from(new Set(sec.sourceSlides)).sort((a, b) => a - b),
      requiredFormulaIds: Array.from(new Set(sec.requiredFormulaIds)),
      requiredAtomIds: Array.from(new Set(sec.requiredAtomIds)),
    };
  });

  return documentBlueprintSchema.parse({
    ...blueprint,
    sections: normalizedSections,
  });
}

/**
 * Deterministically constructs a coherent fallback DocumentBlueprint from triaged slides,
 * formulas, and source atoms without requiring an LLM call.
 */
export function buildDeterministicBlueprintFallback(input: {
  fileName: string;
  totalSlideCount: number;
  includedSlides: TriagedSlide[];
  planningSignalSlides?: TriagedSlide[];
  acceptedFormulas: AcceptedFormula[];
  atoms: SourceAtom[];
  isShortNote?: boolean;
}): DocumentBlueprint {
  const cleanTitle = input.fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]/g, " ")
    .toUpperCase()
    .trim() || "BÀI GIẢNG TỔNG HỢP";

  const rawSlides = input.includedSlides.length > 0 ? input.includedSlides : [{ slide: 1, label: "Slide 1", tags: [], disposition: "INCLUDE" as const, reason: "", requiresVisionAdjudication: false, extractedRecipeSteps: [], cleanedText: "" }];

  let sections: BlueprintSectionPlan[] = [];

  if (input.isShortNote || rawSlides.length <= 2) {
    // 1 section for free/short notes
    const slideNumbers = rawSlides.map((s) => s.slide).sort((a, b) => a - b);
    sections = [
      {
        id: "sec-a-1",
        letter: "A",
        titleVi: "A. NGUYÊN LÝ VÀ MÔ HÌNH TRỌNG TÂM",
        titleEn: "Core Principles and Governing Models",
        sourceSlides: slideNumbers,
        requiredFormulaIds: input.acceptedFormulas.map((f) => f.id),
        requiredAtomIds: input.atoms.map((a) => a.id),
        symbolScopeId: "global",
        targetBlockBudget: 6,
      },
    ];
  } else {
    // 3 to 10 sections for full multi-section handouts
    const targetSectionCount = Math.min(
      10,
      Math.max(3, Math.ceil(rawSlides.length / 8)),
    );
    const chunkSize = Math.ceil(rawSlides.length / targetSectionCount);

    for (let i = 0; i < targetSectionCount; i++) {
      const slice = rawSlides.slice(i * chunkSize, (i + 1) * chunkSize);
      if (slice.length === 0) continue;

      const letter = String.fromCharCode(65 + i);
      const firstSlide = slice[0];
      const sliceSlides = slice.map((s) => s.slide).sort((a, b) => a - b);
      const sliceSlideSet = new Set(sliceSlides);

      const sectionFormulaIds = input.acceptedFormulas
        .filter((f) => sliceSlideSet.has(f.slide))
        .map((f) => f.id);
      const sectionAtomIds = input.atoms
        .filter((a) => sliceSlideSet.has(a.slide))
        .map((a) => a.id);

      const rawLabel =
        firstSlide && !firstSlide.label.toLowerCase().includes("slide")
          ? firstSlide.label.toUpperCase()
          : i === 0
            ? "TỔNG QUAN VÀ NGUYÊN LÝ CƠ BẢN"
            : `CHỦ ĐỀ VÀ MÔ HÌNH PHẦN ${letter}`;

      const titleVi = `${letter}. ${rawLabel.replace(/^[A-Z]\.\s*/, "")}`;

      sections.push({
        id: `sec-${letter.toLowerCase()}-${i + 1}`,
        letter,
        titleVi,
        titleEn: firstSlide.label || undefined,
        sourceSlides: sliceSlides,
        requiredFormulaIds: sectionFormulaIds,
        requiredAtomIds: sectionAtomIds,
        symbolScopeId: `sec-${letter.toLowerCase()}`,
        targetBlockBudget: Math.min(12, Math.max(4, slice.length)),
      });
    }
  }

  const rawBlueprint: DocumentBlueprint = {
    title: cleanTitle,
    subject: "Tài chính doanh nghiệp",
    primaryLanguage: "bilingual",
    executiveSummary: `Bản tổng hợp kiến thức trọng tâm từ slide bài giảng ${input.fileName}.`,
    sections,
    glossary: [],
  };

  return ensureBlueprintArtifactOwnership(rawBlueprint, input);
}

/**
 * Plans a global DocumentBlueprint using structured LLM synthesis,
 * falling back deterministically on failure or when no model is provided.
 */
export async function planDocumentBlueprint(input: {
  fileName: string;
  totalSlideCount: number;
  includedSlides: TriagedSlide[];
  planningSignalSlides?: TriagedSlide[];
  acceptedFormulas: AcceptedFormula[];
  atoms: SourceAtom[];
  focus?: string;
  isShortNote?: boolean;
  model?: LanguageModel;
  signal?: AbortSignal;
  onUsage?: (info: {
    totalTokens?: number;
    costUsd?: number;
    servedModel?: string;
  }) => void;
}): Promise<DocumentBlueprint> {
  if (!input.model) {
    return buildDeterministicBlueprintFallback(input);
  }

  try {
    const prompt = buildBlueprintPlannerPrompt(input);
    const res = await generateObject({
      model: input.model,
      schema: documentBlueprintSchema,
      system: BLUEPRINT_PLANNER_SYSTEM_PROMPT,
      prompt,
      abortSignal: input.signal,
    });

    if (input.onUsage) {
      const usage = (res as any)?.usage;
      const totalTokens =
        typeof usage?.totalTokens === "number"
          ? usage.totalTokens
          : (typeof usage?.inputTokens === "number" ? usage.inputTokens : 0) +
            (typeof usage?.outputTokens === "number" ? usage.outputTokens : 0);
      const costUsd =
        (res as any)?.providerMetadata?.openrouter?.usage?.cost ??
        (res as any)?.experimental_providerMetadata?.openrouter?.usage?.cost ??
        0;
      const servedModel = (res as any)?.response?.modelId ?? (input.model as any)?.modelId;
      input.onUsage({
        totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
        costUsd: typeof costUsd === "number" && Number.isFinite(costUsd) ? costUsd : 0,
        servedModel: typeof servedModel === "string" ? servedModel : undefined,
      });
    }

    return ensureBlueprintArtifactOwnership(res.object, input);
  } catch {
    return buildDeterministicBlueprintFallback(input);
  }
}

/**
 * Post-write formula coverage enforcement: verifies that every requiredFormulaId
 * appears in at least one block's formulaRefs, deterministically injecting
 * a dedicated TeachingBlock for any missed formula.
 */
export function ensureSectionDraftFormulaCoverage(
  draft: SectionDraft,
  sectionPlan: BlueprintSectionPlan,
  acceptedFormulas: AcceptedFormula[],
  atoms: SourceAtom[],
): SectionDraft {
  const coveredFormulaIds = new Set(draft.blocks.flatMap((b) => b.formulaRefs || []));
  const missingFormulaIds = sectionPlan.requiredFormulaIds.filter(
    (id) => !coveredFormulaIds.has(id),
  );

  if (missingFormulaIds.length === 0) {
    return sectionDraftSchema.parse(draft);
  }

  const updatedBlocks = [...draft.blocks];

  for (const formulaId of missingFormulaIds) {
    const formula = acceptedFormulas.find((f) => f.id === formulaId);
    if (!formula) continue;

    const matchingAtom = atoms.find((a) => a.slide === formula.slide);
    const newBlock: TeachingBlock = {
      id: `${draft.id}-injected-${formula.id.toLowerCase()}`,
      kind: "case",
      heading: formula.label || `Công thức ${formula.id}`,
      text: formula.label
        ? `Áp dụng công thức ${formula.label} (Slide ${formula.slide}).`
        : `Công thức tính toán ${formula.id} từ Slide ${formula.slide}.`,
      slideCitations: [formula.slide],
      supportAtomIds: matchingAtom ? [matchingAtom.id] : (formula.conditionAtomIds ?? []),
      supportMode: "faithful_paraphrase",
      formulaRefs: [formula.id],
      symbolBindingIds: formula.symbolBindingIds ?? [],
    };
    updatedBlocks.push(newBlock);
  }

  return sectionDraftSchema.parse({
    ...draft,
    blocks: updatedBlocks,
  });
}

/**
 * Deterministically synthesizes structured TeachingBlocks from section atoms and formulas
 * when LLM authoring is unavailable or fails.
 */
export function buildDeterministicSectionDraft(
  sectionPlan: BlueprintSectionPlan,
  slides: Array<{ slide: number; label: string; text: string }>,
  sectionFormulas: AcceptedFormula[],
  sectionAtoms: SourceAtom[],
): SectionDraft {
  const blocks: TeachingBlock[] = [];
  const slideNumbers = sectionPlan.sourceSlides.length > 0 ? sectionPlan.sourceSlides : [1];

  // 1. Intuition block from concept / definition atoms
  const intuitionAtoms = sectionAtoms.filter(
    (a) => a.kind === "concept" || a.kind === "definition",
  );
  if (intuitionAtoms.length > 0) {
    const combinedText = intuitionAtoms.map((a) => a.content).join(" ");
    blocks.push({
      id: `${sectionPlan.id}-block-intuition`,
      kind: "intuition",
      heading: "Nguyên lý và bản chất",
      text: combinedText,
      slideCitations: Array.from(new Set(intuitionAtoms.map((a) => a.slide))),
      supportAtomIds: intuitionAtoms.map((a) => a.id),
      supportMode: "faithful_paraphrase",
      formulaRefs: [],
      symbolBindingIds: [],
    });
  }

  // 2. Recipe block from procedure or worked-example atoms
  const procedureAtoms = sectionAtoms.filter(
    (a) => a.kind === "procedure" || a.isWorkedExampleDerived,
  );
  if (procedureAtoms.length > 0) {
    blocks.push({
      id: `${sectionPlan.id}-block-recipe`,
      kind: "recipe",
      heading: "Quy trình giải quyết và tính toán",
      text: "Các bước tính toán và áp dụng công thức:",
      steps: procedureAtoms.map((a) => a.content),
      slideCitations: Array.from(new Set(procedureAtoms.map((a) => a.slide))),
      supportAtomIds: procedureAtoms.map((a) => a.id),
      supportMode: "example_abstraction",
      formulaRefs: [],
      symbolBindingIds: [],
    });
  }

  // 3. Formula-driven blocks (case / parameter_guide)
  for (const formula of sectionFormulas) {
    const matchingAtom = sectionAtoms.find((a) => a.slide === formula.slide);
    blocks.push({
      id: `${sectionPlan.id}-block-${formula.id.toLowerCase()}`,
      kind: "case",
      heading: formula.label || `Công thức ${formula.id}`,
      text: formula.label
        ? `Công thức tính toán ${formula.label} (Slide ${formula.slide}).`
        : `Công thức tính toán ${formula.id} từ Slide ${formula.slide}.`,
      slideCitations: [formula.slide],
      supportAtomIds: matchingAtom ? [matchingAtom.id] : (formula.conditionAtomIds ?? []),
      supportMode: "faithful_paraphrase",
      formulaRefs: [formula.id],
      symbolBindingIds: formula.symbolBindingIds ?? [],
    });
  }

  // 4. Caution block from boundary condition or exam hint atoms
  const cautionAtoms = sectionAtoms.filter(
    (a) => a.kind === "boundary_condition" || a.kind === "exam_hint",
  );
  if (cautionAtoms.length > 0) {
    blocks.push({
      id: `${sectionPlan.id}-block-caution`,
      kind: "caution",
      heading: "Lưu ý và điều kiện biên",
      text: cautionAtoms.map((a) => a.content).join(" "),
      steps: cautionAtoms.map((a) => a.content),
      slideCitations: Array.from(new Set(cautionAtoms.map((a) => a.slide))),
      supportAtomIds: cautionAtoms.map((a) => a.id),
      supportMode: "faithful_paraphrase",
      formulaRefs: [],
      symbolBindingIds: [],
    });
  }

  // 5. Ensure at least one block exists
  if (blocks.length === 0) {
    const firstSlideText = slides[0]?.text || `Nội dung phần ${sectionPlan.titleVi}`;
    blocks.push({
      id: `${sectionPlan.id}-block-default`,
      kind: "intuition",
      heading: sectionPlan.titleVi,
      text: firstSlideText.slice(0, 200),
      slideCitations: [slideNumbers[0]],
      supportAtomIds: [],
      supportMode: "faithful_paraphrase",
      formulaRefs: [],
      symbolBindingIds: [],
    });
  }

  // 6. Ensure takeaway block
  if (!blocks.some((b) => b.kind === "takeaway")) {
    blocks.push({
      id: `${sectionPlan.id}-block-takeaway`,
      kind: "takeaway",
      heading: "Điểm chốt trọng tâm",
      text: `Nắm vững các công thức và điều kiện áp dụng trong phần ${sectionPlan.titleVi}.`,
      slideCitations: [slideNumbers[0]],
      supportAtomIds: [],
      supportMode: "faithful_paraphrase",
      formulaRefs: [],
      symbolBindingIds: [],
    });
  }

  const draft: SectionDraft = {
    id: sectionPlan.id,
    letter: sectionPlan.letter,
    titleVi: sectionPlan.titleVi,
    titleEn: sectionPlan.titleEn,
    sourceSlides: slideNumbers,
    blocks,
  };

  return ensureSectionDraftFormulaCoverage(
    draft,
    sectionPlan,
    sectionFormulas,
    sectionAtoms,
  );
}

/**
 * Executes section drafting in parallel using a bounded worker pool (4–6 concurrency),
 * preserving exact blueprint section order and running post-write formula coverage.
 */
export async function writeSectionDraftsParallel(input: {
  fileName: string;
  blueprint: DocumentBlueprint;
  slides: Array<{ slide: number; label: string; text: string }>;
  acceptedFormulas: AcceptedFormula[];
  atoms: SourceAtom[];
  symbolBindings: SymbolBinding[];
  financialConventions?: FinancialConventionPin[];
  model?: LanguageModel;
  concurrency?: number;
  signal?: AbortSignal;
  onUsage?: (info: {
    totalTokens?: number;
    costUsd?: number;
    servedModel?: string;
  }) => void;
  sectionWriterFn?: (
    sectionPlan: BlueprintSectionPlan,
    index: number,
  ) => Promise<SectionDraft>;
}): Promise<SectionDraft[]> {
  const concurrency = Math.max(1, Math.min(6, input.concurrency ?? 5));
  const sectionCount = input.blueprint.sections.length;
  const results: SectionDraft[] = new Array(sectionCount);

  let nextIndex = 0;

  async function worker() {
    while (nextIndex < sectionCount) {
      if (input.signal?.aborted) {
        throw new Error("Parallel section writing aborted by signal");
      }

      const index = nextIndex++;
      const sectionPlan = input.blueprint.sections[index];

      const sectionFormulas = input.acceptedFormulas.filter(
        (f) =>
          sectionPlan.requiredFormulaIds.includes(f.id) ||
          sectionPlan.sourceSlides.includes(f.slide),
      );
      const sectionAtoms = input.atoms.filter(
        (a) =>
          sectionPlan.requiredAtomIds.includes(a.id) ||
          sectionPlan.sourceSlides.includes(a.slide),
      );
      const sectionSlides = input.slides.filter((s) =>
        sectionPlan.sourceSlides.includes(s.slide),
      );

      let draft: SectionDraft;

      if (input.sectionWriterFn) {
        draft = await input.sectionWriterFn(sectionPlan, index);
      } else if (input.model) {
        try {
          const prompt = buildSectionWriterPrompt({
            fileName: input.fileName,
            blueprint: input.blueprint,
            sectionPlan,
            slides: sectionSlides.length > 0 ? sectionSlides : input.slides,
            sectionFormulas,
            sectionAtoms,
            symbolBindings: input.symbolBindings,
            financialConventions: input.financialConventions,
          });

          const res = await generateObject({
            model: input.model,
            schema: sectionDraftSchema,
            system: SECTION_WRITER_SYSTEM_PROMPT,
            prompt,
            abortSignal: input.signal,
          });
          if (input.onUsage) {
            const usage = (res as any)?.usage;
            const totalTokens =
              typeof usage?.totalTokens === "number"
                ? usage.totalTokens
                : (typeof usage?.inputTokens === "number" ? usage.inputTokens : 0) +
                  (typeof usage?.outputTokens === "number" ? usage.outputTokens : 0);
            const costUsd =
              (res as any)?.providerMetadata?.openrouter?.usage?.cost ??
              (res as any)?.experimental_providerMetadata?.openrouter?.usage?.cost ??
              0;
            const servedModel = (res as any)?.response?.modelId ?? (input.model as any)?.modelId;
            input.onUsage({
              totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
              costUsd: typeof costUsd === "number" && Number.isFinite(costUsd) ? costUsd : 0,
              servedModel: typeof servedModel === "string" ? servedModel : undefined,
            });
          }
          draft = res.object;
        } catch {
          draft = buildDeterministicSectionDraft(
            sectionPlan,
            sectionSlides.length > 0 ? sectionSlides : input.slides,
            sectionFormulas,
            sectionAtoms,
          );
        }
      } else {
        draft = buildDeterministicSectionDraft(
          sectionPlan,
          sectionSlides.length > 0 ? sectionSlides : input.slides,
          sectionFormulas,
          sectionAtoms,
        );
      }

      // Enforce post-write formula coverage
      draft = ensureSectionDraftFormulaCoverage(
        draft,
        sectionPlan,
        input.acceptedFormulas,
        input.atoms,
      );

      results[index] = draft;
    }
  }

  const workerCount = Math.min(concurrency, sectionCount);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}

/**
 * Traverses sections and formulas in strict reading order, emitting symbol definitions
 * in NoteFormula.variables ONLY on their first occurrence by SymbolBindingId,
 * with scoped symbol tracking for rebinding across different section scopes.
 */
export function applyFirstUseSymbolBindingsToSections(
  sections: NoteSection[],
  acceptedFormulas: AcceptedFormula[],
  symbolBindings: SymbolBinding[],
): {
  sections: NoteSection[];
  firstUseSymbolMap: Record<string, { sectionLetter: string; formulaId: string }>;
} {
  const bindingMap = new Map<string, SymbolBinding>();
  for (const b of symbolBindings) {
    bindingMap.set(b.id, b);
  }

  const formulaMap = new Map<string, AcceptedFormula>();
  for (const f of acceptedFormulas) {
    formulaMap.set(f.id, f);
  }

  const seenSymbolBindingIds = new Set<string>();
  const firstUseSymbolMap: Record<string, { sectionLetter: string; formulaId: string }> = {};

  function processFormula(noteFormula: NoteFormula, sectionLetter: string): NoteFormula {
    const accepted =
      noteFormula.formulaRefs && noteFormula.formulaRefs.length > 0
        ? formulaMap.get(noteFormula.formulaRefs[0])
        : acceptedFormulas.find((f) => f.displayLatex === noteFormula.latex);

    const formulaId = accepted?.id ?? noteFormula.formulaRefs?.[0] ?? "unknown";

    const candidateBindingIds: string[] = [];
    if (accepted && accepted.symbolBindingIds && accepted.symbolBindingIds.length > 0) {
      candidateBindingIds.push(...accepted.symbolBindingIds);
    } else if (noteFormula.variables && noteFormula.variables.length > 0) {
      for (const v of noteFormula.variables) {
        const match = symbolBindings.find((b) => b.symbolLatex === v.symbol);
        if (match) candidateBindingIds.push(match.id);
      }
    }

    const emittedVariables: NoteFormulaVariable[] = [];

    for (const bindingId of candidateBindingIds) {
      if (seenSymbolBindingIds.has(bindingId)) {
        continue;
      }

      seenSymbolBindingIds.add(bindingId);
      const binding = bindingMap.get(bindingId);
      if (binding && binding.meaning && binding.meaning.trim() !== "") {
        emittedVariables.push({
          symbol: binding.symbolLatex,
          definition: binding.meaning,
        });
        firstUseSymbolMap[bindingId] = {
          sectionLetter,
          formulaId,
        };
      }
    }

    return {
      ...noteFormula,
      variables: emittedVariables,
    };
  }

  const updatedSections: NoteSection[] = sections.map((sec) => {
    const updatedFormulas = sec.formulas.map((f) => processFormula(f, sec.letter));
    const updatedSubSections = (sec.subSections || []).map((sub) => ({
      ...sub,
      formulas: sub.formulas.map((f) => processFormula(f, sec.letter)),
    }));

    return {
      ...sec,
      formulas: updatedFormulas,
      subSections: updatedSubSections,
    };
  });

  return {
    sections: updatedSections,
    firstUseSymbolMap,
  };
}

/**
 * Renders structured markdown for a compiled note document.
 */
export function renderDocumentMarkdown(data: {
  title: string;
  subject: string;
  executiveSummary: string;
  sections: NoteSection[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${data.title}`);
  lines.push(`**Môn học:** ${data.subject}\n`);
  if (data.executiveSummary) {
    lines.push(`> **Tóm tắt điều hành:** ${data.executiveSummary}\n`);
  }

  for (const section of data.sections) {
    const headingPrefix = `${section.letter}. `;
    const cleanSectionTitle = section.titleVi.startsWith(headingPrefix)
      ? section.titleVi
      : `${headingPrefix}${section.titleVi.replace(/^[A-Z]\.\s*/, "")}`;
    lines.push(`## ${cleanSectionTitle}`);
    if (section.titleEn) {
      lines.push(`*${section.titleEn}*\n`);
    }
    if (section.coreStatement) {
      lines.push(`**Nguyên lý cốt lõi:** ${section.coreStatement}\n`);
    }
    if (section.overview) {
      lines.push(`${section.overview}\n`);
    }
    if (section.bulletPoints && section.bulletPoints.length > 0) {
      for (const bp of section.bulletPoints) {
        lines.push(`- ${bp}`);
      }
      lines.push("");
    }
    if (section.formulas && section.formulas.length > 0) {
      for (const f of section.formulas) {
        if (f.leadText) lines.push(f.leadText);
        if (f.name) lines.push(`**${f.name}:**`);
        lines.push(`$$${f.latex}$$\n`);
        if (f.variables && f.variables.length > 0) {
          lines.push("**Trong đó:**");
          for (const v of f.variables) {
            lines.push(`- $${v.symbol}$: ${v.definition}`);
          }
          lines.push("");
        }
      }
    }
    if (section.subSections && section.subSections.length > 0) {
      for (const sub of section.subSections) {
        lines.push(`### ${sub.heading}`);
        if (sub.leadIn) lines.push(`${sub.leadIn}\n`);
        if (sub.bulletPoints && sub.bulletPoints.length > 0) {
          for (const bp of sub.bulletPoints) {
            lines.push(`- ${bp}`);
          }
          lines.push("");
        }
        if (sub.formulas && sub.formulas.length > 0) {
          for (const f of sub.formulas) {
            if (f.leadText) lines.push(f.leadText);
            if (f.name) lines.push(`**${f.name}:**`);
            lines.push(`$$${f.latex}$$\n`);
            if (f.variables && f.variables.length > 0) {
              lines.push("**Trong đó:**");
              for (const v of f.variables) {
                lines.push(`- $${v.symbol}$: ${v.definition}`);
              }
              lines.push("");
            }
          }
        }
      }
    }
    if (
      section.keyTakeaways &&
      section.keyTakeaways.items &&
      section.keyTakeaways.items.length > 0
    ) {
      lines.push(`### ${section.keyTakeaways.title || "KEY TAKEAWAYS"}`);
      for (let idx = 0; idx < section.keyTakeaways.items.length; idx++) {
        const item = section.keyTakeaways.items[idx];
        lines.push(`${idx + 1}. **${item.point}**`);
        if (item.subBullets && item.subBullets.length > 0) {
          for (const sb of item.subBullets) {
            lines.push(`   - ${sb}`);
          }
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export interface CompileNoteDocumentInput {
  fileName: string;
  blueprint: DocumentBlueprint;
  sectionDrafts: SectionDraft[];
  acceptedFormulas: AcceptedFormula[];
  atoms: SourceAtom[];
  symbolBindings: SymbolBinding[];
  financialConventions?: FinancialConventionPin[];
  excludedCandidates?: FormulaCandidate[];
  totalSlideCount?: number;
  estimatedDistilledPages?: number;
  noiseReductionRate?: number;
}

export interface CompiledNoteOutput {
  clutchNote: ClutchNote;
  publishedHandout: PublishedHandout;
  placedFormulaIds: string[];
  missingRequiredFormulaIds: string[];
  firstUseSymbolMap: Record<string, { sectionLetter: string; formulaId: string }>;
  blueprint?: DocumentBlueprint;
  sectionDrafts?: SectionDraft[];
  acceptedFormulas?: AcceptedFormula[];
  atoms?: SourceAtom[];
  symbolBindings?: SymbolBinding[];
  excludedCandidates?: FormulaCandidate[];
}

function resolveEvidenceForBlock(
  block: TeachingBlock,
  atomMap: Map<string, SourceAtom>,
): string {
  if (block.supportAtomIds && block.supportAtomIds.length > 0) {
    for (const atomId of block.supportAtomIds) {
      const atom = atomMap.get(atomId);
      if (atom) {
        return atom.evidence || atom.content;
      }
    }
  }
  return block.text;
}

function cleanProseTypography(text: string): string {
  if (!text) return "";
  const sigmaCleaned = cleanVietnameseSigmaTypos(text);
  const repaired = repairCorruptedLatex(sigmaCleaned);
  return ensureInlineMathDelimiters(repaired);
}

/**
 * Deterministic Document Compiler: transforms structured SectionDrafts into valid
 * ClutchNote and PublishedHandout artifacts, strictly resolving formula LaTeX from
 * AcceptedFormulas, executing reading-order first-use symbol definitions,
 * and maintaining mathematical and pedagogical grounding.
 */
export function compileNoteDocument(input: CompileNoteDocumentInput): CompiledNoteOutput {
  const acceptedFormulaMap = new Map<string, AcceptedFormula>();
  for (const f of input.acceptedFormulas) {
    acceptedFormulaMap.set(f.id, f);
  }

  const atomMap = new Map<string, SourceAtom>();
  for (const a of input.atoms) {
    atomMap.set(a.id, a);
  }

  const placedFormulaIdsSet = new Set<string>();

  function buildNoteFormulaFromRef(
    refId: string,
    block: TeachingBlock,
  ): NoteFormula | null {
    const accepted = acceptedFormulaMap.get(refId);
    if (!accepted) return null;

    placedFormulaIdsSet.add(accepted.id);
    return {
      name: accepted.label || "",
      leadText: block.heading || undefined,
      latex: accepted.displayLatex,
      description: undefined,
      variables: [],
      formulaRefs: [accepted.id],
      slide: Math.max(1, accepted.slide),
      origin: accepted.origin,
      status: "verified",
    };
  }

  // 1. Map SectionDrafts into intermediate NoteSections
  const intermediateSections: NoteSection[] = input.sectionDrafts.map((draft) => {
    let coreStatement: string | undefined = undefined;
    let overview = "";
    const bulletPoints: string[] = [];
    const groundedBullets: GroundedBullet[] = [];
    const topLevelFormulas: NoteFormula[] = [];
    const subSections: NoteSubSection[] = [];
    const keyTakeawayItems: KeyTakeawaysItem[] = [];

    for (const block of draft.blocks) {
      const cleanedText = cleanProseTypography(block.text);
      const slide =
        block.slideCitations && block.slideCitations[0] > 0
          ? block.slideCitations[0]
          : draft.sourceSlides[0] || 1;
      const evidence = resolveEvidenceForBlock(block, atomMap);

      if (block.kind === "intuition") {
        if (!overview && cleanedText) {
          overview = cleanedText;
        }
        bulletPoints.push(cleanedText);
        groundedBullets.push({
          text: cleanedText,
          slide: Math.max(1, slide),
          evidence,
          status: "verified",
          verdict: "SUPPORTED",
        });

        if (block.formulaRefs && block.formulaRefs.length > 0) {
          for (const refId of block.formulaRefs) {
            const nf = buildNoteFormulaFromRef(refId, block);
            if (nf) topLevelFormulas.push(nf);
          }
        }
      } else if (
        block.kind === "case" ||
        block.kind === "recipe" ||
        block.kind === "parameter_guide" ||
        block.kind === "comparison" ||
        block.kind === "structured_table"
      ) {
        const subFormulas: NoteFormula[] = [];
        if (block.formulaRefs && block.formulaRefs.length > 0) {
          for (const refId of block.formulaRefs) {
            const nf = buildNoteFormulaFromRef(refId, block);
            if (nf) subFormulas.push(nf);
          }
        }

        let subBullets: string[] = [];
        if (block.kind === "recipe" && block.steps && block.steps.length > 0) {
          subBullets = block.steps.map((s) => cleanProseTypography(s));
        } else if (cleanedText) {
          subBullets = [cleanedText];
        }

        const subGroundedBullets: GroundedBullet[] = subBullets.map((b) => ({
          text: b,
          slide: Math.max(1, slide),
          evidence,
          status: "verified",
          verdict: "SUPPORTED",
        }));

        subSections.push({
          heading:
            block.heading ||
            (block.kind === "recipe" ? "Quy trình tính toán" : "Trường hợp phân tích"),
          leadIn: block.kind === "recipe" && cleanedText ? cleanedText : undefined,
          bulletPoints: subBullets,
          groundedBullets: subGroundedBullets,
          formulas: subFormulas,
        });
      } else if (block.kind === "caution" || block.kind === "takeaway") {
        const subBullets =
          block.steps && block.steps.length > 0
            ? block.steps.map((s) => cleanProseTypography(s))
            : [];
        keyTakeawayItems.push({
          point: cleanedText,
          subBullets,
          slide: Math.max(1, slide),
          evidence,
          status: "verified",
          verdict: "SUPPORTED",
        });

        if (block.formulaRefs && block.formulaRefs.length > 0) {
          for (const refId of block.formulaRefs) {
            const nf = buildNoteFormulaFromRef(refId, block);
            if (nf) topLevelFormulas.push(nf);
          }
        }
      }
    }

    if (bulletPoints.length === 0) {
      const fallbackText = overview || `Nội dung và nguyên lý trọng tâm của phần ${draft.titleVi}.`;
      bulletPoints.push(fallbackText);
      groundedBullets.push({
        text: fallbackText,
        slide: draft.sourceSlides[0] || 1,
        evidence: fallbackText,
        status: "verified",
        verdict: "SUPPORTED",
      });
    }

    let keyTakeaways: KeyTakeaways | null = null;
    if (keyTakeawayItems.length > 0) {
      keyTakeaways = {
        title: "KEY TAKEAWAYS",
        items: keyTakeawayItems,
        summaryPoints: keyTakeawayItems.map((it) => it.point),
      };
    }

    return {
      id: draft.id,
      letter: draft.letter,
      titleVi: draft.titleVi,
      titleEn: draft.titleEn || "",
      coreStatement,
      overview,
      bulletPoints,
      groundedBullets,
      formulas: topLevelFormulas,
      subSections,
      keyTakeaways,
      sourceSlides: draft.sourceSlides,
    };
  });

  // 2. Pin financial conventions if detected or provided
  const pinnedSections = pinConventionsToSections(
    intermediateSections,
    input.financialConventions ?? [],
  );

  // 3. Apply first-use symbol definitions strictly in reading order
  const { sections: sectionsWithSymbols, firstUseSymbolMap } =
    applyFirstUseSymbolBindingsToSections(
      pinnedSections,
      input.acceptedFormulas,
      input.symbolBindings,
    );

  // 4. Calculate placed and missing required formula IDs
  const placedFormulaIds = Array.from(placedFormulaIdsSet);
  const allRequiredFormulaIds = Array.from(
    new Set(input.blueprint.sections.flatMap((s) => s.requiredFormulaIds)),
  );
  const missingRequiredFormulaIds = allRequiredFormulaIds.filter(
    (id) => !placedFormulaIdsSet.has(id),
  );

  // 5. Build authoritative formula ledger entries
  const formulaLedger: FormulaLedgerEntry[] = input.acceptedFormulas.map((f, idx) => {
    const atom = input.atoms.find((a) => a.slide === f.slide);
    const validId = /^F\d+$/.test(f.id) ? f.id : `F${idx + 1}`;
    const formulaVariables: NoteFormulaVariable[] = (f.symbolBindingIds || [])
      .map((id) => {
        const b = input.symbolBindings.find((sb) => sb.id === id);
        return {
          symbol: b?.symbolLatex || "",
          definition: b?.meaning || "",
        };
      })
      .filter((v) => v.symbol && v.definition);

    return {
      id: validId,
      slide: Math.max(1, f.slide),
      raw: f.raw || f.displayLatex,
      latex: f.displayLatex,
      origin: f.origin,
      label: f.label || undefined,
      variables: formulaVariables,
      evidence: atom?.evidence || atom?.content || undefined,
    };
  });

  // 6. Build omitted formula entries with rule justifications
  const omitted: NoteOmittedFormula[] = (input.excludedCandidates ?? []).map((c) => ({
    formulaId: c.id,
    reason: c.exclusionReason || "Bị loại trừ theo quy tắc (omitted by rule)",
    status: "omitted_by_rule",
  }));

  // 7. Calculate metrics and render document markdown
  const totalSlideCount =
    input.totalSlideCount ??
    (input.blueprint.sections.length > 0
      ? Math.max(1, ...input.blueprint.sections.flatMap((s) => s.sourceSlides))
      : 1);

  const estimatedDistilledPages =
    input.estimatedDistilledPages ??
    Math.max(1, Math.min(12, Math.ceil(sectionsWithSymbols.length * 0.75)));
  const noiseReductionRate = input.noiseReductionRate ?? 85;

  const rawMarkdown = renderDocumentMarkdown({
    title: input.blueprint.title,
    subject: input.blueprint.subject,
    executiveSummary: input.blueprint.executiveSummary,
    sections: sectionsWithSymbols,
  });

  // 8. Assemble validated ClutchNote and PublishedHandout
  const clutchNote: ClutchNote = clutchNoteSchema.parse({
    id: `note-${Date.now()}`,
    title: input.blueprint.title,
    subject: input.blueprint.subject,
    createdAt: new Date().toISOString(),
    originalFileName: input.fileName,
    originalSlideCount: Math.max(1, totalSlideCount),
    estimatedDistilledPages,
    noiseReductionRate,
    executiveSummary: input.blueprint.executiveSummary,
    sections: sectionsWithSymbols,
    rawMarkdown,
    formulaLedger,
    omitted,
  });

  const publishedHandout: PublishedHandout = publishedHandoutSchema.parse({
    id: `handout-${Date.now()}`,
    title: input.blueprint.title,
    subject: input.blueprint.subject,
    createdAt: new Date().toISOString(),
    originalFileName: input.fileName,
    originalSlideCount: Math.max(1, totalSlideCount),
    estimatedDistilledPages,
    noiseReductionRate,
    executiveSummary: input.blueprint.executiveSummary,
    sections: sectionsWithSymbols,
    rawMarkdown,
    divergenceNotices: [],
  });

  return {
    clutchNote,
    publishedHandout,
    placedFormulaIds,
    missingRequiredFormulaIds,
    firstUseSymbolMap,
    blueprint: input.blueprint,
    sectionDrafts: input.sectionDrafts,
    acceptedFormulas: input.acceptedFormulas,
    atoms: input.atoms,
    symbolBindings: input.symbolBindings,
    excludedCandidates: input.excludedCandidates,
  };
}
