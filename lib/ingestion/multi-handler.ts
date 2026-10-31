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
} from "@/lib/rate-limit";
import type { GenerationResult } from "@/lib/schemas/ingestion";

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
  let active = 0;

  return async function POST(request: Request) {
    const requestId = randomUUID();
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
        auth.tier === "cram_pass" || auth.tier === "pro" || auth.tier === "tutor";

      if (options.operation === "generate") {
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
        dependencies.recordCogs === undefined;

      const reservedCostUsd =
        auth.tier === "guest" || auth.tier === "contender" ? 0.02 : 0.035;

      if (!isQuotaTestBypass) {
        const cacheLookupKey = {
          contentHash,
          language: options.language,
          mode: options.mode,
          focusHash,
          pipelineVersion: "v1",
          fileSha256: compositeDocument.fileSha256 ?? null,
        };

        let cachedDeck = await getDeckCache(cacheLookupKey);

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

          if (!cachedDeck && quotaResult.cachedDeck) {
            cachedDeck = quotaResult.cachedDeck;
          }
        }

        if (
          cachedDeck &&
          Array.isArray(cachedDeck.questionPool) &&
          cachedDeck.questionPool.length > 0
        ) {
          const sampledQuestions = sampleQuestionsFromCachedPool(
            cachedDeck.questionPool,
            options.questionCount,
          );
          const basePack = cachedDeck.studyMetadata?.pack ?? {
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
        await setDeckCache({
          contentHash,
          fileSha256: compositeDocument.fileSha256 ?? null,
          language: options.language,
          mode: options.mode,
          focusHash,
          pipelineVersion: result.pipelineVersion ?? "v1",
          questionPool: result.pack.questions,
          studyMetadata: {
            pack: result.pack,
            sourceKind: result.sourceKind,
            references: result.references,
            warnings: result.warnings,
            usage: result.usage,
            pipelineVersion: result.pipelineVersion,
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
