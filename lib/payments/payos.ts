import { createHmac, timingSafeEqual } from "node:crypto";
import {
  calculateTierExpiration,
  normalizeTier,
  PRICING_PLANS,
} from "@/lib/pricing/tiers";
import {
  getSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import { invalidateUserQuotaLedgerCache } from "@/lib/rate-limit";

export type PayosPlanId =
  | "trial_24h"
  | "cram_pass"
  | "pro"
  | "pro_monthly"
  | "tutor"
  | "pro_semester"
  | "tutor_guild";

export const SANDBOX_TEST_AMOUNT_VND = 5000;
export const SANDBOX_COGS_CAP_USD = 0.05;

const fulfilledOrderCache = new Map<
  number,
  {
    userId: string;
    tier: PayosPlanId;
    expiresAt: string;
    amount: number;
    cogsCeilingUsd?: number;
  }
>();

/**
 * Clears the in-memory fulfilled order cache (used primarily in test harnesses).
 */
export function clearFulfilledOrderCache(): void {
  fulfilledOrderCache.clear();
}

/**
 * Returns the canonical configured application origin.
 */
export function getCanonicalAppOrigin(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL
      ? process.env.VERCEL_URL.trim().startsWith("http")
        ? process.env.VERCEL_URL.trim()
        : `https://${process.env.VERCEL_URL.trim()}`
      : undefined,
  ];

  for (const raw of candidates) {
    if (raw && raw.trim()) {
      try {
        return new URL(raw.trim()).origin;
      } catch {
        // Ignore malformed environment URL
      }
    }
  }

  return "http://localhost:3000";
}

/**
 * Builds the explicit allowlist of trusted application origins.
 */
export function getAllowedPayosOrigins(): Set<string> {
  const allowed = new Set<string>();
  const envCandidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL
      ? process.env.VERCEL_URL.trim().startsWith("http")
        ? process.env.VERCEL_URL.trim()
        : `https://${process.env.VERCEL_URL.trim()}`
      : undefined,
  ];

  for (const raw of envCandidates) {
    if (raw && raw.trim()) {
      try {
        allowed.add(new URL(raw.trim()).origin);
      } catch {
        // Ignore malformed environment URL
      }
    }
  }

  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }

  return allowed;
}

/**
 * Checks whether a candidate origin is in the explicit application origin allowlist.
 */
export function isAllowedPayosOrigin(candidateOrigin?: string | null): boolean {
  if (!candidateOrigin || typeof candidateOrigin !== "string") {
    return false;
  }
  try {
    const normalized = new URL(candidateOrigin.trim()).origin;
    return getAllowedPayosOrigins().has(normalized);
  } catch {
    return false;
  }
}

/**
 * Validates a candidate origin against the trusted allowlist and falls back
 * to the canonical configured app origin when missing or untrusted.
 */
export function resolveTrustedPayosOrigin(
  candidateOrigin?: string | null,
): string {
  const canonical = getCanonicalAppOrigin();
  if (!candidateOrigin || typeof candidateOrigin !== "string") {
    return canonical;
  }
  try {
    const normalized = new URL(candidateOrigin.trim()).origin;
    if (getAllowedPayosOrigins().has(normalized)) {
      return normalized;
    }
  } catch {
    // Fall back to canonical origin
  }
  return canonical;
}

/**
 * Checks whether the given email is in the admin test allowlist.
 * Reads comma-separated list from process.env.ADMIN_TEST_EMAILS (case-insensitive, trimmed).
 */
export function isAdminTestEmail(email?: string | null): boolean {
  if (!email || typeof email !== "string") {
    return false;
  }
  const targetEmail = email.trim().toLowerCase();
  if (!targetEmail) {
    return false;
  }
  const rawList = process.env.ADMIN_TEST_EMAILS ?? "";
  if (!rawList.trim()) {
    return false;
  }
  const allowlist = rawList
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return allowlist.includes(targetEmail);
}

export const EXPECTED_PLAN_AMOUNTS_VND: Record<PayosPlanId, number> = {
  trial_24h: 5_000,
  cram_pass: 69_000,
  pro: 299_000,
  pro_semester: 299_000,
  pro_monthly: 109_000,
  tutor: 399_000,
  tutor_guild: 399_000,
};

export function getPlanBillingCycle(
  planId: PayosPlanId,
): "one_time" | "semester" | "monthly" {
  if (planId === "cram_pass" || planId === "trial_24h") {
    return "one_time";
  }
  if (planId === "pro" || planId === "pro_semester") {
    return "semester";
  }
  if (
    planId === "pro_monthly" ||
    planId === "tutor" ||
    planId === "tutor_guild"
  ) {
    return "monthly";
  }
  return "monthly";
}

