import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const setNodeEnv = (val: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = val;
};

describe("Production Rate Limit Configuration Guard", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.NEXT_PHASE;
    delete process.env.SKIP_REDIS_CHECK_FOR_TESTS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const EXPECTED_ERROR_MSG =
    "[RateLimit] CRITICAL CONFIG ERROR: UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN is not configured in production! Distributed rate limiting cannot be guaranteed on serverless instances.";

  describe("assertProductionRateLimitConfig function", () => {
    it("throws critical config error when NODE_ENV === 'production' and Redis env vars are missing", async () => {
      setNodeEnv("test");
      const { assertProductionRateLimitConfig } = await import("@/lib/rate-limit");
      setNodeEnv("production");
      expect(() => assertProductionRateLimitConfig()).toThrowError(EXPECTED_ERROR_MSG);
    });

    it("does not throw when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set", async () => {
      setNodeEnv("production");
      process.env.UPSTASH_REDIS_REST_URL = "https://upstash-mock.example.com";
      process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token-xyz";

      const { assertProductionRateLimitConfig } = await import("@/lib/rate-limit");
      expect(() => assertProductionRateLimitConfig()).not.toThrow();
    });

    it("does not throw when KV_REST_API_URL and KV_REST_API_TOKEN are set", async () => {
      setNodeEnv("production");
      process.env.KV_REST_API_URL = "https://kv-mock.example.com";
      process.env.KV_REST_API_TOKEN = "mock-kv-token-xyz";

      const { assertProductionRateLimitConfig } = await import("@/lib/rate-limit");
      expect(() => assertProductionRateLimitConfig()).not.toThrow();
    });

    it("does not throw during Next.js production build phase even if credentials are missing", async () => {
      setNodeEnv("production");
      process.env.NEXT_PHASE = "phase-production-build";

      const { assertProductionRateLimitConfig } = await import("@/lib/rate-limit");
      expect(() => assertProductionRateLimitConfig()).not.toThrow();
    });

    it("does not throw when SKIP_REDIS_CHECK_FOR_TESTS === 'true' even in production", async () => {
      setNodeEnv("production");
      process.env.SKIP_REDIS_CHECK_FOR_TESTS = "true";

      const { assertProductionRateLimitConfig } = await import("@/lib/rate-limit");
      expect(() => assertProductionRateLimitConfig()).not.toThrow();
    });

    it("does not throw in test or development environments", async () => {
      setNodeEnv("test");
      const { assertProductionRateLimitConfig } = await import("@/lib/rate-limit");
      expect(() => assertProductionRateLimitConfig()).not.toThrow();

      setNodeEnv("development");
      expect(() => assertProductionRateLimitConfig()).not.toThrow();
    });
  });

  describe("Module-load-time enforcement in production", () => {
    it("aborts module load in production runtime when credentials are missing", async () => {
      setNodeEnv("production");
      vi.resetModules();

      await expect(import("@/lib/rate-limit")).rejects.toThrowError(EXPECTED_ERROR_MSG);
    });

    it("loads module successfully in production when Upstash credentials are present", async () => {
      setNodeEnv("production");
      process.env.UPSTASH_REDIS_REST_URL = "https://upstash-mock.example.com";
      process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token-xyz";
      vi.resetModules();

      const mod = await import("@/lib/rate-limit");
      expect(mod).toBeDefined();
      expect(typeof mod.checkRateLimit).toBe("function");
    });

    it("loads module successfully in production when Vercel KV credentials are present", async () => {
      setNodeEnv("production");
      process.env.KV_REST_API_URL = "https://kv-mock.example.com";
      process.env.KV_REST_API_TOKEN = "mock-kv-token-xyz";
      vi.resetModules();

      const mod = await import("@/lib/rate-limit");
      expect(mod).toBeDefined();
      expect(typeof mod.checkRateLimit).toBe("function");
    });

    it("loads module successfully during Next.js production build phase without Redis credentials", async () => {
      setNodeEnv("production");
      process.env.NEXT_PHASE = "phase-production-build";
      vi.resetModules();

      const mod = await import("@/lib/rate-limit");
      expect(mod).toBeDefined();
      expect(typeof mod.checkRateLimit).toBe("function");
    });
  });

  describe("Runtime invocation enforcement", () => {
    it("throws critical error when invoking checkRateLimit in production with missing config", async () => {
      setNodeEnv("test");
      process.env.SKIP_REDIS_CHECK_FOR_TESTS = "true";
      const { checkRateLimit } = await import("@/lib/rate-limit");

      // Switch to production with missing env vars
      setNodeEnv("production");
      delete process.env.SKIP_REDIS_CHECK_FOR_TESTS;

      await expect(checkRateLimit("test-actor", "ingest", "contender")).rejects.toThrowError(
        EXPECTED_ERROR_MSG,
      );
    });

    it("throws critical error when invoking checkAndReserveDeckQuota in production with missing config", async () => {
      setNodeEnv("test");
      process.env.SKIP_REDIS_CHECK_FOR_TESTS = "true";
      const { checkAndReserveDeckQuota } = await import("@/lib/rate-limit");

      setNodeEnv("production");
      delete process.env.SKIP_REDIS_CHECK_FOR_TESTS;

      await expect(
        checkAndReserveDeckQuota("test-user-123", "contender", "hash-abc-123"),
      ).rejects.toThrowError(EXPECTED_ERROR_MSG);
    });

    it("throws critical error when invoking checkNotesRateLimit in production with missing config", async () => {
      setNodeEnv("test");
      process.env.SKIP_REDIS_CHECK_FOR_TESTS = "true";
      const { checkNotesRateLimit } = await import("@/lib/rate-limit");

      setNodeEnv("production");
      delete process.env.SKIP_REDIS_CHECK_FOR_TESTS;

      await expect(checkNotesRateLimit("test-user-123", "pro")).rejects.toThrowError(
        EXPECTED_ERROR_MSG,
      );
    });

    it("logs warning on degradation to in-memory fallback in production build phase without throwing", async () => {
      setNodeEnv("production");
      process.env.NEXT_PHASE = "phase-production-build";
      vi.resetModules();

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { checkRateLimit } = await import("@/lib/rate-limit");

      const result = await checkRateLimit("build-test-actor", "ingest", "contender");
      expect(result.allowed).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
