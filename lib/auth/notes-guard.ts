import "server-only";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import type { User } from "@supabase/supabase-js";

export interface ProVerificationResult {
  authorized: boolean;
  user?: User;
  tier?: string;
  reason?: "UNAUTHENTICATED" | "PRO_REQUIRED" | "PAID_TIER_REQUIRED";
  message?: string;
}

/**
 * Checks if a given tier identifier is eligible for Clutch Notes AI.
 * Authorized tiers: Cram Pass ("cram_pass"), Pro ("pro"), Tutor ("tutor").
 */
export function isAuthorizedForNotes(tierString?: string | null): boolean {
  if (!tierString) return false;
  const t = tierString.toLowerCase().trim();
  return (
    t === "cram_pass" ||
    t === "crampass" ||
    t === "cram-pass" ||
    t === "pro" ||
    t === "tutor"
  );
}

/**
 * Validates that an incoming request is from an authenticated user
 * with an active paid subscription (Cram Pass, Pro, or Tutor).
 */
export async function verifyProAccess(request: Request): Promise<ProVerificationResult> {
  // Allow test mock bypass if requested in unit tests
  const testTierHeader = request.headers.get("x-test-tier");
  if (process.env.NODE_ENV === "test" && testTierHeader) {
    const isAuthTier = isAuthorizedForNotes(testTierHeader);
    if (isAuthTier) {
      const normalizedTier = testTierHeader.toLowerCase().includes("cram")
        ? "cram_pass"
        : testTierHeader.toLowerCase() === "tutor"
          ? "tutor"
          : "pro";
      return {
        authorized: true,
        tier: normalizedTier,
        user: { id: `test-user-${normalizedTier}-id`, email: `${normalizedTier}@example.com` } as User,
      };
    }
    return {
      authorized: false,
      tier: testTierHeader,
      reason: "PRO_REQUIRED",
      message:
        "Clutch Notes AI is exclusively for 7-Day Cram Pass, Pro Tier members, and Tutors. Upgrade to unlock slide deck conversions.",
    };
  }

  const auth = await verifyAuthToken(request);

  if (!auth.authenticated) {
    // In local development mode, allow testTierHeader as fallback if authenticated token was not yet refreshed
    if (process.env.NODE_ENV === "development" && testTierHeader) {
      const isAuthTier = isAuthorizedForNotes(testTierHeader);
      if (isAuthTier) {
        const normalizedTier = testTierHeader.toLowerCase().includes("cram")
          ? "cram_pass"
          : testTierHeader.toLowerCase() === "tutor"
            ? "tutor"
            : "pro";
        return {
          authorized: true,
          tier: normalizedTier,
          user: { id: `dev-user-${normalizedTier}`, email: `${normalizedTier}@example.com` } as User,
        };
      }
    }

    return {
      authorized: false,
      reason: "UNAUTHENTICATED",
      message: "Authentication required. Please sign in to access Clutch Notes AI.",
    };
  }

  const tier = auth.tier;
  const appMetaTier = (auth.user?.app_metadata?.tier as string | undefined) ?? "";
  const userMetaTier = (auth.user?.user_metadata?.tier as string | undefined) ?? "";

  const isAuthTier =
    isAuthorizedForNotes(tier) ||
    isAuthorizedForNotes(appMetaTier) ||
    isAuthorizedForNotes(userMetaTier);

  if (!isAuthTier) {
    // In dev mode, check if client supplied a valid paid tier header
    if (process.env.NODE_ENV === "development" && testTierHeader && isAuthorizedForNotes(testTierHeader)) {
      return {
        authorized: true,
        user: auth.user,
        tier: testTierHeader.toLowerCase(),
      };
    }

    return {
      authorized: false,
      user: auth.user,
      tier,
      reason: "PRO_REQUIRED",
      message:
        "Clutch Notes AI is exclusively for 7-Day Cram Pass, Pro Tier members, and Tutors. Upgrade to unlock slide deck conversions.",
    };
  }

  return {
    authorized: true,
    user: auth.user,
    tier,
  };
}
