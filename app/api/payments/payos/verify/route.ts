import { NextResponse } from "next/server";
import {
  fulfillPayosOrder,
  getPayosPaymentInfo,
  isPayosConfigured,
} from "@/lib/payments/payos";
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

    if (info.status === "PAID") {
      if (!auth.authenticated) {
        // Disallow arbitrary body.userId from unauthenticated callers.
        // Only fulfill if this order is already bound to a recorded user in DB.
        const result = await fulfillPayosOrder({
          orderCode: orderCodeNum,
          amount: info.amount,
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
        });
      }

      // Authenticated caller: pass auth.user.id and extracted userToken
      const result = await fulfillPayosOrder({
        orderCode: orderCodeNum,
        amount: info.amount,
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
