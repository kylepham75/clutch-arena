import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { redeemSquadInviteCode } from "@/lib/payments/squad-invites";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAllowedOrigin } from "@/lib/utils";

export const runtime = "nodejs";

const MAX_REDEEM_BODY_BYTES = 8_192;

const RedeemRequestSchema = z
  .object({
    code: z.string().trim().min(6).max(32),
  })
  .strict();

type BoundedJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; status: 400 | 413; code: string; error: string };

async function readBoundedJson(request: Request): Promise<BoundedJsonResult> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REDEEM_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        error: "Request body exceeds maximum allowed size.",
      };
    }
  }

  let rawText: string;

  if (request.body && typeof request.body.getReader === "function") {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_REDEEM_BODY_BYTES) {
            await reader.cancel().catch(() => {});
            return {
              ok: false,
              status: 413,
              code: "PAYLOAD_TOO_LARGE",
              error: "Request body exceeds maximum allowed size.",
            };
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const buffer = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    );
    rawText = buffer.toString("utf8");
  } else if (typeof request.text === "function") {
    rawText = await request.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_REDEEM_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        error: "Request body exceeds maximum allowed size.",
      };
    }
  } else {
    const body = await request.json();
    const serialized = JSON.stringify(body ?? null);
    if (Buffer.byteLength(serialized, "utf8") > MAX_REDEEM_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        error: "Request body exceeds maximum allowed size.",
      };
    }
    return { ok: true, data: body };
  }

  if (!rawText.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_JSON",
      error: "Request body must be valid JSON.",
    };
  }

  try {
    return { ok: true, data: JSON.parse(rawText) };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "INVALID_JSON",
      error: "Request body must be valid JSON.",
    };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isAllowedOrigin(request.headers.get("origin"), request)) {
      return NextResponse.json(
        { ok: false, code: "FORBIDDEN_ORIGIN", error: "Origin not allowed." },
        { status: 403 },
      );
    }

    const auth = await verifyAuthToken(request);
    if (!auth.authenticated || !auth.user?.id) {
      return NextResponse.json(
        { ok: false, code: "AUTH_REQUIRED", error: "Authentication required." },
        { status: 401 },
      );
    }

    const rate = await checkRateLimit(`squad-redeem:${auth.user.id}`, "telemetry", auth.tier);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: "RATE_LIMITED",
          error: "Too many invite redemption attempts. Please try again later.",
          retryAfter: rate.retryAfter,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfter) },
        },
      );
    }

    const boundedBody = await readBoundedJson(request);
    if (!boundedBody.ok) {
      return NextResponse.json(
        { ok: false, code: boundedBody.code, error: boundedBody.error },
        { status: boundedBody.status },
      );
    }

    const parsed = RedeemRequestSchema.safeParse(boundedBody.data);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "INVALID_CODE", error: "Invalid squad invite code." },
        { status: 400 },
      );
    }

    const result = await redeemSquadInviteCode({
      code: parsed.data.code,
      redeemerUserId: auth.user.id,
      userToken: auth.token,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: result.code,
          error: result.error,
        },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        tier: result.tier,
        expiresAt: result.expiresAt,
        preservedHigherTier: result.preservedHigherTier,
        invite: result.invite,
      },
      { status: 200 },
    );
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        error: "Unable to redeem squad invite code right now.",
      },
      { status: 500 },
    );
  }
}
