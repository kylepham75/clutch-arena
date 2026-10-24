import "server-only";
import { getSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import type { UserTier } from "@/lib/pricing/tiers";

export type ServerTier = "guest" | UserTier;

export type AuthVerificationResult =
  | {
      authenticated: true;
      user: User;
      tier: UserTier;
      tierExpiresAt: string | null;
    }
  | {
      authenticated: false;
      isGuest: true;
      tier: "guest";
      devMode: boolean;
    };

export async function verifyAuthToken(request: Request): Promise<AuthVerificationResult> {
  const isConfigured = isSupabaseServerConfigured();
  if (!isConfigured) {
    // If Supabase is not configured, permit dev/offline guest runs seamlessly
    return {
      authenticated: false,
      isGuest: true,
      tier: "guest",
      devMode: true,
    };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authenticated: false,
      isGuest: true,
      tier: "guest",
      devMode: false,
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return {
      authenticated: false,
      isGuest: true,
      tier: "guest",
      devMode: false,
    };
  }

  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return {
        authenticated: false,
        isGuest: true,
        tier: "guest",
        devMode: true,
      };
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return {
        authenticated: false,
        isGuest: true,
        tier: "guest",
        devMode: false,
      };
    }

    let resolvedTier: UserTier = "contender";
    let resolvedExpiresAt: string | null = null;

    // 1. Check active subscriptions table
    const { data: subData } = await supabase
      .from("user_subscriptions")
      .select("tier, expires_at, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subData?.tier) {
      resolvedTier = normalizeTier(subData.tier);
      resolvedExpiresAt = subData.expires_at ?? null;
    } else {
      // 2. Fallback to profiles table
      const { data: profileData } = await supabase
        .from("profiles")
        .select("tier, tier_expires_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profileData?.tier) {
        resolvedTier = normalizeTier(profileData.tier);
        resolvedExpiresAt = profileData.tier_expires_at ?? null;
      } else {
        // 3. Fallback to user_profiles table
        const { data: userProfileData } = await supabase
          .from("user_profiles")
          .select("tier, tier_expires_at")
          .eq("id", user.id)
          .maybeSingle();

        if (userProfileData?.tier) {
          resolvedTier = normalizeTier(userProfileData.tier);
          resolvedExpiresAt = userProfileData.tier_expires_at ?? null;
        }
      }
    }

    if (resolvedExpiresAt) {
      const expMs = new Date(resolvedExpiresAt).getTime();
      if (!isNaN(expMs) && expMs <= Date.now()) {
        resolvedTier = "contender";
        resolvedExpiresAt = null;
      }
    }

    return {
      authenticated: true,
      user,
      tier: resolvedTier,
      tierExpiresAt: resolvedExpiresAt,
    };
  } catch {
    return {
      authenticated: false,
      isGuest: true,
      tier: "guest",
      devMode: false,
    };
  }
}

function normalizeTier(raw: unknown): UserTier {
  if (raw === "cram_pass" || raw === "pro" || raw === "tutor") return raw;
  return "contender";
}
