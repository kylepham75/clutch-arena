import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

let mockBrowserSupabase: any = null;
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: () => Boolean(mockBrowserSupabase),
  getSupabaseBrowserClient: () => mockBrowserSupabase,
}));

let mockServerSupabase: any = null;
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseServerConfigured: () => Boolean(mockServerSupabase),
  getSupabaseServerClient: () => mockServerSupabase,
}));

import {
  PRICING_PLANS,
  TIER_LIMITS,
  getMaxArenaPlayersForTier,
  canUseCustomWatermarkPdf,
  getStoredUserTier,
  setStoredUserTier,
  getStoredTierExpires,
  clearStoredUserTier,
  USER_TIER_STORAGE_KEY,
  USER_TIER_EXPIRES_KEY,
  calculateTierExpiration,
  syncUserTierToCloud,
  fetchCloudUserTier,
  getStoredReferralState,
  awardReferralPass,
  consumeUnlockedRemixRun,
  evaluateCogsDegradation,
  formatQuotaPercentBadge,
  formatQuotaResetCountdown,
  normalizeTier,
  resolveTierFromProfileRecord,
  getRegionalCogsCeiling,
  getRegionalWindowBudget,
  getRegionalGuardBudget,
} from "@/lib/pricing/tiers";
import { verifyAndClampClientTier } from "@/hooks/use-user-tier";
import {
  checkAndReserveDeckQuota,
  recordDeckGenerationCogs,
  getUserQuotaLedger,
  saveUserQuotaLedger,
  getRollingQuotaSnapshot,
  computeRollingQuotaSnapshot,
  toClientQuota,
  getSharedDeckCache,
  setSharedDeckCache,
  computeContentHash,
  computeFileSha256,
  sampleQuestionsFromCachedPool,
  resetQuotaLedgersForTests,
} from "@/lib/rate-limit";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import {
  createRoom,
  joinRoom,
  getRoom,
  IDLE_ROOM_TIMEOUT_MS,
} from "@/lib/multiplayer/room-manager";
import { mockMicroeconomics } from "@/data/mock-microeconomics";

function createMockSupabase(handlers: {
  userSubscriptions?: { tier: string; expires_at: string | null; status?: string } | null;
  profiles?: { tier: string; tier_expires_at: string | null; updated_at?: string } | null;
  userProfiles?: { tier: string; tier_expires_at: string | null; updated_at?: string } | null;
  user?: { id: string; email?: string; app_metadata?: any; user_metadata?: any };
}) {
  const user = handlers.user ?? {
    id: "test-user-id",
    email: "student@clutcharena.com",
    app_metadata: {},
    user_metadata: {},
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    channel: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue({}),
      subscribe: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    }),
    from: vi.fn((table: string) => {
      let rowData: any = null;
      if (table === "user_subscriptions") {
        rowData = handlers.userSubscriptions ?? null;
      } else if (table === "profiles") {
        rowData = handlers.profiles ?? null;
      } else if (table === "user_profiles") {
        rowData = handlers.userProfiles ?? null;
      }

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: rowData, error: null }),
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      return chain;
    }),
  };
}

