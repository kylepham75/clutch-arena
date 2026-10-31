import { initPdfWorker } from "@/lib/polyfills/pdf-node-polyfills";
import type {
  PageVisionInfo,
  PageVisionMode,
  PageVisionReason,
  SourceBlock,
} from "@/lib/schemas/ingestion";
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

function hasValidOpenRouterKey(): boolean {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return Boolean(
    key &&
      key !== "your-openrouter-key-here" &&
      key !== "your-api-key-here" &&
      !key.includes("placeholder") &&
      key.length > 10,
  );
}

export const defaultOpenRouterVisionTranscriber: PdfVisionTranscriber = async ({
  imageBytes,
  mimeType,
  mode,
  signal,
}) => {
  if (!hasValidOpenRouterKey()) return null;
  const { generateText } = await import("ai");
  const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");

  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY!.trim(),
  });

  const prompt =
    mode === "equation_crop"
      ? "Transcribe all mathematical equations, formulas, and data tables visible in this image into clean LaTeX or Markdown tables. Return only the transcription."
      : "Transcribe all visible text, formulas (in LaTeX), and tables (in Markdown) on this page accurately. Return clean Markdown text.";

  const result = await generateText({
    model: openrouter("google/gemini-3.6-flash"),
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
          require_parameters: true,
          data_collection: "deny",
          zdr: true,
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
      options?.visionTranscriber || hasValidOpenRouterKey(),
    );
    const visionTranscriber =
      options?.visionTranscriber ??
      (hasValidOpenRouterKey()
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

    let flaggedCount = 0;
    let processedFlaggedCount = 0;

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
      for (const img of nonTemplateImages) {
        const area = img.width * img.height;
        totalNonTemplateArea += area;
        if (area / pageArea > 0.08) {
          hasSingleImageArea = true;
        }
      }
      if (hasSingleImageArea) {
        reasons.push("single_image_area");
      }
      if (totalNonTemplateArea / pageArea > 0.25) {
        reasons.push("combined_image_area");
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
      const qualifyingCrops = nonTemplateImages.filter(
        (img) =>
          (img.width * img.height) / pageArea > 0.08 ||
          reasons.includes("combined_image_area"),
      );

      const mode: PageVisionMode =
        rawNativeText.length >= 100 && qualifyingCrops.length > 0
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
              pageText = pageText
                ? `${pageText}\n\n${cached.text.trim()}`
                : cached.text.trim();
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
                  pageText = pageText
                    ? `${pageText}\n\n${text}`
                    : text;
                }
                pageConfidence = Math.min(pageConfidence, conf);
                anyCropHandled = true;
                if (conf < 0.4 || !text) {
                  visionFailed = true;
                }
              } else {
                visionFailed = true;
              }
            } catch {
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
              } catch {
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
