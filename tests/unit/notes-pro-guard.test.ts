import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type MockUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

let mockUser: MockUser | null = null;
let mockSubscription: Record<string, unknown> | null = null;
let mockProfile: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseServerConfigured: vi.fn(() => true),
  getSupabaseServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => {
        if (!mockUser) {
          return { data: { user: null }, error: new Error("User not found") };
        }
        return { data: { user: mockUser }, error: null };
      }),
    },
    from: vi.fn((table: string) => {
      const createQueryBuilder = (resultData: unknown) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: resultData, error: null })),
      });

      if (table === "user_subscriptions") {
        return createQueryBuilder(mockSubscription);
      }
      if (table === "profiles" || table === "user_profiles") {
        return createQueryBuilder(mockProfile);
      }
      return createQueryBuilder(null);
    }),
  })),
}));

import { verifyNotesAccess, verifyProAccess, isAuthorizedForNotes } from "@/lib/auth/notes-guard";
import { verifyAuthToken } from "@/lib/auth/server-guard";

describe("Clutch Notes AI Access Guard (Unified Rolling % Quota)", () => {
  beforeEach(() => {
    mockUser = null;
    mockSubscription = null;
    mockProfile = null;
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated requests with UNAUTHENTICATED reason", async () => {
    const request = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
    });

    const result = await verifyNotesAccess(request);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("UNAUTHENTICATED");
  });

  it("rejects anonymous guest x-test-tier header with UNAUTHENTICATED reason", async () => {
    const request = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "guest",
      },
    });

    const result = await verifyNotesAccess(request);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("UNAUTHENTICATED");
    expect(result.message).toContain("Authentication required");
  });

  it("authorizes signed-in free tier ('contender' / 'free') users for 1-section concise notes inside 3d rolling % quota", async () => {
    const request = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "contender",
      },
    });

    const result = await verifyNotesAccess(request);
    expect(result.authorized).toBe(true);
    expect(result.tier).toBe("contender");
    expect(result.user?.id).toBe("test-user-contender-id");

    const freeAliasRequest = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "free",
      },
    });
    const freeAliasResult = await verifyProAccess(freeAliasRequest);
    expect(freeAliasResult.authorized).toBe(true);
    expect(freeAliasResult.tier).toBe("contender");
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

    // Test 'pro_monthly' tier preservation
    const reqProMonthly = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
      headers: {
        "x-test-tier": "pro_monthly",
      },
    });
    const resultProMonthly = await verifyProAccess(reqProMonthly);
    expect(resultProMonthly.authorized).toBe(true);
    expect(resultProMonthly.tier).toBe("pro_monthly");
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

      const result = await verifyNotesAccess(req);
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe("UNAUTHENTICATED");
      expect(result.message).toContain("Authentication required");

      const contenderReq = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          "x-test-tier": "contender",
        },
      });
      const contenderResult = await verifyNotesAccess(contenderReq);
      expect(contenderResult.authorized).toBe(false);
      expect(contenderResult.reason).toBe("UNAUTHENTICATED");
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

      const result = await verifyNotesAccess(req);
      expect(result.authorized).toBe(true);
      expect(result.tier).toBe("pro");
    });
  });

  describe("isAuthorizedForNotes tier validation", () => {
    it("authorizes all signed-in tiers (contender, free, cram_pass, pro_monthly, pro, tutor) and rejects guest/empty", () => {
      expect(isAuthorizedForNotes("contender")).toBe(true);
      expect(isAuthorizedForNotes("free")).toBe(true);
      expect(isAuthorizedForNotes("pro_monthly")).toBe(true);
      expect(isAuthorizedForNotes("pro-monthly")).toBe(true);
      expect(isAuthorizedForNotes("cram_pass")).toBe(true);
      expect(isAuthorizedForNotes("crampass")).toBe(true);
      expect(isAuthorizedForNotes("cram-pass")).toBe(true);
      expect(isAuthorizedForNotes("pro")).toBe(true);
      expect(isAuthorizedForNotes("pro_semester")).toBe(true);
      expect(isAuthorizedForNotes("tutor")).toBe(true);
      expect(isAuthorizedForNotes("tutor_guild")).toBe(true);
      expect(isAuthorizedForNotes("guest")).toBe(false);
      expect(isAuthorizedForNotes("anonymous")).toBe(false);
      expect(isAuthorizedForNotes("")).toBe(false);
      expect(isAuthorizedForNotes(null)).toBe(false);
      expect(isAuthorizedForNotes(undefined)).toBe(false);
    });
  });

  describe("SA-02: Client-Writable user_metadata.tier Privilege Escalation Prevention", () => {
    it("blocks escalation for user with user_metadata.tier = 'pro' (profile = contender) in verifyAuthToken and verifyNotesAccess", async () => {
      mockUser = {
        id: "attacker-user-id",
        email: "attacker@clutcharena.com",
        app_metadata: {},
        user_metadata: { tier: "pro" },
      };
      mockSubscription = null;
      mockProfile = { tier: "contender", tier_expires_at: null };

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer mock-attacker-jwt",
        },
      });

      // verifyAuthToken must not read user_metadata.tier
      const authResult = await verifyAuthToken(req);
      expect(authResult.authenticated).toBe(true);
      if (!authResult.authenticated) throw new Error("Expected authenticated");
      expect(authResult.tier).toBe("contender");

      // verifyNotesAccess authorizes signed-in contender inside 3d rolling quota, never elevated to 'pro'
      const notesResult = await verifyNotesAccess(req);
      expect(notesResult.authorized).toBe(true);
      expect(notesResult.tier).toBe("contender");
      expect(notesResult.user?.id).toBe("attacker-user-id");
    });

    it("blocks escalation for user with user_metadata.tier = 'tutor' (profile = null) in verifyAuthToken and verifyNotesAccess", async () => {
      mockUser = {
        id: "attacker-user-id-2",
        email: "attacker2@clutcharena.com",
        app_metadata: {},
        user_metadata: { tier: "tutor" },
      };
      mockSubscription = null;
      mockProfile = null;

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer mock-attacker-jwt-2",
        },
      });

      const authResult = await verifyAuthToken(req);
      expect(authResult.authenticated).toBe(true);
      if (!authResult.authenticated) throw new Error("Expected authenticated");
      expect(authResult.tier).toBe("contender");

      const notesResult = await verifyNotesAccess(req);
      expect(notesResult.authorized).toBe(true);
      expect(notesResult.tier).toBe("contender");
    });
  });

  describe("SA-02: Expired app_metadata Tier Downgrade Enforcement", () => {
    it("downgrades a user with expired app_metadata (cram_pass expired in 2020) to contender", async () => {
      mockUser = {
        id: "expired-user-id",
        email: "expired@clutcharena.com",
        app_metadata: {
          tier: "cram_pass",
          tier_expires_at: "2020-01-01T00:00:00Z",
        },
        user_metadata: {},
      };
      mockSubscription = null;
      mockProfile = null;

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer mock-expired-jwt",
        },
      });

      const authResult = await verifyAuthToken(req);
      expect(authResult.authenticated).toBe(true);
      if (!authResult.authenticated) throw new Error("Expected authenticated");
      expect(authResult.tier).toBe("contender");
      expect(authResult.tierExpiresAt).toBeNull();

      const notesResult = await verifyNotesAccess(req);
      expect(notesResult.authorized).toBe(true);
      expect(notesResult.tier).toBe("contender");
    });

    it("authorizes a user with active unexpired app_metadata tier", async () => {
      mockUser = {
        id: "valid-admin-granted-user",
        email: "admin-grant@clutcharena.com",
        app_metadata: {
          tier: "pro",
        },
        user_metadata: {},
      };
      mockSubscription = null;
      mockProfile = null;

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer mock-valid-jwt",
        },
      });

      const authResult = await verifyAuthToken(req);
      expect(authResult.authenticated).toBe(true);
      if (!authResult.authenticated) throw new Error("Expected authenticated");
      expect(authResult.tier).toBe("pro");

      const proResult = await verifyProAccess(req);
      expect(proResult.authorized).toBe(true);
      expect(proResult.tier).toBe("pro");
    });

    it("authorizes a user with future unexpired cram_pass in app_metadata", async () => {
      const futureExpiry = new Date(Date.now() + 86400000 * 5).toISOString();
      mockUser = {
        id: "valid-cram-user",
        email: "cram@clutcharena.com",
        app_metadata: {
          tier: "cram_pass",
          tier_expires_at: futureExpiry,
        },
        user_metadata: {},
      };
      mockSubscription = null;
      mockProfile = null;

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer mock-cram-jwt",
        },
      });

      const authResult = await verifyAuthToken(req);
      expect(authResult.authenticated).toBe(true);
      if (!authResult.authenticated) throw new Error("Expected authenticated");
      expect(authResult.tier).toBe("cram_pass");
      expect(authResult.tierExpiresAt).toBe(futureExpiry);

      const proResult = await verifyProAccess(req);
      expect(proResult.authorized).toBe(true);
      expect(proResult.tier).toBe("cram_pass");
    });
  });

  describe("SA2-07: Admin Downgrade & Stale app_metadata Fallback Prevention", () => {
    it("overrides stale paid app_metadata (pro) with contender DB profile", async () => {
      mockUser = {
        id: "downgraded-pro-user-id",
        email: "downgraded@clutcharena.com",
        app_metadata: {
          tier: "pro",
        },
        user_metadata: {},
      };
      mockSubscription = null;
      mockProfile = { tier: "contender", tier_expires_at: null };

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer mock-downgraded-jwt",
        },
      });

      const authResult = await verifyAuthToken(req);
      expect(authResult.authenticated).toBe(true);
      if (!authResult.authenticated) throw new Error("Expected authenticated");
      expect(authResult.tier).toBe("contender");

      const notesResult = await verifyNotesAccess(req);
      expect(notesResult.authorized).toBe(true);
      expect(notesResult.tier).toBe("contender");
    });

    it("overrides future cram_pass in stale app_metadata with contender DB profile", async () => {
      const futureExpiry = new Date(Date.now() + 86400000 * 5).toISOString();
      mockUser = {
        id: "downgraded-cram-user-id",
        email: "downgraded-cram@clutcharena.com",
        app_metadata: {
          tier: "cram_pass",
          tier_expires_at: futureExpiry,
        },
        user_metadata: {},
      };
      mockSubscription = null;
      mockProfile = { tier: "contender", tier_expires_at: null };

      const req = new Request("https://clutcharena.com/api/notes/generate", {
        method: "POST",
        headers: {
          authorization: "Bearer mock-downgraded-cram-jwt",
        },
      });

      const authResult = await verifyAuthToken(req);
      expect(authResult.authenticated).toBe(true);
      if (!authResult.authenticated) throw new Error("Expected authenticated");
      expect(authResult.tier).toBe("contender");

      const notesResult = await verifyNotesAccess(req);
      expect(notesResult.authorized).toBe(true);
      expect(notesResult.tier).toBe("contender");
    });
  });
});
