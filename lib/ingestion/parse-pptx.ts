import type { PageVisionInfo, SourceBlock } from "@/lib/schemas/ingestion";
import type { PageVisionMode, PageVisionReason } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";
import {
  MAX_EXTRACTED_CHARACTERS,
  MAX_PDF_PAGES,
  MAX_DOCX_EXPANDED_BYTES,
} from "./limits";
import { validatePptxArchive } from "./validate-file";
import {
  decodeXmlEntities,
  ommlToLatex,
  extractOmmlEquationsFromXml,
  extractSlideXmlText,
  resolveRelsPath,
  getMimeType,
  parseRels,
  detectSlideEquationCandidates,
  type OmmlTranscribedEquation,
  type SlideEquationCandidate,
  type XmlElement,
} from "./pptx-xml";

export {
  decodeXmlEntities,
  ommlToLatex,
  extractOmmlEquationsFromXml,
  extractSlideXmlText,
  resolveRelsPath,
  getMimeType,
  parseRels,
  detectSlideEquationCandidates,
  type OmmlTranscribedEquation,
  type SlideEquationCandidate,
  type XmlElement,
};

export interface OcrTranscribedEquation {
  slide: number;
  raw: string;
  latex: string;
  origin: "ocr";
  confidence: number;
  mediaPath?: string;
}


export type VisionMathTranscriber = (input: {
  imageBytes: Uint8Array;
  mimeType: string;
  slide: number;
  altText?: string;
  signal?: AbortSignal;
}) => Promise<Array<{ raw: string; latex: string; confidence: number }>>;

export interface ParsePptxOptions {
  signal?: AbortSignal;
  visionTranscriber?: VisionMathTranscriber;
  maxAutoOcrBudgetUsd?: number;
}


export const MAX_PPTX_OCR_IMAGES = 25;
export const ESTIMATED_PPTX_OCR_USD = 0.00012;
export const DEFAULT_PPTX_OCR_BUDGET_USD = 0.03;
export const MAX_PPTX_EXPANDED_BYTES = MAX_DOCX_EXPANDED_BYTES * 2.5;
export const MAX_PPTX_ENTRY_BYTES = MAX_DOCX_EXPANDED_BYTES;

export function assertPptxExpandedSize(
  entryBytes: number,
  currentTotal: number,
  maxEntry: number = MAX_PPTX_ENTRY_BYTES,
  maxTotal: number = MAX_PPTX_EXPANDED_BYTES,
): void {
  if (entryBytes > maxEntry || currentTotal + entryBytes > maxTotal) {
    throw new IngestionError(
      "DOCUMENT_TOO_LARGE",
      "The expanded PowerPoint archive is too large. Split the presentation into smaller decks.",
      413,
    );
  }
}

export interface ParsePptxResult {
  sources: SourceBlock[];
  pageCount: number;
  warnings: string[];
  ocrEquations: OcrTranscribedEquation[];
  ommlEquations: OmmlTranscribedEquation[];
  visionOcrCostUsd: number;
  pageVisionStatus?: Record<string, PageVisionInfo>;
}

