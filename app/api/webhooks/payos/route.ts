import { NextResponse } from "next/server";
import {
  fulfillPayosOrder,
  isAdminTestEmail,
  SANDBOX_TEST_AMOUNT_VND,
  verifyPayosWebhookSignature,
} from "@/lib/payments/payos";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
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
      const supabase = getSupabaseServerClient();

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
    return NextResponse.json(
      {
        error: -1,
        message:
          err instanceof Error ? err.message : "Webhook processing failed",
        data: null,
      },
      { status: 500 },
    );
  }
}
