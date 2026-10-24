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
import { getGenerationModel, getGroqModel } from "./provider";
import { buildIngestionPrompt, ingestionSystemPrompt } from "./prompts";
import { budgetSourceBlocks } from "./budget-sources";
import { repairCorruptedLatex } from "@/lib/math/latex";

// Providers accept homogeneous JSON arrays. Convert to the strict tuple contract
// only after generation, without weakening the game's QuestionItem schema.
const fields = {
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(500)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(2000),
};
export const generatedStudySchema = z
  .object({
    title: z.string().min(1).max(120),
    sourceKind: z.enum(["testbank", "lecture", "mixed"]),
    questions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            ...fields,
            conceptVariant: z.object(fields).strict(),
          })
          .strict(),
      )
      .max(30),
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
          })
          .strict(),
      )
      .max(30),
    warnings: z.array(z.string().min(1).max(500)).max(10),
  })
  .strict();

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

export function validateGeneratedStudy(
  raw: unknown,
  document: ParsedDocument,
  options: IngestionOptions,
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
      "The source could not support questions with these settings. Try a broader focus, concept variants, or a different document.",
      422,
    );
  const bank = questionBankSchema.safeParse(output.questions);
  if (!bank.success || output.questions.length > options.questionCount)
    return badOutput(
      "The AI returned duplicate IDs or an unexpected question count. Please retry.",
    );
  const questions = bank.data;
  if (
    output.annotations.length !== questions.length ||
    new Set(output.annotations.map((a) => a.questionId)).size !==
      questions.length
  )
    return badOutput(
      "The AI did not provide one source reference per question. Please retry.",
    );
  const metadata: StudyPack["metadata"] = Object.create(null);
  const references: Record<string, SourceReference> = Object.create(null);
  const sources = new Map(
    document.sources.map((source) => [source.id, source]),
  );
  const annotations = new Map(output.annotations.map((a) => [a.questionId, a]));
  const entireSource = normalize(
    document.sources.map((source) => source.text).join("\n"),
  );
  for (const question of questions) {
    const annotation = annotations.get(question.id);
    if (!annotation || normalize(annotation.excerpt).length < 12) {
      return badOutput(
        "A generated citation could not be verified against the uploaded text. Please retry.",
      );
    }

    let source = sources.get(annotation.sourceId);
    if (!source) {
      // In multi-document ingestion, match by prefix or suffix (e.g. doc0_page-1 vs page-1)
      source = [...sources.values()].find(
        (s) =>
          s.id === `doc0_${annotation.sourceId}` ||
          s.id.endsWith(`_${annotation.sourceId}`),
      );
    }

    if (!source) {
      return badOutput(
        "A generated citation could not be verified against the uploaded text. Please retry.",
      );
    }

    if (!matchesText(source.text, annotation.excerpt)) {
      // 1. Check if another single source block matches
      const alternate = document.sources.find((s) =>
        matchesText(s.text, annotation.excerpt),
      );
      if (alternate) {
        source = alternate;
        annotation.sourceId = alternate.id;
      } else {
        // 2. Check adjacent blocks (cross-page / cross-slide quote)
        const adjacentMatch = findAdjacentSourceMatch(
          document.sources,
          annotation.excerpt,
        );
        if (adjacentMatch) {
          source = adjacentMatch;
          annotation.sourceId = adjacentMatch.id;
        } else if (matchesText(entireSource, annotation.excerpt)) {
          // 3. Match found across document text
          const bestSource = findSourceWithMaxOverlap(
            document.sources,
            annotation.excerpt,
          );
          if (bestSource) {
            source = bestSource;
            annotation.sourceId = bestSource.id;
          } else {
            return badOutput(
              "A generated citation could not be verified against the uploaded text. Please retry.",
            );
          }
        } else {
          return badOutput(
            "A generated citation could not be verified against the uploaded text. Please retry.",
          );
        }
      }
    }
    for (const version of [question, question.conceptVariant]) {
      if (
        new Set(
          version.options.map((option) =>
            normalize(option).toLocaleLowerCase(),
          ),
        ).size !== 4
      )
        return badOutput(
          "The AI returned duplicate answer choices. Please retry.",
        );
    }
    if (
      normalize(question.question) ===
      normalize(question.conceptVariant.question)
    )
      return badOutput(
        "The AI repeated a question instead of creating a concept variant. Please retry.",
      );
    if (
      options.mode === "exact" &&
      [question.question, ...question.options].some(
        (text) => !matchesText(entireSource, text),
      )
    )
      return badOutput(
        "Exact mode returned wording that does not match the source. Please retry or choose concept variants.",
      );
    if (!source) {
      return badOutput(
        "A generated citation could not be verified against the uploaded text. Please retry.",
      );
    }

    // Own the IDs instead of using model-provided object keys in the game state.
    const safeId = `q-${Object.keys(metadata).length + 1}`;
    question.id = safeId;
    question.explanation = repairCorruptedLatex(question.explanation);
    if (question.conceptVariant) {
      question.conceptVariant.explanation = repairCorruptedLatex(
        question.conceptVariant.explanation,
      );
    }
    metadata[safeId] = {
      topic: annotation.topic,
      chapter: annotation.chapter,
      citation: `${document.fileName} · ${source.label}`,
      rule: repairCorruptedLatex(annotation.rule),
    };
    references[safeId] = {
      sourceId: source.id,
      label: source.label,
      excerpt: annotation.excerpt,
    };
  }
  const warnings = [...output.warnings];
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

