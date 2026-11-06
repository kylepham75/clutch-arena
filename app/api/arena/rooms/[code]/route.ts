import { NextResponse } from "next/server";
import { getRoom, getClientState } from "@/lib/multiplayer/room-manager";
import { getPartyHost } from "@/lib/multiplayer/party-config";
import PartySocket from "partysocket";

export async function GET(
  _req: Request,
  props: { params: Promise<{ code: string }> },
) {
  const { code } = await props.params;
  if (!/^[A-Z0-9]{6}$/i.test(code)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_ROOM_CODE",
          message: "Invalid arena room code.",
        },
      },
      { status: 400 },
    );
  }

  const partyHost = getPartyHost();
  if (partyHost) {
    try {
      const res = await PartySocket.fetch({
        host: partyHost,
        party: "arena",
        room: code.toUpperCase(),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // fallback to in-memory
    }
  }

  const room = getRoom(code);
  if (!room) {
    return NextResponse.json(
      { ok: false, error: { message: `Arena room "${code}" not found.` } },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, room: getClientState(room) });
}
