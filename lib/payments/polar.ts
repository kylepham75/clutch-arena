import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import {
  calculateTierExpiration,
  normalizeTier,
  type UserTier,
} from "@/lib/pricing/tiers";
import {
  getSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import { resolveTrustedPayosOrigin } from "@/lib/payments/payos";

export type UsdPlanId =
  | "cram_pass"
  | "pro_monthly"
  | "pro"
  | "pro_semester"
  | "tutor"
  | "tutor_guild";

export type UsdProvider = "polar" | "lemonsqueezy";

export const EXPECTED_PLAN_AMOUNTS_USD: Record<UsdPlanId, number> = {
  cram_pass: 4.99,
  pro_monthly: 9.99,
  pro: 29.0,
  pro_semester: 29.0,
  tutor: 24.99,
  tutor_guild: 24.99,
};

export const EXPECTED_PLAN_AMOUNTS_CENTS: Record<UsdPlanId, number> = {
  cram_pass: 499,
  pro_monthly: 999,
  pro: 2900,
  pro_semester: 2900,
  tutor: 2499,
  tutor_guild: 2499,
};

export function mapUsdPlanToUserTier(
  planId: UsdPlanId,
): "cram_pass" | "pro_monthly" | "pro" | "tutor" {
  if (planId === "cram_pass") return "cram_pass";
  if (planId === "pro_monthly") return "pro_monthly";
  if (planId === "tutor" || planId === "tutor_guild") return "tutor";
  return "pro";
}

export function mapUsdPlanToCycle(
  planId: UsdPlanId,
): "one_time" | "monthly" | "semester" {
  if (planId === "cram_pass") return "one_time";
  if (planId === "pro_monthly" || planId === "tutor" || planId === "tutor_guild") {
    return "monthly";
  }
  return "semester";
}

const fulfilledUsdOrderCache = new Map<
  string,
  {
    userId: string;
    tier: "cram_pass" | "pro_monthly" | "pro" | "tutor";
    expiresAt: string;
    amountUsd: number;
  }
>();

/**
 * Clears the in-memory fulfilled USD order cache (used primarily in test harnesses).
 */
export function clearFulfilledUsdOrderCache(): void {
  fulfilledUsdOrderCache.clear();
}

/**
 * Checks whether Polar.sh or Lemon Squeezy environment variables are configured.
 */
export function isUsdCheckoutConfigured(): boolean {
  if (process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED === "true") return true;
  if (Boolean(process.env.POLAR_ACCESS_TOKEN?.trim())) return true;
  if (Boolean(process.env.LEMONSQUEEZY_API_KEY?.trim())) return true;
  if (Boolean(process.env.POLAR_CHECKOUT_BASE_URL?.trim())) return true;
  if (Boolean(process.env.LEMONSQUEEZY_CHECKOUT_BASE_URL?.trim())) return true;

  const envKeys = Object.keys(process.env);
  return envKeys.some(
    (k) =>
      (k.startsWith("POLAR_CHECKOUT_URL_") ||
        k.startsWith("LEMONSQUEEZY_CHECKOUT_URL_") ||
        k.startsWith("POLAR_PRODUCT_ID")) &&
      Boolean(process.env[k]?.trim()),
  );
}

export interface CreateUsdCheckoutSessionInput {
  planId: UsdPlanId;
  userId: string;
  userEmail?: string;
  origin: string;
  userToken?: string;
}

export interface UsdCheckoutSessionResult {
  checkoutId: string;
  checkoutUrl: string;
  provider: UsdProvider;
  planId: UsdPlanId;
  amountUsd: number;
  currency: "USD";
}

/**
 * Generates a unique safe identifier for USD checkouts.
 */
function generateUsdCheckoutId(provider: UsdProvider): string {
  const rand = randomBytes(6).toString("hex");
  return `${provider}_chk_${Date.now()}_${rand}`;
}

/**
 * Creates a USD checkout session via Polar.sh (or Lemon Squeezy / configured URL)
 * and records a pending subscription record in Supabase.
 */
export async function createUsdCheckoutSession(
  input: CreateUsdCheckoutSessionInput,
): Promise<UsdCheckoutSessionResult> {
  if (!(input.planId in EXPECTED_PLAN_AMOUNTS_USD)) {
    throw new Error(`Invalid USD plan ID: "${input.planId}"`);
  }

  const trustedOrigin = resolveTrustedPayosOrigin(input.origin);
  const amountUsd = EXPECTED_PLAN_AMOUNTS_USD[input.planId];
  const userTier = mapUsdPlanToUserTier(input.planId);
  const cycle = mapUsdPlanToCycle(input.planId);

  // Determine provider: prefer lemonsqueezy if only lemonsqueezy env vars are set, else polar
  const hasLemonOnly =
    (Boolean(process.env.LEMONSQUEEZY_API_KEY?.trim()) ||
      Boolean(process.env.LEMONSQUEEZY_CHECKOUT_BASE_URL?.trim())) &&
    !process.env.POLAR_ACCESS_TOKEN?.trim() &&
    !process.env.POLAR_CHECKOUT_BASE_URL?.trim();
  const provider: UsdProvider = hasLemonOnly ? "lemonsqueezy" : "polar";

  let checkoutId = generateUsdCheckoutId(provider);
  let checkoutUrl = "";

  // 1. Try Polar API if POLAR_ACCESS_TOKEN is configured
  const polarToken = process.env.POLAR_ACCESS_TOKEN?.trim();
  if (polarToken && provider === "polar") {
    const planKey = input.planId.toUpperCase();
    let productId = process.env[`POLAR_PRODUCT_ID_${planKey}`]?.trim();
    if (!productId) {
      if (input.planId === "pro_semester") {
        productId = process.env.POLAR_PRODUCT_ID_PRO?.trim();
      } else if (input.planId === "tutor_guild") {
        productId = process.env.POLAR_PRODUCT_ID_TUTOR?.trim();
      }
    }
    if (!productId) {
      productId = process.env.POLAR_PRODUCT_ID?.trim();
    }

    if (productId) {
      try {
        const isSandbox = process.env.POLAR_SANDBOX === "true";
        const polarApiBase = isSandbox
          ? "https://sandbox-api.polar.sh/v1/checkouts/"
          : "https://api.polar.sh/v1/checkouts/";

        const res = await fetch(polarApiBase, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${polarToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            product_id: productId,
            success_url: `${trustedOrigin}/?payment=success&provider=polar&checkoutId=${checkoutId}`,
            customer_email: input.userEmail,
            metadata: {
              userId: input.userId,
              planId: input.planId,
              checkoutId,
              amountUsd,
            },
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as { id?: string; url?: string; checkout_url?: string };
          if (data?.url || data?.checkout_url) {
            checkoutUrl = (data.url || data.checkout_url)!;
            if (data.id) {
              checkoutId = data.id;
            }
          }
        }
      } catch (err) {
        console.warn("[USD Checkout] Polar API checkout call failed, falling back to URL config:", err);
      }
    }
  }

  // 2. Direct checkout URL env vars (POLAR_CHECKOUT_URL_* / LEMONSQUEEZY_CHECKOUT_URL_*)
  if (!checkoutUrl) {
    const planKey = input.planId.toUpperCase();
    const envUrl =
      provider === "polar"
        ? (process.env[`POLAR_CHECKOUT_URL_${planKey}`]?.trim() ||
            process.env.POLAR_CHECKOUT_BASE_URL?.trim())
        : (process.env[`LEMONSQUEEZY_CHECKOUT_URL_${planKey}`]?.trim() ||
            process.env.LEMONSQUEEZY_CHECKOUT_BASE_URL?.trim());

    if (envUrl) {
      try {
        const urlObj = new URL(envUrl);
        urlObj.searchParams.set("checkout[custom][user_id]", input.userId);
        urlObj.searchParams.set("checkout[custom][plan_id]", input.planId);
        urlObj.searchParams.set("checkout[custom][checkout_id]", checkoutId);
        if (input.userEmail) {
          urlObj.searchParams.set("checkout[email]", input.userEmail);
        }
        urlObj.searchParams.set("reference_id", checkoutId);
        urlObj.searchParams.set(
          "success_url",
          `${trustedOrigin}/?payment=success&provider=${provider}&checkoutId=${checkoutId}`,
        );
        checkoutUrl = urlObj.toString();
      } catch {
        // Ignore URL parse error
      }
    }
  }

  // 3. Fallback URL for sandbox / test / mock environments
  if (!checkoutUrl) {
    const isSandbox = process.env.POLAR_SANDBOX === "true";
    const host = isSandbox ? "https://sandbox.polar.sh/checkout" : "https://polar.sh/checkout";
    const urlObj = new URL(`${host}/${checkoutId}`);
    urlObj.searchParams.set("user_id", input.userId);
    urlObj.searchParams.set("plan_id", input.planId);
    urlObj.searchParams.set("amount", String(amountUsd));
    if (input.userEmail) {
      urlObj.searchParams.set("email", input.userEmail);
    }
    urlObj.searchParams.set(
      "success_url",
      `${trustedOrigin}/?payment=success&provider=${provider}&checkoutId=${checkoutId}`,
    );
    checkoutUrl = urlObj.toString();
  }

  // 4. Persist pending subscription record in Supabase
  const supabase = getSupabaseServerClient(input.userToken);
  if (supabase) {
    try {
      await supabase.from("user_subscriptions").upsert({
        id: `usd_${checkoutId}`,
        user_id: input.userId,
        tier: userTier,
        cycle,
        amount: amountUsd,
        currency: "USD",
        payment_method: provider === "polar" ? "polar" : "lemonsqueezy",
        status: "pending",
        expires_at: calculateTierExpiration(input.planId),
      });
    } catch (err) {
      console.warn("[USD Checkout] Failed to persist pending subscription record:", err);
    }
  }

  return {
    checkoutId,
    checkoutUrl,
    provider,
    planId: input.planId,
    amountUsd,
    currency: "USD",
  };
}

/**
 * Verifies the USD webhook HMAC-SHA256 signature against the raw body text.
 * Supports Polar.sh (Standard Webhooks v1,<base64> and hex), Lemon Squeezy (x-signature hex),
 * and sha256=<hex> headers.
 */
export function verifyUsdWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret?: string,
): boolean {
  if (!rawBody || typeof rawBody !== "string") return false;
  if (!signatureHeader || typeof signatureHeader !== "string") return false;

  const webhookSecret =
    secret ??
    process.env.POLAR_WEBHOOK_SECRET ??
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET ??
    "";

  if (!webhookSecret.trim()) return false;

  // Compute reference HMAC digests using secret as utf-8 string
  const computedHex = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const computedBase64 = createHmac("sha256", webhookSecret).update(rawBody).digest("base64");

  // If secret starts with 'whsec_', standard webhooks often base64-decode the secret key
  let altHex: string | null = null;
  let altBase64: string | null = null;
  if (webhookSecret.startsWith("whsec_")) {
    try {
      const decodedKey = Buffer.from(webhookSecret.slice(6), "base64");
      if (decodedKey.length > 0) {
        altHex = createHmac("sha256", decodedKey).update(rawBody).digest("hex");
        altBase64 = createHmac("sha256", decodedKey).update(rawBody).digest("base64");
      }
    } catch {
      // Ignore decode error
    }
  }

  // Parse candidate signatures from header (may contain space/comma-separated multiple signatures or prefixes)
  const candidateParts = signatureHeader
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  for (const part of candidateParts) {
    let candidate = part;
    if (candidate.startsWith("sha256=")) {
      candidate = candidate.slice(7);
    } else if (candidate.startsWith("v1=")) {
      candidate = candidate.slice(3);
    } else if (candidate.startsWith("v1,")) {
      candidate = candidate.slice(3);
    }

    // Try hex comparison
    const sigBuf = Buffer.from(candidate.toLowerCase(), "utf-8");
    const compHexBuf = Buffer.from(computedHex.toLowerCase(), "utf-8");
    if (sigBuf.length === compHexBuf.length && timingSafeEqual(sigBuf, compHexBuf)) {
      return true;
    }

    if (altHex) {
      const altHexBuf = Buffer.from(altHex.toLowerCase(), "utf-8");
      if (sigBuf.length === altHexBuf.length && timingSafeEqual(sigBuf, altHexBuf)) {
        return true;
      }
    }

    // Try base64 comparison
    const rawSigBuf = Buffer.from(candidate, "utf-8");
    const compB64Buf = Buffer.from(computedBase64, "utf-8");
    if (rawSigBuf.length === compB64Buf.length && timingSafeEqual(rawSigBuf, compB64Buf)) {
      return true;
    }

    if (altBase64) {
      const altB64Buf = Buffer.from(altBase64, "utf-8");
      if (rawSigBuf.length === altB64Buf.length && timingSafeEqual(rawSigBuf, altB64Buf)) {
        return true;
      }
    }
  }

  return false;
}

export interface FulfillUsdOrderParams {
  checkoutId: string;
  userId: string;
  planId: UsdPlanId;
  amountUsd?: number;
  customerEmail?: string;
  userToken?: string;
}

export interface FulfillUsdOrderResult {
  fulfilled: boolean;
  alreadyFulfilled?: boolean;
  userId: string;
  tier: "cram_pass" | "pro_monthly" | "pro" | "tutor";
  expiresAt: string;
}

/**
 * Fulfills a USD order upon payment: validates amount, guards against tampering,
 * calculates expiration, ensures idempotency, and upserts entitlements into Supabase.
 */
export async function fulfillUsdOrder(
  params: FulfillUsdOrderParams,
): Promise<FulfillUsdOrderResult> {
  if (!(params.planId in EXPECTED_PLAN_AMOUNTS_USD)) {
    throw new Error(`Invalid USD plan ID: "${params.planId}"`);
  }

  const expectedUsd = EXPECTED_PLAN_AMOUNTS_USD[params.planId];
  const expectedCents = EXPECTED_PLAN_AMOUNTS_CENTS[params.planId];
  const userTier = mapUsdPlanToUserTier(params.planId);
  const cycle = mapUsdPlanToCycle(params.planId);

  // Validate amountUsd against expected plan amount (allowing dollars or cents representation)
  if (params.amountUsd !== undefined && Number.isFinite(params.amountUsd)) {
    const isDollarMatch = Math.abs(params.amountUsd - expectedUsd) < 0.05;
    const isCentMatch = Math.abs(params.amountUsd - expectedCents) < 2;

    if (!isDollarMatch && !isCentMatch) {
      if (params.amountUsd < expectedUsd && params.amountUsd < expectedCents) {
        console.warn(
          `[USD Fulfillment] Security Warning: Tampered lower amount for checkout "${params.checkoutId}". Received: ${params.amountUsd}, Expected USD: ${expectedUsd}. Fulfillment rejected.`,
        );
        return {
          fulfilled: false,
          userId: params.userId,
          tier: userTier,
          expiresAt: "",
        };
      }
    }
  }

  // Idempotency Check 1: In-memory cache
  const cached = fulfilledUsdOrderCache.get(params.checkoutId);
  if (cached) {
    return {
      fulfilled: true,
      alreadyFulfilled: true,
      userId: cached.userId,
      tier: cached.tier,
      expiresAt: cached.expiresAt,
    };
  }

  // Idempotency Check 2: Database record already active
  const supabase = getSupabaseServerClient(params.userToken);
  if (supabase) {
    try {
      const { data: existingSub } = await supabase
        .from("user_subscriptions")
        .select("id, user_id, tier, status, expires_at")
        .eq("id", `usd_${params.checkoutId}`)
        .maybeSingle();

      if (existingSub?.status === "active") {
        const resolvedExpiresAt =
          existingSub.expires_at ||
          calculateTierExpiration(params.planId) ||
          new Date().toISOString();

        fulfilledUsdOrderCache.set(params.checkoutId, {
          userId: existingSub.user_id || params.userId,
          tier: userTier,
          expiresAt: resolvedExpiresAt,
          amountUsd: expectedUsd,
        });

        return {
          fulfilled: true,
          alreadyFulfilled: true,
          userId: existingSub.user_id || params.userId,
          tier: userTier,
          expiresAt: resolvedExpiresAt,
        };
      }
    } catch {
      // Safe ignore DB query error
    }
  }

  const now = new Date().toISOString();
  const expiresAt =
    calculateTierExpiration(params.planId) ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Populate in-memory cache
  fulfilledUsdOrderCache.set(params.checkoutId, {
    userId: params.userId,
    tier: userTier,
    expiresAt,
    amountUsd: params.amountUsd ?? expectedUsd,
  });

  // Upsert active entitlements into Supabase
  if (supabase) {
    try {
      await supabase.from("user_subscriptions").upsert({
        id: `usd_${params.checkoutId}`,
        user_id: params.userId,
        tier: params.planId,
        cycle,
        amount: params.amountUsd ?? expectedUsd,
        currency: "USD",
        payment_method: "usd_card",
        status: "active",
        starts_at: now,
        expires_at: expiresAt,
      });
    } catch (err) {
      console.warn("[USD Fulfillment] user_subscriptions upsert warning:", err);
    }

    try {
      await supabase.from("profiles").upsert({
        id: params.userId,
        tier: userTier,
        tier_expires_at: expiresAt,
        updated_at: now,
      });
    } catch {
      try {
        await supabase
          .from("profiles")
          .update({
            tier: userTier,
            tier_expires_at: expiresAt,
            updated_at: now,
          })
          .eq("id", params.userId);
      } catch {
        // ignore
      }
    }

    try {
      await supabase.from("user_profiles").upsert({
        id: params.userId,
        tier: userTier,
        tier_expires_at: expiresAt,
        updated_at: now,
      });
    } catch {
      try {
        await supabase
          .from("user_profiles")
          .update({
            tier: userTier,
            tier_expires_at: expiresAt,
            updated_at: now,
          })
          .eq("id", params.userId);
      } catch {
        // ignore
      }
    }

    try {
      await supabase.from("user_quota_ledgers").upsert(
        {
          user_id: `user:${params.userId}`,
          tier: userTier,
          deck_credits_used: 0,
          cogs_spent_usd: 0,
          daily_burst_used: 0,
          updated_at: now,
        },
        { onConflict: "user_id" },
      );
    } catch {
      // Safe ignore quota ledger update error if table pending migration
    }

    try {
      await supabase.auth.admin.updateUserById(params.userId, {
        app_metadata: {
          tier: userTier,
          plan_id: params.planId,
          tier_expires_at: expiresAt,
        },
      });
    } catch {
      // Safe ignore admin auth update error
    }
  }

  return {
    fulfilled: true,
    alreadyFulfilled: false,
    userId: params.userId,
    tier: userTier,
    expiresAt,
  };
}