const MAX_QUESTIONS_PER_BATCH = 10;

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
  if (batchCount <= 1 || sources.length <= 1) {
    return Array.from({ length: batchCount }, () => sources);
  }
  return Array.from({ length: batchCount }, (_, batchIndex) => {
    const start = Math.floor((batchIndex * sources.length) / batchCount);
    const end = Math.max(
      start + 1,
      Math.floor(((batchIndex + 1) * sources.length) / batchCount),
    );
    const slice = sources.slice(start, end);
    return slice.length > 0 ? slice : sources;
  });
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

  batches.forEach((batch, batchIdx) => {
    for (const w of batch.warnings) {
      if (warningSet.size < 10) warningSet.add(w);
    }
    const annotationMap = new Map(
      batch.annotations.map((a) => [a.questionId, a]),
    );
    for (const q of batch.questions) {
      if (mergedQuestions.length >= maxQuestions) break;
      const normQuestion = stripPunctuation(q.question);
      if (!normQuestion || seenQuestions.has(normQuestion)) continue;
      const ann = annotationMap.get(q.id);
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
  });

  return {
    title: first?.title || "Study Pack",
    sourceKind: first?.sourceKind || "mixed",
    questions: mergedQuestions,
    annotations: mergedAnnotations,
    warnings: Array.from(warningSet).slice(0, 10),
  };
}

