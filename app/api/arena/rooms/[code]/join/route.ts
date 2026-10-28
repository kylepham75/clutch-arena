import { NextResponse } from "next/server";
import { getRoom, joinRoom } from "@/lib/multiplayer/room-manager";
import { joinRoomSchema } from "@/lib/schemas/multiplayer";
import { getPartyHost } from "@/lib/multiplayer/party-config";
import PartySocket from "partysocket";

export async function POST(
  req: Request,
  props: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await props.params;
    const json = await req.json();
    const parsed = joinRoomSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const partyHost = getPartyHost();
    if (partyHost) {
      try {
        const partyRes = await PartySocket.fetch(
          {
            host: partyHost,
            party: "arena",
            room: code.toUpperCase(),
            path: "/join",
          },
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
          },
        );

        if (partyRes.ok) {
          const partyData = await partyRes.json();
          return NextResponse.json(partyData, { status: 200 });
        }
      } catch (partyErr) {
        console.error("PartyKit join fallback to local:", partyErr);
      }
    }

    const room = getRoom(code);
    if (!room) {
      return NextResponse.json(
        { ok: false, error: { message: `Arena room "${code}" not found.` } },
        { status: 404 },
      );
    }

    if (room.status !== "lobby") {
      return NextResponse.json(
        { ok: false, error: { message: "This arena match has already started." } },
        { status: 400 },
      );
    }

    if (Object.keys(room.players).length >= (room.maxPlayers || 8)) {
      const maxPlayers = room.maxPlayers || 8;
      const hostTier = room.hostTier || "contender";
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "ROOM_FULL",
            message: `Arena room "${code}" is full (maximum ${maxPlayers} players for ${hostTier} tier).`,
            maxPlayers,
            hostTier,
          },
        },
        { status: 403 },
      );
    }

    const player = joinRoom(code, parsed.data);
    if (!player) {
      return NextResponse.json(
        { ok: false, error: { message: "Could not join room." } },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, player }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { message: err.message || "Failed to join room." } },
      { status: 500 },
    );
  }
}
