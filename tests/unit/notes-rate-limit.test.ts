import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import {
  checkRateLimit,
  checkNotesRateLimit,
  resetQuotaLedgersForTests,
} from "@/lib/rate-limit";

describe("Clutch Notes AI Rate Limiting (30 conversions/day)", () => {
  beforeEach(() => {
    resetQuotaLedgersForTests();
  });

  it("allows up to 30 conversions per 24 hours for Pro users", async () => {
    const proUserId = `user-pro-ratelimit-test-${Date.now()}`;

    // First 30 requests should all be allowed
    for (let i = 1; i <= 30; i++) {
      const res = await checkRateLimit(proUserId, "notes", "pro");
      expect(res.allowed).toBe(true);
      expect(res.limit).toBe(30);
      expect(res.remaining).toBe(30 - i);
    }

    // The 31st conversion in the same 24h window must be rejected
    const blockedRes = await checkRateLimit(proUserId, "notes", "pro");
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.remaining).toBe(0);
    expect(blockedRes.retryAfter).toBeGreaterThan(0);
  });

  it("allows up to 30 conversions per 24 hours for Pro Monthly users (SA-07)", async () => {
    const proMonthlyUserId = `user-promonthly-notes-${Date.now()}`;

    // First 30 requests should all be allowed
    for (let i = 1; i <= 30; i++) {
      const res = await checkRateLimit(proMonthlyUserId, "notes", "pro_monthly");
      expect(res.allowed).toBe(true);
      expect(res.limit).toBe(30);
      expect(res.remaining).toBe(30 - i);
    }

    // The 31st conversion in the same 24h window must be rejected
    const blockedRes = await checkRateLimit(proMonthlyUserId, "notes", "pro_monthly");
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.remaining).toBe(0);
    expect(blockedRes.retryAfter).toBeGreaterThan(0);
  });

  it("allows up to 30 conversions per 24 hours for Cram Pass users", async () => {
    const cramUserId = `user-cram-ratelimit-test-${Date.now()}`;
    const res = await checkRateLimit(cramUserId, "notes", "cram_pass");
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(30);
    expect(res.remaining).toBe(29);
  });

  it("blocks non-pro / free users immediately with 0 limit", async () => {
    const freeUserId = `user-free-test-${Date.now()}`;
    const res = await checkRateLimit(freeUserId, "notes", "contender");
    expect(res.allowed).toBe(false);
    expect(res.limit).toBe(0);
  });

  it("works with checkNotesRateLimit serialized mutex helper", async () => {
    const userId = `user-mutex-notes-${Date.now()}`;
    const res1 = await checkNotesRateLimit({ userId, tier: "pro" });
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(29);

    const guestRes = await checkNotesRateLimit({ ip: "192.168.1.100", tier: "contender" });
    expect(guestRes.allowed).toBe(false);
    expect(guestRes.limit).toBe(0);
  });
});
