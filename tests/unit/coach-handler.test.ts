import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createCoachHandler,
  selectCoachContextSources,
} from "@/lib/coach/handler";
import { buildCoachMessages } from "@/lib/ai/coach-prompt";
import { MAX_COACH_CONTEXT_CHARS, MAX_COACH_HISTORY } from "@/lib/schemas/coach";
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
        document: { fileName: doc.fileName, sources: doc.sources },
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
        document: { fileName: doc.fileName, sources: doc.sources },
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
        document: { fileName: doc.fileName, sources: doc.sources },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("caps coach source context to matched citation block + surrounding neighbors (~1,500 tokens) and trims history to last 6 messages", () => {
    expect(MAX_COACH_HISTORY).toBe(6);
    expect(MAX_COACH_CONTEXT_CHARS).toBe(6_000);

    const manySources = Array.from({ length: 20 }, (_, i) => ({
      id: `page-${i + 1}`,
      label: `Page ${i + 1}`,
      text: `Content for page ${i + 1}. `.repeat(120), // ~2,400 chars per block (48,000 chars total)
    }));

    const selected = selectCoachContextSources(
      manySources,
      {
        type: "explain",
        question: "What is on page 10?",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        selected: 1,
        explanation: "See page 10",
        topic: "Topic 10",
        rule: "Rule 10",
        sourceId: "page-10",
      },
      "Why did I miss this?",
    );

    const totalSelectedChars = selected.reduce((sum, s) => sum + s.text.length, 0);
    expect(totalSelectedChars).toBeLessThanOrEqual(MAX_COACH_CONTEXT_CHARS);
    expect(selected.some((s) => s.id === "page-10")).toBe(true);
    expect(selected.every((s) => ["page-9", "page-10", "page-11"].includes(s.id))).toBe(true);

    const tenMessages = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i + 1}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      parts: [{ type: "text", text: `Turn ${i + 1}` }],
    }));
    const modelMessages = buildCoachMessages(tenMessages);
    expect(modelMessages.length).toBeLessThanOrEqual(6);
    expect(modelMessages[0]).toEqual({ role: "user", content: "Turn 5" });
  });

  it("unwraps numbers and percentages wrapped in dollar signs or escaped %", () => {
    const raw = "For a stock with a beta of $1.29$, expected to move by $1.29\\%\\$$ for every $1\\%\\$$ move in the market.";
    const cleaned = cleanCoachMathArtifacts(raw);
    expect(cleaned).toBe("For a stock with a beta of 1.29, expected to move by 1.29% for every 1% move in the market.");
  });

  it("defaults to active gemini-3.5-flash-lite model instead of deprecated 2.5", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-abc-123");
    const { getGeminiModel } = await import("@/lib/ai/provider");
    const model: any = getGeminiModel();
    expect(model.modelId).toBe("gemini-3.5-flash-lite");
  });
});