export const transcribeEquationImageWithGemini: VisionMathTranscriber = async ({
  imageBytes,
  mimeType,
  slide,
  altText,
  signal,
}) => {
  const openRouterApiKey = (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPEN_ROUTER_API_KEY ||
    process.env.OPENROUTER_KEY ||
    process.env.OPEN_ROUTER_KEY
  )?.trim();

  const geminiApiKey = (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY
  )?.trim();

  const hasOpenRouter = Boolean(
    openRouterApiKey &&
      openRouterApiKey !== "your-openrouter-key-here" &&
      openRouterApiKey !== "your-api-key-here" &&
      !openRouterApiKey.includes("placeholder") &&
      openRouterApiKey.length > 10,
  );

  const hasGemini = Boolean(
    geminiApiKey &&
      geminiApiKey !== "your-gemini-key-here" &&
      geminiApiKey !== "your-api-key-here" &&
      !geminiApiKey.includes("placeholder") &&
      geminiApiKey.length > 10,
  );

  if (!hasOpenRouter && !hasGemini) {
    return [];
  }

  const supportedMimes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);

  if (!supportedMimes.has(mimeType)) {
    return [];
  }

  signal?.throwIfAborted();

  const promptText = [
    `You are a specialized mathematical OCR engine.`,
    `Transcribe all mathematical equations and formulas shown in this image from slide ${slide}.`,
    altText ? `Context / image label: ${altText}` : "",
    `Requirements:`,
    `- Extract each distinct mathematical formula into clean, syntactically correct LaTeX.`,
    `- Do NOT enclose LaTeX in '$' or '$$' delimiters.`,
    `- Provide a plain-text ASCII representation for each formula in 'raw'.`,
    `- Provide a confidence score from 0.0 (uncertain) to 1.0 (completely clear and correct).`,
    `- If no mathematical equations or formulas appear in the image, return an empty array.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { generateObject } = await import("ai");
    const { z } = await import("zod");

    const schema = z.object({
      equations: z.array(
        z.object({
          latex: z.string().describe("Clean LaTeX math without dollar signs"),
          raw: z
            .string()
            .optional()
            .describe("Plain text / ASCII formula representation"),
          confidence: z
            .number()
            .min(0)
            .max(1)
            .describe("Confidence score between 0.0 and 1.0"),
        }),
      ),
    });

    // 1. Primary: OpenRouter (pinned vision model: google/gemini-2.5-flash-lite)
    if (hasOpenRouter) {
      try {
        const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
        const openrouter = createOpenRouter({ apiKey: openRouterApiKey! });
        const modelSlug =
          process.env.OPENROUTER_VISION_MODEL?.trim() || "google/gemini-2.5-flash-lite";

        const response = await generateObject({
          model: openrouter(modelSlug),
          temperature: 0,
          abortSignal: signal,
          schema,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                { type: "image", image: imageBytes, mediaType: mimeType },
              ],
            },
          ],
          providerOptions: {
            openrouter: {
              provider: {
                data_collection: "deny",
              },
            },
          },
        });

        const items = response.object?.equations || [];
        return items
          .map((item) => ({
            latex: item.latex.trim(),
            raw: (item.raw || item.latex).trim(),
            confidence: Math.max(0, Math.min(1, item.confidence)),
          }))
          .filter((eq) => eq.latex.length > 0 && eq.confidence > 0);
      } catch (openRouterErr) {
        console.warn(
          "[parsePptx:vision] OpenRouter equation OCR failed, checking direct Gemini fallback:",
          openRouterErr,
        );
        if (!hasGemini) {
          return [];
        }
      }
    }

    // 2. Fallback: Direct Google Gemini SDK
    if (hasGemini) {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const modelId =
        process.env.GEMINI_VISION_MODEL?.trim() ||
        process.env.NOTES_AI_MODEL?.trim() ||
        "gemini-2.5-flash";

      const google = createGoogleGenerativeAI({ apiKey: geminiApiKey! });

      const response = await generateObject({
        model: google(modelId),
        temperature: 0,
        abortSignal: signal,
        schema,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image", image: imageBytes, mediaType: mimeType },
            ],
          },
        ],
      });

      const items = response.object?.equations || [];
      return items
        .map((item) => ({
          latex: item.latex.trim(),
          raw: (item.raw || item.latex).trim(),
          confidence: Math.max(0, Math.min(1, item.confidence)),
        }))
        .filter((eq) => eq.latex.length > 0 && eq.confidence > 0);
    }
  } catch {
    return [];
  }

  return [];
};

export async function parsePptx(
  bytes: Buffer,
  signalOrOptions?: AbortSignal | ParsePptxOptions,
): Promise<ParsePptxResult> {
  let signal: AbortSignal | undefined;
  let customTranscriber: VisionMathTranscriber | undefined;
  let maxAutoOcrBudgetUsd: number = DEFAULT_PPTX_OCR_BUDGET_USD;

  if (signalOrOptions) {
    if (signalOrOptions instanceof AbortSignal || "aborted" in signalOrOptions) {
      signal = signalOrOptions as AbortSignal;
    } else {
      signal = signalOrOptions.signal;
      customTranscriber = signalOrOptions.visionTranscriber;
      if (typeof signalOrOptions.maxAutoOcrBudgetUsd === "number") {
        maxAutoOcrBudgetUsd = signalOrOptions.maxAutoOcrBudgetUsd;
      }
    }
  }

  signal?.throwIfAborted();

  const transcriber: VisionMathTranscriber =
    customTranscriber ?? transcribeEquationImageWithGemini;

  validatePptxArchive(bytes);

  const JSZip = (await import("jszip")).default;
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new IngestionError(
      "INVALID_PPTX",
      "Could not open PowerPoint file. It may be corrupted or password protected.",
      422,
    );
  }

  // Find all slide XML files: ppt/slides/slide1.xml, slide2.xml...
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
    throw new IngestionError(
      "EMPTY_PRESENTATION",
      "No slides found in this PowerPoint presentation.",
      422,
    );
  }

  if (slideEntries.length > MAX_PDF_PAGES) {
    throw new IngestionError(
      "TOO_MANY_PAGES",
      `Upload at most ${MAX_PDF_PAGES} slides at a time.`,
      413,
    );
  }

  // Sort slides numerically
  slideEntries.sort((a, b) => a.num - b.num);

  const sources: SourceBlock[] = [];
  const ocrEquations: OcrTranscribedEquation[] = [];
  const ommlEquations: OmmlTranscribedEquation[] = [];
  const warnings: string[] = [];
  const pageVisionStatus: Record<string, PageVisionInfo> = {};
  let characterCount = 0;
  let emptySlides = 0;
  let transcribedImageCount = 0;
  let visionOcrCostUsd = 0;
  let totalExpandedBytes = 0;

  for (let i = 0; i < slideEntries.length; i++) {
    signal?.throwIfAborted();
    const slide = slideEntries[i];
    const file = zip.file(slide.path);
    if (!file) continue;

    const uncompressedSize = (file as any)._data?.uncompressedSize;
    if (typeof uncompressedSize === "number") {
      assertPptxExpandedSize(uncompressedSize, totalExpandedBytes);
    }

    const xml = await file.async("text");
    const xmlBytes = Buffer.byteLength(xml, "utf8");
    assertPptxExpandedSize(xmlBytes, totalExpandedBytes);
    totalExpandedBytes += xmlBytes;

    // 1. Extract OMML equations from slide XML (linear O(N) scan)
    const slideOmmls = extractOmmlEquationsFromXml(xml, signal);
    for (const omml of slideOmmls) {
      if (omml.latex.trim()) {
        ommlEquations.push({
          slide: slide.num,
          raw: omml.raw,
          latex: omml.latex,
          origin: "omml",
        });
      }
    }

    // 2. Extract slide text (including inline OMML math)
    let text = extractSlideXmlText(xml, signal);

    // 3. Speaker notes
    const notePath = `ppt/notesSlides/notesSlide${slide.num}.xml`;
    const noteFile = zip.file(notePath);
    if (noteFile) {
      try {
        const noteUncompressed = (noteFile as any)._data?.uncompressedSize;
        if (typeof noteUncompressed === "number") {
          assertPptxExpandedSize(noteUncompressed, totalExpandedBytes);
        }
        const noteXml = await noteFile.async("text");
        const noteBytes = Buffer.byteLength(noteXml, "utf8");
        assertPptxExpandedSize(noteBytes, totalExpandedBytes);
        totalExpandedBytes += noteBytes;
        const noteText = extractSlideXmlText(noteXml, signal);
        // Exclude default placeholder slide number text from notes
        const cleanNotes = noteText.replace(/^Slide\s+\d+$/m, "").trim();
        if (cleanNotes && cleanNotes.length > 5) {
          text += `\n[Notes: ${cleanNotes}]`;
        }
      } catch (err) {
        if (err instanceof IngestionError) throw err;
        // Speaker notes optional
      }
    }

    // 4. Equation candidate detection and budgeted OCR vision transcription
    const relsPath = slide.path.replace(
      /^ppt\/slides\/slide(\d+)\.xml$/i,
      "ppt/slides/_rels/slide$1.xml.rels",
    );
    const relsFile = zip.file(relsPath);
    let relsXml: string | undefined;
    if (relsFile) {
      const relsUncompressed = (relsFile as any)._data?.uncompressedSize;
      if (typeof relsUncompressed === "number") {
        assertPptxExpandedSize(relsUncompressed, totalExpandedBytes);
      }
      relsXml = await relsFile.async("text");
      const relsBytes = Buffer.byteLength(relsXml, "utf8");
      assertPptxExpandedSize(relsBytes, totalExpandedBytes);
      totalExpandedBytes += relsBytes;
    }

    const candidates = detectSlideEquationCandidates(xml, relsXml, slide.num, signal);
    let slideOcrCostUsd = 0;
    let slideOcrProcessed = false;
    let slideOcrFailed = false;
    let skippedOcrByBudget = false;
    let hasRasterCandidate = false;

    for (const candidate of candidates) {
      signal?.throwIfAborted();

      const mediaPath = candidate.mediaPath;
      const mediaFile = mediaPath ? zip.file(mediaPath) : undefined;
      const ext = mediaPath?.split(".").at(-1)?.toLowerCase();
      const isVector =
        ext === "wmf" ||
        ext === "emf" ||
        candidate.mimeType === "image/x-wmf" ||
        candidate.mimeType === "image/x-emf";

      if (!mediaFile || isVector) {
        if (
          candidate.altText &&
          (/[=+\-*/\\^∑√∫]/.test(candidate.altText) ||
            /\b(wacc|capm|npv|irr|ebit|gordon|formula|equation|công thức)\b/i.test(candidate.altText))
        ) {
          const cleanLatex = candidate.altText.replace(/^\s*\$+|\$+\s*$/g, "").trim();
          if (cleanLatex.length > 0) {
            ocrEquations.push({
              slide: slide.num,
              raw: candidate.altText.trim(),
              latex: cleanLatex,
              origin: "ocr",
              confidence: 0.85,
              mediaPath,
            });
            const formulaSnippet = `$${cleanLatex}$`;
            if (!text.includes(formulaSnippet)) {
              text = text.trim() ? `${text.trim()}\n${formulaSnippet}` : formulaSnippet;
            }
            continue;
          }
        }

        const warnMsg = `Slide ${slide.num} contains an embedded equation image/OLE object that could not be transcribed automatically.`;
        if (!warnings.includes(warnMsg)) {
          warnings.push(warnMsg);
        }
        continue;
      }

      hasRasterCandidate = true;

      if (
        maxAutoOcrBudgetUsd <= 0 ||
        visionOcrCostUsd + ESTIMATED_PPTX_OCR_USD > maxAutoOcrBudgetUsd + 1e-9
      ) {
        skippedOcrByBudget = true;
        const warnMsg = `Slide ${slide.num} contains an embedded equation image/OLE object that could not be transcribed automatically.`;
        if (!warnings.includes(warnMsg)) {
          warnings.push(warnMsg);
        }
        continue;
      }

      if (transcribedImageCount >= MAX_PPTX_OCR_IMAGES) {
        const limitWarnMsg = `Vision OCR transcription limit reached (${MAX_PPTX_OCR_IMAGES} images max). Skipping remaining equation images.`;
        if (!warnings.includes(limitWarnMsg)) {
          warnings.push(limitWarnMsg);
        }
        const warnMsg = `Slide ${slide.num} contains an embedded equation image/OLE object that could not be transcribed automatically.`;
        if (!warnings.includes(warnMsg)) {
          warnings.push(warnMsg);
        }
        continue;
      }

      const mediaUncompressed = (mediaFile as any)._data?.uncompressedSize;
      if (typeof mediaUncompressed === "number") {
        assertPptxExpandedSize(mediaUncompressed, totalExpandedBytes);
      }
      const imageBuffer = await mediaFile.async("nodebuffer");
      assertPptxExpandedSize(imageBuffer.byteLength, totalExpandedBytes);
      totalExpandedBytes += imageBuffer.byteLength;
      const imageBytes = new Uint8Array(
        imageBuffer.buffer,
        imageBuffer.byteOffset,
        imageBuffer.byteLength,
      );
      const mimeType =
        candidate.mimeType || (mediaPath ? getMimeType(mediaPath) : undefined) || "image/png";

      transcribedImageCount++;
      visionOcrCostUsd =
        Math.round((visionOcrCostUsd + ESTIMATED_PPTX_OCR_USD) * 1e6) / 1e6;
      slideOcrCostUsd =
        Math.round((slideOcrCostUsd + ESTIMATED_PPTX_OCR_USD) * 1e6) / 1e6;
      slideOcrProcessed = true;

      let transcribed: Array<{ raw: string; latex: string; confidence: number }> = [];
      try {
        transcribed = await transcriber({
          imageBytes,
          mimeType,
          slide: slide.num,
          altText: candidate.altText,
          signal,
        });
      } catch {
        transcribed = [];
      }

      let validEquationCount = 0;
      if (Array.isArray(transcribed) && transcribed.length > 0) {
        for (const eq of transcribed) {
          const cleanLatex = (eq.latex || "").trim();
          const conf =
            typeof eq.confidence === "number"
              ? Math.max(0, Math.min(1, eq.confidence))
              : 0;

          if (cleanLatex && conf > 0) {
            validEquationCount++;
            const cleanRaw = (eq.raw || cleanLatex).trim();
            ocrEquations.push({
              slide: slide.num,
              raw: cleanRaw,
              latex: cleanLatex,
              origin: "ocr",
              confidence: conf,
              mediaPath,
            });

            const formulaSnippet = `$${cleanLatex}$`;
            if (!text.includes(formulaSnippet)) {
              text = text.trim() ? `${text.trim()}\n${formulaSnippet}` : formulaSnippet;
            }
          }
        }
      }

      if (validEquationCount === 0) {
        slideOcrFailed = true;
        const warnMsg = `Slide ${slide.num} contains an embedded equation image/OLE object that could not be transcribed automatically.`;
        if (!warnings.includes(warnMsg)) {
          warnings.push(warnMsg);
        }
      }
    }

    const slideReasons: PageVisionReason[] = [];
    if (text.trim().length < 100) slideReasons.push("low_text");
    if (hasRasterCandidate) slideReasons.push("math_image_detected");

    const slideMode: PageVisionMode = slideOcrProcessed ? "equation_crop" : "native";
    pageVisionStatus[`slide-${slide.num}`] = {
      page: slide.num,
      flagged: hasRasterCandidate || slideReasons.length > 0,
      reasons: slideReasons,
      processed: slideOcrProcessed,
      mode: slideMode,
      cached: false,
      lowConfidence: slideOcrFailed || skippedOcrByBudget,
      costUsd: slideOcrCostUsd,
    };

    if (!text.trim()) {
      emptySlides++;
      continue;
    }

    characterCount += text.length;
    if (characterCount > MAX_EXTRACTED_CHARACTERS) {
      throw new IngestionError(
        "TOO_MUCH_TEXT",
        "The presentation exceeds character limits. Split the deck by chapter.",
        413,
      );
    }

    sources.push({
      id: `slide-${slide.num}`,
      label: `Slide ${slide.num}`,
      text: text.trim(),
    });
  }

  if (sources.length === 0) {
    throw new IngestionError(
      "NO_TEXT_FOUND",
      "This slide deck contains only images with no extractable text. Please upload a deck with text or run OCR.",
      422,
    );
  }

  if (emptySlides > 0) {
    warnings.push(
      `${emptySlides} slide(s) contained only images or had no extractable text.`,
    );
  }

  return {
    sources,
    pageCount: slideEntries.length,
    warnings,
    ocrEquations,
    ommlEquations,
    visionOcrCostUsd,
    pageVisionStatus,
  };
}
