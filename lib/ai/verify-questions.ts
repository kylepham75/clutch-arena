import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import {
  assertCrossFamilyVerifier,
  DEFAULT_GENERATOR_SLUG,
  DEFAULT_VERIFIER_SLUG,
  extractOpenRouterProvenance,
  FALLBACK_VERIFIER_SLUG,
  getFallbackVerifierModel,
  getModelFamily,
  getVerifierModel,
} from "@/lib/ai/provider";
import { IngestionError } from "@/lib/ingestion/errors";

// ============================================================================
// Constants & Types
// ============================================================================

export const CONCEPT_VARIANT_ID_SUFFIX = "::conceptVariant";

export function getConceptVariantBlindId(questionId: string): string {
  return `${questionId}${CONCEPT_VARIANT_ID_SUFFIX}`;
}

export interface VerifiableConceptVariantInput {
  question: string;
  options: [string, string, string, string] | readonly string[];
  correctIndex: number;
  explanation?: string;
  quote?: string;
  excerpt?: string;
  financeSpec?: unknown;
  solverComputed?: boolean;
  [key: string]: unknown;
}

export interface VerifiableQuestionInput {
  id: string;
  question: string;
  options: [string, string, string, string] | readonly string[];
  correctIndex: number;
  explanation?: string;
  quote?: string;
  excerpt?: string;
  sourceId?: string;
  sourceText?: string;
  financeSpec?: unknown;
  solverComputed?: boolean;
  conceptVariant?: VerifiableConceptVariantInput;
  [key: string]: unknown;
}

export interface BlindQuestionPayload {
  id: string;
  question: string;
  options: [string, string, string, string];
  sourceText?: string;
}

export interface StripAnswerKeyOptions {
  includeConceptVariants?: boolean;
  sourcesById?: Record<string, string>;
}

// ============================================================================
// Schemas
// ============================================================================

export const blindVerificationVerdictSchema = z.object({
  id: z.string().min(1),
  selectedIndex: z.number().int().min(-1).max(3),
  isAmbiguous: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]).optional().default("high"),
  reason: z.string().trim().max(200),
});

export const blindVerificationBatchSchema = z.object({
  verdicts: z.array(blindVerificationVerdictSchema),
});

export type BlindVerificationVerdict = z.infer<
  typeof blindVerificationVerdictSchema
>;
export type BlindVerificationBatch = z.infer<
  typeof blindVerificationBatchSchema
>;

// ============================================================================
// Keyless Payload Builder
// ============================================================================

function normalizeOptionsTuple(
  options: readonly string[],
): [string, string, string, string] {
  return [
    String(options[0] ?? "").trim(),
    String(options[1] ?? "").trim(),
    String(options[2] ?? "").trim(),
    String(options[3] ?? "").trim(),
  ];
}

/**
 * Strips `correctIndex`, `explanation`, `quote`, `excerpt`, `financeSpec`, and all
 * answer-key metadata so the blind verifier sees ONLY `{ id, question, options }`
 * (plus optional `sourceText` when provided for grounded factual verification).
 */
export function stripAnswerKeyForBlindSolve(
  input: VerifiableQuestionInput | readonly VerifiableQuestionInput[],
  options?: StripAnswerKeyOptions,
): BlindQuestionPayload[] {
  const items = Array.isArray(input) ? input : [input];
  const includeVariants = options?.includeConceptVariants ?? true;
  const sourcesById = options?.sourcesById;
  const payload: BlindQuestionPayload[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = String(item.id || `item-${i}`).trim();
    const rawSourceText =
      typeof item.sourceText === "string" && item.sourceText.trim()
        ? item.sourceText.trim()
        : typeof item.sourceId === "string" &&
            sourcesById &&
            typeof sourcesById[item.sourceId] === "string" &&
            sourcesById[item.sourceId].trim()
          ? sourcesById[item.sourceId].trim()
          : undefined;

    const basePayload: BlindQuestionPayload = {
      id,
      question: String(item.question ?? "").trim(),
      options: normalizeOptionsTuple(item.options),
      ...(rawSourceText ? { sourceText: rawSourceText } : {}),
    };
    payload.push(basePayload);

    if (includeVariants && item.conceptVariant) {
      const variantPayload: BlindQuestionPayload = {
        id: getConceptVariantBlindId(id),
        question: String(item.conceptVariant.question ?? "").trim(),
        options: normalizeOptionsTuple(item.conceptVariant.options),
        ...(rawSourceText ? { sourceText: rawSourceText } : {}),
      };
      payload.push(variantPayload);
    }
  }

  return payload;
}

