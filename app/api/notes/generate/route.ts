import "@/lib/polyfills/pdf-node-polyfills";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { verifyProAccess } from "@/lib/auth/notes-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { parseSlideDeck } from "@/lib/notes/parse-slides";
import { generateClutchNote } from "@/lib/ai/generate-notes";
import { IngestionError } from "@/lib/ingestion/errors";
import { isAllowedOrigin } from "@/lib/utils";
import { MAX_FILE_BYTES } from "@/lib/ingestion/limits";
import type { SourceBlock } from "@/lib/schemas/ingestion";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
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
    const userIdentifier = proAuth.user?.id || `ip:${getClientIp(request)}`;
    const isTest = process.env.NODE_ENV === "test" && !request.headers.get("x-enforce-rate-limit");

    if (!isTest) {
      const rateResult = await checkRateLimit(
        userIdentifier,
        "notes",
        (proAuth.tier as any) || "pro",
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

    // 4. Parse incoming payload (multipart file or JSON)
    const contentType = request.headers.get("content-type") || "";
    let fileName = "lecture-slides.pptx";
    let slideCount = 1;
    let sources: SourceBlock[] = [];
    let focus: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      focus = (formData.get("focus") as string) || undefined;

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

      const parsedDeck = await parseSlideDeck(file);
      fileName = parsedDeck.fileName;
      slideCount = parsedDeck.slideCount;
      sources = parsedDeck.sources;
    } else if (contentType.includes("application/json")) {
      const jsonBody = await request.json();
      fileName = jsonBody.fileName || "lecture-slides.pdf";
      focus = jsonBody.focus;

      if (Array.isArray(jsonBody.sources) && jsonBody.sources.length > 0) {
        sources = jsonBody.sources;
        slideCount = jsonBody.slideCount || jsonBody.sources.length;
      } else if (typeof jsonBody.slidesText === "string" && jsonBody.slidesText.trim()) {
        sources = [
          {
            id: "slide-1",
            label: "Slide 1",
            text: jsonBody.slidesText.trim(),
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

    // 5. Generate Clutch Note via Academic Synthesis Engine
    const note = await generateClutchNote({
      fileName,
      slideCount,
      sources,
      focus,
    });

    return jsonResponse({
      ok: true,
      note,
    });
  } catch (error) {
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
          message:
            error instanceof Error
              ? error.message
              : "Failed to synthesize lecture slides into notes. Please try again.",
        },
      },
      500,
    );
  }
}
