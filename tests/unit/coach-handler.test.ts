import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createCoachHandler } from "@/lib/coach/handler";
import { cleanCoachMathArtifacts } from "@/lib/math/latex";
import type { ParsedDocument } from "@/lib/schemas/ingestion";
import { studyText } from "../helpers/documents";

const doc: ParsedDocument = {
  fileName: "economics.txt",
  format: "txt",
  sources: [
    { id: "lines-1-10", label: "Lines 1–10", text: studyText.slice(0, 500) },
  ],
  characterCount: 500,
  pageCount: null,
  warnings: [],
};

function coachRequest(body: unknown) {
  return new Request("http://localhost:3000/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("coach HTTP handler", () => {
  it("rejects cross-origin requests", async () => {
    const handler = createCoachHandler();
    const req = new Request("http://localhost:3000/api/coach", {
      method: "POST",
      headers: {
        Origin: "http://malicious-site.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("validates request schema and rejects empty questions", async () => {
    const handler = createCoachHandler();
    const res = await handler(
      coachRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "   " }] }],
        document: doc,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_REQUEST");
  });

  it("reports unconfigured AI when API key is missing", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const handler = createCoachHandler();
    const res = await handler(
      coachRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Explain price elasticity" }] }],
        document: doc,
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("streams response successfully with a configured model", async () => {
    const mockModel: any = {
      specificationVersion: "v2",
      provider: "mock",
      modelId: "mock-model",
      supportedUrls: {},
      doStream: vi.fn(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", textDelta: "Elasticity measures responsiveness [[lines-1-10]]." });
            controller.close();
          },
        }),
      })),
    };
    const handler = createCoachHandler({ getModel: () => mockModel });
    const res = await handler(
      coachRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Explain price elasticity" }] }],
        document: doc,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("unwraps numbers and percentages wrapped in dollar signs or escaped %", () => {
    const raw = "For a stock with a beta of $1.29$, expected to move by $1.29\\%\\$$ for every $1\\%\\$$ move in the market.";
    const cleaned = cleanCoachMathArtifacts(raw);
    expect(cleaned).toBe("For a stock with a beta of 1.29, expected to move by 1.29% for every 1% move in the market.");
  });
});
