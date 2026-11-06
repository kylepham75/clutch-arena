import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  feedbackSubmissionSchema,
  smokeTestIntentSchema,
  citationRejectionEventSchema,
  clientTelemetryPayloadSchema,
  MAX_TELEMETRY_BODY_BYTES,
} from "@/lib/schemas/telemetry";
import {
  recordTelemetryEvent,
  getRecentTelemetryEvents,
  clearRecentTelemetryEvents,
  checkTelemetryRateLimit,
  resetTelemetryRateLimits,
  getTelemetryRateLimitStoreSize,
  MAX_RATE_LIMIT_IPS,
  sanitizeWebhookMentions,
  sanitizeSingleLine,
  escapeMarkdownLinks,
  sanitizeHeaderField,
  redactContact,
  redactTelemetryPayload,
  formatTelemetryWebhookSummary,
  type TimestampedTelemetryEvent,
} from "@/lib/telemetry/recorder";
import nextConfig from "../../next.config";
import { createTelemetryHandler } from "@/lib/telemetry/handler";
import {
  generateQuestions,
  validateGeneratedStudy,
} from "@/lib/ai/generate-questions";
import {
  ingestionOptionsSchema,
  type ParsedDocument,
} from "@/lib/schemas/ingestion";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import { studyText } from "../helpers/documents";

const testDoc: ParsedDocument = {
  fileName: "notes.txt",
  format: "txt",
  sources: [{ id: "sec-1", label: "Section 1", text: studyText }],
  characterCount: studyText.length,
  pageCount: null,
  warnings: [],
};

const testOptions = ingestionOptionsSchema.parse({ questionCount: 1 });

type TestModel = Exclude<LanguageModel, string>;
const createMockModel = (raw: unknown): TestModel => ({
  specificationVersion: "v2" as const,
  provider: "test",
  modelId: "fixture",
  supportedUrls: {},
  doGenerate: vi.fn<TestModel["doGenerate"]>(async () => ({
    content: [{ type: "text", text: JSON.stringify(raw) }],
    finishReason: "stop",
    usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    warnings: [],
  })),
  doStream: async () => {
    throw new Error("Streaming not used");
  },
});

beforeEach(() => {
  clearRecentTelemetryEvents();
  resetTelemetryRateLimits();
  vi.unstubAllEnvs();
});

afterEach(() => {
  clearRecentTelemetryEvents();
  resetTelemetryRateLimits();
  vi.unstubAllEnvs();
});

