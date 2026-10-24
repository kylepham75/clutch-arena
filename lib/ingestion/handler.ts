import "server-only";
import { randomUUID } from "node:crypto";
import { generateQuestions } from "@/lib/ai/generate-questions";
import { getGenerationModel } from "@/lib/ai/provider";
import { IngestionError } from "./errors";
import { parseDocument } from "./parse-document";
import { readUpload } from "./read-upload";
import { validateFile } from "./validate-file";
import { REQUEST_TIMEOUT_MS } from "./limits";
import { isAllowedOrigin } from "@/lib/utils";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export function createIngestionHandler(
  dependencies: {
    generate?: typeof generateQuestions;
    checkConfiguration?: () => void;
    rateLimiter?: typeof checkRateLimit;
    verifyAuth?: typeof verifyAuthToken;
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
      // Fail fast without parsing when generation cannot be configured or rate limit is reached.
      if (options.operation === "generate") {
        const isPaid =
          auth.tier === "cram_pass" || auth.tier === "pro" || auth.tier === "tutor";

        if (!isPaid && options.questionCount > 10) {
          return json(
            {
              ok: false,
              requestId,
              error: {
                code: "TIER_UPGRADE_REQUIRED",
                message:
                  "Free and Guest tiers support up to 10 questions per run. Upgrade to Cram Pass or Pro for up to 30 questions.",
              },
            },
            403,
          );
        }

        const clientIp = getClientIp(request);
        const rateLimitKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
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
      const document = await parseDocument(file, signal);
      if (options.operation === "preview")
        return json({ ok: true, requestId, operation: "preview", document });
      const result = await generate(document, options, signal);
      signal.throwIfAborted();
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
