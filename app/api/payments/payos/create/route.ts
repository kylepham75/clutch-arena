import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  createPayosPaymentLink,
  isPayosConfigured,
  resolveTrustedPayosOrigin,
  SANDBOX_TEST_AMOUNT_VND,
  type PayosPlanId,
} from "@/lib/payments/payos";
import { extractAuthToken, verifyAuthToken } from "@/lib/auth/server-guard";

export const runtime = "nodejs";

const VALID_PAYOS_PLANS = new Set<PayosPlanId>([
  "trial_24h",
  "cram_pass",
  "pro",
  "pro_monthly",
  "tutor",
  "pro_semester",
  "tutor_guild",
]);

export async function POST(request: Request) {
  try {
    if (!isPayosConfigured()) {
      return NextResponse.json(
        { ok: false, error: "PayOS is not configured on the server." },
        { status: 503 },
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

    const auth = await verifyAuthToken(request);
    if (!auth.authenticated || !auth.user?.id) {
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

    const userId = auth.user.id;
    const userEmail = auth.user.email;

    const { planId, amount } = body;
    if (
      typeof planId !== "string" ||
      !VALID_PAYOS_PLANS.has(planId as PayosPlanId)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid planId. Must be 'cram_pass' or 'pro'.",
        },
        { status: 400 },
      );
    }

    const origin = resolveTrustedPayosOrigin(request.headers.get("origin"));
    const userToken = auth.token ?? (extractAuthToken(request) ?? undefined);

    const payment = await createPayosPaymentLink({
      planId: planId as PayosPlanId,
      origin,
      userId,
      userToken,
      userEmail,
      ...(amount === SANDBOX_TEST_AMOUNT_VND
        ? { amount: SANDBOX_TEST_AMOUNT_VND }
        : {}),
    });

    return NextResponse.json({ ok: true, payment });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "api/payments/payos/create" },
    });
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
