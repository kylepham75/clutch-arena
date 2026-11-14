import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { parseMultiDocuments } from "@/lib/ingestion/parse-multi-documents";
import { readMultiUpload } from "@/lib/ingestion/read-multi-upload";
import {
  createMultiIngestionHandler,
  MULTI_SHARED_CACHE_PIPELINE_VERSION,
} from "@/lib/ingestion/multi-handler";
import {
  resetQuotaLedgersForTests,
  toClientQuota,
  getUserQuotaLedger,
  saveUserQuotaLedger,
  type RollingQuotaSnapshot,
} from "@/lib/rate-limit";
import type { CogsBudgetStatus } from "@/lib/pricing/tiers";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { GenerationResult } from "@/lib/schemas/ingestion";
import { studyText } from "../helpers/documents";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetQuotaLedgersForTests();
});

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

const mockResult: GenerationResult = {
  pack: mockMicroeconomics,
  sourceKind: "lecture",
  references: {},
  warnings: [],
  usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
};

describe("multi-document parsing", () => {
  it("rejects 0 files", async () => {
    const controller = new AbortController();
    await expect(parseMultiDocuments([], controller.signal)).rejects.toThrow(
      "Upload at least one file.",
    );
  });

  it("rejects more than 10 files", async () => {
    const controller = new AbortController();
    const files = Array.from(
      { length: 11 },
      (_, i) => new File([studyText], `doc${i}.txt`, { type: "text/plain" }),
    );
    await expect(parseMultiDocuments(files, controller.signal)).rejects.toThrow(
      "You can upload up to 10 files at once",
    );
  });

  it("combines multiple text files into a single composite document with attributed source labels", async () => {
    const controller = new AbortController();
    const file1 = new File(
      [studyText],
      "Economics_Lecture1.txt",
      { type: "text/plain" },
    );
    const file2 = new File(
      ["Monopoly is characterized by a single seller and very high barriers to entry in the target market."],
      "Economics_Lecture2.txt",
      { type: "text/plain" },
    );

    const { compositeDocument, documents } = await parseMultiDocuments([file1, file2], controller.signal);

    expect(documents.length).toBe(2);
    expect(compositeDocument.format).toBe("txt");
    expect(compositeDocument.fileName).toContain("2 files");
    expect(compositeDocument.sources.length).toBe(2);

    expect(compositeDocument.sources[0].id).toBe("doc0_lines-1-1");
    expect(compositeDocument.sources[0].label).toContain("Economics_Lecture1");
    expect(compositeDocument.sources[0].text).toBe(studyText);

    expect(compositeDocument.sources[1].id).toBe("doc1_lines-1-1");
    expect(compositeDocument.sources[1].label).toContain("Economics_Lecture2");
    expect(compositeDocument.sources[1].text).toContain("Monopoly");

    expect(compositeDocument.characterCount).toBe(
      file1.size + file2.size,
    );
  });
});

describe("readMultiUpload", () => {
  it("extracts multiple files and parsed options from multipart request", async () => {
    const form = new FormData();
    form.append("files", new File([studyText], "alpha.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "beta.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview", questionCount: 15 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const controller = new AbortController();
    const { files, options } = await readMultiUpload(request, controller.signal);

    expect(files.length).toBe(2);
    expect(files[0].name).toBe("alpha.txt");
    expect(files[1].name).toBe("beta.txt");
    expect(options.questionCount).toBe(15);
    expect(options.multiFile).toBe(true);
  });

  it("rejects request if total body exceeds maximum size", async () => {
    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: new Uint8Array(26 * 1024 * 1024),
      headers: { "content-type": "multipart/form-data; boundary=xyz" },
    });

    const controller = new AbortController();
    await expect(readMultiUpload(request, controller.signal)).rejects.toThrow();
  });
});

