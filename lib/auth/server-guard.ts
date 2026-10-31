import "server-only";
import { getSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import {
  isTierExpired,
  normalizeTier,
  resolveTierFromProfileRecord,
  type UserTier,
} from "@/lib/pricing/tiers";

export { normalizeTier } from "@/lib/pricing/tiers";

export type ServerTier = "guest" | UserTier;

export type AuthVerificationResult =
  | {
      authenticated: true;
      user: User;
      token?: string;
      tier: UserTier;
      tierExpiresAt: string | null;
    }
  | {
      authenticated: false;
      isGuest: true;
      tier: ServerTier;
      devMode: boolean;
    };

export function extractAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }

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
            return parsed.access_token;
          }
          if (Array.isArray(parsed) && parsed[0]?.access_token) {
            return parsed[0].access_token;
          }
        } catch {
          // Check if base64 encoded
          try {
            const decoded = Buffer.from(val, "base64").toString("utf-8");
            const parsed = JSON.parse(decoded);
            if (parsed?.access_token) {
              return parsed.access_token;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  return null;
}

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

  const token = extractAuthToken(request);

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
      const isSubExpired = isTierExpired(subData.expires_at);

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

      const profileResolved = resolveTierFromProfileRecord(profileData);
      if (profileResolved) {
        resolvedTier = profileResolved.tier;
        resolvedExpiresAt = profileResolved.expiresAt;
      }
    }

    if (resolvedTier === "contender") {
      // 3. Fallback to user_profiles table
      const { data: userProfileData } = await supabase
        .from("user_profiles")
        .select("tier, tier_expires_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      const userProfileResolved = resolveTierFromProfileRecord(userProfileData);
      if (userProfileResolved) {
        resolvedTier = userProfileResolved.tier;
        resolvedExpiresAt = userProfileResolved.expiresAt;
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

    if (isTierExpired(resolvedExpiresAt)) {
      resolvedTier = "contender";
      resolvedExpiresAt = null;
    }

    return {
      authenticated: true,
      user,
      token,
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
