import { ingestionOptionsSchema } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";
import { MAX_REQUEST_BYTES } from "./limits";

export async function readUpload(request: Request, signal: AbortSignal) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;"))
    throw new IngestionError(
      "INVALID_CONTENT_TYPE",
      "Send multipart/form-data with a file field.",
      415,
    );
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES)
    throw new IngestionError(
      "REQUEST_TOO_LARGE",
      "The upload exceeds the 25 MB file limit.",
      413,
    );
  if (!request.body)
    throw new IngestionError("MISSING_FILE", "Choose a file to upload.");
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
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new IngestionError(
          "REQUEST_TOO_LARGE",
          "The upload exceeds the 25 MB file limit.",
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
    );
  }
  if ([...form.keys()].some((key) => key !== "file" && key !== "options"))
    throw new IngestionError(
      "INVALID_FORM",
      "Only file and options fields are supported.",
    );
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File))
    throw new IngestionError(
      "MISSING_FILE",
      "Upload exactly one file using the file field.",
    );
  const optionFields = form.getAll("options");
  if (
    optionFields.length > 1 ||
    optionFields.some(
      (value) => typeof value !== "string" || value.length > 3000,
    )
  )
    throw new IngestionError(
      "INVALID_OPTIONS",
      "Provide one options field containing a JSON object.",
    );
  try {
    const options = ingestionOptionsSchema.parse(
      optionFields.length ? JSON.parse(optionFields[0] as string) : {},
    );
    return { file: files[0], options };
  } catch {
    throw new IngestionError(
      "INVALID_OPTIONS",
      "Options must be valid JSON: operation preview/generate, mode exact/variants, questionCount 1–30, language en/vi, and focus up to 1,000 characters.",
    );
  }
}
