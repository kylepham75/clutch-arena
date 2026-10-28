import { NextResponse } from "next/server";
import { createRoom, getAllRooms, generateRoomCode } from "@/lib/multiplayer/room-manager";
import { createRoomSchema } from "@/lib/schemas/multiplayer";
import { getPartyHost } from "@/lib/multiplayer/party-config";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getMaxArenaPlayersForTier, type UserTier } from "@/lib/pricing/tiers";
import PartySocket from "partysocket";

async function resolveServerTier(req: Request): Promise<{ userId?: string; tier: UserTier }> {
  const auth = await verifyAuthToken(req);
  const tier: UserTier = auth.tier === "guest" ? "contender" : auth.tier;
  const userId = auth.authenticated ? auth.user.id : undefined;
  return { userId, tier };
}

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
    const json = await req.json();
    const parsed = createRoomSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const resolved = await resolveServerTier(req);
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
            headers: { "Content-Type": "application/json" },
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
        room,
        hostPlayer,
        player: hostPlayer,
      },
      { status: 201 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { message: err.message || "Failed to create room." } },
      { status: 500 },
    );
  }
}
