"use client";

import { useEffect, useState, useCallback } from "react";
import {
  type UserTier,
  type TierLimits,
  type ReferralState,
  TIER_LIMITS,
  getStoredUserTier,
  setStoredUserTier,
  getStoredTierExpires,
  clearStoredUserTier,
  fetchCloudUserTier,
  getStoredReferralState,
  awardReferralPass,
  consumeUnlockedRemixRun,
} from "@/lib/pricing/tiers";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UserTierHook {
  tier: UserTier;
  tierExpiresAt: string | null;
  daysRemaining: number | null;
  hoursRemaining: number | null;
  limits: TierLimits;
  isPaidTier: boolean;
  isCramPassOrAbove: boolean;
  isProOrAbove: boolean;
  isTutor: boolean;
  referrals: ReferralState;
  unlockedRemixRuns: number;
  setTier: (tier: UserTier, expiresAt?: string | null) => void;
  awardReferral: (reason: "arena_4_player" | "pack_imports_3") => void;
  consumeRemixRun: () => boolean;
  refreshTier: () => Promise<UserTier>;
}

export interface ProfileQuotaSummary {
  tierLabel: string;
  deckCreditsTotal: number;
  deckCreditsUsed: number;
  deckCreditsRemaining: number;
  deckQuotaLabel: string;
  noteCreditsTotal: number;
  noteCreditsRemaining: number;
  noteQuotaLabel: string;
  showUpgradeToSemesterPro: boolean;
  sonnetProDeckCredits?: number;
  haikuOverflowDeckCredits?: number;
}

/**
 * Pure helper that formats remaining pass duration into human-readable text.
 * e.g., "5d 14h remaining" / "Còn 5 ngày 14 giờ", "18h remaining" / "Còn 18 giờ", or "Expired" / "Đã hết hạn".
 */
export function formatPassCountdown(
  tierExpiresAt: string | null,
  isVi: boolean = false,
  nowMs?: number,
): string | null {
  if (!tierExpiresAt) return null;
  const expMs = new Date(tierExpiresAt).getTime();
  if (isNaN(expMs)) return null;

  const currentMs = typeof nowMs === "number" ? nowMs : Date.now();
  const diffMs = expMs - currentMs;

  if (diffMs <= 0) {
    return isVi ? "Đã hết hạn" : "Expired";
  }

  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (totalHours < 24) {
    return isVi ? `Còn ${totalHours} giờ` : `${totalHours}h remaining`;
  }

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const remainingHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (remainingHours > 0) {
    return isVi
      ? `Còn ${days} ngày ${remainingHours} giờ`
      : `${days}d ${remainingHours}h remaining`;
  }

  return isVi ? `Còn ${days} ngày` : `${days}d remaining`;
}

/**
 * Pure helper that computes user tier labels, deck quotas, Clutch Notes credits,
 * and whether the semester pro upgrade CTA should be displayed.
 */
