import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import { POST } from "@/app/api/notes/generate/route";
import { NextRequest } from "next/server";
import { generateClutchNote } from "@/lib/ai/generate-notes";
import { IngestionError } from "@/lib/ingestion/errors";
import { MAX_EXTRACTED_CHARACTERS, MAX_PDF_PAGES } from "@/lib/ingestion/limits";
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
});
