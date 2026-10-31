import "server-only";
import { createHash, randomUUID } from "node:crypto";
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
      const rateLimitKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
      const isPaid =
        auth.tier === "cram_pass" || auth.tier === "pro" || auth.tier === "tutor";

      // Fail fast without parsing when generation cannot be configured or rate limit is reached.
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
                  message: isPaid
                    ? `Daily upload limit reached (max ${rateResult.limit} per day). Try again tomorrow.`
                    : `Upload limit reached (max ${rateResult.limit} uploads per week on ${auth.tier === "guest" ? "Guest" : "Contender"} tier). Upgrade to Cram Pass or Pro for more uploads.`,
                },
              },
              429,
            );
          }
        }
        checkConfiguration();
      }
      const document = await parseDocument(file, signal, {
        rescanPages: options.rescanPages,
      });
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
          fileSha256: document.fileSha256 ?? null,
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

          return json({
            ok: true,
            requestId,
            operation: "generate",
            authenticated: auth.authenticated,
            tier: auth.tier,
            document,
            cached: true,
            ...cachedResult,
          });
        }
      }

      const result = await generate(
        document,
        { ...options, tier: auth.tier },
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
              : reservedCostUsd;
        const actualCostUsd = Number((tokenCostUsd + visionCostUsd).toFixed(6));

        await recordCogs(rateLimitKey, auth.tier, actualCostUsd, reservedCostUsd);
        await setDeckCache({
          contentHash,
          fileSha256: document.fileSha256 ?? null,
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
        document,
        ...result,
      });
    } catch (error) {
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
