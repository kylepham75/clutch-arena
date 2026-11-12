import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createIngestionHandler, SHARED_CACHE_PIPELINE_VERSION } from "@/lib/ingestion/handler";
import { IngestionError } from "@/lib/ingestion/errors";
import { REQUEST_TIMEOUT_MS } from "@/lib/ingestion/limits";
import {
  resetQuotaLedgersForTests,
  saveUserQuotaLedger,
  toClientQuota,
  type RollingQuotaSnapshot,
} from "@/lib/rate-limit";
import type { CogsBudgetStatus } from "@/lib/pricing/tiers";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { GenerationResult } from "@/lib/schemas/ingestion";
import { studyText } from "../helpers/documents";

const result: GenerationResult = {
  pack: mockMicroeconomics,
  sourceKind: "lecture",
  references: {},
  warnings: [],
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
};

function makeQuotaSnapshot(
  overrides: Partial<RollingQuotaSnapshot> = {},
): RollingQuotaSnapshot {
  const mode = overrides.mode ?? "full";
  const degradationStatus: CogsBudgetStatus = {
    mode,
    spentUsd: 0.02,
    reservedUsd: 0,
    projectedUsd: 0.02,
    ceilingUsd: 0.4,
    utilizationRatio: 0.05,
    targetQuestionCount: 25,
    allowVisionOcr: mode === "full" || mode === "gentle",
    allowBorderlineVision: mode === "full",
    allowCrossFamilyVerifier: mode === "full" || mode === "gentle",
    useCheaperGeneratorSlug: mode !== "full",
    conciseExplanations: mode !== "full",
    serveCachedPoolsOnly: mode === "halted",
    bannerNotice: null,
    ...(overrides.degradationStatus ?? {}),
  };
  return {
    remainingPct: 95,
    usedPct: 5,
    resetsAt: "2026-11-13T00:00:00.000Z",
    windowHours: 24,
    bottleneckScope: "window",
    mode,
    windowBudgetUsd: 0.4,
    windowRemainingUsd: 0.38,
    guardBudgetUsd: 0.85,
    guardRemainingUsd: 0.83,
    cycleCeilingUsd: 3.8,
    cycleRemainingUsd: 3.78,
    effectiveRemainingUsd: 0.38,
    allowVisionOcr: degradationStatus.allowVisionOcr,
    allowBorderlineVision: degradationStatus.allowBorderlineVision,
    useCheaperGeneratorSlug: degradationStatus.useCheaperGeneratorSlug,
    serveCachedPoolsOnly: degradationStatus.serveCachedPoolsOnly,
    ...overrides,
    degradationStatus,
  };
}

