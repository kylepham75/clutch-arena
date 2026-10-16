"use client";

import { useState, useEffect, useCallback } from "react";
import { ArenaEntrance } from "./arena-entrance";
import { ArenaLobby } from "./arena-lobby";
import { ArenaGame } from "./arena-game";
import { ArenaPodium } from "./arena-podium";
import { useArenaRoom } from "@/hooks/use-arena-room";
import type { ArenaPlayer, ArenaRoomState } from "@/lib/schemas/multiplayer";
import type { StudyPack } from "@/lib/schemas/question";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export function ArenaManager({
  initialRoomCode,
  onDebriefCoach,
  onExitToSolo,
  presetPack = null,
}: {
  initialRoomCode?: string | null;
  onDebriefCoach?: (focus: any) => void;
  onExitToSolo?: () => void;
  presetPack?: StudyPack | null;
}) {
  const [roomCode, setRoomCode] = useState<string | null>(
    initialRoomCode ? initialRoomCode.toUpperCase() : null,
  );
  const [player, setPlayer] = useState<ArenaPlayer | null>(null);
  const [openRooms, setOpenRooms] = useState<ArenaRoomState[]>([]);

  // Fetch open rooms for lobby browser
  useEffect(() => {
    if (!roomCode) {
      fetch("/api/arena/rooms")
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.rooms) setOpenRooms(data.rooms);
        })
        .catch(() => {});
    }
  }, [roomCode]);

  const {
    room,
    loading,
    error,
    startMatch,
    submitAnswer,
    toggleReady,
    addBot,
    removeBot,
    rematch,
  } = useArenaRoom(roomCode, player);

  const handleCreateRoom = useCallback(
    async (params: {
      nickname: string;
      avatar: string;
      mode: "exact" | "variants";
      title?: string;
      pack?: any;
    }) => {
      try {
        const res = await fetch("/api/arena/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hostNickname: params.nickname,
            hostAvatar: params.avatar,
            mode: params.mode,
            title: params.title,
            pack: params.pack,
          }),
        });

        const data = await res.json();
        if (data.ok && data.code && data.hostPlayer) {
          setPlayer(data.hostPlayer);
          setRoomCode(data.code);
          return data.code;
        }
        return null;
      } catch {
        return null;
      }
    },
    [],
  );

  const handleJoinRoom = useCallback(
    async (code: string, nickname: string, avatar: string) => {
      try {
        const res = await fetch(`/api/arena/rooms/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname, avatar }),
        });

        const data = await res.json();
        if (data.ok && data.player) {
          setPlayer(data.player);
          setRoomCode(code);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [],
  );

  const handleLeave = () => {
    setRoomCode(null);
    setPlayer(null);
  };

  const handleDebrief = () => {
    if (!room || !player || !onDebriefCoach) return;
    const myPlayer = room.players[player.id];

    onDebriefCoach({
      type: "debrief",
      packTitle: room.title,
      score: myPlayer?.score || 0,
      correct: 0,
      total: room.totalQuestions,
      bestStreak: myPlayer?.bestStreak || 0,
      livesLeft: myPlayer?.lives || 0,
      concepts: [],
    });
  };

  // If in no room, show entrance
  if (!roomCode || !player) {
    return (
      <div className="arena-wrapper">
        <ArenaEntrance
          onJoinRoom={handleJoinRoom}
          onCreateRoom={handleCreateRoom}
          openRooms={openRooms}
          presetPack={presetPack}
        />
      </div>
    );
  }

  // Loading state
  if (loading && !room) {
    return (
      <div className="arena-loading-screen">
        <div className="spinner" />
        <p>Connecting to Arena {roomCode}…</p>
      </div>
    );
  }

  // Error state
  if (error || !room) {
    return (
      <div className="arena-error-screen surface">
        <h3>Could not connect to Arena</h3>
        <p>{error || "Room may have closed or expired."}</p>
        <Button onClick={handleLeave}>Back to Arena Entrance</Button>
      </div>
    );
  }

  // Render view depending on room status
  return (
    <div className="arena-wrapper">
      <div className="arena-top-bar">
        <Button variant="ghost" size="sm" onClick={handleLeave} className="leave-arena-link">
          <ArrowLeft size={14} />
          <span>Exit Arena</span>
        </Button>
        <div className="arena-active-badge">
          <span className="live-pulse" />
          <span>ROOM {room.code}</span>
        </div>
      </div>

      {room.status === "lobby" && (
        <ArenaLobby
          room={room}
          currentPlayer={player}
          onStartMatch={startMatch}
          onToggleReady={toggleReady}
          onAddBot={addBot}
          onRemoveBot={removeBot}
        />
      )}

      {(room.status === "countdown" ||
        room.status === "answering" ||
        room.status === "feedback") && (
        <ArenaGame
          room={room}
          currentPlayer={player}
          onSubmitAnswer={submitAnswer}
        />
      )}

      {room.status === "podium" && (
        <ArenaPodium
          room={room}
          currentPlayer={player}
          onRematch={rematch}
          onDebriefCoach={onDebriefCoach ? handleDebrief : undefined}
          onLeave={handleLeave}
        />
      )}
    </div>
  );
}
