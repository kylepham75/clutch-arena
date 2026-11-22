import { NextResponse } from "next/server";
import {
  getRoom,
  joinRoom,
  getClientState,
  getPlayerToken,
} from "@/lib/multiplayer/room-manager";
import { joinRoomSchema } from "@/lib/schemas/multiplayer";
import { getPartyHost } from "@/lib/multiplayer/party-config";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isAllowedOrigin } from "@/lib/utils";
import PartySocket from "partysocket";

export async function POST(
  req: Request,
  props: { params: Promise<{ code: string }> },
) {
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

    if (
      process.env.NODE_ENV !== "test" ||
      req.headers.get("x-enforce-rate-limit") === "true"
    ) {
      const rl = await checkRateLimit(`ip:${getClientIp(req)}`, "arena", "contender");
      if (!rl.allowed) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many join requests. Please wait a moment.",
            },
          },
          { status: 429, headers: { "Retry-After": rl.retryAfter.toString() } },
        );
      }
    }

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

    return NextResponse.json(
      {
        ok: true,
        player,
        playerToken: getPlayerToken(code, player.id),
        room: getClientState(room, player.id),
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error(
      "[Arena Join] Failed to join room:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { ok: false, error: { code: "JOIN_FAILED", message: "Failed to join room." } },
      { status: 500 },
    );
  }
}
