import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { parseMultiDocuments } from "@/lib/ingestion/parse-multi-documents";
import { readMultiUpload } from "@/lib/ingestion/read-multi-upload";
import {
  createMultiIngestionHandler,
  MULTI_SHARED_CACHE_PIPELINE_VERSION,
} from "@/lib/ingestion/multi-handler";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { GenerationResult } from "@/lib/schemas/ingestion";
import { studyText } from "../helpers/documents";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

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
    expect(getDeckCache).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("blocks multi-document generation with 429 and specific reason code when quota is exceeded", async () => {
    const generate = vi.fn();
    const getDeckCache = vi.fn().mockResolvedValue(null);
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
      cogsStatus: {} as any,
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
    expect(generate).not.toHaveBeenCalled();
  });

  it("records COGS and populates shared deck cache on multi-document cache miss", async () => {
    const generate = vi.fn().mockResolvedValue(mockResult);
    const getDeckCache = vi.fn().mockResolvedValue(null);
    const quotaReservation = vi.fn().mockResolvedValue({
      allowed: true,
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
    const recordCogs = vi.fn().mockResolvedValue({
      ledger: {} as any,
      cogsStatus: {} as any,
    });
    const setDeckCache = vi.fn().mockResolvedValue({});

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
      recordCogs,
      setDeckCache,
    });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(quotaReservation).toHaveBeenCalledTimes(1);
    expect(recordCogs).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledTimes(1);
    expect(setDeckCache).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineVersion: "v1",
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

  it("returns 429 when rateLimiter denies multi-ingest operation: preview", async () => {
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
});