export function mapPlanToUserTier(
  planId: PayosPlanId,
): "cram_pass" | "pro" | "tutor" {
  if (planId === "cram_pass" || planId === "trial_24h") {
    return "cram_pass";
  }
  if (planId === "tutor" || planId === "tutor_guild") {
    return "tutor";
  }
  return "pro";
}

export function resolvePayosTierExpiration(planId: PayosPlanId): string | null {
  if (planId === "trial_24h") {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  return calculateTierExpiration(planId);
}

export interface CreatePayosPaymentLinkInput {
  planId: PayosPlanId;
  origin: string;
  userId?: string;
  userToken?: string;
  amount?: number;
  userEmail?: string;
}

export interface PayosPaymentLinkResult {
  orderCode: number;
  amount: number;
  description: string;
  bin: string;
  accountNumber: string;
  accountName: string;
  checkoutUrl: string;
  qrCode: string;
  status: string;
  vietQrImageUrl: string;
}

export interface PayosPaymentInfoResult {
  orderCode: number;
  status: "PAID" | "PENDING" | "PROCESSING" | "CANCELLED" | "EXPIRED";
  amount: number;
  amountPaid: number;
  transactions: unknown[];
}

export interface FulfillPayosOrderParams {
  orderCode: number;
  amount?: number;
  fallbackUserId?: string;
  userToken?: string;
  expectedAmount?: number;
}

export interface FulfillPayosOrderResult {
  fulfilled: boolean;
  alreadyFulfilled?: boolean;
  status?: string;
  userId: string | null;
  tier: PayosPlanId | null;
  planId?: PayosPlanId | null;
  expiresAt: string | null;
  expires_at?: string | null;
  cogsCeilingUsd?: number;
}

/**
 * Checks whether all required PayOS environment variables are present and non-empty.
 */
export function isPayosConfigured(): boolean {
  return Boolean(
    process.env.PAYOS_CLIENT_ID &&
      process.env.PAYOS_CLIENT_ID.trim().length > 0 &&
      process.env.PAYOS_API_KEY &&
      process.env.PAYOS_API_KEY.trim().length > 0 &&
      process.env.PAYOS_CHECKSUM_KEY &&
      process.env.PAYOS_CHECKSUM_KEY.trim().length > 0,
  );
}

let lastGeneratedTimestamp = 0;

/**
 * Generates a unique safe integer order code encoding the plan in the final digit:
 * - 1 for cram_pass
 * - 2 for pro or pro_semester
 * - 3 for pro_monthly
 * - 4 for tutor or tutor_guild
 * Safe within Number.MAX_SAFE_INTEGER (14-digit integer).
 */
export function generatePayosOrderCode(planId: PayosPlanId): number {
  let now = Date.now();
  if (now <= lastGeneratedTimestamp) {
    now = lastGeneratedTimestamp + 1;
  }
  lastGeneratedTimestamp = now;

  let planSuffix = 1;
  if (planId === "pro" || planId === "pro_semester") {
    planSuffix = 2;
  } else if (planId === "pro_monthly") {
    planSuffix = 3;
  } else if (planId === "tutor" || planId === "tutor_guild") {
    planSuffix = 4;
  } else if (planId === "trial_24h") {
    planSuffix = 5;
  } else {
    planSuffix = 1;
  }

  return now * 10 + planSuffix;
}

/**
 * Decodes the purchased plan from the orderCode's last digit or falls back to amount.
 * - orderCode % 10 === 1 -> "cram_pass"
 * - orderCode % 10 === 2 -> "pro"
 * - orderCode % 10 === 3 -> "pro_monthly"
 * - orderCode % 10 === 4 -> "tutor"
 * - orderCode % 10 === 5 -> "trial_24h"
 * - amount === 5000 or 39000 or 69000 -> "cram_pass"
 * - amount === 109000 -> "pro_monthly"
 * - amount === 149000 or 299000 -> "pro"
 * - amount === 399000 -> "tutor"
 */
export function decodePlanFromOrderCode(
  orderCode: number,
  amount?: number,
): PayosPlanId | null {
  const lastDigit = Math.abs(orderCode) % 10;
  if (lastDigit === 1) {
    return "cram_pass";
  }
  if (lastDigit === 2) {
    return "pro";
  }
  if (lastDigit === 3) {
    return "pro_monthly";
  }
  if (lastDigit === 4) {
    return "tutor";
  }
  if (lastDigit === 5) {
    return "trial_24h";
  }
  if (amount === 5000 || amount === 39000 || amount === 69000) {
    return "cram_pass";
  }
  if (amount === 109000) {
    return "pro_monthly";
  }
  if (amount === 149000 || amount === 299000) {
    return "pro";
  }
  if (amount === 399000) {
    return "tutor";
  }
  return null;
}

/**
 * Returns a clean uppercase alphanumeric description with spaces of at most 25 characters (PayOS limit).
 */
export function buildPayosDescription(
  planId: PayosPlanId,
  orderCode: number,
): string {
  const suffix = String(Math.abs(orderCode)).slice(-6);
  let prefix = "CLUTCH CRAM";
  if (planId === "pro" || planId === "pro_semester") {
    prefix = "CLUTCH PRO";
  } else if (planId === "pro_monthly") {
    prefix = "CLUTCH MONTHLY";
  } else if (planId === "tutor" || planId === "tutor_guild") {
    prefix = "CLUTCH TUTOR";
  } else if (planId === "trial_24h") {
    prefix = "CLUTCH TRIAL";
  }
  const desc = `${prefix} ${suffix}`.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  return desc.slice(0, 25);
}

/**
 * Builds the exact alphabetical query string and returns the hex HMAC-SHA256 digest.
 * `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`
 */
export function computePayosPaymentSignature(
  params: {
    amount: number;
    cancelUrl: string;
    description: string;
    orderCode: number;
    returnUrl: string;
  },
  checksumKey?: string,
): string {
  const dataStr = `amount=${params.amount}&cancelUrl=${params.cancelUrl}&description=${params.description}&orderCode=${params.orderCode}&returnUrl=${params.returnUrl}`;
  const key = checksumKey ?? process.env.PAYOS_CHECKSUM_KEY ?? "";
  return createHmac("sha256", key).update(dataStr).digest("hex");
}

function sortKeysRecursively(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(sortKeysRecursively);
  }
  if (typeof val === "object") {
    const sortedObj: Record<string, unknown> = {};
    const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
    for (const k of sortedKeys) {
      sortedObj[k] = sortKeysRecursively((val as Record<string, unknown>)[k]);
    }
    return sortedObj;
  }
  return val;
}

