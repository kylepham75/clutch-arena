import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createRoom,
  deleteRoom,
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
  getPlayerToken,
  verifyPlayerToken,
  MAX_ACTIVE_ROOMS,
  IDLE_ROOM_TIMEOUT_MS,
  resetRoomIdleTimeout,
} from "@/lib/multiplayer/room-manager";
import {
  GET as streamHandler,
} from "@/app/api/arena/rooms/[code]/stream/route";
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

  it("masks lastAnswer fields during answering and reveals them in feedback (SA-12)", () => {
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
    const correctIdx = room.pack.questions[0].correctIndex;

    // Only host submits so round stays in "answering"
    submitAnswer(room.code, hostPlayer.id, correctIdx);
    expect(room.status).toBe("answering");

    // Without _forPlayerId, selected, correct, and points are masked
    const publicState = getClientState(room);
    expect(publicState.players[hostPlayer.id].lastAnswer).toEqual({
      selected: null,
      correct: null,
      points: 0,
      answeredAtMs: expect.any(Number),
    });

    // With _forPlayerId = hostPlayer.id, selected is shown for host only, correct & points still masked
    const hostPerspective = getClientState(room, hostPlayer.id);
    expect(hostPerspective.players[hostPlayer.id].lastAnswer?.selected).toBe(correctIdx);
    expect(hostPerspective.players[hostPlayer.id].lastAnswer?.correct).toBeNull();
    expect(hostPerspective.players[hostPlayer.id].lastAnswer?.points).toBe(0);
    expect(hostPerspective.players[challenger.id].lastAnswer).toBeNull();

    // Once round transitions to feedback, full lastAnswer is revealed
    endRound(room);
    expect(room.status).toBe("feedback");
    const feedbackState = getClientState(room);
    expect(feedbackState.players[hostPlayer.id].lastAnswer).toEqual({
      selected: correctIdx,
      correct: true,
      points: 100,
      answeredAtMs: expect.any(Number),
    });
  });

  it("masks score, lives, streak, and status during answering and exposes them in feedback (SA2-21)", () => {
    const { room, hostPlayer } = createRoom({
      hostNickname: "Jordan",
      hostAvatar: "⚡",
      pack: mockMicroeconomics,
    });
    const challenger = joinRoom(room.code, {
      nickname: "Challenger",
      avatar: "🎯",
    })!;

    // Complete round 0 to establish initial score and streak
    startRound(room, 0);
    const q0CorrectIdx = room.pack.questions[0].correctIndex;
    submitAnswer(room.code, hostPlayer.id, q0CorrectIdx);
    submitAnswer(room.code, challenger.id, q0CorrectIdx);
    endRound(room);

    expect(room.players[hostPlayer.id].score).toBe(100);
    expect(room.players[hostPlayer.id].streak).toBe(1);
    expect(room.players[hostPlayer.id].lives).toBe(3);

    // Start round 1 (status: "answering")
    startRound(room, 1);
    expect(room.status).toBe("answering");
    const q1CorrectIdx = room.pack.questions[1].correctIndex;

    // Host submits correct answer in round 1 (streak -> 2, score -> 200)
    submitAnswer(room.code, hostPlayer.id, q1CorrectIdx);
    expect(room.status).toBe("answering");
    expect(room.players[hostPlayer.id].score).toBe(200);
    expect(room.players[hostPlayer.id].streak).toBe(2);

    // Public broadcast (no _forPlayerId) masks score to 100 and streak to 1
    const publicState = getClientState(room);
    expect(publicState.players[hostPlayer.id].score).toBe(100);
    expect(publicState.players[hostPlayer.id].streak).toBe(1);
    expect(publicState.players[hostPlayer.id].lives).toBe(3);
    expect(publicState.players[hostPlayer.id].status).toBe("submitted");

    // Competitor perspective (_forPlayerId = challenger.id) also sees masked values
    const challengerPerspective = getClientState(room, challenger.id);
    expect(challengerPerspective.players[hostPlayer.id].score).toBe(100);
    expect(challengerPerspective.players[hostPlayer.id].streak).toBe(1);
    expect(challengerPerspective.players[hostPlayer.id].lives).toBe(3);
    expect(challengerPerspective.players[hostPlayer.id].status).toBe("submitted");

    // Host sees their own true score, streak, lives, and status
    const hostPerspective = getClientState(room, hostPlayer.id);
    expect(hostPerspective.players[hostPlayer.id].score).toBe(200);
    expect(hostPerspective.players[hostPlayer.id].streak).toBe(2);
    expect(hostPerspective.players[hostPlayer.id].lives).toBe(3);
    expect(hostPerspective.players[hostPlayer.id].status).toBe("submitted");

    // End round 1
    endRound(room);

    // Start round 2 and test elimination masking
    startRound(room, 2);
    // Set challenger to 1 life so a wrong answer causes elimination
    room.players[challenger.id].lives = 1;
    const q2CorrectIdx = room.pack.questions[2].correctIndex;
    const wrongIdx = (q2CorrectIdx + 1) % 4;

    submitAnswer(room.code, challenger.id, wrongIdx);
    expect(room.status).toBe("answering"); // Host hasn't answered yet
    expect(room.players[challenger.id].lives).toBe(0);
    expect(room.players[challenger.id].status).toBe("eliminated");

    // Public and competitor see masked lives (1) and masked status ("submitted" instead of "eliminated")
    const publicElimMasked = getClientState(room);
    expect(publicElimMasked.players[challenger.id].lives).toBe(1);
    expect(publicElimMasked.players[challenger.id].status).toBe("submitted");

    const hostViewingChallenger = getClientState(room, hostPlayer.id);
    expect(hostViewingChallenger.players[challenger.id].lives).toBe(1);
    expect(hostViewingChallenger.players[challenger.id].status).toBe("submitted");

    // Challenger viewing themselves sees their true eliminated status and 0 lives
    const challengerViewingSelf = getClientState(room, challenger.id);
    expect(challengerViewingSelf.players[challenger.id].lives).toBe(0);
    expect(challengerViewingSelf.players[challenger.id].status).toBe("eliminated");

    // When round ends and transitions to "feedback", real score, lives, streak, and revealedFeedback are exposed
    endRound(room);
    expect(room.status).toBe("feedback");
    const feedbackState = getClientState(room);
    expect(feedbackState.players[challenger.id].lives).toBe(0);
    expect(feedbackState.players[challenger.id].status).toBe("eliminated");
    expect(feedbackState.players[hostPlayer.id].score).toBe(200);
    expect(feedbackState.players[hostPlayer.id].streak).toBe(2);
    expect(feedbackState.revealedFeedback).not.toBeNull();
    expect(feedbackState.revealedFeedback?.correctIndex).toBe(q2CorrectIdx);
  });

  it("issues and validates per-player tokens and omits playerTokens from getClientState (SA-14)", () => {
    const { room, hostPlayer } = createRoom({
      hostNickname: "Host",
      pack: mockMicroeconomics,
    });
    const guest = joinRoom(room.code, { nickname: "Guest" })!;

    const hostToken = getPlayerToken(room.code, hostPlayer.id);
    const guestToken = getPlayerToken(room.code, guest.id);

    expect(hostToken).toMatch(/^tok_[a-f0-9]{32}$/);
    expect(guestToken).toMatch(/^tok_[a-f0-9]{32}$/);
    expect(hostToken).not.toBe(guestToken);

    expect(verifyPlayerToken(room.code, hostPlayer.id, hostToken)).toBe(true);
    expect(verifyPlayerToken(room.code, guest.id, guestToken)).toBe(true);
    expect(verifyPlayerToken(room.code, hostPlayer.id, guestToken)).toBe(false);
    expect(verifyPlayerToken(room.code, hostPlayer.id, "invalid_token")).toBe(false);
    expect(verifyPlayerToken(room.code, hostPlayer.id, null)).toBe(false);
    expect(verifyPlayerToken("NONEXISTENT", hostPlayer.id, hostToken)).toBe(false);

    const clientState = getClientState(room) as Record<string, unknown>;
    expect(clientState.playerTokens).toBeUndefined();
  });

  it("bounds active rooms at MAX_ACTIVE_ROOMS by evicting oldest rooms (SA-18)", () => {
    expect(MAX_ACTIVE_ROOMS).toBe(200);

    const createdCodes: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_ROOMS + 10; i++) {
      vi.advanceTimersByTime(10);
      const { room } = createRoom({
        hostNickname: `Host_${i}`,
        pack: mockMicroeconomics,
      });
      createdCodes.push(room.code);
    }

    const activeRooms = getAllRooms();
    expect(activeRooms.length).toBeLessThanOrEqual(MAX_ACTIVE_ROOMS);
    expect(getRoom(createdCodes[0])).toBeNull();
    expect(getRoom(createdCodes[createdCodes.length - 1])).not.toBeNull();
  });

  it("resets room idle timeout and lastActiveAt on gameplay actions (SA2-14)", () => {
    const { room, hostPlayer } = createRoom({
      hostNickname: "Jordan",
      pack: mockMicroeconomics,
    });
    const challenger = joinRoom(room.code, {
      nickname: "Challenger",
    })!;

    const initialActive = room.lastActiveAt;

    // Advance 60 seconds (less than 90s timeout)
    vi.advanceTimersByTime(60_000);
    expect(getRoom(room.code)).not.toBeNull();

    // 1. togglePlayerReady resets idle timeout
    togglePlayerReady(room.code, challenger.id);
    expect(room.lastActiveAt).toBeGreaterThan(initialActive);
    const afterReady = room.lastActiveAt;

    // Advance another 60s (120s total from start, but only 60s from ready)
    vi.advanceTimersByTime(60_000);
    expect(getRoom(room.code)).not.toBeNull();

    // 2. startMatch resets idle timeout
    startMatch(room.code, hostPlayer.id);
    expect(room.lastActiveAt).toBeGreaterThan(afterReady);
    const afterStart = room.lastActiveAt;

    // Fast forward through countdown (3s) to round start
    vi.advanceTimersByTime(3_000);
    expect(room.status).toBe("answering");

    // Advance 60s into answering phase
    vi.advanceTimersByTime(60_000);
    expect(getRoom(room.code)).not.toBeNull();

    // 3. submitAnswer resets idle timeout
    submitAnswer(room.code, hostPlayer.id, 0);
    expect(room.lastActiveAt).toBeGreaterThan(afterStart);

    // Advance 60s (room still alive because timeout was reset by submitAnswer)
    vi.advanceTimersByTime(60_000);
    expect(getRoom(room.code)).not.toBeNull();

    // Advance remaining >30s (total >90s from submitAnswer) without any activity -> room deleted
    vi.advanceTimersByTime(35_000);
    expect(getRoom(room.code)).toBeNull();
  });

  it("prioritizes evicting lobby/podium rooms before in-flight matches when MAX_ACTIVE_ROOMS is reached (SA2-14)", () => {
    for (const r of getAllRooms()) {
      deleteRoom(r.code);
    }

    // Create an in-flight room first (oldest timestamp initially)
    const { room: inFlightRoom } = createRoom({
      hostNickname: "ActiveHost",
      pack: mockMicroeconomics,
    });
    startRound(inFlightRoom, 0);
    expect(inFlightRoom.status).toBe("answering");

    // Create a lobby room
    vi.advanceTimersByTime(10);
    const { room: lobbyRoom } = createRoom({
      hostNickname: "LobbyHost",
      pack: mockMicroeconomics,
    });
    expect(lobbyRoom.status).toBe("lobby");

    // Fill rooms up to MAX_ACTIVE_ROOMS
    const additionalCodes: string[] = [];
    while (getAllRooms().length < MAX_ACTIVE_ROOMS) {
      vi.advanceTimersByTime(10);
      const { room } = createRoom({
        hostNickname: `Filler_${additionalCodes.length}`,
        pack: mockMicroeconomics,
      });
      additionalCodes.push(room.code);
    }

    // Now creating one more room must trigger eviction.
    // Even though inFlightRoom was created earlier, lobby rooms must be evicted before in-flight rooms.
    vi.advanceTimersByTime(10);
    const { room: newRoom } = createRoom({
      hostNickname: "NewHost",
      pack: mockMicroeconomics,
    });
    expect(newRoom).toBeDefined();

    // In-flight match must still exist!
    expect(getRoom(inFlightRoom.code)).not.toBeNull();
    // The oldest lobby room should have been evicted instead
    expect(getRoom(lobbyRoom.code)).toBeNull();
  });

  it("caps SSE subscribers per room at MAX_ROOM_SUBSCRIBERS and returns 429 (SA2-14)", async () => {
    const MAX_ROOM_SUBSCRIBERS = 100;
    const { room } = createRoom({
      hostNickname: "Host",
      pack: mockMicroeconomics,
    });

    for (let i = 0; i < MAX_ROOM_SUBSCRIBERS; i++) {
      room.subscribers.add(() => {});
    }
    expect(room.subscribers.size).toBe(100);

    const req = new Request(
      `http://localhost:3000/api/arena/rooms/${room.code}/stream`,
    );
    const res = await streamHandler(req, {
      params: Promise.resolve({ code: room.code }),
    });

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      error: {
        code: "TOO_MANY_SUBSCRIBERS",
        message: "Room subscriber limit exceeded.",
      },
    });
  });
});