describe("multi ingestion HTTP handler", () => {
  it("previews multiple documents successfully without calling AI", async () => {
    const generate = vi.fn();
    const checkConfiguration = vi.fn();

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview" }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ generate, checkConfiguration });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.document.sources.length).toBe(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates questions on composite document when operation is generate", async () => {
    const generate = vi.fn().mockResolvedValue(mockResult);
    const checkConfiguration = vi.fn();

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ generate, checkConfiguration });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.pack.title).toBe(mockMicroeconomics.title);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(checkConfiguration).toHaveBeenCalledTimes(1);
  });

  it("bypasses LLM generation on shared deck cache hit and returns cached result", async () => {
    const generate = vi.fn();
    const getDeckCache = vi.fn().mockResolvedValue({
      id: "multi-cached-1",
      contentHash: "multi-hash-123",
      language: "en",
      mode: "variants",
      focusHash: "",
      pipelineVersion: "v1",
      questionPool: mockMicroeconomics.questions,
      studyMetadata: {
        pack: mockMicroeconomics,
        sourceKind: "lecture",
        references: {},
        warnings: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      hitCount: 1,
    });

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 5 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
    });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.cached).toBe(true);
    expect(json.pack.questions.length).toBeLessThanOrEqual(5);
    expect(json.quota).toBeDefined();
    expect(json.quota).toMatchObject({
      remainingPct: expect.any(Number),
      usedPct: expect.any(Number),
      windowHours: expect.any(Number),
      bottleneckScope: expect.any(String),
      mode: expect.any(String),
    });
    expect(json.quota.windowBudgetUsd).toBeUndefined();
    expect(json.quota.cogsCeilingUsd).toBeUndefined();
    expect(getDeckCache).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("blocks multi-document generation with 429, client quota payload, and specific reason code when quota is exceeded", async () => {
    const generate = vi.fn();
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const depletedSnapshot = makeQuotaSnapshot({
      remainingPct: 0,
      usedPct: 100,
      mode: "halted",
      bottleneckScope: "cycle",
      resetsAt: null,
      windowRemainingUsd: 0,
      effectiveRemainingUsd: 0,
      allowVisionOcr: false,
      serveCachedPoolsOnly: true,
    });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: false,
      reason: "COGS_CEILING_EXCEEDED",
      cacheHit: false,
      creditConsumed: false,
      isRegeneration: false,
      creditsUsed: 10,
      creditsLimit: 60,
      dailyBurstUsed: 2,
      dailyBurstLimit: 6,
      cogsStatus: depletedSnapshot.degradationStatus,
      quota: depletedSnapshot,
      ledger: {} as any,
    });

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
    });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("COGS_CEILING_EXCEEDED");
    expect(json.error.message).toContain("0% remaining");
    expect(json.quota).toEqual(toClientQuota(depletedSnapshot));
    expect(json.quota.windowBudgetUsd).toBeUndefined();
    expect(json.quota.cogsCeilingUsd).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });

  it("records COGS with authoritative billingRegion and attaches client quota on multi-document cache miss", async () => {
    const generate = vi.fn().mockResolvedValue(mockResult);
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const reservedSnapshot = makeQuotaSnapshot({ remainingPct: 86, usedPct: 14 });
    const settledSnapshot = makeQuotaSnapshot({ remainingPct: 82, usedPct: 18 });
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 1,
      creditsLimit: 60,
      dailyBurstUsed: 1,
      dailyBurstLimit: 6,
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

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      headers: { "x-vercel-ip-country": "VN" },
      body: form,
    });

    const handler = createMultiIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
      recordCogs,
      setDeckCache,
    });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.quota).toEqual(toClientQuota(settledSnapshot));
    expect(json.quota.windowBudgetUsd).toBeUndefined();
    expect(json.quota.cogsCeilingUsd).toBeUndefined();
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
        pipelineVersion: MULTI_SHARED_CACHE_PIPELINE_VERSION,
        questionPool: mockResult.pack.questions,
      }),
    );
  });

  it("calls rollbackDeckQuotaReservation once with reserved actor, hash, and cost when multi-doc generation throws an error", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Multi-document AI provider timeout"));
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 1,
      creditsLimit: 60,
      dailyBurstUsed: 1,
      dailyBurstLimit: 6,
      cogsStatus: {} as any,
      ledger: {} as any,
    });
    const rollbackQuota = vi.fn().mockResolvedValue({ success: true, decksGeneratedCount: 0 });

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
      rollbackQuota,
    });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INGESTION_FAILED");
    expect(quotaReservation).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(rollbackQuota).toHaveBeenCalledTimes(1);
    expect(rollbackQuota).toHaveBeenCalledWith(
      expect.stringContaining("ip:"),
      "guest",
      expect.any(String),
      0.02,
      "ROW",
    );
  });

  it("uses matching MULTI_SHARED_CACHE_PIPELINE_VERSION in getDeckCache and setDeckCache so repeat multi-uploads hit shared cache", async () => {
    let memoryCache: any = null;
    const generate = vi.fn().mockResolvedValue({
      ...mockResult,
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
      creditsLimit: 60,
      dailyBurstUsed: 1,
      dailyBurstLimit: 6,
      cogsStatus: {} as any,
      ledger: {} as any,
    });
    const recordCogs = vi.fn().mockResolvedValue({ ledger: {} as any, cogsStatus: {} as any });

    const makeRequest = () => {
      const form = new FormData();
      form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
      form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
      form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));
      return new Request("http://localhost:3000/api/ingest/multi", {
        method: "POST",
        body: form,
      });
    };

    const handler = createMultiIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      setDeckCache,
      quotaReservation,
      recordCogs,
    });

    // 1st request: cache miss, triggers generation, saves to cache with MULTI_SHARED_CACHE_PIPELINE_VERSION
    const res1 = await handler(makeRequest());
    expect(res1.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineVersion: MULTI_SHARED_CACHE_PIPELINE_VERSION,
      }),
    );

    // 2nd request with identical multi-files: invokes getDeckCache with matching version and hits cache
    const res2 = await handler(makeRequest());
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.cached).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1); // Not called again!
    expect(getDeckCache).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pipelineVersion: MULTI_SHARED_CACHE_PIPELINE_VERSION,
      }),
    );
  });

  it("rejects guest users on multi-ingest operation: preview with 403 TIER_UPGRADE_REQUIRED", async () => {
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: false,
      user: null,
      tier: "guest" as const,
    });
    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview" }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ verifyAuth });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
    expect(json.error.message).toContain("Multi-document synthesis requires Cram Pass or Season Pro");
  });

  it("rejects contender (free) users on multi-ingest operation: preview with 403 TIER_UPGRADE_REQUIRED", async () => {
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "user-free-1", email: "free@example.com" },
      tier: "contender" as const,
    });
    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview" }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ verifyAuth });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
    expect(json.error.message).toContain("Multi-document synthesis requires Cram Pass or Season Pro");
  });

  it("returns 429 with burst-shield message when rateLimiter denies multi-ingest operation: preview", async () => {
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "user-paid-1", email: "paid@example.com" },
      tier: "pro" as const,
    });
    const rateLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 50,
      remaining: 0,
      reset: Date.now() + 60000,
    });
    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview" }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ verifyAuth, rateLimiter });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(json.error.message).toContain("short burst");
    expect(json.error.message).not.toContain("per week");
    expect(json.error.message).not.toContain("Daily upload limit");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(rateLimiter).toHaveBeenCalledTimes(1);
    expect(rateLimiter).toHaveBeenCalledWith("user:user-paid-1", "ingest", "pro");
  });

  it("allows paid users on multi-ingest operation: preview when within rate limits", async () => {
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "user-paid-2", email: "paid2@example.com" },
      tier: "cram_pass" as const,
    });
    const rateLimiter = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 50,
      remaining: 49,
      reset: Date.now() + 60000,
    });
    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview" }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ verifyAuth, rateLimiter });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.operation).toBe("preview");
    expect(json.document).toBeDefined();
    expect(rateLimiter).toHaveBeenCalledTimes(1);
  });

  it("resolves ROW billingRegion from geo header and passes it with actionKind: deck into quotaReservation and recordCogs", async () => {
    const generate = vi.fn().mockResolvedValue(mockResult);
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "user-row-1", email: "row@example.com" },
      tier: "pro" as const,
    });
    const snap = makeQuotaSnapshot({ remainingPct: 75, usedPct: 25 });
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

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 5 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      headers: { "x-vercel-ip-country": "US" },
      body: form,
    });

    const handler = createMultiIngestionHandler({
      generate,
      verifyAuth,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
      recordCogs,
    });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(quotaReservation).toHaveBeenCalledWith(
      "user:user-row-1",
      "pro",
      expect.any(String),
      expect.objectContaining({
        actionKind: "deck",
        region: "ROW",
      }),
    );
    expect(recordCogs).toHaveBeenCalledWith(
      "user:user-row-1",
      "pro",
      expect.any(Number),
      expect.any(Number),
      "ROW",
    );
    expect(json.quota).toEqual(toClientQuota(snap));
  });

  it("returns rolling burst-limit 429 message and client quota on DAILY_BURST_EXCEEDED", async () => {
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
      creditsUsed: 6,
      creditsLimit: 0,
      dailyBurstUsed: 6,
      dailyBurstLimit: 0,
      cogsStatus: burstSnapshot.degradationStatus,
      quota: burstSnapshot,
      ledger: {} as any,
    });

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 5 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({
      generate,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
    });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.error.code).toBe("DAILY_BURST_EXCEEDED");
    expect(json.error.message).toContain("Rolling AI quota burst limit reached");
    expect(json.error.message).not.toContain("max 2 uploads per week");
    expect(json.error.message).not.toContain("Daily upload limit reached");
    expect(json.quota).toEqual(toClientQuota(burstSnapshot));
    expect(generate).not.toHaveBeenCalled();
  });

  it("passes { parsePdfOptions: { maxAutoOcrBudgetUsd: 0 } } to parseMultiDocs for operation: preview and for operation: generate when pre-snapshot allowVisionOcr is false", async () => {
    const mockCompositeDoc = {
      fileName: "composite.txt",
      fileSha256: "abc123sha",
      pageCount: 2,
      characterCount: 200,
      format: "txt",
      warnings: [],
      sources: [
        { id: "doc1-1", label: "Doc 1 - Item 1", text: "Text 1" },
        { id: "doc2-1", label: "Doc 2 - Item 1", text: "Text 2" },
      ],
    };

    const parseMultiDocs = vi.fn().mockResolvedValue({
      compositeDocument: mockCompositeDoc,
      documents: [mockCompositeDoc],
    });

    const verifyAuth = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: "user-multi-ocr-gated" },
      tier: "cram_pass",
      tierExpiresAt: null,
    });

    // 1. Operation: 'preview' must pass { parsePdfOptions: { maxAutoOcrBudgetUsd: 0 } }
    const previewForm = new FormData();
    previewForm.append("files", new File([studyText], "docA.txt", { type: "text/plain" }));
    previewForm.append("files", new File([studyText], "docB.txt", { type: "text/plain" }));
    previewForm.set("options", JSON.stringify({ operation: "preview" }));

    const previewReq = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: previewForm,
    });

    const previewHandler = createMultiIngestionHandler({
      parseMultiDocs,
      verifyAuth,
      checkConfiguration: () => {},
    });

    const previewRes = await previewHandler(previewReq);
    expect(previewRes.status).toBe(200);
    expect(parseMultiDocs).toHaveBeenCalledTimes(1);
    expect(parseMultiDocs).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.any(Object),
      {
        parsePdfOptions: {
          maxAutoOcrBudgetUsd: 0,
        },
      },
    );

    parseMultiDocs.mockClear();

    // 2. Operation: 'generate' with allowVisionOcr = false in preSnapshot
    const userId = "user-multi-ocr-gated";
    const actorKey = `user:${userId}`;
    const ledger = await getUserQuotaLedger(actorKey, "cram_pass", "ROW");
    // $0.33 spent out of unified $0.35 budget (>90% utilization -> mode: 'hard', allowVisionOcr: false)
    ledger.windowSpentUsd = 0.33;
    ledger.weeklySpentUsd = 0.33;
    ledger.cogsSpentUsd = 0.33;
    await saveUserQuotaLedger(ledger);

    const generate = vi.fn().mockResolvedValue(mockResult);
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
      reserved: true,
      cacheHit: false,
      creditConsumed: true,
      isRegeneration: false,
      creditsUsed: 1,
      creditsLimit: 10,
      dailyBurstUsed: 1,
      dailyBurstLimit: 10,
      cogsStatus: {} as any,
      ledger: {} as any,
    });
    const recordCogs = vi.fn().mockResolvedValue({
      ledger: {} as any,
      cogsStatus: {} as any,
      quota: {} as any,
    });

    const generateForm = new FormData();
    generateForm.append("files", new File([studyText], "docA.txt", { type: "text/plain" }));
    generateForm.append("files", new File([studyText], "docB.txt", { type: "text/plain" }));
    generateForm.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const generateReq = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: generateForm,
    });

    const generateHandler = createMultiIngestionHandler({
      parseMultiDocs,
      generate,
      verifyAuth,
      checkConfiguration: () => {},
      getDeckCache,
      quotaReservation,
      recordCogs,
    });

    const generateRes = await generateHandler(generateReq);
    expect(generateRes.status).toBe(200);
    expect(parseMultiDocs).toHaveBeenCalledTimes(1);
    expect(parseMultiDocs).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.any(Object),
      {
        parsePdfOptions: {
          maxAutoOcrBudgetUsd: 0,
        },
      },
    );
  });
});