export function buildBlindVerificationPrompt(
  blindItems: readonly BlindQuestionPayload[],
): string {
  return [
    "You are an independent, adversarial blind exam verifier.",
    "Solve each multiple-choice question below from scratch using ONLY the provided question stem, options (indexed 0, 1, 2, 3), and optional sourceText.",
    "Rules:",
    "1. Select the single best option index (0, 1, 2, or 3). If NO option is valid or the question is unsolvable, set selectedIndex to -1.",
    "2. Set isAmbiguous to true if two or more options are defensible, if none of the options are correct, or if the question stem is underspecified or contradictory.",
    "3. Keep reason concise (at most 200 characters).",
    "",
    "Questions to solve blindly:",
    JSON.stringify(blindItems, null, 2),
  ].join("\n");
}

// ============================================================================
// Silent Drop Filter
// ============================================================================

export interface FilterBlindVerifiedOptions {
  skipSolverComputed?: boolean;
  requireConceptVariantVerdict?: boolean;
}

export interface FilterBlindVerifiedResult<
  T extends VerifiableQuestionInput = VerifiableQuestionInput,
> {
  verifiedQuestions: T[];
  verifiedIds: string[];
  droppedIds: string[];
}

function findVariantVerdict(
  verdictById: Map<string, BlindVerificationVerdict>,
  questionId: string,
): BlindVerificationVerdict | undefined {
  return (
    verdictById.get(getConceptVariantBlindId(questionId)) ??
    verdictById.get(`${questionId}:conceptVariant`) ??
    verdictById.get(`${questionId}#conceptVariant`) ??
    verdictById.get(`${questionId}:variant`) ??
    verdictById.get(`${questionId}#variant`) ??
    verdictById.get(`${questionId}-variant`)
  );
}

/**
 * Silently drops any question where:
 * - The blind solver's `selectedIndex !== question.correctIndex`, OR
 * - `isAmbiguous === true`, OR
 * - If `conceptVariant` was also blind-solved, its `selectedIndex !== question.conceptVariant.correctIndex` or `isAmbiguous === true`.
 */
export function filterBlindVerifiedQuestions<
  T extends VerifiableQuestionInput,
>(
  questions: readonly T[],
  verdicts: readonly BlindVerificationVerdict[],
  options?: FilterBlindVerifiedOptions,
): FilterBlindVerifiedResult<T> {
  const verdictById = new Map<string, BlindVerificationVerdict>();
  for (const verdict of verdicts) {
    verdictById.set(verdict.id, verdict);
  }

  const verifiedQuestions: T[] = [];
  const verifiedIds: string[] = [];
  const droppedIds: string[] = [];

  for (const question of questions) {
    const isBaseSolverComputed =
      Boolean(options?.skipSolverComputed) && question.solverComputed === true;

    if (!isBaseSolverComputed) {
      const baseVerdict = verdictById.get(question.id);
      if (
        !baseVerdict ||
        baseVerdict.isAmbiguous === true ||
        baseVerdict.selectedIndex < 0 ||
        baseVerdict.selectedIndex !== question.correctIndex
      ) {
        droppedIds.push(question.id);
        continue;
      }
    }

    if (question.conceptVariant) {
      const isVariantSolverComputed =
        Boolean(options?.skipSolverComputed) &&
        (question.conceptVariant.solverComputed === true ||
          (question.solverComputed === true &&
            question.conceptVariant.solverComputed !== false));

      if (!isVariantSolverComputed) {
        const variantVerdict = findVariantVerdict(verdictById, question.id);
        if (variantVerdict) {
          if (
            variantVerdict.isAmbiguous === true ||
            variantVerdict.selectedIndex < 0 ||
            variantVerdict.selectedIndex !==
              question.conceptVariant.correctIndex
          ) {
            droppedIds.push(question.id);
            continue;
          }
        } else if (options?.requireConceptVariantVerdict) {
          droppedIds.push(question.id);
          continue;
        }
      }
    }

    verifiedQuestions.push(question);
    verifiedIds.push(question.id);
  }

  return {
    verifiedQuestions,
    verifiedIds,
    droppedIds,
  };
}

