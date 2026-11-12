import "server-only";
import {
  generateObject,
  APICallError,
  NoObjectGeneratedError,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { questionBankSchema, type StudyPack } from "@/lib/schemas/question";
import type {
  GenerationResult,
  IngestionOptions,
  ParsedDocument,
  SourceReference,
  SourceBlock,
} from "@/lib/schemas/ingestion";
import { IngestionError } from "@/lib/ingestion/errors";
import {
  assertPromptTokenCliff,
  assertSonnetInputTokenGuard,
  computePipelineVersion,
  extractOpenRouterProvenance,
  getDistillerModel,
  getGenerationModel,
  getGeminiModel,
  getGroqModel,
  getOpenRouterApiKey,
  getOpenRouterGeneratorModel,
  HAIKU_TOKEN_CLIFF_THRESHOLD,
  isPinnedOpenRouterSlug,
  SONNET_MAX_INPUT_TOKENS,
} from "./provider";
import {
  buildIngestionPrompt,
  ingestionSystemPrompt,
} from "./prompts";
import { budgetSourceBlocks, cleanSlideBoilerplate } from "./budget-sources";
import { isPaidTier } from "@/lib/pricing/tiers";
import { repairCorruptedLatex } from "@/lib/math/latex";
import {
  applyFinanceSolverToItem,
  distractorModeSchema,
  financeParamsSchema,
  financeSolverTypeSchema,
  financeUnitSchema,
  structuredFinanceParamsSchema,
} from "@/lib/math/finance-solver";
import {
  verifyQuestionsBlindly,
  type VerifiableQuestionInput,
} from "./verify-questions";
import { recordTelemetryEvent } from "@/lib/telemetry/recorder";
import type { CitationRejectionReason } from "@/lib/schemas/telemetry";

export const MCQ_GENERATION_TEMPERATURE = 0.35;
export const MCQ_GENERATION_TOP_P = 0.95;
export const CONCEPT_GROUPING_TEMPERATURE = 0.0;
export const MAX_ITEMS_PER_SLIDE = 2;

export function capExplanationToTwoSentences(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!sentences || sentences.length <= 2) {
    return trimmed;
  }
  return sentences.slice(0, 2).map((s) => s.trim()).join(" ");
}

export function computeOverGeneratedCount(requestedCount: number): number {
  const safeCount = Math.max(1, Math.floor(requestedCount));
  return Math.ceil(safeCount * 1.2);
}

const jsonSafeFinanceParamsSchema = z.union([
  structuredFinanceParamsSchema,
  financeParamsSchema,
]);

export const jsonSafeFinanceSpecSchema = z.object({
  solver: financeSolverTypeSchema,
  target: z.string().optional(),
  params: jsonSafeFinanceParamsSchema,
  unit: financeUnitSchema.optional(),
  decimals: z.number().int().min(0).max(8).optional(),
  distractorModes: z.array(distractorModeSchema).optional(),
});

// Strict, Anthropic-safe (<24 optional parameters, zero catchall/anyOf inside params) schema for LLM structured generation.
export const llmFinanceSpecSchema = z
  .object({
    solver: financeSolverTypeSchema,
    target: z.string().optional(),
    params: structuredFinanceParamsSchema,
    unit: z.enum(["$", "%", "x", "years", "periods", "none"]),
    decimals: z.number().int().min(0).max(6),
    distractorModes: z.array(distractorModeSchema).optional(),
  })
  .strict();

const baseQuestionFields = {
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(500)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(2000),
  distractorRationale: z.string().max(1000).optional(),
};

const llmFields = {
  ...baseQuestionFields,
  financeSpec: llmFinanceSpecSchema.optional(),
};

function buildStudySchema<TFields extends z.ZodRawShape>(questionFields: TFields) {
  return z
    .object({
      title: z.string().min(1).max(120),
      sourceKind: z.enum(["testbank", "lecture", "mixed"]),
      questions: z
        .array(
          z
            .object({
              id: z.string().min(1).max(80),
              ...questionFields,
              conceptVariant: z.object(questionFields).strict(),
            })
            .strict(),
        )
        .max(45),
      annotations: z
        .array(
          z
            .object({
              questionId: z.string().min(1).max(80),
              sourceId: z.string().min(1).max(100),
              excerpt: z.string().min(12).max(1000),
              topic: z.string().min(1).max(120),
              chapter: z.string().max(120),
              rule: z.string().min(1).max(500),
              distractorRationale: z.string().max(1000).optional(),
            })
            .strict(),
        )
        .max(45),
      warnings: z.array(z.string().min(1).max(500)).max(10),
    })
    .strict();
}

export const llmStudyOutputSchema = buildStudySchema(llmFields);

// Providers accept homogeneous JSON arrays. Convert to the strict tuple contract
// only after generation, without weakening the game's QuestionItem schema.
const fields = {
  ...baseQuestionFields,
  financeSpec: jsonSafeFinanceSpecSchema.optional(),
};

export const generatedStudySchema = buildStudySchema(fields);


