import { NextResponse } from "next/server";
import {
  createPayosPaymentLink,
  isPayosConfigured,
  type PayosPlanId,
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
    if (!auth.authenticated && !auth.devMode) {
      return NextResponse.json(
        {
          ok: false,
          error: "AUTH_REQUIRED",
          message:
            "Vui lòng đăng nhập tài khoản trước khi thanh toán để hệ thống gắn gói nâng cấp vào tài khoản của bạn.",
        },
        { status: 401 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const { planId } = body;
    if (planId !== "cram_pass" && planId !== "pro") {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid planId. Must be 'cram_pass' or 'pro'.",
        },
        { status: 400 },
      );
    }

    const origin =
      request.headers.get("origin") || new URL(request.url).origin;

    const userId = auth.authenticated
      ? auth.user.id
      : typeof body.userId === "string" && body.userId.trim()
        ? body.userId.trim()
        : undefined;

    const payment = await createPayosPaymentLink({
      planId: planId as PayosPlanId,
      origin,
      userId,
    });

    return NextResponse.json({ ok: true, payment });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Failed to create payment link",
      },
      { status: 500 },
    );
  }
}
