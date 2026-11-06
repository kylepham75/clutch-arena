import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createCoachHandler,
  selectCoachContextSources,
  sanitizeCoachStreamError,
} from "@/lib/coach/handler";
import { buildCoachMessages } from "@/lib/ai/coach-prompt";
import {
  MAX_COACH_BODY_BYTES,
  MAX_COACH_CONTEXT_CHARS,
  MAX_COACH_HISTORY,
} from "@/lib/schemas/coach";
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

  it("passes auth.tier to getModel when authenticated paid user sends request", async () => {
    const mockModel: any = {
      specificationVersion: "v2",
      provider: "mock",
      modelId: "mock-model",
      supportedUrls: {},
      doStream: vi.fn(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", textDelta: "Pro coaching response." });
            controller.close();
          },
        }),
      })),
    };
    const getModelMock = vi.fn(() => mockModel);
    const verifyAuthMock = vi.fn(async () => ({
      authenticated: true as const,
      user: { id: "user-1", email: "test@example.com" } as any,
      tier: "pro" as const,
      tierExpiresAt: null,
    }));

    const handler = createCoachHandler({
      getModel: getModelMock,
      verifyAuth: verifyAuthMock,
      rateLimiter: vi.fn(async () => ({ allowed: true, limit: 10, remaining: 10, reset: 0, retryAfter: 0 })),
    });

    const res = await handler(
      coachRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Explain price elasticity" }] }],
        document: { fileName: doc.fileName, sources: doc.sources },
      }),
    );

    expect(res.status).toBe(200);
    expect(getModelMock).toHaveBeenCalledTimes(1);
    expect(getModelMock).toHaveBeenCalledWith("pro");
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

  it("defaults to active gemini-3.6-flash model instead of deprecated 2.5", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-abc-123");
    const { getGeminiModel } = await import("@/lib/ai/provider");
    const model: any = getGeminiModel();
    expect(model.modelId).toBe("gemini-3.6-flash");
  });

  it("limits coach to only using Claude Haiku 5.5 even for pro/paid tier", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-testkey123");
    const { getCoachModel, DEFAULT_GENERATOR_SLUG } = await import("@/lib/ai/provider");
    const proModel: any = getCoachModel("pro");
    expect(proModel.modelId).toBe(DEFAULT_GENERATOR_SLUG);
    expect(proModel.modelId).toBe("anthropic/claude-haiku-5.5");

    const cramModel: any = getCoachModel("cram_pass");
    expect(cramModel.modelId).toBe("anthropic/claude-haiku-5.5");
  });

  it("structures prompt with Feynman intuition, misconception trap breakdown, and step-by-step guidance", async () => {
    const { buildCoachSystemPrompt } = await import("@/lib/ai/coach-prompt");
    const promptVi = buildCoachSystemPrompt(
      { fileName: doc.fileName, sources: doc.sources },
      "vi",
    );
    expect(promptVi).toContain("Intuition First");
    expect(promptVi).toContain("Spot the Trap");
    expect(promptVi).toContain("Step-by-Step Walkthrough");
    expect(promptVi).toContain("Rule of Thumb");
    expect(promptVi).toContain("Vietnamese");

    const promptEn = buildCoachSystemPrompt(
      { fileName: doc.fileName, sources: doc.sources },
      "en",
    );
    expect(promptEn).toContain("English");
  });

  it("accurately targets Page 18 without substring collision on Page 1", () => {
    const deckSources = Array.from({ length: 25 }, (_, i) => ({
      id: `slide-${i + 1}`,
      label: `Page ${i + 1}`,
      text: `Slide content for topic on page ${i + 1}.`,
    }));

    // Test selectCoachContextSources with full citation string
    const selected = selectCoachContextSources(
      deckSources,
      {
        type: "explain",
        question: "What is preferred stock (cổ phiếu ưu đãi)?",
        options: ["A", "B", "C", "D"],
        correctIndex: 2,
        selected: 0,
        explanation: "Preferred stock has features of both equity and debt",
        topic: "Preferred Stock",
        rule: "Preferred stock dividend is fixed",
        sourceId: "FOW18_CF_SS2_Slides_Chapter 9.pdf · Page 18",
      },
      "Tại sao đáp án C đúng?",
    );

    expect(selected.some((s) => s.id === "slide-18")).toBe(true);
    expect(selected.some((s) => s.id === "slide-1")).toBe(false);
  });

  it("rejects chunked bodies exceeding MAX_COACH_BODY_BYTES with 413", async () => {
    const handler = createCoachHandler();
    const chunk1 = new Uint8Array(3 * 1024 * 1024); // 3 MB
    const chunk2 = new Uint8Array(3 * 1024 * 1024); // 3 MB (total 6 MB > 5 MB)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });
    const req = new Request("http://localhost:3000/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      // @ts-expect-error duplex is required in node environments for stream bodies
      duplex: "half",
    });
    const res = await handler(req);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error.code).toBe("REQUEST_TOO_LARGE");
  });

  it("rejects requests exceeding MAX_COACH_BODY_BYTES via content-length header with 413", async () => {
    const handler = createCoachHandler();
    const req = new Request("http://localhost:3000/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(MAX_COACH_BODY_BYTES + 1024),
      },
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error.code).toBe("REQUEST_TOO_LARGE");
  });

  it("returns 429 COGS_CEILING_EXCEEDED when user's COGS ceiling is exceeded", async () => {
    const getUserLedgerMock = vi.fn(async () => ({
      userId: "user:test",
      tier: "contender" as const,
      cogsSpentUsd: 0.95,
      cogsReservedUsd: 0.06,
      cogsCeilingUsd: 1.0,
      deckCreditsUsed: 5,
      deckCreditsLimit: 5,
      dailyBurstUsed: 0,
      dailyBurstDate: "2026-11-05",
      unlockedDecks: {},
    }));

    const handler = createCoachHandler({
      getUserLedger: getUserLedgerMock,
    });

    const res = await handler(
      coachRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Explain price elasticity" }] }],
        document: { fileName: doc.fileName, sources: doc.sources },
      }),
    );

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("COGS_CEILING_EXCEEDED");
    expect(json.error.message).toBe(
      "Monthly AI budget reached for your plan. Please upgrade or wait for the next billing cycle.",
    );
    expect(getUserLedgerMock).toHaveBeenCalledTimes(1);
  });

  it("records COGS via recordCogs when streaming finishes", async () => {
    const mockModel: any = {
      specificationVersion: "v2",
      provider: "mock",
      modelId: "mock-model",
      supportedUrls: {},
      doStream: vi.fn(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "text-start",
              id: "delta-1",
            });
            controller.enqueue({
              type: "text-delta",
              id: "delta-1",
              delta: "Elasticity response.",
            });
            controller.enqueue({
              type: "text-end",
              id: "delta-1",
            });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            });
            controller.close();
          },
        }),
      })),
    };

    const recordCogsMock = vi.fn(async (..._args: any[]) => ({
      ledger: {} as any,
      cogsStatus: { mode: "normal", remainingBudgetUsd: 1 } as any,
    }));

    const verifyAuthMock = vi.fn(async () => ({
      authenticated: true as const,
      user: { id: "user-42", email: "user42@example.com" } as any,
      tier: "pro" as const,
      tierExpiresAt: null,
    }));

    const handler = createCoachHandler({
      getModel: () => mockModel,
      recordCogs: recordCogsMock,
      verifyAuth: verifyAuthMock,
    });

    const res = await handler(
      coachRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Explain price elasticity" }] }],
        document: { fileName: doc.fileName, sources: doc.sources },
      }),
    );

    expect(res.status).toBe(200);
    // Consuming response stream drives streamText to completion and triggers onFinish
    await res.text();

    expect(recordCogsMock).toHaveBeenCalledTimes(1);
    const [actorKey, tier, costUsd, reservedUsd] = recordCogsMock.mock.calls[0];
    expect(actorKey).toBe("user:user-42");
    expect(tier).toBe("pro");
    // Math.max(0.000001, Number(((150 / 1_000_000) * 0.5).toFixed(6))) = 0.000075
    expect(costUsd).toBe(0.000075);
    expect(reservedUsd).toBe(0);
  });

  it("sanitizes stream errors without leaking sensitive details", async () => {
    // 1. Stack traces / file paths
    const stackErr = new Error("Database query timed out\n    at queryPostgres (/var/task/node_modules/pg/client.js:42:15)");
    expect(sanitizeCoachStreamError(stackErr)).toBe("AI Coach encountered an error. Please try again.");

    // 2. Windows paths
    const winPathErr = new Error("File missing: C:\\Users\\ADMIN\\Clutch Arena\\secrets.env line 4");
    expect(sanitizeCoachStreamError(winPathErr)).toBe("AI Coach encountered an error. Please try again.");

    // 3. Provider details and credentials
    const openRouterErr = new Error("OpenRouter endpoint 502 at https://openrouter.ai/api/v1/chat/completions with Bearer sk-or-v1-secret123");
    expect(sanitizeCoachStreamError(openRouterErr)).toBe("AI Coach encountered an error. Please try again.");

    // 4. Gemini internal error objects
    const geminiErr = {
      data: {
        error: {
          message: "GoogleGenerativeAI: Resource has been exhausted (e.g. check quota).",
        },
      },
    };
    expect(sanitizeCoachStreamError(geminiErr)).toBe("AI Coach encountered an error. Please try again.");

    // 5. Safe messages pass through
    expect(sanitizeCoachStreamError(new Error("The request was cancelled."))).toBe("The request was cancelled.");
    expect(sanitizeCoachStreamError(null)).toBe("AI Coach encountered an error. Please try again.");
    expect(sanitizeCoachStreamError(undefined)).toBe("AI Coach encountered an error. Please try again.");
  });

  it("sanitizes SSE stream error responses when model stream errors out", async () => {
    const mockModel: any = {
      specificationVersion: "v2",
      provider: "mock",
      modelId: "mock-model",
      supportedUrls: {},
      doStream: vi.fn(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "error",
              error: new Error("Crash at /var/task/node_modules/@google/genai/dist/client.js:10"),
            });
            controller.close();
          },
        }),
      })),
    };

    const handler = createCoachHandler({
      getModel: () => mockModel,
    });

    const res = await handler(
      coachRequest({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Explain price elasticity" }] }],
        document: { fileName: doc.fileName, sources: doc.sources },
      }),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("/var/task");
    expect(text).not.toContain("@google/genai");
    expect(text).toContain("AI Coach encountered an error. Please try again.");
  });
});
