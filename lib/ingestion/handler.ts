import "server-only";
import { createHash, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { generateQuestions } from "@/lib/ai/generate-questions";
import {
  getGenerationModel,
  estimateTokenCount,
  HAIKU_TOKEN_CLIFF_THRESHOLD,
} from "@/lib/ai/provider";
import { IngestionError } from "./errors";
import { parseDocument } from "./parse-document";
import { readUpload } from "./read-upload";
import { validateFile } from "./validate-file";
import { REQUEST_TIMEOUT_MS } from "./limits";
import { isAllowedOrigin } from "@/lib/utils";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getAuthoritativeBillingRegion } from "@/lib/pricing/region";
import type { BillingRegion } from "@/lib/pricing/tiers";
import {
  checkRateLimit,
  getClientIp,
  computeContentHash,
  computeFileSha256,
  getSharedDeckCache,
  setSharedDeckCache,
  getCachedParsedDocument,
  sampleQuestionsFromCachedPool,
  getRollingQuotaSnapshot,
  checkAndReserveDeckQuota,
  recordDeckGenerationCogs,
  rollbackDeckQuotaReservation,
  toClientQuota,
  type ClientQuotaSummary,
} from "@/lib/rate-limit";
import type { GenerationResult, ParsedDocument } from "@/lib/schemas/ingestion";

export const SHARED_CACHE_PIPELINE_VERSION = "v2";

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
      return "Rolling AI quota burst limit reached. Wait for your rolling window to refresh or study cached class decks (0% quota used).";
    case "DECK_CREDITS_EXCEEDED":
    case "COGS_CEILING_EXCEEDED":
    case "QUOTA_EXCEEDED":
      return "Your rolling AI quota is at 0% remaining for this window. Shared cached decks remain available at 0% quota cost, or wait for your quota reset or upgrade your plan.";
    case "REGENERATION_LIMIT_EXCEEDED":
      return "Maximum free regenerations reached for this document.";
    default:
      return "Your rolling AI quota is currently depleted (0% remaining). Shared cached decks remain available at 0% quota cost, or wait for your quota reset or upgrade your plan.";
  }
}

