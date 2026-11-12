import { describe, it, expect } from "vitest";
import {
  formatPassCountdown,
  computeProfileQuotaSummary,
  type ClientQuotaSummary,
} from "@/hooks/use-user-tier";
import {
  formatQuotaPercentBadge,
  formatQuotaResetCountdown,
} from "@/lib/pricing/tiers";

function makeQuota(overrides: Partial<ClientQuotaSummary> = {}): ClientQuotaSummary {
  return {
    remainingPct: 100,
    usedPct: 0,
    resetsAt: null,
    windowHours: 24,
    bottleneckScope: "window",
    mode: "normal",
    ...overrides,
  };
}

describe("Profile Quota & Pass Expiry UI (Stage 4.1 Rolling % Quota)", () => {
  const BASE_NOW = 1775000000000; // Fixed timestamp for deterministic time calculations

  describe("formatPassCountdown", () => {
    it("returns null for null, undefined, empty, or unparseable timestamps", () => {
      expect(formatPassCountdown(null, false, BASE_NOW)).toBeNull();
      expect(formatPassCountdown("", false, BASE_NOW)).toBeNull();
      expect(formatPassCountdown("invalid-date-string", false, BASE_NOW)).toBeNull();
    });

    it("returns 'Expired' in EN and 'Đã hết hạn' in VI when expiration has passed or is zero", () => {
      const pastIso = new Date(BASE_NOW - 1000).toISOString();
      const exactIso = new Date(BASE_NOW).toISOString();

      expect(formatPassCountdown(pastIso, false, BASE_NOW)).toBe("Expired");
      expect(formatPassCountdown(pastIso, true, BASE_NOW)).toBe("Đã hết hạn");

      expect(formatPassCountdown(exactIso, false, BASE_NOW)).toBe("Expired");
      expect(formatPassCountdown(exactIso, true, BASE_NOW)).toBe("Đã hết hạn");
    });

    it("formats remaining hours when remaining duration is under 24 hours", () => {
      const future18h = new Date(BASE_NOW + 18 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future18h, false, BASE_NOW)).toBe("18h remaining");
      expect(formatPassCountdown(future18h, true, BASE_NOW)).toBe("Còn 18 giờ");

      const future1h = new Date(BASE_NOW + 1 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future1h, false, BASE_NOW)).toBe("1h remaining");
      expect(formatPassCountdown(future1h, true, BASE_NOW)).toBe("Còn 1 giờ");
    });

    it("formats days and hours when duration is 24+ hours with non-zero hours", () => {
      const future5d14h = new Date(BASE_NOW + (5 * 24 + 14) * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future5d14h, false, BASE_NOW)).toBe("5d 14h remaining");
      expect(formatPassCountdown(future5d14h, true, BASE_NOW)).toBe("Còn 5 ngày 14 giờ");
    });

    it("formats days cleanly when duration is an exact multiple of 24 hours", () => {
      const future7d = new Date(BASE_NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future7d, false, BASE_NOW)).toBe("7d remaining");
      expect(formatPassCountdown(future7d, true, BASE_NOW)).toBe("Còn 7 ngày");

      const future120d = new Date(BASE_NOW + 120 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future120d, false, BASE_NOW)).toBe("120d remaining");
      expect(formatPassCountdown(future120d, true, BASE_NOW)).toBe("Còn 120 ngày");
    });
  });

  describe("formatQuotaPercentBadge & formatQuotaResetCountdown", () => {
    it("formats clamped 0-100% badges in EN and VI without exposing USD or integer deck counts", () => {
      expect(formatQuotaPercentBadge(100, false)).toBe("100% AI quota remaining");
      expect(formatQuotaPercentBadge(100, true)).toBe("Còn 100% hạn mức AI");

      expect(formatQuotaPercentBadge(72.6, false)).toBe("73% AI quota remaining");
      expect(formatQuotaPercentBadge(72.6, true)).toBe("Còn 73% hạn mức AI");

      expect(formatQuotaPercentBadge(-15, false)).toBe("0% AI quota remaining");
      expect(formatQuotaPercentBadge(145, true)).toBe("Còn 100% hạn mức AI");
    });

    it("formats reset countdown across minutes, hours, days, and elapsed resets in EN and VI", () => {
      expect(formatQuotaResetCountdown(null, false, BASE_NOW)).toBeNull();
      expect(formatQuotaResetCountdown("", true, BASE_NOW)).toBeNull();
      expect(formatQuotaResetCountdown("not-a-date", false, BASE_NOW)).toBeNull();

      const elapsedIso = new Date(BASE_NOW - 1000).toISOString();
      expect(formatQuotaResetCountdown(elapsedIso, false, BASE_NOW)).toBe("Resetting now");
      expect(formatQuotaResetCountdown(elapsedIso, true, BASE_NOW)).toBe("Đang làm mới ngay");

      const in45m = new Date(BASE_NOW + 45 * 60_000).toISOString();
      expect(formatQuotaResetCountdown(in45m, false, BASE_NOW)).toBe("Resets in 45m");
      expect(formatQuotaResetCountdown(in45m, true, BASE_NOW)).toBe("Làm mới sau 45 phút");

      const in5h30m = new Date(BASE_NOW + (5 * 60 + 30) * 60_000).toISOString();
      expect(formatQuotaResetCountdown(in5h30m, false, BASE_NOW)).toBe("Resets in 5h 30m");
      expect(formatQuotaResetCountdown(in5h30m, true, BASE_NOW)).toBe("Làm mới sau 5 giờ 30 phút");

      const in4hExact = new Date(BASE_NOW + 4 * 3_600_000).toISOString();
      expect(formatQuotaResetCountdown(in4hExact, false, BASE_NOW)).toBe("Resets in 4h");
      expect(formatQuotaResetCountdown(in4hExact, true, BASE_NOW)).toBe("Làm mới sau 4 giờ");

      const in2d6h = new Date(BASE_NOW + (2 * 24 + 6) * 3_600_000).toISOString();
      expect(formatQuotaResetCountdown(in2d6h, false, BASE_NOW)).toBe("Resets in 2d 6h");
      expect(formatQuotaResetCountdown(in2d6h, true, BASE_NOW)).toBe("Làm mới sau 2 ngày 6 giờ");

      const in3dExact = new Date(BASE_NOW + 3 * 86_400_000).toISOString();
      expect(formatQuotaResetCountdown(in3dExact, false, BASE_NOW)).toBe("Resets in 3d");
      expect(formatQuotaResetCountdown(in3dExact, true, BASE_NOW)).toBe("Làm mới sau 3 ngày");
    });
  });

  describe("computeProfileQuotaSummary across all 5 tiers", () => {
    it("computes rolling % quota summary for contender (free, 72h window) tier", () => {
      const resetIn2d12h = new Date(BASE_NOW + (2 * 24 + 12) * 3_600_000).toISOString();
      const quota = makeQuota({
        remainingPct: 65,
        usedPct: 35,
        resetsAt: resetIn2d12h,
        windowHours: 72,
        bottleneckScope: "window",
        mode: "normal",
      });

      const summaryEn = computeProfileQuotaSummary("contender", quota, false, BASE_NOW);
      expect(summaryEn).toEqual({
        remainingPct: 65,
        usedPct: 35,
        quotaLabel: "65% AI quota remaining",
        resetCountdown: "Resets in 2d 12h",
        statusTone: "healthy",
        isDegraded: false,
        tierLabel: "Contender",
        showUpgradeToSemesterPro: true,
      });

      const summaryVi = computeProfileQuotaSummary("contender", quota, true, BASE_NOW);
      expect(summaryVi).toEqual({
        remainingPct: 65,
        usedPct: 35,
        quotaLabel: "Còn 65% hạn mức AI",
        resetCountdown: "Làm mới sau 2 ngày 12 giờ",
        statusTone: "healthy",
        isDegraded: false,
        tierLabel: "Người Thách Đấu",
        showUpgradeToSemesterPro: true,
      });
    });

    it("computes rolling % quota summary for 7-Day Cram Pass tier", () => {
      const resetIn18h = new Date(BASE_NOW + 18 * 3_600_000).toISOString();
      const quota = makeQuota({
        remainingPct: 28,
        usedPct: 72,
        resetsAt: resetIn18h,
        windowHours: 24,
        bottleneckScope: "window",
        mode: "gentle",
      });

      const summaryEn = computeProfileQuotaSummary("cram_pass", quota, false, BASE_NOW);
      expect(summaryEn.tierLabel).toBe("7-Day Cram Pass");
      expect(summaryEn.remainingPct).toBe(28);
      expect(summaryEn.usedPct).toBe(72);
      expect(summaryEn.quotaLabel).toBe("28% AI quota remaining");
      expect(summaryEn.resetCountdown).toBe("Resets in 18h");
      expect(summaryEn.statusTone).toBe("caution");
      expect(summaryEn.isDegraded).toBe(true);
      expect(summaryEn.showUpgradeToSemesterPro).toBe(true);

      const summaryVi = computeProfileQuotaSummary("cram_pass", quota, true, BASE_NOW);
      expect(summaryVi.tierLabel).toBe("Vé Ôn Thi Cấp Tốc (7 Ngày)");
      expect(summaryVi.quotaLabel).toBe("Còn 28% hạn mức AI");
      expect(summaryVi.resetCountdown).toBe("Làm mới sau 18 giờ");
      expect(summaryVi.statusTone).toBe("caution");
      expect(summaryVi.isDegraded).toBe(true);
    });

    it("computes rolling % quota summary for Clutch Pro Monthly tier", () => {
      const resetIn6h = new Date(BASE_NOW + 6 * 3_600_000).toISOString();
      const quota = makeQuota({
        remainingPct: 80,
        usedPct: 20,
        resetsAt: resetIn6h,
        windowHours: 24,
        bottleneckScope: "window",
        mode: "normal",
      });

      const summaryEn = computeProfileQuotaSummary("pro_monthly", quota, false, BASE_NOW);
      expect(summaryEn.tierLabel).toBe("Clutch Pro (Monthly)");
      expect(summaryEn.remainingPct).toBe(80);
      expect(summaryEn.usedPct).toBe(20);
      expect(summaryEn.quotaLabel).toBe("80% AI quota remaining");
      expect(summaryEn.statusTone).toBe("healthy");
      expect(summaryEn.isDegraded).toBe(false);
      expect(summaryEn.showUpgradeToSemesterPro).toBe(true);

      const summaryVi = computeProfileQuotaSummary("pro_monthly", quota, true, BASE_NOW);
      expect(summaryVi.tierLabel).toBe("Đấu Sĩ Pro (Hàng Tháng)");
      expect(summaryVi.quotaLabel).toBe("Còn 80% hạn mức AI");
      expect(summaryVi.resetCountdown).toBe("Làm mới sau 6 giờ");
    });

    it("computes rolling % quota summary for Clutch Pro Semester (pro) tier", () => {
      const resetIn4d = new Date(BASE_NOW + 4 * 86_400_000).toISOString();
      const quota = makeQuota({
        remainingPct: 8,
        usedPct: 92,
        resetsAt: resetIn4d,
        windowHours: 168,
        bottleneckScope: "weekly",
        mode: "hard",
      });

      const summaryEn = computeProfileQuotaSummary("pro", quota, false, BASE_NOW);
      expect(summaryEn.tierLabel).toBe("Clutch Pro (Semester)");
      expect(summaryEn.remainingPct).toBe(8);
      expect(summaryEn.usedPct).toBe(92);
      expect(summaryEn.statusTone).toBe("critical");
      expect(summaryEn.isDegraded).toBe(true);
      expect(summaryEn.showUpgradeToSemesterPro).toBe(false);

      const summaryVi = computeProfileQuotaSummary("pro", quota, true, BASE_NOW);
      expect(summaryVi.tierLabel).toBe("Đấu Sĩ Pro (Học Kỳ)");
      expect(summaryVi.resetCountdown).toBe("Làm mới sau 4 ngày");
      expect(summaryVi.showUpgradeToSemesterPro).toBe(false);
    });

    it("computes rolling % quota summary for Tutor & Guild tier and hides upgrade CTA", () => {
      const quota = makeQuota({
        remainingPct: 94,
        usedPct: 6,
        resetsAt: new Date(BASE_NOW + 12 * 3_600_000).toISOString(),
        windowHours: 24,
        mode: "full",
      });

      const summaryEn = computeProfileQuotaSummary("tutor", quota, false, BASE_NOW);
      expect(summaryEn.tierLabel).toBe("Tutor & Guild");
      expect(summaryEn.remainingPct).toBe(94);
      expect(summaryEn.usedPct).toBe(6);
      expect(summaryEn.statusTone).toBe("healthy");
      expect(summaryEn.isDegraded).toBe(false);
      expect(summaryEn.showUpgradeToSemesterPro).toBe(false);

      const summaryVi = computeProfileQuotaSummary("tutor", quota, true, BASE_NOW);
      expect(summaryVi.tierLabel).toBe("Giảng Viên & Nhóm Học");
      expect(summaryVi.showUpgradeToSemesterPro).toBe(false);
    });

    it("exposes zero raw USD amounts or legacy integer deck/note counts on ProfileQuotaSummary", () => {
      const summary = computeProfileQuotaSummary(
        "pro",
        makeQuota({
          remainingPct: 45,
          usedPct: 55,
          resetsAt: new Date(BASE_NOW + 3_600_000).toISOString(),
        }),
        false,
        BASE_NOW,
      );
      const serialized = JSON.stringify(summary);
      expect(serialized).not.toMatch(/\$|usd|cogs/i);
      expect(summary).not.toHaveProperty("deckCreditsTotal");
      expect(summary).not.toHaveProperty("deckCreditsUsed");
      expect(summary).not.toHaveProperty("deckCreditsRemaining");
      expect(summary).not.toHaveProperty("noteCreditsTotal");
      expect(summary).not.toHaveProperty("noteCreditsRemaining");
    });
  });

  describe("Eco-mode (<=30%), statusTone thresholds, and clamping", () => {
    it("transitions statusTone and Eco-mode degradation accurately at 31%, 30%, 11%, 10%, and 0%", () => {
      const healthy = computeProfileQuotaSummary(
        "cram_pass",
        makeQuota({ remainingPct: 31, usedPct: 69, mode: "normal" }),
        false,
        BASE_NOW,
      );
      expect(healthy.statusTone).toBe("healthy");
      expect(healthy.isDegraded).toBe(false);

      const ecoBoundary = computeProfileQuotaSummary(
        "cram_pass",
        makeQuota({ remainingPct: 30, usedPct: 70, mode: "normal" }),
        false,
        BASE_NOW,
      );
      expect(ecoBoundary.statusTone).toBe("caution");
      expect(ecoBoundary.isDegraded).toBe(true);

      const cautionLow = computeProfileQuotaSummary(
        "cram_pass",
        makeQuota({ remainingPct: 11, usedPct: 89, mode: "gentle" }),
        false,
        BASE_NOW,
      );
      expect(cautionLow.statusTone).toBe("caution");
      expect(cautionLow.isDegraded).toBe(true);

      const criticalBoundary = computeProfileQuotaSummary(
        "cram_pass",
        makeQuota({ remainingPct: 10, usedPct: 90, mode: "hard" }),
        false,
        BASE_NOW,
      );
      expect(criticalBoundary.statusTone).toBe("critical");
      expect(criticalBoundary.isDegraded).toBe(true);

      const exhausted = computeProfileQuotaSummary(
        "cram_pass",
        makeQuota({ remainingPct: 0, usedPct: 100, mode: "halted" }),
        false,
        BASE_NOW,
      );
      expect(exhausted.statusTone).toBe("critical");
      expect(exhausted.isDegraded).toBe(true);
      expect(exhausted.quotaLabel).toBe("0% AI quota remaining");
    });

    it("marks isDegraded when mode is haiku_overflow or cached_only even above 30%", () => {
      const overflow = computeProfileQuotaSummary(
        "pro",
        makeQuota({ remainingPct: 50, usedPct: 50, mode: "haiku_overflow" }),
        false,
        BASE_NOW,
      );
      expect(overflow.statusTone).toBe("healthy");
      expect(overflow.isDegraded).toBe(true);

      const cachedOnly = computeProfileQuotaSummary(
        "pro",
        makeQuota({ remainingPct: 40, usedPct: 60, mode: "cached_only" }),
        false,
        BASE_NOW,
      );
      expect(cachedOnly.isDegraded).toBe(true);
    });

    it("defaults cleanly when quotaState is null or undefined and clamps out-of-range percentages", () => {
      const defaultSummary = computeProfileQuotaSummary("contender", null, false, BASE_NOW);
      expect(defaultSummary.remainingPct).toBe(100);
      expect(defaultSummary.usedPct).toBe(0);
      expect(defaultSummary.resetCountdown).toBeNull();
      expect(defaultSummary.statusTone).toBe("healthy");
      expect(defaultSummary.isDegraded).toBe(false);

      const clampedHigh = computeProfileQuotaSummary(
        "pro",
        makeQuota({ remainingPct: 150, usedPct: -20 }),
        false,
        BASE_NOW,
      );
      expect(clampedHigh.remainingPct).toBe(100);
      expect(clampedHigh.usedPct).toBe(0);

      const clampedLow = computeProfileQuotaSummary(
        "pro",
        makeQuota({ remainingPct: -12, usedPct: 135 }),
        false,
        BASE_NOW,
      );
      expect(clampedLow.remainingPct).toBe(0);
      expect(clampedLow.usedPct).toBe(100);
      expect(clampedLow.statusTone).toBe("critical");
      expect(clampedLow.isDegraded).toBe(true);
    });
  });
});
