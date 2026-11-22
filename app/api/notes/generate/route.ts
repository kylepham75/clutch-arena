import "@/lib/polyfills/pdf-node-polyfills";
import { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { verifyNotesAccess } from "@/lib/auth/notes-guard";
import { getAuthoritativeBillingRegion } from "@/lib/pricing/region";
import { isPaidTier } from "@/lib/pricing/tiers";
import {
  checkRateLimit,
  withActorQuotaLock,
  resolveActorKey,
  getClientIp,
  computeContentHash,
  computeFileSha256,
  getSharedDeckCache,
  setSharedDeckCache,
  getCachedParsedDocument,
  getRollingQuotaSnapshot,
  toClientQuota,
  checkAndReserveDeckQuota,
  recordDeckGenerationCogs,
  rollbackDeckQuotaReservation,
  type ClientQuotaSummary,
  type RateLimitResult,
} from "@/lib/rate-limit";
import { parseSlideDeck } from "@/lib/notes/parse-slides";
import { generateClutchNote } from "@/lib/ai/generate-notes";
import { normalizePdfMathSymbols } from "@/lib/notes/pdf-symbol-normalizer";
import { deduplicateAnimationSlides } from "@/lib/ingestion/content-hash";
import { buildFormulaInventory } from "@/lib/notes/formula-inventory";
import { IngestionError } from "@/lib/ingestion/errors";
import { isAllowedOrigin } from "@/lib/utils";
import {
  MAX_FILE_BYTES,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PDF_PAGES,
} from "@/lib/ingestion/limits";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  computeNotesV2DeckCogsUsd,
  getNotesV2RoutingBundle,
} from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 300;
// Typed as `never` so Next.js .next/types App Router route-export validation allows importing it in unit tests
export const NOTES_SHARED_CACHE_PIPELINE_VERSION: never = "notes-v2" as never;

const MAX_NOTES_MULTIPART_BYTES = MAX_FILE_BYTES + 512 * 1024;
const MAX_NOTES_JSON_BYTES = 2 * 1024 * 1024;
const NOTES_REQUEST_TIMEOUT_MS = 240_000;
let activeNotesRequests = 0;

async function readBoundedRequestBuffer(
  request: NextRequest,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!request.body) {
    const ab = await request.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new IngestionError(
        "FILE_TOO_LARGE",
        `Request payload exceeds maximum allowed size (${Math.round(maxBytes / (1024 * 1024))}MB).`,
        413,
      );
    }
    return Buffer.from(ab);
  }

  const reader = request.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new IngestionError(
          "FILE_TOO_LARGE",
          `Request payload exceeds maximum allowed size (${Math.round(maxBytes / (1024 * 1024))}MB).`,
          413,
        );
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function getQuotaExceededMessage(reason?: string): string {
  switch (reason) {
    case "DAILY_BURST_EXCEEDED":
      return "Too many note generation requests in a short window. Please wait a moment and try again.";
    case "DECK_CREDITS_EXCEEDED":
    case "COGS_CEILING_EXCEEDED":
    case "QUOTA_EXCEEDED":
      return "AI quota reached for this rolling window. Shared cached notes remain 0% quota and accessible.";
    case "REGENERATION_LIMIT_EXCEEDED":
      return "Maximum free regenerations reached for this document.";
    default:
      return "AI quota reached. Please wait for your rolling window to reset or upgrade your plan.";
  }
}

