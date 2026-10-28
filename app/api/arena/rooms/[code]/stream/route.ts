import {
  getRoom,
  getClientState,
  subscribeToRoom,
  subscribeToRoomIdleDisconnect,
  IDLE_ROOM_TIMEOUT_MS,
} from "@/lib/multiplayer/room-manager";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  props: { params: Promise<{ code: string }> },
) {
  const { code } = await props.params;
  const room = getRoom(code);
  if (!room) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      let heartbeatInterval: NodeJS.Timeout | null = null;
      let unsubscribe: () => void = () => {};
      let unsubscribeIdle: () => void = () => {};

      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        unsubscribe();
        unsubscribeIdle();
        try {
          controller.close();
        } catch {}
      };

      const handleIdleDisconnect = () => {
        if (isClosed) return;
        try {
          const payload = `event: idle_disconnect\ndata: ${JSON.stringify({ reason: "idle_timeout", timeoutMs: IDLE_ROOM_TIMEOUT_MS })}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {}
        cleanup();
      };

      // Send initial state immediately
      const initialPayload = `data: ${JSON.stringify(getClientState(room))}\n\n`;
      controller.enqueue(encoder.encode(initialPayload));

      // Subscribe to all subsequent room updates
      unsubscribe = subscribeToRoom(code, (state) => {
        if (isClosed) return;
        try {
          const payload = `data: ${JSON.stringify(state)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // stream might be closed
        }
      });

      // Subscribe to idle disconnect notification
      unsubscribeIdle = subscribeToRoomIdleDisconnect(code, () => {
        handleIdleDisconnect();
      });

      // Keepalive heartbeat every 15 seconds
      heartbeatInterval = setInterval(() => {
        if (isClosed) return;
        const currentRoom = getRoom(code);
        if (
          !currentRoom ||
          Date.now() - currentRoom.lastActiveAt >= IDLE_ROOM_TIMEOUT_MS
        ) {
          handleIdleDisconnect();
          return;
        }

        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
