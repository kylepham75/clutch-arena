import "@/lib/polyfills/pdf-node-polyfills";
import { IngestionError } from "@/lib/ingestion/errors";
import { MAX_FILE_BYTES, MAX_EXTRACTED_CHARACTERS } from "@/lib/ingestion/limits";
import { parsePdf, type ParsePdfOptions } from "@/lib/ingestion/parse-pdf";
import {
  parsePptx,
  type OcrTranscribedEquation,
  type OmmlTranscribedEquation,
  type ParsePptxOptions,
} from "@/lib/ingestion/parse-pptx";
import {
  computeDocumentContentHash,
  computeFileSha256,
  deduplicateAnimationSlides,
} from "@/lib/ingestion/content-hash";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  buildFormulaInventory,
  type FormulaInventoryItem,
} from "./formula-inventory";

/**
 * Detects whether slide text exhibits corrupted or broken mathematical expressions,
 * missing font glyph placeholders (e.g. □ or \uFFFD), unmapped PUA codepoints,
 * or broken dangling equations where operators lack operands.
 */
export function isSlideMathCorrupted(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  // 1. Unmapped PUA codepoints or replacement glyphs (□, \uFFFD, etc.)
  if (/[\uE000-\uF8FF\uFFFD\u25A0-\u25AF\u25FB-\u25FC]/.test(text)) {
    return true;
  }

  // 2. Dangling equality / assignment without expression (e.g. "WACC = \n", "y = \n")
  if (/(?:^|\n|\r)\s*[A-Za-z0-9_\(\)]+\s*=\s*(?:$|\n|\r)/m.test(text)) {
    return true;
  }

  // Sanitize benign URLs, markdown bold/italic formatting, and code comments before checking dangling/conflicting operators
  const sanitizedForOps = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\*\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*\*/g, "$1")
    .replace(/(^|\s)\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*/g, "$1$2")
    .replace(/\*\*|\/\/|\/\*|\*\//g, " ")
    .replace(/^\s*[-*]\s+\*/gm, " ");

  // 3. Lines ending with dangling binary math operators without right-hand side
  if (/(?:^|\s)[A-Za-z0-9_\)]+\s*(?:[+*/=≤≥≠≈÷×]|−)\s*$/m.test(sanitizedForOps)) {
    return true;
  }

  // 4. Broken adjacent conflicting operator chains (e.g. "+ =", "= /", "= +", "× ÷")
  if (/(?:[+\-*/=≤≥≠≈÷×]|−)\s*(?:[=*/≤≥≠≈÷×])/.test(sanitizedForOps)) {
    return true;
  }

  return false;
}

/**
 * Returns an array of 1-based page numbers that exhibit corrupted or garbled math
 * requiring controlled Vision OCR rescan.
 */
export function detectCorruptedMathPages(sources: SourceBlock[]): number[] {
  const corrupted: number[] = [];
  for (const src of sources) {
    if (isSlideMathCorrupted(src.text)) {
      const match = src.id.match(/\d+/);
      const pageNum = match ? parseInt(match[0], 10) : null;
      if (pageNum !== null && !corrupted.includes(pageNum)) {
        corrupted.push(pageNum);
      }
    }
  }
  return corrupted;
}

export type ParseSlideDeckOptions =
  | AbortSignal
  | (ParsePptxOptions & ParsePdfOptions & { signal?: AbortSignal });

export interface ParsedSlideDeck {
  fileName: string;
  format: "pdf" | "pptx";
  slideCount: number;
  sources: SourceBlock[];
  warnings: string[];
  characterCount: number;
  ocrEquations?: OcrTranscribedEquation[];
  ommlEquations?: OmmlTranscribedEquation[];
  formulaInventory: FormulaInventoryItem[];
  contentHash: string;
  fileSha256: string;
  imageHashes?: string[];
  dedupedSlideCount?: number;
  pageVisionStatus?: Record<string, { costUsd?: number }>;
}

