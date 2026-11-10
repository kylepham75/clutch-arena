import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import { NextRequest } from "next/server";
import { POST as notesPOST } from "@/app/api/notes/generate/route";
import { createIngestionHandler } from "@/lib/ingestion/handler";
import { generateClutchNote } from "@/lib/ai/generate-notes";
import * as parseSlidesModule from "@/lib/notes/parse-slides";
import {
  resetQuotaLedgersForTests,
  computeFileSha256,
  computeContentHash,
  setSharedDeckCache,
  getCachedParsedDocument,
} from "@/lib/rate-limit";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { ClutchNote } from "@/lib/schemas/notes";
import type { GenerationResult } from "@/lib/schemas/ingestion";
import { makePdf } from "../helpers/documents";

vi.mock("@/lib/ai/generate-notes", () => ({
  generateClutchNote: vi.fn(),
}));

const sampleNote: ClutchNote = {
  id: "note-cache-bridge-1",
  title: "CORPORATE FINANCE: CAPM",
  subject: "Finance",
  createdAt: "2026-11-10T00:00:00.000Z",
  originalFileName: "CAPM.pdf",
  originalSlideCount: 2,
  estimatedDistilledPages: 1,
  noiseReductionRate: 88,
  executiveSummary: "CAPM core asset pricing relationship.",
  sections: [
    {
      id: "sec-a",
      letter: "A",
      titleVi: "A. MÔ HÌNH CAPM",
      titleEn: "CAPM Model",
      overview: "Systematic risk determines expected asset return.",
      bulletPoints: ["Expected return depends on beta, risk-free rate, and market risk premium."],
      formulas: [],
      subSections: [],
      keyTakeaways: null,
      sourceSlides: [1, 2],
    },
  ],
  rawMarkdown: "# CAPM",
};

const sampleQuizResult: GenerationResult = {
  pack: {
    ...mockMicroeconomics,
    id: "pack-capm-1",
    title: "CAPM Quiz Deck",
  },
  sourceKind: "lecture",
  references: {},
  warnings: [],
  usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
};