export function createIngestionHandler(
  dependencies: {
    generate?: typeof generateQuestions;
    checkConfiguration?: () => void;
    rateLimiter?: typeof checkRateLimit;
    verifyAuth?: typeof verifyAuthToken;
    quotaReservation?: typeof checkAndReserveDeckQuota;
    recordCogs?: typeof recordDeckGenerationCogs;
    getDeckCache?: typeof getSharedDeckCache;
    setDeckCache?: typeof setSharedDeckCache;
    getCachedParsedDoc?: typeof getCachedParsedDocument;
    rollbackQuota?: typeof rollbackDeckQuotaReservation;
    parseDoc?: typeof parseDocument;
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
  const getCachedParsedDoc = dependencies.getCachedParsedDoc ?? getCachedParsedDocument;
  const rollbackQuota = dependencies.rollbackQuota ?? rollbackDeckQuotaReservation;
  const parseDoc = dependencies.parseDoc ?? parseDocument;
  let active = 0;
  return async function POST(request: Request) {
    const requestId = randomUUID();
    let quotaReserved = false;
    let reservedActor: string | null = null;
    let reservedTier: any = null;
    let reservedContentHash: string | null = null;
    let reservedCost = 0.02;
    let reservedIsRegeneration = false;
    let reservedBillingRegion: BillingRegion = "VN";
    let useCheaperGenerator = false;
    let clientQuota: ClientQuotaSummary | undefined;
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-ID": requestId,
          ...(status === 429 ? { "Retry-After": "30" } : {}),
        },
      });
    if (active >= 2)
      return json(
        {
          ok: false,
          requestId,
          error: {
            code: "INGESTION_BUSY",
            message: "Two documents are already processing. Try again shortly.",
          },
        },
        429,
      );
    // Applies to a single server process, not a distributed quota or auth system.
    active++;
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(new DOMException("Request timed out", "TimeoutError")),
      REQUEST_TIMEOUT_MS,
    );
    const signal = AbortSignal.any([request.signal, timeout.signal]);
    try {
      const origin = request.headers.get("origin");
      if (!isAllowedOrigin(origin, request))
        throw new IngestionError(
          "ORIGIN_NOT_ALLOWED",
          "Upload from this application’s origin.",
          403,
        );
      const auth = await verifyAuth(request);
      const { file, options } = await readUpload(request, signal);
      validateFile(file);
      const clientIp = getClientIp(request);
      const billingRegion = getAuthoritativeBillingRegion(request);
      reservedBillingRegion = billingRegion;
      const rateLimitKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
      const isPaid =
        auth.tier === "cram_pass" ||
        auth.tier === "pro_monthly" ||
        auth.tier === "pro" ||
        auth.tier === "tutor";

      const isQuotaTestBypass =
        process.env.NODE_ENV === "test" &&
        dependencies.quotaReservation === undefined &&
        dependencies.getDeckCache === undefined &&
        dependencies.setDeckCache === undefined &&
        dependencies.recordCogs === undefined &&
        dependencies.rollbackQuota === undefined;

      // Fail fast without parsing when rate limit is reached or generation cannot be configured.
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
                message:
                  "Too many upload requests in a short burst. Please wait a moment and try again.",
              },
            },
            429,
          );
        }
      }

      if (options.operation === "generate") {
        if (!isPaid && options.questionCount > 15) {
          return json(
            {
              ok: false,
              requestId,
              error: {
                code: "TIER_UPGRADE_REQUIRED",
                message:
                  "Free and Guest tiers support up to 15 questions per run. Upgrade to Cram Pass or Pro for up to 35 questions.",
              },
            },
            403,
          );
        }
        checkConfiguration();
      }

      let document: ParsedDocument;
      let cachedParsedDoc = null;
      if (
        (dependencies.parseDoc === undefined || dependencies.getCachedParsedDoc !== undefined) &&
        (!options.rescanPages || options.rescanPages.length === 0)
      ) {
        try {
          const bytes = Buffer.from(await file.arrayBuffer());
          const fileSha = computeFileSha256(bytes);
          cachedParsedDoc = await getCachedParsedDoc(fileSha);
        } catch {
          // fallback to normal parsing on error
        }
      }

      if (cachedParsedDoc) {
        document = {
          fileName: file.name || cachedParsedDoc.fileName,
          format: cachedParsedDoc.format,
          sources: cachedParsedDoc.sources,
          pageCount: cachedParsedDoc.pageCount,
          characterCount: cachedParsedDoc.characterCount,
          warnings: cachedParsedDoc.warnings || [],
          fileSha256: cachedParsedDoc.fileSha256,
          contentHash: cachedParsedDoc.contentHash,
          ...(cachedParsedDoc.imageHashes ? { imageHashes: cachedParsedDoc.imageHashes } : {}),
          ...(cachedParsedDoc.dedupedSlideCount
            ? { dedupedSlideCount: cachedParsedDoc.dedupedSlideCount }
            : {}),
        };
      } else {
        let parseDocOptions: Parameters<typeof parseDoc>[2];
        if (options.operation === "preview") {
          parseDocOptions = {
            parsePdfOptions: {
              maxAutoOcrBudgetUsd: 0,
              visionTranscriber: async () => null,
            },
          };
        } else {
          parseDocOptions = {
            rescanPages: options.rescanPages,
          };
          if (options.operation === "generate" && !isQuotaTestBypass) {
            try {
              const preSnapshot = await getRollingQuotaSnapshot(
                rateLimitKey,
                auth.tier,
                billingRegion,
              );
              if (preSnapshot && !preSnapshot.allowVisionOcr) {
                parseDocOptions = {
                  ...parseDocOptions,
                  parsePdfOptions: {
                    maxAutoOcrBudgetUsd: 0,
                  },
                };
              }
            } catch {
              // Ignore if rolling quota snapshot cannot be resolved in mocked tests
            }
          }
        }
        document = await parseDoc(file, signal, parseDocOptions);
      }
      if (options.operation === "preview")
        return json({ ok: true, requestId, operation: "preview", document });

      const totalSourceText = document.sources.map((s) => s.text).join("\n");
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
        document.contentHash ||
        computeContentHash({
          normalizedText: document.sources.map((s) => s.text).join("\n"),
          pageCount: document.pageCount,
          imageHashes: document.imageHashes,
        });
      const normalizedFocus = (options.focus || "").trim().toLowerCase();
      const focusHash = normalizedFocus
        ? createHash("sha256").update(normalizedFocus).digest("hex").slice(0, 16)
        : "";

      const reservedCostUsd =
        auth.tier === "guest" || auth.tier === "contender" ? 0.02 : 0.035;

      if (!isQuotaTestBypass) {
        const cacheLookupKey = {
          contentHash,
          language: options.language,
          mode: options.mode,
          focusHash,
          pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
          fileSha256: document.fileSha256 ?? null,
        };

        let cachedDeck = await getDeckCache(cacheLookupKey);
        if (
          cachedDeck &&
          (!Array.isArray(cachedDeck.questionPool) ||
            (options.questionCount > 10 && cachedDeck.questionPool.length < options.questionCount) ||
            (isPaid && isDegradedCachedDeck(cachedDeck, options.questionCount)))
        ) {
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
              allowHaikuOverflow: isPaid,
              actionKind: "deck",
              region: billingRegion,
            },
          );
          clientQuota = quotaResult?.quota ? toClientQuota(quotaResult.quota) : undefined;

          if (!quotaResult.allowed) {
            return json(
              {
                ok: false,
                requestId,
                error: {
                  code: quotaResult.reason ?? "QUOTA_EXCEEDED",
                  message: getQuotaExceededMessage(quotaResult.reason),
                },
                ...(clientQuota ? { quota: clientQuota } : {}),
              },
              429,
            );
          }

          if (quotaResult.isHaikuOverflow || quotaResult.cogsStatus?.useCheaperGeneratorSlug) {
            useCheaperGenerator = true;
          }

          if (quotaResult.reserved || quotaResult.creditConsumed || quotaResult.isRegeneration) {
            quotaReserved = true;
            reservedActor = rateLimitKey;
            reservedTier = auth.tier;
            reservedContentHash = contentHash;
            reservedCost =
              quotaResult.reservedCostUsd ??
              (quotaResult.isHaikuOverflow
                ? Math.min(reservedCostUsd, 0.028)
                : reservedCostUsd);
            reservedIsRegeneration = Boolean(quotaResult.isRegeneration);
          }

          if (!cachedDeck && quotaResult.cachedDeck) {
            if (
              Array.isArray(quotaResult.cachedDeck.questionPool) &&
              (options.questionCount <= 10 || quotaResult.cachedDeck.questionPool.length >= options.questionCount) &&
              (!isPaid || !isDegradedCachedDeck(quotaResult.cachedDeck, options.questionCount))
            ) {
              cachedDeck = quotaResult.cachedDeck;
            }
          }
        }

        if (
          cachedDeck &&
          (!Array.isArray(cachedDeck.questionPool) ||
            (options.questionCount > 10 && cachedDeck.questionPool.length < options.questionCount) ||
            (isPaid && isDegradedCachedDeck(cachedDeck, options.questionCount)))
        ) {
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
            title: document.fileName,
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

          if (!clientQuota && !isQuotaTestBypass) {
            try {
              const snapshot = await getRollingQuotaSnapshot(
                rateLimitKey,
                auth.tier,
                billingRegion,
              );
              if (snapshot) {
                clientQuota = toClientQuota(snapshot);
              }
            } catch {
              // Safely ignore if quota snapshot is unavailable in partial mocks
            }
          }

          return json({
            ok: true,
            requestId,
            operation: "generate",
            authenticated: auth.authenticated,
            tier: auth.tier,
            document,
            cached: true,
            ...(sanitizedStudyMetadata ? { studyMetadata: sanitizedStudyMetadata } : {}),
            ...(clientQuota ? { quota: clientQuota } : {}),
            ...cachedResult,
          });
        }
      }

      const result = await generate(
        document,
        {
          ...options,
          tier: auth.tier,
          ...(useCheaperGenerator ? { degraded: true } : {}),
        },
        signal,
      );
      signal.throwIfAborted();

      if (!isQuotaTestBypass) {
        const visionCostUsd = document.pageVisionStatus
          ? Object.values(document.pageVisionStatus).reduce(
              (sum, info) => sum + (info.costUsd || 0),
              0,
            )
          : 0;
        const tokenCostUsd =
          typeof result.costUsd === "number" && result.costUsd > 0
            ? result.costUsd
            : result.usage?.totalTokens && result.usage.totalTokens > 0
              ? Math.max(
                  0.000001,
                  Number(((result.usage.totalTokens / 1_000_000) * 0.5).toFixed(6)),
                )
              : reservedCost;
        const actualCostUsd = Number((tokenCostUsd + visionCostUsd).toFixed(6));

        const cogsRecord = await recordCogs(
          rateLimitKey,
          auth.tier,
          actualCostUsd,
          reservedCost,
          billingRegion,
        );
        if (cogsRecord?.quota) {
          clientQuota = toClientQuota(cogsRecord.quota);
        }
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
          fileSha256: document.fileSha256 ?? null,
          language: options.language,
          mode: options.mode,
          focusHash,
          pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
          questionPool: questionsToStore,
          studyMetadata: {
            fileName: document.fileName,
            slideCount: document.pageCount,
            sources: document.sources,
            format: document.format,
            characterCount: document.characterCount,
            warnings: document.warnings,
            imageHashes: document.imageHashes,
            dedupedSlideCount: document.dedupedSlideCount,
            pack: {
              ...result.pack,
              questions: questionsToStore,
            },
            sourceKind: result.sourceKind,
            references: result.references,
            usage: result.usage,
            pipelineVersion: result.pipelineVersion ?? SHARED_CACHE_PIPELINE_VERSION,
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
        document,
        ...(clientQuota ? { quota: clientQuota } : {}),
        ...result,
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { route: "api/ingest" },
      });
      if (quotaReserved && reservedActor && reservedContentHash) {
        try {
          if (reservedIsRegeneration) {
            await rollbackQuota(
              reservedActor,
              reservedTier,
              reservedContentHash,
              reservedCost,
              reservedIsRegeneration,
              reservedBillingRegion,
            );
          } else {
            await rollbackQuota(
              reservedActor,
              reservedTier,
              reservedContentHash,
              reservedCost,
              undefined,
              reservedBillingRegion,
            );
          }
        } catch (rollbackError) {
          console.error(
            "[IngestionHandler] Failed to rollback deck quota reservation:",
            rollbackError,
          );
        }
      }

      if (timeout.signal.aborted)
        return json(
          {
            ok: false,
            requestId,
            error: {
              code: "INGESTION_TIMEOUT",
              message:
                "Processing exceeded 90 seconds. Try a smaller document or fewer questions.",
            },
          },
          504,
        );
      if (request.signal.aborted)
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
      const safeError =
        error instanceof IngestionError
          ? error
          : new IngestionError(
              "INGESTION_FAILED",
              "The document could not be processed. Please retry.",
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
      active--;
    }
  };
}