describe("PPP Tier Architecture & Limits", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {
        mockStorage = {};
      },
    };

    (globalThis as any).window = {
      dispatchEvent: vi.fn(),
    };
    (globalThis as any).localStorage = storageMock;
    mockBrowserSupabase = null;
    mockServerSupabase = null;
  });

  it("defines the 5 plans with accurate dual-market pricing and feature caps", () => {
    expect(PRICING_PLANS).toHaveLength(5);
    expect(PRICING_PLANS.map((p) => p.id)).toEqual([
      "contender",
      "cram_pass",
      "pro_monthly",
      "pro",
      "tutor",
    ]);

    const contender = PRICING_PLANS.find((p) => p.id === "contender")!;
    expect(contender.pricing.VN.amount).toBe(0);
    expect(contender.pricing.VN.formatted).toBe("0đ");
    expect(contender.pricing.ROW.amount).toBe(0);
    expect(contender.pricing.ROW.formatted).toBe("$0");
    expect(contender.priceVndFormatted).toBe("0đ");
    expect(contender.priceUsdFormatted).toBe("$0");
    expect(TIER_LIMITS.contender.maxQuestionsPerRun).toBe(10);
    expect(TIER_LIMITS.contender.maxFilesPerUpload).toBe(1);
    expect(TIER_LIMITS.contender.freeRegenerationsPerDeck).toBe(1);
    expect(TIER_LIMITS.contender.canUseConceptRemix).toBe(false);
    expect(TIER_LIMITS.contender.canDebriefWithCoach).toBe(true);
    expect(TIER_LIMITS.contender.canUseClutchNotes).toBe(true);
    expect(TIER_LIMITS.contender.canExportCheatSheet).toBe(false);
    expect(TIER_LIMITS.contender.canHostArenaRemix).toBe(false);
    expect(TIER_LIMITS.contender.maxArenaPlayers).toBe(8);
    expect(TIER_LIMITS.contender.cogsCeilingUsd.VN).toBe(0.08);
    expect(TIER_LIMITS.contender.cogsCeilingUsd.ROW).toBe(0.08);
    expect(TIER_LIMITS.contender.rollingQuota.primaryWindowHours).toBe(72);
    expect(TIER_LIMITS.contender.rollingQuota.primaryBudgetUsd.VN).toBe(0.08);
    expect(TIER_LIMITS.contender.rollingQuota.primaryBudgetUsd.ROW).toBe(0.08);
    expect(TIER_LIMITS.contender.rollingQuota.guardWindowHours).toBe(720);
    expect(TIER_LIMITS.contender.rollingQuota.guardBudgetUsd.VN).toBe(0.32);
    expect(TIER_LIMITS.contender.rollingQuota.guardBudgetUsd.ROW).toBe(0.32);
    expect(TIER_LIMITS.contender.rollingQuota.cycleCeilingApplies).toBe(false);

    const cramPass = PRICING_PLANS.find((p) => p.id === "cram_pass")!;
    expect(cramPass.pricing.VN.amount).toBe(69_000);
    expect(cramPass.pricing.VN.formatted).toBe("69.000đ");
    expect(cramPass.pricing.ROW.amount).toBe(4.99);
    expect(cramPass.pricing.ROW.formatted).toBe("$4.99");
    expect(cramPass.priceVndFormatted).toBe("69.000đ");
    expect(cramPass.priceUsdFormatted).toBe("$4.99");
    expect(cramPass.cycle).toBe("one_time");
    expect(cramPass.recommended).toBe(false);
    expect(cramPass.badgeEn).toBe("48h Exam Sprint");
    expect(TIER_LIMITS.cram_pass.maxQuestionsPerRun).toBe(30);
    expect(TIER_LIMITS.cram_pass.maxFilesPerUpload).toBe(5);
    expect(TIER_LIMITS.cram_pass.freeRegenerationsPerDeck).toBe(3);
    expect(TIER_LIMITS.cram_pass.canUseConceptRemix).toBe(true);
    expect(TIER_LIMITS.cram_pass.canExportCheatSheet).toBe(true);
    expect(TIER_LIMITS.cram_pass.canHostArenaRemix).toBe(true);
    expect(TIER_LIMITS.cram_pass.maxArenaPlayers).toBe(15);
    expect(TIER_LIMITS.cram_pass.cogsCeilingUsd.VN).toBe(0.85);
    expect(TIER_LIMITS.cram_pass.cogsCeilingUsd.ROW).toBe(0.85);
    expect(TIER_LIMITS.cram_pass.rollingQuota.primaryWindowHours).toBe(24);
    expect(TIER_LIMITS.cram_pass.rollingQuota.primaryBudgetUsd.VN).toBe(0.35);
    expect(TIER_LIMITS.cram_pass.rollingQuota.primaryBudgetUsd.ROW).toBe(0.35);
    expect(TIER_LIMITS.cram_pass.rollingQuota.guardWindowHours).toBe(168);
    expect(TIER_LIMITS.cram_pass.rollingQuota.guardBudgetUsd.VN).toBe(0.85);
    expect(TIER_LIMITS.cram_pass.rollingQuota.guardBudgetUsd.ROW).toBe(0.85);
    expect(TIER_LIMITS.cram_pass.rollingQuota.cycleCeilingApplies).toBe(true);

    const proMonthly = PRICING_PLANS.find((p) => p.id === "pro_monthly")!;
    expect(proMonthly.pricing.VN.amount).toBe(109_000);
    expect(proMonthly.pricing.VN.formatted).toBe("109.000đ/tháng");
    expect(proMonthly.pricing.ROW.amount).toBe(9.99);
    expect(proMonthly.pricing.ROW.formatted).toBe("$9.99/mo");
    expect(proMonthly.priceVndFormatted).toBe("109.000đ");
    expect(proMonthly.priceUsdFormatted).toBe("$9.99");
    expect(proMonthly.cycle).toBe("monthly");
    expect(TIER_LIMITS.pro_monthly.maxQuestionsPerRun).toBe(30);
    expect(TIER_LIMITS.pro_monthly.maxFilesPerUpload).toBe(10);
    expect(TIER_LIMITS.pro_monthly.freeRegenerationsPerDeck).toBe(5);
    expect(TIER_LIMITS.pro_monthly.canUseConceptRemix).toBe(true);
    expect(TIER_LIMITS.pro_monthly.canExportCheatSheet).toBe(true);
    expect(TIER_LIMITS.pro_monthly.canHostArenaRemix).toBe(true);
    expect(TIER_LIMITS.pro_monthly.maxArenaPlayers).toBe(15);
    expect(TIER_LIMITS.pro_monthly.cogsCeilingUsd.VN).toBe(1.50);
    expect(TIER_LIMITS.pro_monthly.cogsCeilingUsd.ROW).toBe(1.50);
    expect(TIER_LIMITS.pro_monthly.rollingQuota.primaryWindowHours).toBe(24);
    expect(TIER_LIMITS.pro_monthly.rollingQuota.primaryBudgetUsd.VN).toBe(0.28);
    expect(TIER_LIMITS.pro_monthly.rollingQuota.primaryBudgetUsd.ROW).toBe(0.28);
    expect(TIER_LIMITS.pro_monthly.rollingQuota.guardWindowHours).toBe(168);
    expect(TIER_LIMITS.pro_monthly.rollingQuota.guardBudgetUsd.VN).toBe(0.55);
    expect(TIER_LIMITS.pro_monthly.rollingQuota.guardBudgetUsd.ROW).toBe(0.55);
    expect(TIER_LIMITS.pro_monthly.rollingQuota.cycleCeilingApplies).toBe(true);

    const pro = PRICING_PLANS.find((p) => p.id === "pro")!;
    expect(pro.pricing.VN.amount).toBe(299_000);
    expect(pro.pricing.VN.formatted).toContain("299.000đ");
    expect(pro.pricing.ROW.amount).toBe(29.0);
    expect(pro.pricing.ROW.formatted).toContain("$29");
    expect(pro.priceVndFormatted).toBe("299.000đ");
    expect(pro.priceUsdFormatted).toBe("$29");
    expect(pro.cycle).toBe("semester");
    expect(pro.recommended).toBe(true);
    expect(pro.badgeEn).toBe("Best Value (Save 27–31%)");
    expect(TIER_LIMITS.pro.maxQuestionsPerRun).toBe(30);
    expect(TIER_LIMITS.pro.maxFilesPerUpload).toBe(10);
    expect(TIER_LIMITS.pro.freeRegenerationsPerDeck).toBe(5);
    expect(TIER_LIMITS.pro.canHostArenaRemix).toBe(true);
    expect(TIER_LIMITS.pro.maxArenaPlayers).toBe(15);
    expect(TIER_LIMITS.pro.cogsCeilingUsd.VN).toBe(3.80);
    expect(TIER_LIMITS.pro.cogsCeilingUsd.ROW).toBe(3.80);
    expect(TIER_LIMITS.pro.rollingQuota.primaryWindowHours).toBe(24);
    expect(TIER_LIMITS.pro.rollingQuota.primaryBudgetUsd.VN).toBe(0.40);
    expect(TIER_LIMITS.pro.rollingQuota.primaryBudgetUsd.ROW).toBe(0.40);
    expect(TIER_LIMITS.pro.rollingQuota.guardWindowHours).toBe(168);
    expect(TIER_LIMITS.pro.rollingQuota.guardBudgetUsd.VN).toBe(0.85);
    expect(TIER_LIMITS.pro.rollingQuota.guardBudgetUsd.ROW).toBe(0.85);
    expect(TIER_LIMITS.pro.rollingQuota.cycleCeilingApplies).toBe(true);

    const tutor = PRICING_PLANS.find((p) => p.id === "tutor")!;
    expect(tutor.pricing.VN.amount).toBe(399_000);
    expect(tutor.pricing.VN.formatted).toBe("399.000đ/tháng");
    expect(tutor.pricing.ROW.amount).toBe(24.99);
    expect(tutor.pricing.ROW.formatted).toBe("$24.99/mo");
    expect(tutor.priceVndFormatted).toBe("399.000đ");
    expect(tutor.priceUsdFormatted).toBe("$24.99");
    expect(tutor.comingSoon).toBe(false);
    expect(tutor.badgeEn).toBe("For TAs & Study Guilds");
    expect(TIER_LIMITS.tutor.maxQuestionsPerRun).toBe(30);
    expect(TIER_LIMITS.tutor.maxFilesPerUpload).toBe(10);
    expect(TIER_LIMITS.tutor.freeRegenerationsPerDeck).toBe(5);
    expect(TIER_LIMITS.tutor.maxArenaPlayers).toBe(50);
    expect(TIER_LIMITS.tutor.hasCohortAnalytics).toBe(true);
    expect(TIER_LIMITS.tutor.canCustomWatermarkPdf).toBe(true);
    expect(TIER_LIMITS.tutor.cogsCeilingUsd.VN).toBe(6.50);
    expect(TIER_LIMITS.tutor.cogsCeilingUsd.ROW).toBe(6.50);
    expect(TIER_LIMITS.tutor.rollingQuota.primaryWindowHours).toBe(24);
    expect(TIER_LIMITS.tutor.rollingQuota.primaryBudgetUsd.VN).toBe(1.10);
    expect(TIER_LIMITS.tutor.rollingQuota.primaryBudgetUsd.ROW).toBe(1.10);
    expect(TIER_LIMITS.tutor.rollingQuota.guardWindowHours).toBe(168);
    expect(TIER_LIMITS.tutor.rollingQuota.guardBudgetUsd.VN).toBe(2.50);
    expect(TIER_LIMITS.tutor.rollingQuota.guardBudgetUsd.ROW).toBe(2.50);
    expect(TIER_LIMITS.tutor.rollingQuota.cycleCeilingApplies).toBe(true);

    expect(getMaxArenaPlayersForTier("contender")).toBe(8);
    expect(getMaxArenaPlayersForTier("cram_pass")).toBe(15);
    expect(getMaxArenaPlayersForTier("pro_monthly")).toBe(15);
    expect(getMaxArenaPlayersForTier("pro")).toBe(15);
    expect(getMaxArenaPlayersForTier("tutor")).toBe(50);

    expect(canUseCustomWatermarkPdf("tutor")).toBe(true);
    expect(canUseCustomWatermarkPdf("pro")).toBe(false);
    expect(canUseCustomWatermarkPdf("pro_monthly")).toBe(false);
    expect(canUseCustomWatermarkPdf("cram_pass")).toBe(false);
    expect(canUseCustomWatermarkPdf("contender")).toBe(false);
  });

  it("handles tier persistence and retrieval cleanly", () => {
    expect(getStoredUserTier()).toBe("contender");

    setStoredUserTier("cram_pass");
    expect(getStoredUserTier()).toBe("cram_pass");

    setStoredUserTier("pro");
    expect(getStoredUserTier()).toBe("pro");
  });

  it("calculates default expiration periods per tier cycle", () => {
    expect(calculateTierExpiration("contender")).toBeNull();

    const cramExpires = calculateTierExpiration("cram_pass");
    expect(cramExpires).not.toBeNull();
    const cramDiffDays = Math.round(
      (new Date(cramExpires!).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    expect(cramDiffDays).toBe(7);

    const proMonthlyExpires = calculateTierExpiration("pro_monthly");
    expect(proMonthlyExpires).not.toBeNull();
    const proMonthlyDiffDays = Math.round(
      (new Date(proMonthlyExpires!).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    expect(proMonthlyDiffDays).toBe(30);

    const proExpires = calculateTierExpiration("pro");
    expect(proExpires).not.toBeNull();
    const proDiffDays = Math.round(
      (new Date(proExpires!).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    expect(proDiffDays).toBe(120);

    const tutorExpires = calculateTierExpiration("tutor");
    expect(tutorExpires).not.toBeNull();
    const tutorDiffDays = Math.round(
      (new Date(tutorExpires!).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    expect(tutorDiffDays).toBe(30);
  });

  it("automatically downgrades to contender if tier_expires_at has elapsed", () => {
    // Set a pass that expired yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    setStoredUserTier("cram_pass", yesterday);

    // Should detect expiration and return contender
    expect(getStoredUserTier()).toBe("contender");
    expect(getStoredTierExpires()).toBeNull();
  });

  it("preserves active tier if expiration is in the future", () => {
    // Set a pass that expires in 5 days
    const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    setStoredUserTier("cram_pass", in5Days);

    expect(getStoredUserTier()).toBe("cram_pass");
    expect(getStoredTierExpires()).toBe(in5Days);
  });

  it("blocks client-side paid tier writes and handles unconfigured cloud sync gracefully", async () => {
    const success = await syncUserTierToCloud("cram_pass");
    expect(success).toBe(false);

    const cloudTier = await fetchCloudUserTier();
    expect(cloudTier).toHaveProperty("tier");
    expect(cloudTier).toHaveProperty("expiresAt");
  });

  it("normalizes pro_monthly variants to 'pro_monthly' and preserves pro_monthly in profile resolution", () => {
    expect(normalizeTier("pro_monthly")).toBe("pro_monthly");
    expect(normalizeTier("pro-monthly")).toBe("pro_monthly");
    expect(normalizeTier("monthly")).toBe("pro_monthly");
    expect(normalizeTier("pro_monthly")).not.toBe("pro");

    const futureDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      resolveTierFromProfileRecord({
        tier: "pro_monthly",
        tier_expires_at: futureDate,
      }),
    ).toEqual({
      tier: "pro_monthly",
      expiresAt: futureDate,
    });
  });

  it("resolveTierFromProfileRecord returns null for an expired record even if updated_at is newer", () => {
    const expiredExp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recentUpdate = new Date(Date.now() - 1 * 60 * 1000).toISOString();

    expect(
      resolveTierFromProfileRecord({
        tier: "pro",
        tier_expires_at: expiredExp,
        updated_at: recentUpdate,
      }),
    ).toBeNull();

    expect(
      resolveTierFromProfileRecord({
        tier: "cram_pass",
        tier_expires_at: expiredExp,
        updated_at: recentUpdate,
      }),
    ).toBeNull();
  });

  it("prevents setStoredUserTier('contender') from overwriting an active unexpired paid tier in localStorage", () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    setStoredUserTier("pro_monthly", futureDate);
    expect(getStoredUserTier()).toBe("pro_monthly");
    expect(getStoredTierExpires()).toBe(futureDate);

    // Attempt to downgrade to contender while paid tier is still active and unexpired
    setStoredUserTier("contender");
    expect(getStoredUserTier()).toBe("pro_monthly");
    expect(getStoredTierExpires()).toBe(futureDate);
  });

  it("resolves regional COGS ceilings accurately via getRegionalCogsCeiling (unified VN & ROW)", () => {
    expect(getRegionalCogsCeiling("pro_monthly", "VN")).toBe(1.50);
    expect(getRegionalCogsCeiling("pro_monthly", "ROW")).toBe(1.50);
    expect(getRegionalCogsCeiling(TIER_LIMITS.pro_monthly.cogsCeilingUsd, "VN")).toBe(1.50);
    expect(getRegionalCogsCeiling(TIER_LIMITS.pro_monthly.cogsCeilingUsd, "ROW")).toBe(1.50);
    expect(getRegionalCogsCeiling(1.5, "VN")).toBe(1.5);
    expect(getRegionalCogsCeiling(1.5, "ROW")).toBe(1.5);
  });
});

describe("Cloud Tier Sync & Admin Profile Overrides", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {
        mockStorage = {};
      },
    };

    (globalThis as any).window = {
      dispatchEvent: vi.fn(),
    };
    (globalThis as any).localStorage = storageMock;
    mockBrowserSupabase = null;
    mockServerSupabase = null;
  });

  it("fetchCloudUserTier falls through expired user_subscriptions to active profiles", async () => {
    const expiredSubDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const activeProfileExp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    mockBrowserSupabase = createMockSupabase({
      userSubscriptions: {
        tier: "cram_pass",
        expires_at: expiredSubDate,
        status: "active",
      },
      profiles: {
        tier: "pro",
        tier_expires_at: activeProfileExp,
        updated_at: new Date().toISOString(),
      },
    });

    const result = await fetchCloudUserTier();
    expect(result.tier).toBe("pro");
    expect(result.isExpired).toBe(false);
    expect(result.expiresAt).toBe(activeProfileExp);
    expect(getStoredUserTier()).toBe("pro");
  });

  it("profiles with tier_expires_at: null returns the paid tier without expiring", async () => {
    mockBrowserSupabase = createMockSupabase({
      userSubscriptions: null,
      profiles: {
        tier: "cram_pass",
        tier_expires_at: null,
        updated_at: new Date().toISOString(),
      },
    });

    const result = await fetchCloudUserTier();
    expect(result.tier).toBe("cram_pass");
    expect(result.isExpired).toBe(false);
    expect(result.expiresAt).toBeNull();
    expect(getStoredUserTier()).toBe("cram_pass");
  });

  it("profiles updated after expiration does not revive paid tier and resolves to contender", async () => {
    const expiredExp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recentAdminUpdate = new Date(Date.now() - 1 * 60 * 1000).toISOString();

    mockBrowserSupabase = createMockSupabase({
      userSubscriptions: null,
      profiles: {
        tier: "pro",
        tier_expires_at: expiredExp,
        updated_at: recentAdminUpdate,
      },
    });

    const result = await fetchCloudUserTier();
    expect(result.tier).toBe("contender");
    expect(result.expiresAt).toBeNull();
    expect(getStoredUserTier()).toBe("contender");
  });

  it("verifyAuthToken falls through expired user_subscriptions to active profiles", async () => {
    const expiredSubDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const activeProfileExp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    mockServerSupabase = createMockSupabase({
      userSubscriptions: {
        tier: "cram_pass",
        expires_at: expiredSubDate,
        status: "active",
      },
      profiles: {
        tier: "pro",
        tier_expires_at: activeProfileExp,
        updated_at: new Date().toISOString(),
      },
    });

    const req = new Request("https://clutcharena.com/api/test", {
      headers: {
        authorization: "Bearer valid-token-123",
      },
    });

    const authResult = await verifyAuthToken(req);
    expect(authResult.authenticated).toBe(true);
    if (authResult.authenticated) {
      expect(authResult.tier).toBe("pro");
      expect(authResult.tierExpiresAt).toBe(activeProfileExp);
    }
  });

  it("verifyAuthToken treats profiles with tier_expires_at: null as active non-expiring grant", async () => {
    mockServerSupabase = createMockSupabase({
      userSubscriptions: null,
      profiles: {
        tier: "tutor",
        tier_expires_at: null,
        updated_at: new Date().toISOString(),
      },
    });

    const req = new Request("https://clutcharena.com/api/test", {
      headers: {
        authorization: "Bearer valid-token-123",
      },
    });

    const authResult = await verifyAuthToken(req);
    expect(authResult.authenticated).toBe(true);
    if (authResult.authenticated) {
      expect(authResult.tier).toBe("tutor");
      expect(authResult.tierExpiresAt).toBeNull();
    }
  });

  it("verifyAuthToken falls back to contender when profiles has expired tier even if updated_at is newer", async () => {
    const expiredExp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recentAdminUpdate = new Date(Date.now() - 1 * 60 * 1000).toISOString();

    mockServerSupabase = createMockSupabase({
      userSubscriptions: null,
      profiles: {
        tier: "pro",
        tier_expires_at: expiredExp,
        updated_at: recentAdminUpdate,
      },
    });

    const req = new Request("https://clutcharena.com/api/test", {
      headers: {
        authorization: "Bearer valid-token-123",
      },
    });

    const authResult = await verifyAuthToken(req);
    expect(authResult.authenticated).toBe(true);
    if (authResult.authenticated) {
      expect(authResult.tier).toBe("contender");
    }
  });
});