function normalizeWebhookValue(val: unknown): string {
  if (
    val === null ||
    val === undefined ||
    val === "null" ||
    val === "undefined"
  ) {
    return "";
  }
  if (typeof val === "object") {
    return JSON.stringify(sortKeysRecursively(val));
  }
  return String(val);
}

/**
 * Verifies the PayOS webhook signature by sorting data keys alphabetically,
 * normalizing values, and computing HMAC-SHA256 with timing-safe comparison.
 */
export function verifyPayosWebhookSignature(
  data: Record<string, unknown>,
  signature: string,
  checksumKey?: string,
): boolean {
  if (
    !signature ||
    typeof signature !== "string" ||
    !data ||
    typeof data !== "object"
  ) {
    return false;
  }

  const sortedKeys = Object.keys(data).sort();
  const dataStr = sortedKeys
    .map((k) => `${k}=${normalizeWebhookValue(data[k])}`)
    .join("&");

  const key = checksumKey ?? process.env.PAYOS_CHECKSUM_KEY ?? "";
  const computedHex = createHmac("sha256", key).update(dataStr).digest("hex");

  const sigBuf = Buffer.from(signature.trim().toLowerCase(), "utf-8");
  const compBuf = Buffer.from(computedHex.toLowerCase(), "utf-8");

  if (sigBuf.length !== compBuf.length || sigBuf.length === 0) {
    return false;
  }

  return timingSafeEqual(sigBuf, compBuf);
}

/**
 * Builds the standard VietQR image URL with compact2 template and payment metadata.
 */
export function buildVietQrImageUrl(params: {
  bin: string;
  accountNumber: string;
  amount: number;
  description: string;
  accountName?: string;
}): string {
  const accountNameQuery = params.accountName
    ? `&accountName=${encodeURIComponent(params.accountName)}`
    : "";
  return `https://img.vietqr.io/image/${params.bin}-${params.accountNumber}-compact2.png?amount=${params.amount}&addInfo=${encodeURIComponent(params.description)}${accountNameQuery}`;
}

/**
 * Creates a PayOS v2 checkout link and persists a pending transaction in Supabase if userId is provided.
 */
