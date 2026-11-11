import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  MAX_FILE_BYTES,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PDF_PAGES,
} from "@/lib/ingestion/limits";
import { extractSlideXmlText } from "@/lib/ingestion/parse-pptx";

export interface ExtractedSlideDeck {
  fileName: string;
  slideCount: number;
  sources: SourceBlock[];
  warnings: string[];
  fileSha256?: string;
}

export type ClientSlideExtractionErrorCode =
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE"
  | "TOO_MANY_PAGES"
  | "TOO_MUCH_TEXT"
  | "OCR_REQUIRED"
  | "PASSWORD_PROTECTED_PDF";

export class ClientSlideExtractionError extends Error {
  readonly code: ClientSlideExtractionErrorCode;
  readonly isUserActionable: boolean;

  constructor(
    code: ClientSlideExtractionErrorCode,
    message: string,
    isUserActionable = true,
  ) {
    super(message);
    this.name = "ClientSlideExtractionError";
    this.code = code;
    this.isUserActionable = isUserActionable;
    Object.setPrototypeOf(this, ClientSlideExtractionError.prototype);
  }
}

import {
  normalizePdfMathSymbols,
  normalizePdfArrowSymbols,
} from "@/lib/notes/pdf-symbol-normalizer";

export { normalizePdfMathSymbols, normalizePdfArrowSymbols };

export interface PositionedPdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL: boolean;
  originalIndex: number;
}

interface RowCluster {
  anchorY: number;
  anchorFontSize: number;
  dominantStrLen: number;
  items: PositionedPdfItem[];
}

/**
 * Sorts raw PDF textContent.items into visual top-to-bottom (descending y)
 * and left-to-right (ascending x) reading order, clustering baseline-shifted
 * inline subscripts/superscripts onto their anchor line and normalizing PUA symbols.
 */
