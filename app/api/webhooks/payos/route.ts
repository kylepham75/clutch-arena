import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  fulfillPayosOrder,
  isAdminTestEmail,
  SANDBOX_TEST_AMOUNT_VND,
  verifyPayosWebhookSignature,
} from "@/lib/payments/payos";
import { getSupabaseAdminOrServerClient } from "@/lib/supabase/server-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_PAYOS_WEBHOOK_BYTES = 131_072; // 128 KB

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
          { error: -1, message: "Too many webhook requests", data: null },
          { status: 429 },
        );
      }
    }

    const rawText = await readBoundedWebhookText(request, MAX_PAYOS_WEBHOOK_BYTES);
    if (rawText === null) {
      return NextResponse.json(
        { error: -1, message: "Webhook payload too large", data: null },
        { status: 413 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: -1, message: "Invalid JSON body", data: null },
        { status: 400 },
      );
    }

    const { code, data, signature } = body;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !signature ||
      typeof signature !== "string"
    ) {
      return NextResponse.json(
        { error: -1, message: "Missing webhook data or signature", data: null },
        { status: 400 },
      );
    }

    const webhookData = data as Record<string, unknown>;
    const isValid = verifyPayosWebhookSignature(webhookData, signature);
    if (!isValid) {
      return NextResponse.json(
        { error: -1, message: "Invalid webhook signature", data: null },
        { status: 400 },
      );
    }

    if (
      Number(webhookData.orderCode) === 123 ||
      webhookData.description === "VQRIO123"
    ) {
      return NextResponse.json(
        { error: 0, message: "Ok", data: null },
        { status: 200 },
      );
    }

    if (code === "00" && webhookData.orderCode) {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error(
          "[PayOS Webhook] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing in environment variables! Without this key, RLS will block background webhook fulfillment.",
        );
      }
      const orderCode = Number(webhookData.orderCode);
      const amount = Number(webhookData.amount);
      const supabase = getSupabaseAdminOrServerClient();

      let pendingOrder: {
        id?: string;
        user_id?: string | null;
        amount?: number | null;
        expected_amount_vnd?: number | null;
        tier?: string | null;
        status?: string | null;
      } | null = null;

      if (supabase) {
        try {
          const { data: sub } = await supabase
            .from("user_subscriptions")
            .select("id, user_id, amount, status, tier")
            .eq("id", `payos_${orderCode}`)
            .maybeSingle();
          if (sub) {
            pendingOrder = sub;
          }
        } catch (err) {
          console.error(
            "[PayOS Webhook] Error fetching pending order from user_subscriptions:",
            err,
          );
        }

        if (!pendingOrder) {
          try {
            const { data: po } = await supabase
              .from("pending_orders")
              .select("id, user_id, amount, expected_amount_vnd, status, tier")
              .eq("id", `payos_${orderCode}`)
              .maybeSingle();
            if (po) {
              pendingOrder = po;
            }
          } catch {
            // Safe ignore if pending_orders table does not exist
          }
        }
      }

      // Verify webhookData.amount === pendingOrder.amount
      const expectedAmount =
        typeof pendingOrder?.amount === "number"
          ? pendingOrder.amount
          : typeof pendingOrder?.expected_amount_vnd === "number"
            ? pendingOrder.expected_amount_vnd
            : undefined;

      if (
        pendingOrder &&
        typeof expectedAmount === "number" &&
        Number.isFinite(amount) &&
        amount !== expectedAmount
      ) {
        console.warn(
          `[PayOS Webhook] Security Warning: Payment amount mismatch for order ${orderCode}. Webhook amount: ${amount}, expected amount: ${expectedAmount}. Fulfillment aborted.`,
        );
        return NextResponse.json({
          error: 0,
          message: "Payment amount mismatch; skipped fulfillment",
          data: null,
        });
      }

      // If webhookData.amount === 5000 (SANDBOX_TEST_AMOUNT_VND), fetch user profile/auth email to verify against isAdminTestEmail
      if (amount === SANDBOX_TEST_AMOUNT_VND) {
        let userEmail: string | null = null;
        const targetUserId = pendingOrder?.user_id;

        if (supabase && targetUserId) {
          try {
            const { data: authUser } = await supabase.auth.admin.getUserById(targetUserId);
            if (authUser?.user?.email) {
              userEmail = authUser.user.email;
            }
          } catch {
            // Safe ignore admin auth lookup error
          }

          if (!userEmail) {
            try {
              const { data: profile } = await supabase
                .from("profiles")
                .select("email")
                .eq("id", targetUserId)
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
                .eq("id", targetUserId)
                .maybeSingle();
              if (userProfile?.email) {
                userEmail = userProfile.email;
              }
            } catch {
              // Safe ignore user profile lookup error
            }
          }
        }

        if (!isAdminTestEmail(userEmail)) {
          console.warn(
            `[PayOS Webhook] Security Warning: Sandbox test payment unauthorized for user "${targetUserId ?? "unknown"}" (email: "${userEmail ?? "none"}"). Order: ${orderCode}. Fulfillment aborted.`,
          );
          return NextResponse.json({
            error: 0,
            message: "Sandbox test unauthorized; skipped fulfillment",
            data: null,
          });
        }
      }

      const res = await fulfillPayosOrder({
        orderCode,
        amount: Number.isFinite(amount) ? amount : undefined,
        expectedAmount,
      });
      console.log("[PayOS Webhook] Fulfillment result for order", orderCode, res);
    }

    return NextResponse.json({ error: 0, message: "Ok", data: null });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "api/webhooks/payos" },
    });
    return NextResponse.json(
      {
        error: -1,
        message: "Webhook processing failed",
        data: null,
      },
      { status: 500 },
    );
  }
}