export async function createPayosPaymentLink(
  input: CreatePayosPaymentLinkInput,
): Promise<PayosPaymentLinkResult> {
  const canonicalPlanId =
    input.planId === "pro_semester"
      ? "pro"
      : input.planId === "tutor_guild"
        ? "tutor"
        : input.planId === "trial_24h"
          ? "cram_pass"
          : input.planId;

  const plan = PRICING_PLANS.find((p) => p.id === canonicalPlanId);
  if (!plan) {
    throw new Error(`Plan "${input.planId}" not found in PRICING_PLANS`);
  }

  const isSandbox =
    input.amount === SANDBOX_TEST_AMOUNT_VND || input.planId === "trial_24h";
  const effectiveAmount = isSandbox
    ? SANDBOX_TEST_AMOUNT_VND
    : (EXPECTED_PLAN_AMOUNTS_VND[input.planId] ?? plan.priceVnd);

  if (isSandbox) {
    let userEmail: string | null = input.userEmail ?? null;
    const supabase = getSupabaseServerClient(input.userToken);

    if (supabase) {
      if (!userEmail && input.userToken) {
        try {
          const { data: authData } = await supabase.auth.getUser(input.userToken);
          if (authData?.user?.email) {
            userEmail = authData.user.email;
          }
        } catch {
          // Safe ignore auth lookup error
        }
      }

      if (!userEmail && input.userId) {
        try {
          const { data: adminUser } = await supabase.auth.admin.getUserById(input.userId);
          if (adminUser?.user?.email) {
            userEmail = adminUser.user.email;
          }
        } catch {
          // Safe ignore admin auth lookup error
        }

        if (!userEmail) {
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("email")
              .eq("id", input.userId)
              .maybeSingle();
            if (profile?.email) {
              userEmail = profile.email;
            }
          } catch {
            // Safe ignore profile lookup error
          }
        }

        if (!userEmail) {
          try {
            const { data: userProfile } = await supabase
              .from("user_profiles")
              .select("email")
              .eq("id", input.userId)
              .maybeSingle();
            if (userProfile?.email) {
              userEmail = userProfile.email;
            }
          } catch {
            // Safe ignore user profile lookup error
          }
        }
      }
    }

    if (!isAdminTestEmail(userEmail)) {
      throw new Error("Sandbox test payment unauthorized for this account");
    }
  }

  const cycle = getPlanBillingCycle(input.planId);
  const trustedOrigin = resolveTrustedPayosOrigin(input.origin);

  const orderCode = generatePayosOrderCode(input.planId);
  const description = buildPayosDescription(input.planId, orderCode);
  const returnUrl = `${trustedOrigin}/?payment=success&orderCode=${orderCode}`;
  const cancelUrl = `${trustedOrigin}/?payment=cancelled&orderCode=${orderCode}`;

  const signature = computePayosPaymentSignature({
    amount: effectiveAmount,
    cancelUrl,
    description,
    orderCode,
    returnUrl,
  });

  if (input.userId) {
    const supabase = getSupabaseServerClient(input.userToken);
    if (!supabase && isSupabaseServerConfigured()) {
      throw new Error("Failed to initialize database client for pending order persistence");
    }
    if (supabase) {
      const { error: upsertErr } = await supabase.from("user_subscriptions").upsert({
        id: `payos_${orderCode}`,
        user_id: input.userId,
        tier: input.planId,
        cycle,
        amount: effectiveAmount,
        currency: "VND",
        payment_method: "payos_vietqr",
        status: "pending",
        expires_at: resolvePayosTierExpiration(input.planId),
      });
      if (upsertErr) {
        throw new Error(
          `Failed to persist pending subscription: ${(upsertErr as { message?: string }).message || "Database error"}`,
        );
      }
    }
  }

  const response = await fetch(
    "https://api-merchant.payos.vn/v2/payment-requests",
    {
      method: "POST",
      headers: {
        "x-client-id": process.env.PAYOS_CLIENT_ID ?? "",
        "x-api-key": process.env.PAYOS_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderCode,
        amount: effectiveAmount,
        description,
        cancelUrl,
        returnUrl,
        signature,
        items: [
          {
            name: plan.nameVi || plan.nameEn,
            quantity: 1,
            price: effectiveAmount,
          },
        ],
      }),
    },
  );

  const json = (await response.json()) as {
    code: string;
    desc?: string;
    data?: {
      bin: string;
      accountNumber: string;
      accountName: string;
      amount: number;
      description: string;
      orderCode: number;
      currency: string;
      paymentLinkId: string;
      status: string;
      checkoutUrl: string;
      qrCode: string;
    };
  };

  if (!response.ok || json.code !== "00" || !json.data) {
    throw new Error(
      `PayOS payment creation failed: [${json.code ?? response.status}] ${json.desc ?? response.statusText ?? "Unknown error"}`,
    );
  }

  const data = json.data;
  const vietQrImageUrl = buildVietQrImageUrl({
    bin: data.bin,
    accountNumber: data.accountNumber,
    amount: data.amount,
    description: data.description,
    accountName: data.accountName,
  });

  return {
    orderCode,
    amount: data.amount,
    description: data.description,
    bin: data.bin,
    accountNumber: data.accountNumber,
    accountName: data.accountName,
    checkoutUrl: data.checkoutUrl,
    qrCode: data.qrCode,
    status: data.status,
    vietQrImageUrl,
  };
}

