import { getRoom, getClientState, subscribeToRoom } from "@/lib/multiplayer/room-manager";

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
      // Send initial state immediately
      const initialPayload = `data: ${JSON.stringify(getClientState(room))}\n\n`;
      controller.enqueue(encoder.encode(initialPayload));

      // Subscribe to all subsequent room updates
      const unsubscribe = subscribeToRoom(code, (state) => {
        try {
          const payload = `data: ${JSON.stringify(state)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // stream might be closed
        }
      });

      // Keepalive heartbeat every 15 seconds
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        try {
          controller.close();
        } catch {}
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