describe("Telemetry Schemas", () => {
  it("accepts valid feedback submission and rejects invalid inputs", () => {
    const validFeedback = {
      kind: "feedback",
      category: "gameplay_bug",
      message: "The submit button does not respond on mobile.",
      contact: "tester@example.com",
      rating: 4,
      context: {
        packTitle: "Microeconomics 101",
        questionId: "q-1",
        tier: "pro",
        language: "vi",
      },
    };

    const parsed = feedbackSubmissionSchema.safeParse(validFeedback);
    expect(parsed.success).toBe(true);

    // Empty message
    expect(
      feedbackSubmissionSchema.safeParse({
        ...validFeedback,
        message: "",
      }).success,
    ).toBe(false);

    // Invalid category
    expect(
      feedbackSubmissionSchema.safeParse({
        ...validFeedback,
        category: "invalid_category",
      }).success,
    ).toBe(false);

    // Rating out of bounds
    expect(
      feedbackSubmissionSchema.safeParse({
        ...validFeedback,
        rating: 6,
      }).success,
    ).toBe(false);

    // Strict schema rejects unknown fields
    expect(
      feedbackSubmissionSchema.safeParse({
        ...validFeedback,
        unknownField: "malicious",
      }).success,
    ).toBe(false);
  });

  it("accepts valid smoke test intent and rejects invalid parameters", () => {
    const validSmoke = {
      kind: "smoke_test_intent",
      planId: "cram_pass",
      currency: "vnd",
      action: "plan_selected",
      contact: "user@example.com",
      language: "en",
    };

    expect(smokeTestIntentSchema.safeParse(validSmoke).success).toBe(true);

    // Invalid planId
    expect(
      smokeTestIntentSchema.safeParse({
        ...validSmoke,
        planId: "unlimited_vip",
      }).success,
    ).toBe(false);

    // Invalid currency
    expect(
      smokeTestIntentSchema.safeParse({
        ...validSmoke,
        currency: "eur",
      }).success,
    ).toBe(false);

    // Invalid action
    expect(
      smokeTestIntentSchema.safeParse({
        ...validSmoke,
        action: "hacked_action",
      }).success,
    ).toBe(false);
  });

  it("accepts valid citation rejection events and validates constraints", () => {
    const validCitationRejection = {
      kind: "citation_rejection",
      reason: "missing_or_short_excerpt",
      documentTitle: "lecture4.pdf",
      sourceKind: "lecture",
      sourceId: "p-4",
      excerptPreview: "Price elasticity exceeds one.",
      questionId: "q-12",
      totalSources: 5,
    };

    expect(
      citationRejectionEventSchema.safeParse(validCitationRejection).success,
    ).toBe(true);

    // Invalid reason
    expect(
      citationRejectionEventSchema.safeParse({
        ...validCitationRejection,
        reason: "unrecognized_reason",
      }).success,
    ).toBe(false);

    // Wrong kind
    expect(
      citationRejectionEventSchema.safeParse({
        ...validCitationRejection,
        kind: "feedback",
      }).success,
    ).toBe(false);
  });

  it("clientTelemetryPayloadSchema discriminates between feedback and smoke_test_intent", () => {
    const feedback = {
      kind: "feedback",
      category: "general",
      message: "Great interface!",
    };
    const smoke = {
      kind: "smoke_test_intent",
      planId: "pro",
      currency: "usd",
      action: "verify_clicked",
    };
    const citation = {
      kind: "citation_rejection",
      reason: "unknown_source_id",
    };

    expect(clientTelemetryPayloadSchema.safeParse(feedback).success).toBe(true);
    expect(clientTelemetryPayloadSchema.safeParse(smoke).success).toBe(true);
    // citation_rejection is internal server-only, not client-facing payload
    expect(clientTelemetryPayloadSchema.safeParse(citation).success).toBe(false);
  });
});