/**
 * Fetches the status and payment details of an existing PayOS payment request.
 */
export async function getPayosPaymentInfo(
  orderCode: number,
): Promise<PayosPaymentInfoResult> {
  const response = await fetch(
    `https://api-merchant.payos.vn/v2/payment-requests/${orderCode}`,
    {
      method: "GET",
      headers: {
        "x-client-id": process.env.PAYOS_CLIENT_ID ?? "",
        "x-api-key": process.env.PAYOS_API_KEY ?? "",
      },
    },
  );

  const json = (await response.json()) as {
    code: string;
    desc?: string;
    data?: {
      orderCode: number;
      amount: number;
      amountPaid?: number;
      status: string;
      transactions?: unknown[];
    };
  };

  if (!response.ok || json.code !== "00" || !json.data) {
    throw new Error(
      `PayOS payment info failed: [${json.code ?? response.status}] ${json.desc ?? response.statusText ?? "Unknown error"}`,
    );
  }

  const data = json.data;
  return {
    orderCode,
    status: (data.status ?? "PENDING") as
      | "PAID"
      | "PENDING"
      | "PROCESSING"
      | "CANCELLED"
      | "EXPIRED",
    amount: Number(data.amount ?? 0),
    amountPaid: Number(data.amountPaid ?? 0),
    transactions: data.transactions ?? [],
  };
}

/**
 * Fulfills an order upon successful payment: updates subscription history and upgrades profile tiers in Supabase.
 * Strictly idempotent: if an orderCode has already been fulfilled (status === 'active' in DB or in-memory cache),
 * returns the existing subscription state immediately without recalculating expiresAt or re-applying mutations.
 */
