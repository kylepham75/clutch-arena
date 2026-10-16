import type { SourceBlock } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";
import { MAX_PDF_PAGES, MAX_EXTRACTED_CHARACTERS } from "./limits";
export async function parsePdf(bytes: Buffer, signal: AbortSignal) {
  if (bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new IngestionError(
      "INVALID_PDF",
      "This file does not contain a valid PDF header.",
      422,
    );
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  });
  try {
    const info = await parser.getInfo();
    if (info.total > MAX_PDF_PAGES)
      throw new IngestionError(
        "TOO_MANY_PAGES",
        "Upload at most 150 PDF pages at a time.",
        413,
      );
    const sources: SourceBlock[] = [];
    let characterCount = 0;
    let emptyPages = 0;
    for (let page = 1; page <= info.total; page++) {
      signal.throwIfAborted();
      const result = await parser.getText({ partial: [page] });
      const text =
        result.pages.find((item) => item.num === page)?.text.trim() || "";
      if (!text) {
        emptyPages++;
        continue;
      }
      characterCount += text.length;
      if (characterCount > MAX_EXTRACTED_CHARACTERS)
        throw new IngestionError(
          "TOO_MUCH_TEXT",
          "The document exceeds 120,000 characters. Split it by chapter.",
          413,
        );
      sources.push({ id: `page-${page}`, label: `Page ${page}`, text });
    }
    if (!sources.length)
      throw new IngestionError(
        "OCR_REQUIRED",
        "This PDF has no extractable text. Run OCR or upload a text-based PDF, DOCX, or TXT file.",
        422,
      );
    return {
      sources,
      pageCount: info.total,
      warnings: emptyPages
        ? [
            `${emptyPages} page(s) had no extractable text. Images and scanned content are not included.`,
          ]
        : [],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new IngestionError(
        "PASSWORD_PROTECTED_PDF",
        "Remove the PDF password before uploading.",
        422,
      );
    throw error;
  } finally {
    await parser.destroy();
  }
}
