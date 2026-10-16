import { NextResponse } from "next/server";
import { getRoom, joinRoom } from "@/lib/multiplayer/room-manager";
import { joinRoomSchema } from "@/lib/schemas/multiplayer";

export async function POST(
  req: Request,
  props: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await props.params;
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

    const json = await req.json();
    const parsed = joinRoomSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
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
