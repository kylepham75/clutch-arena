import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { generateQuestions } from "@/lib/ai/generate-questions";
import {
  getGenerationModel,
  estimateTokenCount,
  HAIKU_TOKEN_CLIFF_THRESHOLD,
} from "@/lib/ai/provider";
import { IngestionError } from "./errors";
import { parseMultiDocuments } from "./parse-multi-documents";
import { readMultiUpload } from "./read-multi-upload";
import { REQUEST_TIMEOUT_MS } from "./limits";
import { isAllowedOrigin } from "@/lib/utils";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import {
  checkRateLimit,
  getClientIp,
  computeContentHash,
  getSharedDeckCache,
  setSharedDeckCache,
  sampleQuestionsFromCachedPool,
  checkAndReserveDeckQuota,
  recordDeckGenerationCogs,
  rollbackDeckQuotaReservation,
} from "@/lib/rate-limit";
import type { GenerationResult } from "@/lib/schemas/ingestion";

export const MULTI_SHARED_CACHE_PIPELINE_VERSION = "v1";
export const SHARED_CACHE_PIPELINE_VERSION = MULTI_SHARED_CACHE_PIPELINE_VERSION;

function stripDistractorRationale<T extends Record<string, any>>(q: T): T {
  if (!q || typeof q !== "object") return q;
  const { distractorRationale: _d, ...restQ } = q as any;
  if (restQ.conceptVariant && typeof restQ.conceptVariant === "object") {
    const { distractorRationale: _cvD, ...restVariant } = restQ.conceptVariant;
    restQ.conceptVariant = restVariant;
  }
  return restQ as T;
}