export function computeProfileQuotaSummary(
  tier: UserTier,
  usedDecksCount: number,
  usedNotesTodayCount?: number,
  isVi: boolean = false,
): ProfileQuotaSummary {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.contender;

  const tierLabelsEn: Record<UserTier, string> = {
    contender: "Contender",
    cram_pass: "7-Day Cram Pass",
    pro_monthly: "Clutch Pro (Monthly)",
    pro: "Clutch Pro (Semester)",
    tutor: "Tutor & Guild",
  };

  const tierLabelsVi: Record<UserTier, string> = {
    contender: "Người Thách Đấu",
    cram_pass: "Vé Ôn Thi Cấp Tốc (7 Ngày)",
    pro_monthly: "Đấu Sĩ Pro (Hàng Tháng)",
    pro: "Đấu Sĩ Pro (Học Kỳ)",
    tutor: "Giảng Viên & Nhóm Học",
  };

  const tierLabel = isVi
    ? tierLabelsVi[tier] || tierLabelsVi.contender
    : tierLabelsEn[tier] || tierLabelsEn.contender;

  const deckCreditsTotal = limits.newDeckCredits;
  const deckCreditsUsed = Math.min(deckCreditsTotal, Math.max(0, usedDecksCount));
  const deckCreditsRemaining = Math.max(0, deckCreditsTotal - deckCreditsUsed);

  const tierDeckDescriptorsEn: Record<UserTier, string> = {
    contender: "Contender",
    cram_pass: "Cram Pass",
    pro_monthly: "Pro Monthly",
    pro: "Semester Pro",
    tutor: "Tutor & Guild",
  };

  const tierDeckDescriptorsVi: Record<UserTier, string> = {
    contender: "Người Thách Đấu",
    cram_pass: "Vé Ôn Thi Cấp Tốc",
    pro_monthly: "Đấu Sĩ Pro (Hàng Tháng)",
    pro: "Đấu Sĩ Pro (Học Kỳ)",
    tutor: "Giảng Viên & Nhóm Học",
  };

  const deckDescriptorEn = tierDeckDescriptorsEn[tier] || "Contender";
  const deckDescriptorVi = tierDeckDescriptorsVi[tier] || "Người Thách Đấu";

  const deckQuotaLabel = isVi
    ? `Còn ${deckCreditsRemaining} trên ${deckCreditsTotal} bộ đề ${deckDescriptorVi}`
    : `${deckCreditsRemaining} of ${deckCreditsTotal} ${deckDescriptorEn} decks remaining`;

  const noteCreditsTotal = limits.maxNotesPerDay;
  const usedNotes = Math.max(0, usedNotesTodayCount ?? 0);
  const noteCreditsRemaining = Math.max(0, noteCreditsTotal - usedNotes);

  const noteQuotaLabel = isVi
    ? `Còn ${noteCreditsRemaining} trên ${noteCreditsTotal} lượt ghi chú hàng ngày`
    : `${noteCreditsRemaining} of ${noteCreditsTotal} daily note credits remaining`;

  const showUpgradeToSemesterPro = tier !== "pro" && tier !== "tutor";

  return {
    tierLabel,
    deckCreditsTotal,
    deckCreditsUsed,
    deckCreditsRemaining,
    deckQuotaLabel,
    noteCreditsTotal,
    noteCreditsRemaining,
    noteQuotaLabel,
    showUpgradeToSemesterPro,
    sonnetProDeckCredits: limits.sonnetProDeckCredits,
    haikuOverflowDeckCredits: limits.haikuOverflowDeckCredits,
  };
}

/**
 * Validates whether an incoming tier elevation is authorized.
 * When unauthenticated (no active user session returned from Supabase auth),
 * paid tiers (cram_pass, pro_monthly, pro, tutor) are strictly forbidden
 * and clamped back to "contender" with stored tier cleared.
 */
export async function verifyAndClampClientTier(
  candidateTier: UserTier,
  candidateExpiresAt?: string | null,
): Promise<{ tier: UserTier; expiresAt: string | null }> {
  if (candidateTier === "contender") {
    return { tier: "contender", expiresAt: null };
  }

  const supabase = getSupabaseBrowserClient();
  let hasUser = false;
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getUser();
      hasUser = !error && Boolean(data?.user);
    } catch {
      hasUser = false;
    }
  }

  if (!hasUser) {
    clearStoredUserTier();
    return { tier: "contender", expiresAt: null };
  }

  return {
    tier: candidateTier,
    expiresAt: candidateExpiresAt ?? getStoredTierExpires(),
  };
}

