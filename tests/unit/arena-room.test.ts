import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createRoom,
  getRoom,
  joinRoom,
  togglePlayerReady,
  addBotToRoom,
  removeBotFromRoom,
  startMatch,
  startRound,
  submitAnswer,
  endRound,
  endMatch,
  rematch,
  getClientState,
  getAllRooms,
} from "@/lib/multiplayer/room-manager";
import { mockMicroeconomics } from "@/data/mock-microeconomics";

describe("Study Arena - Room Manager & Multiplayer Logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("creates a room with host player in lobby state", () => {
    const { room, hostPlayer } = createRoom({
      hostNickname: "Jordan",
      hostAvatar: "⚡",
      pack: mockMicroeconomics,
      mode: "exact",
      title: "Micro Econ Sprint",
    });

    expect(room).toBeDefined();
    expect(room.code).toHaveLength(6);
    expect(room.status).toBe("lobby");
    expect(room.hostId).toBe(hostPlayer.id);
    expect(room.totalQuestions).toBe(mockMicroeconomics.questions.length);

    const host = room.players[hostPlayer.id];
    expect(host).toBeDefined();
    expect(host.nickname).toBe("Jordan");
    expect(host.avatar).toBe("⚡");
    expect(host.isHost).toBe(true);
    expect(host.isReady).toBe(true);
    expect(host.lives).toBe(3);
    expect(host.score).toBe(0);
  });

  it("allows other players to join the lobby", () => {
    const { room } = createRoom({
      hostNickname: "HostPlayer",
      hostAvatar: "🚀",
      pack: mockMicroeconomics,
    });

    const challenger = joinRoom(room.code, {
      nickname: "Challenger",
      avatar: "🎯",
    });
    expect(challenger).not.toBeNull();
    if (!challenger) return;

    expect(challenger.nickname).toBe("Challenger");
    expect(challenger.avatar).toBe("🎯");
    expect(challenger.isHost).toBe(false);
    expect(challenger.isReady).toBe(false);

    // Verify player is in room
    expect(room.players[challenger.id]).toBeDefined();

    // Toggle ready
    const readyState = togglePlayerReady(room.code, challenger.id);
    expect(readyState).toBe(true);
    expect(room.players[challenger.id].isReady).toBe(true);
  });

  it("supports adding and removing practice bots", () => {
    const { room, hostPlayer } = createRoom({
      hostNickname: "HostPlayer",
      hostAvatar: "🚀",
      pack: mockMicroeconomics,
    });

    // Add Alex
    const bot1 = addBotToRoom(room.code, "speed");
    expect(bot1).not.toBeNull();
    expect(bot1?.isBot).toBe(true);

    // Add Maya
    const bot2 = addBotToRoom(room.code, "steady");
    expect(bot2).not.toBeNull();
    expect(bot2?.isBot).toBe(true);

    expect(Object.keys(room.players).length).toBe(3); // host + 2 bots

    // Remove bot1
    if (bot1) {
      const removed = removeBotFromRoom(room.code, bot1.id);
      expect(removed).toBe(true);
      expect(room.players[bot1.id]).toBeUndefined();
      expect(Object.keys(room.players).length).toBe(2);
    }
  });

  it("enforces server-authoritative anti-cheat (withholding correctIndex during answering)", () => {
    const { room } = createRoom({
      hostNickname: "Jordan",
      hostAvatar: "⚡",
      pack: mockMicroeconomics,
    });

    // Start round 0 directly
    startRound(room, 0);
    expect(room.status).toBe("answering");

    const clientState = getClientState(room);
    expect(clientState.status).toBe("answering");
    expect(clientState.currentQuestion).not.toBeNull();

    // Anti-cheat verification: question has no correctIndex or explanation
    const q = clientState.currentQuestion as any;
    expect(q.correctIndex).toBeUndefined();
    expect(q.explanation).toBeUndefined();
    expect(clientState.revealedFeedback).toBeNull();
  });

  it("evaluates answers, awards streak bonuses, and deducts lives on error", () => {
    const { room, hostPlayer } = createRoom({
      hostNickname: "Jordan",
      hostAvatar: "⚡",
      pack: mockMicroeconomics,
    });

    const challenger = joinRoom(room.code, {
      nickname: "Challenger",
      avatar: "🎯",
    })!;

    startRound(room, 0);

    const qItem = room.pack.questions[0];
    const correctIdx = qItem.correctIndex;
    const wrongIdx = (correctIdx + 1) % 4;

    // Correct answer by host
    const resCorrect = submitAnswer(room.code, hostPlayer.id, correctIdx);
    expect(resCorrect).toBe(true);

    const host = room.players[hostPlayer.id];
    expect(host.score).toBe(100);
    expect(host.streak).toBe(1);
    expect(host.lives).toBe(3);

    // Another player with wrong answer
    const resWrong = submitAnswer(room.code, challenger.id, wrongIdx);
    expect(resWrong).toBe(true);

    const chPlayer = room.players[challenger.id];
    expect(chPlayer.score).toBe(0);
    expect(chPlayer.streak).toBe(0);
    expect(chPlayer.lives).toBe(2); // Lost 1 life
  });

  it("reveals feedback and explanation during feedback phase", () => {
    const { room } = createRoom({
      hostNickname: "Jordan",
      hostAvatar: "⚡",
      pack: mockMicroeconomics,
    });

    startRound(room, 0);
    endRound(room);

    expect(room.status).toBe("feedback");
    const clientState = getClientState(room);

    expect(clientState.revealedFeedback).not.toBeNull();
    expect(clientState.revealedFeedback?.correctIndex).toBe(
      room.pack.questions[0].correctIndex,
    );
    expect(clientState.revealedFeedback?.explanation).toBe(
      room.pack.questions[0].explanation,
    );
  });

  it("generates podium rankings and allows rematch", () => {
    const { room, hostPlayer } = createRoom({
      hostNickname: "Jordan",
      hostAvatar: "⚡",
      pack: mockMicroeconomics,
    });

    const challenger = joinRoom(room.code, {
      nickname: "Challenger",
      avatar: "🎯",
    })!;

    // Simulate scores
    room.players[hostPlayer.id].score = 450;
    room.players[hostPlayer.id].bestStreak = 4;
    room.players[challenger.id].score = 300;
    room.players[challenger.id].bestStreak = 2;

    endMatch(room);

    expect(room.status).toBe("podium");
    expect(room.podium).not.toBeNull();
    expect(room.podium?.first?.id).toBe(hostPlayer.id);
    expect(room.podium?.first?.score).toBe(450);
    expect(room.podium?.second?.id).toBe(challenger.id);
    expect(room.podium?.second?.score).toBe(300);

    // Rematch resets game state back to lobby
    const rematched = rematch(room.code, hostPlayer.id);
    expect(rematched).toBe(true);
    expect(room.status).toBe("lobby");
    expect(room.podium).toBeNull();
    expect(room.players[hostPlayer.id].score).toBe(0);
    expect(room.players[hostPlayer.id].lives).toBe(3);
    expect(room.players[challenger.id].score).toBe(0);
    expect(room.players[challenger.id].lives).toBe(3);
  });

  it("lists open rooms for lobby browser", () => {
    const { room: r1 } = createRoom({
      hostNickname: "Alice",
      hostAvatar: "⭐",
      pack: mockMicroeconomics,
      title: "Alice's Arena",
    });

    const open = getAllRooms();
    const found = open.find((r) => r.code === r1.code);
    expect(found).toBeDefined();
    expect(found?.title).toBe("Alice's Arena");
  });
});
