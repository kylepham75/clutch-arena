import "@/lib/polyfills/pdf-node-polyfills";
import { IngestionError } from "@/lib/ingestion/errors";
import { MAX_FILE_BYTES, MAX_EXTRACTED_CHARACTERS } from "@/lib/ingestion/limits";
import { parsePdf } from "@/lib/ingestion/parse-pdf";
import {
  parsePptx,
  type OcrTranscribedEquation,
  type OmmlTranscribedEquation,
  type ParsePptxOptions,
} from "@/lib/ingestion/parse-pptx";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  buildFormulaInventory,
  type FormulaInventoryItem,
} from "./formula-inventory";

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
  signalOrOptions?: AbortSignal | ParsePptxOptions,
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

  if (format === "pptx") {
    const parsed = await parsePptx(bytes, signalOrOptions);
    sources = parsed.sources;
    slideCount = parsed.pageCount;
    warnings = parsed.warnings;
    ocrEquations = parsed.ocrEquations;
    ommlEquations = parsed.ommlEquations;
  } else {
    // format === "pdf"
    const parsed = await parsePdf(bytes, signal ?? new AbortController().signal);
    // Transform "Page X" to "Slide X" for clarity in lecture decks
    sources = parsed.sources.map((src, index) => ({
      id: `slide-${index + 1}`,
      label: `Slide ${index + 1}`,
      text: src.text,
    }));
    slideCount = parsed.pageCount;
    warnings = parsed.warnings;
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
    ...(format === "pptx"
      ? {
          ocrEquations: ocrEquations ?? [],
          ommlEquations: ommlEquations ?? [],
        }
      : {}),
  };
}