describe("Earn-Your-Pass Referral Unlock Mechanics", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {
        mockStorage = {};
      },
    };

    (globalThis as any).window = {
      dispatchEvent: vi.fn(),
    };
    (globalThis as any).localStorage = storageMock;
    mockBrowserSupabase = null;
    mockServerSupabase = null;
  });

  it("initializes with 0 unlocked runs", () => {
    const state = getStoredReferralState();
    expect(state.unlockedRemixRuns).toBe(0);
    expect(consumeUnlockedRemixRun()).toBe(false);
  });

  it("awards 3 free Concept Remix runs on 4-player match or pack imports", () => {
    awardReferralPass("pack_imports_3");
    let state = getStoredReferralState();
    expect(state.unlockedRemixRuns).toBe(3);
    expect(state.packsImportedByClassmates).toBe(3);

    // Consuming a run decrements properly
    expect(consumeUnlockedRemixRun()).toBe(true);
    state = getStoredReferralState();
    expect(state.unlockedRemixRuns).toBe(2);

    expect(consumeUnlockedRemixRun()).toBe(true);
    expect(consumeUnlockedRemixRun()).toBe(true);
    expect(consumeUnlockedRemixRun()).toBe(false); // empty now
  });

  it("awards passes on hosting a 4-player arena match", () => {
    awardReferralPass("arena_4_player");
    const state = getStoredReferralState();
    expect(state.unlockedRemixRuns).toBe(3);
    expect(state.roomsHostedWith4Players).toBe(1);
  });
});

