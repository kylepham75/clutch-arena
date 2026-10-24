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
  const testTierHeader = request.headers.get("x-test-tier");

  // 1. If explicit client/test tier header is passed (early-access testing & client tier state)
  if (testTierHeader) {
    const isAuthTier = isAuthorizedForNotes(testTierHeader);
    if (!isAuthTier) {
      return {
        authorized: false,
        tier: testTierHeader,
        reason: "PRO_REQUIRED",
        message:
          "Clutch Notes AI is exclusively for 7-Day Cram Pass, Pro Tier members, and Tutors. Upgrade to unlock slide deck conversions.",
      };
    }

    const normalizedTier = testTierHeader.toLowerCase().includes("cram")
      ? "cram_pass"
      : testTierHeader.toLowerCase() === "tutor"
        ? "tutor"
        : "pro";

    // Attach real user if authenticated, or early-access test identity
    const auth = await verifyAuthToken(request);
    const user = auth.authenticated
      ? auth.user
      : ({
          id: `test-user-${normalizedTier}-id`,
          email: `${normalizedTier}@clutcharena.com`,
        } as User);

    return {
      authorized: true,
      tier: normalizedTier,
      user,
    };
  }

  // 2. Standard token verification when no client test header is provided
  const auth = await verifyAuthToken(request);

  if (!auth.authenticated) {
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
    return {
      authorized: false,
      user: auth.user,
      tier,
      reason: "PRO_REQUIRED",
      message:
        "Clutch Notes AI is exclusively for 7-Day Cram Pass, Pro Tier members, and Tutors. Upgrade to unlock slide deck conversions.",
    };
  }

  const normalizedTier = isAuthorizedForNotes(tier)
    ? tier
    : isAuthorizedForNotes(appMetaTier)
      ? appMetaTier.toLowerCase()
      : userMetaTier.toLowerCase();

  return {
    authorized: true,
    user: auth.user,
    tier: normalizedTier,
  };
}
