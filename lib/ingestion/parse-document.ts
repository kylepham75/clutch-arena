import type { ParsedDocument } from "@/lib/schemas/ingestion";
import { validateFile } from "./validate-file";
import { parseTxt } from "./parse-txt";
import { parseDocx } from "./parse-docx";
import { parsePdf } from "./parse-pdf";
import { IngestionError } from "./errors";
import { MAX_EXTRACTED_CHARACTERS } from "./limits";

export async function parseDocument(
  file: File,
  signal: AbortSignal,
): Promise<ParsedDocument> {
  const format = validateFile(file);
  signal.throwIfAborted();
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = file.name
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 200);
  try {
    let data: Pick<ParsedDocument, "sources" | "warnings" | "pageCount">;
    if (format === "pdf") data = await parsePdf(bytes, signal);
    else if (format === "docx")
      data = { ...(await parseDocx(bytes)), pageCount: null };
    else data = { sources: parseTxt(bytes), pageCount: null, warnings: [] };
    signal.throwIfAborted();
    const characterCount = data.sources.reduce(
      (sum, source) => sum + source.text.length,
      0,
    );
    if (characterCount < 40)
      throw new IngestionError(
        "INSUFFICIENT_TEXT",
        "The document needs at least 40 characters of readable study material.",
        422,
      );
    if (characterCount > MAX_EXTRACTED_CHARACTERS)
      throw new IngestionError(
        "TOO_MUCH_TEXT",
        "The document exceeds 120,000 characters. Split it by chapter.",
        413,
      );
    return { fileName, format, ...data, characterCount };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof IngestionError) throw error;
    throw new IngestionError(
      "PARSE_FAILED",
      `Could not read this ${format.toUpperCase()} file. Re-export it and try again.`,
      422,
    );
  }
}
