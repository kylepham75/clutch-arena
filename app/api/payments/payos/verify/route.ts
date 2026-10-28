import { NextResponse } from "next/server";
import {
  fulfillPayosOrder,
  getPayosPaymentInfo,
  isPayosConfigured,
} from "@/lib/payments/payos";
import { verifyAuthToken } from "@/lib/auth/server-guard";

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

    if (info.status === "PAID") {
      const result = await fulfillPayosOrder({
        orderCode: orderCodeNum,
        amount: info.amount,
        fallbackUserId: auth.authenticated
          ? auth.user.id
          : typeof body.userId === "string" && body.userId.trim()
            ? body.userId.trim()
            : undefined,
      });

      return NextResponse.json({
        ok: true,
        paid: true,
        status: info.status,
        tier: result.tier,
        expiresAt: result.expiresAt,
        fulfilled: result.fulfilled,
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
