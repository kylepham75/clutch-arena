import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getAuthoritativeBillingRegion } from "@/lib/pricing/region";
import { TIER_LIMITS } from "@/lib/pricing/tiers";
import {
  getClientIp,
  getRollingQuotaSnapshot,
  toClientQuota,
  toUserTier,
} from "@/lib/rate-limit";
import { isAllowedOrigin } from "@/lib/utils";

export async function GET(request: Request) {
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
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const auth = await verifyAuthToken(request);
  const region = getAuthoritativeBillingRegion(request);
  const clientIp = getClientIp(request);
  const actorKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
  const userTier = toUserTier(auth.tier);
  const limits = TIER_LIMITS[userTier] ?? TIER_LIMITS.contender;

  const snapshot = await getRollingQuotaSnapshot(actorKey, auth.tier, region);

  return Response.json(
    {
      ok: true,
      authenticated: auth.authenticated,
      tier: userTier,
      quota: toClientQuota(snapshot),
      limits: {
        canUseNotes: limits.canUseClutchNotes,
        canExportPdf: limits.canExportCheatSheet,
        maxQuestionsPerRun: limits.maxQuestionsPerRun,
        maxFilesPerUpload: limits.maxFilesPerUpload,
        freeRegenerationsPerDeck: limits.freeRegenerationsPerDeck,
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
