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
    let userId: string | undefined = auth.authenticated ? auth.user.id : undefined;

    if (!userId && typeof body.userId === "string" && body.userId.trim()) {
      const candidateId = body.userId.trim();
      const { getSupabaseServerClient } = await import("@/lib/supabase/server");
      const supabase = getSupabaseServerClient();
      if (supabase) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", candidateId)
          .maybeSingle();
        if (profile?.id) {
          userId = profile.id;
        }
      }
    }

    const isDev = !auth.authenticated && auth.devMode;
    if (!userId && !isDev) {
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

    const authHeader = request.headers.get("authorization");
    const userToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

    const payment = await createPayosPaymentLink({
      planId: planId as PayosPlanId,
      origin,
      userId,
      userToken,
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
