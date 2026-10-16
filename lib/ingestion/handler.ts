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

export function createIngestionHandler(
  dependencies: {
    generate?: typeof generateQuestions;
    checkConfiguration?: () => void;
  } = {},
) {
  const generate = dependencies.generate ?? generateQuestions;
  const checkConfiguration =
    dependencies.checkConfiguration ??
    (() => {
      getGenerationModel();
    });
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
      const { file, options } = await readUpload(request, signal);
      validateFile(file);
      // Fail fast without parsing when generation cannot be configured.
      if (options.operation === "generate") checkConfiguration();
      const document = await parseDocument(file, signal);
      if (options.operation === "preview")
        return json({ ok: true, requestId, operation: "preview", document });
      const result = await generate(document, options, signal);
      signal.throwIfAborted();
      return json({
        ok: true,
        requestId,
        operation: "generate",
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