describe("recordTelemetryEvent & Ring Buffer", () => {
  it("stores events in the ring buffer with recordedAt timestamps and caps at 100", async () => {
    clearRecentTelemetryEvents();

    const result = await recordTelemetryEvent({
      kind: "feedback",
      category: "general",
      message: "Testing ring buffer",
    });

    expect(result.recorded).toBe(true);
    const recent = getRecentTelemetryEvents();
    expect(recent).toHaveLength(1);
    expect(recent[0].recordedAt).toBeDefined();
    expect(recent[0].kind).toBe("feedback");

    // Push 105 events to test ring buffer capping at 100
    for (let i = 0; i < 105; i++) {
      await recordTelemetryEvent({
        kind: "feedback",
        category: "general",
        message: `Message #${i}`,
      });
    }

    const capped = getRecentTelemetryEvents();
    expect(capped).toHaveLength(100);
    // Oldest 6 events (original + #0..#4) should have shifted out
    expect((capped[0] as any).message).toBe("Message #5");
    expect((capped[99] as any).message).toBe("Message #104");

    clearRecentTelemetryEvents();
    expect(getRecentTelemetryEvents()).toHaveLength(0);
  });

  it("persists to Supabase mock and handles errors gracefully", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ insert: insertMock }),
    } as unknown as SupabaseClient;

    const res = await recordTelemetryEvent(
      {
        kind: "feedback",
        category: "parser_edge_case",
        message: "PDF table parsing was misaligned.",
        contact: "user@test.com",
      },
      {
        userId: "user-123",
        supabaseClient: mockSupabase,
      },
    );

    expect(res.recorded).toBe(true);
    expect(res.persistedToSupabase).toBe(true);
    expect(mockSupabase.from).toHaveBeenCalledWith("pilot_telemetry");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-123",
        event_kind: "feedback",
        category: "parser_edge_case",
        message: "PDF table parsing was misaligned.",
        contact: "user@test.com",
      }),
    );

    // Test graceful Supabase failure
    const failingInsertMock = vi.fn().mockResolvedValue({
      error: { message: "Database connection timeout" },
    });
    const failingSupabase = {
      from: vi.fn().mockReturnValue({ insert: failingInsertMock }),
    } as unknown as SupabaseClient;

    const failRes = await recordTelemetryEvent(
      {
        kind: "smoke_test_intent",
        planId: "tutor",
        currency: "usd",
        action: "early_access_requested",
      },
      {
        supabaseClient: failingSupabase,
      },
    );

    expect(failRes.recorded).toBe(true);
    expect(failRes.persistedToSupabase).toBe(false);

    // Test thrown exception inside Supabase client
    const throwSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockRejectedValue(new Error("Network crash")),
      }),
    } as unknown as SupabaseClient;

    const throwRes = await recordTelemetryEvent(
      {
        kind: "smoke_test_intent",
        planId: "pro",
        currency: "vnd",
        action: "plan_selected",
      },
      {
        supabaseClient: throwSupabase,
      },
    );

    expect(throwRes.recorded).toBe(true);
    expect(throwRes.persistedToSupabase).toBe(false);
  });

  it("relays to webhook and handles network errors gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await recordTelemetryEvent(
      {
        kind: "feedback",
        category: "citation_mismatch",
        message: "Source excerpt does not match page 12.",
        rating: 3,
      },
      {
        webhookUrl: "https://discord.com/api/webhooks/test",
        fetchImpl: mockFetch,
        userId: "test-user-id",
        ip: "127.0.0.1",
      },
    );

    expect(res.relayedToWebhook).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("Source excerpt does not match page 12."),
      }),
    );

    // Test webhook HTTP 500 error
    const failingFetch = vi
      .fn()
      .mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    const failRes = await recordTelemetryEvent(
      {
        kind: "smoke_test_intent",
        planId: "cram_pass",
        currency: "vnd",
        action: "plan_selected",
      },
      {
        webhookUrl: "https://discord.com/api/webhooks/test",
        fetchImpl: failingFetch,
      },
    );
    expect(failRes.relayedToWebhook).toBe(false);

    // Test webhook thrown timeout exception
    const timeoutFetch = vi.fn().mockRejectedValue(new Error("Webhook timeout"));
    const timeoutRes = await recordTelemetryEvent(
      {
        kind: "smoke_test_intent",
        planId: "cram_pass",
        currency: "vnd",
        action: "plan_selected",
      },
      {
        webhookUrl: "https://discord.com/api/webhooks/test",
        fetchImpl: timeoutFetch,
      },
    );
    expect(timeoutRes.relayedToWebhook).toBe(false);
  });

  it("enforces in-memory sliding-window telemetry rate limits per IP", () => {
    const ip = "192.168.1.10";
    resetTelemetryRateLimits();

    // 20 allowed requests
    for (let i = 0; i < 20; i++) {
      const check = checkTelemetryRateLimit(ip, 20, 600_000);
      expect(check.allowed).toBe(true);
    }

    // 21st request rejected
    const blocked = checkTelemetryRateLimit(ip, 20, 600_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);

    // Resetting clears limit
    resetTelemetryRateLimits();
    const afterReset = checkTelemetryRateLimit(ip, 20, 600_000);
    expect(afterReset.allowed).toBe(true);
  });

  it("sanitizes mass-mention tokens in webhook payloads and includes allowed_mentions: { parse: [] }", async () => {
    let capturedBody: any;
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response("ok", { status: 200 });
    });

    const res = await recordTelemetryEvent(
      {
        kind: "feedback",
        category: "general",
        message:
          "Attention @everyone and @here! Please ping <@&123> and notify <!channel> <!here> <!everyone>.",
        contact: "attacker@everyone.com",
      },
      {
        webhookUrl: "https://discord.com/api/webhooks/security-test",
        fetchImpl: mockFetch,
        userId: "user-<@&123>",
      },
    );

    expect(res.relayedToWebhook).toBe(true);
    expect(capturedBody).toBeDefined();

    // allowed_mentions check
    expect(capturedBody.allowed_mentions).toEqual({ parse: [] });

    // content and text parity
    expect(capturedBody.content).toBeDefined();
    expect(capturedBody.text).toBe(capturedBody.content);

    // Ensure raw mention tokens are not present
    expect(capturedBody.content).not.toContain("@everyone");
    expect(capturedBody.content).not.toContain("@here");
    expect(capturedBody.content).not.toContain("<@&123>");
    expect(capturedBody.content).not.toContain("<!channel>");
    expect(capturedBody.content).not.toContain("<!here>");
    expect(capturedBody.content).not.toContain("<!everyone>");

    // Ensure sanitized versions with zero-width space are present
    expect(capturedBody.content).toContain("@\u200beveryone");
    expect(capturedBody.content).toContain("@\u200bhere");
    expect(capturedBody.content).toContain("<@\u200b&123>");
    expect(capturedBody.content).toContain("<!\u200bchannel>");
    expect(capturedBody.content).toContain("<!\u200bhere>");
    expect(capturedBody.content).toContain("<!\u200beveryone>");
  });

  it("sanitizes mention tokens in standalone helper and ensures idempotency", () => {
    const raw = "Alert @everyone and @here! ping <@&123> <@!456> <@789> <!channel>";
    const sanitized = sanitizeWebhookMentions(raw);

    expect(sanitized).toBe(
      "Alert @\u200beveryone and @\u200bhere! ping <@\u200b&123> <@\u200b!456> <@\u200b789> <!\u200bchannel>",
    );

    // Calling it again should not inject double zero-width spaces
    expect(sanitizeWebhookMentions(sanitized)).toBe(sanitized);
    expect(sanitizeWebhookMentions("")).toBe("");
  });

  it("bounds rateLimitStore to MAX_RATE_LIMIT_IPS and evicts oldest entry when at capacity", () => {
    resetTelemetryRateLimits();

    // Verify bounded behavior with a small capacity
    const testCap = 3;
    checkTelemetryRateLimit("ip-1", 20, 600_000, testCap);
    checkTelemetryRateLimit("ip-2", 20, 600_000, testCap);
    checkTelemetryRateLimit("ip-3", 20, 600_000, testCap);
    expect(getTelemetryRateLimitStoreSize()).toBe(3);

    // Adding 4th IP should evict the oldest (ip-1)
    checkTelemetryRateLimit("ip-4", 20, 600_000, testCap);
    expect(getTelemetryRateLimitStoreSize()).toBe(3);

    // Adding 5th IP should evict ip-2
    checkTelemetryRateLimit("ip-5", 20, 600_000, testCap);
    expect(getTelemetryRateLimitStoreSize()).toBe(3);
  });

  it("sweeps expired entries first when rateLimitStore reaches capacity", () => {
    resetTelemetryRateLimits();
    const testCap = 3;
    const now = Date.now();
    const windowMs = 500;

    vi.useFakeTimers();
    try {
      vi.setSystemTime(now - 1000);
      checkTelemetryRateLimit("expired-ip-1", 20, windowMs, testCap);
      checkTelemetryRateLimit("expired-ip-2", 20, windowMs, testCap);

      vi.setSystemTime(now);
      checkTelemetryRateLimit("active-ip-1", 20, windowMs, testCap);
      expect(getTelemetryRateLimitStoreSize()).toBe(3);

      // When inserting a 4th IP at capacity, the sweep should remove expired entries
      checkTelemetryRateLimit("active-ip-2", 20, windowMs, testCap);

      // Now only active-ip-1 and active-ip-2 should remain in store
      expect(getTelemetryRateLimitStoreSize()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces default MAX_RATE_LIMIT_IPS capacity of 5000", () => {
    resetTelemetryRateLimits();
    expect(MAX_RATE_LIMIT_IPS).toBe(5000);

    for (let i = 0; i < 5005; i++) {
      checkTelemetryRateLimit(`client-${i}`);
    }
    expect(getTelemetryRateLimitStoreSize()).toBe(MAX_RATE_LIMIT_IPS);
  });
});

