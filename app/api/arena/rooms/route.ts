import { NextResponse } from "next/server";
import { createRoom, getAllRooms } from "@/lib/multiplayer/room-manager";
import { createRoomSchema } from "@/lib/schemas/multiplayer";

export async function GET() {
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

    const { room, hostPlayer } = createRoom(parsed.data);

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
