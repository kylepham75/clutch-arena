"use client";

import { useEffect, useState, useCallback } from "react";
import {
  type UserTier,
  type TierLimits,
  type ReferralState,
  TIER_LIMITS,
  getStoredUserTier,
  setStoredUserTier,
  getStoredReferralState,
  awardReferralPass,
  consumeUnlockedRemixRun,
} from "@/lib/pricing/tiers";

export interface UserTierHook {
  tier: UserTier;
  limits: TierLimits;
  isPaidTier: boolean;
  isCramPassOrAbove: boolean;
  isProOrAbove: boolean;
  isTutor: boolean;
  referrals: ReferralState;
  unlockedRemixRuns: number;
  setTier: (tier: UserTier) => void;
  awardReferral: (reason: "arena_4_player" | "pack_imports_3") => void;
  consumeRemixRun: () => boolean;
}

export function useUserTier(): UserTierHook {
  const [tier, setTierState] = useState<UserTier>("contender");
  const [referrals, setReferralsState] = useState<ReferralState>({
    unlockedRemixRuns: 0,
    friendsInvited: 0,
    roomsHostedWith4Players: 0,
    packsImportedByClassmates: 0,
  });

  useEffect(() => {
    setTierState(getStoredUserTier());
    setReferralsState(getStoredReferralState());

    const handleTierUpdated = (e: Event) => {
      const custom = e as CustomEvent<{ tier: UserTier }>;
      if (custom.detail?.tier) {
        setTierState(custom.detail.tier);
      }
    };

    const handleReferralsUpdated = (e: Event) => {
      const custom = e as CustomEvent<ReferralState>;
      if (custom.detail) {
        setReferralsState(custom.detail);
      }
    };

    window.addEventListener("clutch:tier_updated", handleTierUpdated);
    window.addEventListener("clutch:referrals_updated", handleReferralsUpdated);

    return () => {
      window.removeEventListener("clutch:tier_updated", handleTierUpdated);
      window.removeEventListener("clutch:referrals_updated", handleReferralsUpdated);
    };
  }, []);

  const setTier = useCallback((newTier: UserTier) => {
    setStoredUserTier(newTier);
    setTierState(newTier);
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

  const limits = TIER_LIMITS[tier] || TIER_LIMITS.contender;
  const isPaidTier = tier !== "contender";
  const isCramPassOrAbove = isPaidTier;
  const isProOrAbove = tier === "pro" || tier === "tutor";
  const isTutor = tier === "tutor";

  return {
    tier,
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
  };
}