describe("Multiplayer Concurrency & Realtime Lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockBrowserSupabase = null;
    mockServerSupabase = null;
  });

  it("enforces 8-player room capacity for Contender tier lobbies", () => {
    const { room } = createRoom({
      hostNickname: "Host",
      pack: mockMicroeconomics,
      maxPlayers: 8,
    });

    // 1 host already in room
    expect(Object.keys(room.players).length).toBe(1);

    // Join 7 more players (reaching 8)
    for (let i = 1; i <= 7; i++) {
      const p = joinRoom(room.code, { nickname: `Player${i}` });
      expect(p).not.toBeNull();
    }
    expect(Object.keys(room.players).length).toBe(8);

    // 9th player must be rejected
    const excessPlayer = joinRoom(room.code, { nickname: "Player9" });
    expect(excessPlayer).toBeNull();
    expect(Object.keys(room.players).length).toBe(8);
  });

  it("auto-closes idle rooms after 90 seconds of inactivity", () => {
    const { room } = createRoom({
      hostNickname: "Host",
      pack: mockMicroeconomics,
    });
    expect(getRoom(room.code)).not.toBeNull();

    // Advance 89 seconds: room still alive
    vi.advanceTimersByTime(89_000);
    expect(getRoom(room.code)).not.toBeNull();

    // Advance 2 more seconds (91s total): room auto-cleaned
    vi.advanceTimersByTime(2_000);
    expect(getRoom(room.code)).toBeNull();
  });
});