function upload(
  options: unknown = { operation: "preview" },
  file = new File([studyText], "notes.txt"),
  headers?: HeadersInit,
) {
  const form = new FormData();
  form.set("file", file);
  form.set("options", JSON.stringify(options));
  return new Request("http://localhost:3000/api/ingest", {
    method: "POST",
    body: form,
    ...(headers ? { headers } : {}),
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetQuotaLedgersForTests();
});

describe("ingestion HTTP handler", () => {
  it("previews without invoking the AI or requiring credentials", async () => {
    const generate = vi.fn();
    const checkConfiguration = vi.fn();
    const response = await createIngestionHandler({
      generate,
      checkConfiguration,
    })(upload());
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(json.document.sources[0].text).toBe(studyText);
    expect(json.requestId).toBe(response.headers.get("x-request-id"));
    expect(generate).not.toHaveBeenCalled();
    expect(checkConfiguration).not.toHaveBeenCalled();
  });
  it("passes source text and validated settings to generation and returns the pack", async () => {
    const generate = vi.fn().mockResolvedValue(result);
    const response = await createIngestionHandler({
      generate,
      checkConfiguration: () => {},
    })(
      upload({
        operation: "generate",
        questionCount: 5,
        focus: "Chapter 4",
        language: "vi",
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pack.id).toBe(mockMicroeconomics.id);
    expect(generate.mock.calls[0][0].sources[0].text).toBe(studyText);
    expect(generate.mock.calls[0][1]).toMatchObject({
      questionCount: 5,
      focus: "Chapter 4",
      language: "vi",
      mode: "variants",
    });
  });
  it("reports a missing key with a useful 503", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const response = await createIngestionHandler()(
      upload({ operation: "generate" }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("AI_NOT_CONFIGURED");
  });
  it.each([
    { questionCount: 0 },
    { questionCount: 36 },
    { questionCount: "5" },
    { language: "xx" },
    { mode: "anything" },
    { focus: "x".repeat(1001) },
    { apiKey: "never accepted" },
  ])("rejects invalid options", async (options) => {
    const response = await createIngestionHandler()(
      upload({ operation: "preview", ...options }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_OPTIONS");
  });
  it("rejects malformed multipart, missing files and duplicate fields", async () => {
    const handler = createIngestionHandler();
    const malformed = await handler(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        body: "broken",
        headers: { "content-type": "multipart/form-data; boundary=x" },
      }),
    );
    expect(malformed.status).toBe(400);
    for (const kind of ["missing", "duplicate", "bad-json"]) {
      const form = new FormData();
      if (kind !== "missing")
        form.append("file", new File([studyText], "a.txt"));
      if (kind === "duplicate")
        form.append("file", new File([studyText], "b.txt"));
      form.set(
        "options",
        kind === "bad-json" ? "{wrong" : '{"operation":"preview"}',
      );
      expect(
        (
          await handler(
            new Request("http://localhost/api/ingest", {
              method: "POST",
              body: form,
            }),
          )
        ).status,
      ).toBe(400);
    }
  });
  it("rejects cross-origin requests and nonmultipart bodies", async () => {
    const request = upload();
    request.headers.set("origin", "https://other.example");
    expect((await createIngestionHandler()(request)).status).toBe(403);
    expect(
      (
        await createIngestionHandler()(
          new Request("http://localhost/api/ingest", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
  });
  it("enforces the measured body limit without trusting Content-Length", async () => {
    const request = new Request("http://localhost/api/ingest", {
      method: "POST",
      body: new Uint8Array(26 * 1024 * 1024),
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    const response = await createIngestionHandler()(request);
    expect(response.status).toBe(413);
  });
  it("does not leak unexpected upstream errors", async () => {
    const response = await createIngestionHandler({
      checkConfiguration: () => {},
      generate: async () => {
        throw new Error("secret key and private document content");
      },
    })(upload({ operation: "generate" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret key");
  });
  it("times out even a stalled upload stream", async () => {
    vi.useFakeTimers();
    const request = new Request("http://localhost/api/ingest", {
      method: "POST",
      body: new ReadableStream(),
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    const pending = createIngestionHandler()(request);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    const response = await pending;
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("INGESTION_TIMEOUT");
  });
  it("releases processing slots on failure", async () => {
    const handler = createIngestionHandler({
      checkConfiguration: () => {
        throw new IngestionError("AI_NOT_CONFIGURED", "Missing key", 503);
      },
    });
    for (let i = 0; i < 4; i++)
      expect((await handler(upload({ operation: "generate" }))).status).toBe(
        503,
      );
    expect((await handler(upload())).status).toBe(200);
  });
  it("limits concurrent work and releases slots when requests finish", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      await gate;
      return result;
    });
    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
    });
    const requests = [
      handler(upload({ operation: "generate" })),
      handler(upload({ operation: "generate" })),
    ];
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    const busy = await handler(upload());
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("30");
    release();
    await Promise.all(requests);
    expect((await handler(upload())).status).toBe(200);
  });

  it("bypasses LLM generation on shared deck cache hit and returns cached result", async () => {
    const generate = vi.fn();
    const getDeckCache = vi.fn().mockResolvedValue({
      id: "cached-deck-1",
      contentHash: "hash-123",
      language: "en",
      mode: "variants",
      focusHash: "",
      pipelineVersion: "v1",
      questionPool: mockMicroeconomics.questions,
      studyMetadata: {
        pack: mockMicroeconomics,
        sourceKind: "lecture",
        references: {},
        warnings: ["Cached warning"],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      hitCount: 2,
    });

    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
    });

    const response = await handler(
      upload({
        operation: "generate",
        questionCount: 5,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cached).toBe(true);
    expect(body.pack.questions.length).toBeLessThanOrEqual(5);
    expect(body.quota).toBeDefined();
    expect(body.quota).toMatchObject({
      remainingPct: expect.any(Number),
      usedPct: expect.any(Number),
      windowHours: expect.any(Number),
      bottleneckScope: expect.any(String),
      mode: expect.any(String),
    });
    expect(body.quota.windowBudgetUsd).toBeUndefined();
    expect(body.quota.cogsCeilingUsd).toBeUndefined();
    expect(getDeckCache).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("blocks generation with 429, rolling quota payload, and specific reason code when quotaReservation returns allowed: false", async () => {
    const generate = vi.fn();
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const depletedSnapshot = makeQuotaSnapshot({
      remainingPct: 0,
      usedPct: 100,
      mode: "halted",
      windowRemainingUsd: 0,
      effectiveRemainingUsd: 0,
      allowVisionOcr: false,
      serveCachedPoolsOnly: true,
    });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: false,
      reason: "DECK_CREDITS_EXCEEDED",
      cacheHit: false,
      creditConsumed: false,
      isRegeneration: false,
      creditsUsed: 2,
      creditsLimit: 2,
      dailyBurstUsed: 1,
      dailyBurstLimit: 2,
      cogsStatus: depletedSnapshot.degradationStatus,
      quota: depletedSnapshot,
      ledger: {} as any,
    });

    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
    });

    const response = await handler(
      upload({
        operation: "generate",
        questionCount: 5,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("DECK_CREDITS_EXCEEDED");
    expect(body.error.message).toContain("0% remaining");
    expect(body.quota).toEqual(toClientQuota(depletedSnapshot));
    expect(body.quota.windowBudgetUsd).toBeUndefined();
    expect(body.quota.cogsCeilingUsd).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });

  it("records COGS with authoritative billingRegion and attaches client quota on cache miss", async () => {
    const generate = vi.fn().mockResolvedValue(result);
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const reservedSnapshot = makeQuotaSnapshot({ remainingPct: 90, usedPct: 10 });
    const settledSnapshot = makeQuotaSnapshot({ remainingPct: 88, usedPct: 12 });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 1,
      creditsLimit: 2,
      dailyBurstUsed: 1,
      dailyBurstLimit: 2,
      cogsStatus: reservedSnapshot.degradationStatus,
      quota: reservedSnapshot,
      ledger: {} as any,
    });
    const recordCogs = vi.fn().mockResolvedValue({
      ledger: {} as any,
      cogsStatus: settledSnapshot.degradationStatus,
      quota: settledSnapshot,
    });
    const setDeckCache = vi.fn().mockResolvedValue({});

    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
      recordCogs,
      setDeckCache,
    });

    const response = await handler(
      upload(
        {
          operation: "generate",
          questionCount: 5,
          focus: "Elasticity",
          language: "en",
        },
        new File([studyText], "notes.txt"),
        { "x-vercel-ip-country": "VN" },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.quota).toEqual(toClientQuota(settledSnapshot));
    expect(body.quota.windowBudgetUsd).toBeUndefined();
    expect(body.quota.cogsCeilingUsd).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(quotaReservation).toHaveBeenCalledTimes(1);
    expect(quotaReservation).toHaveBeenCalledWith(
      expect.stringContaining("ip:"),
      "guest",
      expect.any(String),
      expect.objectContaining({
        actionKind: "deck",
        region: "VN",
      }),
    );
    expect(recordCogs).toHaveBeenCalledTimes(1);
    expect(recordCogs).toHaveBeenCalledWith(
      expect.stringContaining("ip:"),
      "guest",
      expect.any(Number),
      expect.any(Number),
      "VN",
    );
    expect(setDeckCache).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "en",
        mode: "variants",
        pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
        questionPool: result.pack.questions,
      }),
    );
  });

  it("calls rollbackDeckQuotaReservation once with reserved actor, hash, and cost when upstream AI generation throws an error", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Upstream Anthropic / Gemini generation timeout"));
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 1,
      creditsLimit: 2,
      dailyBurstUsed: 1,
      dailyBurstLimit: 2,
      cogsStatus: {} as any,
      ledger: {} as any,
    });
    const rollbackQuota = vi.fn().mockResolvedValue({ success: true, decksGeneratedCount: 0 });

    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
      rollbackQuota,
    });

    const response = await handler(
      upload({
        operation: "generate",
        questionCount: 5,
        focus: "Macroeconomics",
        language: "en",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INGESTION_FAILED");
    expect(quotaReservation).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(rollbackQuota).toHaveBeenCalledTimes(1);
    expect(rollbackQuota).toHaveBeenCalledWith(
      expect.stringContaining("ip:"),
      "guest",
      expect.any(String),
      0.02,
      undefined,
      "ROW",
    );
  });

  it("uses matching SHARED_CACHE_PIPELINE_VERSION in getDeckCache and setDeckCache so repeat uploads hit shared cache", async () => {
    let memoryCache: any = null;
    const generate = vi.fn().mockResolvedValue({
      ...result,
      pipelineVersion: "3.0.0-final+gemini+claude",
    });
    const getDeckCache = vi.fn().mockImplementation(async (key: any) => {
      if (memoryCache && memoryCache.pipelineVersion === key.pipelineVersion) {
        return memoryCache;
      }
      return null;
    });
    const setDeckCache = vi.fn().mockImplementation(async (entry: any) => {
      memoryCache = {
        ...entry,
        hitCount: 1,
      };
      return memoryCache;
    });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 1,
      creditsLimit: 2,
      dailyBurstUsed: 1,
      dailyBurstLimit: 2,
      cogsStatus: {} as any,
      ledger: {} as any,
    });
    const recordCogs = vi.fn().mockResolvedValue({ ledger: {} as any, cogsStatus: {} as any });

    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      setDeckCache,
      quotaReservation,
      recordCogs,
    });

    // 1st upload: cache miss, triggers generation, saves to cache with SHARED_CACHE_PIPELINE_VERSION
    const res1 = await handler(
      upload({
        operation: "generate",
        questionCount: 5,
        focus: "Microeconomics",
        language: "en",
      }),
    );
    expect(res1.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
      }),
    );

    // 2nd upload with identical document: invokes getDeckCache with SHARED_CACHE_PIPELINE_VERSION and hits cache
    const res2 = await handler(
      upload({
        operation: "generate",
        questionCount: 5,
        focus: "Microeconomics",
        language: "en",
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.cached).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1); // Not called again!
    expect(getDeckCache).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
      }),
    );
  });

  it("enforces burst-shield rate limiting on operation: preview and returns 429 with burst message when exceeded", async () => {
    const rateLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 15,
      remaining: 0,
      reset: Date.now() + 60000,
    });
    const handler = createIngestionHandler({ rateLimiter });
    const response = await handler(upload({ operation: "preview" }));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(json.error.message).toContain("short burst");
    expect(json.error.message).not.toContain("per week");
    expect(json.error.message).not.toContain("Daily upload limit");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(rateLimiter).toHaveBeenCalledTimes(1);
    expect(rateLimiter).toHaveBeenCalledWith(
      expect.stringContaining("ip:"),
      "ingest",
      "guest",
    );
  });

  it("disables paid vision OCR during preview operations by passing parsePdfOptions with zero budget", async () => {
    const parseDoc = vi.fn().mockResolvedValue({
      fileName: "test.pdf",
      format: "pdf",
      sources: [{ id: "page-1", label: "Page 1", text: studyText }],
      warnings: [],
      pageCount: 1,
      characterCount: studyText.length,
      fileSha256: "sha256-abc",
      contentHash: "hash-xyz",
    });

    const handler = createIngestionHandler({ parseDoc });
    const response = await handler(
      upload({
        operation: "preview",
        rescanPages: [1, 2],
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.operation).toBe("preview");
    expect(parseDoc).toHaveBeenCalledTimes(1);

    const callArgs = parseDoc.mock.calls[0];
    const passedOptions = callArgs[2];
    expect(passedOptions).toBeDefined();
    expect(passedOptions.rescanPages).toBeUndefined();
    expect(passedOptions.parsePdfOptions).toBeDefined();
    expect(passedOptions.parsePdfOptions.maxAutoOcrBudgetUsd).toBe(0);
    expect(typeof passedOptions.parsePdfOptions.visionTranscriber).toBe("function");

    const transcriberResult = await passedOptions.parsePdfOptions.visionTranscriber();
    expect(transcriberResult).toBeNull();
  });

  it("preserves rescanPages and does not restrict parsePdfOptions during operation: generate", async () => {
    const parseDoc = vi.fn().mockResolvedValue({
      fileName: "test.pdf",
      format: "pdf",
      sources: [{ id: "page-1", label: "Page 1", text: studyText }],
      warnings: [],
      pageCount: 1,
      characterCount: studyText.length,
      fileSha256: "sha256-abc",
      contentHash: "hash-xyz",
    });
    const generate = vi.fn().mockResolvedValue(result);

    const handler = createIngestionHandler({
      parseDoc,
      generate,
      checkConfiguration: () => {},
    });
    const response = await handler(
      upload({
        operation: "generate",
        questionCount: 5,
        rescanPages: [1, 2],
      }),
    );
    expect(response.status).toBe(200);
    expect(parseDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { rescanPages: [1, 2] },
    );
  });

  it("free user cache hit strips distractorRationale from pack.questions and studyMetadata.pack.questions", async () => {
    const cachedQuestions = [
      {
        id: "q-1",
        question: "What is opportunity cost?",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        explanation: "Opportunity cost is the value of next-best alternative.",
        distractorRationale: "Distractor rationale: Option B is wrong because it ignores sunk costs.",
        conceptVariant: {
          question: "What is the concept of opportunity cost?",
          options: ["A", "B", "C", "D"],
          correctIndex: 0,
          explanation: "Variant explanation.",
          distractorRationale: "Distractor rationale for variant: Option C is wrong.",
        },
      },
    ];

    const cachedDeck = {
      id: "cached-deck-1",
      contentHash: "hash-test-strip",
      language: "en",
      mode: "variants",
      focusHash: "",
      pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
      questionPool: cachedQuestions,
      studyMetadata: {
        pack: {
          id: "pack-1",
          title: "Microeconomics",
          subtitle: "Lecture 1",
          questions: [
            {
              id: "q-1",
              question: "What is opportunity cost?",
              options: ["A", "B", "C", "D"],
              correctIndex: 0,
              explanation: "Opportunity cost is the value of next-best alternative.",
              distractorRationale: "Distractor rationale: Option B is wrong because it ignores sunk costs.",
            },
          ],
          metadata: {
            "q-1": {
              topic: "Opportunity Cost",
              chapter: "1",
              citation: "notes.txt · Page 1",
              rule: "Scarcity rule",
              distractorRationale: "Metadata distractor rationale",
            },
          },
        },
        sourceKind: "lecture",
        references: {},
        warnings: [],
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      },
      hitCount: 1,
    };

    const getDeckCache = vi.fn().mockResolvedValue(cachedDeck);
    const generate = vi.fn();
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "free-user-1" },
      tier: "contender", // Free tier
    });

    const handler = createIngestionHandler({
      getDeckCache,
      generate,
      verifyAuth,
      checkConfiguration: () => {},
    });

    const response = await handler(
      upload({
        operation: "generate",
        questionCount: 1,
        language: "en",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cached).toBe(true);
    expect(generate).not.toHaveBeenCalled();

    // Verify distractorRationale stripped from pack.questions
    expect(body.pack.questions).toHaveLength(1);
    expect(body.pack.questions[0].distractorRationale).toBeUndefined();
    expect(body.pack.questions[0].conceptVariant.distractorRationale).toBeUndefined();

    // Verify distractorRationale stripped from studyMetadata.pack.questions if present
    if (body.studyMetadata?.pack?.questions) {
      expect(body.studyMetadata.pack.questions[0].distractorRationale).toBeUndefined();
    }
    // Also verify underlying cachedDeck studyMetadata was sanitized
    expect(cachedDeck.studyMetadata.pack.questions[0].distractorRationale).toBeUndefined();

    // Verify distractorRationale stripped from metadata
    if (body.pack.metadata?.["q-1"]) {
      expect(body.pack.metadata["q-1"].distractorRationale).toBeUndefined();
    }
  });

  it("paid user does not get degraded free cached deck missing distractorRationale", async () => {
    // Cached deck generated by a free user (no distractor rationale)
    const degradedFreeQuestions = [
      {
        id: "q-free-1",
        question: "What is GDP?",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        explanation: "Gross Domestic Product",
        conceptVariant: {
          question: "What does GDP measure?",
          options: ["A", "B", "C", "D"],
          correctIndex: 0,
          explanation: "Total market value",
        },
      },
    ];

    const degradedCachedDeck = {
      id: "cached-deck-free",
      contentHash: "hash-test-degraded",
      language: "en",
      mode: "variants",
      focusHash: "",
      pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
      questionPool: degradedFreeQuestions,
      studyMetadata: {
        pack: {
          id: "pack-free",
          title: "Macroeconomics",
          subtitle: "Lecture 1",
          questions: degradedFreeQuestions,
          metadata: {
            "q-free-1": {
              topic: "GDP",
              chapter: "1",
              citation: "notes.txt · Page 1",
              rule: "National accounts",
            },
          },
        },
        sourceKind: "lecture",
        references: {},
        warnings: [],
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      },
      hitCount: 1,
    };

    const getDeckCache = vi.fn().mockResolvedValue(degradedCachedDeck);
    const setDeckCache = vi.fn().mockResolvedValue(degradedCachedDeck);
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      cachedDeck: degradedCachedDeck,
      creditsUsed: 0,
      creditsLimit: 100,
      dailyBurstUsed: 0,
      dailyBurstLimit: 50,
      cogsStatus: {} as any,
      ledger: {} as any,
    });
    const recordCogs = vi.fn().mockResolvedValue({ ledger: {} as any, cogsStatus: {} as any });

    const freshProResult: GenerationResult = {
      pack: {
        id: "pack-fresh-pro",
        title: "Macroeconomics Pro",
        subtitle: "Deep Dive",
        questions: [
          {
            id: "q-pro-1",
            question: "How does inflation affect GDP?",
            options: ["A", "B", "C", "D"],
            correctIndex: 0,
            explanation: "Real GDP adjusts for inflation.",
            conceptVariant: {
              question: "Nominal vs Real GDP?",
              options: ["A", "B", "C", "D"],
              correctIndex: 0,
              explanation: "Nominal uses current prices.",
            },
          },
        ],
        metadata: {
          "q-pro-1": {
            topic: "Inflation",
            chapter: "2",
            citation: "notes.txt · Page 2",
            rule: "Deflator equation",
            distractorRationale: "Pro Distractor: Option B confuses CPI with GDP deflator.",
          },
        },
      },
      sourceKind: "lecture",
      references: {},
      warnings: [],
      usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
    };

    const generate = vi.fn().mockResolvedValue(freshProResult);
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "pro-user-1" },
      tier: "pro", // Paid Pro tier
    });

    const handler = createIngestionHandler({
      getDeckCache,
      setDeckCache,
      quotaReservation,
      recordCogs,
      generate,
      verifyAuth,
      checkConfiguration: () => {},
    });

    const response = await handler(
      upload({
        operation: "generate",
        questionCount: 1,
        language: "en",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    // Verify cache was bypassed for the paid user!
    expect(body.cached).toBeUndefined();
    // Verify fresh high-fidelity AI generation was called
    expect(generate).toHaveBeenCalledTimes(1);
    expect(body.pack.id).toBe("pack-fresh-pro");

    // Verify setDeckCache was called to update cache with high-fidelity questions
    expect(setDeckCache).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledWith(
      expect.objectContaining({
        studyMetadata: expect.objectContaining({
          pack: expect.objectContaining({
            metadata: expect.objectContaining({
              "q-pro-1": expect.objectContaining({
                distractorRationale: "Pro Distractor: Option B confuses CPI with GDP deflator.",
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("paid user receives cached deck when it has distractorRationale and meets requested count", async () => {
    const proCachedQuestions = [
      {
        id: "q-pro-cached-1",
        question: "Explain the liquidity trap.",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        explanation: "Nominal interest rates near zero.",
        distractorRationale: "Option B is incorrect because monetary policy becomes ineffective.",
        conceptVariant: {
          question: "What characterizes a liquidity trap?",
          options: ["A", "B", "C", "D"],
          correctIndex: 0,
          explanation: "Zero lower bound on interest rates.",
        },
      },
    ];

    const proCachedDeck = {
      id: "cached-deck-pro",
      contentHash: "hash-test-pro-cached",
      language: "en",
      mode: "variants",
      focusHash: "",
      pipelineVersion: SHARED_CACHE_PIPELINE_VERSION,
      questionPool: proCachedQuestions,
      studyMetadata: {
        pack: {
          id: "pack-pro-cached",
          title: "Monetary Policy",
          subtitle: "Lecture 5",
          questions: proCachedQuestions,
          metadata: {
            "q-pro-cached-1": {
              topic: "Liquidity Trap",
              chapter: "5",
              citation: "notes.txt · Page 5",
              rule: "ZLB",
              distractorRationale: "Option B is incorrect because monetary policy becomes ineffective.",
            },
          },
        },
        sourceKind: "lecture",
        references: {},
        warnings: [],
        usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
      },
      hitCount: 2,
    };

    const getDeckCache = vi.fn().mockResolvedValue(proCachedDeck);
    const generate = vi.fn();
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "pro-user-2" },
      tier: "pro",
    });

    const handler = createIngestionHandler({
      getDeckCache,
      generate,
      verifyAuth,
      checkConfiguration: () => {},
    });

    const response = await handler(
      upload({
        operation: "generate",
        questionCount: 1,
        language: "en",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cached).toBe(true);
    expect(generate).not.toHaveBeenCalled();

    // Verify distractorRationale is preserved for the paid user
    expect(body.pack.questions[0].distractorRationale).toBe(
      "Option B is incorrect because monetary policy becomes ineffective.",
    );
    expect(body.pack.metadata?.["q-pro-cached-1"]?.distractorRationale).toBe(
      "Option B is incorrect because monetary policy becomes ineffective.",
    );
    expect(body.quota).toBeDefined();
    expect(body.quota.windowBudgetUsd).toBeUndefined();
    expect(body.quota.cogsCeilingUsd).toBeUndefined();
  });

  it("pre-checks getRollingQuotaSnapshot for non-cached generate and disables Vision OCR when !preSnapshot.allowVisionOcr", async () => {
    const nowIso = new Date().toISOString();
    // Pro VN primary window budget is $0.40; spending $0.38 (>90%) puts snapshot into hard mode (allowVisionOcr: false)
    await saveUserQuotaLedger({
      userId: "user:pro-ocr-gated",
      tier: "pro",
      cogsSpentUsd: 0.38,
      cogsReservedUsd: 0,
      cogsCeilingUsd: 3.8,
      windowStartedAt: nowIso,
      windowSpentUsd: 0.38,
      windowReservedUsd: 0,
      weeklyStartedAt: nowIso,
      weeklySpentUsd: 0.38,
      weeklyReservedUsd: 0,
      deckCreditsUsed: 4,
      deckCreditsLimit: 0,
      dailyBurstUsed: 4,
      dailyBurstDate: nowIso.slice(0, 10),
      unlockedDecks: {},
    });

    const parseDoc = vi.fn().mockResolvedValue({
      fileName: "slides.pdf",
      format: "pdf",
      sources: [{ id: "page-1", label: "Page 1", text: studyText }],
      warnings: [],
      pageCount: 1,
      characterCount: studyText.length,
      fileSha256: "sha256-ocr-gated",
      contentHash: "hash-ocr-gated",
    });
    const generate = vi.fn().mockResolvedValue(result);
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "pro-ocr-gated" },
      tier: "pro",
    });
    const snap = makeQuotaSnapshot({
      remainingPct: 5,
      usedPct: 95,
      mode: "hard",
      allowVisionOcr: false,
    });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 5,
      creditsLimit: 0,
      dailyBurstUsed: 5,
      dailyBurstLimit: 0,
      cogsStatus: snap.degradationStatus,
      quota: snap,
      ledger: {} as any,
    });
    const recordCogs = vi.fn().mockResolvedValue({
      ledger: {} as any,
      cogsStatus: snap.degradationStatus,
      quota: snap,
    });

    const handler = createIngestionHandler({
      parseDoc,
      generate,
      verifyAuth,
      quotaReservation,
      recordCogs,
      checkConfiguration: () => {},
    });

    const response = await handler(
      upload(
        { operation: "generate", questionCount: 5, rescanPages: [1] },
        new File([studyText], "slides.pdf", { type: "application/pdf" }),
        { "x-vercel-ip-country": "VN" },
      ),
    );
    expect(response.status).toBe(200);
    expect(parseDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        rescanPages: [1],
        parsePdfOptions: {
          maxAutoOcrBudgetUsd: 0,
        },
      },
    );
    expect(quotaReservation).toHaveBeenCalledWith(
      "user:pro-ocr-gated",
      "pro",
      expect.any(String),
      expect.objectContaining({
        actionKind: "deck",
        region: "VN",
      }),
    );
    expect(recordCogs).toHaveBeenCalledWith(
      "user:pro-ocr-gated",
      "pro",
      expect.any(Number),
      expect.any(Number),
      "VN",
    );
  });

  it("keeps Vision OCR enabled during generate pre-check when preSnapshot.allowVisionOcr is true and skips parseDoc when cachedParsedDoc exists", async () => {
    const parseDoc = vi.fn().mockResolvedValue({
      fileName: "fresh.pdf",
      format: "pdf",
      sources: [{ id: "page-1", label: "Page 1", text: studyText }],
      warnings: [],
      pageCount: 1,
      characterCount: studyText.length,
      fileSha256: "sha256-fresh",
      contentHash: "hash-fresh",
    });
    const generate = vi.fn().mockResolvedValue(result);
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "pro-ocr-allowed" },
      tier: "pro",
    });
    const snap = makeQuotaSnapshot({ remainingPct: 100, usedPct: 0, mode: "full", allowVisionOcr: true });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 1,
      creditsLimit: 0,
      dailyBurstUsed: 1,
      dailyBurstLimit: 0,
      cogsStatus: snap.degradationStatus,
      quota: snap,
      ledger: {} as any,
    });
    const recordCogs = vi.fn().mockResolvedValue({
      ledger: {} as any,
      cogsStatus: snap.degradationStatus,
      quota: snap,
    });

    const handler = createIngestionHandler({
      parseDoc,
      generate,
      verifyAuth,
      quotaReservation,
      recordCogs,
      checkConfiguration: () => {},
    });

    const response1 = await handler(
      upload(
        { operation: "generate", questionCount: 5, rescanPages: [2] },
        new File([studyText], "fresh.pdf", { type: "application/pdf" }),
        { "x-vercel-ip-country": "US" },
      ),
    );
    const body1 = await response1.json();
    expect(response1.status).toBe(200);
    expect(parseDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { rescanPages: [2] },
    );
    expect(quotaReservation).toHaveBeenCalledWith(
      "user:pro-ocr-allowed",
      "pro",
      expect.any(String),
      expect.objectContaining({
        actionKind: "deck",
        region: "ROW",
      }),
    );
    expect(recordCogs).toHaveBeenCalledWith(
      "user:pro-ocr-allowed",
      "pro",
      expect.any(Number),
      expect.any(Number),
      "ROW",
    );
    expect(body1.quota).toEqual(toClientQuota(snap));

    // When cachedParsedDoc hits (rescanPages omitted), parseDoc is skipped entirely
    const parseDocCached = vi.fn();
    const getCachedParsedDoc = vi.fn().mockResolvedValue({
      fileName: "cached.pdf",
      format: "pdf",
      sources: [{ id: "page-1", label: "Page 1", text: studyText }],
      pageCount: 1,
      characterCount: studyText.length,
      warnings: [],
      fileSha256: "sha256-cached",
      contentHash: "hash-cached",
    });
    const cachedHandler = createIngestionHandler({
      parseDoc: parseDocCached,
      getCachedParsedDoc,
      generate,
      verifyAuth,
      quotaReservation,
      recordCogs,
      checkConfiguration: () => {},
    });

    const response2 = await cachedHandler(
      upload(
        { operation: "generate", questionCount: 5 },
        new File([studyText], "cached.pdf", { type: "application/pdf" }),
      ),
    );
    expect(response2.status).toBe(200);
    expect(getCachedParsedDoc).toHaveBeenCalledTimes(1);
    expect(parseDocCached).not.toHaveBeenCalled();
  });

  it("returns rolling burst-limit 429 message and client quota when quotaReservation fails with DAILY_BURST_EXCEEDED", async () => {
    const generate = vi.fn();
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const burstSnapshot = makeQuotaSnapshot({
      remainingPct: 0,
      usedPct: 100,
      mode: "halted",
      allowVisionOcr: false,
      serveCachedPoolsOnly: true,
    });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: false,
      reason: "DAILY_BURST_EXCEEDED",
      cacheHit: false,
      creditConsumed: false,
      isRegeneration: false,
      creditsUsed: 5,
      creditsLimit: 0,
      dailyBurstUsed: 5,
      dailyBurstLimit: 0,
      cogsStatus: burstSnapshot.degradationStatus,
      quota: burstSnapshot,
      ledger: {} as any,
    });

    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
    });

    const response = await handler(upload({ operation: "generate", questionCount: 5 }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("DAILY_BURST_EXCEEDED");
    expect(body.error.message).toContain("Rolling AI quota burst limit reached");
    expect(body.error.message).not.toContain("max 2 uploads per week");
    expect(body.error.message).not.toContain("Daily upload limit reached");
    expect(body.quota).toEqual(toClientQuota(burstSnapshot));
    expect(generate).not.toHaveBeenCalled();
  });
});