export function useUserTier(): UserTierHook {
  // Default to contender initially to ensure SSR and initial client hydration match identically
  const [tier, setTierState] = useState<UserTier>("contender");
  const [tierExpiresAt, setTierExpiresAt] = useState<string | null>(null);
  const [referrals, setReferralsState] = useState<ReferralState>({
    unlockedRemixRuns: 0,
    friendsInvited: 0,
    roomsHostedWith4Players: 0,
    packsImportedByClassmates: 0,
  });

  // Sync state from authoritative cloud database
  const syncFromCloud = useCallback(async (): Promise<UserTier> => {
    const cloud = await fetchCloudUserTier();
    setTierState(cloud.tier);
    setTierExpiresAt(cloud.expiresAt);
    return cloud.tier;
  }, []);

  useEffect(() => {
    let isMounted = true;
    setReferralsState(getStoredReferralState());

    // Hydration check: prevent client tier spoofing when unauthenticated
    const initTier = async () => {
      const storedTier = getStoredUserTier();
      const storedExpires = getStoredTierExpires();

      const verified = await verifyAndClampClientTier(storedTier, storedExpires);
      if (!isMounted) return;

      setTierState(verified.tier);
      setTierExpiresAt(verified.expiresAt);

      // Fetch authoritative tier from Supabase (defaults to contender when unauthenticated)
      void syncFromCloud();
    };

    void initTier();

    const handleTierUpdated = async (e: Event) => {
      const custom = e as CustomEvent<{ tier: UserTier; expiresAt?: string | null }>;
      const incomingTier = custom.detail?.tier;
      if (!incomingTier) return;

      const verified = await verifyAndClampClientTier(incomingTier, custom.detail.expiresAt);
      if (!isMounted) return;

      setTierState(verified.tier);
      setTierExpiresAt(verified.expiresAt);
    };

    const handleReferralsUpdated = (e: Event) => {
      const custom = e as CustomEvent<ReferralState>;
      if (custom.detail) {
        setReferralsState(custom.detail);
      }
    };

    const hasWindow = typeof window !== "undefined";
    if (hasWindow && typeof window.addEventListener === "function") {
      window.addEventListener("clutch:tier_updated", handleTierUpdated);
      window.addEventListener("clutch:referrals_updated", handleReferralsUpdated);
    }

    // Listen to Supabase auth events (e.g. mobile login after laptop purchase)
    const supabase = getSupabaseBrowserClient();
    let authUnsubscribe: (() => void) | null = null;

    if (supabase) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          await syncFromCloud();
        } else if (event === "SIGNED_OUT" || !session?.user) {
          clearStoredUserTier();
          if (isMounted) {
            setTierState("contender");
            setTierExpiresAt(null);
          }
        }
      });
      authUnsubscribe = () => subscription.unsubscribe();
    }

    return () => {
      isMounted = false;
      if (hasWindow && typeof window.removeEventListener === "function") {
        window.removeEventListener("clutch:tier_updated", handleTierUpdated);
        window.removeEventListener("clutch:referrals_updated", handleReferralsUpdated);
      }
      if (authUnsubscribe) authUnsubscribe();
    };
  }, [syncFromCloud]);

  const setTier = useCallback(async (newTier: UserTier, expiresAt?: string | null) => {
    const verified = await verifyAndClampClientTier(newTier, expiresAt);
    setStoredUserTier(verified.tier, verified.expiresAt);
    setTierState(verified.tier);
    setTierExpiresAt(verified.expiresAt);
  }, []);

  const awardReferral = useCallback((reason: "arena_4_player" | "pack_imports_3") => {
    awardReferralPass(reason);
    setReferralsState(getStoredReferralState());
  }, []);

  const consumeRemixRun = useCallback((): boolean => {
    const success = consumeUnlockedRemixRun();
    if (success) {
      setReferralsState(getStoredReferralState());
    }
    return success;
  }, []);

  const expMs = tierExpiresAt ? new Date(tierExpiresAt).getTime() : NaN;
  const hoursRemaining = !isNaN(expMs)
    ? Math.max(0, Math.ceil((expMs - Date.now()) / (1000 * 60 * 60)))
    : null;
  const daysRemaining = !isNaN(expMs)
    ? Math.max(0, Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const limits = TIER_LIMITS[tier] || TIER_LIMITS.contender;
  const isPaidTier = tier !== "contender";
  const isCramPassOrAbove = isPaidTier;
  const isProOrAbove = tier === "pro" || tier === "pro_monthly" || tier === "tutor";
  const isTutor = tier === "tutor";

  return {
    tier,
    tierExpiresAt,
    daysRemaining,
    hoursRemaining,
    limits,
    isPaidTier,
    isCramPassOrAbove,
    isProOrAbove,
    isTutor,
    referrals,
    unlockedRemixRuns: referrals.unlockedRemixRuns,
    setTier,
    awardReferral,
    consumeRemixRun,
    refreshTier: syncFromCloud,
  };
}