// ============================================================================
// Cross-Family Blind Verifier Execution
// ============================================================================

export interface VerifyQuestionsBlindlyOptions {
  generatorSlug?: string;
  verifierSlug?: string;
  fallbackVerifierSlug?: string;
  verifierModel?: LanguageModel;
  fallbackVerifierModel?: LanguageModel;
  sourcesById?: Record<string, string>;
  includeConceptVariants?: boolean;
  requireConceptVariantVerdict?: boolean;
  skipSolverComputed?: boolean;
  allowUnconfiguredSkip?: boolean;
  allowFallbacks?: boolean;
}

export interface BlindVerificationUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface VerifyQuestionsBlindlyResult<
  T extends VerifiableQuestionInput = VerifiableQuestionInput,
> {
  verifiedQuestions: T[];
  verifiedIds: string[];
  droppedIds: string[];
  verdicts: BlindVerificationVerdict[];
  servedVerifierModel: string | null;
  costUsd: number;
  usage: BlindVerificationUsage;
  skipped?: boolean;
}

function selectSafeFallbackVerifierSlug(
  generatorSlug: string,
  explicitFallbackSlug?: string,
): string {
  if (explicitFallbackSlug?.trim()) {
    return explicitFallbackSlug.trim();
  }
  const envFallback = process.env.OPENROUTER_FALLBACK_VERIFIER_MODEL?.trim();
  if (envFallback) {
    return envFallback;
  }

  const genFamily = getModelFamily(generatorSlug);
  const defaultFallbackFamily = getModelFamily(FALLBACK_VERIFIER_SLUG);
  if (genFamily !== defaultFallbackFamily && defaultFallbackFamily !== "anthropic") {
    return FALLBACK_VERIFIER_SLUG;
  }

  // Under no circumstance should a verifier fallback be in the Anthropic family
  if (
    getModelFamily(DEFAULT_VERIFIER_SLUG) !== genFamily &&
    getModelFamily(DEFAULT_VERIFIER_SLUG) !== "anthropic"
  ) {
    return DEFAULT_VERIFIER_SLUG;
  }
  return FALLBACK_VERIFIER_SLUG;
}

export async function verifyQuestionsBlindly<
  T extends VerifiableQuestionInput,
