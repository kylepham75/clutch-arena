import { initPdfWorker } from "@/lib/polyfills/pdf-node-polyfills";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";
import { MAX_PDF_PAGES, MAX_EXTRACTED_CHARACTERS } from "./limits";

/**
 * Normalizes common PDF Private Use Area (Wingdings/Symbol) arrow codepoints
 * and geometric markers to standard Unicode arrows so directional meaning is preserved.
 */
export function normalizePdfArrowSymbols(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\uF0E1\uF0D9\uF0AD\u25B2\u2191]/g, "↑")
    .replace(/[\uF0E2\uF0DA\uF0AF\u25BC\u2193]/g, "↓")
    .replace(/[\uF0E0\uF0AE\uF0E8\u2192]/g, "→")
    .replace(/[\uF0DF\uF0AC\u2190]/g, "←")
    .replace(/[\uF0DC\u21D2]/g, "⇒");
}

export async function parsePdf(bytes: Buffer, signal: AbortSignal) {
  if (bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new IngestionError(
      "INVALID_PDF",
      "This file does not contain a valid PDF header.",
      422,
    );
  await initPdfWorker();
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
    signal.throwIfAborted();
    const result = await parser.getText();
    const sources: SourceBlock[] = [];
    let characterCount = 0;
    let emptyPages = 0;
    const pageMap = new Map<number, string>();
    for (const pageItem of result.pages) {
      pageMap.set(pageItem.num, normalizePdfArrowSymbols(pageItem.text));
    }
    for (let page = 1; page <= info.total; page++) {
      signal.throwIfAborted();
      const text = pageMap.get(page)?.trim() || "";
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