function createNotesRateLimitResponse(
  requestId: string,
  rateResult: RateLimitResult,
): Response {
  const retryAfter = rateResult.retryAfter ?? 30;
  return Response.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many note requests in a short burst. Please wait a moment and try again.",
        reset: rateResult.reset,
        retryAfter,
      },
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
        "Retry-After": retryAfter.toString(),
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const billingRegion = getAuthoritativeBillingRegion(request);
  let quotaReserved = false;
  let reservedActor: string | null = null;
  let reservedTier: any = null;
  let reservedContentHash: string | null = null;
  let reservedCost = 0.02;
  let reservedIsRegeneration = false;
  let ocrReserved = false;
  let ocrReservedCost = 0;
  let ocrSettled = false;
  let ocrActor: string | null = null;
  let ocrTier: any = null;
  let slotAcquired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new AbortController();
  const signal = AbortSignal.any([request.signal, timeout.signal]);
  let latestQuotaSummary: ClientQuotaSummary | undefined;
  const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
        ...headers,
      },
    });

  try {
    // 1. Origin verification
    const origin = request.headers.get("origin");
    if (!isAllowedOrigin(origin, request)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "Uploads must originate from this application.",
          },
        },
        403,
      );
    }

    // 2. Signed-in access gate (Contender inside 3d rolling % quota + Cram Pass, Pro, Tutor)
    const proAuth = await verifyNotesAccess(request);
    if (!proAuth.authorized) {
      const isUnauthenticated = proAuth.reason === "UNAUTHENTICATED";
      return jsonResponse(
        {
          ok: false,
          error: {
            code: isUnauthenticated ? "UNAUTHENTICATED" : "PRO_SUBSCRIPTION_REQUIRED",
            message:
              proAuth.message ||
              "Authentication required. Please sign in to access Clutch Notes AI.",
            reason: proAuth.reason,
            userTier: proAuth.tier || "free",
          },
        },
        isUnauthenticated ? 401 : 403,
      );
    }

    // 3. User identity, Content-Type & locked burst rate-limit BEFORE reading/buffering body
    const userIdentifier =
      (process.env.NODE_ENV === "test" && request.headers.get("x-test-user-id")) ||
      proAuth.user?.id ||
      `ip:${getClientIp(request)}`;
    const actorKey = resolveActorKey(userIdentifier);
    const isTest = process.env.NODE_ENV === "test" && !request.headers.get("x-enforce-rate-limit");
    const effectiveTier = (proAuth.tier as any) || "pro";
    const notesPipelineVersion: string = isPaidTier(effectiveTier)
      ? (NOTES_SHARED_CACHE_PIPELINE_VERSION as string)
      : "notes-free-v1";
    const enforceQuota =
      !isTest || Boolean(request.headers.get("x-enforce-quota"));

    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");
    const isJson = contentType.includes("application/json");
    if (!isMultipart && !isJson) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "UNSUPPORTED_CONTENT_TYPE",
            message: "Request must be multipart/form-data or application/json.",
          },
        },
        415,
      );
    }

    const maxBodyBytes = isMultipart ? MAX_NOTES_MULTIPART_BYTES : MAX_NOTES_JSON_BYTES;
    const rawContentLength = request.headers.get("content-length");
    if (rawContentLength) {
      const parsedLength = parseInt(rawContentLength, 10);
      if (!isNaN(parsedLength) && parsedLength > maxBodyBytes) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "FILE_TOO_LARGE",
              message: `Slide deck exceeds the maximum allowed size of 25MB (file size: ${(parsedLength / (1024 * 1024)).toFixed(1)}MB).`,
            },
          },
          413,
        );
      }
    }

    // Enforce actor-locked rate limit prior to allocating concurrency slot or reading request streams
    if (isMultipart || !isTest) {
      const rateResult = await withActorQuotaLock(actorKey, () =>
        checkRateLimit(userIdentifier, "notes", effectiveTier),
      );
      if (!rateResult.allowed) {
        return createNotesRateLimitResponse(requestId, rateResult);
      }
    }

    // Per-instance 2-slot concurrency cap + timeout propagation
    if (activeNotesRequests >= 2) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "NOTES_BUSY",
            message: "Two slide decks are already being synthesized. Please try again shortly.",
          },
        },
        429,
        { "Retry-After": "15" },
      );
    }
    activeNotesRequests++;
    slotAcquired = true;
    timer = setTimeout(
      () => timeout.abort(new DOMException("Request timed out", "TimeoutError")),
      NOTES_REQUEST_TIMEOUT_MS,
    );

    let fileName = "lecture-slides.pptx";
    let slideCount = 1;
    let sources: SourceBlock[] = [];
    let warnings: string[] = [];
    let focus: string | undefined;
    let parsedDeck: Awaited<ReturnType<typeof parseSlideDeck>> | undefined;
    let verifiedFileSha256: string | null = null;
    let clientProvidedFileSha256: string | null = null;
    let cachedImageHashes: string[] | undefined;
    let cachedFormulaInventory: any[] | undefined;

    if (isMultipart) {
      const bodyBuffer = await readBoundedRequestBuffer(request, MAX_NOTES_MULTIPART_BYTES, signal);
      let formData: FormData;
      try {
        formData = await new Response(new Uint8Array(bodyBuffer), {
          headers: { "content-type": contentType },
        }).formData();
      } catch {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "INVALID_SLIDES_PAYLOAD",
              message: "Invalid multipart form upload.",
            },
          },
          400,
        );
      }

      const file = formData.get("file");
      const rawFocus = formData.get("focus");
      if (typeof rawFocus === "string" && rawFocus.trim()) {
        focus = rawFocus.trim().slice(0, 300);
      }

      if (!file || !(file instanceof File)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "NO_FILE_PROVIDED",
              message: "Please select a PowerPoint (.pptx) or PDF (.pdf) slide deck to upload.",
            },
          },
          400,
        );
      }

      if (file.size > MAX_FILE_BYTES) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "FILE_TOO_LARGE",
              message: `Slide deck exceeds the maximum allowed size of 25MB (file size: ${(file.size / (1024 * 1024)).toFixed(1)}MB).`,
            },
          },
          413,
        );
      }

      // Pre-check shared deck cache using server-verified binary SHA-256
      const fileBytes = Buffer.from(await file.arrayBuffer());
      const fileSha256 = computeFileSha256(fileBytes);
      verifiedFileSha256 = fileSha256;
      const normalizedFocus = (focus || "").trim().toLowerCase();
      const focusHash = normalizedFocus
        ? createHash("sha256").update(normalizedFocus).digest("hex").slice(0, 16)
        : "";

      const cachedFromStore = await getSharedDeckCache({
        contentHash: "",
        language: "en",
        mode: "notes",
        focusHash,
        pipelineVersion: notesPipelineVersion,
        fileSha256,
        actorKey,
      });

      if (cachedFromStore?.clutchNote) {
        if (enforceQuota) {
          latestQuotaSummary = toClientQuota(
            await getRollingQuotaSnapshot(userIdentifier, effectiveTier, billingRegion),
          );
        }
        return jsonResponse({
          ok: true,
          note: cachedFromStore.clutchNote,
          warnings: [],
          cached: true,
          contentHash: cachedFromStore.contentHash || "",
          fileSha256: cachedFromStore.fileSha256 || fileSha256,
          sources: cachedFromStore.studyMetadata?.sources || [],
          ...(latestQuotaSummary ? { quota: latestQuotaSummary } : {}),
        });
      }

      const cachedParsedDoc = await getCachedParsedDocument(fileSha256, actorKey);
      if (cachedParsedDoc) {
        fileName = file.name || cachedParsedDoc.fileName;
        slideCount = cachedParsedDoc.pageCount ?? cachedParsedDoc.sources.length;
        sources = cachedParsedDoc.sources;
        warnings = cachedParsedDoc.warnings || [];
        cachedImageHashes = cachedParsedDoc.imageHashes;
        cachedFormulaInventory = cachedParsedDoc.formulaInventory;
      } else {
        if (enforceQuota) {
          const preSnapshot = await getRollingQuotaSnapshot(
            userIdentifier,
            effectiveTier,
            billingRegion,
          );
          if (!preSnapshot.allowVisionOcr) {
            parsedDeck = await parseSlideDeck(file, {
              maxAutoOcrBudgetUsd: 0,
              signal,
            });
          } else {
            const ocrHold = await checkAndReserveDeckQuota(
              userIdentifier,
              effectiveTier,
              `ocr:${fileSha256}`,
              {
                actionKind: "ocr",
                estimatedCostUsd: 0.005,
                region: billingRegion,
                bypassCache: true,
              },
            );
            if (!ocrHold.allowed) {
              parsedDeck = await parseSlideDeck(file, {
                maxAutoOcrBudgetUsd: 0,
                signal,
              });
            } else {
              if (ocrHold.reserved) {
                ocrReserved = true;
                ocrReservedCost = ocrHold.reservedCostUsd ?? 0.005;
                ocrActor = userIdentifier;
                ocrTier = effectiveTier;
              }
              parsedDeck = await parseSlideDeck(file, { signal });
            }
          }
        } else {
          parsedDeck = await parseSlideDeck(file, { signal });
        }

        if (ocrReserved && !ocrSettled && ocrActor) {
          const parsedVisionCost = Object.values(parsedDeck?.pageVisionStatus ?? {}).reduce(
            (sum, entry) =>
              sum + (typeof entry?.costUsd === "number" && Number.isFinite(entry.costUsd) ? entry.costUsd : 0),
            0,
          );
          if (parsedVisionCost > 0) {
            await recordDeckGenerationCogs(
              ocrActor,
              ocrTier,
              parsedVisionCost,
              ocrReservedCost,
              billingRegion,
            );
          } else {
            await rollbackDeckQuotaReservation({
              userId: ocrActor,
              tier: ocrTier,
              actionKind: "ocr",
              reservedCostUsd: ocrReservedCost,
              region: billingRegion,
            });
          }
          ocrSettled = true;
          ocrReserved = false;
        }

        fileName = parsedDeck.fileName;
        slideCount = parsedDeck.slideCount;
        sources = parsedDeck.sources;
        warnings = parsedDeck.warnings || [];
      }
    } else {
      const jsonBuffer = await readBoundedRequestBuffer(request, MAX_NOTES_JSON_BYTES, signal);
      let jsonBody: Record<string, any> = {};
      try {
        jsonBody = JSON.parse(jsonBuffer.toString("utf8")) as Record<string, any>;
      } catch {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "INVALID_SLIDES_PAYLOAD",
              message: "Request body is not valid JSON.",
            },
          },
          400,
        );
      }

      fileName =
        typeof jsonBody?.fileName === "string" && jsonBody.fileName.trim()
          ? jsonBody.fileName.trim()
          : "lecture-slides.pdf";

      if (
        typeof jsonBody?.fileSha256 === "string" &&
        /^[a-f0-9]{64}$/i.test(jsonBody.fileSha256.trim())
      ) {
        clientProvidedFileSha256 = jsonBody.fileSha256.trim();
      }

      if (typeof jsonBody?.focus === "string") {
        const trimmed = jsonBody.focus.trim();
        focus = trimmed ? trimmed.slice(0, 300) : undefined;
      } else if (jsonBody?.focus !== undefined && jsonBody?.focus !== null) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "INVALID_SLIDES_PAYLOAD",
              message: "Focus must be a string if provided.",
            },
          },
          400,
        );
      }

      if (Array.isArray(jsonBody?.warnings)) {
        warnings = (jsonBody.warnings as unknown[])
          .filter((w: unknown): w is string => typeof w === "string")
          .slice(0, 20)
          .map((w: string) => w.slice(0, 300));
      }

      if (jsonBody?.sources !== undefined) {
        if (!Array.isArray(jsonBody.sources) || jsonBody.sources.length === 0) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "INVALID_SLIDES_PAYLOAD",
                message: "JSON payload must include slide text or sources.",
              },
            },
            400,
          );
        }

        const isValidSources = jsonBody.sources.every(
          (item: unknown) =>
            Boolean(item) &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as any).label === "string" &&
            typeof (item as any).text === "string" &&
            ((item as any).id === undefined || typeof (item as any).id === "string"),
        );

        if (!isValidSources) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "INVALID_SLIDES_PAYLOAD",
                message: "Each source item must be an object with string label and text.",
              },
            },
            400,
          );
        }

        if (
          jsonBody.sources.length > MAX_PDF_PAGES ||
          (typeof jsonBody.slideCount === "number" && jsonBody.slideCount > MAX_PDF_PAGES)
        ) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "TOO_MANY_PAGES",
                message: `Upload at most ${MAX_PDF_PAGES} slides at a time.`,
              },
            },
            413,
          );
        }

        const totalCharacters = jsonBody.sources.reduce(
          (sum: number, s: any) => sum + s.text.length,
          0,
        );
        if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "TOO_MUCH_TEXT",
                message: `The slide deck exceeds the ${MAX_EXTRACTED_CHARACTERS.toLocaleString()} character limit. Please split it by lecture topic.`,
              },
            },
            413,
          );
        }

        sources = jsonBody.sources.map((s: any, idx: number) => ({
          id: typeof s.id === "string" && s.id.trim() ? s.id.trim() : `slide-${idx + 1}`,
          label: s.label,
          text: normalizePdfMathSymbols(s.text)
            .split("\n")
            .map((line) =>
              line
                .replace(/[\t\v\f\r]+/g, " ")
                .replace(/[\x00-\x08\x0E-\x1F]/g, "")
                .trim(),
            )
            .filter(Boolean)
            .join("\n"),
        }));

        // Deduplicate progressive animation slides for JSON sources
        const dedupeResult = deduplicateAnimationSlides(sources);
        sources = dedupeResult.sources;
        if (dedupeResult.droppedCount > 0) {
          warnings.push(
            `Deduplicated ${dedupeResult.droppedCount} incremental animation slide(s).`,
          );
        }

        slideCount =
          typeof jsonBody.slideCount === "number" && jsonBody.slideCount > 0
            ? (dedupeResult.droppedCount > 0 ? sources.length : jsonBody.slideCount)
            : sources.length;
      } else if (typeof jsonBody?.slidesText === "string" && jsonBody.slidesText.trim()) {
        const trimmedText = jsonBody.slidesText.trim();
        if (trimmedText.length > MAX_EXTRACTED_CHARACTERS) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "TOO_MUCH_TEXT",
                message: `The slide deck exceeds the ${MAX_EXTRACTED_CHARACTERS.toLocaleString()} character limit. Please split it by lecture topic.`,
              },
            },
            413,
          );
        }

        const normalizedText = normalizePdfMathSymbols(trimmedText)
          .split("\n")
          .map((line) =>
            line
              .replace(/[\t\v\f\r]+/g, " ")
              .replace(/[\x00-\x08\x0E-\x1F]/g, "")
              .trim(),
          )
          .filter(Boolean)
          .join("\n");

        sources = [
          {
            id: "slide-1",
            label: "Slide 1",
            text: normalizedText,
          },
        ];
        slideCount = 1;
      } else {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "INVALID_SLIDES_PAYLOAD",
              message: "JSON payload must include slide text or sources.",
            },
          },
          400,
        );
      }
    }

    // 5. Shared deck cache lookup & durable quota reservation
    const contentHash = computeContentHash({
      normalizedText: sources.map((s) => s.text).join("\n"),
      pageCount: slideCount,
      imageHashes: parsedDeck?.imageHashes ?? cachedImageHashes,
    });
    const normalizedFocus = (focus || "").trim().toLowerCase();
    const focusHash = normalizedFocus
      ? createHash("sha256").update(normalizedFocus).digest("hex").slice(0, 16)
      : "";
    const reservedCostUsd =
      effectiveTier === "contender" || effectiveTier === "free" ? 0.015 : 0.02;

    const effectiveFileSha256 =
      verifiedFileSha256 ?? parsedDeck?.fileSha256 ?? clientProvidedFileSha256;
    const isFileSha256Verified = Boolean(verifiedFileSha256 || parsedDeck);

    if (enforceQuota) {
      const cacheLookupKey = {
        contentHash,
        language: "en",
        mode: "notes",
        focusHash,
        pipelineVersion: notesPipelineVersion,
        fileSha256: isFileSha256Verified ? effectiveFileSha256 : null,
        actorKey,
      };

      const cachedFromStore = await getSharedDeckCache(cacheLookupKey);
      if (cachedFromStore?.clutchNote) {
        latestQuotaSummary = toClientQuota(
          await getRollingQuotaSnapshot(userIdentifier, effectiveTier, billingRegion),
        );
        return jsonResponse({
          ok: true,
          note: cachedFromStore.clutchNote,
          warnings,
          cached: true,
          contentHash: cachedFromStore.contentHash || contentHash,
          fileSha256: cachedFromStore.fileSha256 || effectiveFileSha256,
          sources: cachedFromStore.studyMetadata?.sources || sources,
          quota: latestQuotaSummary,
        });
      }

      const quotaResult = await checkAndReserveDeckQuota(
        userIdentifier,
        effectiveTier,
        contentHash,
        {
          ...cacheLookupKey,
          estimatedCostUsd: reservedCostUsd,
          actionKind: "notes",
          region: billingRegion,
        },
      );

      if (quotaResult.cachedDeck?.clutchNote) {
        latestQuotaSummary = toClientQuota(
          quotaResult.quota ??
            (await getRollingQuotaSnapshot(userIdentifier, effectiveTier, billingRegion)),
        );
        return jsonResponse({
          ok: true,
          note: quotaResult.cachedDeck.clutchNote,
          warnings,
          cached: true,
          contentHash: quotaResult.cachedDeck.contentHash || contentHash,
          fileSha256: quotaResult.cachedDeck.fileSha256 || effectiveFileSha256,
          sources: quotaResult.cachedDeck.studyMetadata?.sources || sources,
          quota: latestQuotaSummary,
        });
      }

      if (!quotaResult.allowed) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: quotaResult.reason || "QUOTA_EXCEEDED",
              message: getQuotaExceededMessage(quotaResult.reason),
            },
            ...(quotaResult.quota ? { quota: toClientQuota(quotaResult.quota) } : {}),
          },
          429,
          { "Retry-After": "30" },
        );
      }

      if (quotaResult.reserved || quotaResult.creditConsumed || quotaResult.isRegeneration) {
        quotaReserved = true;
        reservedActor = userIdentifier;
        reservedTier = effectiveTier;
        reservedContentHash = contentHash;
        reservedCost = quotaResult.reservedCostUsd ?? reservedCostUsd;
        reservedIsRegeneration = Boolean(quotaResult.isRegeneration);
      }
    }

    // 6. Generate Clutch Note via v2 Compiler Academic Synthesis Engine
    const notesRoutingBundle = getNotesV2RoutingBundle();
    const jsonFormulaInventory =
      !parsedDeck && !cachedFormulaInventory
        ? buildFormulaInventory({ sources })
        : undefined;

    let telemetryCostUsd = 0;
    let telemetryTotalTokens = 0;
    const note = await generateClutchNote({
      fileName,
      slideCount,
      sources,
      focus,
      tier: effectiveTier,
      signal,
      useCompilerV2: true,
      modelOverride: notesRoutingBundle.writer.model,
      verifierModel: notesRoutingBundle.critic.model,
      throwOnContradictedFormula: false,
      onTelemetry: (t) => {
        if (typeof t.costUsd === "number" && Number.isFinite(t.costUsd) && t.costUsd > 0) {
          telemetryCostUsd = t.costUsd;
        }
        if (typeof t.totalTokens === "number" && Number.isFinite(t.totalTokens) && t.totalTokens > 0) {
          telemetryTotalTokens = t.totalTokens;
        }
      },
      ...(parsedDeck
        ? {
            ommlEquations: parsedDeck.ommlEquations,
            ocrEquations: parsedDeck.ocrEquations,
            formulaInventory: parsedDeck.formulaInventory,
          }
        : cachedFormulaInventory
          ? {
              formulaInventory: cachedFormulaInventory,
            }
          : jsonFormulaInventory
            ? {
                formulaInventory: jsonFormulaInventory,
              }
            : {}),
    });

    const visionCostUsd = ocrSettled
      ? 0
      : Object.values(parsedDeck?.pageVisionStatus ?? {}).reduce(
          (sum, entry) =>
            sum + (typeof entry?.costUsd === "number" && Number.isFinite(entry.costUsd) ? entry.costUsd : 0),
          0,
        );
    const actualCostUsd = computeNotesV2DeckCogsUsd({
      telemetryCostUsd,
      totalTokens: telemetryTotalTokens,
      visionCostUsd,
      reservedCostUsd: reservedCost,
    });

    const validFileSha256 =
      typeof parsedDeck?.fileSha256 === "string" && parsedDeck.fileSha256.trim().length > 0
        ? parsedDeck.fileSha256.trim()
        : verifiedFileSha256 ?? clientProvidedFileSha256;

    if (enforceQuota) {
      const cogsRecord = await recordDeckGenerationCogs(
        userIdentifier,
        effectiveTier,
        actualCostUsd,
        reservedCost,
        billingRegion,
      );
      quotaReserved = false;
      latestQuotaSummary = toClientQuota(cogsRecord.quota);

      if (validFileSha256) {
        await setSharedDeckCache({
          contentHash,
          fileSha256: validFileSha256,
          language: "en",
          mode: "notes",
          focusHash,
          pipelineVersion: notesPipelineVersion,
          questionPool: [],
          clutchNote: note,
          studyMetadata: {
            fileName,
            slideCount,
            sources,
            format: fileName.toLowerCase().endsWith(".pptx") ? "pptx" : "pdf",
            fileSha256Verified: isFileSha256Verified,
            uploadedByUserId: actorKey,
            warnings,
            formulaInventory: parsedDeck?.formulaInventory ?? cachedFormulaInventory ?? [],
            imageHashes: parsedDeck?.imageHashes ?? cachedImageHashes ?? [],
          },
        });
      }
    }

    return jsonResponse({
      ok: true,
      note,
      warnings,
      contentHash,
      fileSha256: validFileSha256,
      sources,
      ...(latestQuotaSummary ? { quota: latestQuotaSummary } : {}),
    });
  } catch (error) {
    if (ocrReserved && !ocrSettled && ocrActor) {
      try {
        await rollbackDeckQuotaReservation({
          userId: ocrActor,
          tier: ocrTier,
          actionKind: "ocr",
          reservedCostUsd: ocrReservedCost,
          region: billingRegion,
        });
      } catch {
        // Ignore OCR rollback error
      }
    }

    if (quotaReserved && reservedActor && reservedContentHash) {
      try {
        await rollbackDeckQuotaReservation({
          userId: reservedActor,
          tier: reservedTier,
          contentHash: reservedContentHash,
          reservedCostUsd: reservedCost,
          isRegeneration: reservedIsRegeneration,
          actionKind: "notes",
          region: billingRegion,
        });
      } catch (rollbackError) {
        console.error(
          "[ClutchNotesAPI] Failed to rollback deck quota reservation:",
          rollbackError,
        );
      }
    }

    if (timeout.signal.aborted) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "NOTES_TIMEOUT",
            message: "Note synthesis exceeded time limit. Try a smaller slide deck.",
          },
        },
        504,
      );
    }

    if (request.signal.aborted) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "REQUEST_CANCELLED",
            message: "The synthesis request was cancelled.",
          },
        },
        499,
      );
    }

    if (error instanceof IngestionError) {
      if (error.status >= 500) {
        console.error("[ClutchNotesAPI] Internal ingestion error:", error);
      }
      const message =
        error.code === "AI_NOT_CONFIGURED"
          ? "Clutch Notes AI is temporarily unavailable (AI provider not configured)."
          : error.status >= 500
            ? "Failed to synthesize lecture slides into notes. Please try again."
            : error.message;
      return jsonResponse(
        {
          ok: false,
          error: {
            code: error.code,
            message,
          },
        },
        error.status,
      );
    }

    console.error("[ClutchNotesAPI] Internal error:", error);
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "SYNTHESIS_FAILED",
          message: "Failed to synthesize lecture slides into notes. Please try again.",
        },
      },
      500,
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (slotAcquired) activeNotesRequests = Math.max(0, activeNotesRequests - 1);
  }
}
