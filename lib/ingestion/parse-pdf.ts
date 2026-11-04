import { initPdfWorker } from "@/lib/polyfills/pdf-node-polyfills";
import type {
  PageVisionInfo,
  PageVisionMode,
  PageVisionReason,
  SourceBlock,
} from "@/lib/schemas/ingestion";
import type { OcrTranscribedEquation } from "./parse-pptx";
import { createRequire } from "node:module";
import { IngestionError } from "./errors";
import { MAX_PDF_PAGES, MAX_EXTRACTED_CHARACTERS } from "./limits";
import {
  computeImageSha256,
  computePerceptualImageHash,
} from "./content-hash";

try {
  const req = createRequire(import.meta.url);
  const serverOnlyPath = req.resolve("server-only");
  if (!req.cache[serverOnlyPath]) {
    req.cache[serverOnlyPath] = {
      id: serverOnlyPath,
      filename: serverOnlyPath,
      loaded: true,
      exports: {},
    } as any;
  }
} catch {
  // ignore
}

const { setBoundedMapEntry } = await import("@/lib/rate-limit");

export const MAX_AUTO_OCR_BUDGET_USD = 0.03;
export const ESTIMATED_FULL_PAGE_OCR_USD = 0.0012;
export const ESTIMATED_EQUATION_CROP_OCR_USD = 0.00012;

export type PdfVisionTranscriber = (input: {
  imageBytes: Uint8Array;
  mimeType: string;
  page: number;
  mode: "equation_crop" | "full_page";
  nativeText?: string;
  signal: AbortSignal;
}) => Promise<{ text: string; costUsd?: number; confidence?: number } | null>;

export interface MockPdfPage {
  page: number;
  text: string;
  width?: number;
  height?: number;
  images?: Array<{
    data: Uint8Array;
    width: number;
    height: number;
    name?: string;
  }>;
  screenshot?: Uint8Array;
}

export interface ParsePdfOptions {
  rescanPages?: number[];
  maxAutoOcrBudgetUsd?: number;
  visionTranscriber?: PdfVisionTranscriber;
  mockPages?: MockPdfPage[];
}

// Module-level SHA-256 cache: keyed by `${mode}:${computeImageSha256(imageBytes)}`
const pdfVisionCache = new Map<string, { text: string; confidence: number }>();

export const MAX_PDF_VISION_CACHE_ENTRIES = 500;

export function getPdfVisionCacheSize(): number {
  return pdfVisionCache.size;
}

export function clearPdfVisionCacheForTests(): void {
  pdfVisionCache.clear();
}

export function setPdfVisionCacheEntry(
  cacheKey: string,
  value: { text: string; confidence: number },
): void {
  setBoundedMapEntry(pdfVisionCache, cacheKey, value, MAX_PDF_VISION_CACHE_ENTRIES);
}

export function getPdfVisionCacheEntry(
  cacheKey: string,
): { text: string; confidence: number } | undefined {
  const cached = pdfVisionCache.get(cacheKey);
  if (cached) {
    pdfVisionCache.delete(cacheKey);
    pdfVisionCache.set(cacheKey, cached);
  }
  return cached;
}

export function hasValidGeminiKey(): boolean {
  const key = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_KEY ||
    process.env.GOOGLE_API_KEY
  )?.trim();
  return Boolean(
    key &&
      key !== "your-gemini-key-here" &&
      key !== "your-api-key-here" &&
      !key.includes("placeholder") &&
      key.length > 10,
  );
}

export function hasValidOpenRouterKey(): boolean {
  const key = (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPEN_ROUTER_API_KEY ||
    process.env.OPENROUTER_KEY ||
    process.env.OPEN_ROUTER_KEY
  )?.trim();
  return Boolean(
    key &&
      key !== "your-openrouter-key-here" &&
      key !== "your-api-key-here" &&
      !key.includes("placeholder") &&
      key.length > 10,
  );
}

export function hasValidVisionKey(): boolean {
  return hasValidOpenRouterKey() || hasValidGeminiKey();
}