export function sortAndGroupPdfTextItems(rawItems: any[]): string {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return "";
  }

  // 1. Filter valid text items
  const validItems: Array<{ item: any; index: number }> = [];
  let hasValidPosition = false;

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (
      !item ||
      typeof item !== "object" ||
      !("str" in item) ||
      typeof item.str !== "string"
    ) {
      continue;
    }
    if (item.str.length === 0) {
      continue;
    }
    validItems.push({ item, index: i });

    if (
      Array.isArray(item.transform) &&
      item.transform.length >= 6 &&
      (item.transform[0] !== 0 ||
        item.transform[1] !== 0 ||
        item.transform[2] !== 0 ||
        item.transform[3] !== 0 ||
        item.transform[4] !== 0 ||
        item.transform[5] !== 0)
    ) {
      hasValidPosition = true;
    }
  }

  if (validItems.length === 0) {
    return "";
  }

  // 2. Fallback handling when transform is missing or all zero: preserve stream order
  if (!hasValidPosition) {
    const strBuf: string[] = [];
    for (const { item } of validItems) {
      strBuf.push(item.str);
      if (item.hasEOL) {
        strBuf.push("\n");
      }
    }
    return normalizePdfMathSymbols(strBuf.join("").trim());
  }

  // 3. Extract positioned items (PDF coordinates: x = transform[4], y = transform[5])
  const positionedItems: PositionedPdfItem[] = [];

  for (const { item, index } of validItems) {
    const transform =
      Array.isArray(item.transform) && item.transform.length >= 6
        ? item.transform
        : [0, 0, 0, 0, 0, 0];

    const x = typeof transform[4] === "number" ? transform[4] : 0;
    const y = typeof transform[5] === "number" ? transform[5] : 0;
    const fontSize =
      Math.hypot(transform[0], transform[1]) || Math.abs(transform[3]) || 0;
    const width = typeof item.width === "number" ? item.width : 0;
    const height =
      typeof item.height === "number" && item.height > 0
        ? item.height
        : fontSize > 0
          ? fontSize
          : 12;

    positionedItems.push({
      str: item.str,
      x,
      y,
      width,
      height,
      fontSize,
      hasEOL: Boolean(item.hasEOL),
      originalIndex: index,
    });
  }

  // 4. Initial sort: descending y (top-to-bottom), then ascending x (left-to-right)
  positionedItems.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 0.001) {
      return dy;
    }
    const dx = a.x - b.x;
    if (Math.abs(dx) > 0.001) {
      return dx;
    }
    return a.originalIndex - b.originalIndex;
  });

  // 5. Cluster items into baseline-aware visual rows
  const rows: RowCluster[] = [];

  for (const item of positionedItems) {
    const effectiveItemWidth =
      item.width > 0
        ? item.width
        : item.str.length * ((item.fontSize || 12) * 0.5);
    const itemStartX = item.x;
    const itemEndX = itemStartX + effectiveItemWidth;

    let bestRow: RowCluster | null = null;
    let bestDy = Infinity;

    for (const row of rows) {
      const dy = Math.abs(item.y - row.anchorY);
      // Sensible vertical row-clustering tolerance (~6-8pt)
      const tolerance = Math.max(6.5, Math.min(8.0, row.anchorFontSize * 0.55));
      if (dy > tolerance) {
        continue;
      }

      // Check horizontal collision with items currently in this row
      let hasCollision = false;
      for (const existing of row.items) {
        const effectiveExistingWidth =
          existing.width > 0
            ? existing.width
            : existing.str.length * ((existing.fontSize || 12) * 0.5);
        const existingStartX = existing.x;
        const existingEndX = existingStartX + effectiveExistingWidth;

        const overlap =
          Math.min(itemEndX, existingEndX) - Math.max(itemStartX, existingStartX);
        const allowedOverlap = Math.min(
          3.0,
          Math.min(effectiveItemWidth, effectiveExistingWidth) * 0.35,
        );

        if (overlap > allowedOverlap) {
          hasCollision = true;
          break;
        }
      }

      if (hasCollision) {
        continue;
      }

      if (dy < bestDy) {
        bestDy = dy;
        bestRow = row;
      }
    }

    if (bestRow !== null) {
      bestRow.items.push(item);
      // Update anchor baseline if current item is more dominant
      if (
        item.fontSize > bestRow.anchorFontSize ||
        (item.fontSize === bestRow.anchorFontSize &&
          item.str.length > bestRow.dominantStrLen)
      ) {
        bestRow.anchorY = item.y;
        bestRow.anchorFontSize = item.fontSize || bestRow.anchorFontSize;
        bestRow.dominantStrLen = item.str.length;
      }
    } else {
      rows.push({
        anchorY: item.y,
        anchorFontSize: item.fontSize || item.height || 12,
        dominantStrLen: item.str.length,
        items: [item],
      });
    }
  }

  // 6. Sort rows top-to-bottom (descending anchorY)
  rows.sort((a, b) => b.anchorY - a.anchorY);

  // 7. Assemble lines with horizontal gap spacing
  const lineStrings: string[] = [];

  for (const row of rows) {
    // Sort items within the row left-to-right (ascending x)
    row.items.sort((a, b) => {
      const dx = a.x - b.x;
      if (Math.abs(dx) > 0.001) return dx;
      return a.originalIndex - b.originalIndex;
    });

    const strBuf: string[] = [];
    let lastEndX: number | undefined;

    for (const item of row.items) {
      const effectiveWidth =
        item.width > 0
          ? item.width
          : item.str.length * ((item.fontSize || 12) * 0.5);

      const spaceThreshold =
        typeof item.fontSize === "number" && item.fontSize > 0
          ? Math.min(7, Math.max(4.5, item.fontSize * 0.45))
          : 7;

      if (lastEndX !== undefined && item.x - lastEndX > spaceThreshold) {
        const last = strBuf.length ? strBuf[strBuf.length - 1] : "";
        if (
          !last.endsWith(" ") &&
          !last.endsWith("\n") &&
          !item.str.startsWith(" ")
        ) {
          strBuf.push(" ");
        }
      }

      strBuf.push(item.str);
      lastEndX = item.x + effectiveWidth;
    }

    const lineText = strBuf.join("").trim();
    if (lineText.length > 0) {
      lineStrings.push(lineText);
    }
  }

  return normalizePdfMathSymbols(lineStrings.join("\n").trim());
}


