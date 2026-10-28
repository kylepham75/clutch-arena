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
  getStoredUserTier,
  setStoredUserTier,
  getStoredTierExpires,
  calculateTierExpiration,
  syncUserTierToCloud,
  fetchCloudUserTier,
  getStoredReferralState,
  awardReferralPass,
  consumeUnlockedRemixRun,
} from "@/lib/pricing/tiers";
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

  it("defines the 4 tiers with accurate PPP pricing and feature caps", () => {
    expect(PRICING_PLANS).toHaveLength(4);

    const contender = PRICING_PLANS.find((p) => p.id === "contender")!;
    expect(contender.priceVndFormatted).toBe("0đ");
    expect(contender.priceUsdFormatted).toBe("$0");
    expect(TIER_LIMITS.contender.maxUploadsPerWeek).toBe(2);
    expect(TIER_LIMITS.contender.maxFilesPerUpload).toBe(1);
    expect(TIER_LIMITS.contender.maxQuestionsPerRun).toBe(10);
    expect(TIER_LIMITS.contender.canUseConceptRemix).toBe(false);
    expect(TIER_LIMITS.contender.canHostArenaRemix).toBe(false);
    expect(TIER_LIMITS.contender.maxArenaPlayers).toBe(8);

    const cramPass = PRICING_PLANS.find((p) => p.id === "cram_pass")!;
    expect(["5.000đ", "69.000đ"]).toContain(cramPass.priceVndFormatted);
    expect(cramPass.priceUsdFormatted).toBe("$3.99");
    expect(cramPass.cycle).toBe("one_time");
    expect(TIER_LIMITS.cram_pass.maxFilesPerUpload).toBe(10);
    expect(TIER_LIMITS.cram_pass.maxQuestionsPerRun).toBe(30);
    expect(TIER_LIMITS.cram_pass.canUseConceptRemix).toBe(true);
    expect(TIER_LIMITS.cram_pass.canExportCheatSheet).toBe(true);
    expect(TIER_LIMITS.cram_pass.maxArenaPlayers).toBe(15);

    const pro = PRICING_PLANS.find((p) => p.id === "pro")!;
    expect(pro.priceVndFormatted).toBe("299.000đ");
    expect(pro.priceUsdFormatted).toBe("$29");
    expect(TIER_LIMITS.pro.canHostArenaRemix).toBe(true);
    expect(TIER_LIMITS.pro.maxArenaPlayers).toBe(15);

    const tutor = PRICING_PLANS.find((p) => p.id === "tutor")!;
    expect(tutor.priceVndFormatted).toBe("399.000đ");
    expect(tutor.priceUsdFormatted).toBe("$19.99");
    expect(tutor.comingSoon).toBe(true);
    expect(tutor.badgeEn).toBe("Coming Soon");
    expect(TIER_LIMITS.tutor.maxArenaPlayers).toBe(50);
    expect(TIER_LIMITS.tutor.hasCohortAnalytics).toBe(true);

    expect(getMaxArenaPlayersForTier("contender")).toBe(8);
    expect(getMaxArenaPlayersForTier("cram_pass")).toBe(15);
    expect(getMaxArenaPlayersForTier("pro")).toBe(15);
    expect(getMaxArenaPlayersForTier("tutor")).toBe(50);
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

  it("profiles updated after expiration returns the paid tier", async () => {
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
    expect(result.tier).toBe("pro");
    expect(result.isExpired).toBe(false);
    expect(result.expiresAt).not.toBeNull();
    const expMs = new Date(result.expiresAt!).getTime();
    expect(expMs).toBeGreaterThan(Date.now());
    expect(getStoredUserTier()).toBe("pro");
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

  it("verifyAuthToken treats profiles updated after expiration as active manual grant", async () => {
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
      expect(authResult.tier).toBe("pro");
      expect(authResult.tierExpiresAt).not.toBeNull();
      const expMs = new Date(authResult.tierExpiresAt!).getTime();
      expect(expMs).toBeGreaterThan(Date.now());
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
