import "server-only";
import { getSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import { calculateTierExpiration, type UserTier } from "@/lib/pricing/tiers";

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

  let token: string | null = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.replace(/^Bearer\s+/i, "").trim();
  }

  if (!token) {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const parts = cookieHeader.split(";");
      for (const part of parts) {
        const [rawKey, ...rawVal] = part.trim().split("=");
        if (rawKey && rawKey.includes("-auth-token")) {
          const val = decodeURIComponent(rawVal.join("="));
          try {
            const parsed = JSON.parse(val);
            if (parsed && typeof parsed.access_token === "string") {
              token = parsed.access_token;
              break;
            }
            if (Array.isArray(parsed) && parsed[0]?.access_token) {
              token = parsed[0].access_token;
              break;
            }
          } catch {
            // Check if base64 encoded
            try {
              const decoded = Buffer.from(val, "base64").toString("utf-8");
              const parsed = JSON.parse(decoded);
              if (parsed?.access_token) {
                token = parsed.access_token;
                break;
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }
  }

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
      const isSubExpired = subData.expires_at
        ? !isNaN(new Date(subData.expires_at).getTime()) &&
          new Date(subData.expires_at).getTime() <= Date.now()
        : false;

      if (!isSubExpired) {
        resolvedTier = normalizeTier(subData.tier);
        resolvedExpiresAt = subData.expires_at ?? null;
      }
      // If elapsed/expired, do not resolve tier to 'contender' immediately.
      // Instead, allow fallback to step 2 (profiles table) so an active tier set on profiles
      // by an admin is not shadowed by an old expired subscription!
    }

    if (resolvedTier === "contender") {
      // 2. Fallback to profiles table
      const { data: profileData } = await supabase
        .from("profiles")
        .select("tier, tier_expires_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profileData?.tier) {
        const normTier = normalizeTier(profileData.tier);
        if (normTier !== "contender") {
          let isActive = false;
          let tierExpiresAt: string | null = profileData.tier_expires_at ?? null;

          if (!profileData.tier_expires_at) {
            // Null tier_expires_at: treat as active (non-expiring / manual admin grant)
            isActive = true;
            tierExpiresAt = null;
          } else {
            const expMs = new Date(profileData.tier_expires_at).getTime();
            const isExpired = !isNaN(expMs) && expMs <= Date.now();

            if (!isExpired) {
              isActive = true;
              tierExpiresAt = profileData.tier_expires_at;
            } else if (
              profileData.updated_at &&
              new Date(profileData.updated_at).getTime() > expMs
            ) {
              // Active manual grant updated after the previous expiration
              isActive = true;
              tierExpiresAt = calculateTierExpiration(normTier);
            }
          }

          if (isActive) {
            resolvedTier = normTier;
            resolvedExpiresAt = tierExpiresAt;
          }
        }
      }
    }

    if (resolvedTier === "contender") {
      // 3. Fallback to user_profiles table
      const { data: userProfileData } = await supabase
        .from("user_profiles")
        .select("tier, tier_expires_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (userProfileData?.tier) {
        const normTier = normalizeTier(userProfileData.tier);
        if (normTier !== "contender") {
          let isActive = false;
          let tierExpiresAt: string | null = userProfileData.tier_expires_at ?? null;

          if (!userProfileData.tier_expires_at) {
            isActive = true;
            tierExpiresAt = null;
          } else {
            const expMs = new Date(userProfileData.tier_expires_at).getTime();
            const isExpired = !isNaN(expMs) && expMs <= Date.now();

            if (!isExpired) {
              isActive = true;
              tierExpiresAt = userProfileData.tier_expires_at;
            } else if (
              userProfileData.updated_at &&
              new Date(userProfileData.updated_at).getTime() > expMs
            ) {
              isActive = true;
              tierExpiresAt = calculateTierExpiration(normTier);
            }
          }

          if (isActive) {
            resolvedTier = normTier;
            resolvedExpiresAt = tierExpiresAt;
          }
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
