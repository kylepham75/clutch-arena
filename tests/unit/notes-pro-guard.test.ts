import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { verifyProAccess } from "@/lib/auth/notes-guard";

describe("Clutch Notes AI Pro-Tier Access Guard", () => {
  it("rejects unauthenticated requests with UNAUTHENTICATED reason", async () => {
    const request = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
    });

    const result = await verifyProAccess(request);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("UNAUTHENTICATED");
  });

  it("rejects free tier ('contender') users with PRO_REQUIRED reason", async () => {
    const request = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "contender",
      },
    });

    const result = await verifyProAccess(request);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("PRO_REQUIRED");
    expect(result.message).toContain("Pro Tier members");
  });

  it("authorizes active subscribers across all paid tiers (cram_pass, pro, tutor)", async () => {
    // Test 7-Day Cram Pass ('cram_pass' and 'CRAM_PASS')
    const reqCram = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "cram_pass",
      },
    });
    const resultCram = await verifyProAccess(reqCram);
    expect(resultCram.authorized).toBe(true);
    expect(resultCram.tier).toBe("cram_pass");

    const reqCramUpper = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "CRAM_PASS",
      },
    });
    const resultCramUpper = await verifyProAccess(reqCramUpper);
    expect(resultCramUpper.authorized).toBe(true);

    // Test lowercase 'pro'
    const reqPro = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro",
      },
    });
    const resultPro = await verifyProAccess(reqPro);
    expect(resultPro.authorized).toBe(true);
    expect(resultPro.tier).toBe("pro");

    // Test uppercase 'PRO'
    const reqPRO = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "PRO",
      },
    });
    const resultPRO = await verifyProAccess(reqPRO);
    expect(resultPRO.authorized).toBe(true);

    // Test 'tutor' tier
    const reqTutor = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "tutor",
      },
    });
    const resultTutor = await verifyProAccess(reqTutor);
    expect(resultTutor.authorized).toBe(true);
    expect(resultTutor.tier).toBe("tutor");
  });

  describe("Security: Production Paywall & Header Bypass Prevention", () => {
    it("strictly ignores x-test-tier header in production to prevent paywall/auth bypass", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ALLOW_TEST_TIER_OVERRIDE;

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          "x-test-tier": "pro",
        },
      });

      const result = await verifyProAccess(req);
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe("UNAUTHENTICATED");
      expect(result.message).toContain("Authentication required");

      vi.unstubAllEnvs();
    });

    it("allows x-test-tier override in production ONLY when ALLOW_TEST_TIER_OVERRIDE is explicitly true", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ALLOW_TEST_TIER_OVERRIDE", "true");

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          "x-test-tier": "pro",
        },
      });

      const result = await verifyProAccess(req);
      expect(result.authorized).toBe(true);
      expect(result.tier).toBe("pro");

      vi.unstubAllEnvs();
    });
  });
});