export function validateSlideFile(file: File): "pdf" | "pptx" {
  if (!file.size) {
    throw new IngestionError("EMPTY_FILE", "The uploaded slide deck is empty.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new IngestionError(
      "FILE_TOO_LARGE",
      "Slide deck exceeds maximum allowed size of 25 MB.",
      413,
    );
  }

  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension !== "pdf" && extension !== "pptx") {
    throw new IngestionError(
      "UNSUPPORTED_FORMAT",
      "Clutch Notes AI supports PowerPoint (.pptx) and PDF (.pdf) lecture slide decks.",
      415,
    );
  }

  const mime = file.type.toLowerCase().split(";")[0];
  const allowedMimes: Record<"pdf" | "pptx", string[]> = {
    pdf: ["application/pdf"],
    pptx: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip",
      "application/octet-stream",
    ],
  };

  if (mime && mime !== "application/octet-stream" && !allowedMimes[extension].includes(mime)) {
    throw new IngestionError(
      "FILE_TYPE_MISMATCH",
      `The file MIME type (${mime}) does not match its .${extension} extension.`,
      415,
    );
  }

  return extension;
}

export async function parseSlideDeck(
  file: File,
  signalOrOptions?: ParseSlideDeckOptions,
): Promise<ParsedSlideDeck> {
  const format = validateSlideFile(file);

  let signal: AbortSignal | undefined;
  if (signalOrOptions) {
    if (signalOrOptions instanceof AbortSignal || "aborted" in signalOrOptions) {
      signal = signalOrOptions as AbortSignal;
    } else {
      signal = signalOrOptions.signal;
    }
  }

  signal?.throwIfAborted();

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = file.name
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 200);

  let sources: SourceBlock[];
  let slideCount: number;
  let warnings: string[] = [];
  let ocrEquations: OcrTranscribedEquation[] | undefined;
  let ommlEquations: OmmlTranscribedEquation[] | undefined;
  let imageHashes: string[] | undefined;
  let pageVisionStatus: Record<string, { costUsd?: number }> | undefined;

  if (format === "pptx") {
    const parsed = await parsePptx(bytes, signalOrOptions);
    sources = parsed.sources.map((src) => ({
      ...src,
      text: src.text
        .replace(/[\t\v\f\r]+/g, " ")
        .replace(/[\x00-\x08\x0E-\x1F]/g, "")
        .trim(),
    }));
    slideCount = parsed.pageCount;
    warnings = parsed.warnings;
    ocrEquations = parsed.ocrEquations;
    ommlEquations = parsed.ommlEquations;
  } else {
    // format === "pdf"
    const abortSignal = signal ?? new AbortController().signal;
    const isMockOrCustom = Boolean(
      signalOrOptions &&
        typeof signalOrOptions === "object" &&
        ("mockPages" in signalOrOptions ||
          "visionTranscriber" in signalOrOptions ||
          "maxAutoOcrBudgetUsd" in signalOrOptions),
    );

    // Fast-path for digital slide PDFs:
    // First extract text with maxAutoOcrBudgetUsd = 0.
    // Digital slides exported from PowerPoint / Keynote already contain full vector text.
    // This bypasses 40+ seconds of sequential network OCR calls on decorative images or icons.
    let parsed: Awaited<ReturnType<typeof parsePdf>>;

    if (isMockOrCustom) {
      const customOptions = signalOrOptions as (ParsePdfOptions & { signal?: AbortSignal }) | undefined;
      const hasExplicitBudget =
        customOptions &&
        typeof customOptions === "object" &&
        "maxAutoOcrBudgetUsd" in customOptions;

      if (!hasExplicitBudget) {
        // Fast-path: try with maxAutoOcrBudgetUsd = 0 first
        parsed = await parsePdf(bytes, abortSignal, {
          ...(customOptions ?? {}),
          maxAutoOcrBudgetUsd: 0,
        });

        const nativeCharCount = parsed.sources.reduce(
          (sum, s) => sum + s.text.trim().length,
          0,
        );

        const corruptedPages = detectCorruptedMathPages(parsed.sources);

        if (nativeCharCount < 40) {
          parsed = await parsePdf(bytes, abortSignal, customOptions as any);
        } else if (corruptedPages.length > 0) {
          // Allow controlled Vision OCR fallback on math-corrupted slide pages
          parsed = await parsePdf(bytes, abortSignal, {
            ...(customOptions ?? {}),
            rescanPages: corruptedPages,
          });
        }
      } else {
        parsed = await parsePdf(bytes, abortSignal, signalOrOptions as any);
      }
    } else {
      parsed = await parsePdf(bytes, abortSignal, {
        maxAutoOcrBudgetUsd: 0,
      });

      const nativeCharCount = parsed.sources.reduce(
        (sum, s) => sum + s.text.trim().length,
        0,
      );

      const corruptedPages = detectCorruptedMathPages(parsed.sources);

      // If native digital text is insufficient (< 40 characters across the deck),
      // this is a scanned PDF or image-only deck. Fall back to standard OCR extraction.
      if (nativeCharCount < 40) {
        parsed = await parsePdf(bytes, abortSignal);
      } else if (corruptedPages.length > 0) {
        // Controlled Vision OCR fallback on math-corrupted slide pages
        parsed = await parsePdf(bytes, abortSignal, {
          rescanPages: corruptedPages,
        });
      }
    }

    imageHashes = (parsed as { imageHashes?: string[] }).imageHashes;
    // Transform "Page X" to "Slide X" preserving page number from src.id
    sources = parsed.sources.map((src, index) => {
      const match = src.id.match(/\d+/);
      const pageNum = match ? parseInt(match[0], 10) : index + 1;
      return {
        id: `slide-${pageNum}`,
        label: `Slide ${pageNum}`,
        text: src.text
          .replace(/[\t\v\f\r]+/g, " ")
          .replace(/[\x00-\x08\x0E-\x1F]/g, "")
          .trim(),
      };
    });
    slideCount = parsed.pageCount;
    warnings = parsed.warnings;
    ocrEquations = parsed.ocrEquations;
    pageVisionStatus = (parsed as { pageVisionStatus?: Record<string, { costUsd?: number }> }).pageVisionStatus;
  }

  // Deduplicate progressive animation slides for both formats
  const dedupeResult = deduplicateAnimationSlides(sources);
  sources = dedupeResult.sources;
  const dedupedSlideCount = dedupeResult.droppedCount;
  if (dedupedSlideCount > 0) {
    warnings.push(
      `Deduplicated ${dedupedSlideCount} incremental animation slide(s).`,
    );
  }

  const characterCount = sources.reduce((sum, s) => sum + s.text.length, 0);

  if (characterCount < 40) {
    throw new IngestionError(
      "INSUFFICIENT_TEXT",
      "The slide deck needs at least 40 characters of readable content to synthesize notes.",
      422,
    );
  }

  if (characterCount > MAX_EXTRACTED_CHARACTERS) {
    throw new IngestionError(
      "TOO_MUCH_TEXT",
      "The slide deck exceeds the 120,000 character limit. Please split it by lecture topic.",
      413,
    );
  }

  const fileSha256 = computeFileSha256(bytes);
  const contentHash = computeDocumentContentHash({
    sources,
    pageCount: slideCount,
    imageHashes,
  });

  const formulaInventory = buildFormulaInventory({
    sources,
    ommlEquations,
    ocrEquations,
  });

  return {
    fileName,
    format,
    slideCount,
    sources,
    warnings,
    characterCount,
    formulaInventory,
    contentHash,
    fileSha256,
    ...(imageHashes ? { imageHashes } : {}),
    ...(dedupedSlideCount > 0 ? { dedupedSlideCount } : {}),
    ...(ocrEquations ? { ocrEquations } : {}),
    ...(ommlEquations ? { ommlEquations } : {}),
    ...(pageVisionStatus ? { pageVisionStatus } : {}),
  };
}