describe("Shared Ingestion Cache Bridge (Clutch Notes <-> Quiz Arena)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetQuotaLedgersForTests();
  });

  it("retrieves pre-parsed slide sources from getCachedParsedDocument by fileSha256", async () => {
    const fileBytes = Buffer.from("shared-cache-bridge-bytes-123");
    const fileSha256 = computeFileSha256(fileBytes);
    const sources = [
      { id: "slide-1", label: "Slide 1", text: "Expected Return E(R) = Rf + Beta * (Rm - Rf)" },
      { id: "slide-2", label: "Slide 2", text: "Systematic risk cannot be diversified away." },
    ];
    const contentHash = computeContentHash({
      normalizedText: sources.map((s) => s.text).join("\n"),
      pageCount: 2,
    });

    await setSharedDeckCache({
      contentHash,
      fileSha256,
      language: "en",
      mode: "notes",
      focusHash: "",
      pipelineVersion: "notes-v1",
      questionPool: [],
      clutchNote: sampleNote,
      studyMetadata: {
        fileName: "CAPM.pdf",
        slideCount: 2,
        sources,
        format: "pdf",
      },
    });

    const cachedDoc = await getCachedParsedDocument(fileSha256);
    expect(cachedDoc).not.toBeNull();
    expect(cachedDoc?.fileName).toBe("CAPM.pdf");
    expect(cachedDoc?.format).toBe("pdf");
    expect(cachedDoc?.pageCount).toBe(2);
    expect(cachedDoc?.sources).toEqual(sources);
    expect(cachedDoc?.contentHash).toBe(contentHash);
  });

  it("reuses Clutch Notes extracted slides in Quiz Arena (/api/ingest) without re-parsing the PDF", async () => {
    vi.mocked(generateClutchNote).mockResolvedValueOnce(sampleNote);

    const pdfBytes = Buffer.from(
      makePdf([
        "Slide 1: CAPM Formula E(Ri) = Rf + Beta * (E(Rm) - Rf). Systematic risk.",
        "Slide 2: Security Market Line plots expected return against beta.",
      ]),
    );
    const fileSha256 = computeFileSha256(pdfBytes);
    const sources = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Slide 1: CAPM Formula E(Ri) = Rf + Beta * (E(Rm) - Rf). Systematic risk.",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Slide 2: Security Market Line plots expected return against beta.",
      },
    ];

    // Step 1: Student generates a summarized note using client-extracted JSON + fileSha256
    const notesReq = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        "x-test-user-id": "user-bridge-1",
        "x-enforce-quota": "true",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fileName: "CAPM.pdf",
        slideCount: 2,
        sources,
        fileSha256,
      }),
    });

    const notesRes = await notesPOST(notesReq);
    expect(notesRes.status).toBe(200);
    const notesJson = await notesRes.json();
    expect(notesJson.ok).toBe(true);
    expect(notesJson.fileSha256).toBe(fileSha256);
    expect(notesJson.sources).toEqual(sources);

    // Step 2: Student clicks "Create Quiz Deck" with the same PDF file
    const parseDocSpy = vi.fn().mockRejectedValue(new Error("Should not re-parse PDF!"));
    const generateQuizSpy = vi.fn().mockResolvedValue(sampleQuizResult);

    const ingestHandler = createIngestionHandler({
      parseDoc: parseDocSpy,
      generate: generateQuizSpy,
      checkConfiguration: () => {},
      getCachedParsedDoc: getCachedParsedDocument,
      verifyAuth: vi.fn().mockResolvedValue({
        authenticated: true,
        user: { id: "user-bridge-1" },
        tier: "pro",
        tierExpiresAt: null,
      }),
    });

    const formData = new FormData();
    formData.set("file", new File([pdfBytes], "CAPM.pdf", { type: "application/pdf" }));
    formData.set(
      "options",
      JSON.stringify({
        operation: "generate",
        questionCount: 5,
        mode: "variants",
        language: "en",
      }),
    );

    const ingestReq = new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
      },
      body: formData,
    });

    const ingestRes = await ingestHandler(ingestReq);
    expect(ingestRes.status).toBe(200);
    const ingestJson = await ingestRes.json();
    expect(ingestJson.ok).toBe(true);
    expect(ingestJson.pack.title).toBe("CAPM Quiz Deck");

    // Verify parseDoc was completely skipped because sources came from the shared cache!
    expect(parseDocSpy).not.toHaveBeenCalled();
    expect(generateQuizSpy).toHaveBeenCalledTimes(1);
    expect(generateQuizSpy.mock.calls[0][0].sources).toEqual(sources);
  });

  it("reuses Quiz Arena parsed slides in Clutch Notes AI without calling parseSlideDeck", async () => {
    const parseSlideDeckSpy = vi.spyOn(parseSlidesModule, "parseSlideDeck");
    vi.mocked(generateClutchNote).mockResolvedValueOnce(sampleNote);

    const pdfBytes = Buffer.from(
      makePdf([
        "Slide 1: Discounted Cash Flow Valuation and Terminal Growth Rate.",
        "Slide 2: Free Cash Flow to Firm (FCFF) discounts at WACC.",
      ]),
    );
    const fileSha256 = computeFileSha256(pdfBytes);
    const preParsedSources = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Discounted Cash Flow Valuation and Terminal Growth Rate.",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Free Cash Flow to Firm (FCFF) discounts at WACC.",
      },
    ];
    const contentHash = computeContentHash({
      normalizedText: preParsedSources.map((s) => s.text).join("\n"),
      pageCount: 2,
    });

    // Simulate Quiz Arena previously having parsed and cached this document
    await setSharedDeckCache({
      contentHash,
      fileSha256,
      language: "en",
      mode: "variants",
      focusHash: "",
      pipelineVersion: "v1",
      questionPool: sampleQuizResult.pack.questions,
      studyMetadata: {
        fileName: "Valuation.pdf",
        slideCount: 2,
        sources: preParsedSources,
        format: "pdf",
      },
    });

    // Now student uploads the same file via multipart to Clutch Notes AI
    const formData = new FormData();
    formData.set("file", new File([pdfBytes], "Valuation.pdf", { type: "application/pdf" }));

    const notesReq = new NextRequest("http://localhost:3000/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
        "x-test-user-id": "user-bridge-2",
        "x-enforce-quota": "true",
        origin: "http://localhost:3000",
      },
      body: formData,
    });

    const notesRes = await notesPOST(notesReq);
    expect(notesRes.status).toBe(200);
    const notesJson = await notesRes.json();
    expect(notesJson.ok).toBe(true);
    expect(notesJson.note).toEqual(sampleNote);
    expect(notesJson.fileSha256).toBe(fileSha256);

    // parseSlideDeck must NOT be called because Quiz Arena already cached the parsed slides!
    expect(parseSlideDeckSpy).not.toHaveBeenCalled();
    expect(vi.mocked(generateClutchNote)).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: preParsedSources,
        slideCount: 2,
      }),
    );
  });
});
