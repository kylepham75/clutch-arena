import "@/lib/polyfills/pdf-node-polyfills";
import { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { verifyProAccess } from "@/lib/auth/notes-guard";
import {
  checkRateLimit,
  getClientIp,
  computeContentHash,
  computeFileSha256,
  getSharedDeckCache,
  setSharedDeckCache,
  checkAndReserveDeckQuota,
  recordDeckGenerationCogs,
  rollbackDeckQuotaReservation,
} from "@/lib/rate-limit";
import { parseSlideDeck } from "@/lib/notes/parse-slides";
import { generateClutchNote } from "@/lib/ai/generate-notes";
import { IngestionError } from "@/lib/ingestion/errors";
import { isAllowedOrigin } from "@/lib/utils";
import {
  MAX_FILE_BYTES,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PDF_PAGES,
} from "@/lib/ingestion/limits";
import type { SourceBlock } from "@/lib/schemas/ingestion";

export const runtime = "nodejs";
export const maxDuration = 120;
const NOTES_SHARED_CACHE_PIPELINE_VERSION = "notes-v1";

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

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let quotaReserved = false;
  let reservedActor: string | null = null;
  let reservedTier: any = null;
  let reservedContentHash: string | null = null;
  let reservedCost = 0.02;
  let reservedIsRegeneration = false;
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

    // 2. Paid tier subscription gate (Cram Pass, Pro, Tutor)
    const proAuth = await verifyProAccess(request);
    if (!proAuth.authorized) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "PRO_SUBSCRIPTION_REQUIRED",
            message:
              proAuth.message ||
              "Clutch Notes AI is available on 7-Day Cram Pass, Pro Tier, and Tutor plans. Upgrade to convert lecture slides into exam-ready revision notes.",
            reason: proAuth.reason,
            userTier: proAuth.tier || "free",
          },
        },
        403,
      );
    }

    // 3. User rate limit: 30 conversions per day
    const userIdentifier =
      (process.env.NODE_ENV === "test" && request.headers.get("x-test-user-id")) ||
      proAuth.user?.id ||
      `ip:${getClientIp(request)}`;
    const isTest = process.env.NODE_ENV === "test" && !request.headers.get("x-enforce-rate-limit");
    const effectiveTier = (proAuth.tier as any) || "pro";

    // 4. Content-length pre-check & parse incoming payload (multipart file or JSON)
    const rawContentLength = request.headers.get("content-length");
    if (rawContentLength) {
      const parsedLength = parseInt(rawContentLength, 10);
      if (!isNaN(parsedLength) && parsedLength > MAX_FILE_BYTES) {
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

    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    if (!isMultipart && !isTest) {
      const rateResult = await checkRateLimit(
        userIdentifier,
        "notes",
        effectiveTier,
      );
      if (!rateResult.allowed) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message:
                "Daily limit reached: up to 30 lecture slide conversions per day. Your quota will reset in 24 hours.",
              reset: rateResult.reset,
              retryAfter: rateResult.retryAfter,
            },
          },
          429,
          { "Retry-After": rateResult.retryAfter.toString() },
        );
      }
    }

    let fileName = "lecture-slides.pptx";
    let slideCount = 1;
    let sources: SourceBlock[] = [];
    let warnings: string[] = [];
    let focus: string | undefined;
    let parsedDeck: Awaited<ReturnType<typeof parseSlideDeck>> | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
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

      // a. Pre-check rate limit / quota eligibility before expensive slide parsing
      const rateResult = await checkRateLimit(
        userIdentifier,
        "notes",
        effectiveTier,
      );
      if (!rateResult.allowed) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message:
                "Daily limit reached: up to 30 lecture slide conversions per day. Your quota will reset in 24 hours.",
              reset: rateResult.reset,
              retryAfter: rateResult.retryAfter,
            },
          },
          429,
          { "Retry-After": (rateResult.retryAfter ?? 30).toString() },
        );
      }

      // b. Pre-check shared deck cache using fileSha256 before parsing slides
      const fileBytes = Buffer.from(await file.arrayBuffer());
      const fileSha256 = computeFileSha256(fileBytes);
      const normalizedFocus = (focus || "").trim().toLowerCase();
      const focusHash = normalizedFocus
        ? createHash("sha256").update(normalizedFocus).digest("hex").slice(0, 16)
        : "";

      const cachedFromStore = await getSharedDeckCache({
        contentHash: "",
        language: "en",
        mode: "notes",
        focusHash,
        pipelineVersion: NOTES_SHARED_CACHE_PIPELINE_VERSION,
        fileSha256,
      });

      if (cachedFromStore?.clutchNote) {
        return jsonResponse({
          ok: true,
          note: cachedFromStore.clutchNote,
          warnings: [],
          cached: true,
        });
      }

      parsedDeck = await parseSlideDeck(file);
      fileName = parsedDeck.fileName;
      slideCount = parsedDeck.slideCount;
      sources = parsedDeck.sources;
      warnings = parsedDeck.warnings || [];
    } else if (contentType.includes("application/json")) {
      const jsonBody = await request.json();
      fileName =
        typeof jsonBody?.fileName === "string" && jsonBody.fileName.trim()
          ? jsonBody.fileName.trim()
          : "lecture-slides.pdf";

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
          text: s.text,
        }));
        slideCount =
          typeof jsonBody.slideCount === "number" && jsonBody.slideCount > 0
            ? jsonBody.slideCount
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

        sources = [
          {
            id: "slide-1",
            label: "Slide 1",
            text: trimmedText,
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
    } else {
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

    // 5. Shared deck cache lookup & durable quota reservation
    const contentHash = computeContentHash({
      normalizedText: sources.map((s) => s.text).join("\n"),
      pageCount: slideCount,
      imageHashes: parsedDeck?.imageHashes,
    });
    const normalizedFocus = (focus || "").trim().toLowerCase();
    const focusHash = normalizedFocus
      ? createHash("sha256").update(normalizedFocus).digest("hex").slice(0, 16)
      : "";
    const enforceQuota =
      !isTest || Boolean(request.headers.get("x-enforce-quota"));
    const reservedCostUsd = 0.02;

    if (enforceQuota) {
      const cacheLookupKey = {
        contentHash,
        language: "en",
        mode: "notes",
        focusHash,
        pipelineVersion: NOTES_SHARED_CACHE_PIPELINE_VERSION,
        fileSha256: parsedDeck?.fileSha256 ?? null,
      };

      const cachedFromStore = await getSharedDeckCache(cacheLookupKey);
      if (cachedFromStore?.clutchNote) {
        return jsonResponse({
          ok: true,
          note: cachedFromStore.clutchNote,
          warnings,
          cached: true,
        });
      }

      const quotaResult = await checkAndReserveDeckQuota(
        userIdentifier,
        effectiveTier,
        contentHash,
        {
          ...cacheLookupKey,
          estimatedCostUsd: reservedCostUsd,
        },
      );

      if (quotaResult.cachedDeck?.clutchNote) {
        return jsonResponse({
          ok: true,
          note: quotaResult.cachedDeck.clutchNote,
          warnings,
          cached: true,
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
        reservedCost = reservedCostUsd;
        reservedIsRegeneration = Boolean(quotaResult.isRegeneration);
      }
    }

    // 6. Generate Clutch Note via Academic Synthesis Engine
    const note = await generateClutchNote({
      fileName,
      slideCount,
      sources,
      focus,
      ...(parsedDeck
        ? {
            ommlEquations: parsedDeck.ommlEquations,
            ocrEquations: parsedDeck.ocrEquations,
            formulaInventory: parsedDeck.formulaInventory,
          }
        : {}),
    });

    if (enforceQuota) {
      await recordDeckGenerationCogs(
        userIdentifier,
        effectiveTier,
        reservedCostUsd,
        reservedCostUsd,
      );
      quotaReserved = false;
      const validFileSha256 =
        typeof parsedDeck?.fileSha256 === "string" && parsedDeck.fileSha256.trim().length > 0
          ? parsedDeck.fileSha256.trim()
          : null;

      if (validFileSha256) {
        await setSharedDeckCache({
          contentHash,
          fileSha256: validFileSha256,
          language: "en",
          mode: "notes",
          focusHash,
          pipelineVersion: NOTES_SHARED_CACHE_PIPELINE_VERSION,
          questionPool: [],
          clutchNote: note,
        });
      }
    }

    return jsonResponse({
      ok: true,
      note,
      warnings,
    });
  } catch (error) {
    if (quotaReserved && reservedActor && reservedContentHash) {
      try {
        if (reservedIsRegeneration) {
          await rollbackDeckQuotaReservation(
            reservedActor,
            reservedTier,
            reservedContentHash,
            reservedCost,
            reservedIsRegeneration,
          );
        } else {
          await rollbackDeckQuotaReservation(
            reservedActor,
            reservedTier,
            reservedContentHash,
            reservedCost,
          );
        }
      } catch (rollbackError) {
        console.error(
          "[ClutchNotesAPI] Failed to rollback deck quota reservation:",
          rollbackError,
        );
      }
    }

    if (error instanceof IngestionError) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
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
  }
}
