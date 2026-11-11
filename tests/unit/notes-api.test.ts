import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import { POST } from "@/app/api/notes/generate/route";
import { NextRequest } from "next/server";
import { generateClutchNote } from "@/lib/ai/generate-notes";
import { IngestionError } from "@/lib/ingestion/errors";
import { MAX_EXTRACTED_CHARACTERS, MAX_PDF_PAGES } from "@/lib/ingestion/limits";
import * as rateLimitModule from "@/lib/rate-limit";
import * as parseSlidesModule from "@/lib/notes/parse-slides";
import {
  resetQuotaLedgersForTests,
  getUserQuotaLedger,
  saveUserQuotaLedger,
  getSharedDeckCache,
  setSharedDeckCache,
  computeFileSha256,
  computeContentHash,
  rollbackDeckQuotaReservation,
} from "@/lib/rate-limit";

const NOTES_SHARED_CACHE_PIPELINE_VERSION = "notes-v1";
import type { ClutchNote } from "@/lib/schemas/notes";

vi.mock("@/lib/ai/generate-notes", () => ({
  generateClutchNote: vi.fn(),
}));

const mockNote: ClutchNote = {
  id: "note-test-pro-1",
  title: "CORPORATE FINANCE",
  subject: "Corporate Finance",
  createdAt: "2026-10-26T00:00:00.000Z",
  originalFileName: "Corporate_Finance_Valuation.pptx",
  originalSlideCount: 1,
  estimatedDistilledPages: 2,
  noiseReductionRate: 85,
  executiveSummary: "Concise valuation summary.",
  sections: [
    {
      id: "sec-a-1",
      letter: "A",
      titleVi: "A. ĐỊNH GIÁ DOANH NGHIỆP",
      titleEn: "",
      overview: "Tổng quan các phương pháp định giá.",
      bulletPoints: ["Giá trị nội tại của tài sản dựa trên dòng tiền tương lai."],
      formulas: [],
      subSections: [],
      keyTakeaways: null,
      sourceSlides: [1],
    },
  ],
  rawMarkdown: "# CORPORATE FINANCE\n\n## A. ĐỊNH GIÁ DOANH NGHIỆP",
};

