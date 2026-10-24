import "server-only";
import { isAllowedOrigin } from "@/lib/utils";
import { getClientIp } from "@/lib/rate-limit";
import {
  MAX_TELEMETRY_BODY_BYTES,
  clientTelemetryPayloadSchema,
} from "@/lib/schemas/telemetry";
import {
  checkTelemetryRateLimit,
  recordTelemetryEvent,
} from "@/lib/telemetry/recorder";
import {
  verifyAuthToken,
  type AuthVerificationResult,
} from "@/lib/auth/server-guard";

export interface TelemetryHandlerDependencies {
  verifyAuth?: (request: Request) => Promise<AuthVerificationResult>;
  recordTelemetry?: typeof recordTelemetryEvent;
  checkRateLimit?: typeof checkTelemetryRateLimit;
}

export function createTelemetryHandler(dependencies?: TelemetryHandlerDependencies) {
  const verifyAuth = dependencies?.verifyAuth ?? verifyAuthToken;
  const recordTelemetry = dependencies?.recordTelemetry ?? recordTelemetryEvent;
  const checkRateLimit = dependencies?.checkRateLimit ?? checkTelemetryRateLimit;

  return async function handleTelemetry(request: Request): Promise<Response> {
    try {
      // 1. Verify request origin
      const origin = request.headers.get("origin");
      if (!isAllowedOrigin(origin, request)) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "ORIGIN_NOT_ALLOWED",
              message: "Requests must originate from this application.",
            },
          },
          {
            status: 403,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      // 2. Enforce MAX_TELEMETRY_BODY_BYTES on raw request body byte length
      let rawText: string;
      try {
        rawText = await request.text();
      } catch {
        return Response.json(
          {
            ok: false,
            error: {
              code: "INVALID_TELEMETRY_PAYLOAD",
              message: "Unable to read request payload.",
            },
          },
          {
            status: 400,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      const byteLength = new TextEncoder().encode(rawText).byteLength;
      if (byteLength > MAX_TELEMETRY_BODY_BYTES) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: `Telemetry payload exceeds maximum size limit of ${MAX_TELEMETRY_BODY_BYTES} bytes.`,
            },
          },
          {
            status: 413,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      // 3. Rate limiting check
      const clientIp = getClientIp(request);
      const rateLimitResult = checkRateLimit(clientIp);
      if (!rateLimitResult.allowed) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "RATE_LIMITED",
              message: "Rate limit exceeded. Please try again later.",
            },
          },
          {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": String(rateLimitResult.retryAfter),
            },
          },
        );
      }

      // 4. Parse JSON & validate against clientTelemetryPayloadSchema
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        return Response.json(
          {
            ok: false,
            error: {
              code: "INVALID_TELEMETRY_PAYLOAD",
              message: "Malformed JSON payload.",
            },
          },
          {
            status: 400,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      const parseResult = clientTelemetryPayloadSchema.safeParse(parsedJson);
      if (!parseResult.success) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "INVALID_TELEMETRY_PAYLOAD",
              message: "Telemetry payload validation failed.",
              issues: parseResult.error.issues,
            },
          },
          {
            status: 400,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      // 5. Resolve auth & record event
      const auth = await verifyAuth(request);
      const userId = auth.authenticated ? auth.user.id : null;

      let token: string | undefined;
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const extracted = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (extracted) token = extracted;
      }

      await recordTelemetry(parseResult.data, {
        userId,
        token,
        ip: clientIp,
      });

      return Response.json(
        {
          ok: true,
          recorded: true,
        },
        {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch {
      return Response.json(
        {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred while processing telemetry.",
          },
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  };
}
