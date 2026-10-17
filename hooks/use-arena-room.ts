"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { ArenaPlayer, ArenaRoomState, RoomAction } from "@/lib/schemas/multiplayer";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getPartyHost } from "@/lib/multiplayer/party-config";
import PartySocket from "partysocket";
import { useGameAudio } from "./use-game-audio";

export function useArenaRoom(
  roomCode: string | null,
  player: ArenaPlayer | null,
) {
  const [room, setRoom] = useState<ArenaRoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const audio = useGameAudio();
  const prevStatusRef = useRef<string | null>(null);
  const prevQuestionIndexRef = useRef<number>(-1);
  const partySocketRef = useRef<PartySocket | null>(null);

  // Sound effects on state transitions
  useEffect(() => {
    if (!room) return;

    if (room.status === "countdown" && prevStatusRef.current !== "countdown") {
      audio.play("start");
    }

    if (
      room.status === "answering" &&
      (prevStatusRef.current !== "answering" ||
        room.currentQuestionIndex !== prevQuestionIndexRef.current)
    ) {
      // Audio or haptic trigger when question appears
    }

    if (room.status === "feedback" && player) {
      const myPlayer = room.players[player.id];
      if (myPlayer?.lastAnswer) {
        if (myPlayer.lastAnswer.correct) {
          const streak = myPlayer.streak;
          audio.play([3, 5, 7].includes(streak) ? "streak" : "correct");
        } else {
          audio.play("wrong");
        }
      }
    }

    if (room.status === "podium" && prevStatusRef.current !== "podium") {
      audio.play("finish");
    }

    prevStatusRef.current = room.status;
    prevQuestionIndexRef.current = room.currentQuestionIndex;
  }, [room, player, audio]);

  // Initial fetch
  useEffect(() => {
    if (!roomCode) {
      setLoading(false);
      return;
    }

    const code = roomCode;
    let isMounted = true;

    async function fetchInitial() {
      try {
        const partyHost = getPartyHost();
        let data: any = null;
        if (partyHost) {
          try {
            const res = await PartySocket.fetch({
              host: partyHost,
              party: "arena",
              room: code,
            });
            if (res.ok) {
              data = await res.json();
            }
          } catch {
            // fallback
          }
        }

        if (!data) {
          const res = await fetch(`/api/arena/rooms/${roomCode}`);
          data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error?.message || "Failed to load arena room.");
          }
        }

        if (isMounted && data.room) {
          setRoom(data.room);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Could not connect to arena.");
          setLoading(false);
        }
      }
    }

    fetchInitial();

    return () => {
      isMounted = false;
    };
  }, [roomCode]);

  // Realtime subscription: PartyKit WebSockets (Primary) + Supabase/SSE (Fallback)
  useEffect(() => {
    if (!roomCode) return;

    let isMounted = true;
    const partyHost = getPartyHost();

    // 1. Primary: PartyKit WebSockets (< 30ms latency, native timers & state)
    if (partyHost) {
      const socket = new PartySocket({
        host: partyHost,
        party: "arena",
        room: roomCode.toUpperCase(),
      });
      partySocketRef.current = socket;

      socket.addEventListener("open", () => {
        if (isMounted) setConnected(true);
      });

      socket.addEventListener("message", (event) => {
        if (!isMounted || !event.data) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "room_state" && message.payload) {
            setRoom(message.payload);
            setConnected(true);
            setLoading(false);
          }
        } catch {
          // ignore parsing error
        }
      });

      return () => {
        isMounted = false;
        socket.close();
        partySocketRef.current = null;
      };
    }

    // 2. Fallback: Supabase Realtime + SSE (For local offline dev without partykit)
    let sse: EventSource | null = null;
    let supabaseChannel: any = null;

    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      supabaseChannel = supabase
        .channel(`arena:${roomCode}`)
        .on("broadcast", { event: "room_state" }, ({ payload }) => {
          if (isMounted && payload) {
            setRoom(payload);
            setConnected(true);
          }
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && isMounted) {
            setConnected(true);
          }
        });
    }

    try {
      sse = new EventSource(`/api/arena/rooms/${roomCode}/stream`);

      sse.onopen = () => {
        if (isMounted) setConnected(true);
      };

      sse.onmessage = (event) => {
        if (!isMounted || !event.data) return;
        try {
          const updatedState: ArenaRoomState = JSON.parse(event.data);
          setRoom(updatedState);
          setConnected(true);
        } catch {
          // ignore keepalive pings
        }
      };
    } catch {
      // SSE unsupported or network error
    }

    return () => {
      isMounted = false;
      if (sse) sse.close();
      if (supabase && supabaseChannel) {
        void supabase.removeChannel(supabaseChannel);
      }
    };
  }, [roomCode]);

  const dispatchAction = useCallback(
    async (action: RoomAction) => {
      if (!roomCode || !player) return false;

      // 1. Send over PartyKit WebSocket for instant dispatch
      const partySocket = partySocketRef.current;
      if (partySocket && partySocket.readyState === WebSocket.OPEN) {
        partySocket.send(
          JSON.stringify({
            type: "ACTION",
            playerId: player.id,
            action,
          }),
        );
        return true;
      }

      // 2. Fallback to HTTP action route
      try {
        const partyHost = getPartyHost();
        let res: Response;
        if (partyHost) {
          res = await PartySocket.fetch(
            {
              host: partyHost,
              party: "arena",
              room: roomCode.toUpperCase(),
              path: "/action",
            },
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                playerId: player.id,
                action,
              }),
            },
          );
        } else {
          res = await fetch(`/api/arena/rooms/${roomCode}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playerId: player.id,
              action,
            }),
          });
        }

        const data = await res.json();
        if (data.ok && data.room) {
          setRoom(data.room);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [roomCode, player],
  );

  const startMatch = useCallback(() => {
    return dispatchAction({ type: "START_MATCH" });
  }, [dispatchAction]);

  const submitAnswer = useCallback(
    (selected: number) => {
      return dispatchAction({ type: "SUBMIT_ANSWER", selected });
    },
    [dispatchAction],
  );

  const toggleReady = useCallback(() => {
    return dispatchAction({ type: "TOGGLE_READY" });
  }, [dispatchAction]);

  const addBot = useCallback(
    (botType?: "speed" | "steady" | "wildcard") => {
      return dispatchAction({ type: "ADD_BOT", botType });
    },
    [dispatchAction],
  );

  const removeBot = useCallback(
    (botId: string) => {
      return dispatchAction({ type: "REMOVE_BOT", botId });
    },
    [dispatchAction],
  );

  const rematch = useCallback(() => {
    return dispatchAction({ type: "REMATCH" });
  }, [dispatchAction]);

  return {
    room,
    loading,
    error,
    connected,
    startMatch,
    submitAnswer,
    toggleReady,
    addBot,
    removeBot,
    rematch,
  };
}
