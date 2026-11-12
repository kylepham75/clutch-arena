import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import {
  checkRateLimit,
  checkNotesRateLimit,
  checkAndReserveDeckQuota,
  recordDeckGenerationCogs,
  rollbackDeckQuotaReservation,
  getRollingQuotaSnapshot,
  getUserQuotaLedger,
  saveUserQuotaLedger,
  setSharedDeckCache,
  toClientQuota,
  resetQuotaLedgersForTests,
} from "@/lib/rate-limit";

describe("Clutch Notes AI Anti-Spam Burst Shield & Unified Rolling % Quota", () => {
  beforeEach(() => {
    resetQuotaLedgersForTests();
  });

  describe("10-minute Anti-Spam Burst Shield (checkRateLimit)", () => {
    it("allows up to 30 burst requests per 10 minutes for Paid tiers (pro, pro_monthly, cram_pass, tutor)", async () => {
      for (const tier of ["pro", "pro_monthly", "cram_pass", "tutor"] as const) {
        const userId = `user-${tier}-burst-${Date.now()}`;

        for (let i = 1; i <= 30; i++) {
          const res = await checkRateLimit(userId, "notes", tier);
          expect(res.allowed).toBe(true);
          expect(res.limit).toBe(30);
          expect(res.remaining).toBe(30 - i);
        }

        const blockedRes = await checkRateLimit(userId, "notes", tier);
        expect(blockedRes.allowed).toBe(false);
        expect(blockedRes.limit).toBe(30);
        expect(blockedRes.remaining).toBe(0);
        expect(blockedRes.retryAfter).toBeGreaterThan(0);
      }
    });

    it("allows up to 10 burst requests per 10 minutes for signed-in Free (contender) users", async () => {
      const freeUserId = `user-contender-burst-${Date.now()}`;

      for (let i = 1; i <= 10; i++) {
        const res = await checkRateLimit(freeUserId, "notes", "contender");
        expect(res.allowed).toBe(true);
        expect(res.limit).toBe(10);
        expect(res.remaining).toBe(10 - i);
      }

      const blockedRes = await checkRateLimit(freeUserId, "notes", "contender");
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.limit).toBe(10);
      expect(blockedRes.remaining).toBe(0);
      expect(blockedRes.retryAfter).toBeGreaterThan(0);
    });

    it("works with checkNotesRateLimit serialized mutex helper for both paid and contender actors", async () => {
      const proRes = await checkNotesRateLimit({ userId: "mutex-pro-1", tier: "pro" });
      expect(proRes.allowed).toBe(true);
      expect(proRes.limit).toBe(30);
      expect(proRes.remaining).toBe(29);

      const contenderRes = await checkNotesRateLimit({
        userId: "mutex-contender-1",
        tier: "contender",
      });
      expect(contenderRes.allowed).toBe(true);
      expect(contenderRes.limit).toBe(10);
      expect(contenderRes.remaining).toBe(9);
    });
  });

  describe("Unified Rolling % Quota for Notes (actionKind: 'notes')", () => {
    it("reserves, settles, and rolls back rolling % quota for contender (72h window) without touching deckCreditsUsed", async () => {
      const userId = "user-contender-notes-rolling";
      const contentHash = "hash-notes-contender-1";

      const initialSnapshot = await getRollingQuotaSnapshot(userId, "contender", "VN");
      expect(initialSnapshot.remainingPct).toBe(100);
      expect(initialSnapshot.windowHours).toBe(72);
      expect(initialSnapshot.allowVisionOcr).toBe(true);

      const reserve = await checkAndReserveDeckQuota(userId, "contender", contentHash, {
        actionKind: "notes",
        region: "VN",
      });
      expect(reserve.allowed).toBe(true);
      expect(reserve.reserved).toBe(true);
      expect(reserve.reservedCostUsd).toBe(0.012);
      expect(reserve.creditsUsed).toBe(0);
      expect(reserve.quota.remainingPct).toBeLessThan(100);

      // Settle actual COGS ($0.01)
      const settled = await recordDeckGenerationCogs(
        userId,
        "contender",
        0.01,
        reserve.reservedCostUsd,
        "VN",
      );
      expect(settled.ledger.cogsReservedUsd).toBe(0);
      expect(settled.ledger.windowReservedUsd).toBe(0);
      expect(settled.ledger.cogsSpentUsd).toBe(0.01);
      expect(settled.ledger.deckCreditsUsed).toBe(0);

      // Second generation reserves and then rolls back cleanly
      const reserve2 = await checkAndReserveDeckQuota(userId, "contender", "hash-notes-2", {
        actionKind: "notes",
        region: "VN",
      });
      expect(reserve2.allowed).toBe(true);

      const rolledBack = await rollbackDeckQuotaReservation({
        userId,
        tier: "contender",
        contentHash: "hash-notes-2",
        reservedCostUsd: reserve2.reservedCostUsd,
        actionKind: "notes",
        region: "VN",
      });
      expect(rolledBack.success).toBe(true);
      expect(rolledBack.ledger.windowReservedUsd).toBe(0);
      expect(rolledBack.ledger.weeklyReservedUsd).toBe(0);
      expect(rolledBack.ledger.cogsReservedUsd).toBe(0);
      expect(rolledBack.ledger.cogsSpentUsd).toBe(0.01);
    });

    it("blocks new notes generation with COGS_CEILING_EXCEEDED when rolling quota is exhausted, while shared cache remains 0%", async () => {
      const userId = "user-cram-exhausted-notes";
      const ledger = await getUserQuotaLedger(userId, "cram_pass", "ROW");
      ledger.windowSpentUsd = 0.6;
      ledger.weeklySpentUsd = 0.6;
      ledger.cogsSpentUsd = 0.6;
      await saveUserQuotaLedger(ledger);

      const snapshot = await getRollingQuotaSnapshot(userId, "cram_pass", "ROW");
      expect(snapshot.remainingPct).toBe(0);
      expect(snapshot.mode).toBe("halted");
      expect(snapshot.allowVisionOcr).toBe(false);

      // Uncached generation must be blocked
      const blocked = await checkAndReserveDeckQuota(userId, "cram_pass", "uncached-notes-hash", {
        actionKind: "notes",
        region: "ROW",
        pipelineVersion: "notes-v1",
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.reserved).toBe(false);
      expect(blocked.reason).toBe("COGS_CEILING_EXCEEDED");
      expect(toClientQuota(blocked.quota)).toMatchObject({
        remainingPct: 0,
        usedPct: 100,
        mode: "halted",
      });

      // Shared cached note remains accessible at 0% quota
      await setSharedDeckCache({
        contentHash: "cached-notes-hash",
        fileSha256: "f".repeat(64),
        language: "en",
        mode: "notes",
        focusHash: "",
        pipelineVersion: "notes-v1",
        questionPool: [],
        clutchNote: { id: "cached-note-1", title: "Cached" },
      });

      const cacheHit = await checkAndReserveDeckQuota(userId, "cram_pass", "cached-notes-hash", {
        actionKind: "notes",
        language: "en",
        mode: "notes",
        focusHash: "",
        pipelineVersion: "notes-v1",
        fileSha256: "f".repeat(64),
        region: "ROW",
      });
      expect(cacheHit.allowed).toBe(true);
      expect(cacheHit.cacheHit).toBe(true);
      expect(cacheHit.reserved).toBe(false);
      expect(cacheHit.reservedCostUsd).toBe(0);
    });
  });
});
