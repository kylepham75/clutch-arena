import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import {
  calculateTierExpiration,
  normalizeTier,
  type UserTier,
} from "@/lib/pricing/tiers";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { getSupabaseAdminOrServerClient } from "@/lib/supabase/server-helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTrustedPayosOrigin } from "@/lib/payments/payos";
import { invalidateUserQuotaLedgerCache } from "@/lib/rate-limit";
import {
  clearSquadInvitesCache,
  mintSquadInvitesForOrder,
  revokeSquadInvitesForSubscription,
} from "@/lib/payments/squad-invites";

function getPolarAdminClient(userToken?: string): SupabaseClient | null {
  return getSupabaseAdminOrServerClient(userToken);
}

export type UsdPlanId =
  | "cram_pass"
  | "cram_squad_3"
  | "pro_monthly"
  | "pro"
  | "pro_semester"
  | "tutor"
  | "tutor_guild";

export type UsdProvider = "polar" | "lemonsqueezy";

export const EXPECTED_PLAN_AMOUNTS_USD: Record<UsdPlanId, number> = {
  cram_pass: 3.99,
  cram_squad_3: 8.99,
  pro_monthly: 7.99,
  pro: 11.99,
  pro_semester: 11.99,
  tutor: 19.99,
  tutor_guild: 19.99,
};

export const EXPECTED_PLAN_AMOUNTS_CENTS: Record<UsdPlanId, number> = {
  cram_pass: 399,
  cram_squad_3: 899,
  pro_monthly: 799,
  pro: 1199,
  pro_semester: 1199,
  tutor: 1999,
  tutor_guild: 1999,
};

export function mapUsdPlanToUserTier(
  planId: UsdPlanId,
): "cram_pass" | "pro_monthly" | "pro" | "tutor" {
  if (planId === "cram_pass" || planId === "cram_squad_3") return "cram_pass";
  if (planId === "pro_monthly") return "pro_monthly";
  if (planId === "tutor" || planId === "tutor_guild") return "tutor";
  return "pro";
}

export function mapUsdPlanToCycle(
  planId: UsdPlanId,
): "one_time" | "monthly" | "semester" {
  if (planId === "cram_pass" || planId === "cram_squad_3") return "one_time";
  if (planId === "pro_monthly" || planId === "tutor" || planId === "tutor_guild") {
    return "monthly";
  }
  return "semester";
}

const TIER_RANK: Record<UserTier, number> = {
  contender: 0,
  cram_pass: 1,
  pro_monthly: 2,
  pro: 3,
  tutor: 4,
};

function shouldPreserveHigherActiveTier(
  existingTierRaw: string | null | undefined,
  existingExpiresAt: string | null | undefined,
  incomingTier: UserTier,
  incomingExpiresAt: string | null | undefined,
): boolean {
  if (!existingTierRaw) return false;
  const existingTier = normalizeTier(existingTierRaw);
  const existingRank = TIER_RANK[existingTier] ?? 0;
  const incomingRank = TIER_RANK[incomingTier] ?? 0;
  if (existingRank <= 0) return false;

  const nowMs = Date.now();
  const existingExpMs = existingExpiresAt ? Date.parse(existingExpiresAt) : null;
  const isExistingActive =
    existingExpMs === null || (!Number.isNaN(existingExpMs) && existingExpMs > nowMs);
  if (!isExistingActive) return false;

  if (existingRank > incomingRank) {
    return true;
  }
  if (existingRank === incomingRank && incomingExpiresAt && existingExpMs !== null) {
    const incomingExpMs = Date.parse(incomingExpiresAt);
    if (!Number.isNaN(incomingExpMs) && existingExpMs > incomingExpMs) {
      return true;
    }
  }
  return false;
}

const fulfilledUsdOrderCache = new Map<
  string,
  {
    userId: string;
    tier: "cram_pass" | "pro_monthly" | "pro" | "tutor";
    expiresAt: string;
    amountUsd: number;
    subscriptionId?: string;
    squadCodes?: string[];
  }
>();
const checkoutAliasMap = new Map<string, string>();

/**
 * Clears the in-memory fulfilled USD order cache (used primarily in test harnesses).
 */