export async function generateQuestions(
  document: ParsedDocument,
  options: IngestionOptions,
  signal: AbortSignal,
  model?: LanguageModel,
): Promise<GenerationResult> {
  const resolvedModel = model ?? getGenerationModel();

  // Budget source blocks so the prompt stays safely within AI rate limits (e.g. Groq 8k TPM)
  const budget = budgetSourceBlocks(document.sources, 14_000, options.focus);

  // Give full 8,192 token output capacity for Gemini (preventing finishReason: 'length' truncation),
  // while capping at 1,000 only when strictly on Groq free tier.
  const isGroq = Boolean(process.env.GROQ_API_KEY && process.env.AI_PROVIDER === "groq");
  const maxOutputTokens = isGroq ? 1_000 : 8_192;

  const runBatch = async (
    batchSources: SourceBlock[],
    batchQuestionCount: number,
    batchIndex: number,
    totalBatches: number,
  ) => {
    const batchDoc: ParsedDocument = {
      ...document,
      sources: batchSources,
    };
    const batchFocus =
      totalBatches > 1
        ? [
            options.focus,
            `Section batch ${batchIndex + 1} of ${totalBatches}: focus on distinct concepts from these source blocks.`,
          ]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 300)
        : options.focus;
    const batchOptions: IngestionOptions = {
      ...options,
      questionCount: batchQuestionCount,
      focus: batchFocus,
    };
    const batchPrompt = buildIngestionPrompt(batchDoc, batchOptions);

    const fallback = getGroqModel();
    const canFallback = Boolean(fallback && resolvedModel !== fallback);

    try {
      if (canFallback) {
        const isLocal = Boolean(
          process.env.AI_PROVIDER === "local" || process.env.AI_PROVIDER === "ollama",
        );
        const primaryTimeoutMs = isLocal ? 90_000 : 22_000;
        const primaryTimeout = new AbortController();
        const timer = setTimeout(
          () => primaryTimeout.abort(new DOMException("Primary model timed out", "TimeoutError")),
          primaryTimeoutMs,
        );
        const primarySignal = AbortSignal.any([signal, primaryTimeout.signal]);
        try {
          return await generateObject({
            model: resolvedModel,
            schema: generatedStudySchema,
            system: ingestionSystemPrompt,
            prompt: batchPrompt,
            abortSignal: primarySignal,
            maxRetries: 0,
            maxOutputTokens,
          });
        } finally {
          clearTimeout(timer);
        }
      }

      return await generateObject({
        model: resolvedModel,
        schema: generatedStudySchema,
        system: ingestionSystemPrompt,
        prompt: batchPrompt,
        abortSignal: signal,
        maxRetries: 0,
        maxOutputTokens,
      });
    } catch (primaryErr: any) {
      if (canFallback && fallback) {
        console.warn(
          `[generateQuestions] Primary AI model failed (${primaryErr?.message || primaryErr}). Instant auto-failover to Groq LPU...`,
        );
        return await generateObject({
          model: fallback,
          schema: generatedStudySchema,
          system: ingestionSystemPrompt,
          prompt: batchPrompt,
          abortSignal: signal,
          maxRetries: 0,
          maxOutputTokens: 1_000,
        });
      }
      throw primaryErr;
    }
  };

  try {
    const batchCounts = splitIntoBatchCounts(options.questionCount);
    const sourcePartitions = partitionSourcesAcrossBatches(
      budget.sources,
      batchCounts.length,
    );

    const batchResults = await Promise.all(
      batchCounts.map((count, idx) =>
        runBatch(sourcePartitions[idx], count, idx, batchCounts.length),
      ),
    );

    const rawObject =
      batchResults.length === 1
        ? batchResults[0].object
        : mergeAndDeduplicateBatches(
            batchResults.map((r) => r.object),
            options.questionCount,
          );

    const validated = validateGeneratedStudy(rawObject, document, options);
    if (budget.wasBudgeted) {
      validated.warnings.push(
        "Document was large; questions were synthesized from key conceptual sections to fit AI rate limits.",
      );
    }

    const sumTokens = (
      selector: (u: (typeof batchResults)[number]["usage"]) => number | undefined,
    ) => {
      let sum = 0;
      let hasAny = false;
      for (const res of batchResults) {
        const val = selector(res.usage);
        if (typeof val === "number") {
          sum += val;
          hasAny = true;
        }
      }
      return hasAny ? sum : null;
    };

    return {
      ...validated,
      usage: {
        inputTokens: sumTokens((u) => u.inputTokens),
        outputTokens: sumTokens((u) => u.outputTokens),
        totalTokens: sumTokens((u) => u.totalTokens),
      },
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
      (APICallError.isInstance(error) && (error.statusCode === 429 || error.statusCode === 413)) ||
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

    const detail = error?.message?.replace(/https?:\/\/[^\s]+/g, "")?.slice(0, 150);
    throw new IngestionError(
      "AI_UNAVAILABLE",
      detail
        ? `Question generation failed (${detail}). Check the configured model or try again later.`
        : "Question generation failed. Check the configured model or try again later.",
      502,
    );
  }
}
