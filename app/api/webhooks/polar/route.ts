import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  fulfillUsdOrder,
  verifyUsdWebhookSignature,
  type UsdPlanId,
} from "@/lib/payments/polar";

export const runtime = "nodejs";

const VALID_USD_PLANS = new Set<string>([
  "cram_pass",
  "pro_monthly",
  "pro",
  "pro_semester",
  "tutor",
  "tutor_guild",
]);

export async function POST(request: Request) {
  try {
    let rawBody = "";
    try {
      rawBody = await request.text();
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

    const isValid = verifyUsdWebhookSignature(rawBody, signatureHeader);
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
        ? (payload.meta as Record<string, unknown>).event_name
        : null) ||
      (typeof payload.event === "string" ? payload.event : null);

    // Filter relevant events
    // Polar: order.paid, checkout.updated (succeeded), subscription.active, subscription.created
    // LemonSqueezy: order_created, subscription_created
    const isPolarOrderPaid = eventType === "order.paid";
    const isPolarCheckoutSucceeded =
      eventType === "checkout.updated" &&
      (payload.data as Record<string, unknown> | undefined)?.status === "succeeded";
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

      const rawUserId =
        metadata.userId ||
        metadata.user_id ||
        dataObj.customer_id ||
        dataObj.user_id ||
        attrsObj.user_id;

      const rawPlanId =
        metadata.planId ||
        metadata.plan_id ||
        dataObj.planId ||
        dataObj.plan_id ||
        attrsObj.plan_id;

      const rawCheckoutId =
        metadata.checkoutId ||
        metadata.checkout_id ||
        dataObj.id ||
        payload.id ||
        metaObj.checkout_id ||
        attrsObj.order_number;

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
        rawUserId &&
        rawPlanId &&
        rawCheckoutId &&
        VALID_USD_PLANS.has(String(rawPlanId).toLowerCase())
      ) {
        const checkoutId = String(rawCheckoutId);
        const userId = String(rawUserId);
        const planId = String(rawPlanId).toLowerCase() as UsdPlanId;
        const amountUsd =
          typeof rawAmount === "number"
            ? rawAmount
            : typeof rawAmount === "string"
              ? parseFloat(rawAmount)
              : undefined;

        await fulfillUsdOrder({
          checkoutId,
          userId,
          planId,
          amountUsd: Number.isFinite(amountUsd) ? amountUsd : undefined,
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
        error:
          err instanceof Error
            ? err.message
            : "Failed to process Polar.sh webhook",
      },
      { status: 500 },
    );
  }
}
