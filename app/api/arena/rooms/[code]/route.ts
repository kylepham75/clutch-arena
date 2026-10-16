import { NextResponse } from "next/server";
import { getRoom, getClientState } from "@/lib/multiplayer/room-manager";

export async function GET(
  _req: Request,
  props: { params: Promise<{ code: string }> },
) {
  const { code } = await props.params;
  const room = getRoom(code);
  if (!room) {
    return NextResponse.json(
      { ok: false, error: { message: `Arena room "${code}" not found.` } },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, room: getClientState(room) });
}
