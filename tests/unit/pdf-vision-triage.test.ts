import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parsePdf,
  clearPdfVisionCacheForTests,
  getPdfVisionCacheSize,
  getPdfVisionCacheEntry,
  setPdfVisionCacheEntry,
  MAX_PDF_VISION_CACHE_ENTRIES,
  ESTIMATED_FULL_PAGE_OCR_USD,
  ESTIMATED_EQUATION_CROP_OCR_USD,
  MAX_AUTO_OCR_BUDGET_USD,
} from "@/lib/ingestion/parse-pdf";
import type { MockPdfPage, ParsePdfOptions } from "@/lib/ingestion/parse-pdf";

const dummyPdfBytes = Buffer.from("%PDF-1.4\n%mock pdf\n%%EOF");
const signal = () => new AbortController().signal;

describe("PDF Vision Triage & Multi-Signal Detection", () => {
  beforeEach(() => {
    clearPdfVisionCacheForTests();
  });

  describe("Multi-signal detection", () => {
    it("flags pages with <100 native characters as low_text", async () => {
      const mockPages: MockPdfPage[] = [
        {
          page: 1,
          text: "Short introductory slide text.",
          width: 612,
          height: 792,
          images: [],
          screenshot: new Uint8Array([1, 2, 3]),
        },
      ];

      const transcriber = vi.fn().mockResolvedValue({
        text: "Transcribed full slide content.",
        confidence: 0.95,
        costUsd: ESTIMATED_FULL_PAGE_OCR_USD,
      });

      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: transcriber,
      });

      const pageInfo = result.pageVisionStatus?.["page-1"];
      expect(pageInfo).toBeDefined();
      expect(pageInfo?.flagged).toBe(true);
      expect(pageInfo?.reasons).toContain("low_text");
      expect(pageInfo?.mode).toBe("full_page");
    });

    it("flags pages with single embedded image >8% of page area as single_image_area", async () => {
      // 612 x 792 = 484,704. 8% is ~38,776.
      // 250 x 200 = 50,000 (>10% of page area).
      const mockPages: MockPdfPage[] = [
        {
          page: 1,
          text: "This slide contains substantial native body text explaining macroeconomic principles that easily exceeds one hundred characters in total length.",
          width: 612,
          height: 792,
          images: [
            {
              data: new Uint8Array([10, 20, 30, 40]),
              width: 250,
              height: 200,
              name: "formula_img",
            },
          ],
        },
      ];

      const transcriber = vi.fn().mockResolvedValue({
        text: "$$Y = C + I + G + (X - M)$$",
        confidence: 0.98,
        costUsd: ESTIMATED_EQUATION_CROP_OCR_USD,
      });

      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: transcriber,
      });

      const pageInfo = result.pageVisionStatus?.["page-1"];
      expect(pageInfo).toBeDefined();
      expect(pageInfo?.flagged).toBe(true);
      expect(pageInfo?.reasons).toContain("single_image_area");
      expect(pageInfo?.reasons).not.toContain("low_text");
      expect(pageInfo?.mode).toBe("equation_crop");
    });

    it("flags pages with combined images >25% of page area as combined_image_area even if no single image exceeds 8%", async () => {
      // 612 x 792 = 484,704. 25% is ~121,176. 8% is ~38,776.
      // 4 images of 180 x 180 = 32,400 (6.68% each, below 8%).
      // 4 * 32,400 = 129,600 (26.7% of page area, exceeds 25%).
      const mockPages: MockPdfPage[] = [
        {
          page: 1,
          text: "Here is a slide with plenty of explanatory lecture text describing diverse market charts and diagrammatic models, exceeding one hundred characters easily.",
          width: 612,
          height: 792,
          images: [
            { data: new Uint8Array([1, 1]), width: 180, height: 180 },
            { data: new Uint8Array([2, 2]), width: 180, height: 180 },
            { data: new Uint8Array([3, 3]), width: 180, height: 180 },
            { data: new Uint8Array([4, 4]), width: 180, height: 180 },
          ],
        },
      ];

      const transcriber = vi.fn().mockResolvedValue({
        text: "Transcribed chart labels",
        confidence: 0.9,
        costUsd: ESTIMATED_EQUATION_CROP_OCR_USD,
      });

      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: transcriber,
      });

      const pageInfo = result.pageVisionStatus?.["page-1"];
      expect(pageInfo).toBeDefined();
      expect(pageInfo?.flagged).toBe(true);
      expect(pageInfo?.reasons).toContain("combined_image_area");
      expect(pageInfo?.reasons).not.toContain("single_image_area");
      expect(pageInfo?.reasons).not.toContain("low_text");
    });

    it("ignores repeated slide-master template images appearing on >50% of slides (with total >= 4)", async () => {
      // A common template logo image (250 x 200 = 50,000, >8% area) appears identically on all 4 slides.
      const sharedLogoData = new Uint8Array([100, 101, 102, 103, 104]);

      const mockPages: MockPdfPage[] = [1, 2, 3, 4].map((page) => ({
        page,
        text: `Slide ${page} contains standard detailed educational content that comfortably exceeds one hundred characters of explanatory text without difficulty.`,
        width: 612,
        height: 792,
        images: [
          {
            data: sharedLogoData,
            width: 250,
            height: 200,
            name: "school_header_logo",
          },
        ],
      }));

      const transcriber = vi.fn();
      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: transcriber,
      });

      // The repeated header logo should be filtered out by the slide-master logo guard
      expect(result.pageVisionStatus?.["page-1"]?.flagged).toBe(false);
      expect(result.pageVisionStatus?.["page-2"]?.flagged).toBe(false);
      expect(result.pageVisionStatus?.["page-3"]?.flagged).toBe(false);
      expect(result.pageVisionStatus?.["page-4"]?.flagged).toBe(false);
      expect(transcriber).not.toHaveBeenCalled();
    });
  });

  describe("Equation crop fast-path", () => {
    it("sends ONLY crop bytes with mode 'equation_crop' and appends LaTeX formula to native text", async () => {
      const formulaCropBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      const fullPageScreenshot = new Uint8Array([99, 98, 97, 96]);

      const mockPages: MockPdfPage[] = [
        {
          page: 1,
          text: "Recall that elasticity of demand measures the sensitivity of quantity demanded to changes in unit price according to the following mathematical relationship:",
          width: 612,
          height: 792,
          images: [
            {
              data: formulaCropBytes,
              width: 250,
              height: 200,
              name: "elasticity_equation",
            },
          ],
          screenshot: fullPageScreenshot,
        },
      ];

      const transcriber = vi.fn().mockImplementation(async (input) => {
        expect(input.mode).toBe("equation_crop");
        expect(input.imageBytes).toEqual(formulaCropBytes);
        expect(input.imageBytes).not.toEqual(fullPageScreenshot);
        return {
          text: "$$\\epsilon = \\frac{\\%\\Delta Q}{\\%\\Delta P}$$",
          confidence: 0.99,
          costUsd: ESTIMATED_EQUATION_CROP_OCR_USD,
        };
      });

      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: transcriber,
      });

      expect(transcriber).toHaveBeenCalledTimes(1);
      expect(result.sources[0].text).toContain("Recall that elasticity of demand");
      expect(result.sources[0].text).toContain("$$\\epsilon = \\frac{\\%\\Delta Q}{\\%\\Delta P}$$");
      expect(result.pageVisionStatus?.["page-1"]?.mode).toBe("equation_crop");
      expect(result.pageVisionStatus?.["page-1"]?.processed).toBe(true);
    });
  });

  describe("Auto-OCR budget cap ($0.03/deck)", () => {
    it("processes first 25 of 30 flagged pages at $0.0012 each, skips 5, and emits exact banner", async () => {
      const mockPages: MockPdfPage[] = Array.from({ length: 30 }, (_, i) => ({
        page: i + 1,
        text: "", // < 100 chars -> low_text flagged
        width: 612,
        height: 792,
        images: [],
        screenshot: new Uint8Array([i + 1, 10, 20, 30]), // distinct bytes per page
      }));

      const transcriber = vi.fn().mockImplementation(async ({ page }) => ({
        text: `Transcribed text for scanned page ${page}`,
        costUsd: ESTIMATED_FULL_PAGE_OCR_USD, // $0.0012
        confidence: 0.95,
      }));

      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        maxAutoOcrBudgetUsd: MAX_AUTO_OCR_BUDGET_USD, // $0.03
        visionTranscriber: transcriber,
      });

      // 25 pages * $0.0012 = $0.0300 (hits MAX_AUTO_OCR_BUDGET_USD). Pages 26-30 skipped.
      expect(transcriber).toHaveBeenCalledTimes(25);
      expect(result.pageVisionStatus?.["page-25"]?.processed).toBe(true);
      expect(result.pageVisionStatus?.["page-26"]?.processed).toBe(false);
      expect(result.pageVisionStatus?.["page-30"]?.processed).toBe(false);

      const expectedBanner =
        "30 of 30 pages needed OCR; processed first 25 — click to re-scan remaining";
      expect(result.visionBanner).toBe(expectedBanner);
      expect(result.warnings).toContain(expectedBanner);

      // Hard gate lowConfidenceSourceIds populated for budget-skipped low-text pages
      expect(result.lowConfidenceSourceIds).toEqual([
        "page-26",
        "page-27",
        "page-28",
        "page-29",
        "page-30",
      ]);
    });

    it("allows targeted rescanPages to bypass the auto-OCR cap", async () => {
      const mockPages: MockPdfPage[] = Array.from({ length: 30 }, (_, i) => ({
        page: i + 1,
        text: "",
        width: 612,
        height: 792,
        images: [],
        screenshot: new Uint8Array([i + 1, 11, 22, 33]),
      }));

      const transcriber = vi.fn().mockImplementation(async ({ page }) => ({
        text: `Transcribed text for page ${page}`,
        costUsd: ESTIMATED_FULL_PAGE_OCR_USD,
        confidence: 0.95,
      }));

      // Explicitly request page 26 and 27 via rescanPages
      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        maxAutoOcrBudgetUsd: MAX_AUTO_OCR_BUDGET_USD,
        rescanPages: [26, 27],
        visionTranscriber: transcriber,
      });

      // 25 initial pages + 2 targeted rescan pages = 27 invocations
      expect(transcriber).toHaveBeenCalledTimes(27);
      expect(result.pageVisionStatus?.["page-26"]?.processed).toBe(true);
      expect(result.pageVisionStatus?.["page-27"]?.processed).toBe(true);
      expect(result.lowConfidenceSourceIds).not.toContain("page-26");
      expect(result.lowConfidenceSourceIds).not.toContain("page-27");
    });
  });

  describe("Page-Image SHA-256 Hash Cache", () => {
    it("returns $0.00 cost and cached: true on repeat upload of identical image bytes", async () => {
      const identicalCrop = new Uint8Array([55, 66, 77, 88, 99]);

      const mockPages: MockPdfPage[] = [
        {
          page: 1,
          text: "A slide with more than one hundred characters of text describing key formulas that triggers an equation crop triage path.",
          width: 612,
          height: 792,
          images: [{ data: identicalCrop, width: 250, height: 200 }],
        },
      ];

      const transcriber = vi.fn().mockResolvedValue({
        text: "$$A^2 + B^2 = C^2$$",
        confidence: 0.97,
        costUsd: ESTIMATED_EQUATION_CROP_OCR_USD,
      });

      expect(getPdfVisionCacheSize()).toBe(0);

      // Run 1: Uncached
      const result1 = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: transcriber,
      });

      expect(transcriber).toHaveBeenCalledTimes(1);
      expect(result1.pageVisionStatus?.["page-1"]?.cached).toBe(false);
      expect(result1.pageVisionStatus?.["page-1"]?.costUsd).toBe(ESTIMATED_EQUATION_CROP_OCR_USD);
      expect(getPdfVisionCacheSize()).toBe(1);

      // Run 2: Exact identical bytes
      const result2 = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: transcriber,
      });

      // Transcriber was NOT called again
      expect(transcriber).toHaveBeenCalledTimes(1);
      expect(result2.pageVisionStatus?.["page-1"]?.cached).toBe(true);
      expect(result2.pageVisionStatus?.["page-1"]?.costUsd).toBe(0);
      expect(result2.sources[0].text).toContain("$$A^2 + B^2 = C^2$$");
    });
  });

  describe("Hard gate low confidence on failed vision pages", () => {
    it("populates lowConfidenceSourceIds when vision returns empty text or null", async () => {
      const mockPages: MockPdfPage[] = [
        {
          page: 1,
          text: "Very short",
          width: 612,
          height: 792,
          images: [],
          screenshot: new Uint8Array([1, 2, 3]),
        },
      ];

      const failingTranscriber = vi.fn().mockResolvedValue({
        text: "",
        confidence: 0,
      });

      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: failingTranscriber,
      });

      expect(result.lowConfidenceSourceIds).toContain("page-1");
      expect(result.pageVisionStatus?.["page-1"]?.lowConfidence).toBe(true);
    });

    it("populates lowConfidenceSourceIds when vision returns confidence below 0.4", async () => {
      const mockPages: MockPdfPage[] = [
        {
          page: 1,
          text: "Very short",
          width: 612,
          height: 792,
          images: [],
          screenshot: new Uint8Array([4, 5, 6]),
        },
      ];

      const lowConfTranscriber = vi.fn().mockResolvedValue({
        text: "Uncertain text",
        confidence: 0.25,
      });

      const result = await parsePdf(dummyPdfBytes, signal(), {
        mockPages,
        visionTranscriber: lowConfTranscriber,
      });

      expect(result.lowConfidenceSourceIds).toContain("page-1");
      expect(result.pageVisionStatus?.["page-1"]?.lowConfidence).toBe(true);
    });
  });

  describe("Bounded LRU Cache Eviction", () => {
    it("caps pdfVisionCache at MAX_PDF_VISION_CACHE_ENTRIES (500) and evicts oldest entries", () => {
      expect(getPdfVisionCacheSize()).toBe(0);

      // Insert 520 distinct cache entries
      for (let i = 0; i < 520; i++) {
        setPdfVisionCacheEntry(`full_page:sha-${i}`, {
          text: `Extracted content for page ${i}`,
          confidence: 0.95,
        });
      }

      expect(getPdfVisionCacheSize()).toBe(MAX_PDF_VISION_CACHE_ENTRIES);

      // Oldest entries 0 through 19 should have been evicted
      for (let i = 0; i < 20; i++) {
        expect(getPdfVisionCacheEntry(`full_page:sha-${i}`)).toBeUndefined();
      }

      // Newer entries (e.g. 20 through 519) should still exist
      const entry20 = getPdfVisionCacheEntry("full_page:sha-20");
      expect(entry20).toBeDefined();
      expect(entry20?.text).toBe("Extracted content for page 20");

      const entry519 = getPdfVisionCacheEntry("full_page:sha-519");
      expect(entry519).toBeDefined();
      expect(entry519?.text).toBe("Extracted content for page 519");
    });

    it("refreshes LRU order on cache hit so accessed entry is preserved on overflow", () => {
      // Insert up to MAX_PDF_VISION_CACHE_ENTRIES (500)
      for (let i = 0; i < MAX_PDF_VISION_CACHE_ENTRIES; i++) {
        setPdfVisionCacheEntry(`full_page:item-${i}`, {
          text: `Content for item ${i}`,
          confidence: 0.9,
        });
      }
      expect(getPdfVisionCacheSize()).toBe(500);

      // Cache hit on item-0: getPdfVisionCacheEntry refreshes its LRU order
      const hit = getPdfVisionCacheEntry("full_page:item-0");
      expect(hit).toBeDefined();
      expect(hit?.text).toBe("Content for item 0");

      // Insert item-500 (overflowing by 1)
      setPdfVisionCacheEntry("full_page:item-500", {
        text: "Content for item 500",
        confidence: 0.99,
      });

      expect(getPdfVisionCacheSize()).toBe(500);

      // Oldest unaccessed entry was item-1, so item-1 must be evicted
      expect(getPdfVisionCacheEntry("full_page:item-1")).toBeUndefined();

      // item-0 was touched right before overflow, so it MUST still be present
      const preservedItem0 = getPdfVisionCacheEntry("full_page:item-0");
      expect(preservedItem0).toBeDefined();
      expect(preservedItem0?.text).toBe("Content for item 0");
    });

    it("re-setting an existing key updates content, refreshes LRU order, and does not increase cache size", () => {
      for (let i = 0; i < 10; i++) {
        setPdfVisionCacheEntry(`key-${i}`, { text: `Original ${i}`, confidence: 0.5 });
      }
      expect(getPdfVisionCacheSize()).toBe(10);

      // Update key-0
      setPdfVisionCacheEntry("key-0", { text: "Updated 0", confidence: 0.99 });
      expect(getPdfVisionCacheSize()).toBe(10);

      const entry0 = getPdfVisionCacheEntry("key-0");
      expect(entry0?.text).toBe("Updated 0");
      expect(entry0?.confidence).toBe(0.99);
    });
  });
});