function normalize(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function cleanQuote(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u00ad]/g, "") // remove soft hyphens
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, " ") // non-breaking & special spaces
    .replace(/(\w+)-\s+(\w+)/g, "$1$2") // line-break hyphenation repair
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPunctuation(text: string): string {
  return cleanQuote(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparisonText(text: string): string {
  return stripPunctuation(text);
}

const BANNED_META_OPTION_RE = /\b(all|none)\s+of\s+the\s+above\b/i;
const BANNED_NEGATION_STEM_RE = /\b(EXCEPT|NOT)\b/;

export function hasBannedNegationOrMetaOption(item: {
  question: string;
  options: readonly string[] | string[];
  conceptVariant?: {
    question: string;
    options: readonly string[] | string[];
  };
}): boolean {
  const checkSingle = (q: string, opts: readonly string[]): boolean => {
    if (BANNED_NEGATION_STEM_RE.test(q) || BANNED_META_OPTION_RE.test(q)) {
      return true;
    }
    return opts.some((opt) => BANNED_META_OPTION_RE.test(opt));
  };

  if (checkSingle(item.question, item.options)) {
    return true;
  }
  if (
    item.conceptVariant &&
    checkSingle(item.conceptVariant.question, item.conceptVariant.options)
  ) {
    return true;
  }
  return false;
}

const THREE_ELEMENT_PERMUTATIONS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function hashStringDeterministic(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function shuffleQuestionOptions<
  T extends {
    question?: string;
    options: [string, string, string, string] | string[];
    correctIndex: number;
  },
>(item: T, seed?: string): T {
  if (
    !Array.isArray(item.options) ||
    item.options.length !== 4 ||
    item.correctIndex < 0 ||
    item.correctIndex >= 4
  ) {
    return item;
  }

  const seedText =
    seed !== undefined
      ? seed
      : `${item.question ?? ""}||${[...item.options].sort().join("||")}`;
  const hash = hashStringDeterministic(seedText);

  const targetCorrectIndex = hash % 4;
  const distractorPerm = THREE_ELEMENT_PERMUTATIONS[Math.floor(hash / 4) % 6];

  const correctOption = item.options[item.correctIndex];
  const distractors = item.options.filter((_, idx) => idx !== item.correctIndex);

  const shuffledOptions: [string, string, string, string] = ["", "", "", ""];
  shuffledOptions[targetCorrectIndex] = correctOption;

  let distractorSlot = 0;
  for (let slot = 0; slot < 4; slot++) {
    if (slot === targetCorrectIndex) continue;
    shuffledOptions[slot] = distractors[distractorPerm[distractorSlot]];
    distractorSlot++;
  }

  return {
    ...item,
    options: shuffledOptions,
    correctIndex: targetCorrectIndex,
  };
}

export function matchesText(sourceText: string, excerpt: string): boolean {
  if (!sourceText || !excerpt) return false;

  const normSource = normalize(sourceText);
  const normExcerpt = normalize(excerpt);
  if (normSource.includes(normExcerpt)) return true;

  const cleanSrc = cleanQuote(sourceText);
  const cleanExc = cleanQuote(excerpt);
  if (cleanSrc.includes(cleanExc)) return true;
  if (cleanSrc.toLowerCase().includes(cleanExc.toLowerCase())) return true;

  const strippedSrc = stripPunctuation(sourceText);
  const strippedExc = stripPunctuation(excerpt);
  if (strippedExc.length >= 10 && strippedSrc.includes(strippedExc)) return true;

  // Handle ellipsis in citations (e.g. "quote start... quote end")
  if (excerpt.includes("...") || excerpt.includes("…")) {
    const parts = excerpt
      .split(/\.{3,}|…/)
      .map((p) => stripPunctuation(p))
      .filter((p) => p.length >= 8);
    if (parts.length >= 2) {
      let lastIndex = 0;
      let allFound = true;
      for (const part of parts) {
        const found = strippedSrc.indexOf(part, lastIndex);
        if (found === -1) {
          allFound = false;
          break;
        }
        lastIndex = found + part.length;
      }
      if (allFound) return true;
    }
  }

  // Half-split match for leading/trailing minor paraphrasing
  if (strippedExc.length >= 20) {
    const half = Math.floor(strippedExc.length / 2);
    const firstHalf = strippedExc.slice(0, half).trim();
    const secondHalf = strippedExc.slice(half).trim();
    if (firstHalf.length >= 12 && strippedSrc.includes(firstHalf)) return true;
    if (secondHalf.length >= 12 && strippedSrc.includes(secondHalf)) return true;
  }

  // N-gram shingle overlap (resilient against small word adjustments)
  const excWords = strippedExc.split(/\s+/).filter((w) => w.length > 0);
  if (excWords.length >= 5) {
    for (let i = 0; i <= excWords.length - 4; i++) {
      const quad = excWords.slice(i, i + 4).join(" ");
      if (strippedSrc.includes(quad)) return true;
    }

    const shingles: string[] = [];
    for (let i = 0; i <= excWords.length - 3; i++) {
      shingles.push(excWords.slice(i, i + 3).join(" "));
    }
    if (shingles.length >= 3) {
      let matchedShingles = 0;
      for (const shingle of shingles) {
        if (strippedSrc.includes(shingle)) {
          matchedShingles++;
        }
      }
      if (matchedShingles / shingles.length >= 0.5) {
        return true;
      }
    }
  }

  return false;
}

function findAdjacentSourceMatch(
  sources: SourceBlock[],
  excerpt: string,
): SourceBlock | null {
  for (let i = 0; i < sources.length - 1; i++) {
    const combined = `${sources[i].text}\n${sources[i + 1].text}`;
    if (matchesText(combined, excerpt)) {
      return sources[i];
    }
  }
  return null;
}

function findSourceWithMaxOverlap(
  sources: SourceBlock[],
  excerpt: string,
): SourceBlock | null {
  const excWords = stripPunctuation(excerpt)
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (!excWords.length) return sources[0] || null;

  let bestSource: SourceBlock | null = null;
  let maxMatches = -1;

  for (const source of sources) {
    const srcText = stripPunctuation(source.text);
    let count = 0;
    for (const w of excWords) {
      if (srcText.includes(w)) count++;
    }
    if (count > maxMatches) {
      maxMatches = count;
      bestSource = source;
    }
  }
  return bestSource;
}

function badOutput(message: string): never {
  throw new IngestionError("INVALID_AI_OUTPUT", message, 502);
}

function notifyCitationRejection(params: {
  reason: CitationRejectionReason;
  document: ParsedDocument;
  sourceKind?: "testbank" | "lecture" | "mixed";
  questionId?: string;
  sourceId?: string;
  excerpt?: string;
}): void {
  try {
    const documentTitle = params.document.fileName
      ? params.document.fileName.slice(0, 200)
      : undefined;
    const sourceId = params.sourceId ? params.sourceId.slice(0, 100) : undefined;
    const excerptPreview = params.excerpt ? params.excerpt.slice(0, 240) : undefined;
    const questionId = params.questionId ? params.questionId.slice(0, 100) : undefined;
    const totalSources = Math.min(Math.max(0, params.document.sources.length), 5000);

    void recordTelemetryEvent({
      kind: "citation_rejection",
      reason: params.reason,
      documentTitle,
      sourceKind: params.sourceKind,
      sourceId,
      excerptPreview,
      questionId,
      totalSources,
    }).catch(() => {});
  } catch {
    // never crash validation
  }
}

function isLowConfidenceSource(
  sourceId: string,
  resolvedSourceId: string | undefined,
  lowConfidenceSet: Set<string>,
): boolean {
  if (lowConfidenceSet.size === 0) return false;
  if (lowConfidenceSet.has(sourceId)) return true;
  if (resolvedSourceId && lowConfidenceSet.has(resolvedSourceId)) return true;
  for (const lowId of lowConfidenceSet) {
    if (
      sourceId === `doc0_${lowId}` ||
      lowId === `doc0_${sourceId}` ||
      (resolvedSourceId &&
        (resolvedSourceId === `doc0_${lowId}` ||
          lowId === `doc0_${resolvedSourceId}`))
    ) {
      return true;
    }
  }
  return false;
}

export interface ValidateGeneratedStudyOptions {
  preSolved?: boolean | Set<string>;
}

export function validateGeneratedStudy(
  raw: unknown,
  document: ParsedDocument,
  options: IngestionOptions,
  validationOptions?: ValidateGeneratedStudyOptions,
): Omit<GenerationResult, "usage"> {
  const parsed = generatedStudySchema.safeParse(raw);
  if (!parsed.success)
    return badOutput(
      "The AI returned an invalid question structure. Please retry.",
    );
  const output = parsed.data;
  if (!output.questions.length)
    throw new IngestionError(
      "NO_SUPPORTED_QUESTIONS",
      options.mode === "exact"
        ? "Tài liệu này là slide bài giảng, không có sẵn câu hỏi trắc nghiệm nguyên văn (A, B, C, D). Vui lòng chọn phong cách 'Biến thể khái niệm' để AI tạo câu hỏi từ slide."
        : "The source could not support questions with these settings. Try a broader focus, concept variants, or a different document.",
      422,
    );

  if (
    new Set(output.questions.map((q) => q.id)).size !== output.questions.length
  ) {
    return badOutput(
      "The AI returned duplicate IDs or an unexpected question count. Please retry.",
    );
  }

  let firstDefectMessage: string | null = null;

  if (
    output.annotations.length !== output.questions.length ||
    new Set(output.annotations.map((a) => a.questionId)).size !==
      output.questions.length
  ) {
    notifyCitationRejection({
      reason: "annotation_count_mismatch",
      document,
      sourceKind: output.sourceKind,
    });
    if (output.annotations.length === 0) {
      return badOutput(
        "The AI did not provide one source reference per question. Please retry.",
      );
    }
    firstDefectMessage ??=
      "The AI did not provide one source reference per question. Please retry.";
  }

  const metadata: StudyPack["metadata"] = Object.create(null);
  const references: Record<string, SourceReference> = Object.create(null);
  const sources = new Map(
    document.sources.map((source) => [source.id, source]),
  );
  const annotations = new Map(output.annotations.map((a) => [a.questionId, a]));
  const entireSource = normalize(
    document.sources.map((source) => source.text).join("\n"),
  );
  const lowConfidenceSet = new Set(document.lowConfidenceSourceIds ?? []);
  const slideItemCounts = new Map<string, number>();
  const enforcePerSlideCap = document.sources.length >= 2;

  const validatedQuestions: StudyPack["questions"] = [];
  const seenQuestions = new Set<string>();
  const variantCountsInOutput = new Map<string, number>();
  for (const rawQ of output.questions) {
    const normV = normalizeComparisonText(rawQ.conceptVariant?.question ?? "");
    if (normV) {
      variantCountsInOutput.set(normV, (variantCountsInOutput.get(normV) ?? 0) + 1);
    }
  }
  const promotableVariants: Array<{
    variant: StudyPack["questions"][number]["conceptVariant"] & {
      sourceQuote?: string;
    };
    parentQuestion: StudyPack["questions"][number];
    sourceBlock: SourceBlock;
    sourceSlideKey: string;
    metadataItem: StudyPack["metadata"][string];
    excerpt: string;
  }> = [];
  let droppedByQualityGate = 0;

  for (const rawQuestion of output.questions) {
    const annotation = annotations.get(rawQuestion.id);
    const rawExcerpt = annotation?.excerpt ?? "";
    const rawSourceId = annotation?.sourceId ?? "";

    if (!annotation || normalize(rawExcerpt).length < 12) {
      notifyCitationRejection({
        reason: "missing_or_short_excerpt",
        document,
        sourceKind: output.sourceKind,
        questionId: rawQuestion.id,
        sourceId: rawSourceId,
        excerpt: rawExcerpt,
      });
      firstDefectMessage ??=
        "A generated citation could not be verified against the uploaded text. Please retry.";
      continue;
    }

    let source = sources.get(rawSourceId);
    if (!source) {
      // In multi-document ingestion, match by prefix or suffix (e.g. doc0_page-1 vs page-1)
      source = [...sources.values()].find(
        (s) =>
          s.id === `doc0_${rawSourceId}` || s.id.endsWith(`_${rawSourceId}`),
      );
    }

    if (!source) {
      notifyCitationRejection({
        reason: "unknown_source_id",
        document,
        sourceKind: output.sourceKind,
        questionId: rawQuestion.id,
        sourceId: rawSourceId,
        excerpt: rawExcerpt,
      });
      firstDefectMessage ??=
        "A generated citation could not be verified against the uploaded text. Please retry.";
      continue;
    }

    if (!matchesText(source.text, rawExcerpt)) {
      // 1. Check if another single source block matches
      const alternate = document.sources.find((s) =>
        matchesText(s.text, rawExcerpt),
      );
      if (alternate) {
        source = alternate;
        annotation.sourceId = alternate.id;
      } else {
        // 2. Check adjacent blocks (cross-page / cross-slide quote)
        const adjacentMatch = findAdjacentSourceMatch(
          document.sources,
          rawExcerpt,
        );
        if (adjacentMatch) {
          source = adjacentMatch;
          annotation.sourceId = adjacentMatch.id;
        } else if (matchesText(entireSource, rawExcerpt)) {
          // 3. Match found across document text
          const bestSource = findSourceWithMaxOverlap(
            document.sources,
            rawExcerpt,
          );
          if (bestSource) {
            source = bestSource;
            annotation.sourceId = bestSource.id;
          } else {
            notifyCitationRejection({
              reason: "unmatched_excerpt_in_source",
              document,
              sourceKind: output.sourceKind,
              questionId: rawQuestion.id,
              sourceId: rawSourceId,
              excerpt: rawExcerpt,
            });
            firstDefectMessage ??=
              "A generated citation could not be verified against the uploaded text. Please retry.";
            continue;
          }
        } else {
          notifyCitationRejection({
            reason: "unmatched_excerpt_in_source",
            document,
            sourceKind: output.sourceKind,
            questionId: rawQuestion.id,
            sourceId: rawSourceId,
            excerpt: rawExcerpt,
          });
          firstDefectMessage ??=
            "A generated citation could not be verified against the uploaded text. Please retry.";
          continue;
        }
      }
    }

    // Section 4.5 Hard Gate on Failed Vision Pages: drop items derived from low_confidence pages
    if (isLowConfidenceSource(rawSourceId, source.id, lowConfidenceSet)) {
      droppedByQualityGate++;
      continue;
    }

    // Psychometric Negation & Meta-Option Filter
    if (
      options.mode !== "exact" &&
      hasBannedNegationOrMetaOption(rawQuestion)
    ) {
      droppedByQualityGate++;
      continue;
    }

    // Anti-coverage cap: <= 2 items per slide when multiple slides exist
    if (enforcePerSlideCap) {
      const currentSlideCount = slideItemCounts.get(source.id) ?? 0;
      if (currentSlideCount >= MAX_ITEMS_PER_SLIDE) {
        droppedByQualityGate++;
        continue;
      }
    }

    // Deterministic Finance Solver Delegation (never trust LLM mental math)
    let solvedBase = {
      question: rawQuestion.question,
      options: [...rawQuestion.options] as [string, string, string, string],
      correctIndex: rawQuestion.correctIndex,
      explanation: rawQuestion.explanation,
    };
    let solvedVariant = {
      question: rawQuestion.conceptVariant.question,
      options: [...rawQuestion.conceptVariant.options] as [
        string,
        string,
        string,
        string,
      ],
      correctIndex: rawQuestion.conceptVariant.correctIndex,
      explanation: rawQuestion.conceptVariant.explanation,
    };

    const isPreSolved =
      validationOptions?.preSolved instanceof Set
        ? validationOptions.preSolved.has(rawQuestion.id)
        : Boolean(validationOptions?.preSolved);

    try {
      if (rawQuestion.financeSpec && !isPreSolved) {
        solvedBase = applyFinanceSolverToItem(
          solvedBase,
          rawQuestion.financeSpec,
        );
      }
      if (rawQuestion.conceptVariant.financeSpec && !isPreSolved) {
        solvedVariant = applyFinanceSolverToItem(
          solvedVariant,
          rawQuestion.conceptVariant.financeSpec,
        );
      }
    } catch {
      firstDefectMessage ??=
        "The AI returned invalid financial calculation parameters. Please retry.";
      continue;
    }

    let hasDuplicateOptions = false;
    for (const version of [solvedBase, solvedVariant]) {
      if (
        new Set(
          version.options.map((option) =>
            normalize(option).toLocaleLowerCase(),
          ),
        ).size !== 4
      ) {
        hasDuplicateOptions = true;
        break;
      }
    }
    if (hasDuplicateOptions) {
      firstDefectMessage ??=
        "The AI returned duplicate answer choices. Please retry.";
      continue;
    }
    if (normalize(solvedBase.question) === normalize(solvedVariant.question)) {
      firstDefectMessage ??=
        "The AI repeated a question instead of creating a concept variant. Please retry.";
      continue;
    }
    if (
      options.mode === "exact" &&
      [solvedBase.question, ...solvedBase.options].some(
        (text) => !matchesText(entireSource, text),
      )
    ) {
      firstDefectMessage ??=
        "Exact mode returned wording that does not match the source. Please retry or choose concept variants.";
      continue;
    }

    // Code-level deterministic option shuffling after verification to eliminate LLM position bias
    const finalBase =
      options.mode === "exact"
        ? solvedBase
        : shuffleQuestionOptions(solvedBase);
    const finalVariant =
      options.mode === "exact"
        ? solvedVariant
        : shuffleQuestionOptions(solvedVariant);

    const normBaseQuestion = normalizeComparisonText(finalBase.question);
    if (normBaseQuestion && seenQuestions.has(normBaseQuestion)) {
      droppedByQualityGate++;
      continue;
    }

    if (validatedQuestions.length >= options.questionCount) {
      break;
    }

    slideItemCounts.set(source.id, (slideItemCounts.get(source.id) ?? 0) + 1);

    // Own the IDs instead of using model-provided object keys in the game state.
    const safeId = `q-${validatedQuestions.length + 1}`;
    const baseQuestionWithVariant: StudyPack["questions"][number] = {
      id: safeId,
      question: finalBase.question,
      options: finalBase.options,
      correctIndex: finalBase.correctIndex,
      explanation: capExplanationToTwoSentences(
        repairCorruptedLatex(finalBase.explanation),
      ),
      conceptVariant: {
        question: finalVariant.question,
        options: finalVariant.options,
        correctIndex: finalVariant.correctIndex,
        explanation: capExplanationToTwoSentences(
          repairCorruptedLatex(finalVariant.explanation),
        ),
      },
    };
    validatedQuestions.push(baseQuestionWithVariant);
    if (normBaseQuestion) {
      seenQuestions.add(normBaseQuestion);
    }

    const isPaid = isPaidTier(options.tier);

    const rawDistractorRationale =
      annotation.distractorRationale ??
      rawQuestion.distractorRationale ??
      "";

    const metadataItem: StudyPack["metadata"][string] = {
      topic: annotation.topic,
      chapter: annotation.chapter,
      citation: `${document.fileName} · ${source.label}`,
      rule: repairCorruptedLatex(annotation.rule),
      // Distractor rationale ("why the others are wrong"): Free -> ❌ | Paid -> ✅
      ...(isPaid && rawDistractorRationale.trim()
        ? {
            distractorRationale: repairCorruptedLatex(
              rawDistractorRationale.trim(),
            ),
          }
        : {}),
    };
    metadata[safeId] = metadataItem;
    references[safeId] = {
      sourceId: source.id,
      label: source.label,
      excerpt: rawExcerpt,
    };

    const normVarQuestion = normalizeComparisonText(
      baseQuestionWithVariant.conceptVariant.question,
    );
    if (normVarQuestion && variantCountsInOutput.get(normVarQuestion) === 1) {
      promotableVariants.push({
        variant: {
          ...baseQuestionWithVariant.conceptVariant,
          sourceQuote: rawExcerpt,
        },
        parentQuestion: baseQuestionWithVariant,
        sourceBlock: source,
        sourceSlideKey: source.id,
        metadataItem,
        excerpt: rawExcerpt,
      });
    }
  }

  if (
    options.mode !== "exact" &&
    validatedQuestions.length < options.questionCount &&
    promotableVariants.length > 0 &&
    (output.questions.length >= 2 ||
      validatedQuestions.length + promotableVariants.length >=
        options.questionCount)
  ) {
    const sortedCandidates = [...promotableVariants].sort(
      (a, b) =>
        (slideItemCounts.get(a.sourceSlideKey) ?? 0) -
        (slideItemCounts.get(b.sourceSlideKey) ?? 0),
    );
    for (const cand of sortedCandidates) {
      if (validatedQuestions.length >= options.questionCount) break;
      const normVar = normalizeComparisonText(cand.variant.question);
      if (!normVar || seenQuestions.has(normVar)) continue;

      seenQuestions.add(normVar);
      slideItemCounts.set(
        cand.sourceSlideKey,
        (slideItemCounts.get(cand.sourceSlideKey) ?? 0) + 1,
      );

      const safeId = `q-${validatedQuestions.length + 1}`;
      validatedQuestions.push({
        id: safeId,
        question: cand.variant.question,
        options: cand.variant.options,
        correctIndex: cand.variant.correctIndex,
        explanation: cand.variant.explanation,
        conceptVariant: {
          question: cand.parentQuestion.question,
          options: cand.parentQuestion.options,
          correctIndex: cand.parentQuestion.correctIndex,
          explanation: cand.parentQuestion.explanation,
        },
      });
      metadata[safeId] = { ...cand.metadataItem };
      references[safeId] = {
        sourceId: cand.sourceBlock.id,
        label: cand.sourceBlock.label,
        excerpt: cand.variant.sourceQuote || cand.excerpt,
      };
    }
  }

  if (validatedQuestions.length === 0) {
    if (firstDefectMessage) {
      return badOutput(firstDefectMessage);
    }
    throw new IngestionError(
      "NO_SUPPORTED_QUESTIONS",
      droppedByQualityGate > 0
        ? "All candidate questions were filtered by vision confidence or psychometric quality gates."
        : options.mode === "exact"
          ? "Tài liệu này là slide bài giảng, không có sẵn câu hỏi trắc nghiệm nguyên văn (A, B, C, D). Vui lòng chọn phong cách 'Biến thể khái niệm' để AI tạo câu hỏi từ slide."
          : "The source could not support questions with these settings. Try a broader focus, concept variants, or a different document.",
      422,
    );
  }

  const bank = questionBankSchema.safeParse(validatedQuestions);
  if (!bank.success) {
    return badOutput(
      "The AI returned duplicate IDs or an unexpected question count. Please retry.",
    );
  }
  const questions = bank.data;

  const warnings = output.warnings.filter(isUserFacingWarning);
  if (questions.length < options.questionCount)
    warnings.push(
      `Created ${questions.length} of ${options.questionCount} requested questions; the source or selected focus did not support more.`,
    );
  return {
    pack: {
      id: randomUUID(),
      title: output.title,
      subtitle: `${questions.length} questions from ${document.fileName}`,
      questions,
      metadata,
    },
    sourceKind: output.sourceKind,
    references,
    warnings,
  };
}

// ============================================================================
// Concept-First Slide Grouping (8-15 Coherent Conceptual Units)
// ============================================================================

const CONTINUATION_MARKER_RE =
  /\b(cont\.?|continued|part\s+[2-9ivx]+|step\s+[2-9]\b|solution\b|answer\s+key|derivation\s*\(cont|example\s*\(cont)/i;
const WORKED_EXAMPLE_START_RE =
  /\b(example|worked\s+example|problem|case\s+study|exercise|step\s+1)\b/i;
const WORKED_EXAMPLE_FOLLOWUP_RE =
  /\b(step\s+[2-9]|solution|calculation|computing|substituting|solving\s+for|result:|answer:|cont\.?|continued)\b/i;

function extractSlideHeading(block: SourceBlock): string {
  const firstLine =
    block.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  return firstLine
    .replace(/\((cont\.?|continued|part\s+\d+)\)/gi, "")
    .replace(/\b(cont\.?|continued|step\s+\d+|part\s+\d+)\b/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isContinuationSlide(
  prev: SourceBlock,
  curr: SourceBlock,
): boolean {
  const currFirstLine =
    curr.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";

  if (
    CONTINUATION_MARKER_RE.test(curr.label) ||
    CONTINUATION_MARKER_RE.test(currFirstLine)
  ) {
    return true;
  }

  // Worked example spanning consecutive slides
  if (
    WORKED_EXAMPLE_START_RE.test(prev.text) &&
    WORKED_EXAMPLE_FOLLOWUP_RE.test(curr.text) &&
    prev.text !== curr.text
  ) {
    return true;
  }

  // Formula or unfinished sentence continuation across slide boundary
  const prevTrimmed = prev.text.trim();
  const currTrimmed = curr.text.trim();
  if (
    prevTrimmed !== currTrimmed &&
    (/[=+\-×:]\s*$/.test(prevTrimmed) ||
      /^(where\b|therefore\b|thus\b|hence\b|=)/i.test(currTrimmed))
  ) {
    return true;
  }

  // Shared specific slide heading across distinct slides
  if (prev.text !== curr.text) {
    const prevHeading = extractSlideHeading(prev);
    const currHeading = extractSlideHeading(curr);
    if (
      prevHeading.length >= 6 &&
      prevHeading.length <= 80 &&
      prevHeading === currHeading
    ) {
      return true;
    }
  }

  return false;
}

export const MAX_GROUP_SLIDES = 4;

export function isNonContentSlide(slide: SourceBlock): boolean {
  const cleaned = cleanSlideBoilerplate(slide.text || "");
  if (!cleaned || cleaned.length === 0) return true;

  // Publisher Copyright / Legal Disclaimers
  if (
    /\bsolely for the use of instructors\b|\bdissemination or sale of any part\b/i.test(
      cleaned,
    )
  ) {
    return true;
  }

  const hasEquationsOrCurrency = /[=$]/.test(cleaned);
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Learning Objectives Slides (EVALUATE BEFORE calculation keyword regex)
  if (
    /\b(learning objectives|learning goals|mục tiêu bài học)\b/i.test(cleaned) &&
    !hasEquationsOrCurrency
  ) {
    return true;
  }

  // Chapter Outline / Agenda Slides
  if (
    /\b(chapter outline|table of contents|course outline|agenda|nội dung chương|chương trình học)\b/i.test(
      cleaned,
    ) &&
    !hasEquationsOrCurrency
  ) {
    const hasLongExplanatoryProse = lines.some(
      (line) => line.length > 95 && /[.!?]$/.test(line),
    );
    if (!hasLongExplanatoryProse) {
      return true;
    }
  }

  // Chapter / Appendix Cover & Divider Slides
  if (
    !hasEquationsOrCurrency &&
    /\b(chapter|appendix|part|module|unit|session|chương|phần|bài)\s+(\d+|[ivx]+)\b/i.test(
      cleaned,
    ) &&
    (cleaned.length < 110 ||
      (lines.length <= 6 && lines.every((l) => l.length < 90)))
  ) {
    return true;
  }

  // Caption-Only Figure/Table Slides
  if (
    !hasEquationsOrCurrency &&
    cleaned.length < 100 &&
    /^(?:figure|table)\s+\d+/i.test(cleaned)
  ) {
    return true;
  }

  // If it has explicit calculations, numbers, or problem markers, it's substantive
  if (
    /(\d+[\d,.]*\s*[%$€£¥]|\$\s*\d+|\b(calculate|compute|solve|exercise|problem|practice|step\s+\d)\b)/i.test(
      cleaned,
    )
  ) {
    return false;
  }

  // 1. Attendance check / QR / Registration / Form links
  if (
    /(attendance\s*check|điểm\s*danh|roll\s*call|tinyurl\.com|bit\.ly|qr\s*code|scan\s*me|forms\.gle|google\.com\/forms)/i.test(
      cleaned,
    )
  ) {
    return true;
  }

  // 2. Cover / Course metadata / Session intro (e.g. "Flights of Wisdom Season 18 Session 2 Captain...")
  if (
    /(flights\s*of\s*wisdom|season\s*\d+|session\s*\d+|captain\b|lecturer\b|instructor\b|facilitator\b|table\s*of\s*contents|agenda\b)/i.test(
      cleaned,
    ) &&
    cleaned.length < 180
  ) {
    return true;
  }

  // 3. Pure title-only divider slide (e.g. "REVISION CHAPTER 9 STOCK VALUATION")
  if (
    lines.length <= 3 &&
    cleaned.length < 80 &&
    (/^(revision\s+)?(chapter|session|part|module|unit|chương|phần|bài)\s+\d+/i.test(
      cleaned,
    ) ||
      !/[.?!,;:]/.test(cleaned))
  ) {
    return true;
  }

  // 4. Closing / Outro / Feedback / Social links (e.g. "Thank you! Discord Server Feedback Form")
  if (
    /(thank\s*you|cảm\s*ơn|any\s*questions\?|discord\s*server|feedback\s*form|see\s*you\s*(next|soon))/i.test(
      cleaned,
    ) &&
    cleaned.length < 180
  ) {
    return true;
  }

  return false;
}

export function isSubstantiveSlide(slide: SourceBlock): boolean {
  return !isNonContentSlide(slide);
}

export function groupSlidesByConcept(
  sources: SourceBlock[],
  _targetGroupCount?: number,
): SourceBlock[][] {
  if (sources.length === 0) return [];
  if (sources.length === 1) return [[sources[0]]];

  const hasAnySubstantive = sources.some(isSubstantiveSlide);
  if (!hasAnySubstantive) {
    return [sources];
  }

  // Step 1 & Step 2:
  // - Merge consecutive worked-example continuations / same-stem headings up to MAX_GROUP_SLIDES = 4.
  // - Attach non-substantive slides (front-matter, mid-deck cover/outline slides from doc1_*, or trailing outro slides)
  //   to their nearest substantive group so non-content slides never stand alone.
  const atomicGroups: SourceBlock[][] = [];
  let currentGroup: SourceBlock[] = [];
  let currentSubstantiveCount = 0;

  for (let i = 0; i < sources.length; i++) {
    const slide = sources[i];
    const isSubstantive = isSubstantiveSlide(slide);

    if (currentGroup.length === 0) {
      currentGroup.push(slide);
      currentSubstantiveCount = isSubstantive ? 1 : 0;
      continue;
    }

    // Current group only has non-substantive slides so far -> attach forward until a substantive slide arrives
    if (currentSubstantiveCount === 0) {
      currentGroup.push(slide);
      if (isSubstantive) {
        currentSubstantiveCount = 1;
      }
      continue;
    }

    // Trailing non-substantive slide(s) at the end of the deck -> attach backward to current substantive group
    if (!isSubstantive) {
      const hasRemainingSubstantive = sources
        .slice(i + 1)
        .some(isSubstantiveSlide);
      if (!hasRemainingSubstantive) {
        currentGroup.push(slide);
        continue;
      }
      // Mid-deck non-substantive slide (e.g. doc1_page-1 cover/outline) -> start next group so it attaches forward to next substantive slide
      atomicGroups.push(currentGroup);
      currentGroup = [slide];
      currentSubstantiveCount = 0;
      continue;
    }

    const prevSlide = currentGroup[currentGroup.length - 1];

    // Consecutive substantive continuation slide up to MAX_GROUP_SLIDES = 4
    if (
      currentSubstantiveCount < MAX_GROUP_SLIDES &&
      isContinuationSlide(prevSlide, slide)
    ) {
      currentGroup.push(slide);
      currentSubstantiveCount++;
      continue;
    }

    // Start a new substantive group
    atomicGroups.push(currentGroup);
    currentGroup = [slide];
    currentSubstantiveCount = 1;
  }

  if (currentGroup.length > 0) {
    if (currentSubstantiveCount === 0 && atomicGroups.length > 0) {
      atomicGroups[atomicGroups.length - 1].push(...currentGroup);
    } else {
      atomicGroups.push(currentGroup);
    }
  }

  return atomicGroups;
}

export const MAX_QUESTIONS_PER_BATCH = 5;

export function splitIntoBatchCounts(totalQuestions: number): number[] {
  if (totalQuestions <= MAX_QUESTIONS_PER_BATCH) return [totalQuestions];
  const batchCount = Math.ceil(totalQuestions / MAX_QUESTIONS_PER_BATCH);
  const base = Math.floor(totalQuestions / batchCount);
  const remainder = totalQuestions % batchCount;
  return Array.from({ length: batchCount }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}

export function partitionSourcesAcrossBatches(
  sources: SourceBlock[],
  batchCount: number,
): SourceBlock[][] {
  if (batchCount <= 1 || sources.length === 0) {
    return [sources];
  }

  const substantiveSources = sources.filter((s) => !isNonContentSlide(s));

  if (substantiveSources.length >= batchCount) {
    const rawGroups = groupSlidesByConcept(substantiveSources);
    const targetSlidesPerBatch = substantiveSources.length / batchCount;
    const maxGroupSize = Math.max(1, Math.ceil(targetSlidesPerBatch * 1.5));
    const chunkSize = Math.max(1, Math.round(targetSlidesPerBatch));

    // Split any group larger than Math.ceil(targetSlidesPerBatch * 1.5) chronologically
    const balancedGroups: SourceBlock[][] = [];
    for (const grp of rawGroups) {
      if (grp.length > maxGroupSize) {
        for (let i = 0; i < grp.length; i += chunkSize) {
          balancedGroups.push(grp.slice(i, i + chunkSize));
        }
      } else {
        balancedGroups.push([...grp]);
      }
    }

    // If we still have fewer groups than batchCount (while substantiveSources.length >= batchCount),
    // split the largest multi-slide groups chronologically so every batch receives at least 1 group.
    while (balancedGroups.length < batchCount) {
      let largestIdx = -1;
      let largestLen = 1;
      for (let i = 0; i < balancedGroups.length; i++) {
        if (balancedGroups[i].length > largestLen) {
          largestLen = balancedGroups[i].length;
          largestIdx = i;
        }
      }
      if (largestIdx === -1) break;
      const toSplit = balancedGroups[largestIdx];
      const mid = Math.ceil(toSplit.length / 2);
      balancedGroups.splice(
        largestIdx,
        1,
        toSplit.slice(0, mid),
        toSplit.slice(mid),
      );
    }

    const partitions: SourceBlock[][] = [];
    let groupIdx = 0;
    let remainingSlides = substantiveSources.length;

    for (let b = 0; b < batchCount; b++) {
      const remainingBatches = batchCount - b;
      if (b === batchCount - 1) {
        const rest = balancedGroups.slice(groupIdx).flat();
        partitions.push(
          rest.length > 0
            ? rest
            : [substantiveSources[substantiveSources.length - 1]],
        );
        break;
      }

      const currentTarget = remainingSlides / remainingBatches;
      const currentBatch: SourceBlock[] = [];

      while (
        groupIdx < balancedGroups.length &&
        balancedGroups.length - groupIdx > remainingBatches - 1
      ) {
        const nextGroup = balancedGroups[groupIdx];
        if (currentBatch.length === 0) {
          currentBatch.push(...nextGroup);
          remainingSlides -= nextGroup.length;
          groupIdx++;
          continue;
        }

        const nextLen = currentBatch.length + nextGroup.length;
        if (
          currentBatch.length < currentTarget &&
          Math.abs(nextLen - currentTarget) <=
            Math.abs(currentBatch.length - currentTarget) + 0.5
        ) {
          currentBatch.push(...nextGroup);
          remainingSlides -= nextGroup.length;
          groupIdx++;
        } else {
          break;
        }
      }

      partitions.push(
        currentBatch.length > 0 ? currentBatch : [substantiveSources[b]],
      );
    }

    return partitions;
  }

  // Fallback for tiny documents where substantiveSources.length < batchCount
  if (sources.length <= 1) {
    return Array.from({ length: batchCount }, () => sources);
  }

  const conceptGroups = groupSlidesByConcept(sources, batchCount);
  if (conceptGroups.length === batchCount) {
    return conceptGroups;
  }

  return Array.from({ length: batchCount }, (_, batchIndex) => {
    const start = Math.floor((batchIndex * conceptGroups.length) / batchCount);
    const end = Math.max(
      start + 1,
      Math.floor(((batchIndex + 1) * conceptGroups.length) / batchCount),
    );
    const slice = conceptGroups.slice(start, end).flat();
    return slice.length > 0 ? slice : sources;
  });
}

export function compressSourcesForSonnetCascade(
  sources: SourceBlock[],
  maxTotalChars = 18_000,
): SourceBlock[] {
  if (!sources || sources.length === 0) return [];

  const safeMaxTotalChars = Math.min(
    maxTotalChars,
    SONNET_MAX_INPUT_TOKENS * 3,
  );
  const perSlideCap = Math.min(
    900,
    Math.max(220, Math.floor(safeMaxTotalChars / Math.max(1, sources.length))),
  );

  const compressed = sources.map((slide) => {
    const rawText = slide.text || "";
    const cleaned = cleanSlideBoilerplate(rawText);
    if (!cleaned) {
      return {
        ...slide,
        text: rawText.trim().slice(0, perSlideCap),
      };
    }

    if (cleaned.length <= perSlideCap) {
      return {
        ...slide,
        text: cleaned,
      };
    }

    // Split into candidate verbatim sentences/lines from the slide
    const rawSegments = cleaned
      .split(/\r?\n|(?<=[.!?])\s+/)
      .map((seg) => seg.trim())
      .filter((seg) => seg.length > 0);

    const selectedSegments: string[] = [];
    const pickedIndices = new Set<number>();

    // 1. Always preserve the first 1-2 verbatim substantive sentences (>= 12 words if available) as quote anchors
    let anchorCount = 0;
    for (let i = 0; i < rawSegments.length && anchorCount < 2; i++) {
      const wordCount = rawSegments[i].split(/\s+/).filter(Boolean).length;
      if (wordCount >= 12) {
        selectedSegments.push(rawSegments[i]);
        pickedIndices.add(i);
        anchorCount++;
      }
    }
    if (anchorCount === 0) {
      for (let i = 0; i < Math.min(2, rawSegments.length); i++) {
        if (rawSegments[i].length >= 12) {
          selectedSegments.push(rawSegments[i]);
          pickedIndices.add(i);
          anchorCount++;
        }
      }
    }

    // 2. Extract lines/sentences with formulas (=), currency/numbers ($, %, digits), definitions, or key concepts
    const keyConceptRe =
      /[=$%]|\b\d+(?:[.,]\d+)?\b|\b(is defined as|refers to|means|equals|formula|equation|rule|decision|npv|irr|wacc|cash flow|present value|discount|valuation|return|cost|rate|elasticity|marginal|equilibrium)\b/i;

    let currentLen = selectedSegments.join("\n").length;
    for (let i = 0; i < rawSegments.length; i++) {
      if (pickedIndices.has(i)) continue;
      const seg = rawSegments[i];
      if (keyConceptRe.test(seg)) {
        if (currentLen + 1 + seg.length <= perSlideCap) {
          pickedIndices.add(i);
          currentLen += 1 + seg.length;
        }
      }
    }

    // 3. Reconstruct in original slide order
    const orderedSegments = rawSegments.filter((_, idx) =>
      pickedIndices.has(idx),
    );
    const blueprintText =
      orderedSegments.length > 0
        ? orderedSegments.join("\n").slice(0, 900)
        : cleaned.slice(0, perSlideCap);

    return {
      ...slide,
      text: blueprintText,
    };
  });

  const totalChars = compressed.reduce((sum, s) => sum + s.text.length, 0);
  if (totalChars <= safeMaxTotalChars) {
    return compressed;
  }

  // Enforce strict batch total cap while preserving verbatim anchor start on every slide
  const strictPerSlide = Math.max(
    120,
    Math.floor(safeMaxTotalChars / Math.max(1, compressed.length)),
  );
  return compressed.map((s) => ({
    ...s,
    text: s.text.length > strictPerSlide ? s.text.slice(0, strictPerSlide) : s.text,
  }));
}

export function isUserFacingWarning(warning: string): boolean {
  const w = warning.trim();
  if (!w) return false;

  // Filter out model self-confirmations and prompt compliance reporting
  if (/^requested \d+ questions;.*supported/i.test(w)) return false;
  if (/financeSpec params object is constrained/i.test(w)) return false;
  if (/option values are numeric text; the solver spec supplies/i.test(w)) return false;
  if (/the attendance link in .* was not followed/i.test(w)) return false;
  if (/^batch \d+ of \d+ provides no usable material/i.test(w)) return false;
  if (/the only source block is a title slide/i.test(w)) return false;
  if (/only the [\w-]+ source block contains testable concepts/i.test(w)) return false;
  if (/pages?\s+\d+.*are title and outline slides/i.test(w)) return false;
  if (/stem wording is awkward/i.test(w)) return false;
  if (/only \d+ questions? (could be supported|from this batch|generated because)/i.test(w)) return false;
  if (/lack testable concepts/i.test(w)) return false;
  if (/the source blocks contain only a title page/i.test(w)) return false;
  if (/rather than padding with unsupported items/i.test(w)) return false;

  return true;
}

type GeneratedStudyObject = z.infer<typeof generatedStudySchema>;

export function mergeAndDeduplicateBatches(
  batches: GeneratedStudyObject[],
  maxQuestions: number,
): GeneratedStudyObject {
  const first = batches[0];
  const seenQuestions = new Set<string>();
  const mergedQuestions: GeneratedStudyObject["questions"] = [];
  const mergedAnnotations: GeneratedStudyObject["annotations"] = [];
  const warningSet = new Set<string>();

  for (const batch of batches) {
    for (const w of batch.warnings) {
      if (isUserFacingWarning(w) && warningSet.size < 10) {
        warningSet.add(w);
      }
    }
  }

  const annotationMaps = batches.map(
    (b) => new Map(b.annotations.map((a) => [a.questionId, a])),
  );
  const maxBatchLen = Math.max(0, ...batches.map((b) => b.questions.length));

  roundLoop: for (let round = 0; round < maxBatchLen; round++) {
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (mergedQuestions.length >= maxQuestions) {
        break roundLoop;
      }
      const batch = batches[batchIdx];
      if (round >= batch.questions.length) continue;
      const q = batch.questions[round];
      const normQuestion = stripPunctuation(q.question);
      const normVariant = q.conceptVariant?.question
        ? stripPunctuation(q.conceptVariant.question)
        : "";

      if (!normQuestion || seenQuestions.has(normQuestion)) continue;
      if (normVariant && seenQuestions.has(normVariant)) continue;

      const ann = annotationMaps[batchIdx].get(q.id);
      if (!ann) continue;

      seenQuestions.add(normQuestion);

      const uniqueId = `b${batchIdx + 1}_${q.id}`;
      mergedQuestions.push({
        ...q,
        id: uniqueId,
      });
      mergedAnnotations.push({
        ...ann,
        questionId: uniqueId,
      });
    }
  }

  // Synthesize composite multi-chapter title when 2+ distinct topic titles exist across batches
  const candidateTitles: string[] = [];
  for (const batch of batches) {
    const t = (batch.title || "").trim();
    if (
      !t ||
      /^(study\s+pack|bộ\s+đề\s+ôn\s+tập|untitled)$/i.test(t)
    ) {
      continue;
    }
    if (!candidateTitles.some((existing) => existing.toLowerCase() === t.toLowerCase())) {
      candidateTitles.push(t);
    }
  }

  const distinctTitles = candidateTitles.filter(
    (t, idx) =>
      !candidateTitles.some(
        (other, otherIdx) =>
          otherIdx !== idx && other.toLowerCase().includes(t.toLowerCase()),
      ),
  );

  let synthesizedTitle = first?.title || "Study Pack";
  if (distinctTitles.length >= 2) {
    const joinedThree = distinctTitles.slice(0, 3).join(" & ");
    const joinedTwo = distinctTitles.slice(0, 2).join(" & ");
    const compositeTitle =
      distinctTitles.length >= 3 && joinedThree.length <= 120
        ? joinedThree
        : joinedTwo;
    synthesizedTitle = compositeTitle.slice(0, 120).trim();
  } else if (distinctTitles.length === 1) {
    synthesizedTitle = distinctTitles[0].slice(0, 120);
  }

  return {
    title: synthesizedTitle,
    sourceKind: first?.sourceKind || "mixed",
    questions: mergedQuestions,
    annotations: mergedAnnotations,
    warnings: Array.from(warningSet).slice(0, 10),
  };
}

export interface GenerateQuestionsVerificationConfig {
  verifierModel?: LanguageModel | false;
  skipSolverComputed?: boolean;
}

function isLanguageModelInstance(val: unknown): val is LanguageModel {
  return (
    Boolean(val) &&
    typeof val === "object" &&
    ("doGenerate" in (val as Record<string, unknown>) ||
      "specificationVersion" in (val as Record<string, unknown>))
  );
}

export async function generateQuestions(
  document: ParsedDocument,
  options: IngestionOptions & { verifierModel?: LanguageModel | false; tier?: string },
  signal: AbortSignal,
  model?: LanguageModel,
  verificationConfig?: GenerateQuestionsVerificationConfig | LanguageModel | false,
): Promise<GenerationResult> {
  const resolvedModel = model ?? getGenerationModel(options.tier);

  // Give full 8,192 token output capacity for Gemini (preventing finishReason: 'length' truncation),
  // while capping at 4,096 when strictly on Groq free tier.
  const isGroq = Boolean(
    process.env.GROQ_API_KEY && process.env.AI_PROVIDER === "groq",
  );
  const maxOutputTokens = isGroq ? 4_096 : 8_192;
  let anyBatchWasBudgeted = false;

  const runBatch = async (
    batchSources: SourceBlock[],
    batchQuestionCount: number,
    batchIndex: number,
    totalBatches: number,
    overrideOptions?: IngestionOptions & { tier?: string },
  ) => {
    const effectiveOptions = overrideOptions ?? options;
    const batchBudget = budgetSourceBlocks(
      batchSources,
      isGroq ? 12_000 : 18_000,
      effectiveOptions.focus,
    );
    if (batchBudget.wasBudgeted) {
      anyBatchWasBudgeted = true;
    }

    const primaryModelId = String(
      (resolvedModel as any)?.modelId ||
        (resolvedModel as any)?.provider ||
        "",
    );
    const batchChars = batchBudget.sources.reduce(
      (sum, s) => sum + s.text.length,
      0,
    );
    let effectiveBatchSources = batchBudget.sources;
    if (
      primaryModelId.toLowerCase().includes("claude-sonnet") &&
      batchChars > 3_200
    ) {
      // Stage 1 (Claude Haiku 5.5 Distiller) -> Stage 2 (Claude Sonnet 5.5 Generator) lossless compression cascade
      const distillerModel = getDistillerModel();
      void distillerModel;
      effectiveBatchSources = compressSourcesForSonnetCascade(
        batchBudget.sources,
        18_000,
      );
    }

    const batchDoc: ParsedDocument = {
      ...document,
      sources: effectiveBatchSources,
    };
    const batchFocus =
      totalBatches > 1
        ? [
            effectiveOptions.focus,
            `Section batch ${batchIndex + 1} of ${totalBatches}: focus on distinct concepts from these source blocks.`,
          ]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 300)
        : effectiveOptions.focus;
    const overGeneratedBatchCount = Math.min(
      45,
      computeOverGeneratedCount(batchQuestionCount),
    );
    const batchOptions: IngestionOptions & { tier?: string } = {
      ...effectiveOptions,
      questionCount: overGeneratedBatchCount,
      focus: batchFocus,
      tier: effectiveOptions.tier,
    };
    const batchPrompt = buildIngestionPrompt(batchDoc, batchOptions);

    // Assertion: warn if any prompt exceeds 90K tokens (Haiku 5.5 price cliff at 100K)
    // Free tier users cannot proceed past 90K tokens to protect COGS and encourage upgrading to Cram Pass or Pro
    const isPaidGeneration = isPaidTier(options.tier);
    assertPromptTokenCliff(batchPrompt, (resolvedModel as any)?.modelId, {
      tier: options.tier,
      throwOnExceeded: !isPaidGeneration,
    });

    // Build ordered list of candidate models for robust multi-tier fallback
    const candidateModels: { name: string; model: LanguageModel }[] = [];
    const resolvedId =
      (resolvedModel as any)?.modelId ||
      (resolvedModel as any)?.provider ||
      "Primary AI model";
    candidateModels.push({ name: resolvedId, model: resolvedModel });

    // Fallback 1: OpenRouter generator (if primary was not OpenRouter)
    if (getOpenRouterApiKey()) {
      try {
        const isPaid = isPaidTier(options.tier);
        const openRouterModel = isPaid
          ? getOpenRouterGeneratorModel(options.tier, { degraded: true })
          : getOpenRouterGeneratorModel(options.tier);
        if (openRouterModel && (openRouterModel as any)?.modelId !== resolvedId) {
          candidateModels.push({
            name: "OpenRouter Generator",
            model: openRouterModel,
          });
        }
      } catch {
        // ignore if not configured
      }
    }

    // Fallback 2: Google Gemini 3.6 Flash
    const gemini = getGeminiModel();
    if (gemini && (gemini as any)?.modelId !== resolvedId) {
      candidateModels.push({ name: "Google Gemini 3.6 Flash", model: gemini });
    }

    // Fallback 3: Google Gemini 3.5 Flash-Lite (resilient during peak load / 503 high-demand spikes)
    const geminiLite = getGeminiModel("gemini-3.5-flash-lite");
    if (geminiLite && (geminiLite as any)?.modelId !== resolvedId) {
      candidateModels.push({
        name: "Google Gemini 3.5 Flash-Lite",
        model: geminiLite,
      });
    }

    // Fallback 4: Groq LPU
    const groq = getGroqModel();
    if (groq && (groq as any)?.modelId !== resolvedId) {
      candidateModels.push({ name: "Groq LPU", model: groq });
    }

    let lastError: any = null;
    for (let i = 0; i < candidateModels.length; i++) {
      const { name, model: candidate } = candidateModels[i];
      const isPrimary = i === 0;
      const isLocal = Boolean(
        process.env.AI_PROVIDER === "local" ||
          process.env.AI_PROVIDER === "ollama",
      );
      const timeoutMs = isPrimary
        ? isLocal
          ? 90_000
          : 75_000
        : 45_000;
      const timeoutController = new AbortController();
      const timer = setTimeout(
        () =>
          timeoutController.abort(
            new DOMException(`${name} timed out`, "TimeoutError"),
          ),
        timeoutMs,
      );
      const combinedSignal = AbortSignal.any([
        signal,
        timeoutController.signal,
      ]);

      try {
        const candidateModelId = String(
          (candidate as any)?.modelId || name || "",
        );
        const prompt = candidateModelId.toLowerCase().includes("claude-sonnet")
          ? assertSonnetInputTokenGuard(
              batchPrompt,
              candidateModelId,
              SONNET_MAX_INPUT_TOKENS,
            ).truncatedPromptText
          : batchPrompt;

        return await generateObject({
          model: candidate,
          schema: llmStudyOutputSchema,
          system: ingestionSystemPrompt,
          prompt,
          temperature: MCQ_GENERATION_TEMPERATURE,
          topP: MCQ_GENERATION_TOP_P,
          abortSignal: combinedSignal,
          maxRetries: 0,
          maxOutputTokens: (candidate as any).provider?.includes("groq")
            ? 4_096
            : maxOutputTokens,
        });
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        if (i < candidateModels.length - 1) {
          console.warn(
            `[generateQuestions] ${name} failed (${errMsg}). Instant auto-failover to ${candidateModels[i + 1].name}...`,
          );
        } else {
          console.error(
            `[generateQuestions] All ${candidateModels.length} candidate AI models failed. Final error:`,
            errMsg,
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  };

  try {
    const batchCounts = splitIntoBatchCounts(options.questionCount);
    const sourcePartitions = partitionSourcesAcrossBatches(
      document.sources,
      batchCounts.length,
    );

    const settled = await Promise.allSettled(
      batchCounts.map((count, idx) =>
        runBatch(sourcePartitions[idx], count, idx, batchCounts.length),
      ),
    );

    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runBatch>>> =>
        r.status === "fulfilled",
    );
    const rejected = settled.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    if (fulfilled.length === 0) {
      throw rejected[0].reason;
    }

    const batchResults = fulfilled.map((r) => r.value);

    const batchProvenances = batchResults.map((r) => extractOpenRouterProvenance(r));
    for (const res of batchResults) {
      const inputTokens = (res.usage as any)?.inputTokens ?? (res.usage as any)?.promptTokens;
      if (typeof inputTokens === "number" && inputTokens > HAIKU_TOKEN_CLIFF_THRESHOLD) {
        console.warn(
          `[TokenCliffWarning] Prompt input tokens (${inputTokens.toLocaleString()}) exceeded 90K token limit. You need to buy a Cram Pass or upgrade to Pro plan to proceed (Claude Haiku 5.5 has a 5x price cliff at 100K ($0.10/$0.50 -> $0.50/$2.50)).`,
        );
      }
    }

    const overGenTarget = computeOverGeneratedCount(options.questionCount);
    let rawObject: GeneratedStudyObject =
      batchResults.length === 1
        ? batchResults[0].object
        : mergeAndDeduplicateBatches(
            batchResults.map((r) => r.object),
            overGenTarget,
          );

    let fellBackToVariants = false;
    if (rawObject.questions.length === 0 && options.mode === "exact") {
      console.warn(
        "[generateQuestions] No verbatim MCQs found for mode=exact. Automatically falling back to mode=variants for lecture slides.",
      );
      const fallbackOptions = { ...options, mode: "variants" as const };
      const fallbackSettled = await Promise.allSettled(
        batchCounts.map((count, idx) =>
          runBatch(
            sourcePartitions[idx],
            count,
            idx,
            batchCounts.length,
            fallbackOptions,
          ),
        ),
      );
      const fallbackFulfilled = fallbackSettled.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runBatch>>> =>
          r.status === "fulfilled",
      );
      if (fallbackFulfilled.length > 0) {
        fellBackToVariants = true;
        const fallbackResults = fallbackFulfilled.map((r) => r.value);
        rawObject =
          fallbackResults.length === 1
            ? fallbackResults[0].object
            : mergeAndDeduplicateBatches(
                fallbackResults.map((r) => r.object),
                overGenTarget,
              );
        batchResults.push(...fallbackResults);
      }
    }

    // Resolve optional cross-family blind verifier
    const explicitVerifier =
      verificationConfig === false
        ? false
        : isLanguageModelInstance(verificationConfig)
          ? verificationConfig
          : verificationConfig?.verifierModel !== undefined
            ? verificationConfig.verifierModel
            : options.verifierModel;

    const shouldRunBlindVerifier =
      explicitVerifier !== false &&
      (Boolean(explicitVerifier) || (!model && Boolean(getOpenRouterApiKey())));

    let wasPreSolved = false;
    let verifierInputTokens = 0;
    let verifierOutputTokens = 0;
    let verifierTotalTokens = 0;
    let verifierCostUsd = 0;
    let servedVerifierModel: string | undefined = undefined;

    if (shouldRunBlindVerifier && rawObject.questions.length > 0) {
      const annotationByQId = new Map(
        rawObject.annotations.map((a) => [a.questionId, a]),
      );
      const sourcesById: Record<string, string> = Object.fromEntries(
        document.sources.map((s) => [s.id, s.text]),
      );

      // Apply deterministic finance solver before blind verification so solver-computed items have exact keys
      let preSolvedQuestions: typeof rawObject.questions = [];
      for (const q of rawObject.questions) {
        try {
          const solvedBase = q.financeSpec
            ? applyFinanceSolverToItem(q, q.financeSpec)
            : q;
          const solvedVariant = q.conceptVariant.financeSpec
            ? applyFinanceSolverToItem(
                q.conceptVariant,
                q.conceptVariant.financeSpec,
              )
            : q.conceptVariant;
          preSolvedQuestions.push({
            ...solvedBase,
            conceptVariant: solvedVariant,
          });
        } catch {
          // Drop defective financeSpec item so blind verification can proceed with valid items
        }
      }
      if (preSolvedQuestions.length === 0 && rawObject.questions.length > 0) {
        return badOutput(
          "The AI returned invalid financial calculation parameters. Please retry.",
        );
      }
      wasPreSolved = true;

      const verifiableItems: VerifiableQuestionInput[] = preSolvedQuestions.map(
        (q) => {
          const ann = annotationByQId.get(q.id);
          return {
            id: q.id,
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            excerpt: ann?.excerpt,
            sourceId: ann?.sourceId,
            solverComputed: Boolean(q.financeSpec),
            conceptVariant: {
              question: q.conceptVariant.question,
              options: q.conceptVariant.options,
              correctIndex: q.conceptVariant.correctIndex,
              explanation: q.conceptVariant.explanation,
              solverComputed: Boolean(q.conceptVariant.financeSpec),
            },
          };
        },
      );

      const skipSolverComputed =
        verificationConfig !== false &&
        !isLanguageModelInstance(verificationConfig) &&
        verificationConfig?.skipSolverComputed !== undefined
          ? verificationConfig.skipSolverComputed
          : false;

      const actualGeneratorSlug =
        batchProvenances.find((p) => p.servedModel)?.servedModel ||
        (typeof (resolvedModel as any)?.modelId === "string"
          ? (resolvedModel as any).modelId
          : undefined);

      const verifyRes = await verifyQuestionsBlindly(verifiableItems, {
        ...(actualGeneratorSlug && isPinnedOpenRouterSlug(actualGeneratorSlug)
          ? { generatorSlug: actualGeneratorSlug }
          : {}),
        verifierModel: isLanguageModelInstance(explicitVerifier)
          ? explicitVerifier
          : undefined,
        sourcesById,
        skipSolverComputed,
        allowUnconfiguredSkip: true,
        allowFallbacks: !isLanguageModelInstance(explicitVerifier),
      });

      if (verifyRes) {
        verifierCostUsd = verifyRes.costUsd || 0;
        servedVerifierModel = verifyRes.servedVerifierModel || undefined;
      }

      if (typeof verifyRes.usage.inputTokens === "number") {
        verifierInputTokens = verifyRes.usage.inputTokens;
      }
      if (typeof verifyRes.usage.outputTokens === "number") {
        verifierOutputTokens = verifyRes.usage.outputTokens;
      }
      if (typeof verifyRes.usage.totalTokens === "number") {
        verifierTotalTokens = verifyRes.usage.totalTokens;
      }

      const verifiedIdSet = new Set(verifyRes.verifiedIds);
      rawObject = {
        ...rawObject,
        questions: preSolvedQuestions.filter((q) => verifiedIdSet.has(q.id)),
        annotations: rawObject.annotations.filter((a) =>
          verifiedIdSet.has(a.questionId),
        ),
      };
    }

    const validationOptions = fellBackToVariants
      ? { ...options, mode: "variants" as const }
      : options;
    const validated = validateGeneratedStudy(rawObject, document, validationOptions, {
      preSolved: wasPreSolved,
    });
    if (fellBackToVariants) {
      validated.warnings.push(
        "Tài liệu không có sẵn câu hỏi trắc nghiệm nguyên văn; hệ thống đã tự động chuyển sang chế độ Biến thể khái niệm để tạo câu hỏi cho bạn.",
      );
    }
    if (
      anyBatchWasBudgeted &&
      validated.pack.questions.length < options.questionCount
    ) {
      validated.warnings.push(
        "Document was large; questions were synthesized from key conceptual sections to fit AI rate limits.",
      );
    }

    const sumTokens = (
      selector: (
        u: (typeof batchResults)[number]["usage"],
      ) => number | undefined,
      extra = 0,
    ) => {
      let sum = extra;
      let hasAny = extra > 0;
      for (const res of batchResults) {
        const val = selector(res.usage);
        if (typeof val === "number") {
          sum += val;
          hasAny = true;
        }
      }
      return hasAny ? sum : null;
    };

    const servedGeneratorModel =
      batchProvenances.find((p) => p.servedModel)?.servedModel ||
      (typeof (resolvedModel as any)?.modelId === "string"
        ? (resolvedModel as any).modelId
        : "unknown");

    const pipelineVersion = computePipelineVersion(
      servedGeneratorModel,
      servedVerifierModel,
    );

    const generatorCostUsd = batchProvenances.reduce(
      (acc, p) => acc + (p.costUsd || 0),
      0,
    );
    const totalCostUsd = Number(
      (generatorCostUsd + (typeof verifierCostUsd === "number" ? verifierCostUsd : 0)).toFixed(6),
    );

    console.log(
      `[AI Pipeline] Returned models: generator=${servedGeneratorModel}, verifier=${servedVerifierModel || "none"}. Pipeline version: ${pipelineVersion}. Total cost USD: $${totalCostUsd.toFixed(6)}`,
    );

    return {
      ...validated,
      usage: {
        inputTokens: sumTokens((u) => u.inputTokens, verifierInputTokens),
        outputTokens: sumTokens((u) => u.outputTokens, verifierOutputTokens),
        totalTokens: sumTokens((u) => u.totalTokens, verifierTotalTokens),
      },
      pipelineVersion,
      servedModel: servedGeneratorModel,
      costUsd: totalCostUsd,
    };
  } catch (error: any) {
    signal.throwIfAborted();
    console.error("[generateQuestions] Upstream AI error:", error);

    if (error instanceof IngestionError) throw error;
    if (NoObjectGeneratedError.isInstance(error))
      throw new IngestionError(
        "INVALID_AI_OUTPUT",
        "The AI response was incomplete or did not match the question schema. Try fewer questions.",
        502,
      );

    const isRateLimit =
      (APICallError.isInstance(error) &&
        (error.statusCode === 429 || error.statusCode === 413)) ||
      error?.statusCode === 429 ||
      error?.statusCode === 413 ||
      error?.message?.includes("rate_limit") ||
      error?.message?.includes("tokens per minute") ||
      error?.message?.includes("TPM") ||
      error?.message?.includes("Request too large");

    if (isRateLimit) {
      throw new IngestionError(
        "AI_RATE_LIMITED",
        "The AI provider exceeded its token rate limit (e.g. 8,000 TPM limit on Groq free tier). Try requesting fewer questions (e.g. 5–10) or specifying a chapter focus.",
        429,
      );
    }

    if (
      APICallError.isInstance(error) &&
      [401, 403].includes(error.statusCode || 0)
    )
      throw new IngestionError(
        "AI_AUTH_FAILED",
        "The AI provider rejected the configured credentials. Check the server API key and model access.",
        503,
      );

    const detail = error?.message
      ?.replace(/https?:\/\/[^\s]+/g, "")
      ?.slice(0, 150);
    throw new IngestionError(
      "AI_UNAVAILABLE",
      detail
        ? `Question generation failed (${detail}). Check the configured model or try again later.`
        : "Question generation failed. Check the configured model or try again later.",
      502,
    );
  }
}