describe("Rolling % Quota Windows, Guards, Shared Pool & Regeneration Allowances", () => {
  const BASE_NOW = 1775000000000;

  beforeEach(() => {
    resetQuotaLedgersForTests();
  });

  it("verifies regional window/guard/cycle budgets and percentage badge formatting", () => {
    expect(getRegionalWindowBudget("contender", "VN")).toBe(0.08);
    expect(getRegionalGuardBudget("contender", "VN")).toBe(0.32);

    expect(getRegionalWindowBudget("cram_pass", "VN")).toBe(0.35);
    expect(getRegionalWindowBudget("cram_pass", "ROW")).toBe(0.35);
    expect(getRegionalGuardBudget("cram_pass", "VN")).toBe(0.85);
    expect(getRegionalGuardBudget("cram_pass", "ROW")).toBe(0.85);

    expect(getRegionalWindowBudget("pro_monthly", "VN")).toBe(0.28);
    expect(getRegionalWindowBudget("pro_monthly", "ROW")).toBe(0.28);
    expect(getRegionalGuardBudget("pro_monthly", "VN")).toBe(0.55);
    expect(getRegionalGuardBudget("pro_monthly", "ROW")).toBe(0.55);

    expect(getRegionalWindowBudget("pro", "VN")).toBe(0.40);
    expect(getRegionalWindowBudget("pro", "ROW")).toBe(0.40);
    expect(getRegionalGuardBudget("pro", "VN")).toBe(0.85);
    expect(getRegionalGuardBudget("pro", "ROW")).toBe(0.85);

    expect(getRegionalWindowBudget("tutor", "VN")).toBe(1.10);
    expect(getRegionalWindowBudget("tutor", "ROW")).toBe(1.10);
    expect(getRegionalGuardBudget("tutor", "VN")).toBe(2.50);
    expect(getRegionalGuardBudget("tutor", "ROW")).toBe(2.50);

    expect(formatQuotaPercentBadge(75, false)).toBe("75% AI quota remaining");
    expect(formatQuotaPercentBadge(75, true)).toBe("Còn 75% hạn mức AI");
    expect(
      formatQuotaResetCountdown(new Date(BASE_NOW + 3 * 3_600_000).toISOString(), false, BASE_NOW),
    ).toBe("Resets in 3h");
  });

  it("enforces 24h primary rolling window + 7d (168h) weekly guard + finite cycle ceiling for paid tiers", async () => {
    const userId = "paid-rolling-user";
    // pro_monthly VN: 24h window = $0.28, 7d guard = $0.55, cycle ceiling = $1.50
    const initialSnap = await getRollingQuotaSnapshot(userId, "pro_monthly", "VN", BASE_NOW);
    expect(initialSnap.remainingPct).toBe(100);
    expect(initialSnap.windowHours).toBe(24);
    expect(initialSnap.bottleneckScope).toBe("window");

    // Spend full 24h window ($0.28) across operations
    const r1 = await checkAndReserveDeckQuota(userId, "pro_monthly", "paid-deck-1", {
      estimatedCostUsd: 0.28,
      region: "VN",
      nowMs: BASE_NOW,
    });
    expect(r1.allowed).toBe(true);
    await recordDeckGenerationCogs(userId, "pro_monthly", 0.28, 0.28, "VN", BASE_NOW);

    // Exhausted within 24h window
    const blockedIn24h = await checkAndReserveDeckQuota(userId, "pro_monthly", "paid-deck-2", {
      region: "VN",
      nowMs: BASE_NOW + 2 * 3_600_000,
    });
    expect(blockedIn24h.allowed).toBe(false);
    expect(blockedIn24h.reason).toBe("COGS_CEILING_EXCEEDED");
    expect(blockedIn24h.quota.remainingPct).toBe(0);

    // Advance 24h: 24h window rolls over, remaining weekly guard is $0.55 - $0.28 = $0.27
    const after24h = BASE_NOW + 24 * 3_600_000 + 1000;
    const snap24h = await getRollingQuotaSnapshot(userId, "pro_monthly", "VN", after24h);
    expect(snap24h.windowRemainingUsd).toBe(0.28);
    expect(snap24h.guardRemainingUsd).toBe(0.27);
    expect(snap24h.bottleneckScope).toBe("weekly");
    expect(snap24h.windowHours).toBe(168);

    // Spend remaining $0.27 of weekly guard
    const r2 = await checkAndReserveDeckQuota(userId, "pro_monthly", "paid-deck-3", {
      estimatedCostUsd: 0.27,
      region: "VN",
      nowMs: after24h,
    });
    expect(r2.allowed).toBe(true);
    await recordDeckGenerationCogs(userId, "pro_monthly", 0.27, 0.27, "VN", after24h);

    // Even after another 24h (at 48h), 7d weekly guard ($0.55) is still exhausted!
    const after48h = BASE_NOW + 48 * 3_600_000 + 2000;
    const blockedByWeekly = await checkAndReserveDeckQuota(userId, "pro_monthly", "paid-deck-4", {
      region: "VN",
      nowMs: after48h,
    });
    expect(blockedByWeekly.allowed).toBe(false);
    expect(blockedByWeekly.quota.bottleneckScope).toBe("weekly");
    expect(blockedByWeekly.quota.remainingPct).toBe(0);

    // After 7d (168h), weekly guard resets and cycle ceiling ($0.95 / $1.50 = 63%) becomes bottleneck
    const after7d = BASE_NOW + 168 * 3_600_000 + 5000;
    const snap7d = await getRollingQuotaSnapshot(userId, "pro_monthly", "VN", after7d);
    expect(snap7d.windowRemainingUsd).toBe(0.28);
    expect(snap7d.guardRemainingUsd).toBe(0.55);
    expect(snap7d.cycleRemainingUsd).toBe(0.95);
    expect(snap7d.bottleneckScope).toBe("cycle");
    expect(snap7d.remainingPct).toBe(63);
  });

  it("enforces finite cycle cogsCeilingUsd backstop across rolling windows on paid tiers", async () => {
    const userId = "paid-cycle-backstop";
    const ledger = await getUserQuotaLedger(userId, "cram_pass", "VN", BASE_NOW);
    // cram_pass VN cycle ceiling = $0.85; simulate $0.84 already spent across prior days
    ledger.cogsSpentUsd = 0.84;
    ledger.windowSpentUsd = 0;
    ledger.weeklySpentUsd = 0;
    await saveUserQuotaLedger(ledger);

    const snap = computeRollingQuotaSnapshot(ledger, "cram_pass", "VN", BASE_NOW);
    expect(snap.bottleneckScope).toBe("cycle");
    expect(snap.cycleRemainingUsd).toBe(0.01);
    expect(snap.resetsAt).toBeNull(); // finite cycle backstop does not auto-reset

    // Deck requires minHeadroom $0.014 -> blocked by cycle backstop
    const blocked = await checkAndReserveDeckQuota(userId, "cram_pass", "cycle-cap-deck", {
      region: "VN",
      nowMs: BASE_NOW,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("COGS_CEILING_EXCEEDED");
  });

  it("enforces 3d (72h) rolling window + 30d (720h) anti-abuse guard ($0.32) for free tier (contender & guest)", async () => {
    const guestActor = { ip: "203.0.113.77" };
    // Contender/guest: 72h primary = $0.08, 720h guard = $0.32, no cycle ceiling
    const initSnap = await getRollingQuotaSnapshot(guestActor, "guest", "VN", BASE_NOW);
    expect(initSnap.windowHours).toBe(72);
    expect(initSnap.windowBudgetUsd).toBe(0.08);
    expect(initSnap.guardBudgetUsd).toBe(0.32);
    expect(initSnap.cycleRemainingUsd).toBeNull();

    // Exhaust 4 consecutive 72h windows ($0.08 x 4 = $0.32) inside 30 days
    for (let cycle = 0; cycle < 4; cycle++) {
      const t = BASE_NOW + cycle * 72 * 3_600_000 + cycle * 1000;
      const res = await checkAndReserveDeckQuota(guestActor, "guest", `free-cycle-${cycle}`, {
        estimatedCostUsd: 0.08,
        nowMs: t,
      });
      expect(res.allowed).toBe(true);
      await recordDeckGenerationCogs(guestActor, "guest", 0.08, 0.08, "VN", t);
    }

    // Even after another 72h window rollover (4 * 72h = 288h < 720h), 30d guard ($0.32) blocks
    const at12Days = BASE_NOW + 4 * 72 * 3_600_000 + 10_000;
    const guardSnap = await getRollingQuotaSnapshot(guestActor, "guest", "VN", at12Days);
    expect(guardSnap.remainingPct).toBe(0);
    expect(guardSnap.bottleneckScope).toBe("weekly");
    expect(guardSnap.windowHours).toBe(720);

    const blockedBy30d = await checkAndReserveDeckQuota(guestActor, "guest", "free-blocked", {
      nowMs: at12Days,
    });
    expect(blockedBy30d.allowed).toBe(false);
    expect(blockedBy30d.reason).toBe("COGS_CEILING_EXCEEDED");

    // After 30 days (720h), free tier renews cleanly
    const at30Days = BASE_NOW + 720 * 3_600_000 + 20_000;
    const renewedSnap = await getRollingQuotaSnapshot(guestActor, "guest", "VN", at30Days);
    expect(renewedSnap.remainingPct).toBe(100);
    expect(renewedSnap.windowHours).toBe(72);
  });

  it("shares a single rolling quota pool across Deck, Notes, Vision OCR, and Coach", async () => {
    const userId = "shared-pool-user";
    const deckRes = await checkAndReserveDeckQuota(userId, "contender", "pool-deck", {
      actionKind: "deck",
      estimatedCostUsd: 0.028,
      nowMs: BASE_NOW,
    });
    expect(deckRes.allowed).toBe(true);
    await recordDeckGenerationCogs(userId, "contender", 0.028, 0.028, "VN", BASE_NOW);

    const notesRes = await checkAndReserveDeckQuota(userId, "contender", "pool-notes", {
      actionKind: "notes",
      estimatedCostUsd: 0.012,
      nowMs: BASE_NOW,
    });
    expect(notesRes.allowed).toBe(true);
    await recordDeckGenerationCogs(userId, "contender", 0.012, 0.012, "VN", BASE_NOW);

    const ocrRes = await checkAndReserveDeckQuota(userId, "contender", "pool-ocr", {
      actionKind: "ocr",
      estimatedCostUsd: 0.005,
      nowMs: BASE_NOW,
    });
    expect(ocrRes.allowed).toBe(true);
    await recordDeckGenerationCogs(userId, "contender", 0.005, 0.005, "VN", BASE_NOW);

    const coachRes = await checkAndReserveDeckQuota(userId, "contender", "pool-coach", {
      actionKind: "coach",
      estimatedCostUsd: 0.004,
      nowMs: BASE_NOW,
    });
    expect(coachRes.allowed).toBe(true);
    await recordDeckGenerationCogs(userId, "contender", 0.004, 0.004, "VN", BASE_NOW);

    // Total spent across all 4 surfaces = 0.049 out of 0.08 -> remaining = 0.031 (~39%)
    const snap = await getRollingQuotaSnapshot(userId, "contender", "VN", BASE_NOW);
    expect(snap.windowRemainingUsd).toBeCloseTo(0.031, 4);
    expect(snap.remainingPct).toBe(39);
    expect(toClientQuota(snap).usedPct).toBe(61);
  });

  it("enforces 3 free regenerations per deck for Cram Pass and rejects 4th regeneration", async () => {
    const userId = "cram-regen-user";
    const deckHash = "cram-math-deck";

    const initRes = await checkAndReserveDeckQuota(userId, "cram_pass", deckHash);
    expect(initRes.allowed).toBe(true);
    expect(initRes.creditConsumed).toBe(true);
    expect(initRes.isRegeneration).toBe(false);

    for (let regen = 1; regen <= 3; regen++) {
      const regenRes = await checkAndReserveDeckQuota(userId, "cram_pass", deckHash);
      expect(regenRes.allowed).toBe(true);
      expect(regenRes.isRegeneration).toBe(true);
      expect(regenRes.creditConsumed).toBe(false);
      expect(regenRes.creditsUsed).toBe(1);
    }

    const fourthRegen = await checkAndReserveDeckQuota(userId, "cram_pass", deckHash);
    expect(fourthRegen.allowed).toBe(false);
    expect(fourthRegen.reason).toBe("REGENERATION_LIMIT_EXCEEDED");
    expect(fourthRegen.isRegeneration).toBe(true);
  });

  it("enforces 5 free regenerations per deck for Pro Pass and rejects 6th regeneration", async () => {
    const userId = "pro-regen-user";
    const deckHash = "pro-macro-deck";

    const initRes = await checkAndReserveDeckQuota(userId, "pro", deckHash);
    expect(initRes.allowed).toBe(true);

    for (let regen = 1; regen <= 5; regen++) {
      const regenRes = await checkAndReserveDeckQuota(userId, "pro", deckHash);
      expect(regenRes.allowed).toBe(true);
      expect(regenRes.isRegeneration).toBe(true);
      expect(regenRes.creditConsumed).toBe(false);
    }

    const sixthRegen = await checkAndReserveDeckQuota(userId, "pro", deckHash);
    expect(sixthRegen.allowed).toBe(false);
    expect(sixthRegen.reason).toBe("REGENERATION_LIMIT_EXCEEDED");
  });
});

describe("Shared Deck Cache & content_hash Zero-Credit Behavior", () => {
  beforeEach(() => {
    resetQuotaLedgersForTests();
  });

  it("computes deterministic content_hash and fileSha256", () => {
    const hash1 = computeContentHash({
      normalizedText: "Lecture 1: Time Value of Money\r\nFormula: PV = FV / (1 + r)^n",
      pageCount: 15,
      imageHashes: ["imgB", "imgA"],
    });

    const hash2 = computeContentHash({
      normalizedText: "Lecture 1: Time Value of Money\nFormula: PV = FV / (1 + r)^n",
      pageCount: 15,
      imageHashes: ["imgA", "imgB"],
    });

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    const fileBuf = Buffer.from("Slide PDF Mock Content 2026");
    const fileSha = computeFileSha256(fileBuf);
    expect(fileSha).toMatch(/^[a-f0-9]{64}$/);
    expect(computeFileSha256(fileBuf)).toBe(fileSha);
  });

  it("cache hit on content_hash consumes 0 deck credits and incurs $0.00 COGS", async () => {
    const contentHash = "cached-finance-syllabus-hash";
    const pipelineVersion = "3.0.0-final+gemini+claude";

    await setSharedDeckCache({
      contentHash,
      language: "en",
      mode: "generate",
      focusHash: "",
      pipelineVersion,
      questionPool: [
        { id: "q1", question: "What is WACC?", correctIndex: 0 },
        { id: "q2", question: "What is CAPM?", correctIndex: 1 },
      ],
      studyMetadata: { topic: "Corporate Finance" },
    });

    const userId = "student-cram-caching";
    const result = await checkAndReserveDeckQuota(userId, "cram_pass", contentHash, {
      pipelineVersion,
      language: "en",
      mode: "generate",
    });

    expect(result.allowed).toBe(true);
    expect(result.cacheHit).toBe(true);
    expect(result.creditConsumed).toBe(false);
    expect(result.isRegeneration).toBe(false);
    expect(result.creditsUsed).toBe(0);
    expect(result.cachedDeck).toBeDefined();
    expect(result.cachedDeck?.questionPool).toHaveLength(2);

    const ledger = await getUserQuotaLedger(userId, "cram_pass");
    expect(ledger.deckCreditsUsed).toBe(0);
    expect(ledger.cogsSpentUsd).toBe(0);
    expect(ledger.cogsReservedUsd).toBe(0);
  });

  it("cache hit succeeds even when user has exhausted all new deck credits", async () => {
    const contentHash = "shared-exam-pack-hash";
    const pipelineVersion = "3.0.0-final";

    await setSharedDeckCache({
      contentHash,
      language: "en",
      mode: "generate",
      focusHash: "",
      pipelineVersion,
      questionPool: [{ id: "q-shared" }],
    });

    const userId = "exhausted-user";
    const ledger = await getUserQuotaLedger(userId, "contender");
    ledger.deckCreditsUsed = 2;
    await saveUserQuotaLedger(ledger);

    const res = await checkAndReserveDeckQuota(userId, "contender", contentHash, {
      pipelineVersion,
    });

    expect(res.allowed).toBe(true);
    expect(res.cacheHit).toBe(true);
    expect(res.creditConsumed).toBe(false);
  });

  it("supports fast-path cache lookup by fileSha256", async () => {
    const fileSha256 = "b7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8";
    const contentHash = "derived-content-hash-123";
    const pipelineVersion = "3.0.0-final";

    await setSharedDeckCache({
      contentHash,
      fileSha256,
      language: "en",
      mode: "generate",
      focusHash: "",
      pipelineVersion,
      questionPool: [{ id: "q-fastpath" }],
    });

    const cached = await getSharedDeckCache({
      contentHash: "mismatched-content-hash",
      fileSha256,
      pipelineVersion,
    });

    expect(cached).not.toBeNull();
    expect(cached?.fileSha256).toBe(fileSha256);
    expect(cached?.hitCount).toBeGreaterThanOrEqual(1);
  });

  it("sampleQuestionsFromCachedPool returns deterministic subsets when seed is provided", () => {
    const pool = Array.from({ length: 35 }, (_, i) => ({ id: `q-${i + 1}` }));
    const sample1 = sampleQuestionsFromCachedPool(pool, 25, "seed-exam-2026");
    const sample2 = sampleQuestionsFromCachedPool(pool, 25, "seed-exam-2026");
    const sampleDiff = sampleQuestionsFromCachedPool(pool, 25, "seed-diff-9999");

    expect(sample1).toHaveLength(25);
    expect(sample2).toHaveLength(25);
    expect(sample1.map((q) => q.id)).toEqual(sample2.map((q) => q.id));
    expect(sample1.map((q) => q.id)).not.toEqual(sampleDiff.map((q) => q.id));
  });
});

describe("Pre-Flight COGS Ceiling & Progressive 4-Tier Degradation Ladder", () => {
  beforeEach(() => {
    resetQuotaLedgersForTests();
  });

  it("Tier 1 (< 70%): full pipeline with vision OCR, cross-family verifier, and full question count", () => {
    const status = evaluateCogsDegradation(0.5, 1.25, 0.0);
    expect(status.mode).toBe("full");
    expect(status.utilizationRatio).toBe(0.4);
    expect(status.targetQuestionCount).toBe(25);
    expect(status.allowVisionOcr).toBe(true);
    expect(status.allowBorderlineVision).toBe(true);
    expect(status.allowCrossFamilyVerifier).toBe(true);
    expect(status.useCheaperGeneratorSlug).toBe(false);
    expect(status.conciseExplanations).toBe(false);
    expect(status.serveCachedPoolsOnly).toBe(false);
    expect(status.bannerNotice).toBeNull();
  });

  it("Tier 2 (70% - 90%): gentle degradation with targeted vision, cheaper generator, concise explanations", () => {
    const status = evaluateCogsDegradation(0.9, 1.25, 0.0);
    expect(status.mode).toBe("gentle");
    expect(status.utilizationRatio).toBe(0.72);
    expect(status.targetQuestionCount).toBe(20);
    expect(status.allowVisionOcr).toBe(true);
    expect(status.allowBorderlineVision).toBe(false);
    expect(status.allowCrossFamilyVerifier).toBe(true);
    expect(status.useCheaperGeneratorSlug).toBe(true);
    expect(status.conciseExplanations).toBe(true);
    expect(status.serveCachedPoolsOnly).toBe(false);
    expect(status.bannerNotice).toBeNull();
  });

  it("Tier 3 (90% - 100%): hard degradation with 15 questions, vision disabled, verifier bypassed", () => {
    const status = evaluateCogsDegradation(1.15, 1.25, 0.0);
    expect(status.mode).toBe("hard");
    expect(status.utilizationRatio).toBe(0.92);
    expect(status.targetQuestionCount).toBe(15);
    expect(status.allowVisionOcr).toBe(false);
    expect(status.allowBorderlineVision).toBe(false);
    expect(status.allowCrossFamilyVerifier).toBe(false);
    expect(status.useCheaperGeneratorSlug).toBe(true);
    expect(status.conciseExplanations).toBe(true);
    expect(status.serveCachedPoolsOnly).toBe(false);
    expect(status.bannerNotice).toBeNull();
  });

  it("Tier 4 (> 100%): halts fresh generation, serves cached pools only, and sets banner notice", () => {
    const status = evaluateCogsDegradation(1.3, 1.25, 0.0);
    expect(status.mode).toBe("halted");
    expect(status.utilizationRatio).toBe(1.04);
    expect(status.targetQuestionCount).toBe(0);
    expect(status.allowVisionOcr).toBe(false);
    expect(status.allowBorderlineVision).toBe(false);
    expect(status.allowCrossFamilyVerifier).toBe(false);
    expect(status.serveCachedPoolsOnly).toBe(true);
    expect(status.bannerNotice).toContain("Subscription deck generation budget reached for this period");
  });

  it("enforces unified COGS degradation ceilings (VN & ROW: $3.80 for Semester Pro)", () => {
    const proCeiling = TIER_LIMITS.pro.cogsCeilingUsd;

    // VN Region: ceiling is $3.80
    const vnFull = evaluateCogsDegradation(1.0, proCeiling, 0, 0, "VN");
    expect(vnFull.ceilingUsd).toBe(3.8);
    expect(vnFull.mode).toBe("full");

    // VN Region: reaches gentle degradation at $2.66 (70% of $3.80)
    const vnGentle = evaluateCogsDegradation(2.66, proCeiling, 0, 0, "VN");
    expect(vnGentle.ceilingUsd).toBe(3.8);
    expect(vnGentle.utilizationRatio).toBe(0.7);
    expect(vnGentle.mode).toBe("gentle");
    expect(vnGentle.targetQuestionCount).toBe(20);

    // VN Region: reaches hard degradation at $3.43 with estimated incoming call (90%+)
    const vnHard = evaluateCogsDegradation(3.43, proCeiling, 0.01, 0, "VN");
    expect(vnHard.ceilingUsd).toBe(3.8);
    expect(vnHard.utilizationRatio).toBeGreaterThan(0.9);
    expect(vnHard.mode).toBe("hard");
    expect(vnHard.targetQuestionCount).toBe(15);
    expect(vnHard.allowVisionOcr).toBe(false);

    // VN Region: halted when exceeding ceiling (> 100%)
    const vnHalted = evaluateCogsDegradation(3.85, proCeiling, 0, 0, "VN");
    expect(vnHalted.ceilingUsd).toBe(3.8);
    expect(vnHalted.mode).toBe("halted");
    expect(vnHalted.serveCachedPoolsOnly).toBe(true);

    // ROW Region: matches unified $3.80 ceiling
    const rowUnderCeiling = evaluateCogsDegradation(1.0, proCeiling, 0, 0, "ROW");
    expect(rowUnderCeiling.ceilingUsd).toBe(3.8);
    expect(rowUnderCeiling.mode).toBe("full");

    // ROW Region: reaches gentle degradation at $2.66 (70% of $3.80)
    const rowGentle = evaluateCogsDegradation(2.66, proCeiling, 0, 0, "ROW");
    expect(rowGentle.ceilingUsd).toBe(3.8);
    expect(rowGentle.utilizationRatio).toBe(0.7);
    expect(rowGentle.mode).toBe("gentle");

    // ROW Region: reaches hard degradation at > 90% of $3.80 ($3.43)
    const rowHard = evaluateCogsDegradation(3.43, proCeiling, 0.01, 0, "ROW");
    expect(rowHard.ceilingUsd).toBe(3.8);
    expect(rowHard.utilizationRatio).toBeGreaterThan(0.9);
    expect(rowHard.mode).toBe("hard");

    // ROW Region: halted when exceeding $3.80
    const rowHalted = evaluateCogsDegradation(3.85, proCeiling, 0, 0, "ROW");
    expect(rowHalted.ceilingUsd).toBe(3.8);
    expect(rowHalted.mode).toBe("halted");
  });

  it("checkAndReserveDeckQuota blocks generation when projected COGS exceeds ceiling", async () => {
    const userId = "cogs-exceeded-user";
    const ledger = await getUserQuotaLedger(userId, "cram_pass");
    ledger.cogsSpentUsd = 1.25;
    await saveUserQuotaLedger(ledger);

    const attempt = await checkAndReserveDeckQuota(userId, "cram_pass", "new-costly-deck", {
      estimatedCostUsd: 0.03,
    });

    expect(attempt.allowed).toBe(false);
    expect(attempt.reason).toBe("COGS_CEILING_EXCEEDED");
    expect(attempt.cogsStatus.mode).toBe("halted");
    expect(attempt.cogsStatus.serveCachedPoolsOnly).toBe(true);
  });

  it("recordDeckGenerationCogs accurately tracks spent COGS and releases reserved funds", async () => {
    const userId = "cogs-ledger-tracker";
    const res = await checkAndReserveDeckQuota(userId, "cram_pass", "deck-actual-cost", {
      estimatedCostUsd: 0.03,
    });
    expect(res.allowed).toBe(true);
    expect(res.ledger.cogsReservedUsd).toBe(0.03);

    const { ledger, cogsStatus } = await recordDeckGenerationCogs(
      userId,
      "cram_pass",
      0.025,
      0.03,
    );

    expect(ledger.cogsSpentUsd).toBe(0.025);
    expect(ledger.cogsReservedUsd).toBe(0);
    expect(cogsStatus.spentUsd).toBe(0.025);
    expect(cogsStatus.mode).toBe("full");
  });
});

describe("Client Tier Spoofing Prevention & Sign-Out Cleanup (SA2-22)", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {
        mockStorage = {};
      },
    };

    (globalThis as any).window = {
      dispatchEvent: vi.fn(),
    };
    (globalThis as any).localStorage = storageMock;
    mockBrowserSupabase = null;
    mockServerSupabase = null;
  });

  it("clearStoredUserTier resets stored tier back to 'contender' and null expiry", () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    mockStorage[USER_TIER_STORAGE_KEY] = "pro";
    mockStorage[USER_TIER_EXPIRES_KEY] = futureDate;
    expect(getStoredUserTier()).toBe("pro");
    expect(getStoredTierExpires()).toBe(futureDate);

    clearStoredUserTier();

    expect(getStoredUserTier()).toBe("contender");
    expect(getStoredTierExpires()).toBeNull();
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { tier: "contender", expiresAt: null },
      }),
    );
  });

  it("clearStoredUserTier forcibly overrides unexpired paid tiers whereas setStoredUserTier protects them", () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    setStoredUserTier("pro_monthly", futureDate);
    expect(getStoredUserTier()).toBe("pro_monthly");

    // setStoredUserTier protects unexpired paid tier against inadvertent contender overwrite
    setStoredUserTier("contender");
    expect(getStoredUserTier()).toBe("pro_monthly");

    // clearStoredUserTier unconditionally purges stored tier on logout/session clearing
    clearStoredUserTier();
    expect(getStoredUserTier()).toBe("contender");
    expect(getStoredTierExpires()).toBeNull();
  });

  it("unauthenticated sessions clamp client tier mutations to 'contender' when Supabase is not configured", async () => {
    mockBrowserSupabase = null;
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Attacker modifies localStorage to a paid tier
    mockStorage[USER_TIER_STORAGE_KEY] = "pro";
    mockStorage[USER_TIER_EXPIRES_KEY] = futureDate;

    const result = await verifyAndClampClientTier("pro", futureDate);
    expect(result.tier).toBe("contender");
    expect(result.expiresAt).toBeNull();
    // localStorage is sanitized back to contender
    expect(getStoredUserTier()).toBe("contender");
    expect(getStoredTierExpires()).toBeNull();

    // Testing all paid tiers
    const cramResult = await verifyAndClampClientTier("cram_pass", futureDate);
    expect(cramResult.tier).toBe("contender");

    const tutorResult = await verifyAndClampClientTier("tutor", futureDate);
    expect(tutorResult.tier).toBe("contender");

    const proMonthlyResult = await verifyAndClampClientTier("pro_monthly", futureDate);
    expect(proMonthlyResult.tier).toBe("contender");
  });

  it("unauthenticated sessions clamp client tier mutations to 'contender' when Supabase auth returns user: null", async () => {
    mockBrowserSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    };
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    mockStorage[USER_TIER_STORAGE_KEY] = "pro";
    mockStorage[USER_TIER_EXPIRES_KEY] = futureDate;

    const result = await verifyAndClampClientTier("pro", futureDate);
    expect(result.tier).toBe("contender");
    expect(result.expiresAt).toBeNull();
    expect(getStoredUserTier()).toBe("contender");
    expect(getStoredTierExpires()).toBeNull();
  });

  it("authenticated sessions allow legitimate paid tier verification and preservation", async () => {
    const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    mockBrowserSupabase = createMockSupabase({
      user: { id: "legit-student-123" },
    });

    const result = await verifyAndClampClientTier("pro", futureDate);
    expect(result.tier).toBe("pro");
    expect(result.expiresAt).toBe(futureDate);
  });

  it("fetchCloudUserTier purges spoofed local tier and returns contender when user is not authenticated", async () => {
    mockBrowserSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    };
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    mockStorage[USER_TIER_STORAGE_KEY] = "pro";
    mockStorage[USER_TIER_EXPIRES_KEY] = futureDate;

    const cloud = await fetchCloudUserTier();
    expect(cloud.tier).toBe("contender");
    expect(cloud.expiresAt).toBeNull();
    expect(cloud.isExpired).toBe(false);
    expect(getStoredUserTier()).toBe("contender");
    expect(getStoredTierExpires()).toBeNull();
  });
});