async function extractPptxSlides(
  fileName: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<ExtractedSlideDeck> {
  signal?.throwIfAborted();

  // Validate ZIP magic bytes (0x50, 0x4b, 0x03, 0x04)
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new ClientSlideExtractionError(
      "INVALID_FILE",
      "This file does not contain a valid PowerPoint presentation.",
      true,
    );
  }

  const JSZip = (await import("jszip")).default;
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ClientSlideExtractionError(
      "INVALID_FILE",
      "Could not open PowerPoint file. It may be corrupted or password protected.",
      true,
    );
  }

  const slideEntries: Array<{ num: number; path: string }> = [];
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;

  zip.forEach((relativePath) => {
    const match = relativePath.match(slideRegex);
    if (match) {
      slideEntries.push({
        num: parseInt(match[1], 10),
        path: relativePath,
      });
    }
  });

  if (slideEntries.length === 0) {
    throw new ClientSlideExtractionError(
      "OCR_REQUIRED",
      "This slide deck contains no slides with extractable text. Please upload a deck with text or run OCR.",
      true,
    );
  }

  slideEntries.sort((a, b) => a.num - b.num);

  const sources: SourceBlock[] = [];
  let characterCount = 0;
  let emptySlides = 0;

  for (const slide of slideEntries) {
    signal?.throwIfAborted();
    const slideFile = zip.file(slide.path);
    if (!slideFile) continue;

    let xml = "";
    try {
      xml = await slideFile.async("text");
    } catch {
      throw new ClientSlideExtractionError(
        "INVALID_FILE",
        "Could not read slide XML from presentation.",
        true,
      );
    }

    let text = extractSlideXmlText(xml);

    // Corresponding speaker notes if present
    const notePath = `ppt/notesSlides/notesSlide${slide.num}.xml`;
    const noteFile = zip.file(notePath);
    if (noteFile) {
      try {
        const noteXml = await noteFile.async("text");
        const noteText = extractSlideXmlText(noteXml);
        const cleanNotes = noteText.replace(/^Slide\s+\d+$/m, "").trim();
        if (cleanNotes && cleanNotes.length > 5) {
          text += `\n[Notes: ${cleanNotes}]`;
        }
      } catch {
        // Speaker notes are optional
      }
    }

    const trimmed = normalizePdfMathSymbols(text.trim());
    if (!trimmed) {
      emptySlides++;
      continue;
    }

    characterCount += trimmed.length;
    if (characterCount > MAX_EXTRACTED_CHARACTERS) {
      throw new ClientSlideExtractionError(
        "TOO_MUCH_TEXT",
        `The presentation exceeds ${MAX_EXTRACTED_CHARACTERS.toLocaleString()} characters. Split the deck by chapter.`,
        true,
      );
    }

    sources.push({
      id: `slide-${slide.num}`,
      label: `Slide ${slide.num}`,
      text: trimmed,
    });
  }

  if (sources.length === 0) {
    throw new ClientSlideExtractionError(
      "OCR_REQUIRED",
      "This slide deck contains only images with no extractable text. Please upload a deck with text or run OCR.",
      true,
    );
  }

  return {
    fileName,
    slideCount: slideEntries.length,
    sources,
    warnings: emptySlides
      ? [
          `${emptySlides} slide(s) contained only images or had no extractable text.`,
        ]
      : [],
  };
}

