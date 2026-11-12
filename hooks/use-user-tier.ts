"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  type UserTier,
  type TierLimits,
  type ReferralState,
  type CogsDegradationMode,
  TIER_LIMITS,
  getStoredUserTier,
  setStoredUserTier,
  getStoredTierExpires,
  clearStoredUserTier,
  fetchCloudUserTier,
  getStoredReferralState,
  awardReferralPass,
  consumeUnlockedRemixRun,
  formatQuotaPercentBadge,
  formatQuotaResetCountdown,
} from "@/lib/pricing/tiers";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type QuotaBottleneckScope = "window" | "weekly" | "cycle";
export type ClientQuotaMode =
  | "normal"
  | "caution"
  | "haiku_overflow"
  | "cached_only"
  | CogsDegradationMode;
export type QuotaStatusTone = "healthy" | "caution" | "critical";

export const QUOTA_UPDATED_EVENT = "clutch:quota-updated";

export interface ClientQuotaSummary {
  remainingPct: number;
  usedPct: number;
  resetsAt: string | null;
  windowHours: number;
  bottleneckScope: QuotaBottleneckScope;
  mode: ClientQuotaMode;
}

export type QuotaState = ClientQuotaSummary;

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
  quotaState: QuotaState | null;
  isLoadingQuota: boolean;
  setTier: (tier: UserTier, expiresAt?: string | null) => void;
  awardReferral: (reason: "arena_4_player" | "pack_imports_3") => void;
  consumeRemixRun: () => boolean;
  refreshTier: () => Promise<UserTier>;
  refreshQuota: () => Promise<ClientQuotaSummary | null>;
  updateQuotaFromResponse: (quota: ClientQuotaSummary | null | undefined) => void;
}

export interface ProfileQuotaSummary {
  remainingPct: number;
  usedPct: number;
  quotaLabel: string;
  resetCountdown: string | null;
  statusTone: QuotaStatusTone;
  isDegraded: boolean;
  tierLabel: string;
  showUpgradeToSemesterPro: boolean;
}

function isValidClientQuota(quota: unknown): quota is ClientQuotaSummary {
  if (!quota || typeof quota !== "object") return false;
  const candidate = quota as Partial<ClientQuotaSummary>;
  return (
    typeof candidate.remainingPct === "number" &&
    Number.isFinite(candidate.remainingPct) &&
    typeof candidate.usedPct === "number" &&
    Number.isFinite(candidate.usedPct)
  );
}

function isSameQuota(
  a: ClientQuotaSummary | null,
  b: ClientQuotaSummary | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.remainingPct === b.remainingPct &&
    a.usedPct === b.usedPct &&
    a.resetsAt === b.resetsAt &&
    a.windowHours === b.windowHours &&
    a.bottleneckScope === b.bottleneckScope &&
    a.mode === b.mode
  );
}

/**
 * Broadcasts an updated rolling quota snapshot across mounted hook instances.
 */
export function broadcastQuotaUpdate(
  quota: ClientQuotaSummary | null | undefined,
): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  if (!isValidClientQuota(quota)) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ClientQuotaSummary>(QUOTA_UPDATED_EVENT, { detail: quota }),
  );
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
 * Pure helper that computes Antigravity-style rolling percentage quota summary,
 * tier labels, status tone, reset countdown, and upgrade CTA visibility.
 */