export async function fulfillPayosOrder(
  params: FulfillPayosOrderParams,
): Promise<FulfillPayosOrderResult> {
  let resolvedUserId: string | null = null;
  let resolvedTier: PayosPlanId | null = null;
  let recordedUserId: string | null = null;
  let recordedAmount: number | null = null;
  let recordedStatus: string | null = null;
  let recordedExpiresAt: string | null = null;
  let recordedCogsCeilingUsd: number | undefined = undefined;

  const supabase = getSupabaseServerClient(params.userToken);
  if (supabase) {
    try {
      const { data: sub } = await supabase
        .from("user_subscriptions")
        .select("id, user_id, tier, amount, status, expires_at, cogs_ceiling_usd")
        .eq("id", `payos_${params.orderCode}`)
        .maybeSingle();

      if (sub?.user_id) {
        recordedUserId = sub.user_id;
        resolvedUserId = sub.user_id;
      }
      if (
        sub?.tier === "trial_24h" ||
        sub?.tier === "cram_pass" ||
        sub?.tier === "pro" ||
        sub?.tier === "pro_monthly" ||
        sub?.tier === "tutor" ||
        sub?.tier === "pro_semester" ||
        sub?.tier === "tutor_guild"
      ) {
        resolvedTier = sub.tier;
      }
      if (typeof sub?.amount === "number") {
        recordedAmount = sub.amount;
      }
      if (typeof (sub as { status?: string })?.status === "string") {
        recordedStatus = (sub as { status?: string }).status ?? null;
      }
      if (typeof (sub as { expires_at?: string | null })?.expires_at === "string") {
        recordedExpiresAt = (sub as { expires_at?: string | null }).expires_at ?? null;
      }
      if (typeof (sub as { cogs_ceiling_usd?: number })?.cogs_ceiling_usd === "number") {
        recordedCogsCeilingUsd = (sub as { cogs_ceiling_usd?: number }).cogs_ceiling_usd;
      }
    } catch {
      // Safe ignore DB query error
    }

    if (!recordedAmount) {
      try {
        const { data: po } = await supabase
          .from("pending_orders")
          .select("user_id, tier, amount, expected_amount_vnd, status, expires_at")
          .eq("id", `payos_${params.orderCode}`)
          .maybeSingle();
        if (typeof po?.amount === "number") {
          recordedAmount = po.amount;
        } else if (
          typeof (po as { expected_amount_vnd?: number })?.expected_amount_vnd ===
          "number"
        ) {
          recordedAmount =
            (po as { expected_amount_vnd?: number }).expected_amount_vnd ?? null;
        }
        if (!recordedUserId && po?.user_id) {
          recordedUserId = po.user_id;
          resolvedUserId = po.user_id;
        }
        if (!resolvedTier && po?.tier) {
          resolvedTier = po.tier as PayosPlanId;
        }
        if (!recordedStatus && typeof (po as { status?: string })?.status === "string") {
          recordedStatus = (po as { status?: string }).status ?? null;
        }
        if (
          !recordedExpiresAt &&
          typeof (po as { expires_at?: string | null })?.expires_at === "string"
        ) {
          recordedExpiresAt = (po as { expires_at?: string | null }).expires_at ?? null;
        }
      } catch {
        // Safe ignore pending_orders query error
      }
    }
  }

  // Idempotency Check 1: Database record already has status === 'active'
  if (recordedStatus === "active") {
    const cached = fulfilledOrderCache.get(params.orderCode);
    const idempotentTier =
      resolvedTier ??
      cached?.tier ??
      decodePlanFromOrderCode(params.orderCode, params.amount);
    const idempotentExpiresAt = recordedExpiresAt ?? cached?.expiresAt ?? null;
    const idempotentUserId = resolvedUserId ?? cached?.userId ?? null;
    const isSandboxExisting =
      idempotentTier === "trial_24h" ||
      recordedAmount === SANDBOX_TEST_AMOUNT_VND ||
      params.amount === SANDBOX_TEST_AMOUNT_VND ||
      params.expectedAmount === SANDBOX_TEST_AMOUNT_VND;
    const cogsUsd =
      recordedCogsCeilingUsd ??
      cached?.cogsCeilingUsd ??
      (isSandboxExisting ? SANDBOX_COGS_CAP_USD : undefined);

    return {
      fulfilled: true,
      alreadyFulfilled: true,
      status: "active",
      userId: idempotentUserId,
      tier: idempotentTier ?? null,
      planId: idempotentTier ?? null,
      expiresAt: idempotentExpiresAt,
      expires_at: idempotentExpiresAt,
      ...(cogsUsd !== undefined ? { cogsCeilingUsd: cogsUsd } : {}),
    };
  }

  // Idempotency Check 2: In-memory cache tracks fulfilled orderCodes within this process
  const cachedFulfillment = fulfilledOrderCache.get(params.orderCode);
  if (
    cachedFulfillment &&
    recordedStatus !== "pending" &&
    (!recordedUserId || recordedUserId === cachedFulfillment.userId)
  ) {
    return {
      fulfilled: true,
      alreadyFulfilled: true,
      status: "active",
      userId: cachedFulfillment.userId,
      tier: cachedFulfillment.tier,
      planId: cachedFulfillment.tier,
      expiresAt: cachedFulfillment.expiresAt,
      expires_at: cachedFulfillment.expiresAt,
      ...(cachedFulfillment.cogsCeilingUsd !== undefined
        ? { cogsCeilingUsd: cachedFulfillment.cogsCeilingUsd }
        : {}),
    };
  }

  // Verify expected amount matching pendingOrder.amount if available
  const targetExpectedAmount =
    typeof params.expectedAmount === "number"
      ? params.expectedAmount
      : recordedAmount;

  if (
    typeof params.amount === "number" &&
    typeof targetExpectedAmount === "number" &&
    params.amount !== targetExpectedAmount
  ) {
    console.warn(
      `[PayOS] Refusing fulfillment for orderCode ${params.orderCode}: received amount ${params.amount} does not match expected amount ${targetExpectedAmount}.`,
    );
    return {
      fulfilled: false,
      userId: resolvedUserId ?? null,
      tier: resolvedTier ?? null,
      expiresAt: null,
    };
  }

  if (
    typeof params.expectedAmount === "number" &&
    typeof recordedAmount === "number" &&
    params.expectedAmount !== recordedAmount
  ) {
    console.warn(
      `[PayOS] Refusing fulfillment for orderCode ${params.orderCode}: params.expectedAmount ${params.expectedAmount} does not match recorded DB amount ${recordedAmount}.`,
    );
    return {
      fulfilled: false,
      userId: resolvedUserId ?? null,
      tier: resolvedTier ?? null,
      expiresAt: null,
    };
  }

  // Guard against order hijacking:
  // 1. If an order was already recorded for a specific user_id in the database,
  // ensure resolvedUserId strictly uses that database user_id.
  if (recordedUserId) {
    resolvedUserId = recordedUserId;
    if (params.fallbackUserId && params.fallbackUserId !== recordedUserId) {
      console.warn(
        `[PayOS] Potential order hijack detected for orderCode ${params.orderCode}: fallbackUserId "${params.fallbackUserId}" does not match recorded owner "${recordedUserId}". Guarded against hijacking; keeping original owner.`,
      );
    }
  } else if (params.fallbackUserId) {
    // 2. If no user_id was previously recorded in DB, fallbackUserId is only accepted
    // if verified against the calling context (e.g. valid auth token or offline/test mode).
    const candidateUserId = params.fallbackUserId.trim();
    if (candidateUserId) {
      if (supabase && params.userToken) {
        try {
          const {
            data: { user },
            error: authError,
          } = await supabase.auth.getUser(params.userToken);

          if (!authError && user?.id === candidateUserId) {
            resolvedUserId = candidateUserId;
          } else {
            console.warn(
              `[PayOS] Refusing fallbackUserId "${candidateUserId}" for orderCode ${params.orderCode}: userToken does not authenticate this user.`,
            );
          }
        } catch {
          console.warn(
            `[PayOS] Failed to authenticate fallbackUserId "${candidateUserId}" for orderCode ${params.orderCode}.`,
          );
        }
      } else if (
        !params.userToken &&
        isSupabaseServerConfigured() &&
        typeof supabase?.auth?.getUser === "function"
      ) {
        console.warn(
          `[PayOS] Refusing unauthenticated fallbackUserId "${candidateUserId}" for orderCode ${params.orderCode}: no userToken provided.`,
        );
      } else {
        // Fallback for tests or local environments without Supabase auth configured
        resolvedUserId = candidateUserId;
      }
    }
  }

  if (!resolvedTier) {
    resolvedTier = decodePlanFromOrderCode(params.orderCode, params.amount);
  }

  let expiresAt: string | null = null;
  const fulfilled = Boolean(resolvedUserId && resolvedTier);

  const defaultPlanAmount =
    resolvedTier && EXPECTED_PLAN_AMOUNTS_VND[resolvedTier]
      ? EXPECTED_PLAN_AMOUNTS_VND[resolvedTier]
      : 69000;
  const finalAmount =
    typeof params.amount === "number" && params.amount > 0
      ? params.amount
      : (targetExpectedAmount ?? defaultPlanAmount);

  const isSandbox =
    resolvedTier === "trial_24h" ||
    finalAmount === SANDBOX_TEST_AMOUNT_VND ||
    recordedAmount === SANDBOX_TEST_AMOUNT_VND ||
    params.expectedAmount === SANDBOX_TEST_AMOUNT_VND;

  if (!isSandbox && resolvedTier) {
    const expectedPlanAmount = EXPECTED_PLAN_AMOUNTS_VND[resolvedTier];
    if (
      typeof expectedPlanAmount === "number" &&
      (finalAmount < expectedPlanAmount ||
        (typeof params.amount === "number" && params.amount < expectedPlanAmount))
    ) {
      console.warn(
        `[PayOS] Refusing fulfillment for orderCode ${params.orderCode}: paid amount ${params.amount ?? finalAmount} is less than expected plan amount ${expectedPlanAmount} for tier "${resolvedTier}".`,
      );
      return {
        fulfilled: false,
        userId: resolvedUserId ?? null,
        tier: resolvedTier ?? null,
        expiresAt: null,
      };
    }
  }

  if (fulfilled && resolvedUserId && resolvedTier) {
    expiresAt = resolvePayosTierExpiration(resolvedTier);
    const now = new Date().toISOString();
    const cycle = getPlanBillingCycle(resolvedTier);
    const profileTier =
      resolvedTier === "trial_24h" ? "cram_pass" : normalizeTier(resolvedTier);
    const cogsCeilingUsd = isSandbox ? SANDBOX_COGS_CAP_USD : undefined;

    fulfilledOrderCache.set(params.orderCode, {
      userId: resolvedUserId,
      tier: resolvedTier,
      expiresAt: expiresAt ?? now,
      amount: finalAmount,
      ...(cogsCeilingUsd !== undefined ? { cogsCeilingUsd } : {}),
    });

    if (supabase) {
      try {
        const subPayload: Record<string, unknown> = {
          id: `payos_${params.orderCode}`,
          user_id: resolvedUserId,
          tier: resolvedTier,
          cycle,
          amount: finalAmount,
          currency: "VND",
          payment_method: "payos_vietqr",
          status: "active",
          starts_at: now,
          expires_at: expiresAt,
        };
        if (isSandbox) {
          subPayload.cogs_ceiling_usd = SANDBOX_COGS_CAP_USD;
        }
        const { error: subErr } = await supabase
          .from("user_subscriptions")
          .upsert(subPayload);
        if (subErr && isSandbox) {
          delete subPayload.cogs_ceiling_usd;
          await supabase.from("user_subscriptions").upsert(subPayload);
        }
      } catch {
        // Safe fallback
      }

      try {
        const quotaPayload: Record<string, unknown> = {
          user_id: `user:${resolvedUserId}`,
          tier: profileTier,
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
        };
        if (isSandbox) {
          quotaPayload.cogs_ceiling_usd = SANDBOX_COGS_CAP_USD;
        }
        const { error: quotaErr } = await supabase.from("user_quota_ledgers").upsert(
          quotaPayload,
          { onConflict: "user_id" },
        );
        if (quotaErr) {
          const fallbackPayload: Record<string, unknown> = {
            user_id: `user:${resolvedUserId}`,
            tier: profileTier,
            deck_credits_used: 0,
            cogs_spent_usd: 0,
            daily_burst_used: 0,
            updated_at: now,
          };
          if (isSandbox) {
            fallbackPayload.cogs_ceiling_usd = SANDBOX_COGS_CAP_USD;
          }
          await supabase.from("user_quota_ledgers").upsert(
            fallbackPayload,
            { onConflict: "user_id" },
          );
        }
        await invalidateUserQuotaLedgerCache(resolvedUserId);
      } catch {
        // Safe fallback if user_quota_ledgers table is pending migration
        try {
          await invalidateUserQuotaLedgerCache(resolvedUserId);
        } catch {
          // ignore
        }
      }

      try {
        const profilePayload: Record<string, unknown> = {
          id: resolvedUserId,
          tier: profileTier,
          tier_expires_at: expiresAt,
          updated_at: now,
        };
        if (isSandbox) {
          profilePayload.cogs_ceiling_usd = SANDBOX_COGS_CAP_USD;
        }
        const { error: profErr } = await supabase
          .from("profiles")
          .upsert(profilePayload);
        if (profErr && isSandbox) {
          delete profilePayload.cogs_ceiling_usd;
          await supabase.from("profiles").upsert(profilePayload);
        }
      } catch {
        try {
          await supabase
            .from("profiles")
            .update({
              tier: profileTier,
              tier_expires_at: expiresAt,
              updated_at: now,
            })
            .eq("id", resolvedUserId);
        } catch {
          // ignore
        }
      }

      try {
        const userProfilePayload: Record<string, unknown> = {
          id: resolvedUserId,
          tier: profileTier,
          tier_expires_at: expiresAt,
          updated_at: now,
        };
        if (isSandbox) {
          userProfilePayload.cogs_ceiling_usd = SANDBOX_COGS_CAP_USD;
        }
        const { error: uProfErr } = await supabase
          .from("user_profiles")
          .upsert(userProfilePayload);
        if (uProfErr && isSandbox) {
          delete userProfilePayload.cogs_ceiling_usd;
          await supabase.from("user_profiles").upsert(userProfilePayload);
        }
      } catch {
        try {
          await supabase
            .from("user_profiles")
            .update({
              tier: profileTier,
              tier_expires_at: expiresAt,
              updated_at: now,
            })
            .eq("id", resolvedUserId);
        } catch {
          // ignore
        }
      }

      try {
        const appMetadata: Record<string, unknown> = {
          tier: profileTier,
          plan_id: resolvedTier,
          tier_expires_at: expiresAt,
        };
        if (isSandbox) {
          appMetadata.cogs_ceiling_usd = SANDBOX_COGS_CAP_USD;
          appMetadata.cogs_limit_usd = SANDBOX_COGS_CAP_USD;
          appMetadata.is_sandbox = true;
        }
        await supabase.auth.admin.updateUserById(resolvedUserId, {
          app_metadata: appMetadata,
        });
      } catch {
        // ignore admin auth failure
      }
    }
  }

  return {
    fulfilled,
    alreadyFulfilled: false,
    ...(fulfilled ? { status: "active" } : {}),
    userId: resolvedUserId ?? null,
    tier: resolvedTier ?? null,
    planId: resolvedTier ?? null,
    expiresAt,
    expires_at: expiresAt,
    ...(isSandbox ? { cogsCeilingUsd: SANDBOX_COGS_CAP_USD } : {}),
  };
}
