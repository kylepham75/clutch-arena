import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  fulfillUsdOrder,
  revokeUsdSubscription,
  verifyUsdWebhookSignature,
  type UsdPlanId,
} from "@/lib/payments/polar";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_WEBHOOK_BODY_BYTES = 131_072; // 128 KB

const VALID_USD_PLANS = new Set<string>([
  "cram_pass",
  "cram_squad_3",
  "pro_monthly",
  "pro",
  "pro_semester",
  "tutor",
  "tutor_guild",
]);

const REFUND_EVENTS = new Set([
  "order.refunded",
  "order_refunded",
  "order.disputed",
  "charge.refunded",
]);

const REVOCATION_EVENTS = new Set(["subscription.revoked"]);

const CANCELLATION_EVENTS = new Set([
  "subscription.canceled",
  "subscription.cancelled",
  "subscription_cancelled",
  "subscription.expired",
  "subscription_expired",
]);

async function readBoundedWebhookText(request: Request, maxBytes: number): Promise<string | null> {
  const cl = Number(request.headers.get("content-length"));
  if (Number.isFinite(cl) && cl > maxBytes) {
    return null;
  }
  if (!request.body) {
    const txt = await request.text();
    return Buffer.byteLength(txt, "utf8") <= maxBytes ? txt : null;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  try {
    if (
      process.env.NODE_ENV !== "test" ||
      request.headers.get("x-enforce-rate-limit") === "true"
    ) {
      const rl = await checkRateLimit(`ip:${getClientIp(request)}`, "arena", "guest");
      if (!rl.allowed) {
        return NextResponse.json(
          { ok: false, error: "Too many webhook requests" },
          { status: 429 },
        );
      }
    }

    let rawBody = "";
    try {
      const text = await readBoundedWebhookText(request, MAX_WEBHOOK_BODY_BYTES);
      if (text === null) {
        return NextResponse.json(
          { ok: false, error: "Webhook payload too large" },
          { status: 413 },
        );
      }
      rawBody = text;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Failed to read request body" },
        { status: 400 },
      );
    }

    const signatureHeader =
      request.headers.get("webhook-signature") ||
      request.headers.get("x-polar-signature") ||
      request.headers.get("x-signature");

    const webhookHeaders = {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
    };

    const isValid = verifyUsdWebhookSignature(
      rawBody,
      signatureHeader,
      undefined,
      webhookHeaders,
    );
    if (!isValid) {
      return NextResponse.json(
        { ok: false, error: "Invalid webhook signature" },
        { status: 400 },
      );
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    const eventType =
      (typeof payload.type === "string" ? payload.type : null) ||
      (typeof (payload.meta as Record<string, unknown> | undefined)?.event_name === "string"
        ? ((payload.meta as Record<string, unknown>).event_name as string)
        : null) ||
      (typeof payload.event === "string" ? payload.event : null);

    const dataObj =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const metaObj =
      payload.meta && typeof payload.meta === "object"
        ? (payload.meta as Record<string, unknown>)
        : {};
    const attrsObj =
      dataObj.attributes && typeof dataObj.attributes === "object"
        ? (dataObj.attributes as Record<string, unknown>)
        : {};

    const metadata =
      (dataObj.metadata && typeof dataObj.metadata === "object"
        ? (dataObj.metadata as Record<string, unknown>)
        : null) ||
      (metaObj.custom_data && typeof metaObj.custom_data === "object"
        ? (metaObj.custom_data as Record<string, unknown>)
        : null) ||
      (attrsObj.custom_data && typeof attrsObj.custom_data === "object"
        ? (attrsObj.custom_data as Record<string, unknown>)
        : null) ||
      {};

    const metadataUserId =
      (typeof metadata.userId === "string" && metadata.userId.trim()) ||
      (typeof metadata.user_id === "string" && metadata.user_id.trim()) ||
      null;
    const externalUserId =
      (typeof dataObj.customer_external_id === "string" &&
        dataObj.customer_external_id.trim()) ||
      (typeof dataObj.external_customer_id === "string" &&
        dataObj.external_customer_id.trim()) ||
      (typeof dataObj.user_id === "string" && dataObj.user_id.trim()) ||
      (typeof attrsObj.user_id === "string" && attrsObj.user_id.trim()) ||
      null;

    if (metadataUserId && externalUserId && metadataUserId !== externalUserId) {
      return NextResponse.json(
        { ok: false, error: "Webhook user identity mismatch" },
        { status: 400 },
      );
    }

    const resolvedWebhookUserId = metadataUserId || externalUserId;

    const candidateCheckoutIds = Array.from(
      new Set(
        [
          dataObj.checkout_id,
          metadata.checkoutId,
          metadata.checkout_id,
          metaObj.checkout_id,
          dataObj.id,
          dataObj.subscription_id,
          dataObj.order_id,
          payload.id,
          attrsObj.order_number,
        ]
          .filter((v) => typeof v === "string" || typeof v === "number")
          .map((v) => String(v).trim())
          .filter(Boolean),
      ),
    );
    const primaryCheckoutId = candidateCheckoutIds[0];
    const alternateCheckoutIds = candidateCheckoutIds.slice(1);

    // Handle refund, revocation, and cancellation events first
    if (
      eventType &&
      (REFUND_EVENTS.has(eventType) ||
        REVOCATION_EVENTS.has(eventType) ||
        CANCELLATION_EVENTS.has(eventType))
    ) {
      const reason: "refunded" | "revoked" | "cancelled" = REFUND_EVENTS.has(eventType)
        ? "refunded"
        : REVOCATION_EVENTS.has(eventType)
          ? "revoked"
          : "cancelled";

      await revokeUsdSubscription({
        checkoutId: primaryCheckoutId,
        alternateCheckoutIds,
        userId: resolvedWebhookUserId ?? undefined,
        reason,
      });

      return NextResponse.json({ ok: true, received: true, revoked: true, reason });
    }

    // Filter activation events
    const isPolarOrderPaid = eventType === "order.paid";
    const isPolarCheckoutSucceeded =
      eventType === "checkout.updated" && dataObj.status === "succeeded";
    const isPolarSubscription =
      eventType === "subscription.active" || eventType === "subscription.created";
    const isLemonSqueezyOrder =
      eventType === "order_created" || eventType === "subscription_created";

    const isRecognizedEvent =
      isPolarOrderPaid ||
      isPolarCheckoutSucceeded ||
      isPolarSubscription ||
      isLemonSqueezyOrder;

    if (isRecognizedEvent) {
      const rawPlanId =
        metadata.planId ||
        metadata.plan_id ||
        dataObj.planId ||
        dataObj.plan_id ||
        attrsObj.plan_id;

      const rawAmount =
        dataObj.amount ??
        metadata.amountUsd ??
        metadata.amount ??
        attrsObj.total_usd ??
        attrsObj.total;

      const customerEmail =
        (typeof dataObj.customer_email === "string" ? dataObj.customer_email : null) ||
        (typeof dataObj.email === "string" ? dataObj.email : null) ||
        (typeof attrsObj.user_email === "string" ? attrsObj.user_email : null);

      if (
        resolvedWebhookUserId &&
        rawPlanId &&
        primaryCheckoutId &&
        VALID_USD_PLANS.has(String(rawPlanId).toLowerCase())
      ) {
        const planId = String(rawPlanId).toLowerCase() as UsdPlanId;
        const amountUsd =
          typeof rawAmount === "number"
            ? rawAmount
            : typeof rawAmount === "string"
              ? parseFloat(rawAmount)
              : undefined;

        await fulfillUsdOrder({
          checkoutId: primaryCheckoutId,
          alternateCheckoutIds,
          userId: resolvedWebhookUserId,
          planId,
          amountUsd: Number.isFinite(amountUsd) ? amountUsd : undefined,
          requireAmount: true,
          customerEmail: customerEmail ?? undefined,
        });
      }
    }

    return NextResponse.json({ ok: true, received: true });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "api/webhooks/polar" },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to process USD payment webhook",
      },
      { status: 500 },
    );
  }
}
