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

  const daysRemaining = tierExpiresAt
    ? Math.max(0, Math.ceil((new Date(tierExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
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
