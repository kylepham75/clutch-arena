import { ingestionOptionsSchema } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";

export const MAX_MULTI_REQUEST_BYTES = 25 * 1024 * 1024 + 512 * 1024; // 25 MB files + multipart framing overhead

export async function readMultiUpload(request: Request, signal: AbortSignal) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new IngestionError(
      "INVALID_CONTENT_TYPE",
      "Send multipart/form-data with file or files fields.",
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MAX_MULTI_REQUEST_BYTES) {
    throw new IngestionError(
      "REQUEST_TOO_LARGE",
      "The upload exceeds the 25 MB total limit.",
      413,
    );
  }

  if (!request.body) {
    throw new IngestionError("MISSING_FILE", "Choose at least one file to upload.", 400);
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
      if (length > MAX_MULTI_REQUEST_BYTES) {
        await reader.cancel();
        throw new IngestionError(
          "REQUEST_TOO_LARGE",
          "The upload exceeds the 25 MB total limit.",
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

  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new IngestionError(
      "INVALID_MULTIPART",
      "The upload could not be read. Send a valid multipart form.",
      400,
    );
  }

  const files: File[] = [];
  for (const [key, value] of form.entries()) {
    if (value instanceof File && key !== "options") {
      files.push(value);
    }
  }

  if (files.length === 0) {
    throw new IngestionError("MISSING_FILE", "Upload at least one file.", 400);
  }

  if (files.length > 10) {
    throw new IngestionError(
      "TOO_MANY_FILES",
      "You can upload up to 10 files at once.",
      400,
    );
  }

  const totalFileBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalFileBytes > 25 * 1024 * 1024) {
    throw new IngestionError(
      "REQUEST_TOO_LARGE",
      "The upload exceeds the 25 MB total limit.",
      413,
    );
  }

  const optionFields = form.getAll("options");
  try {
    const rawOptions = optionFields.length ? JSON.parse(optionFields[0] as string) : {};
    const options = ingestionOptionsSchema.parse({
      ...rawOptions,
      multiFile: true,
    });
    return { files, options };
  } catch {
    throw new IngestionError(
      "INVALID_OPTIONS",
      "Options must be valid JSON: operation preview/generate, mode exact/variants, questionCount 1–30, language en/vi, and focus up to 1,000 characters.",
      400,
    );
  }
}
