import { NextResponse } from "next/server";
import {
  getRoom,
  getClientState,
  startMatch,
  submitAnswer,
  togglePlayerReady,
  addBotToRoom,
  removeBotFromRoom,
  rematch,
} from "@/lib/multiplayer/room-manager";
import { roomActionSchema } from "@/lib/schemas/multiplayer";
import { z } from "zod";

const requestPayloadSchema = z.preprocess(
  (val: any) => {
    if (val && typeof val === "object") {
      if (typeof val.action === "string") {
        return {
          ...val,
          action: { type: val.action, ...val },
        };
      }
      if (val.type && !val.action) {
        return {
          ...val,
          action: { ...val },
        };
      }
    }
    return val;
  },
  z.object({
    playerId: z.string().min(1),
    action: roomActionSchema,
  }),
);

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

    const json = await req.json();
    const parsed = requestPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { playerId, action } = parsed.data;

    switch (action.type) {
      case "START_MATCH": {
        const started = startMatch(code, playerId);
        if (!started) {
          return NextResponse.json(
            { ok: false, error: { message: "Only the host can start the match." } },
            { status: 403 },
          );
        }
        break;
      }
      case "SUBMIT_ANSWER": {
        const submitted = submitAnswer(code, playerId, action.selected);
        if (!submitted) {
          return NextResponse.json(
            { ok: false, error: { message: "Invalid submission or answer already recorded." } },
            { status: 400 },
          );
        }
        break;
      }
      case "TOGGLE_READY": {
        togglePlayerReady(code, playerId);
        break;
      }
      case "ADD_BOT": {
        if (room.hostId !== playerId) {
          return NextResponse.json(
            { ok: false, error: { message: "Only the host can add bots." } },
            { status: 403 },
          );
        }
        addBotToRoom(code, action.botType);
        break;
      }
      case "REMOVE_BOT": {
        if (room.hostId !== playerId) {
          return NextResponse.json(
            { ok: false, error: { message: "Only the host can remove bots." } },
            { status: 403 },
          );
        }
        removeBotFromRoom(code, action.botId);
        break;
      }
      case "REMATCH": {
        const rematched = rematch(code, playerId);
        if (!rematched) {
          return NextResponse.json(
            { ok: false, error: { message: "Only the host can start a rematch." } },
            { status: 403 },
          );
        }
        break;
      }
    }

    return NextResponse.json({ ok: true, room: getClientState(room) });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { message: err.message || "Action dispatch failed." } },
      { status: 500 },
    );
  }
}
