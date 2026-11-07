import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const captureExceptionMock = vi.fn();
const initMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  init: (...args: unknown[]) => initMock(...args),
}));

vi.mock("@/lib/auth/server-guard", () => ({
  verifyAuthToken: vi.fn(),
  extractAuthToken: vi.fn(),
}));

vi.mock("@/lib/payments/payos", () => ({
  isPayosConfigured: vi.fn(),
  createPayosPaymentLink: vi.fn(),
  resolveTrustedPayosOrigin: vi.fn((origin: string | null) => origin || "http://localhost:3000"),
  verifyPayosWebhookSignature: vi.fn(),
  fulfillPayosOrder: vi.fn(),
  isAdminTestEmail: vi.fn(),
  SANDBOX_TEST_AMOUNT_VND: 5000,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(() => null),
}));

describe("Sentry Telemetry & Exception Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PayOS Create Payment Route Telemetry", () => {
    it("captures exception with correct route tag when create payment fails", async () => {
      const { isPayosConfigured } = await import("@/lib/payments/payos");
      const { verifyAuthToken } = await import("@/lib/auth/server-guard");
      const { POST } = await import("@/app/api/payments/payos/create/route");

      vi.mocked(isPayosConfigured).mockReturnValue(true);
      const authError = new Error("Auth service unavailable");
      vi.mocked(verifyAuthToken).mockRejectedValueOnce(authError);

      const request = new Request("http://localhost:3000/api/payments/payos/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "cram_pass" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);

      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
      expect(captureExceptionMock).toHaveBeenCalledWith(authError, {
        tags: { route: "api/payments/payos/create" },
      });
    });
  });

  describe("PayOS Webhook Route Telemetry", () => {
    it("captures exception with correct route tag when webhook processing throws", async () => {
      const { verifyPayosWebhookSignature } = await import("@/lib/payments/payos");
      const { POST } = await import("@/app/api/webhooks/payos/route");

      const webhookError = new Error("Database deadlock during signature verification");
      vi.mocked(verifyPayosWebhookSignature).mockImplementationOnce(() => {
        throw webhookError;
      });

      const request = new Request("http://localhost:3000/api/webhooks/payos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "00",
          data: { orderCode: 999999, amount: 69000 },
          signature: "dummy_valid_sig",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);

      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
      expect(captureExceptionMock).toHaveBeenCalledWith(webhookError, {
        tags: { route: "api/webhooks/payos" },
      });
    });
  });

  describe("Ingestion Handler Route Telemetry", () => {
    it("captures exception with api/ingest route tag when ingestion processing fails", async () => {
      const { createIngestionHandler } = await import("@/lib/ingestion/handler");
      const parseError = new Error("PDF parser failed unexpectedly");
      const handler = createIngestionHandler({
        checkConfiguration: vi.fn(),
        parseDoc: vi.fn().mockRejectedValueOnce(parseError),
        rateLimiter: vi.fn().mockResolvedValue({ allowed: true, limit: 10, remaining: 9, reset: 0 }),
        verifyAuth: vi.fn().mockResolvedValue({ authenticated: true, tier: "pro", user: { id: "user_1" } }),
      });

      const formData = new FormData();
      formData.append(
        "file",
        new Blob(["Valid document content with sufficient length for testing"], {
          type: "text/plain",
        }),
        "test.txt",
      );
      formData.append(
        "options",
        JSON.stringify({
          operation: "generate",
          questionCount: 5,
          language: "en",
          mode: "exact",
        }),
      );

      const request = new Request("http://localhost:3000/api/ingest", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: formData,
      });

      const response = await handler(request);
      expect(response.status).toBe(500);

      expect(captureExceptionMock).toHaveBeenCalledWith(parseError, {
        tags: { route: "api/ingest" },
      });
    });
  });

  describe("AI Verify Questions Telemetry", () => {
    it("captures exception with verify-questions component tag when primary verification fails", async () => {
      const { verifyQuestionsBlindly } = await import("@/lib/ai/verify-questions");
      const primaryError = new Error("Primary verification model quota exhausted");

      const failingModel = {
        modelId: "mock-primary-model",
        specificationVersion: "v2" as const,
        provider: "mock",
        doGenerate: vi.fn().mockRejectedValue(primaryError),
      };

      await expect(
        verifyQuestionsBlindly(
          [
            {
              id: "q1",
              question: "What is 2 + 2?",
              options: ["1", "2", "3", "4"],
              correctIndex: 3,
            },
          ],
          {
            verifierModel: failingModel as any,
            generatorSlug: "anthropic/claude-3-haiku",
            verifierSlug: "openai/gpt-4o-mini",
            allowFallbacks: false,
          },
        ),
      ).rejects.toThrow("Primary verification model quota exhausted");

      expect(captureExceptionMock).toHaveBeenCalledWith(primaryError, {
        tags: {
          component: "verify-questions",
          generatorSlug: "anthropic/claude-3-haiku",
        },
      });
    });
  });

  describe("Sentry Client, Server, and Edge Config Initializations", () => {
    it("initializes sentry client config without error", async () => {
      initMock.mockClear();
      const clientModule = await import("../../sentry.client.config");

      expect(clientModule).toBeDefined();
      expect(clientModule.sentryClientOptions).toBeDefined();
      expect(typeof clientModule.sentryClientOptions.tracesSampleRate).toBe("number");
      expect(typeof clientModule.sentryClientOptions.enabled).toBe("boolean");
      expect(initMock).toHaveBeenCalledWith(clientModule.sentryClientOptions);
    });

    it("initializes sentry server config without error", async () => {
      initMock.mockClear();
      const serverModule = await import("../../sentry.server.config");

      expect(serverModule).toBeDefined();
      expect(serverModule.sentryServerOptions).toBeDefined();
      expect(typeof serverModule.sentryServerOptions.tracesSampleRate).toBe("number");
      expect(typeof serverModule.sentryServerOptions.enabled).toBe("boolean");
      expect(initMock).toHaveBeenCalledWith(serverModule.sentryServerOptions);
    });

    it("initializes sentry edge config without error", async () => {
      initMock.mockClear();
      const edgeModule = await import("../../sentry.edge.config");

      expect(edgeModule).toBeDefined();
      expect(edgeModule.sentryEdgeOptions).toBeDefined();
      expect(typeof edgeModule.sentryEdgeOptions.tracesSampleRate).toBe("number");
      expect(typeof edgeModule.sentryEdgeOptions.enabled).toBe("boolean");
      expect(initMock).toHaveBeenCalledWith(edgeModule.sentryEdgeOptions);
    });
  });
});
