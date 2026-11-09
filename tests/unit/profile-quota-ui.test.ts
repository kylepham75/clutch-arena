import { describe, it, expect } from "vitest";
import {
  formatPassCountdown,
  computeProfileQuotaSummary,
} from "@/hooks/use-user-tier";
import type { UserTier } from "@/lib/pricing/tiers";

describe("Profile Quota & Pass Expiry UI (Stage 3.1)", () => {
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
      // 18 hours remaining
      const future18h = new Date(BASE_NOW + 18 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future18h, false, BASE_NOW)).toBe("18h remaining");
      expect(formatPassCountdown(future18h, true, BASE_NOW)).toBe("Còn 18 giờ");

      // 1 hour remaining
      const future1h = new Date(BASE_NOW + 1 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future1h, false, BASE_NOW)).toBe("1h remaining");
      expect(formatPassCountdown(future1h, true, BASE_NOW)).toBe("Còn 1 giờ");
    });

    it("formats days and hours when duration is 24+ hours with non-zero hours", () => {
      // 5 days and 14 hours
      const future5d14h = new Date(BASE_NOW + (5 * 24 + 14) * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future5d14h, false, BASE_NOW)).toBe("5d 14h remaining");
      expect(formatPassCountdown(future5d14h, true, BASE_NOW)).toBe("Còn 5 ngày 14 giờ");
    });

    it("formats days cleanly when duration is an exact multiple of 24 hours", () => {
      // Exactly 7 days
      const future7d = new Date(BASE_NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future7d, false, BASE_NOW)).toBe("7d remaining");
      expect(formatPassCountdown(future7d, true, BASE_NOW)).toBe("Còn 7 ngày");

      // Exactly 120 days (Semester Pro)
      const future120d = new Date(BASE_NOW + 120 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatPassCountdown(future120d, false, BASE_NOW)).toBe("120d remaining");
      expect(formatPassCountdown(future120d, true, BASE_NOW)).toBe("Còn 120 ngày");
    });
  });

  describe("computeProfileQuotaSummary across all 5 tiers", () => {
    it("computes correct quota summary for contender (free) tier", () => {
      const summaryEn = computeProfileQuotaSummary("contender", 0, 0, false);
      expect(summaryEn.tierLabel).toBe("Contender");
      expect(summaryEn.deckCreditsTotal).toBe(2);
      expect(summaryEn.deckCreditsUsed).toBe(0);
      expect(summaryEn.deckCreditsRemaining).toBe(2);
      expect(summaryEn.deckQuotaLabel).toBe("2 of 2 Contender decks remaining");
      expect(summaryEn.noteCreditsTotal).toBe(1);
      expect(summaryEn.noteCreditsRemaining).toBe(1);
      expect(summaryEn.noteQuotaLabel).toBe("1 of 1 daily note credits remaining");
      expect(summaryEn.showUpgradeToSemesterPro).toBe(true);
      expect(summaryEn.sonnetProDeckCredits).toBe(0);
      expect(summaryEn.haikuOverflowDeckCredits).toBe(0);

      const summaryVi = computeProfileQuotaSummary("contender", 1, 1, true);
      expect(summaryVi.tierLabel).toBe("Người Thách Đấu");
      expect(summaryVi.deckCreditsTotal).toBe(2);
      expect(summaryVi.deckCreditsUsed).toBe(1);
      expect(summaryVi.deckCreditsRemaining).toBe(1);
      expect(summaryVi.deckQuotaLabel).toBe("Còn 1 trên 2 bộ đề Người Thách Đấu");
      expect(summaryVi.noteCreditsTotal).toBe(1);
      expect(summaryVi.noteCreditsRemaining).toBe(0);
      expect(summaryVi.noteQuotaLabel).toBe("Còn 0 trên 1 lượt ghi chú hàng ngày");
      expect(summaryVi.showUpgradeToSemesterPro).toBe(true);
      expect(summaryVi.sonnetProDeckCredits).toBe(0);
      expect(summaryVi.haikuOverflowDeckCredits).toBe(0);
    });

    it("computes correct quota summary for 7-Day Cram Pass tier", () => {
      // 2 used out of 5
      const summaryEn = computeProfileQuotaSummary("cram_pass", 2, 0, false);
      expect(summaryEn.tierLabel).toBe("7-Day Cram Pass");
      expect(summaryEn.deckCreditsTotal).toBe(5);
      expect(summaryEn.deckCreditsUsed).toBe(2);
      expect(summaryEn.deckCreditsRemaining).toBe(3);
      expect(summaryEn.deckQuotaLabel).toBe("3 of 5 Cram Pass decks remaining");
      expect(summaryEn.noteCreditsTotal).toBe(5);
      expect(summaryEn.noteCreditsRemaining).toBe(5);
      expect(summaryEn.noteQuotaLabel).toBe("5 of 5 daily note credits remaining");
      expect(summaryEn.showUpgradeToSemesterPro).toBe(true);
      expect(summaryEn.sonnetProDeckCredits).toBe(5);
      expect(summaryEn.haikuOverflowDeckCredits).toBe(10);

      const summaryVi = computeProfileQuotaSummary("cram_pass", 2, 0, true);
      expect(summaryVi.tierLabel).toBe("Vé Ôn Thi Cấp Tốc (7 Ngày)");
      expect(summaryVi.deckQuotaLabel).toBe("Còn 3 trên 5 bộ đề Vé Ôn Thi Cấp Tốc");
      expect(summaryVi.showUpgradeToSemesterPro).toBe(true);
      expect(summaryVi.sonnetProDeckCredits).toBe(5);
      expect(summaryVi.haikuOverflowDeckCredits).toBe(10);
    });

    it("computes correct quota summary for Clutch Pro Monthly tier", () => {
      // 3 used out of 12
      const summaryEn = computeProfileQuotaSummary("pro_monthly", 3, 2, false);
      expect(summaryEn.tierLabel).toBe("Clutch Pro (Monthly)");
      expect(summaryEn.deckCreditsTotal).toBe(12);
      expect(summaryEn.deckCreditsUsed).toBe(3);
      expect(summaryEn.deckCreditsRemaining).toBe(9);
      expect(summaryEn.deckQuotaLabel).toBe("9 of 12 Pro Monthly decks remaining");
      expect(summaryEn.noteCreditsTotal).toBe(8);
      expect(summaryEn.noteCreditsRemaining).toBe(6);
      expect(summaryEn.noteQuotaLabel).toBe("6 of 8 daily note credits remaining");
      expect(summaryEn.showUpgradeToSemesterPro).toBe(true);
      expect(summaryEn.sonnetProDeckCredits).toBe(12);
      expect(summaryEn.haikuOverflowDeckCredits).toBe(20);

      const summaryVi = computeProfileQuotaSummary("pro_monthly", 3, 2, true);
      expect(summaryVi.tierLabel).toBe("Đấu Sĩ Pro (Hàng Tháng)");
      expect(summaryVi.deckQuotaLabel).toBe("Còn 9 trên 12 bộ đề Đấu Sĩ Pro (Hàng Tháng)");
      expect(summaryVi.noteQuotaLabel).toBe("Còn 6 trên 8 lượt ghi chú hàng ngày");
      expect(summaryVi.showUpgradeToSemesterPro).toBe(true);
      expect(summaryVi.sonnetProDeckCredits).toBe(12);
      expect(summaryVi.haikuOverflowDeckCredits).toBe(20);
    });

    it("computes correct quota summary for Clutch Pro Semester (pro) tier", () => {
      // 2 used out of 30
      const summaryEn = computeProfileQuotaSummary("pro", 2, 0, false);
      expect(summaryEn.tierLabel).toBe("Clutch Pro (Semester)");
      expect(summaryEn.deckCreditsTotal).toBe(30);
      expect(summaryEn.deckCreditsUsed).toBe(2);
      expect(summaryEn.deckCreditsRemaining).toBe(28);
      expect(summaryEn.deckQuotaLabel).toBe("28 of 30 Semester Pro decks remaining");
      expect(summaryEn.noteCreditsTotal).toBe(10);
      expect(summaryEn.noteCreditsRemaining).toBe(10);
      expect(summaryEn.noteQuotaLabel).toBe("10 of 10 daily note credits remaining");
      // Already on semester pro: CTA should be hidden
      expect(summaryEn.showUpgradeToSemesterPro).toBe(false);
      expect(summaryEn.sonnetProDeckCredits).toBe(30);
      expect(summaryEn.haikuOverflowDeckCredits).toBe(60);

      const summaryVi = computeProfileQuotaSummary("pro", 2, 0, true);
      expect(summaryVi.tierLabel).toBe("Đấu Sĩ Pro (Học Kỳ)");
      expect(summaryVi.deckQuotaLabel).toBe("Còn 28 trên 30 bộ đề Đấu Sĩ Pro (Học Kỳ)");
      expect(summaryVi.showUpgradeToSemesterPro).toBe(false);
      expect(summaryVi.sonnetProDeckCredits).toBe(30);
      expect(summaryVi.haikuOverflowDeckCredits).toBe(60);
    });

    it("computes correct quota summary for Tutor & Guild tier", () => {
      // 10 used out of 45
      const summaryEn = computeProfileQuotaSummary("tutor", 10, 5, false);
      expect(summaryEn.tierLabel).toBe("Tutor & Guild");
      expect(summaryEn.deckCreditsTotal).toBe(45);
      expect(summaryEn.deckCreditsUsed).toBe(10);
      expect(summaryEn.deckCreditsRemaining).toBe(35);
      expect(summaryEn.deckQuotaLabel).toBe("35 of 45 Tutor & Guild decks remaining");
      expect(summaryEn.noteCreditsTotal).toBe(25);
      expect(summaryEn.noteCreditsRemaining).toBe(20);
      expect(summaryEn.noteQuotaLabel).toBe("20 of 25 daily note credits remaining");
      // Higher tier than semester pro: CTA should be hidden
      expect(summaryEn.showUpgradeToSemesterPro).toBe(false);
      expect(summaryEn.sonnetProDeckCredits).toBe(45);
      expect(summaryEn.haikuOverflowDeckCredits).toBe(105);

      const summaryVi = computeProfileQuotaSummary("tutor", 10, 5, true);
      expect(summaryVi.tierLabel).toBe("Giảng Viên & Nhóm Học");
      expect(summaryVi.deckQuotaLabel).toBe("Còn 35 trên 45 bộ đề Giảng Viên & Nhóm Học");
      expect(summaryVi.showUpgradeToSemesterPro).toBe(false);
      expect(summaryVi.sonnetProDeckCredits).toBe(45);
      expect(summaryVi.haikuOverflowDeckCredits).toBe(105);
    });
  });

  describe("Quota clamping and boundary handling", () => {
    it("clamps deckCreditsUsed to deckCreditsTotal when library count exceeds the credit limit", () => {
      const summary = computeProfileQuotaSummary("contender", 999, 0, false);
      expect(summary.deckCreditsTotal).toBe(2);
      expect(summary.deckCreditsUsed).toBe(2);
      expect(summary.deckCreditsRemaining).toBe(0);
      expect(summary.deckQuotaLabel).toBe("0 of 2 Contender decks remaining");
    });

    it("handles negative used counts gracefully by clamping to 0", () => {
      const summary = computeProfileQuotaSummary("cram_pass", -5, -3, false);
      expect(summary.deckCreditsUsed).toBe(0);
      expect(summary.deckCreditsRemaining).toBe(5);
      expect(summary.noteCreditsRemaining).toBe(5);
    });

    it("handles omitted usedNotesTodayCount parameter by defaulting to 0 used", () => {
      const summary = computeProfileQuotaSummary("pro", 0);
      expect(summary.noteCreditsTotal).toBe(10);
      expect(summary.noteCreditsRemaining).toBe(10);
    });
  });
});
