import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { POST } from "@/app/api/notes/generate/route";
import { NextRequest } from "next/server";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";

describe("Clutch Notes AI API Endpoint (/api/notes/generate)", () => {
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

  it("authorizes Pro tier with valid slide content and synthesizes notes", async () => {
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
    expect(data.note).toBeDefined();
    expect(data.note.sections.length).toBeGreaterThanOrEqual(1);
  });

  it("authorizes Cram Pass tier with valid slide content and synthesizes notes", async () => {
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
    expect(data.note).toBeDefined();
    expect(data.note.sections.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 when request body contains empty slide content", async () => {
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
});
