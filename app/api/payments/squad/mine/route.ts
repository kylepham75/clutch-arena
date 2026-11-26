import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getUserSquadInvites } from "@/lib/payments/squad-invites";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await verifyAuthToken(request);
    if (!auth.authenticated || !auth.user?.id) {
      return NextResponse.json(
        { ok: false, code: "AUTH_REQUIRED", error: "Authentication required." },
        { status: 401 },
      );
    }

    const rate = await checkRateLimit(`squad-mine:${auth.user.id}`, "telemetry", auth.tier);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: "RATE_LIMITED",
          error: "Too many requests. Please try again later.",
          retryAfter: rate.retryAfter,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfter) },
        },
      );
    }

    const { purchased, redeemed } = await getUserSquadInvites({
      userId: auth.user.id,
      userToken: auth.token,
    });

    return NextResponse.json(
      {
        ok: true,
        purchased,
        redeemed,
      },
      { status: 200 },
    );
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        error: "Unable to load squad invites right now.",
      },
      { status: 500 },
    );
  }
}
