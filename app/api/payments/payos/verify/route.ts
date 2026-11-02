import { NextResponse } from "next/server";
import {
  fulfillPayosOrder,
  getPayosPaymentInfo,
  isAdminTestEmail,
  isPayosConfigured,
  SANDBOX_TEST_AMOUNT_VND,
} from "@/lib/payments/payos";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractAuthToken, verifyAuthToken } from "@/lib/auth/server-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isPayosConfigured()) {
      return NextResponse.json(
        { ok: false, error: "PayOS is not configured on the server." },
        { status: 503 },
      );
    }

    const auth = await verifyAuthToken(request);

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const orderCodeNum = Number(body?.orderCode);
    if (!Number.isInteger(orderCodeNum) || orderCodeNum <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid orderCode. Must be a positive integer." },
        { status: 400 },
      );
    }

    const info = await getPayosPaymentInfo(orderCodeNum);

    const userToken = auth.authenticated
      ? auth.token
      : (extractAuthToken(request) ?? undefined);

    const paidAmount = Number(
      typeof info.amountPaid === "number" && info.amountPaid > 0
        ? info.amountPaid
        : info.amount,
    );

    const supabase = getSupabaseServerClient(userToken);
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
          .eq("id", `payos_${orderCodeNum}`)
          .maybeSingle();
        if (sub) {
          pendingOrder = sub;
        }
      } catch {
        // Safe ignore DB query error
      }

      if (!pendingOrder) {
        try {
          const { data: po } = await supabase
            .from("pending_orders")
            .select("id, user_id, amount, expected_amount_vnd, status, tier")
            .eq("id", `payos_${orderCodeNum}`)
            .maybeSingle();
          if (po) {
            pendingOrder = po;
          }
        } catch {
          // Safe ignore if pending_orders table does not exist
        }
      }
    }

    if (info.status === "PAID") {
      // 1. Amount Verification
      const expectedAmount =
        typeof pendingOrder?.amount === "number"
          ? pendingOrder.amount
          : typeof pendingOrder?.expected_amount_vnd === "number"
            ? pendingOrder.expected_amount_vnd
            : undefined;

      if (
        pendingOrder &&
        typeof expectedAmount === "number" &&
        paidAmount !== expectedAmount
      ) {
        return NextResponse.json(
          { ok: false, error: "Payment amount mismatch" },
          { status: 400 },
        );
      }

      // 2. Sandbox Verification
      if (paidAmount === SANDBOX_TEST_AMOUNT_VND) {
        let callerEmail: string | null =
          (auth.authenticated && (auth.user as { email?: string })?.email) || null;

        if (!callerEmail && auth.authenticated && supabase && userToken) {
          try {
            const { data: authData } = await supabase.auth.getUser(userToken);
            callerEmail = authData?.user?.email ?? null;
          } catch {
            // Safe ignore auth lookup error
          }
        }

        if (!callerEmail && auth.authenticated && auth.user?.id && supabase) {
          try {
            const { data: adminUser } = await supabase.auth.admin.getUserById(auth.user.id);
            callerEmail = adminUser?.user?.email ?? null;
          } catch {
            // Safe ignore admin auth lookup error
          }
        }

        if (!callerEmail && pendingOrder?.user_id && supabase) {
          try {
            const { data: adminUser } = await supabase.auth.admin.getUserById(pendingOrder.user_id);
            callerEmail = adminUser?.user?.email ?? null;
          } catch {
            // Safe ignore admin auth lookup error
          }

          if (!callerEmail) {
            try {
              const { data: profile } = await supabase
                .from("profiles")
                .select("email")
                .eq("id", pendingOrder.user_id)
                .maybeSingle();
              callerEmail = profile?.email ?? null;
            } catch {
              // Safe ignore profile lookup error
            }
          }

          if (!callerEmail) {
            try {
              const { data: userProfile } = await supabase
                .from("user_profiles")
                .select("email")
                .eq("id", pendingOrder.user_id)
                .maybeSingle();
              callerEmail = userProfile?.email ?? null;
            } catch {
              // Safe ignore user profile lookup error
            }
          }
        }

        if (!callerEmail && typeof body?.email === "string") {
          callerEmail = body.email;
        }

        if (!isAdminTestEmail(callerEmail)) {
          return NextResponse.json(
            { ok: false, error: "Sandbox test payment unauthorized for this account" },
            { status: 403 },
          );
        }
      }

      const isSandboxOrder = paidAmount === SANDBOX_TEST_AMOUNT_VND;

      if (!auth.authenticated) {
        // Disallow arbitrary body.userId from unauthenticated callers.
        // Only fulfill if this order is already bound to a recorded user in DB.
        const result = await fulfillPayosOrder({
          orderCode: orderCodeNum,
          amount: paidAmount,
          expectedAmount,
        });

        if (!result.fulfilled) {
          return NextResponse.json({
            ok: true,
            paid: true,
            status: info.status,
            verified: false,
            requiresAuth: true,
          });
        }

        return NextResponse.json({
          ok: true,
          paid: true,
          status: info.status,
          tier: result.tier,
          expiresAt: result.expiresAt,
          fulfilled: result.fulfilled,
          ...(isSandboxOrder ? { cogsCeilingUsd: 0.05 } : {}),
        });
      }

      // Authenticated caller: pass auth.user.id and extracted userToken
      const result = await fulfillPayosOrder({
        orderCode: orderCodeNum,
        amount: paidAmount,
        expectedAmount,
        fallbackUserId: auth.user.id,
        userToken,
      });

      const isOwner = !result.userId || result.userId === auth.user.id;

      return NextResponse.json({
        ok: true,
        paid: true,
        status: info.status,
        tier: isOwner ? result.tier : null,
        expiresAt: isOwner ? result.expiresAt : null,
        fulfilled: result.fulfilled && isOwner,
        ...(isSandboxOrder ? { cogsCeilingUsd: 0.05 } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      paid: false,
      status: info.status,
      amount: info.amount,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Failed to verify payment",
      },
      { status: 500 },
    );
  }
}