export const defaultOpenRouterVisionTranscriber: PdfVisionTranscriber = async ({
  imageBytes,
  mimeType,
  mode,
  signal,
}) => {
  const prompt =
    mode === "equation_crop"
      ? "Transcribe all mathematical equations, formulas, and data tables visible in this image into clean LaTeX or Markdown tables. Return only the transcription."
      : "Transcribe all visible text, formulas (in LaTeX), and tables (in Markdown) on this page accurately. Return clean Markdown text.";

  // 1. Primary: OpenRouter if configured
  if (hasValidOpenRouterKey()) {
    try {
      const { generateText } = await import("ai");
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");

      const apiKey = (
        process.env.OPENROUTER_API_KEY ||
        process.env.OPEN_ROUTER_API_KEY ||
        process.env.OPENROUTER_KEY ||
        process.env.OPEN_ROUTER_KEY
      )!.trim();

      const openrouter = createOpenRouter({ apiKey });
      const visionModelSlug =
        process.env.OPENROUTER_VISION_MODEL?.trim() || "google/gemini-2.5-flash-lite";

      const result = await generateText({
        model: openrouter(visionModelSlug),
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image: imageBytes },
            ],
          },
        ],
        abortSignal: signal,
        providerOptions: {
          openrouter: {
            provider: {
              data_collection: "deny",
            },
          },
        },
      });

      const text = result.text.trim();
      return {
        text,
        confidence: text.length > 0 ? 0.95 : 0.0,
        costUsd:
          mode === "equation_crop"
            ? ESTIMATED_EQUATION_CROP_OCR_USD
            : ESTIMATED_FULL_PAGE_OCR_USD,
      };
    } catch (openRouterErr) {
      console.warn("[parsePdf:vision] OpenRouter OCR attempt encountered error, checking fallback:", openRouterErr);
      if (!hasValidGeminiKey()) {
        throw openRouterErr;
      }
    }
  }

  // 2. Direct Google Gemini SDK (if GEMINI_API_KEY is present or OpenRouter failed)
  if (hasValidGeminiKey()) {
    try {
      const { generateText } = await import("ai");
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");

      const googleApiKey = (
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GEMINI_KEY ||
        process.env.GOOGLE_API_KEY
      )!.trim();

      const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
      const geminiModel = process.env.GEMINI_VISION_MODEL?.trim() || "gemini-3.5-flash-lite";

      const result = await generateText({
        model: google(geminiModel),
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image: imageBytes },
            ],
          },
        ],
        abortSignal: signal,
      });

      const text = result.text.trim();
      return {
        text,
        confidence: text.length > 0 ? 0.95 : 0.0,
        costUsd: 0,
      };
    } catch (geminiErr) {
      console.warn("[parsePdf:vision] Direct Google Gemini OCR attempt failed:", geminiErr);
      throw geminiErr;
    }
  }

  return null;
};

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