>(
  questions: readonly T[],
  options?: VerifyQuestionsBlindlyOptions,
): Promise<VerifyQuestionsBlindlyResult<T>> {
  const emptyUsage: BlindVerificationUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  if (questions.length === 0) {
    return {
      verifiedQuestions: [],
      verifiedIds: [],
      droppedIds: [],
      verdicts: [],
      servedVerifierModel: null,
      costUsd: 0,
      usage: emptyUsage,
    };
  }

  const generatorSlug =
    options?.generatorSlug?.trim() ||
    process.env.OPENROUTER_GENERATOR_MODEL?.trim() ||
    DEFAULT_GENERATOR_SLUG;

  const verifierSlug =
    options?.verifierSlug?.trim() ||
    process.env.OPENROUTER_VERIFIER_MODEL?.trim() ||
    DEFAULT_VERIFIER_SLUG;

  // Enforce strict cross-family separation between generator and primary verifier
  assertCrossFamilyVerifier(generatorSlug, verifierSlug);

  // Filter out items that do not need LLM verification when skipSolverComputed is enabled
  const questionsForLlm = options?.skipSolverComputed
    ? questions.filter(
        (q) =>
          q.solverComputed !== true ||
          (Boolean(q.conceptVariant) &&
            options?.includeConceptVariants !== false &&
            q.conceptVariant?.solverComputed === false),
      )
    : [...questions];

  if (questionsForLlm.length === 0) {
    return {
      verifiedQuestions: [...questions],
      verifiedIds: questions.map((q) => q.id),
      droppedIds: [],
      verdicts: [],
      servedVerifierModel: null,
      costUsd: 0,
      usage: emptyUsage,
      skipped: true,
    };
  }

  let primaryModel: LanguageModel;
  try {
    primaryModel =
      options?.verifierModel ??
      getVerifierModel({
        generatorSlug,
        modelOverride: verifierSlug,
      });
  } catch (err) {
    if (
      options?.allowUnconfiguredSkip &&
      err instanceof IngestionError &&
      err.code === "AI_NOT_CONFIGURED"
    ) {
      return {
        verifiedQuestions: [...questions],
        verifiedIds: questions.map((q) => q.id),
        droppedIds: [],
        verdicts: [],
        servedVerifierModel: null,
        costUsd: 0,
        usage: emptyUsage,
        skipped: true,
      };
    }
    throw err;
  }

  const blindPayload = stripAnswerKeyForBlindSolve(questionsForLlm, {
    includeConceptVariants: options?.includeConceptVariants,
    sourcesById: options?.sourcesById,
  });
  const prompt = buildBlindVerificationPrompt(blindPayload);

  let rawResult: Awaited<
    ReturnType<typeof generateObject<typeof blindVerificationBatchSchema>>
  >;
  let activeSlug = verifierSlug;
  let activeModel: LanguageModel = primaryModel;

  try {
    rawResult = await generateObject({
      model: primaryModel,
      schema: blindVerificationBatchSchema,
      temperature: 0.0,
      prompt,
    });
  } catch (primaryError) {
    const allowFallbacks =
      options?.allowFallbacks ??
      (options?.fallbackVerifierModel !== undefined);

    if (!allowFallbacks) {
      throw primaryError;
    }

    const fallbackSlug = selectSafeFallbackVerifierSlug(
      generatorSlug,
      options?.fallbackVerifierSlug,
    );
    assertCrossFamilyVerifier(generatorSlug, fallbackSlug);

    if (getModelFamily(fallbackSlug) === "anthropic") {
      throw new IngestionError(
        "CROSS_FAMILY_VIOLATION",
        `Fallback verifier "${fallbackSlug}" is in the Anthropic family. Verifier must never fall back into Anthropic.`,
        400,
      );
    }

    const fallbackModel =
      options?.fallbackVerifierModel ??
      (options?.verifierModel && !options?.fallbackVerifierSlug
        ? undefined
        : getFallbackVerifierModel({
            generatorSlug,
            modelOverride: fallbackSlug,
          }));

    if (!fallbackModel) {
      throw primaryError;
    }

    activeSlug = fallbackSlug;
    activeModel = fallbackModel;
    rawResult = await generateObject({
      model: fallbackModel,
      schema: blindVerificationBatchSchema,
      temperature: 0.0,
      prompt,
    });
  }

  const verdicts = rawResult.object.verdicts;
  const provenance = extractOpenRouterProvenance(rawResult);
  const modelIdFromInstance =
    typeof (activeModel as unknown as { modelId?: unknown })?.modelId ===
    "string"
      ? ((activeModel as unknown as { modelId: string }).modelId || "").trim()
      : null;
  const servedVerifierModel =
    provenance.servedModel || modelIdFromInstance || activeSlug;

  const rawUsage = (rawResult as unknown as { usage?: Record<string, unknown> })
    .usage;
  const inputTokens =
    typeof rawUsage?.inputTokens === "number"
      ? rawUsage.inputTokens
      : typeof rawUsage?.promptTokens === "number"
        ? rawUsage.promptTokens
        : null;
  const outputTokens =
    typeof rawUsage?.outputTokens === "number"
      ? rawUsage.outputTokens
      : typeof rawUsage?.completionTokens === "number"
        ? rawUsage.completionTokens
        : null;
  const totalTokens =
    typeof rawUsage?.totalTokens === "number"
      ? rawUsage.totalTokens
      : inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null;

  const filtered = filterBlindVerifiedQuestions(questions, verdicts, {
    skipSolverComputed: options?.skipSolverComputed,
    requireConceptVariantVerdict: options?.requireConceptVariantVerdict,
  });

  return {
    verifiedQuestions: filtered.verifiedQuestions,
    verifiedIds: filtered.verifiedIds,
    droppedIds: filtered.droppedIds,
    verdicts,
    servedVerifierModel,
    costUsd: provenance.costUsd,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
    },
  };
}