export function computeProfileQuotaSummary(
  tier: UserTier,
  quotaState?: ClientQuotaSummary | null,
  isVi: boolean = false,
  nowMs?: number,
): ProfileQuotaSummary {
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

  const hasValidQuota =
    quotaState !== null &&
    quotaState !== undefined &&
    typeof quotaState.remainingPct === "number" &&
    Number.isFinite(quotaState.remainingPct);

  const remainingPct = hasValidQuota
    ? Math.max(0, Math.min(100, Math.round(quotaState.remainingPct)))
    : 100;

  const usedPct =
    hasValidQuota &&
    typeof quotaState.usedPct === "number" &&
    Number.isFinite(quotaState.usedPct)
      ? Math.max(0, Math.min(100, Math.round(quotaState.usedPct)))
      : 100 - remainingPct;

  const quotaLabel = formatQuotaPercentBadge(remainingPct, isVi);
  const shouldShowReset = Boolean(quotaState?.resetsAt) || usedPct > 0;
  const resetCountdown = shouldShowReset
    ? formatQuotaResetCountdown(quotaState?.resetsAt, isVi, nowMs)
    : null;

  const statusTone: QuotaStatusTone =
    remainingPct > 30 ? "healthy" : remainingPct > 10 ? "caution" : "critical";

  const isNormalMode =
    !quotaState || quotaState.mode === "normal" || quotaState.mode === "full";
  const isDegraded = !isNormalMode || remainingPct <= 30;

  const showUpgradeToSemesterPro = tier !== "pro" && tier !== "tutor";

  return {
    remainingPct,
    usedPct,
    quotaLabel,
    resetCountdown,
    statusTone,
    isDegraded,
    tierLabel,
    showUpgradeToSemesterPro,
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
  const [quotaState, setQuotaState] = useState<QuotaState | null>(null);
  const [isLoadingQuota, setIsLoadingQuota] = useState<boolean>(false);
  const [referrals, setReferralsState] = useState<ReferralState>({
    unlockedRemixRuns: 0,
    friendsInvited: 0,
    roomsHostedWith4Players: 0,
    packsImportedByClassmates: 0,
  });
  const isMountedRef = useRef(true);

  // Sync state from authoritative cloud database
  const syncFromCloud = useCallback(async (): Promise<UserTier> => {
    const cloud = await fetchCloudUserTier();
    if (isMountedRef.current) {
      setTierState(cloud.tier);
      setTierExpiresAt(cloud.expiresAt);
    }
    return cloud.tier;
  }, []);

  const refreshQuota = useCallback(async (): Promise<ClientQuotaSummary | null> => {
    if (typeof window === "undefined" || typeof fetch !== "function") {
      return null;
    }

    if (isMountedRef.current) {
      setIsLoadingQuota(true);
    }

    try {
      const headers: Record<string, string> = {};
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          const accessToken = data?.session?.access_token;
          if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
          }
        } catch {
          // Proceed without bearer token when browser session lookup fails
        }
      }

      const res = await fetch("/api/quota", {
        method: "GET",
        cache: "no-store",
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json().catch(() => null);
      if (!data?.ok || !isValidClientQuota(data.quota)) {
        return null;
      }

      const nextQuota = data.quota;
      if (isMountedRef.current) {
        setQuotaState((prev) => (isSameQuota(prev, nextQuota) ? prev : nextQuota));
      }
      broadcastQuotaUpdate(nextQuota);
      return nextQuota;
    } catch {
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsLoadingQuota(false);
      }
    }
  }, []);

  const updateQuotaFromResponse = useCallback(
    (quota: ClientQuotaSummary | null | undefined): void => {
      if (!isValidClientQuota(quota)) {
        return;
      }
      if (isMountedRef.current) {
        setQuotaState((prev) => (isSameQuota(prev, quota) ? prev : quota));
      }
      broadcastQuotaUpdate(quota);
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    setReferralsState(getStoredReferralState());

    // Hydration check: prevent client tier spoofing when unauthenticated
    const initTier = async () => {
      const storedTier = getStoredUserTier();
      const storedExpires = getStoredTierExpires();

      const verified = await verifyAndClampClientTier(storedTier, storedExpires);
      if (!isMountedRef.current) return;

      setTierState(verified.tier);
      setTierExpiresAt(verified.expiresAt);

      // Fetch authoritative tier from Supabase (defaults to contender when unauthenticated)
      void syncFromCloud();
    };

    void initTier();
    void refreshQuota();

    const handleTierUpdated = async (e: Event) => {
      const custom = e as CustomEvent<{ tier: UserTier; expiresAt?: string | null }>;
      const incomingTier = custom.detail?.tier;
      if (!incomingTier) return;

      const verified = await verifyAndClampClientTier(incomingTier, custom.detail.expiresAt);
      if (!isMountedRef.current) return;

      setTierState(verified.tier);
      setTierExpiresAt(verified.expiresAt);
    };

    const handleReferralsUpdated = (e: Event) => {
      const custom = e as CustomEvent<ReferralState>;
      if (custom.detail && isMountedRef.current) {
        setReferralsState(custom.detail);
      }
    };

    const handleQuotaUpdated = (e: Event) => {
      const custom = e as CustomEvent<ClientQuotaSummary>;
      if (!isMountedRef.current || !isValidClientQuota(custom.detail)) return;
      const incoming = custom.detail;
      setQuotaState((prev) => (isSameQuota(prev, incoming) ? prev : incoming));
    };

    const hasWindow = typeof window !== "undefined";
    if (hasWindow && typeof window.addEventListener === "function") {
      window.addEventListener("clutch:tier_updated", handleTierUpdated);
      window.addEventListener("clutch:referrals_updated", handleReferralsUpdated);
      window.addEventListener(QUOTA_UPDATED_EVENT, handleQuotaUpdated);
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
          void refreshQuota();
        } else if (event === "SIGNED_OUT" || !session?.user) {
          clearStoredUserTier();
          if (isMountedRef.current) {
            setTierState("contender");
            setTierExpiresAt(null);
          }
          void refreshQuota();
        }
      });
      authUnsubscribe = () => subscription.unsubscribe();
    }

    return () => {
      isMountedRef.current = false;
      if (hasWindow && typeof window.removeEventListener === "function") {
        window.removeEventListener("clutch:tier_updated", handleTierUpdated);
        window.removeEventListener("clutch:referrals_updated", handleReferralsUpdated);
        window.removeEventListener(QUOTA_UPDATED_EVENT, handleQuotaUpdated);
      }
      if (authUnsubscribe) authUnsubscribe();
    };
  }, [syncFromCloud, refreshQuota]);

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
    quotaState,
    isLoadingQuota,
    setTier,
    awardReferral,
    consumeRemixRun,
    refreshTier: syncFromCloud,
    refreshQuota,
    updateQuotaFromResponse,
  };
}
