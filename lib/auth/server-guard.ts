import "server-only";
import {
  getSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import { getSupabaseAdminOrServerClient } from "@/lib/supabase/server-helpers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  isTierExpired,
  normalizeTier,
  resolveTierFromProfileRecord,
  type UserTier,
} from "@/lib/pricing/tiers";

function resolveAuthLookupAdminClient(fallbackUserClient: SupabaseClient): SupabaseClient {
  return getSupabaseAdminOrServerClient() ?? fallbackUserClient;
}

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

export function isTestTierAllowed(request?: Request): boolean {
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  const secret = process.env.TEST_TIER_OVERRIDE_SECRET?.trim();
  if (secret) {
    if (!request || request.headers.get("x-test-tier-secret") !== secret) {
      return false;
    }
  }
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test" ||
    process.env.ALLOW_TEST_TIER_OVERRIDE === "true"
  );
}

export async function verifyAuthToken(request: Request): Promise<AuthVerificationResult> {
  const isConfigured = isSupabaseServerConfigured();
  const testTierAllowed = isTestTierAllowed(request);
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

    const dbClient = resolveAuthLookupAdminClient(supabase);
    let resolvedTier: UserTier = "contender";
    let resolvedExpiresAt: string | null = null;
    let isRevokedSubscription = false;
    let revokedAtMs: number | null = null;

    // 1. Check latest subscription record across all statuses so revocations/refunds
    // prevent stale derived copies (profiles/user_profiles/app_metadata) from re-elevating.
    const { data: subData } = await dbClient
      .from("user_subscriptions")
      .select("tier, expires_at, status, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subData) {
      const statusStr =
        typeof subData.status === "string"
          ? subData.status.toLowerCase().trim()
          : "active";
      if (
        statusStr === "revoked" ||
        statusStr === "refunded" ||
        statusStr === "cancelled"
      ) {
        isRevokedSubscription = true;
        const revIso =
          (subData as { updated_at?: string; created_at?: string }).updated_at ||
          (subData as { created_at?: string }).created_at;
        if (revIso) {
          const parsedRev = Date.parse(revIso);
          if (Number.isFinite(parsedRev)) {
            revokedAtMs = parsedRev;
          }
        }
      } else if (subData.tier) {
        const isSubExpired = isTierExpired(subData.expires_at);
        if (!isSubExpired) {
          resolvedTier = normalizeTier(subData.tier);
          resolvedExpiresAt = subData.expires_at ?? null;
        }
        // If status === "active" has elapsed/expired, allow fallback to profiles so an
        // admin grant on profiles is not shadowed by an old expired subscription.
      }
    }

    let hasDbProfile = false;

    if (resolvedTier === "contender") {
      // 2. Fallback to profiles table
      const { data: profileData, error: profileError } = await dbClient
        .from("profiles")
        .select("tier, tier_expires_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError && (profileError as { code?: string }).code !== "PGRST116") {
        // Transient DB errors must not fall through to stale derived copies
        hasDbProfile = true;
      } else if (profileData) {
        hasDbProfile = true;
        const profileUpdatedMs = profileData.updated_at
          ? Date.parse(profileData.updated_at)
          : NaN;
        const allowProfileAfterRevocation =
          !isRevokedSubscription ||
          (revokedAtMs !== null &&
            Number.isFinite(profileUpdatedMs) &&
            profileUpdatedMs > revokedAtMs);
        if (allowProfileAfterRevocation) {
          const profileResolved = resolveTierFromProfileRecord(profileData);
          if (profileResolved) {
            resolvedTier = profileResolved.tier;
            resolvedExpiresAt = profileResolved.expiresAt;
          }
        }
      }
    }

    if (resolvedTier === "contender" && !hasDbProfile && !isRevokedSubscription) {
      // 3. Fallback to user_profiles table
      const { data: userProfileData, error: userProfileError } = await dbClient
        .from("user_profiles")
        .select("tier, tier_expires_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (userProfileError && (userProfileError as { code?: string }).code !== "PGRST116") {
        hasDbProfile = true;
      } else if (userProfileData) {
        hasDbProfile = true;
        const userProfileResolved = resolveTierFromProfileRecord(userProfileData);
        if (userProfileResolved) {
          resolvedTier = userProfileResolved.tier;
          resolvedExpiresAt = userProfileResolved.expiresAt;
        }
      }
    }

    // 4. Fallback to app_metadata (never user_metadata, which is client-writable)
    if (resolvedTier === "contender" && !hasDbProfile && !isRevokedSubscription) {
      const appMetaTier = (user.app_metadata as Record<string, unknown>)?.tier;
      const appMetaExpiresAt = (user.app_metadata as Record<string, unknown>)?.tier_expires_at;

      if (typeof appMetaTier === "string") {
        const metaResolved = resolveTierFromProfileRecord({
          tier: appMetaTier,
          tier_expires_at: typeof appMetaExpiresAt === "string" ? appMetaExpiresAt : null,
        });

        if (metaResolved) {
          resolvedTier = metaResolved.tier;
          resolvedExpiresAt = metaResolved.expiresAt;
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
