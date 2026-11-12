import "server-only";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { normalizeTier } from "@/lib/pricing/tiers";
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
 * Under the unified Antigravity-style rolling quota, all signed-in tiers
 * (Free Contender inside 3d rolling % quota + Paid Cram Pass / Pro / Tutor) are authorized.
 * Anonymous "guest" actors remain blocked until signed in.
 */
export function isAuthorizedForNotes(tierString?: string | null): boolean {
  if (!tierString) return false;
  const t = tierString.toLowerCase().trim();
  return (
    t === "contender" ||
    t === "free" ||
    t === "cram_pass" ||
    t === "crampass" ||
    t === "cram-pass" ||
    t === "pro" ||
    t === "pro_monthly" ||
    t === "pro-monthly" ||
    t === "pro_semester" ||
    t === "pro-semester" ||
    t === "semester" ||
    t === "tutor" ||
    t === "tutor_guild" ||
    t === "tutor-guild"
  );
}

/**
 * Determines if x-test-tier client override is permitted.
 * Strictly limited to development, automated test suites, or explicit operator opt-in.
 * In production, client headers can NEVER bypass authentication without explicit opt-in.
 */
export function isTestTierAllowed(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test" ||
    process.env.ALLOW_TEST_TIER_OVERRIDE === "true"
  );
}

/**
 * Validates that an incoming request is from an authenticated user (Contender or Paid tier)
 * permitted to run Clutch Notes synthesis inside their unified rolling % quota.
 */
export async function verifyNotesAccess(request: Request): Promise<ProVerificationResult> {
  const testTierAllowed = isTestTierAllowed();
  const testTierHeader = testTierAllowed ? request.headers.get("x-test-tier") : null;

  // 1. If explicit client/test tier header is passed (dev/test identity)
  if (testTierHeader) {
    const isAuthTier = isAuthorizedForNotes(testTierHeader);
    if (!isAuthTier) {
      return {
        authorized: false,
        tier: testTierHeader,
        reason: "UNAUTHENTICATED",
        message: "Authentication required. Please sign in to access Clutch Notes AI.",
      };
    }

    const normalizedTier = normalizeTier(testTierHeader);

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

  if (!isAuthorizedForNotes(tier)) {
    return {
      authorized: false,
      user: auth.user,
      tier,
      reason: "UNAUTHENTICATED",
      message: "Authentication required. Please sign in to access Clutch Notes AI.",
    };
  }

  return {
    authorized: true,
    user: auth.user,
    tier,
  };
}

export const verifyProAccess = verifyNotesAccess;