export async function parsePdf(
  bytes: Buffer,
  signal: AbortSignal,
  options?: ParsePdfOptions,
) {
  if (bytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new IngestionError(
      "INVALID_PDF",
      "This file does not contain a valid PDF header.",
      422,
    );
  }

  const isMock = Boolean(options?.mockPages);
  let parser: any = null;
  let totalPages = 0;
  const pageTextMap = new Map<number, string>();
  const pageDimMap = new Map<number, { width: number; height: number }>();
  const pageImagesMap = new Map<
    number,
    Array<{ data: Uint8Array; width: number; height: number; name?: string }>
  >();
  const mockPageMap = new Map<number, MockPdfPage>();

  try {
    if (isMock) {
      totalPages = options!.mockPages!.length;
      for (const mp of options!.mockPages!) {
        mockPageMap.set(mp.page, mp);
        pageTextMap.set(mp.page, normalizePdfArrowSymbols(mp.text));
        pageDimMap.set(mp.page, {
          width: mp.width ?? 612,
          height: mp.height ?? 792,
        });
        pageImagesMap.set(mp.page, mp.images ?? []);
      }
    } else {
      await initPdfWorker();
      const { PDFParse } = await import("pdf-parse");
      parser = new PDFParse({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        verbosity: 0,
      });

      const info = await parser.getInfo({ parsePageInfo: true });
      totalPages = info.total;

      if (totalPages > MAX_PDF_PAGES) {
        throw new IngestionError(
          "TOO_MANY_PAGES",
          "Upload at most 150 PDF pages at a time.",
          413,
        );
      }
      signal.throwIfAborted();

      const textResult = await parser.getText();
      for (const pageItem of textResult.pages) {
        pageTextMap.set(
          pageItem.num,
          normalizePdfArrowSymbols(pageItem.text),
        );
      }

      if (Array.isArray(info.pages)) {
        for (const pInfo of info.pages) {
          if (pInfo && pInfo.pageNumber && pInfo.width && pInfo.height) {
            pageDimMap.set(pInfo.pageNumber, {
              width: pInfo.width,
              height: pInfo.height,
            });
          }
        }
      }

      try {
        const imageResult = await parser.getImage({
          imageBuffer: true,
          imageDataUrl: false,
          imageThreshold: 16,
        });
        if (imageResult && Array.isArray(imageResult.pages)) {
          for (const pImg of imageResult.pages) {
            if (pImg && pImg.pageNumber && Array.isArray(pImg.images)) {
              pageImagesMap.set(
                pImg.pageNumber,
                pImg.images.map((img: any) => ({
                  data: img.data,
                  width: img.width,
                  height: img.height,
                  name: img.name,
                })),
              );
            }
          }
        }
      } catch {
        // Safe try/catch so malformed XObjects never crash native text parsing
      }
    }

    if (totalPages > MAX_PDF_PAGES) {
      throw new IngestionError(
        "TOO_MANY_PAGES",
        "Upload at most 150 PDF pages at a time.",
        413,
      );
    }
    signal.throwIfAborted();

    // 1. Slide-master logo guard:
    // If total >= 4 and an image's SHA-256 appears identically on >= 3 pages AND > 50% of pages,
    // ignore that repeated template image for area-ratio flagging.
    const imagePageMap = new Map<string, Set<number>>();
    const perceptualHashSet = new Set<string>();

    for (let p = 1; p <= totalPages; p++) {
      const imgs = pageImagesMap.get(p) ?? [];
      for (const img of imgs) {
        if (img.data && img.data.length > 0) {
          const sha = computeImageSha256(img.data);
          let pageSet = imagePageMap.get(sha);
          if (!pageSet) {
            pageSet = new Set<number>();
            imagePageMap.set(sha, pageSet);
          }
          pageSet.add(p);
          perceptualHashSet.add(computePerceptualImageHash(img.data));
        }
      }
    }

    const templateHashes = new Set<string>();
    if (totalPages >= 4) {
      for (const [hash, pages] of imagePageMap.entries()) {
        if (pages.size >= 3 && pages.size / totalPages > 0.5) {
          templateHashes.add(hash);
        }
      }
    }

    const isVisionAvailable = Boolean(
      options?.visionTranscriber || hasValidVisionKey(),
    );
    const visionTranscriber =
      options?.visionTranscriber ??
      (hasValidVisionKey()
        ? defaultOpenRouterVisionTranscriber
        : undefined);

    const rescanSet = new Set<number>(options?.rescanPages ?? []);
    const maxBudget =
      options?.maxAutoOcrBudgetUsd ?? MAX_AUTO_OCR_BUDGET_USD;
    let deckVisionCostUsd = 0;

    const sources: SourceBlock[] = [];
    let characterCount = 0;
    let emptyPages = 0;
    const pageVisionStatus: Record<string, PageVisionInfo> = {};
    const lowConfidenceSourceIds: string[] = [];
    const ocrEquations: OcrTranscribedEquation[] = [];

    let flaggedCount = 0;
    let processedFlaggedCount = 0;
    let lastVisionError: any = null;

    for (let page = 1; page <= totalPages; page++) {
      signal.throwIfAborted();

      const rawNativeText = pageTextMap.get(page)?.trim() || "";
      let pageText = rawNativeText;
      const dims = pageDimMap.get(page);
      const width = dims?.width ?? 612;
      const height = dims?.height ?? 792;
      const pageArea = width * height > 0 ? width * height : 484704;

      const allImages = pageImagesMap.get(page) ?? [];
      const nonTemplateImages = allImages.filter(
        (img) => !templateHashes.has(computeImageSha256(img.data)),
      );

      // Flag reasons:
      const reasons: PageVisionReason[] = [];
      if (rawNativeText.length < 100) {
        reasons.push("low_text");
      }

      let hasSingleImageArea = false;
      let totalNonTemplateArea = 0;
      let hasMathCropImage = false;
      const isMathCueSlide =
        /equation|formula|math|calculate|công thức|tính|[=∑√∫%]|\b(wacc|capm|npv|irr|ebit|gordon|pv|fv|roe|roa|dcf)\b/i.test(
          rawNativeText,
        );

      for (const img of nonTemplateImages) {
        const area = img.width * img.height;
        const areaRatio = area / pageArea;
        const aspect = img.width / Math.max(1, img.height);
        totalNonTemplateArea += area;
        if (areaRatio > 0.08) {
          hasSingleImageArea = true;
        }
        if (
          (area >= 800 && areaRatio <= 0.4 && (aspect >= 1.2 || isMathCueSlide)) ||
          Boolean(img.name && /eq|math|formula/i.test(img.name))
        ) {
          hasMathCropImage = true;
        }
      }
      if (hasSingleImageArea) {
        reasons.push("single_image_area");
      }
      if (totalNonTemplateArea / pageArea > 0.25) {
        reasons.push("combined_image_area");
      }
      if (!hasSingleImageArea && hasMathCropImage) {
        reasons.push("math_image_detected");
      }

      const isFlagged = reasons.length > 0;
      if (isFlagged) {
        flaggedCount++;
      }
      const needsVision = isFlagged || rescanSet.has(page);

      if (!isVisionAvailable || !visionTranscriber) {
        // Offline / unit tests without API key or visionTranscriber: keep existing behavior
        if (!pageText) {
          emptyPages++;
          continue;
        }
        characterCount += pageText.length;
        if (characterCount > MAX_EXTRACTED_CHARACTERS) {
          throw new IngestionError(
            "TOO_MUCH_TEXT",
            "The document exceeds 120,000 characters. Split it by chapter.",
            413,
          );
        }
        sources.push({
          id: `page-${page}`,
          label: `Page ${page}`,
          text: pageText,
        });
        continue;
      }

      // Vision is available:
      if (!needsVision) {
        pageVisionStatus[`page-${page}`] = {
          page,
          flagged: false,
          reasons: [],
          processed: false,
          mode: "native",
          cached: false,
          lowConfidence: false,
          costUsd: 0,
        };
        if (!pageText) {
          emptyPages++;
          continue;
        }
        characterCount += pageText.length;
        if (characterCount > MAX_EXTRACTED_CHARACTERS) {
          throw new IngestionError(
            "TOO_MUCH_TEXT",
            "The document exceeds 120,000 characters. Split it by chapter.",
            413,
          );
        }
        sources.push({
          id: `page-${page}`,
          label: `Page ${page}`,
          text: pageText,
        });
        continue;
      }

      // Page needs vision: determine mode
      const qualifyingCrops = nonTemplateImages.filter((img) => {
        const area = img.width * img.height;
        const areaRatio = area / pageArea;
        const aspect = img.width / Math.max(1, img.height);
        const isMathCrop =
          (area >= 800 && areaRatio <= 0.4 && (aspect >= 1.2 || isMathCueSlide)) ||
          Boolean(img.name && /eq|math|formula/i.test(img.name));
        return (
          areaRatio > 0.08 ||
          reasons.includes("combined_image_area") ||
          isMathCrop
        );
      });

      const mode: PageVisionMode =
        qualifyingCrops.length > 0 &&
        (rawNativeText.length >= 100 || !mockPageMap.get(page)?.screenshot)
          ? "equation_crop"
          : "full_page";

      let pageCostUsd = 0;
      let isCached = false;
      let processed = false;
      let pageConfidence = 0.95;
      let visionFailed = false;
      let skippedByBudget = false;

      if (mode === "equation_crop") {
        let allCropsCached = true;
        let anyCropHandled = false;

        for (const crop of qualifyingCrops) {
          const sha = computeImageSha256(crop.data);
          const cacheKey = `equation_crop:${sha}`;

          const cached = getPdfVisionCacheEntry(cacheKey);
          if (cached) {
            if (cached.text.trim()) {
              const text = cached.text.trim();
              const cleanLatex = text.replace(/^\s*\$+|\$+\s*$/g, "").trim();
              const hasDollar = text.includes("$");
              const mathSnippet = hasDollar ? text : `$${cleanLatex}$`;
              pageText = pageText
                ? `${pageText}\n\n${mathSnippet}`
                : mathSnippet;

              if (cleanLatex.length > 0) {
                ocrEquations.push({
                  slide: page,
                  raw: cleanLatex,
                  latex: cleanLatex,
                  origin: "ocr",
                  confidence: cached.confidence,
                });
              }
            }
            pageConfidence = Math.min(pageConfidence, cached.confidence);
            anyCropHandled = true;
          } else {
            allCropsCached = false;
            // Check budget cap:
            if (
              !rescanSet.has(page) &&
              deckVisionCostUsd + ESTIMATED_EQUATION_CROP_OCR_USD >
                maxBudget + 1e-9
            ) {
              skippedByBudget = true;
              break;
            }

            try {
              const res = await visionTranscriber({
                imageBytes: crop.data,
                mimeType: "image/png",
                page,
                mode: "equation_crop",
                nativeText: pageText,
                signal,
              });

              if (res && res.text !== undefined && res.text !== null) {
                const text = res.text.trim();
                const conf = res.confidence ?? (text ? 0.95 : 0.0);
                setPdfVisionCacheEntry(cacheKey, { text, confidence: conf });
                const cost =
                  res.costUsd ?? ESTIMATED_EQUATION_CROP_OCR_USD;
                deckVisionCostUsd += cost;
                pageCostUsd += cost;
                if (text) {
                  const cleanLatex = text.replace(/^\s*\$+|\$+\s*$/g, "").trim();
                  const hasDollar = text.includes("$");
                  const mathSnippet = hasDollar ? text : `$${cleanLatex}$`;
                  pageText = pageText
                    ? `${pageText}\n\n${mathSnippet}`
                    : mathSnippet;

                  if (cleanLatex.length > 0) {
                    ocrEquations.push({
                      slide: page,
                      raw: cleanLatex,
                      latex: cleanLatex,
                      origin: "ocr",
                      confidence: conf,
                    });
                  }
                }
                pageConfidence = Math.min(pageConfidence, conf);
                anyCropHandled = true;
                if (conf < 0.4 || !text) {
                  visionFailed = true;
                }
              } else {
                visionFailed = true;
              }
            } catch (err) {
              console.warn("[parsePdf:vision:crop] Crop OCR failed:", err);
              lastVisionError = err;
              visionFailed = true;
            }
          }
        }

        processed = anyCropHandled && !skippedByBudget;
        isCached = allCropsCached && anyCropHandled;
      } else {
        // mode === "full_page"
        let imageBytes: Uint8Array | undefined;
        if (isMock) {
          const mp = mockPageMap.get(page);
          imageBytes = mp?.screenshot;
          if (!imageBytes && mp?.images && mp.images.length > 0) {
            const large =
              mp.images.find(
                (img) => (img.width * img.height) / pageArea > 0.5,
              ) ?? mp.images[0];
            imageBytes = large.data;
          }
        } else {
          const large = nonTemplateImages.find(
            (img) => (img.width * img.height) / pageArea > 0.5,
          );
          if (large) {
            imageBytes = large.data;
          } else if (parser) {
            try {
              const screenshotResult = await parser.getScreenshot({
                partial: [page],
                imageBuffer: true,
                imageDataUrl: false,
                desiredWidth: 1024,
              });
              imageBytes = screenshotResult.pages[0]?.data;
            } catch {
              // Screenshot extraction failed
            }
          }
          if (!imageBytes && nonTemplateImages.length > 0) {
            imageBytes = nonTemplateImages[0].data;
          }
        }

        if (!imageBytes) {
          visionFailed = true;
          processed = false;
        } else {
          const sha = computeImageSha256(imageBytes);
          const cacheKey = `full_page:${sha}`;

          const cachedRes = getPdfVisionCacheEntry(cacheKey);
          if (cachedRes) {
            isCached = true;
            processed = true;
            if (cachedRes.text.trim()) {
              pageText = pageText
                ? `${pageText}\n\n${cachedRes.text.trim()}`
                : cachedRes.text.trim();
            }
            pageConfidence = cachedRes.confidence;
            if (!cachedRes.text.trim() || pageConfidence < 0.4) {
              visionFailed = true;
            }
          } else {
            if (
              !rescanSet.has(page) &&
              deckVisionCostUsd + ESTIMATED_FULL_PAGE_OCR_USD >
                maxBudget + 1e-9
            ) {
              skippedByBudget = true;
              processed = false;
            } else {
              try {
                const res = await visionTranscriber({
                  imageBytes,
                  mimeType: "image/png",
                  page,
                  mode: "full_page",
                  nativeText: pageText,
                  signal,
                });

                if (res && res.text !== undefined && res.text !== null) {
                  const text = res.text.trim();
                  const conf = res.confidence ?? (text ? 0.95 : 0.0);
                  setPdfVisionCacheEntry(cacheKey, { text, confidence: conf });
                  const cost =
                    res.costUsd ?? ESTIMATED_FULL_PAGE_OCR_USD;
                  deckVisionCostUsd += cost;
                  pageCostUsd = cost;
                  processed = true;
                  if (text) {
                    pageText = pageText
                      ? `${pageText}\n\n${text}`
                      : text;
                  }
                  pageConfidence = conf;
                  if (conf < 0.4 || !text) {
                    visionFailed = true;
                  }
                } else {
                  visionFailed = true;
                  processed = true;
                }
              } catch (err) {
                console.warn("[parsePdf:vision:full] Full-page OCR failed:", err);
                lastVisionError = err;
                visionFailed = true;
                processed = false;
              }
            }
          }
        }
      }

      if (isFlagged && processed) {
        processedFlaggedCount++;
      }

      const isLowConfidence =
        isFlagged &&
        (visionFailed ||
          (skippedByBudget && rawNativeText.length < 100) ||
          pageConfidence < 0.4);

      if (isLowConfidence) {
        lowConfidenceSourceIds.push(`page-${page}`);
      }

      pageVisionStatus[`page-${page}`] = {
        page,
        flagged: isFlagged,
        reasons,
        processed,
        mode,
        cached: isCached,
        lowConfidence: isLowConfidence,
        costUsd: pageCostUsd,
      };

      if (!pageText) {
        emptyPages++;
        continue;
      }

      characterCount += pageText.length;
      if (characterCount > MAX_EXTRACTED_CHARACTERS) {
        throw new IngestionError(
          "TOO_MUCH_TEXT",
          "The document exceeds 120,000 characters. Split it by chapter.",
          413,
        );
      }

      sources.push({
        id: `page-${page}`,
        label: `Page ${page}`,
        text: pageText,
      });
    }

    if (!sources.length) {
      if (lastVisionError) {
        const errorDetail =
          lastVisionError?.message ||
          (typeof lastVisionError === "string" ? lastVisionError : "Provider rejected request");
        throw new IngestionError(
          "OCR_REQUIRED",
          `Vision OCR failed: ${errorDetail}. Please check your OpenRouter / Gemini API key and account credits.`,
          422,
        );
      }
      if (!isVisionAvailable) {
        throw new IngestionError(
          "OCR_REQUIRED",
          "This PDF has no extractable text. Vision OCR is currently disabled because OPENROUTER_API_KEY (or GEMINI_API_KEY) is not active in this Vercel deployment. Add it in Vercel Project Settings and trigger a Redeploy.",
          422,
        );
      }
      throw new IngestionError(
        "OCR_REQUIRED",
        "This PDF has no extractable text. Run OCR or upload a text-based PDF, DOCX, or TXT file.",
        422,
      );
    }

    const warnings: string[] = [];
    if (emptyPages) {
      warnings.push(
        `${emptyPages} page(s) had no extractable text. Images and scanned content are not included.`,
      );
    }

    let visionBanner: string | null = null;
    if (flaggedCount > processedFlaggedCount) {
      visionBanner = `${flaggedCount} of ${totalPages} pages needed OCR; processed first ${processedFlaggedCount} — click to re-scan remaining`;
      warnings.push(visionBanner);
    }

    return {
      sources,
      pageCount: totalPages,
      warnings,
      imageHashes: Array.from(perceptualHashSet),
      visionBanner,
      lowConfidenceSourceIds,
      pageVisionStatus,
      ocrEquations,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new IngestionError(
        "PASSWORD_PROTECTED_PDF",
        "Remove the PDF password before uploading.",
        422,
      );
    }
    throw error;
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
}
