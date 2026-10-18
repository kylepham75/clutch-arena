import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PRICING_PLANS,
  TIER_LIMITS,
  getStoredUserTier,
  setStoredUserTier,
  getStoredReferralState,
  awardReferralPass,
  consumeUnlockedRemixRun,
} from "@/lib/pricing/tiers";
import {
  createRoom,
  joinRoom,
  getRoom,
  IDLE_ROOM_TIMEOUT_MS,
} from "@/lib/multiplayer/room-manager";
import { mockMicroeconomics } from "@/data/mock-microeconomics";

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
    expect(cramPass.priceVndFormatted).toBe("69.000đ");
    expect(cramPass.priceUsdFormatted).toBe("$3.99");
    expect(cramPass.cycle).toBe("one_time");
    expect(TIER_LIMITS.cram_pass.maxFilesPerUpload).toBe(10);
    expect(TIER_LIMITS.cram_pass.maxQuestionsPerRun).toBe(30);
    expect(TIER_LIMITS.cram_pass.canUseConceptRemix).toBe(true);
    expect(TIER_LIMITS.cram_pass.canExportCheatSheet).toBe(true);

    const pro = PRICING_PLANS.find((p) => p.id === "pro")!;
    expect(pro.priceVndFormatted).toBe("299.000đ");
    expect(pro.priceUsdFormatted).toBe("$29");
    expect(TIER_LIMITS.pro.canHostArenaRemix).toBe(true);

    const tutor = PRICING_PLANS.find((p) => p.id === "tutor")!;
    expect(tutor.priceVndFormatted).toBe("399.000đ");
    expect(tutor.priceUsdFormatted).toBe("$19.99");
    expect(TIER_LIMITS.tutor.maxArenaPlayers).toBe(32);
    expect(TIER_LIMITS.tutor.hasCohortAnalytics).toBe(true);
  });

  it("handles tier persistence and retrieval cleanly", () => {
    expect(getStoredUserTier()).toBe("contender");

    setStoredUserTier("cram_pass");
    expect(getStoredUserTier()).toBe("cram_pass");

    setStoredUserTier("pro");
    expect(getStoredUserTier()).toBe("pro");
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
