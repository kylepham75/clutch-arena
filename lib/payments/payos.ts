import { createHmac, timingSafeEqual } from "node:crypto";
import {
  calculateTierExpiration,
  PRICING_PLANS,
  type UserTier,
} from "@/lib/pricing/tiers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type PayosPlanId = "cram_pass" | "pro";

export interface CreatePayosPaymentLinkInput {
  planId: PayosPlanId;
  origin: string;
  userId?: string;
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
}

export interface FulfillPayosOrderResult {
  fulfilled: boolean;
  userId: string | null;
  tier: PayosPlanId | null;
  expiresAt: string | null;
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
 * - 2 for pro
 * Safe within Number.MAX_SAFE_INTEGER (14-digit integer).
 */
export function generatePayosOrderCode(planId: PayosPlanId): number {
  let now = Date.now();
  if (now <= lastGeneratedTimestamp) {
    now = lastGeneratedTimestamp + 1;
  }
  lastGeneratedTimestamp = now;
  const planSuffix = planId === "pro" ? 2 : 1;
  return now * 10 + planSuffix;
}

/**
 * Decodes the purchased plan from the orderCode's last digit or falls back to amount.
 * - orderCode % 10 === 1 -> "cram_pass"
 * - orderCode % 10 === 2 -> "pro"
 * - amount === 5000 or 39000 or 69000 -> "cram_pass"
 * - amount === 149000 or 299000 -> "pro"
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
  if (amount === 5000 || amount === 39000 || amount === 69000) {
    return "cram_pass";
  }
  if (amount === 149000 || amount === 299000) {
    return "pro";
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
  const prefix = planId === "pro" ? "CLUTCH PRO" : "CLUTCH CRAM";
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
  const plan = PRICING_PLANS.find((p) => p.id === input.planId);
  if (!plan) {
    throw new Error(`Plan "${input.planId}" not found in PRICING_PLANS`);
  }

  const orderCode = generatePayosOrderCode(input.planId);
  const description = buildPayosDescription(input.planId, orderCode);
  const returnUrl = `${input.origin}/?payment=success&orderCode=${orderCode}`;
  const cancelUrl = `${input.origin}/?payment=cancelled&orderCode=${orderCode}`;

  const signature = computePayosPaymentSignature({
    amount: plan.priceVnd,
    cancelUrl,
    description,
    orderCode,
    returnUrl,
  });

  if (input.userId) {
    try {
      const supabase = getSupabaseServerClient();
      if (supabase) {
        await supabase.from("user_subscriptions").upsert({
          id: `payos_${orderCode}`,
          user_id: input.userId,
          tier: input.planId,
          cycle: plan.cycle,
          amount: plan.priceVnd,
          currency: "VND",
          payment_method: "payos_vietqr",
          status: "pending",
          expires_at: calculateTierExpiration(input.planId),
        });
      }
    } catch {
      // Ignore DB errors safely if table is not migrated yet
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
        amount: plan.priceVnd,
        description,
        cancelUrl,
        returnUrl,
        signature,
        items: [
          {
            name: plan.nameVi || plan.nameEn,
            quantity: 1,
            price: plan.priceVnd,
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
 */
export async function fulfillPayosOrder(
  params: FulfillPayosOrderParams,
): Promise<FulfillPayosOrderResult> {
  let resolvedUserId: string | null = null;
  let resolvedTier: PayosPlanId | null = null;

  const supabase = getSupabaseServerClient();
  if (supabase) {
    try {
      const { data: sub } = await supabase
        .from("user_subscriptions")
        .select("user_id, tier")
        .eq("id", `payos_${params.orderCode}`)
        .maybeSingle();

      if (sub?.user_id) {
        resolvedUserId = sub.user_id;
      }
      if (sub?.tier === "cram_pass" || sub?.tier === "pro") {
        resolvedTier = sub.tier;
      }
    } catch {
      // Safe ignore DB query error
    }
  }

  if (!resolvedUserId && params.fallbackUserId) {
    resolvedUserId = params.fallbackUserId;
  }

  if (!resolvedTier) {
    resolvedTier = decodePlanFromOrderCode(params.orderCode, params.amount);
  }

  let expiresAt: string | null = null;
  const fulfilled = Boolean(resolvedUserId && resolvedTier);

  if (fulfilled && resolvedUserId && resolvedTier) {
    expiresAt = calculateTierExpiration(resolvedTier);
    const now = new Date().toISOString();
    const cycle = resolvedTier === "pro" ? "semester" : "one_time";
    const amount =
      params.amount ?? (resolvedTier === "pro" ? 299000 : 69000);

    if (supabase) {
      try {
        await supabase.from("user_subscriptions").upsert({
          id: `payos_${params.orderCode}`,
          user_id: resolvedUserId,
          tier: resolvedTier,
          cycle,
          amount,
          currency: "VND",
          payment_method: "payos_vietqr",
          status: "active",
          starts_at: now,
          expires_at: expiresAt,
        });
      } catch {
        // Safe fallback
      }

      try {
        await supabase.from("profiles").upsert({
          id: resolvedUserId,
          tier: resolvedTier,
          tier_expires_at: expiresAt,
          updated_at: now,
        });
      } catch {
        try {
          await supabase
            .from("profiles")
            .update({
              tier: resolvedTier,
              tier_expires_at: expiresAt,
              updated_at: now,
            })
            .eq("id", resolvedUserId);
        } catch {
          // ignore
        }
      }

      try {
        await supabase.from("user_profiles").upsert({
          id: resolvedUserId,
          tier: resolvedTier,
          tier_expires_at: expiresAt,
          updated_at: now,
        });
      } catch {
        try {
          await supabase
            .from("user_profiles")
            .update({
              tier: resolvedTier,
              tier_expires_at: expiresAt,
              updated_at: now,
            })
            .eq("id", resolvedUserId);
        } catch {
          // ignore
        }
      }

      try {
        await supabase.auth.admin.updateUserById(resolvedUserId, {
          user_metadata: {
            tier: resolvedTier,
            tier_expires_at: expiresAt,
          },
        });
      } catch {
        // ignore admin auth failure
      }
    }
  }

  return {
    fulfilled,
    userId: resolvedUserId ?? null,
    tier: resolvedTier ?? null,
    expiresAt,
  };
}