describe("Eco-Mode (<=30% Remaining) Step-Down & Rolling Budget Exhaustion", () => {
  beforeEach(() => {
    resetQuotaLedgersForTests();
  });

  it("steps down a cram_pass user from Priority Sonnet (0.098) to Eco Haiku (0.028) at <=30% remaining and halts when exhausted", async () => {
    const userId = "cram-eco-user";
    const ledger = await getUserQuotaLedger(userId, "cram_pass", "VN");
    // cram_pass VN 24h window budget = $0.35. Spend $0.10 -> reserving $0.098 keeps remaining >30% (43%)
    ledger.windowSpentUsd = 0.10;
    ledger.weeklySpentUsd = 0.10;
    ledger.cogsSpentUsd = 0.10;
    await saveUserQuotaLedger(ledger);

    // Priority Sonnet ($0.098) when remaining stays > 30%
    const resSonnet = await checkAndReserveDeckQuota(userId, "cram_pass", "deck-sonnet-1", {
      region: "VN",
    });
    expect(resSonnet.allowed).toBe(true);
    expect(resSonnet.isHaikuOverflow).toBe(false);
    expect(resSonnet.reservedCostUsd).toBe(0.098);
    await recordDeckGenerationCogs(userId, "cram_pass", 0.098, 0.098, "VN");

    // Advance spent to $0.25 / $0.35 -> remaining = $0.10 (~29% <= 30% Eco mode!)
    const ecoLedger = await getUserQuotaLedger(userId, "cram_pass", "VN");
    ecoLedger.windowSpentUsd = 0.25;
    ecoLedger.weeklySpentUsd = 0.25;
    ecoLedger.cogsSpentUsd = 0.25;
    await saveUserQuotaLedger(ecoLedger);

    const resEco = await checkAndReserveDeckQuota(userId, "cram_pass", "deck-eco-2", {
      region: "VN",
    });
    expect(resEco.allowed).toBe(true);
    expect(resEco.isHaikuOverflow).toBe(true);
    expect(resEco.cogsStatus.useCheaperGeneratorSlug).toBe(true);
    expect(resEco.reservedCostUsd).toBe(0.028);
    await recordDeckGenerationCogs(userId, "cram_pass", 0.028, 0.028, "VN");

    // Exhaust full $0.35 window
    const finalLedger = await getUserQuotaLedger(userId, "cram_pass", "VN");
    finalLedger.windowSpentUsd = 0.35;
    finalLedger.weeklySpentUsd = 0.35;
    finalLedger.cogsSpentUsd = 0.35;
    await saveUserQuotaLedger(finalLedger);

    const blocked = await checkAndReserveDeckQuota(userId, "cram_pass", "deck-halted-3", {
      region: "VN",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("COGS_CEILING_EXCEEDED");
    expect(blocked.quota.remainingPct).toBe(0);
    expect(blocked.cogsStatus.serveCachedPoolsOnly).toBe(true);
  });

  it("steps down a pro_monthly user from Priority Sonnet (0.098) to Eco Haiku (0.028) at <=30% remaining", async () => {
    const userId = "pro-monthly-eco-user";
    const ledger = await getUserQuotaLedger(userId, "pro_monthly", "VN");
    // pro_monthly VN 24h window budget = $0.28. Spend $0.08 -> reserving $0.098 leaves $0.102 (~36% > 30%)
    ledger.windowSpentUsd = 0.08;
    ledger.weeklySpentUsd = 0.08;
    ledger.cogsSpentUsd = 0.08;
    await saveUserQuotaLedger(ledger);

    // Priority Sonnet ($0.098)
    const resSonnet = await checkAndReserveDeckQuota(userId, "pro_monthly", "pm-sonnet-1", {
      region: "VN",
    });
    expect(resSonnet.allowed).toBe(true);
    expect(resSonnet.isHaikuOverflow).toBe(false);
    expect(resSonnet.reservedCostUsd).toBe(0.098);
    await recordDeckGenerationCogs(userId, "pro_monthly", 0.098, 0.098, "VN");

    // Advance spent to $0.20 / $0.28 -> remaining = $0.08 (~29% <= 30%): Eco Haiku step-down ($0.028)
    const ecoLedger = await getUserQuotaLedger(userId, "pro_monthly", "VN");
    ecoLedger.windowSpentUsd = 0.20;
    ecoLedger.weeklySpentUsd = 0.20;
    ecoLedger.cogsSpentUsd = 0.20;
    await saveUserQuotaLedger(ecoLedger);

    const resEco = await checkAndReserveDeckQuota(userId, "pro_monthly", "pm-eco-2", {
      region: "VN",
    });
    expect(resEco.allowed).toBe(true);
    expect(resEco.isHaikuOverflow).toBe(true);
    expect(resEco.cogsStatus.useCheaperGeneratorSlug).toBe(true);
    expect(resEco.reservedCostUsd).toBe(0.028);
  });

  it("steps down a pro (semester) user from Priority Sonnet (0.098) to Eco Haiku (0.028) at <=30% remaining", async () => {
    const userId = "pro-semester-eco-user";
    const ledger = await getUserQuotaLedger(userId, "pro", "VN");
    // pro VN 24h window = $0.40. At $0.15 spent, reserving $0.098 leaves $0.152 (38% > 30%): Sonnet ($0.098)
    ledger.windowSpentUsd = 0.15;
    ledger.weeklySpentUsd = 0.15;
    ledger.cogsSpentUsd = 0.15;
    await saveUserQuotaLedger(ledger);

    const resSonnet = await checkAndReserveDeckQuota(userId, "pro", "pro-sonnet-1", {
      region: "VN",
    });
    expect(resSonnet.allowed).toBe(true);
    expect(resSonnet.isHaikuOverflow).toBe(false);
    expect(resSonnet.reservedCostUsd).toBe(0.098);
    await recordDeckGenerationCogs(userId, "pro", 0.098, 0.098, "VN");

    // Advance spent to $0.29 / $0.40 (~28% remaining <= 30%): Eco Haiku ($0.028)
    const ecoLedger = await getUserQuotaLedger(userId, "pro", "VN");
    ecoLedger.windowSpentUsd = 0.29;
    ecoLedger.weeklySpentUsd = 0.29;
    ecoLedger.cogsSpentUsd = 0.29;
    await saveUserQuotaLedger(ecoLedger);

    const resEco = await checkAndReserveDeckQuota(userId, "pro", "pro-eco-2", {
      region: "VN",
    });
    expect(resEco.allowed).toBe(true);
    expect(resEco.isHaikuOverflow).toBe(true);
    expect(resEco.cogsStatus.useCheaperGeneratorSlug).toBe(true);
    expect(resEco.reservedCostUsd).toBe(0.028);

    // Exhaust completely -> COGS_CEILING_EXCEEDED
    const exhausted = await getUserQuotaLedger(userId, "pro", "VN");
    exhausted.windowSpentUsd = 0.40;
    await saveUserQuotaLedger(exhausted);

    const blocked = await checkAndReserveDeckQuota(userId, "pro", "pro-blocked-3", {
      region: "VN",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("COGS_CEILING_EXCEEDED");
    expect(blocked.quota.remainingPct).toBe(0);
  });
});

