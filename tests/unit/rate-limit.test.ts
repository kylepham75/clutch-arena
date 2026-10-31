import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import {
  checkRateLimit,
  checkInMemoryRateLimit,
  setBoundedMapEntry,
  MAX_LOCAL_RATE_ENTRIES,
  MAX_SHARED_DECK_CACHE_ENTRIES,
  MAX_USER_QUOTA_LEDGER_ENTRIES,
  getLocalRateMemoryStoreSize,
  getSharedDeckMemoryCacheSize,
  getFileSha256ToCompositeMapSize,
  getUserQuotaMemoryStoreSize,
  resetQuotaLedgersForTests,
  setSharedDeckCache,
  getSharedDeckCache,
  getUserQuotaLedger,
  saveUserQuotaLedger,
} from "@/lib/rate-limit";
import { createIngestionHandler } from "@/lib/ingestion/handler";
import { createMultiIngestionHandler } from "@/lib/ingestion/multi-handler";
import { createCoachHandler } from "@/lib/coach/handler";
import { studyText } from "../helpers/documents";

describe("Rate Limiting & Server-Side Tier Enforcement", () => {
  it("enforces tier-aware sliding window limits (2/week for guest/contender, 50/day for paid)", async () => {
    const guestId = `test-guest-${Date.now()}`;

    // Limit is 2 per week for guest / contender
    const res1 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res1.allowed).toBe(true);
    expect(res1.limit).toBe(2);
    expect(res1.remaining).toBe(1);

    const res2 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(0);

    // 3rd request must be blocked
    const res3 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res3.allowed).toBe(false);
    expect(res3.remaining).toBe(0);
    expect(res3.retryAfter).toBeGreaterThan(0);

    // Paid tier (cram_pass) gets 50 per day
    const paidId = `test-paid-${Date.now()}`;
    const paidRes = await checkRateLimit(paidId, "ingest", "cram_pass");
    expect(paidRes.allowed).toBe(true);
    expect(paidRes.limit).toBe(50);
    expect(paidRes.remaining).toBe(49);
  });

  it("blocks >10 questions on /api/ingest for guest and contender tiers (403 TIER_UPGRADE_REQUIRED)", async () => {
    const handler = createIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      verifyAuth: vi.fn().mockResolvedValue({
        authenticated: true,
        user: { id: "user-1" },
        tier: "contender",
        tierExpiresAt: null,
      }),
    });

    const form = new FormData();
    form.set("file", new File([studyText], "notes.txt"));
    form.set(
      "options",
      JSON.stringify({ operation: "generate", questionCount: 20 }),
    );

    const req = new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
  });

  it("blocks multi-file generation on /api/ingest-multi for guest and contender tiers (403 TIER_UPGRADE_REQUIRED)", async () => {
    const handler = createMultiIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      verifyAuth: vi.fn().mockResolvedValue({
        authenticated: false,
        user: null,
        tier: "guest",
        tierExpiresAt: null,
      }),
    });

    const form = new FormData();
    form.append("files", new File([studyText], "notes1.txt"));
    form.append("files", new File([studyText], "notes2.txt"));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const req = new Request("http://localhost:3000/api/ingest-multi", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
  });

  it("returns HTTP 429 RATE_LIMIT_EXCEEDED on /api/ingest when quota exhausted", async () => {
    const mockLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 2,
      remaining: 0,
      reset: 3600,
      retryAfter: 3600,
    });

    const handler = createIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      rateLimiter: mockLimiter,
    });

    const form = new FormData();
    form.set("file", new File([studyText], "notes.txt"));
    form.set("options", JSON.stringify({ operation: "generate" }));

    const req = new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(mockLimiter).toHaveBeenCalled();
  });

  it("returns HTTP 429 on /api/coach when coach rate limit is reached", async () => {
    const mockLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 20,
      remaining: 0,
      reset: 600,
      retryAfter: 600,
    });

    const handler = createCoachHandler({
      rateLimiter: mockLimiter,
    });

    const req = new Request("http://localhost:3000/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Help me" }] }],
        document: {
          fileName: "notes.txt",
          sources: [{ id: "1", label: "Page 1", text: "Study material" }],
        },
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  describe("Bounded In-Memory Stores & LRU Eviction", () => {
    beforeEach(() => {
      resetQuotaLedgersForTests();
    });

    describe("setBoundedMapEntry helper", () => {
      it("bounds map size and evicts oldest entry in FIFO/LRU order", () => {
        const map = new Map<string, number>();
        const evicted: Array<{ key: string; value: number }> = [];

        setBoundedMapEntry(map, "a", 1, 3, (k, v) => evicted.push({ key: k, value: v }));
        setBoundedMapEntry(map, "b", 2, 3, (k, v) => evicted.push({ key: k, value: v }));
        setBoundedMapEntry(map, "c", 3, 3, (k, v) => evicted.push({ key: k, value: v }));
        expect(map.size).toBe(3);
        expect(evicted.length).toBe(0);

        // Re-inserting existing key refreshes its LRU position without eviction
        setBoundedMapEntry(map, "a", 10, 3, (k, v) => evicted.push({ key: k, value: v }));
        expect(map.size).toBe(3);
        expect(evicted.length).toBe(0);

        // Inserting 4th item should evict "b" (since "a" was refreshed and "c" was after "b")
        setBoundedMapEntry(map, "d", 4, 3, (k, v) => evicted.push({ key: k, value: v }));
        expect(map.size).toBe(3);
        expect(evicted).toEqual([{ key: "b", value: 2 }]);
        expect(Array.from(map.keys())).toEqual(["c", "a", "d"]);
      });
    });

    describe("sharedDeckMemoryStore bounded LRU eviction", () => {
      it("caps size at MAX_SHARED_DECK_CACHE_ENTRIES (250) and evicts oldest entries", async () => {
        expect(getSharedDeckMemoryCacheSize()).toBe(0);

        // Insert 260 distinct shared deck entries
        for (let i = 0; i < 260; i++) {
          await setSharedDeckCache({
            contentHash: `hash-${i}`,
            fileSha256: `sha-${i}`,
            language: "en",
            mode: "generate",
            focusHash: "",
            pipelineVersion: "v1",
            questionPool: [{ id: `q-${i}`, text: `Question ${i}` }],
          });
        }

        expect(getSharedDeckMemoryCacheSize()).toBe(MAX_SHARED_DECK_CACHE_ENTRIES);
        expect(getFileSha256ToCompositeMapSize()).toBeLessThanOrEqual(MAX_SHARED_DECK_CACHE_ENTRIES);

        // Oldest entries (0-9) should have been evicted
        const entry0 = await getSharedDeckCache({ contentHash: "hash-0", pipelineVersion: "v1", fileSha256: "sha-0" });
        expect(entry0).toBeNull();
        const entry9 = await getSharedDeckCache({ contentHash: "hash-9", pipelineVersion: "v1", fileSha256: "sha-9" });
        expect(entry9).toBeNull();

        // Newest entry (259) should be present
        const entry259 = await getSharedDeckCache({ contentHash: "hash-259", pipelineVersion: "v1", fileSha256: "sha-259" });
        expect(entry259).not.toBeNull();
        expect(entry259?.contentHash).toBe("hash-259");
      });

      it("preserves recently accessed entry on cache hit while evicting unaccessed older entry", async () => {
        // Insert up to MAX_SHARED_DECK_CACHE_ENTRIES (250)
        for (let i = 0; i < MAX_SHARED_DECK_CACHE_ENTRIES; i++) {
          await setSharedDeckCache({
            contentHash: `item-${i}`,
            fileSha256: `file-sha-${i}`,
            language: "en",
            mode: "generate",
            focusHash: "",
            pipelineVersion: "v1",
            questionPool: [{ id: `q-${i}` }],
          });
        }
        expect(getSharedDeckMemoryCacheSize()).toBe(250);

        // Access item-0 (cache hit refreshes its LRU order)
        const hit0 = await getSharedDeckCache({
          contentHash: "item-0",
          pipelineVersion: "v1",
          fileSha256: "file-sha-0",
        });
        expect(hit0).not.toBeNull();

        // Now insert item-250 (overflowing by 1)
        await setSharedDeckCache({
          contentHash: "item-250",
          fileSha256: "file-sha-250",
          language: "en",
          mode: "generate",
          focusHash: "",
          pipelineVersion: "v1",
          questionPool: [{ id: "q-250" }],
        });

        expect(getSharedDeckMemoryCacheSize()).toBe(250);

        // item-1 was the oldest unaccessed entry, so it should be evicted
        const checkItem1 = await getSharedDeckCache({
          contentHash: "item-1",
          pipelineVersion: "v1",
          fileSha256: "file-sha-1",
        });
        expect(checkItem1).toBeNull();

        // item-0 was accessed right before, so it MUST still be present
        const checkItem0 = await getSharedDeckCache({
          contentHash: "item-0",
          pipelineVersion: "v1",
          fileSha256: "file-sha-0",
        });
        expect(checkItem0).not.toBeNull();
        expect(checkItem0?.contentHash).toBe("item-0");
      });
    });

    describe("userQuotaMemoryStore bounded LRU eviction", () => {
      it("caps size at MAX_USER_QUOTA_LEDGER_ENTRIES (1000) and evicts oldest entries", async () => {
        expect(getUserQuotaMemoryStoreSize()).toBe(0);

        // Insert 1020 ledgers
        for (let i = 0; i < 1020; i++) {
          await getUserQuotaLedger(`user-${i}`, "contender");
        }

        expect(getUserQuotaMemoryStoreSize()).toBe(MAX_USER_QUOTA_LEDGER_ENTRIES);

        // Verify with saveUserQuotaLedger that updating refreshes LRU:
        resetQuotaLedgersForTests();
        for (let i = 0; i < 1000; i++) {
          await saveUserQuotaLedger({
            userId: `u-${i}`,
            tier: "contender",
            cogsSpentUsd: i * 0.001,
            cogsReservedUsd: 0,
            cogsCeilingUsd: 0.05,
            deckCreditsUsed: 1,
            deckCreditsLimit: 2,
            dailyBurstUsed: 1,
            dailyBurstDate: "2026-10-31",
            unlockedDecks: {},
          });
        }
        expect(getUserQuotaMemoryStoreSize()).toBe(1000);

        // Update u-0 (refreshing LRU)
        const u0 = await getUserQuotaLedger("u-0", "contender");
        u0.deckCreditsUsed = 2;
        await saveUserQuotaLedger(u0);

        // Insert u-1000 (overflows by 1)
        await saveUserQuotaLedger({
          userId: "u-1000",
          tier: "contender",
          cogsSpentUsd: 0,
          cogsReservedUsd: 0,
          cogsCeilingUsd: 0.05,
          deckCreditsUsed: 0,
          deckCreditsLimit: 2,
          dailyBurstUsed: 0,
          dailyBurstDate: "2026-10-31",
          unlockedDecks: {},
        });

        expect(getUserQuotaMemoryStoreSize()).toBe(1000);

        // u-1 should be evicted (cogsSpentUsd would reset to 0 in a fresh ledger)
        const ledger1 = await getUserQuotaLedger("u-1", "contender");
        expect(ledger1.cogsSpentUsd).toBe(0);

        // u-0 was refreshed and should retain modified deckCreditsUsed: 2
        const ledger0 = await getUserQuotaLedger("u-0", "contender");
        expect(ledger0.deckCreditsUsed).toBe(2);
      });
    });

    describe("localMemoryStore bounded LRU eviction", () => {
      it("caps size at MAX_LOCAL_RATE_ENTRIES (2000) and evicts oldest entries", () => {
        expect(getLocalRateMemoryStoreSize()).toBe(0);

        // Insert 2050 distinct rate limit records
        for (let i = 0; i < 2050; i++) {
          checkInMemoryRateLimit(`ip-${i}`, 10, 60000);
        }

        expect(getLocalRateMemoryStoreSize()).toBe(MAX_LOCAL_RATE_ENTRIES);

        // Test LRU refresh:
        resetQuotaLedgersForTests();
        for (let i = 0; i < 2000; i++) {
          checkInMemoryRateLimit(`client-${i}`, 5, 60000);
        }
        expect(getLocalRateMemoryStoreSize()).toBe(2000);

        // Access client-0 again to consume a 2nd hit and refresh LRU
        const touch0 = checkInMemoryRateLimit("client-0", 5, 60000);
        expect(touch0.remaining).toBe(3); // 5 - 2 = 3

        // Insert client-2000 (overflowing by 1)
        checkInMemoryRateLimit("client-2000", 5, 60000);
        expect(getLocalRateMemoryStoreSize()).toBe(2000);

        // client-1 was the oldest unaccessed entry, so it should be evicted. Next hit starts fresh with remaining 4
        const hitClient1 = checkInMemoryRateLimit("client-1", 5, 60000);
        expect(hitClient1.remaining).toBe(4);

        // client-0 was refreshed and had remaining 3. Next hit should give remaining 2!
        const hitClient0 = checkInMemoryRateLimit("client-0", 5, 60000);
        expect(hitClient0.remaining).toBe(2);
      });
    });
  });
});
