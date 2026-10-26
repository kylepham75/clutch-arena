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

    const trimmed = text.trim();
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
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const strBuf: string[] = [];
        let lastX: number | undefined;
        let lastY: number | undefined;

        for (const item of textContent.items) {
          if (!("str" in item) || typeof item.str !== "string") {
            continue;
          }
          const [x, y] = viewport.convertToViewportPoint(
            item.transform[4],
            item.transform[5],
          );

          if (lastY !== undefined && Math.abs(lastY - y) > 4.6) {
            const last = strBuf.length ? strBuf[strBuf.length - 1] : "";
            if (!last.endsWith("\n")) {
              strBuf.push("\n");
            }
          } else if (
            lastY !== undefined &&
            lastX !== undefined &&
            x - lastX > 7
          ) {
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
          lastX = x + (typeof item.width === "number" ? item.width : 0);
          lastY = y;

          if (item.hasEOL) {
            strBuf.push("\n");
            lastX = undefined;
          }
        }

        const text = strBuf.join("").trim();
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

  if (isPptx) {
    return extractPptxSlides(file.name, bytes, signal);
  }

  return extractPdfSlides(file.name, bytes, signal);
}