describe("createTelemetryHandler (Route Handler)", () => {
  it("returns 200 for valid feedback payload", async () => {
    const handler = createTelemetryHandler();
    const payload = {
      kind: "feedback",
      category: "general",
      message: "The practice session was super helpful!",
      rating: 5,
    };

    const req = new Request("http://localhost:3000/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify(payload),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const json = await res.json();
    expect(json).toEqual({ ok: true, recorded: true });

    const recent = getRecentTelemetryEvents();
    expect(recent).toHaveLength(1);
    expect((recent[0] as any).message).toBe("The practice session was super helpful!");
  });

  it("returns 200 for valid smoke test intent payload with auth token extraction", async () => {
    let capturedUserId: string | null | undefined;
    let capturedToken: string | undefined;

    const handler = createTelemetryHandler({
      verifyAuth: async () => ({
        authenticated: true,
        user: { id: "user-abc" } as any,
        tier: "pro",
        tierExpiresAt: null,
      }),
      recordTelemetry: async (event, meta) => {
        capturedUserId = meta?.userId;
        capturedToken = meta?.token;
        return { recorded: true, persistedToSupabase: false, relayedToWebhook: false };
      },
    });

    const payload = {
      kind: "smoke_test_intent",
      planId: "cram_pass",
      currency: "vnd",
      action: "plan_selected",
    };

    const req = new Request("http://localhost:3000/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
        authorization: "Bearer secret-token-xyz",
      },
      body: JSON.stringify(payload),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(capturedUserId).toBe("user-abc");
    expect(capturedToken).toBe("secret-token-xyz");
  });

  it("returns 403 when origin header is forbidden", async () => {
    const handler = createTelemetryHandler();
    const req = new Request("http://localhost:3000/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://evil-cross-origin.com",
      },
      body: JSON.stringify({
        kind: "feedback",
        category: "general",
        message: "Sneaky cross-origin request",
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("returns 413 when body length exceeds MAX_TELEMETRY_BODY_BYTES", async () => {
    const handler = createTelemetryHandler();
    const oversized = JSON.stringify({
      kind: "feedback",
      category: "general",
      message: "x".repeat(MAX_TELEMETRY_BODY_BYTES + 500),
    });

    const req = new Request("http://localhost:3000/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: oversized,
    });

    const res = await handler(req);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns 400 when body is malformed JSON", async () => {
    const handler = createTelemetryHandler();
    const req = new Request("http://localhost:3000/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: "{ not valid json ...",
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_TELEMETRY_PAYLOAD");
  });

  it("returns 400 when payload violates clientTelemetryPayloadSchema", async () => {
    const handler = createTelemetryHandler();
    const req = new Request("http://localhost:3000/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        kind: "unsupported_kind",
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_TELEMETRY_PAYLOAD");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const handler = createTelemetryHandler({
      checkRateLimit: () => ({ allowed: false, retryAfter: 45 }),
    });

    const req = new Request("http://localhost:3000/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        kind: "feedback",
        category: "general",
        message: "Testing rate limit",
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMITED");
  });
});

describe("AI Citation Rejection Telemetry", () => {
  it("records citation_rejection event with reason 'unmatched_excerpt_in_source' when AI hallucinates excerpt", async () => {
    clearRecentTelemetryEvents();

    const hallucinatedOutput = {
      title: "Price elasticity",
      sourceKind: "lecture",
      questions: [structuredClone(mockMicroeconomics.questions[0])],
      annotations: [
        {
          questionId: "elasticity",
          sourceId: "sec-1",
          excerpt:
            "Completely fabricated excerpt that does not exist anywhere in the source document.",
          topic: "Elasticity",
          chapter: "Chapter 4",
          rule: "Rule explanation",
        },
      ],
      warnings: [],
    };

    const model = createMockModel(hallucinatedOutput);

    await expect(
      generateQuestions(
        testDoc,
        testOptions,
        new AbortController().signal,
        model,
      ),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });

    const recent = getRecentTelemetryEvents();
    expect(recent.length).toBeGreaterThanOrEqual(1);

    const citationEvent = recent.find(
      (e): e is Extract<TimestampedTelemetryEvent, { kind: "citation_rejection" }> =>
        e.kind === "citation_rejection" && e.reason === "unmatched_excerpt_in_source",
    );
    expect(citationEvent).toBeDefined();
    expect(citationEvent?.documentTitle).toBe("notes.txt");
    expect(citationEvent?.excerptPreview).toContain(
      "Completely fabricated excerpt",
    );
  });

  it("records citation_rejection event on annotation_count_mismatch", () => {
    clearRecentTelemetryEvents();

    const output = {
      title: "Price elasticity",
      sourceKind: "lecture" as const,
      questions: [structuredClone(mockMicroeconomics.questions[0])],
      annotations: [], // Missing annotation
      warnings: [],
    };

    expect(() =>
      validateGeneratedStudy(output, testDoc, testOptions),
    ).toThrow();

    const recent = getRecentTelemetryEvents();
    const event = recent.find(
      (e): e is Extract<TimestampedTelemetryEvent, { kind: "citation_rejection" }> =>
        e.kind === "citation_rejection",
    );
    expect(event).toBeDefined();
    expect(event?.reason).toBe("annotation_count_mismatch");
  });

  it("records citation_rejection event on missing_or_short_excerpt", () => {
    clearRecentTelemetryEvents();

    const output = {
      title: "Price elasticity",
      sourceKind: "lecture" as const,
      questions: [structuredClone(mockMicroeconomics.questions[0])],
      annotations: [
        {
          questionId: "elasticity",
          sourceId: "sec-1",
          excerpt: " ".repeat(20), // 20 spaces passes Zod schema but normalize() is 0 < 12
          topic: "Elasticity",
          chapter: "Chapter 4",
          rule: "Rule",
        },
      ],
      warnings: [],
    };

    expect(() =>
      validateGeneratedStudy(output, testDoc, testOptions),
    ).toThrow();

    const recent = getRecentTelemetryEvents();
    const event = recent.find(
      (e): e is Extract<TimestampedTelemetryEvent, { kind: "citation_rejection" }> =>
        e.kind === "citation_rejection",
    );
    expect(event).toBeDefined();
    expect(event?.reason).toBe("missing_or_short_excerpt");
  });

  it("records citation_rejection event on unknown_source_id", () => {
    clearRecentTelemetryEvents();

    const output = {
      title: "Price elasticity",
      sourceKind: "lecture" as const,
      questions: [structuredClone(mockMicroeconomics.questions[0])],
      annotations: [
        {
          questionId: "elasticity",
          sourceId: "nonexistent-source-id-999",
          excerpt:
            "Demand is elastic when the absolute price elasticity exceeds one.",
          topic: "Elasticity",
          chapter: "Chapter 4",
          rule: "Rule",
        },
      ],
      warnings: [],
    };

    expect(() =>
      validateGeneratedStudy(output, testDoc, testOptions),
    ).toThrow();

    const recent = getRecentTelemetryEvents();
    const event = recent.find(
      (e): e is Extract<TimestampedTelemetryEvent, { kind: "citation_rejection" }> =>
        e.kind === "citation_rejection",
    );
    expect(event).toBeDefined();
    expect(event?.reason).toBe("unknown_source_id");
  });
});

describe("Webhook Sanitization & Deceptive Link Neutralization (Task 5.3)", () => {
  it("strips newlines from contact and single-line header fields", () => {
    const summary = formatTelemetryWebhookSummary({
      kind: "feedback",
      category: "general",
      message: "Legitimate user message",
      contact: "hacker@example.com\r\nInjected-Header: evil\nAnother-Header: exploit",
      context: {
        packTitle: "Microeconomics 101\r\nSecond line injection",
        questionId: "q100\nSub-line",
      },
    });

    const lines = summary.split("\n");
    const contactLine = lines.find((l) => l.startsWith("Contact:"));
    expect(contactLine).toBeDefined();
    expect(contactLine).toBe(
      "Contact: hacker@example.com Injected-Header: evil Another-Header: exploit",
    );
    expect(contactLine).not.toContain("\r");
    expect(contactLine).not.toContain("\n");

    const contextLine = lines.find((l) => l.startsWith("Context:"));
    expect(contextLine).toBeDefined();
    expect(contextLine).toContain("Pack: Microeconomics 101 Second line injection");
    expect(contextLine).toContain("Q: q100 Sub-line");
    expect(contextLine).not.toContain("\r");
    expect(contextLine).not.toContain("\n");
  });

  it("escapes markdown link syntax in contact, message, and context items to prevent deceptive hyperlinks", () => {
    const summary = formatTelemetryWebhookSummary({
      kind: "feedback",
      category: "gameplay_bug",
      message: "Please click [Claim Free Cram Pass](https://phishing-scam.com/steal-creds) to fix this bug!",
      contact: "[Customer Support](https://deceptive-portal.site/login)",
      context: {
        packTitle: "[Fake Biology](https://malware.org/download)",
        questionId: "[Q-Attack](https://evil.org)",
      },
    });

    // Verify contact markdown brackets are escaped
    expect(summary).toContain("Contact: \\[Customer Support\\](https://deceptive-portal.site/login)");
    expect(summary).not.toContain("Contact: [Customer Support](https://deceptive-portal.site/login)");

    // Verify message markdown brackets are escaped inside the blockquote
    expect(summary).toContain("\\[Claim Free Cram Pass\\](https://phishing-scam.com/steal-creds)");
    expect(summary).not.toContain("> Please click [Claim Free Cram Pass]");

    // Verify context markdown brackets are escaped
    expect(summary).toContain("Pack: \\[Fake Biology\\](https://malware.org/download)");
    expect(summary).toContain("Q: \\[Q-Attack\\](https://evil.org)");
  });

  it("sanitizes smoke_test_intent contact with newlines and markdown hyperlinks", () => {
    const summary = formatTelemetryWebhookSummary({
      kind: "smoke_test_intent",
      planId: "pro",
      currency: "usd",
      action: "plan_selected",
      contact: "victim@example.com\n[Urgent Action](https://phishing.site/link)",
      language: "en",
    });

    const lines = summary.split("\n");
    const contactLine = lines.find((l) => l.startsWith("Contact:"));
    expect(contactLine).toBeDefined();
    expect(contactLine).toBe("Contact: victim@example.com \\[Urgent Action\\](https://phishing.site/link)");
    expect(contactLine).not.toContain("\n");
    expect(contactLine).not.toContain("\r");
  });

  it("standalone helper functions handle idempotency and edge cases", () => {
    expect(sanitizeSingleLine("hello\r\nworld\nfoo")).toBe("hello world foo");
    expect(sanitizeSingleLine("")).toBe("");

    expect(escapeMarkdownLinks("[test](http://example.com)")).toBe("\\[test\\](http://example.com)");
    // Idempotent escaping
    expect(escapeMarkdownLinks("\\[test\\](http://example.com)")).toBe("\\[test\\](http://example.com)");
    expect(escapeMarkdownLinks("")).toBe("");

    expect(sanitizeHeaderField("hello\n[world](url)")).toBe("hello \\[world\\](url)");
  });
});

describe("PII Redaction in Telemetry Logging (Task 5.3)", () => {
  it("redactContact correctly masks emails and redacts phones/identifiers", () => {
    expect(redactContact("alice@example.com")).toBe("a***@example.com");
    expect(redactContact("support.team@clutcharena.vn")).toBe("s***@clutcharena.vn");
    expect(redactContact("x@domain.com")).toBe("x***@domain.com");
    expect(redactContact("+1 (555) 019-2834")).toBe("[REDACTED]");
    expect(redactContact("random_telegram_handle")).toBe("[REDACTED]");
    expect(redactContact("")).toBe("");
  });

  it("redactTelemetryPayload redacts contact in feedback and smoke_test_intent events", () => {
    const feedbackEvent = {
      kind: "feedback" as const,
      category: "general" as const,
      message: "Testing PII",
      contact: "user.secret@example.org",
      recordedAt: new Date().toISOString(),
    };
    const redactedFeedback = redactTelemetryPayload(feedbackEvent);
    expect(redactedFeedback.contact).toBe("u***@example.org");

    const smokeEvent = {
      kind: "smoke_test_intent" as const,
      planId: "cram_pass" as const,
      currency: "vnd" as const,
      action: "plan_selected" as const,
      contact: "+84912345678",
      recordedAt: new Date().toISOString(),
    };
    const redactedSmoke = redactTelemetryPayload(smokeEvent);
    expect(redactedSmoke.contact).toBe("[REDACTED]");

    const citationEvent = {
      kind: "citation_rejection" as const,
      reason: "missing_or_short_excerpt" as const,
      recordedAt: new Date().toISOString(),
    };
    const untouchedCitation = redactTelemetryPayload(citationEvent);
    expect(untouchedCitation).toEqual(citationEvent);
  });

  it("recordTelemetryEvent redacts contact PII when logging to console.info in non-test environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      await recordTelemetryEvent({
        kind: "feedback",
        category: "gameplay_bug",
        message: "Found a scoring discrepancy",
        contact: "security-auditor@example.com",
      });

      expect(consoleSpy).toHaveBeenCalled();
      const calls = consoleSpy.mock.calls.filter((c) => c[0] === "[pilot-telemetry]");
      expect(calls.length).toBeGreaterThanOrEqual(1);

      const loggedString = calls[0][1];
      const parsed = JSON.parse(loggedString);

      // Verify contact is masked and raw email is NOT present in stdout log
      expect(parsed.contact).toBe("s***@example.com");
      expect(loggedString).not.toContain("security-auditor@example.com");

      // Test with non-email phone number contact
      await recordTelemetryEvent({
        kind: "smoke_test_intent",
        planId: "pro",
        currency: "usd",
        action: "plan_selected",
        contact: "+15555550199",
      });

      const secondCalls = consoleSpy.mock.calls.filter((c) => c[0] === "[pilot-telemetry]");
      const secondLogged = JSON.parse(secondCalls[1][1]);
      expect(secondLogged.contact).toBe("[REDACTED]");
      expect(secondCalls[1][1]).not.toContain("+15555550199");
    } finally {
      consoleSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe("Security Configuration & Next.js CSP (Task 5.3)", () => {
  it("ensures next.config.ts CSP script-src does NOT contain wildcard https:", async () => {
    const headersList = await nextConfig.headers?.();
    expect(headersList).toBeDefined();

    const rootRule = headersList?.find((rule) => rule.source === "/(.*)");
    expect(rootRule).toBeDefined();

    const cspHeader = rootRule?.headers.find(
      (h) => h.key === "Content-Security-Policy",
    );
    expect(cspHeader).toBeDefined();
    const cspValue = cspHeader?.value ?? "";

    // Split CSP directives
    const directives = cspValue.split(";").map((d) => d.trim());
    const scriptSrc = directives.find((d) => d.startsWith("script-src"));

    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");

    // Crucial security assertion: No wildcard https: in script-src
    expect(scriptSrc).not.toContain("https:");
    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
