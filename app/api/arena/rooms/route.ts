import { NextResponse } from "next/server";
import {
  createRoom,
  getAllRooms,
  generateRoomCode,
  getClientState,
  getPlayerToken,
} from "@/lib/multiplayer/room-manager";
import { createRoomSchema } from "@/lib/schemas/multiplayer";
import { getPartyHost } from "@/lib/multiplayer/party-config";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getMaxArenaPlayersForTier, type UserTier } from "@/lib/pricing/tiers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isAllowedOrigin } from "@/lib/utils";
import PartySocket from "partysocket";

export async function GET() {
  const partyHost = getPartyHost();
  if (partyHost) {
    try {
      const res = await PartySocket.fetch({
        host: partyHost,
        party: "arena",
        room: "__lobby__",
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data, { status: 200 });
      }
    } catch {
      // fallback to in-memory
    }
  }

  const rooms = getAllRooms().filter((r) => r.status === "lobby");
  return NextResponse.json({ ok: true, rooms }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    if (!isAllowedOrigin(req.headers.get("origin"), req)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "Requests must originate from this application.",
          },
        },
        { status: 403 },
      );
    }

    const auth = await verifyAuthToken(req);
    const tier: UserTier = auth.tier === "guest" ? "contender" : auth.tier;
    const userId = auth.authenticated ? auth.user.id : undefined;

    if (
      process.env.NODE_ENV !== "test" ||
      req.headers.get("x-enforce-rate-limit") === "true"
    ) {
      const rateLimitKey = userId ? `user:${userId}` : `ip:${getClientIp(req)}`;
      const rl = await checkRateLimit(rateLimitKey, "arena", tier);
      if (!rl.allowed) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many arena room requests. Please wait a moment.",
            },
          },
          { status: 429, headers: { "Retry-After": rl.retryAfter.toString() } },
        );
      }
    }

    const json = await req.json();
    const parsed = createRoomSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const resolved = { userId, tier };
    const tierCap = getMaxArenaPlayersForTier(resolved.tier);
    const effectiveHostTier: UserTier =
      resolved.userId || resolved.tier !== "contender"
        ? resolved.tier
        : "contender";
    const effectiveMaxPlayers = Math.min(
      parsed.data.maxPlayers ?? tierCap,
      tierCap,
    );

    const partyHost = getPartyHost();
    if (partyHost) {
      const internalSecret =
        process.env.PARTYKIT_INTERNAL_SECRET?.trim() ||
        (process.env.NODE_ENV === "test" ? "1" : "");

      if (!internalSecret) {
        console.error(
          "[Arena Rooms] PARTYKIT_INTERNAL_SECRET is missing while PartyKit host is configured.",
        );
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "PARTYKIT_NOT_CONFIGURED",
              message: "Multiplayer server secret is not configured.",
            },
          },
          { status: 503 },
        );
      }

      const code = generateRoomCode();
      try {
        const partyRes = await PartySocket.fetch(
          {
            host: partyHost,
            party: "arena",
            room: code,
            path: "/init",
          },
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-party-internal": internalSecret,
            },
            body: JSON.stringify({
              ...parsed.data,
              hostTier: effectiveHostTier,
              maxPlayers: effectiveMaxPlayers,
            }),
          },
        );

        if (partyRes.ok) {
          const partyData = await partyRes.json();
          return NextResponse.json(partyData, { status: 201 });
        }
      } catch (partyErr) {
        console.error("PartyKit room initialization fallback to local:", partyErr);
      }
    }

    const { room, hostPlayer } = createRoom({
      ...parsed.data,
      hostTier: effectiveHostTier,
      maxPlayers: effectiveMaxPlayers,
    });

    return NextResponse.json(
      {
        ok: true,
        code: room.code,
        room: getClientState(room, hostPlayer.id),
        hostPlayer,
        player: hostPlayer,
        playerToken: getPlayerToken(room.code, hostPlayer.id),
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      (err as { code?: string }).code === "ARENA_CAPACITY_EXCEEDED"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "ARENA_CAPACITY_EXCEEDED",
            message: "Arena server is currently at capacity. Please retry shortly.",
          },
        },
        { status: 503 },
      );
    }
    console.error(
      "[Arena Rooms] Failed to create room:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ROOM_CREATE_FAILED",
          message: "Failed to create room.",
        },
      },
      { status: 500 },
    );
  }
}