async function extractPdfSlides(
  fileName: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<ExtractedSlideDeck> {
  signal?.throwIfAborted();

  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (header !== "%PDF-") {
    throw new ClientSlideExtractionError(
      "INVALID_FILE",
      "This file does not contain a valid PDF header.",
      true,
    );
  }

  const { initPdfWorker } = await import("@/lib/polyfills/pdf-node-polyfills");
  await initPdfWorker();

  // @ts-ignore
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjsModule = (pdfjs as any).default ?? pdfjs;
  const getDocument = pdfjsModule.getDocument ?? (pdfjs as any).getDocument;

  let doc: any = null;
  try {
    try {
      const loadingTask = getDocument({
        data: bytes,
        isEvalSupported: false,
        verbosity: 0,
      });
      doc = await loadingTask.promise;
    } catch (loadErr: any) {
      if (loadErr?.name === "PasswordException") {
        throw new ClientSlideExtractionError(
          "PASSWORD_PROTECTED_PDF",
          "Remove the PDF password before uploading.",
          true,
        );
      }
      throw new ClientSlideExtractionError(
        "INVALID_FILE",
        loadErr?.message || "Could not parse PDF file. It may be corrupted.",
        true,
      );
    }

    if (doc.numPages > MAX_PDF_PAGES) {
      throw new ClientSlideExtractionError(
        "TOO_MANY_PAGES",
        `Upload at most ${MAX_PDF_PAGES} PDF pages at a time.`,
        true,
      );
    }

    const sources: SourceBlock[] = [];
    let characterCount = 0;
    let emptyPages = 0;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(pageNum);
      try {
        const textContent = await page.getTextContent();
        const text = sortAndGroupPdfTextItems(textContent.items);
        if (!text) {
          emptyPages++;
          continue;
        }

        characterCount += text.length;
        if (characterCount > MAX_EXTRACTED_CHARACTERS) {
          throw new ClientSlideExtractionError(
            "TOO_MUCH_TEXT",
            `The document exceeds ${MAX_EXTRACTED_CHARACTERS.toLocaleString()} characters. Split it by chapter.`,
            true,
          );
        }

        sources.push({
          id: `slide-${pageNum}`,
          label: `Slide ${pageNum}`,
          text,
        });
      } finally {
        page.cleanup();
      }
    }

    if (sources.length === 0) {
      throw new ClientSlideExtractionError(
        "OCR_REQUIRED",
        "This PDF has no extractable text. Run OCR or upload a text-based document.",
        true,
      );
    }

    return {
      fileName,
      slideCount: doc.numPages,
      sources,
      warnings: emptyPages
        ? [
            `${emptyPages} slide(s) had no extractable text. Images and scanned content are not included.`,
          ]
        : [],
    };
  } catch (error: any) {
    if (error instanceof ClientSlideExtractionError) {
      throw error;
    }
    if (error?.name === "PasswordException") {
      throw new ClientSlideExtractionError(
        "PASSWORD_PROTECTED_PDF",
        "Remove the PDF password before uploading.",
        true,
      );
    }
    if (error?.name === "AbortError") {
      throw error;
    }
    throw error;
  } finally {
    await doc?.destroy();
  }
}

async function computeBrowserSha256(buffer: ArrayBuffer): Promise<string | undefined> {
  try {
    if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // ignore in environments without subtle crypto
  }
  return undefined;
}

export async function extractSlidesInBrowser(
  file: File,
  signal?: AbortSignal,
): Promise<ExtractedSlideDeck> {
  signal?.throwIfAborted();

  if (file.size > MAX_FILE_BYTES) {
    throw new ClientSlideExtractionError(
      "FILE_TOO_LARGE",
      `File size exceeds limit of ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB.`,
      true,
    );
  }

  const lowerName = file.name.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf");
  const isPptx = lowerName.endsWith(".pptx");

  if (!isPdf && !isPptx) {
    throw new ClientSlideExtractionError(
      "UNSUPPORTED_FILE_TYPE",
      "Only .pdf and .pptx slide deck files are supported.",
      true,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  const bytes = new Uint8Array(arrayBuffer);

  const result = isPptx
    ? await extractPptxSlides(file.name, bytes, signal)
    : await extractPdfSlides(file.name, bytes, signal);

  const fileSha256 = await computeBrowserSha256(arrayBuffer);
  if (fileSha256) {
    result.fileSha256 = fileSha256;
  }

  return result;
}