function questionHasDistractorRationale(q: any, metadata?: Record<string, any>): boolean {
  if (!q) return false;
  if (typeof q.distractorRationale === "string" && q.distractorRationale.trim().length > 0) {
    return true;
  }
  if (
    typeof q.conceptVariant?.distractorRationale === "string" &&
    q.conceptVariant.distractorRationale.trim().length > 0
  ) {
    return true;
  }
  if (metadata && q.id && metadata[q.id]) {
    const meta = metadata[q.id];
    if (typeof meta?.distractorRationale === "string" && meta.distractorRationale.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function isDegradedCachedDeck(cachedDeck: any, requestedCount: number): boolean {
  if (!cachedDeck) return true;
  const pool = Array.isArray(cachedDeck.questionPool) ? cachedDeck.questionPool : [];
  if (pool.length === 0) return true;
  if (pool.length < requestedCount) return true;

  const metadata = cachedDeck.studyMetadata?.pack?.metadata;
  const hasRationaleInPool = pool.some((q: any) => questionHasDistractorRationale(q, metadata));
  if (hasRationaleInPool) return false;

  if (Array.isArray(cachedDeck.studyMetadata?.pack?.questions)) {
    const hasRationaleInPack = cachedDeck.studyMetadata.pack.questions.some(
      (q: any) => questionHasDistractorRationale(q, metadata),
    );
    if (hasRationaleInPack) return false;
  }

  if (metadata && typeof metadata === "object") {
    const anyMetaHasRationale = Object.values(metadata).some(
      (m: any) => typeof m?.distractorRationale === "string" && m.distractorRationale.trim().length > 0,
    );
    if (anyMetaHasRationale) return false;
  }

  return true;
}

function getQuotaExceededMessage(reason?: string): string {
  switch (reason) {
    case "DAILY_BURST_EXCEEDED":
      return "Daily deck generation burst limit reached. Please try again tomorrow or study from your unlocked decks.";
    case "DECK_CREDITS_EXCEEDED":
      return "You have used all new deck credits for your current plan. Upgrade your plan to unlock more decks.";
    case "COGS_CEILING_EXCEEDED":
      return "Subscription deck generation budget reached for this period. Cached class decks remain free and accessible.";
    case "REGENERATION_LIMIT_EXCEEDED":
      return "Maximum free regenerations reached for this document.";
    default:
      return "Deck generation quota exceeded. Please try again later or upgrade your plan.";
  }
}

export function createMultiIngestionHandler(
  dependencies: {
    generate?: typeof generateQuestions;
    checkConfiguration?: () => void;
    rateLimiter?: typeof checkRateLimit;
    verifyAuth?: typeof verifyAuthToken;
    quotaReservation?: typeof checkAndReserveDeckQuota;
    recordCogs?: typeof recordDeckGenerationCogs;
    getDeckCache?: typeof getSharedDeckCache;
    setDeckCache?: typeof setSharedDeckCache;
    rollbackQuota?: typeof rollbackDeckQuotaReservation;
  } = {},
) {
  const generate = dependencies.generate ?? generateQuestions;
  const checkConfiguration =
    dependencies.checkConfiguration ??
    (() => {
      getGenerationModel();
    });
  const rateLimiter = dependencies.rateLimiter ?? checkRateLimit;
  const verifyAuth = dependencies.verifyAuth ?? verifyAuthToken;
  const quotaReservation = dependencies.quotaReservation ?? checkAndReserveDeckQuota;
  const recordCogs = dependencies.recordCogs ?? recordDeckGenerationCogs;
  const getDeckCache = dependencies.getDeckCache ?? getSharedDeckCache;
  const setDeckCache = dependencies.setDeckCache ?? setSharedDeckCache;
  const rollbackQuota = dependencies.rollbackQuota ?? rollbackDeckQuotaReservation;
  let active = 0;

  return async function POST(request: Request) {
    const requestId = randomUUID();
    let quotaReserved = false;
    let reservedActor: string | null = null;
    let reservedTier: any = null;
    let reservedContentHash: string | null = null;
    let reservedCost = 0.02;
    let reservedIsRegeneration = false;
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-ID": requestId,
          ...(status === 429 ? { "Retry-After": "30" } : {}),
        },
      });

    if (active >= 2) {
      return json(
        {
          ok: false,
          requestId,
          error: {
            code: "INGESTION_BUSY",
            message: "Two ingestion batches are already processing. Try again shortly.",
          },
        },
        429,
      );
    }

    active++;
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(new DOMException("Request timed out", "TimeoutError")),
      REQUEST_TIMEOUT_MS * 2.5,
    );
    const signal = AbortSignal.any([request.signal, timeout.signal]);

    try {
      const origin = request.headers.get("origin");
      if (!isAllowedOrigin(origin, request)) {
        throw new IngestionError(
          "ORIGIN_NOT_ALLOWED",
          "Upload from this application’s origin.",
          403,
        );
      }

      const auth = await verifyAuth(request);
      const { files, options } = await readMultiUpload(request, signal);
      const clientIp = getClientIp(request);
      const rateLimitKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
      const isPaid =
        auth.tier === "cram_pass" ||
        auth.tier === "pro_monthly" ||
        auth.tier === "pro" ||
        auth.tier === "tutor";

      const enforceTier = !(
        process.env.NODE_ENV === "test" && dependencies.verifyAuth === undefined
      );

      if (enforceTier && !isPaid) {
        return json(
          {
            ok: false,
            requestId,
            error: {
              code: "TIER_UPGRADE_REQUIRED",
              message:
                "Multi-document synthesis requires Cram Pass or Season Pro. Free and Guest users can upload 1 document at a time.",
            },
          },
          403,
        );
      }

      const isTestBypass = process.env.NODE_ENV === "test" && dependencies.rateLimiter === undefined;
      if (!isTestBypass) {
        const rateResult = await rateLimiter(rateLimitKey, "ingest", auth.tier);
        if (!rateResult.allowed) {
          return json(
            {
              ok: false,
              requestId,
              error: {
                code: "RATE_LIMIT_EXCEEDED",
                message: `Daily upload limit reached (max ${rateResult.limit} per day). Try again tomorrow.`,
              },
            },
            429,
          );
        }
      }

      if (options.operation === "generate") {
        checkConfiguration();
      }

      const { compositeDocument, documents } = await parseMultiDocuments(files, signal);

      if (options.operation === "preview") {
        return json({
          ok: true,
          requestId,
          operation: "preview",
          document: compositeDocument,
          documents,
        });
      }

      const totalSourceText = compositeDocument.sources.map((s) => s.text).join("\n");
      const estimatedDocTokens = estimateTokenCount(totalSourceText);
      if (!isPaid && estimatedDocTokens > HAIKU_TOKEN_CLIFF_THRESHOLD) {
        return json(
          {
            ok: false,
            requestId,
            error: {
              code: "TIER_UPGRADE_REQUIRED",
              message:
                "This document exceeds the free plan limit. Please buy a 7-Day Cram Pass or upgrade to Pro plan to proceed.",
            },
          },
          403,
        );
      }

      const contentHash =
        compositeDocument.contentHash ||
        computeContentHash({
          normalizedText: compositeDocument.sources.map((s) => s.text).join("\n"),
          pageCount: compositeDocument.pageCount,
          imageHashes: compositeDocument.imageHashes,
        });
      const normalizedFocus = (options.focus || "").trim().toLowerCase();
      const focusHash = normalizedFocus
        ? createHash("sha256").update(normalizedFocus).digest("hex").slice(0, 16)
        : "";

      const isQuotaTestBypass =
        process.env.NODE_ENV === "test" &&
        dependencies.quotaReservation === undefined &&
        dependencies.getDeckCache === undefined &&
        dependencies.setDeckCache === undefined &&
        dependencies.recordCogs === undefined &&
        dependencies.rollbackQuota === undefined;

      const reservedCostUsd =
        auth.tier === "guest" || auth.tier === "contender" ? 0.02 : 0.035;

      if (!isQuotaTestBypass) {
        const cacheLookupKey = {
          contentHash,
          language: options.language,
          mode: options.mode,
          focusHash,
          pipelineVersion: MULTI_SHARED_CACHE_PIPELINE_VERSION,
          fileSha256: compositeDocument.fileSha256 ?? null,
        };

        let cachedDeck = await getDeckCache(cacheLookupKey);
        if (isPaid && cachedDeck && isDegradedCachedDeck(cachedDeck, options.questionCount)) {
          cachedDeck = null;
        }

        if (!cachedDeck || dependencies.quotaReservation !== undefined) {
          const quotaResult = await quotaReservation(
            rateLimitKey,
            auth.tier,
            contentHash,
            {
              ...cacheLookupKey,
              estimatedCostUsd: reservedCostUsd,
            },
          );

          if (!quotaResult.allowed) {
            return json(
              {
                ok: false,
                requestId,
                error: {
                  code: quotaResult.reason ?? "QUOTA_EXCEEDED",
                  message: getQuotaExceededMessage(quotaResult.reason),
                },
              },
              429,
            );
          }

          if (quotaResult.reserved || quotaResult.creditConsumed || quotaResult.isRegeneration) {
            quotaReserved = true;
            reservedActor = rateLimitKey;
            reservedTier = auth.tier;
            reservedContentHash = contentHash;
            reservedCost = reservedCostUsd;
            reservedIsRegeneration = Boolean(quotaResult.isRegeneration);
          }

          if (!cachedDeck && quotaResult.cachedDeck) {
            if (!isPaid || !isDegradedCachedDeck(quotaResult.cachedDeck, options.questionCount)) {
              cachedDeck = quotaResult.cachedDeck;
            }
          }
        }

        if (isPaid && cachedDeck && isDegradedCachedDeck(cachedDeck, options.questionCount)) {
          cachedDeck = null;
        }

        if (
          cachedDeck &&
          Array.isArray(cachedDeck.questionPool) &&
          cachedDeck.questionPool.length > 0
        ) {
          let sampledQuestions = sampleQuestionsFromCachedPool(
            cachedDeck.questionPool,
            options.questionCount,
          );

          let sanitizedStudyMetadata: Record<string, any> | undefined = cachedDeck.studyMetadata
            ? { ...cachedDeck.studyMetadata }
            : undefined;

          if (!isPaid) {
            sampledQuestions = sampledQuestions.map((q) => stripDistractorRationale(q));

            if (sanitizedStudyMetadata?.pack) {
              const packQuestions = Array.isArray(sanitizedStudyMetadata.pack.questions)
                ? sanitizedStudyMetadata.pack.questions
                    .slice(0, sampledQuestions.length)
                    .map((q: any) => stripDistractorRationale(q))
                : sampledQuestions;

              let cleanMetadata = sanitizedStudyMetadata.pack.metadata;
              if (cleanMetadata && typeof cleanMetadata === "object") {
                cleanMetadata = Object.fromEntries(
                  Object.entries(cleanMetadata).map(([k, v]) => {
                    const { distractorRationale: _d, ...cleanMeta } = (v as any) || {};
                    return [k, cleanMeta];
                  }),
                );
              }

              sanitizedStudyMetadata.pack = {
                ...sanitizedStudyMetadata.pack,
                questions: packQuestions,
                ...(cleanMetadata ? { metadata: cleanMetadata } : {}),
              };
            }

            if (cachedDeck.studyMetadata?.pack) {
              cachedDeck.studyMetadata.pack.questions = sampledQuestions;
              if (cachedDeck.studyMetadata.pack.metadata) {
                cachedDeck.studyMetadata.pack.metadata = Object.fromEntries(
                  Object.entries(cachedDeck.studyMetadata.pack.metadata).map(([k, v]) => {
                    const { distractorRationale: _d, ...cleanMeta } = (v as any) || {};
                    return [k, cleanMeta];
                  }),
                );
              }
            }
          } else {
            if (sanitizedStudyMetadata?.pack) {
              sanitizedStudyMetadata.pack = {
                ...sanitizedStudyMetadata.pack,
                questions: sampledQuestions,
              };
            }
            if (cachedDeck.studyMetadata?.pack) {
              cachedDeck.studyMetadata.pack.questions = sampledQuestions;
            }
          }

          const basePack = sanitizedStudyMetadata?.pack ?? {
            id: cachedDeck.id ?? `pack-${contentHash.slice(0, 8)}`,
            title: compositeDocument.fileName,
            subject: "General Study",
            mode: options.mode,
            language: options.language,
            createdAt: cachedDeck.createdAt ?? new Date().toISOString(),
            questions: sampledQuestions,
          };
          const cachedResult: GenerationResult = {
            pack: {
              ...basePack,
              questions: sampledQuestions,
            },
            sourceKind: cachedDeck.studyMetadata?.sourceKind ?? "lecture",
            references: cachedDeck.studyMetadata?.references ?? {},
            warnings: cachedDeck.studyMetadata?.warnings ?? [],
            usage: cachedDeck.studyMetadata?.usage ?? {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          };

          return json({
            ok: true,
            requestId,
            operation: "generate",
            authenticated: auth.authenticated,
            tier: auth.tier,
            document: compositeDocument,
            documents,
            cached: true,
            ...(sanitizedStudyMetadata ? { studyMetadata: sanitizedStudyMetadata } : {}),
            ...cachedResult,
          });
        }
      }

      const result = await generate(
        compositeDocument,
        { ...options, tier: auth.tier },
        signal,
      );
      signal.throwIfAborted();

      if (!isQuotaTestBypass) {
        const allDocs = [compositeDocument, ...documents];
        const visionCostUsd = allDocs.reduce((total, doc) => {
          if (!doc.pageVisionStatus) return total;
          return (
            total +
            Object.values(doc.pageVisionStatus).reduce(
              (sum, info) => sum + (info.costUsd || 0),
              0,
            )
          );
        }, 0);
        const tokenCostUsd =
          typeof result.costUsd === "number" && result.costUsd > 0
            ? result.costUsd
            : result.usage?.totalTokens && result.usage.totalTokens > 0
              ? Math.max(
                  0.000001,
                  Number(((result.usage.totalTokens / 1_000_000) * 0.5).toFixed(6)),
                )
              : reservedCostUsd;
        const actualCostUsd = Number((tokenCostUsd + visionCostUsd).toFixed(6));

        await recordCogs(rateLimitKey, auth.tier, actualCostUsd, reservedCostUsd);
        quotaReserved = false;

        const questionsToStore = result.pack.questions.map((q) => {
          const metaRationale = result.pack.metadata?.[q.id]?.distractorRationale;
          if (metaRationale && !(q as any).distractorRationale) {
            return {
              ...q,
              distractorRationale: metaRationale,
            };
          }
          return q;
        });

        await setDeckCache({
          contentHash,
          fileSha256: compositeDocument.fileSha256 ?? null,
          language: options.language,
          mode: options.mode,
          focusHash,
          pipelineVersion: MULTI_SHARED_CACHE_PIPELINE_VERSION,
          questionPool: questionsToStore,
          studyMetadata: {
            pack: {
              ...result.pack,
              questions: questionsToStore,
            },
            sourceKind: result.sourceKind,
            references: result.references,
            warnings: result.warnings,
            usage: result.usage,
            pipelineVersion: result.pipelineVersion ?? MULTI_SHARED_CACHE_PIPELINE_VERSION,
            costUsd: actualCostUsd,
          },
        });
      }

      return json({
        ok: true,
        requestId,
        operation: "generate",
        authenticated: auth.authenticated,
        tier: auth.tier,
        document: compositeDocument,
        documents,
        ...result,
      });
    } catch (error) {
      if (quotaReserved && reservedActor && reservedContentHash) {
        try {
          if (reservedIsRegeneration) {
            await rollbackQuota(
              reservedActor,
              reservedTier,
              reservedContentHash,
              reservedCost,
              reservedIsRegeneration,
            );
          } else {
            await rollbackQuota(
              reservedActor,
              reservedTier,
              reservedContentHash,
              reservedCost,
            );
          }
        } catch (rollbackError) {
          console.error(
            "[MultiIngestionHandler] Failed to rollback deck quota reservation:",
            rollbackError,
          );
        }
      }

      if (timeout.signal.aborted) {
        return json(
          {
            ok: false,
            requestId,
            error: {
              code: "INGESTION_TIMEOUT",
              message:
                "Multi-document processing exceeded time limit. Try fewer files or fewer questions.",
            },
          },
          504,
        );
      }
      if (request.signal.aborted) {
        return json(
          {
            ok: false,
            requestId,
            error: {
              code: "REQUEST_CANCELLED",
              message: "The upload was cancelled.",
            },
          },
          499,
        );
      }
      const safeError =
        error instanceof IngestionError
          ? error
          : new IngestionError(
              "INGESTION_FAILED",
              "The documents could not be processed. Please retry.",
              500,
            );
      return json(
        {
          ok: false,
          requestId,
          error: { code: safeError.code, message: safeError.message },
        },
        safeError.status,
      );
    } finally {
      clearTimeout(timer);
      active = Math.max(0, active - 1);
    }
  };
}
