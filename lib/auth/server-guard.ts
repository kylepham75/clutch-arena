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
      tier: ServerTier;
      devMode: boolean;
    };

export function isTestTierAllowed(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test" ||
    process.env.ALLOW_TEST_TIER_OVERRIDE === "true"
  );
}

export async function verifyAuthToken(request: Request): Promise<AuthVerificationResult> {
  const isConfigured = isSupabaseServerConfigured();
  const testTierAllowed = isTestTierAllowed();
  const testTierHeader = testTierAllowed ? request.headers.get("x-test-tier") : null;
  const normalizedTestTier = testTierHeader ? normalizeTier(testTierHeader) : null;
  const isAuthorizedTestTier = Boolean(normalizedTestTier && normalizedTestTier !== "contender");

  if (!isConfigured) {
    // If Supabase is not configured, permit dev/offline guest runs seamlessly
    return {
      authenticated: false,
      isGuest: true,
      tier: isAuthorizedTestTier ? (normalizedTestTier as UserTier) : "guest",
      devMode: true,
    };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authenticated: false,
      isGuest: true,
      tier: isAuthorizedTestTier ? (normalizedTestTier as UserTier) : "guest",
      devMode: false,
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return {
      authenticated: false,
      isGuest: true,
      tier: isAuthorizedTestTier ? (normalizedTestTier as UserTier) : "guest",
      devMode: false,
    };
  }

  try {
    const supabase = getSupabaseServerClient(token);
    if (!supabase) {
      return {
        authenticated: false,
        isGuest: true,
        tier: isAuthorizedTestTier ? (normalizedTestTier as UserTier) : "guest",
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
        tier: isAuthorizedTestTier ? (normalizedTestTier as UserTier) : "guest",
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

    // 4. Fallback to user metadata
    if (resolvedTier === "contender") {
      const metaTier =
        (user.app_metadata?.tier as string | undefined) ||
        (user.user_metadata?.tier as string | undefined);
      if (metaTier) {
        const normMeta = normalizeTier(metaTier);
        if (normMeta !== "contender") {
          resolvedTier = normMeta;
        }
      }
    }

    // 5. Fallback to x-test-tier header for early-access tester sessions
    if (resolvedTier === "contender" && isAuthorizedTestTier && normalizedTestTier) {
      resolvedTier = normalizedTestTier;
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
      tier: isAuthorizedTestTier ? (normalizedTestTier as UserTier) : "guest",
      devMode: false,
    };
  }
}

export function normalizeTier(raw: unknown): UserTier {
  if (typeof raw !== "string") return "contender";
  const t = raw.toLowerCase().trim();
  if (t === "cram_pass" || t === "crampass" || t === "cram-pass") return "cram_pass";
  if (t === "pro") return "pro";
  if (t === "tutor") return "tutor";
  return "contender";
}