describe("Clutch Notes AI API Endpoint (/api/notes/generate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQuotaLedgersForTests();
  });

  it("rejects Free / Contender tier with 403 PRO_SUBSCRIPTION_REQUIRED", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "contender",
        origin: "http://localhost:3000",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("PRO_SUBSCRIPTION_REQUIRED");
    expect(data.error.message).toContain("Pro Tier");
  });

  it("authorizes Pro tier with valid slide content, synthesizes notes, and returns { ok: true, note, warnings }", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Corporate_Finance_Valuation.pptx",
        sources: [
          {
            id: "slide-1",
            label: "Slide 1",
            text: "Dividend discount model: P0 = sum D_t / (1+r)^t. For constant growth: P0 = D1 / (r - g).",
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.note).toEqual(mockNote);
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "Corporate_Finance_Valuation.pptx",
        slideCount: 1,
      }),
    );
  });

  it("authorizes Cram Pass tier with valid slide content and synthesizes notes", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "cram_pass",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Macroeconomics_Slides.pptx",
        sources: [
          {
            id: "slide-1",
            label: "Slide 1",
            text: "IS-LM Model: Equilibrium in goods and money markets. IS: Y = C(Y-T) + I(r) + G. LM: M/P = L(r, Y).",
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.note).toEqual(mockNote);
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503 AI_NOT_CONFIGURED when no AI model is configured (never returning sample note)", async () => {
    vi.mocked(generateClutchNote).mockRejectedValueOnce(
      new IngestionError(
        "AI_NOT_CONFIGURED",
        "Clutch Notes AI is temporarily unavailable (AI provider not configured).",
        503,
      ),
    );

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Corporate_Finance.pptx",
        sources: [
          {
            id: "slide-1",
            label: "Slide 1",
            text: "WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("AI_NOT_CONFIGURED");
    expect(data.error.message).toContain("AI provider not configured");
    expect(data.note).toBeUndefined();
  });

  it("sanitizes and forwards client warnings in response payload", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const longWarningText = "W".repeat(350);
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Decks_With_Warnings.pptx",
        sources: [
          {
            id: "slide-1",
            label: "Slide 1",
            text: "Lecture text with imperfect OCR.",
          },
        ],
        warnings: [
          "Low-contrast math equation on Slide 4.",
          12345, // Non-string: must be filtered out
          null, // Non-string: must be filtered out
          longWarningText, // Exceeds 300 chars: must be truncated to 300
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.warnings).toHaveLength(2);
    expect(data.warnings[0]).toBe("Low-contrast math equation on Slide 4.");
    expect(data.warnings[1].length).toBe(300);
    expect(data.warnings[1]).toBe("W".repeat(300));
  });

  it("returns 400 INVALID_SLIDES_PAYLOAD when request body contains empty slide content", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Empty.pptx",
        sources: [],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_SLIDES_PAYLOAD");
  });

  it("returns 400 INVALID_SLIDES_PAYLOAD when sources is not an array", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "InvalidSources.pptx",
        sources: "this should be an array, not a string",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_SLIDES_PAYLOAD");
  });

  it("returns 400 INVALID_SLIDES_PAYLOAD when source items lack label or text", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "MalformedSources.pptx",
        sources: [
          { label: "Slide 1" }, // missing text
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_SLIDES_PAYLOAD");
    expect(data.error.message).toContain("string label and text");
  });

  it("returns 400 INVALID_SLIDES_PAYLOAD when source item is not an object", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "MalformedSources.pptx",
        sources: ["raw string instead of source block"],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_SLIDES_PAYLOAD");
  });

  it("returns 400 INVALID_SLIDES_PAYLOAD when focus is not a string", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "InvalidFocus.pptx",
        sources: [{ label: "Slide 1", text: "Some content" }],
        focus: 12345, // invalid focus type
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_SLIDES_PAYLOAD");
    expect(data.error.message).toContain("Focus must be a string");
  });

  it("returns 400 INVALID_SLIDES_PAYLOAD when neither sources nor slidesText is provided", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "NoContent.pptx",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_SLIDES_PAYLOAD");
  });

  it("returns 413 TOO_MUCH_TEXT when total characters in sources exceed MAX_EXTRACTED_CHARACTERS", async () => {
    const hugeText = "A".repeat(MAX_EXTRACTED_CHARACTERS + 10);
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Huge_Deck.pptx",
        sources: [
          {
            label: "Slide 1",
            text: hugeText,
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("TOO_MUCH_TEXT");
    expect(data.error.message).toContain("character limit");
  });

  it("returns 413 TOO_MUCH_TEXT when slidesText exceeds MAX_EXTRACTED_CHARACTERS", async () => {
    const hugeText = "B".repeat(MAX_EXTRACTED_CHARACTERS + 50);
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Huge_SlidesText.pptx",
        slidesText: hugeText,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("TOO_MUCH_TEXT");
  });

  it("returns 413 TOO_MANY_PAGES when slideCount or sources length exceeds MAX_PDF_PAGES", async () => {
    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "TooManyPages.pptx",
        slideCount: MAX_PDF_PAGES + 1,
        sources: [
          {
            label: "Slide 1",
            text: "Short text",
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("TOO_MANY_PAGES");
    expect(data.error.message).toContain(`Upload at most ${MAX_PDF_PAGES} slides`);
  });

  it("populates shared deck cache and records COGS on cache miss, then serves cached note without calling LLM on cache hit", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const slideSources = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "CAPM Formula: E(Ri) = Rf + Beta_i * (E(Rm) - Rf). Systematic risk cannot be diversified away.",
      },
    ];

    const fileBytes = Buffer.from("dummy-deck-content-for-capm-test");
    const fileSha256 = computeFileSha256(fileBytes);
    const contentHash = computeContentHash({
      normalizedText: slideSources[0].text,
      pageCount: 1,
    });

    vi.spyOn(parseSlidesModule, "parseSlideDeck").mockResolvedValue({
      fileName: "CAPM_Lecture.pptx",
      slideCount: 1,
      sources: slideSources,
      warnings: [],
      characterCount: slideSources[0].text.length,
      formulaInventory: [],
      contentHash,
      fileSha256,
      format: "pptx",
    });

    const makeRequest = () => {
      const formData = new FormData();
      const fakeFile = new File([fileBytes], "CAPM_Lecture.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      formData.append("file", fakeFile);
      return new NextRequest("http://localhost:3000/api/notes/generate", {
        method: "POST",
        headers: {
          "x-test-tier": "pro",
          "x-test-user-id": "user-notes-quota-1",
          "x-enforce-quota": "true",
          origin: "http://localhost:3000",
        },
        body: formData,
      });
    };

    // 1. First request: cache miss -> calls generateClutchNote, records COGS, populates cache
    const firstRes = await POST(makeRequest());
    expect(firstRes.status).toBe(200);
    const firstData = await firstRes.json();
    expect(firstData.ok).toBe(true);
    expect(firstData.note).toEqual(mockNote);
    expect(firstData.cached).toBeUndefined();
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1);

    const ledger = await getUserQuotaLedger("user-notes-quota-1", "pro");
    expect(ledger.deckCreditsUsed).toBe(1);
    expect(ledger.cogsSpentUsd).toBeGreaterThan(0);

    const cachedEntry = await getSharedDeckCache({
      contentHash,
      fileSha256,
      language: "en",
      mode: "notes",
      focusHash: "",
      pipelineVersion: "notes-v1",
    });
    expect(cachedEntry?.clutchNote).toEqual(mockNote);

    // 2. Second request: cache hit -> bypasses generateClutchNote and returns cached: true
    const secondRes = await POST(makeRequest());
    expect(secondRes.status).toBe(200);
    const secondData = await secondRes.json();
    expect(secondData.ok).toBe(true);
    expect(secondData.cached).toBe(true);
    expect(secondData.note).toEqual(mockNote);
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1);
  });

  it("blocks notes generation with 429 and specific reason code when user quota is exhausted", async () => {
    const exhaustedLedger = await getUserQuotaLedger("user-notes-exhausted", "cram_pass");
    exhaustedLedger.deckCreditsUsed = exhaustedLedger.deckCreditsLimit;
    await saveUserQuotaLedger(exhaustedLedger);

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "cram_pass",
        "x-test-user-id": "user-notes-exhausted",
        "x-enforce-quota": "true",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Quota_Exhausted_Slides.pptx",
        sources: [
          {
            id: "slide-1",
            label: "Slide 1",
            text: "Black-Scholes Option Pricing Model and implied volatility surface.",
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(429);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("DECK_CREDITS_EXCEEDED");
    expect(vi.mocked(generateClutchNote)).not.toHaveBeenCalled();
  });

  it("rolls back reserved deck quota and COGS when generateClutchNote throws an error", async () => {
    const rollbackSpy = vi.spyOn(rateLimitModule, "rollbackDeckQuotaReservation");
    vi.mocked(generateClutchNote).mockRejectedValueOnce(
      new Error("Academic synthesis engine timed out or threw unhandled exception"),
    );

    const slideSources = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Capital Structure and the Modigliani-Miller Theorem without taxes.",
      },
    ];

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        "x-test-user-id": "user-notes-rollback",
        "x-enforce-quota": "true",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Corporate_Finance_MM.pptx",
        sources: slideSources,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("SYNTHESIS_FAILED");
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(rollbackSpy).toHaveBeenCalledWith(
      "user-notes-rollback",
      "pro",
      expect.any(String),
      0.02,
    );

    // Verify user quota ledger was rolled back (0 credits consumed, 0 COGS reserved)
    const ledger = await getUserQuotaLedger("user-notes-rollback", "pro");
    expect(ledger.deckCreditsUsed).toBe(0);
    expect(ledger.cogsReservedUsd).toBe(0);
  });

  it("uses matching NOTES_SHARED_CACHE_PIPELINE_VERSION so subsequent requests hit cache without invoking LLM", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const slideSources = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Arbitrage Pricing Theory (APT) and multi-factor asset pricing models.",
      },
    ];

    const fileBytes = Buffer.from("dummy-deck-content-for-apt-models-test");
    const fileSha256 = computeFileSha256(fileBytes);
    const contentHash = computeContentHash({
      normalizedText: slideSources[0].text,
      pageCount: 1,
    });

    vi.spyOn(parseSlidesModule, "parseSlideDeck").mockResolvedValue({
      fileName: "APT_Models.pptx",
      slideCount: 1,
      sources: slideSources,
      warnings: [],
      characterCount: slideSources[0].text.length,
      formulaInventory: [],
      contentHash,
      fileSha256,
      format: "pptx",
    });

    const makeRequest = () => {
      const formData = new FormData();
      const fakeFile = new File([fileBytes], "APT_Models.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      formData.append("file", fakeFile);
      return new NextRequest("http://localhost:3000/api/notes/generate", {
        method: "POST",
        headers: {
          "x-test-tier": "pro",
          "x-test-user-id": "user-notes-cache-test",
          "x-enforce-quota": "true",
          origin: "http://localhost:3000",
        },
        body: formData,
      });
    };

    // 1st request: misses cache, invokes generateClutchNote, stores with NOTES_SHARED_CACHE_PIPELINE_VERSION
    const res1 = await POST(makeRequest());
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.ok).toBe(true);
    expect(data1.note).toEqual(mockNote);
    expect(data1.cached).toBeUndefined();
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1);

    const cachedEntry = await getSharedDeckCache({
      contentHash,
      fileSha256,
      language: "en",
      mode: "notes",
      focusHash: "",
      pipelineVersion: NOTES_SHARED_CACHE_PIPELINE_VERSION,
    });
    expect(cachedEntry?.clutchNote).toEqual(mockNote);
    expect(cachedEntry?.pipelineVersion).toBe(NOTES_SHARED_CACHE_PIPELINE_VERSION);

    // 2nd request: hits cache using matching NOTES_SHARED_CACHE_PIPELINE_VERSION, returns cached without calling generateClutchNote
    const res2 = await POST(makeRequest());
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.ok).toBe(true);
    expect(data2.cached).toBe(true);
    expect(data2.note).toEqual(mockNote);
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1); // not called again
  });

  it("skips setSharedDeckCache when fileSha256 is null (e.g. raw JSON input without binary upload)", async () => {
    const setCacheSpy = vi.spyOn(rateLimitModule, "setSharedDeckCache");
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const slideSources = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Unverified JSON slides payload without binary file upload.",
      },
    ];

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        "x-test-user-id": "user-notes-json-no-cache",
        "x-enforce-quota": "true",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Unverified.pptx",
        sources: slideSources,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.note).toEqual(mockNote);
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1);

    // Verify setSharedDeckCache was NOT called because fileSha256 is null
    expect(setCacheSpy).not.toHaveBeenCalled();

    // Verify nothing was cached
    const contentHash = computeContentHash({
      normalizedText: slideSources[0].text,
      pageCount: 1,
    });
    const cachedEntry = await getSharedDeckCache({
      contentHash,
      language: "en",
      mode: "notes",
      focusHash: "",
      pipelineVersion: NOTES_SHARED_CACHE_PIPELINE_VERSION,
    });
    expect(cachedEntry).toBeNull();
  });

  it("rejects with 429 and aborts early without calling parseSlideDeck when rate limit is exceeded on multipart upload", async () => {
    const parseDeckSpy = vi.spyOn(parseSlidesModule, "parseSlideDeck");
    vi.spyOn(rateLimitModule, "checkRateLimit").mockResolvedValueOnce({
      allowed: false,
      limit: 30,
      remaining: 0,
      reset: 60,
      retryAfter: 60,
    });

    const formData = new FormData();
    const fakeFile = new File([Buffer.from("dummy-deck-content-for-rate-limit-test")], "lecture.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    formData.append("file", fakeFile);

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
      },
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(429);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(parseDeckSpy).not.toHaveBeenCalled();
    expect(vi.mocked(generateClutchNote)).not.toHaveBeenCalled();
  });

  it("serves from shared deck cache and returns early without calling parseSlideDeck on multipart upload cache hit", async () => {
    const parseDeckSpy = vi.spyOn(parseSlidesModule, "parseSlideDeck");
    const fileBytes = Buffer.from("pre-cached-deck-bytes-for-notes-api-test");
    const fileSha256 = computeFileSha256(fileBytes);

    // Pre-populate shared cache entry with fileSha256
    await setSharedDeckCache({
      contentHash: "synthetic-cached-deck-hash-456",
      fileSha256,
      language: "en",
      mode: "notes",
      focusHash: "",
      pipelineVersion: NOTES_SHARED_CACHE_PIPELINE_VERSION,
      questionPool: [],
      clutchNote: mockNote,
    });

    const formData = new FormData();
    const fakeFile = new File([fileBytes], "cached-lecture.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    formData.append("file", fakeFile);

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
      },
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.cached).toBe(true);
    expect(data.note).toEqual(mockNote);
    expect(parseDeckSpy).not.toHaveBeenCalled();
    expect(vi.mocked(generateClutchNote)).not.toHaveBeenCalled();
  });

  it("sanitizes JSON sources with normalizePdfMathSymbols, control-char cleanup, deduplicateAnimationSlides, and extracts formula inventory", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "Corporate_Finance.pdf",
        sources: [
          {
            id: "slide-1",
            label: "Slide 1",
            // Contains PUA math symbols (\uF05B, \uF05D, \uF0B4, \uF0E5, \uF0E0) and control characters (\r\n, \t, \x00, \x08)
            text: "Valuation\r\n\tOverview:\x00\x08 \uF05B \uF0B4 \uF0E5 x \uF0E0 y \uF05D \t WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
          },
          {
            id: "slide-2",
            label: "Slide 2",
            // Animation build-up slide: subset of Slide 3
            text: "Dividend Discount Model: P0 = D1 / (r - g)",
          },
          {
            id: "slide-3",
            label: "Slide 3",
            // Final animated state containing Slide 2 text plus additional content
            text: "Dividend Discount Model: P0 = D1 / (r - g)\nWhere g is the constant perpetual dividend growth rate.",
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.warnings).toContain("Deduplicated 1 incremental animation slide(s).");

    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(generateClutchNote).mock.calls[0][0];

    // Slide 2 was deduplicated, leaving 2 slides
    expect(callArgs.sources).toHaveLength(2);
    expect(callArgs.slideCount).toBe(2);

    // Slide 1 has PUA symbols mapped and control characters stripped
    expect(callArgs.sources[0].text).toBe(
      "Valuation\nOverview: [ × ∑ x → y ] WACC = (E/V)*Re + (D/V)*Rd*(1-Tc)",
    );

    // Formula inventory was extracted from sanitized sources
    expect(callArgs.formulaInventory).toBeDefined();
    expect(Array.isArray(callArgs.formulaInventory)).toBe(true);
    expect(callArgs.formulaInventory?.length).toBeGreaterThan(0);
  });

  it("sanitizes JSON slidesText with normalizePdfMathSymbols and control-char cleanup", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(mockNote);

    const request = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "SingleText.pdf",
        slidesText: "Lecture Notes:\r\n\t\x00\x08 \uF05B \uF0D6 x \uF05D \t CAPM: E(R) = Rf + beta*(E(Rm) - Rf)",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const callArgs = vi.mocked(generateClutchNote).mock.calls[0][0];
    expect(callArgs.sources[0].text).toBe(
      "Lecture Notes:\n[ √ x ] CAPM: E(R) = Rf + beta*(E(Rm) - Rf)",
    );
    expect(callArgs.formulaInventory).toBeDefined();
  });
});
