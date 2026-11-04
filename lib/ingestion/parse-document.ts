import type { ParsedDocument } from "@/lib/schemas/ingestion";
import { validateFile } from "./validate-file";
import { parseTxt } from "./parse-txt";
import { parseDocx } from "./parse-docx";
import { parsePdf, type ParsePdfOptions } from "./parse-pdf";
import { parsePptx } from "./parse-pptx";
import { IngestionError } from "./errors";
import { MAX_EXTRACTED_CHARACTERS } from "./limits";
import {
  computeDocumentContentHash,
  computeFileSha256,
  deduplicateAnimationSlides,
} from "./content-hash";

export async function parseDocument(
  file: File,
  signal: AbortSignal,
  options?: { rescanPages?: number[]; parsePdfOptions?: ParsePdfOptions },
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
    if (format === "pdf") {
      const pdfOpts: ParsePdfOptions = {
        rescanPages: options?.rescanPages,
        ...(options?.parsePdfOptions ?? {}),
      };
      if (options?.rescanPages && !pdfOpts.rescanPages) {
        pdfOpts.rescanPages = options.rescanPages;
      }
      data = await parsePdf(bytes, signal, pdfOpts);
    } else if (format === "pptx") {
      const pptxResult = await parsePptx(bytes, signal);
      data = {
        sources: pptxResult.sources,
        pageCount: pptxResult.pageCount,
        warnings: pptxResult.warnings,
      };
    } else if (format === "docx") {
      data = { ...(await parseDocx(bytes)), pageCount: null };
    } else {
      const txtSources = parseTxt(bytes);
      const isSlideDeck = txtSources.some((s) => s.id.startsWith("slide-"));
      data = {
        sources: txtSources,
        pageCount: isSlideDeck ? txtSources.length : null,
        warnings: [],
      };
    }
    signal.throwIfAborted();

    let dedupedSlideCount: number | undefined;
    if (format === "pdf" || format === "pptx" || (format === "txt" && data.pageCount !== null)) {
      const dedupeResult = deduplicateAnimationSlides(data.sources);
      data.sources = dedupeResult.sources;
      if (dedupeResult.droppedCount > 0) {
        dedupedSlideCount = dedupeResult.droppedCount;
        data.warnings = [
          ...data.warnings,
          `Deduplicated ${dedupeResult.droppedCount} incremental animation slide(s).`,
        ];
      }
    }

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

    const fileSha256 = computeFileSha256(bytes);
    const pdfMeta = data as Partial<ParsedDocument>;
    const imageHashes = pdfMeta.imageHashes;
    const contentHash = computeDocumentContentHash({
      sources: data.sources,
      pageCount: data.pageCount,
      imageHashes,
    });

    const sources = data.sources.map((s) => ({
      id: s.id,
      label: s.label,
      text: s.text,
    }));

    return {
      fileName,
      format,
      sources,
      warnings: data.warnings,
      pageCount: data.pageCount,
      characterCount,
      fileSha256,
      contentHash,
      ...(imageHashes ? { imageHashes } : {}),
      ...(dedupedSlideCount ? { dedupedSlideCount } : {}),
      ...(pdfMeta.visionBanner !== undefined ? { visionBanner: pdfMeta.visionBanner } : {}),
      ...(pdfMeta.lowConfidenceSourceIds ? { lowConfidenceSourceIds: pdfMeta.lowConfidenceSourceIds } : {}),
      ...(pdfMeta.pageVisionStatus ? { pageVisionStatus: pdfMeta.pageVisionStatus } : {}),
    };
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