export function clearFulfilledUsdOrderCache(): void {
  fulfilledUsdOrderCache.clear();
  checkoutAliasMap.clear();
  clearSquadInvitesCache();
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

  const localCheckoutId = generateUsdCheckoutId(provider);
  let checkoutId = localCheckoutId;
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
    if (!productId && input.planId !== "cram_squad_3") {
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
            if (data.id && data.id !== localCheckoutId) {
              checkoutAliasMap.set(localCheckoutId, data.id);
              checkoutAliasMap.set(data.id, localCheckoutId);
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
  const supabase = getPolarAdminClient(input.userToken);
  if (supabase) {
    try {
      const pendingPayload = {
        id: `usd_${checkoutId}`,
        user_id: input.userId,
        tier: userTier,
        cycle,
        amount: amountUsd,
        currency: "USD",
        payment_method: provider === "polar" ? "polar" : "lemonsqueezy",
        status: "pending",
        expires_at: calculateTierExpiration(input.planId),
      };
      const upsertRes = (await supabase
        .from("user_subscriptions")
        .upsert(pendingPayload)) as { error?: unknown } | undefined;
      if (upsertRes?.error) {
        console.error("[USD Checkout] user_subscriptions upsert failed:", {
          subscriptionId: pendingPayload.id,
          userId: input.userId,
          planId: input.planId,
          error: upsertRes.error,
        });
      }
      if (localCheckoutId !== checkoutId) {
        const aliasSubId = `usd_${localCheckoutId}`;
        const aliasRes = (await supabase.from("user_subscriptions").upsert({
          ...pendingPayload,
          id: aliasSubId,
        })) as { error?: unknown } | undefined;
        if (aliasRes?.error) {
          console.error("[USD Checkout] user_subscriptions upsert failed:", {
            subscriptionId: aliasSubId,
            userId: input.userId,
            planId: input.planId,
            error: aliasRes.error,
          });
        }
      }
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

export interface UsdWebhookHeaders {
  id?: string | null;
  timestamp?: string | null;
  maxAgeSeconds?: number;
}

const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
  "expired",
  "revoked",
  "refunded",
  "cancelled",
  "canceled",
]);

function extractSignatureCandidates(signatureHeader: string): string[] {
  const rawTokens = signatureHeader
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const candidates: string[] = [];
  for (const token of rawTokens) {
    if (token.startsWith("v1,")) {
      const afterPrefix = token.slice(3);
      if (afterPrefix.includes(",v1,")) {
        for (const sub of token.split(/,(?=v1,)/)) {
          if (sub.startsWith("v1,") && sub.length > 3) {
            candidates.push(sub.slice(3));
          }
        }
      } else if (afterPrefix.length > 0) {
        candidates.push(afterPrefix);
      }
      continue;
    }

    for (const part of token
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      if (part.startsWith("sha256=")) {
        candidates.push(part.slice(7));
      } else if (part.startsWith("v1=")) {
        candidates.push(part.slice(3));
      } else {
        candidates.push(part);
      }
    }
  }
  return candidates;
}

/**
 * Verifies the USD webhook HMAC-SHA256 signature against the raw body text (and Standard Webhooks
 * `${webhook-id}.${webhook-timestamp}.${rawBody}` framing with replay-window freshness checks).
 */
export function verifyUsdWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret?: string,
  webhookHeaders?: UsdWebhookHeaders,
): boolean {
  if (!rawBody || typeof rawBody !== "string") return false;
  if (!signatureHeader || typeof signatureHeader !== "string") return false;

  const webhookSecret =
    secret ??
    process.env.POLAR_WEBHOOK_SECRET ??
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET ??
    "";

  if (!webhookSecret.trim()) return false;

  const rawTs = webhookHeaders?.timestamp?.trim();
  if (rawTs) {
    if (!/^\d+$/.test(rawTs)) return false;
    const tsSeconds = Number(rawTs);
    const maxAgeSeconds = webhookHeaders?.maxAgeSeconds ?? 300;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(tsSeconds) || Math.abs(nowSeconds - tsSeconds) > maxAgeSeconds) {
      return false;
    }
  }

  const webhookId = webhookHeaders?.id?.trim();
  const signedPayload =
    webhookId && rawTs ? `${webhookId}.${rawTs}.${rawBody}` : rawBody;

  const computedHex = createHmac("sha256", webhookSecret)
    .update(signedPayload)
    .digest("hex");
  const computedBase64 = createHmac("sha256", webhookSecret)
    .update(signedPayload)
    .digest("base64");

  let altHex: string | null = null;
  let altBase64: string | null = null;
  if (webhookSecret.startsWith("whsec_")) {
    try {
      const decodedKey = Buffer.from(webhookSecret.slice(6), "base64");
      if (decodedKey.length > 0) {
        altHex = createHmac("sha256", decodedKey).update(signedPayload).digest("hex");
        altBase64 = createHmac("sha256", decodedKey)
          .update(signedPayload)
          .digest("base64");
      }
    } catch {
      // Ignore decode error
    }
  }

  const candidateParts = extractSignatureCandidates(signatureHeader);

  for (const candidate of candidateParts) {
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
  alternateCheckoutIds?: string[];
  userId: string;
  planId: UsdPlanId;
  amountUsd?: number;
  requireAmount?: boolean;
  customerEmail?: string;
  userToken?: string;
}

export interface FulfillUsdOrderResult {
  fulfilled: boolean;
  alreadyFulfilled?: boolean;
  userId: string;
  tier: "cram_pass" | "pro_monthly" | "pro" | "tutor";
  expiresAt: string;
  subscriptionId?: string;
  squadCodes?: string[];
}

async function maybeMintPolarSquadInvites(params: {
  planId: UsdPlanId;
  subscriptionId: string;
  buyerUserId: string;
  expiresAt: string;
  userToken?: string;
}): Promise<string[] | undefined> {
  if (params.planId !== "cram_squad_3" || !params.buyerUserId.trim()) {
    return undefined;
  }
  try {
    const invites = await mintSquadInvitesForOrder({
      subscriptionId: params.subscriptionId,
      buyerUserId: params.buyerUserId,
      expiresAt: params.expiresAt,
      userToken: params.userToken,
    });
    return invites.map((invite) => invite.code);
  } catch (err) {
    console.error("[USD Fulfillment] Failed to mint squad invites:", err);
    return undefined;
  }
}

async function safeRevokePolarSquadInvites(
  subscriptionId: string,
  reason: "refunded" | "revoked" | "cancelled",
  revokedSet: Set<string>,
): Promise<void> {
  const normalizedId = subscriptionId.trim();
  if (!normalizedId || revokedSet.has(normalizedId)) return;
  revokedSet.add(normalizedId);
  try {
    await revokeSquadInvitesForSubscription({
      subscriptionId: normalizedId,
      reason,
    });
  } catch (err) {
    console.error("[USD Revocation] Failed to revoke squad invites:", {
      subscriptionId: normalizedId,
      reason,
      error: err,
    });
  }
}

/**
 * Fulfills a USD order upon payment: validates amount, guards against tampering,
 * calculates expiration, ensures idempotency across canonical/alias IDs and terminal statuses,
 * prevents lower-tier overwrites, and upserts entitlements into Supabase.
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

  const candidateIds = Array.from(
    new Set(
      [
        params.checkoutId,
        checkoutAliasMap.get(params.checkoutId),
        ...(params.alternateCheckoutIds ?? []).flatMap((alt) => [
          alt,
          checkoutAliasMap.get(alt),
        ]),
      ]
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim()),
    ),
  );

  // Idempotency Check 1: In-memory cache across all canonical/alternate IDs
  for (const cid of candidateIds) {
    const cached = fulfilledUsdOrderCache.get(cid);
    if (cached) {
      const subscriptionId = cached.subscriptionId ?? `usd_${params.checkoutId}`;
      const squadCodes =
        (await maybeMintPolarSquadInvites({
          planId: params.planId,
          subscriptionId,
          buyerUserId: cached.userId,
          expiresAt: cached.expiresAt,
          userToken: params.userToken,
        })) ?? cached.squadCodes;
      const updatedEntry = {
        ...cached,
        subscriptionId,
        ...(squadCodes ? { squadCodes } : {}),
      };
      for (const id of candidateIds) {
        fulfilledUsdOrderCache.set(id, updatedEntry);
      }
      return {
        fulfilled: true,
        alreadyFulfilled: true,
        userId: cached.userId,
        tier: cached.tier,
        expiresAt: cached.expiresAt,
        subscriptionId,
        ...(squadCodes ? { squadCodes } : {}),
      };
    }
  }

  // Validate amountUsd against expected plan amount (dollars or cents)
  if (params.requireAmount && (params.amountUsd === undefined || !Number.isFinite(params.amountUsd))) {
    console.warn(
      `[USD Fulfillment] Security Warning: Missing payment amount for checkout "${params.checkoutId}". Fulfillment rejected.`,
    );
    return {
      fulfilled: false,
      userId: params.userId,
      tier: userTier,
      expiresAt: "",
    };
  }

  if (params.amountUsd !== undefined && Number.isFinite(params.amountUsd)) {
    const isDollarMatch = Math.abs(params.amountUsd - expectedUsd) < 0.05;
    const isCentMatch = Math.abs(params.amountUsd - expectedCents) < 2;

    if (!isDollarMatch && !isCentMatch) {
      const isDollarUnderpay = params.amountUsd < expectedUsd - 0.05;
      const isCentUnderpay =
        Number.isInteger(params.amountUsd) &&
        params.amountUsd >= 50 &&
        params.amountUsd < expectedCents - 2;
      if (isDollarUnderpay || isCentUnderpay) {
        console.warn(
          `[USD Fulfillment] Security Warning: Tampered lower amount for checkout "${params.checkoutId}". Received: ${params.amountUsd}, Expected USD: ${expectedUsd} (${expectedCents} cents). Fulfillment rejected.`,
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

  // Idempotency Check 2 & Pending cross-check: Database records across candidate IDs
  const supabase = getPolarAdminClient(params.userToken);
  const existingRows: Array<{
    id: string;
    user_id?: string | null;
    tier?: string | null;
    status?: string | null;
    amount?: number | null;
    expires_at?: string | null;
  }> = [];

  if (supabase) {
    for (const cid of candidateIds) {
      try {
        const { data: existingSub } = await supabase
          .from("user_subscriptions")
          .select("id, user_id, tier, status, amount, expires_at")
          .eq("id", `usd_${cid}`)
          .maybeSingle();

        if (existingSub) {
          existingRows.push(existingSub as (typeof existingRows)[number]);
        }
      } catch {
        // Safe ignore DB query error
      }
    }

    const activeRow = existingRows.find((r) => r.status === "active");
    if (activeRow) {
      const resolvedOwnerId = activeRow.user_id || params.userId;
      const resolvedExpiresAt =
        activeRow.expires_at ||
        calculateTierExpiration(params.planId) ||
        new Date().toISOString();
      const primarySubId = activeRow.id || `usd_${params.checkoutId}`;
      const squadCodes = await maybeMintPolarSquadInvites({
        planId: params.planId,
        subscriptionId: primarySubId,
        buyerUserId: resolvedOwnerId,
        expiresAt: resolvedExpiresAt,
        userToken: params.userToken,
      });
      const cacheEntry = {
        userId: resolvedOwnerId,
        tier: userTier,
        expiresAt: resolvedExpiresAt,
        amountUsd: expectedUsd,
        subscriptionId: primarySubId,
        ...(squadCodes ? { squadCodes } : {}),
      };
      for (const cid of candidateIds) {
        fulfilledUsdOrderCache.set(cid, cacheEntry);
      }
      return {
        fulfilled: true,
        alreadyFulfilled: true,
        userId: resolvedOwnerId,
        tier: userTier,
        expiresAt: resolvedExpiresAt,
        subscriptionId: primarySubId,
        ...(squadCodes ? { squadCodes } : {}),
      };
    }

    const terminalRow = existingRows.find(
      (r) => typeof r.status === "string" && TERMINAL_SUBSCRIPTION_STATUSES.has(r.status),
    );
    if (terminalRow) {
      return {
        fulfilled: false,
        alreadyFulfilled: true,
        userId: terminalRow.user_id || params.userId,
        tier: userTier,
        expiresAt: terminalRow.expires_at || "",
      };
    }

    const pendingRow = existingRows.find((r) => r.status === "pending");
    if (pendingRow) {
      if (pendingRow.user_id && pendingRow.user_id !== params.userId) {
        console.warn(
          `[USD Fulfillment] Security Warning: Pending checkout "${pendingRow.id}" owner mismatch ("${params.userId}" vs "${pendingRow.user_id}"). Fulfillment rejected.`,
        );
        return {
          fulfilled: false,
          userId: pendingRow.user_id,
          tier: userTier,
          expiresAt: "",
        };
      }
      if (pendingRow.tier) {
        const pendingNormTier = normalizeTier(pendingRow.tier);
        if ((TIER_RANK[pendingNormTier] ?? 0) < (TIER_RANK[userTier] ?? 0)) {
          console.warn(
            `[USD Fulfillment] Security Warning: Webhook plan tier "${userTier}" exceeds pending checkout "${pendingRow.id}" tier "${pendingNormTier}". Fulfillment rejected.`,
          );
          return {
            fulfilled: false,
            userId: params.userId,
            tier: userTier,
            expiresAt: "",
          };
        }
      }
      if (
        typeof pendingRow.amount === "number" &&
        Number.isFinite(pendingRow.amount) &&
        params.amountUsd !== undefined &&
        Number.isFinite(params.amountUsd)
      ) {
        const expectedPendingCents = Math.round(pendingRow.amount * 100);
        const matchesPendingCents =
          Number.isInteger(params.amountUsd) &&
          params.amountUsd >= 50 &&
          params.amountUsd >= expectedPendingCents - 2;
        if (params.amountUsd < pendingRow.amount - 0.05 && !matchesPendingCents) {
          console.warn(
            `[USD Fulfillment] Security Warning: Amount ${params.amountUsd} below pending checkout "${pendingRow.id}" amount ${pendingRow.amount}. Fulfillment rejected.`,
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
  }

  const now = new Date().toISOString();
  const expiresAt =
    calculateTierExpiration(params.planId) ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const primarySubId =
    existingRows.find((r) => r.status === "pending")?.id ?? `usd_${params.checkoutId}`;

  // Populate in-memory cache across all candidate IDs
  const entry: {
    userId: string;
    tier: "cram_pass" | "pro_monthly" | "pro" | "tutor";
    expiresAt: string;
    amountUsd: number;
    subscriptionId?: string;
    squadCodes?: string[];
  } = {
    userId: params.userId,
    tier: userTier,
    expiresAt,
    amountUsd: params.amountUsd ?? expectedUsd,
    subscriptionId: primarySubId,
  };
  for (const cid of candidateIds) {
    fulfilledUsdOrderCache.set(cid, entry);
  }

  // Check monotonic tier rank before updating derived profile/ledger stores
  let preserveExistingHigherTier = false;
  if (supabase) {
    try {
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("tier, tier_expires_at")
        .eq("id", params.userId)
        .maybeSingle();

      if (
        existingProfile &&
        shouldPreserveHigherActiveTier(
          (existingProfile as { tier?: string | null }).tier,
          (existingProfile as { tier_expires_at?: string | null }).tier_expires_at,
          userTier,
          expiresAt,
        )
      ) {
        preserveExistingHigherTier = true;
      }
    } catch {
      // Safe ignore profile check error
    }

    try {
      const subPayload = {
        id: primarySubId,
        user_id: params.userId,
        tier: params.planId,
        cycle,
        amount: params.amountUsd ?? expectedUsd,
        currency: "USD",
        payment_method: "usd_card",
        status: "active",
        starts_at: now,
        expires_at: expiresAt,
      };
      const upsertRes = (await supabase
        .from("user_subscriptions")
        .upsert(subPayload)) as { error?: unknown } | undefined;
      if (upsertRes?.error) {
        console.error("[USD Fulfillment] user_subscriptions upsert failed:", {
          subscriptionId: primarySubId,
          userId: params.userId,
          planId: params.planId,
          error: upsertRes.error,
        });
      }

      // Keep canonical/alias rows synchronized
      for (const cid of candidateIds) {
        const subId = `usd_${cid}`;
        if (subId !== primarySubId && existingRows.some((r) => r.id === subId)) {
          const updateRes = (await supabase
            .from("user_subscriptions")
            .update({ status: "active", starts_at: now, expires_at: expiresAt })
            .eq("id", subId)) as { error?: unknown } | undefined;
          if (updateRes?.error) {
            console.error("[USD Fulfillment] user_subscriptions update failed:", {
              subscriptionId: subId,
              userId: params.userId,
              planId: params.planId,
              error: updateRes.error,
            });
          }
        }
      }
    } catch (err) {
      console.warn("[USD Fulfillment] user_subscriptions upsert warning:", err);
    }

    if (!preserveExistingHigherTier) {
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
        const { error: quotaErr } = await supabase.from("user_quota_ledgers").upsert(
          {
            user_id: `user:${params.userId}`,
            tier: userTier,
            deck_credits_used: 0,
            cogs_spent_usd: 0,
            cogs_reserved_usd: 0,
            daily_burst_used: 0,
            window_started_at: now,
            window_spent_usd: 0,
            window_reserved_usd: 0,
            weekly_started_at: now,
            weekly_spent_usd: 0,
            weekly_reserved_usd: 0,
            updated_at: now,
          },
          { onConflict: "user_id" },
        );
        if (quotaErr) {
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
        }
        await invalidateUserQuotaLedgerCache(params.userId);
      } catch {
        try {
          await invalidateUserQuotaLedgerCache(params.userId);
        } catch {
          // ignore
        }
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
  }

  const squadCodes = await maybeMintPolarSquadInvites({
    planId: params.planId,
    subscriptionId: primarySubId,
    buyerUserId: params.userId,
    expiresAt,
    userToken: params.userToken,
  });
  if (squadCodes) {
    const updatedEntry = { ...entry, squadCodes };
    for (const cid of candidateIds) {
      fulfilledUsdOrderCache.set(cid, updatedEntry);
    }
  }

  return {
    fulfilled: true,
    alreadyFulfilled: false,
    userId: params.userId,
    tier: userTier,
    expiresAt,
    subscriptionId: primarySubId,
    ...(squadCodes ? { squadCodes } : {}),
  };
}

export interface RevokeUsdSubscriptionParams {
  checkoutId?: string;
  alternateCheckoutIds?: string[];
  userId?: string;
  reason?: "refunded" | "revoked" | "cancelled";
}

export interface RevokeUsdSubscriptionResult {
  revoked: boolean;
  downgraded: boolean;
  userId?: string;
  reason: "refunded" | "revoked" | "cancelled";
}

/**
 * Revokes / downgrades a USD subscription upon refund, chargeback, cancellation, or expiration,
 * clearing cached entitlements and resetting derived tier stores when no other active subscription remains.
 */
export async function revokeUsdSubscription(
  params: RevokeUsdSubscriptionParams,
): Promise<RevokeUsdSubscriptionResult> {
  const reason = params.reason ?? "revoked";
  const candidateIds = Array.from(
    new Set(
      [
        params.checkoutId,
        params.checkoutId ? checkoutAliasMap.get(params.checkoutId) : undefined,
        ...(params.alternateCheckoutIds ?? []).flatMap((alt) => [
          alt,
          checkoutAliasMap.get(alt),
        ]),
      ]
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim()),
    ),
  );

  let resolvedUserId = params.userId;
  const cachedSubscriptionIds = new Set<string>();
  const revokedSquadSubIds = new Set<string>();

  for (const cid of candidateIds) {
    const cached = fulfilledUsdOrderCache.get(cid);
    if (!resolvedUserId && cached?.userId) {
      resolvedUserId = cached.userId;
    }
    if (cached?.subscriptionId) {
      cachedSubscriptionIds.add(cached.subscriptionId);
    }
    cachedSubscriptionIds.add(`usd_${cid}`);
    fulfilledUsdOrderCache.delete(cid);
  }

  if (resolvedUserId) {
    for (const [key, val] of fulfilledUsdOrderCache.entries()) {
      if (val.userId === resolvedUserId) {
        if (val.subscriptionId) {
          cachedSubscriptionIds.add(val.subscriptionId);
        }
        fulfilledUsdOrderCache.delete(key);
      }
    }
  }

  const supabase = getPolarAdminClient();
  if (!supabase) {
    for (const subId of cachedSubscriptionIds) {
      await safeRevokePolarSquadInvites(subId, reason, revokedSquadSubIds);
    }
    return {
      revoked: candidateIds.length > 0 || Boolean(resolvedUserId),
      downgraded: Boolean(resolvedUserId),
      userId: resolvedUserId,
      reason,
    };
  }

  const now = new Date().toISOString();
  let updatedAnySub = false;

  for (const cid of candidateIds) {
    try {
      const { data: subRow } = await supabase
        .from("user_subscriptions")
        .select("id, user_id, status")
        .eq("id", `usd_${cid}`)
        .maybeSingle();

      if (subRow) {
        if (!resolvedUserId && subRow.user_id) {
          resolvedUserId = subRow.user_id as string;
        }
        const updateRes = (await supabase
          .from("user_subscriptions")
          .update({ status: reason, expires_at: now })
          .eq("id", `usd_${cid}`)) as { error?: unknown } | undefined;
        if (updateRes?.error) {
          console.error("[USD Revocation] user_subscriptions update failed:", {
            subscriptionId: `usd_${cid}`,
            reason,
            error: updateRes.error,
          });
        }
        updatedAnySub = true;
        await safeRevokePolarSquadInvites(
          (subRow as { id?: string }).id || `usd_${cid}`,
          reason,
          revokedSquadSubIds,
        );
      }
    } catch {
      // Safe ignore DB lookup/update error
    }
  }

  if (resolvedUserId && !updatedAnySub) {
    try {
      const { data: userSubs } = await supabase
        .from("user_subscriptions")
        .select("id, payment_method, status")
        .eq("user_id", resolvedUserId)
        .eq("status", "active");

      if (Array.isArray(userSubs)) {
        for (const sub of userSubs) {
          const pm = String((sub as { payment_method?: string }).payment_method || "");
          if (pm === "usd_card" || pm === "polar" || pm === "lemonsqueezy") {
            const subId = (sub as { id: string }).id;
            const updateRes = (await supabase
              .from("user_subscriptions")
              .update({ status: reason, expires_at: now })
              .eq("id", subId)) as { error?: unknown } | undefined;
            if (updateRes?.error) {
              console.error("[USD Revocation] user_subscriptions update failed:", {
                subscriptionId: subId,
                reason,
                error: updateRes.error,
              });
            }
            updatedAnySub = true;
            await safeRevokePolarSquadInvites(subId, reason, revokedSquadSubIds);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (revokedSquadSubIds.size === 0 && cachedSubscriptionIds.size > 0) {
    for (const subId of cachedSubscriptionIds) {
      await safeRevokePolarSquadInvites(subId, reason, revokedSquadSubIds);
    }
  }

  let hasOtherActiveSub = false;
  if (resolvedUserId) {
    try {
      const { data: remainingActive } = await supabase
        .from("user_subscriptions")
        .select("id, expires_at, status")
        .eq("user_id", resolvedUserId)
        .eq("status", "active");

      if (Array.isArray(remainingActive)) {
        const nowMs = Date.now();
        hasOtherActiveSub = remainingActive.some((r) => {
          const id = String((r as { id?: string }).id || "");
          if (candidateIds.some((cid) => `usd_${cid}` === id)) return false;
          const exp = (r as { expires_at?: string | null }).expires_at;
          if (!exp) return true;
          const expMs = Date.parse(exp);
          return !Number.isNaN(expMs) && expMs > nowMs;
        });
      }
    } catch {
      // ignore
    }
  }

  let downgraded = false;
  if (resolvedUserId && !hasOtherActiveSub) {
    downgraded = true;
    try {
      await supabase
        .from("profiles")
        .update({ tier: "contender", tier_expires_at: null, updated_at: now })
        .eq("id", resolvedUserId);
    } catch {
      // ignore
    }

    try {
      await supabase
        .from("user_profiles")
        .update({ tier: "contender", tier_expires_at: null, updated_at: now })
        .eq("id", resolvedUserId);
    } catch {
      // ignore
    }

    try {
      await supabase
        .from("user_quota_ledgers")
        .update({
          tier: "contender",
          cogs_ceiling_usd: 0.08,
          updated_at: now,
        })
        .eq("user_id", `user:${resolvedUserId}`);
    } catch {
      // ignore
    }

    try {
      await supabase.auth.admin.updateUserById(resolvedUserId, {
        app_metadata: {
          tier: "contender",
          plan_id: "contender",
          tier_expires_at: null,
        },
      });
    } catch {
      // ignore
    }

    try {
      await invalidateUserQuotaLedgerCache(resolvedUserId);
    } catch {
      // ignore
    }
  }

  return {
    revoked: updatedAnySub || candidateIds.length > 0,
    downgraded,
    userId: resolvedUserId,
    reason,
  };
}
