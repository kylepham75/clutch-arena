import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  createUsdCheckoutSession,
  isUsdCheckoutConfigured,
  type UsdPlanId,
} from "@/lib/payments/polar";
import { resolveTrustedPayosOrigin } from "@/lib/payments/payos";
import { extractAuthToken, verifyAuthToken } from "@/lib/auth/server-guard";

export const runtime = "nodejs";

const VALID_USD_PLANS = new Set<UsdPlanId>([
  "cram_pass",
  "pro_monthly",
  "pro",
  "pro_semester",
  "tutor",
  "tutor_guild",
]);

export async function POST(request: Request) {
  try {
    if (!isUsdCheckoutConfigured()) {
      return NextResponse.json(
        { ok: false, error: "USD checkout is not configured on the server." },
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
            "Authentication required. Please sign in or create an account before checkout.",
        },
        { status: 401 },
      );
    }

    const { planId } = body;
    if (
      typeof planId !== "string" ||
      !VALID_USD_PLANS.has(planId as UsdPlanId)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid planId. Must be one of: cram_pass, pro_monthly, pro, tutor.",
        },
        { status: 400 },
      );
    }

    const origin = resolveTrustedPayosOrigin(request.headers.get("origin"));
    const userToken = auth.token ?? (extractAuthToken(request) ?? undefined);

    const checkout = await createUsdCheckoutSession({
      planId: planId as UsdPlanId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      origin,
      userToken,
    });

    return NextResponse.json({ ok: true, checkout });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "api/payments/usd/create" },
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to create USD checkout session",
      },
      { status: 500 },
    );
  }
}
