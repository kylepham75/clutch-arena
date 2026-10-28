import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRoom,
  getRoom,
  joinRoom,
  deleteRoom,
  startRound,
  submitAnswer,
  endRound,
  rematch,
  computeClassAnalytics,
  subscribeToRoomIdleDisconnect,
  IDLE_ROOM_TIMEOUT_MS,
} from "@/lib/multiplayer/room-manager";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import { POST as joinPostHandler } from "@/app/api/arena/rooms/[code]/join/route";
import { GET as streamGetHandler } from "@/app/api/arena/rooms/[code]/stream/route";
import { POST as createRoomPostHandler } from "@/app/api/arena/rooms/route";

describe("Arena Lobby Caps, 90s Idle Disconnect, and Class Analytics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("Tier Lobby Caps Enforcement", () => {
    it("enforces default max players by host tier (contender=8, cram_pass=15, pro=15, tutor=50)", () => {
      const contender = createRoom({ hostNickname: "ContenderHost", hostTier: "contender" });
      expect(contender.room.maxPlayers).toBe(8);
      expect(contender.room.hostTier).toBe("contender");

      const cramPass = createRoom({ hostNickname: "CramHost", hostTier: "cram_pass" });
      expect(cramPass.room.maxPlayers).toBe(15);
      expect(cramPass.room.hostTier).toBe("cram_pass");

      const pro = createRoom({ hostNickname: "ProHost", hostTier: "pro" });
      expect(pro.room.maxPlayers).toBe(15);
      expect(pro.room.hostTier).toBe("pro");

      const tutor = createRoom({ hostNickname: "TutorHost", hostTier: "tutor" });
      expect(tutor.room.maxPlayers).toBe(50);
      expect(tutor.room.hostTier).toBe("tutor");
    });

    it("clamps requested maxPlayers to the host tier ceiling", () => {
      // Contender requesting 20 is clamped to 8
      const contender = createRoom({
        hostNickname: "ContenderHost",
        hostTier: "contender",
        maxPlayers: 20,
      });
      expect(contender.room.maxPlayers).toBe(8);

      // Pro requesting 30 is clamped to 15
      const pro = createRoom({
        hostNickname: "ProHost",
        hostTier: "pro",
        maxPlayers: 30,
      });
      expect(pro.room.maxPlayers).toBe(15);

      // Tutor requesting 100 is clamped to 50
      const tutor = createRoom({
        hostNickname: "TutorHost",
        hostTier: "tutor",
        maxPlayers: 100,
      });
      expect(tutor.room.maxPlayers).toBe(50);

      // Tutor requesting 10 (less than 50) is granted 10
      const smallTutor = createRoom({
        hostNickname: "TutorHost",
        hostTier: "tutor",
        maxPlayers: 10,
      });
      expect(smallTutor.room.maxPlayers).toBe(10);
    });

    it("clamps contender mode to exact even if variants was requested", () => {
      const room = createRoom({
        hostNickname: "ContenderHost",
        hostTier: "contender",
        mode: "variants",
      }).room;
      expect(room.mode).toBe("exact");

      const proRoom = createRoom({
        hostNickname: "ProHost",
        hostTier: "pro",
        mode: "variants",
      }).room;
      expect(proRoom.mode).toBe("variants");
    });

    it("maintains backward compatibility when hostTier is omitted", () => {
      const room = createRoom({
        hostNickname: "LegacyHost",
        maxPlayers: 24,
      }).room;
      expect(room.maxPlayers).toBe(24);
      expect(room.hostTier).toBe("contender");
    });

    it("blocks joinRoom beyond tier capacity (blocks 9th contender, 16th pro)", () => {
      const contenderRoom = createRoom({
        hostNickname: "Host",
        hostTier: "contender",
      }).room;

      // Host is player 1. Join 7 more players to reach 8.
      for (let i = 1; i <= 7; i++) {
        const p = joinRoom(contenderRoom.code, { nickname: `Player${i}` });
        expect(p).not.toBeNull();
      }
      expect(Object.keys(contenderRoom.players).length).toBe(8);

      // 9th player join must fail
      const overflowPlayer = joinRoom(contenderRoom.code, { nickname: "Player9" });
      expect(overflowPlayer).toBeNull();
      expect(Object.keys(contenderRoom.players).length).toBe(8);

      // Test Pro cap (15 players)
      const proRoom = createRoom({
        hostNickname: "ProHost",
        hostTier: "pro",
      }).room;

      // Host is 1. Join 14 more players to reach 15.
      for (let i = 1; i <= 14; i++) {
        const p = joinRoom(proRoom.code, { nickname: `ProPlayer${i}` });
        expect(p).not.toBeNull();
      }
      expect(Object.keys(proRoom.players).length).toBe(15);

      // 16th player join must fail
      const overflowPro = joinRoom(proRoom.code, { nickname: "ProPlayer16" });
      expect(overflowPro).toBeNull();
      expect(Object.keys(proRoom.players).length).toBe(15);
    });

    it("POST /api/arena/rooms/[code]/join returns HTTP 403 with ROOM_FULL error metadata when room is full", async () => {
      const { room } = createRoom({
        hostNickname: "Host",
        hostTier: "contender",
        maxPlayers: 2,
      });

      // Join 2nd player to reach max capacity
      const p2 = joinRoom(room.code, { nickname: "Player2" });
      expect(p2).not.toBeNull();

      // 3rd player joins via POST API
      const req = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: "Player3", avatar: "🧠" }),
      });

      const res = await joinPostHandler(req, {
        params: Promise.resolve({ code: room.code }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("ROOM_FULL");
      expect(json.error.maxPlayers).toBe(2);
      expect(json.error.hostTier).toBe("contender");
      expect(json.error.message).toContain(room.code);
      expect(json.error.message).toContain("maximum 2 players for contender tier");
    });

    it("POST /api/arena/rooms clamps hostTier and maxPlayers for unauthenticated requests", async () => {
      const req = new Request("http://localhost:3000/api/arena/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: "SneakyHost",
          hostTier: "tutor", // Client spoof attempt
          maxPlayers: 50,
        }),
      });

      const res = await createRoomPostHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.room.hostTier).toBe("contender");
      expect(json.room.maxPlayers).toBe(8);
    });
  });

  describe("90s Idle SSE Auto-Disconnect", () => {
    it("notifies idle subscribers and clears listeners when 90s idle timeout fires", () => {
      const { room } = createRoom({ hostNickname: "Host" });
      let disconnected = false;

      const unsubscribe = subscribeToRoomIdleDisconnect(room.code, () => {
        disconnected = true;
      });

      expect(disconnected).toBe(false);
      expect(getRoom(room.code)).not.toBeNull();

      // Advance by 90 seconds (IDLE_ROOM_TIMEOUT_MS)
      vi.advanceTimersByTime(IDLE_ROOM_TIMEOUT_MS);

      expect(disconnected).toBe(true);
      expect(getRoom(room.code)).toBeNull();

      unsubscribe();
    });

    it("allows unsubscribing from idle disconnect callbacks", () => {
      const { room } = createRoom({ hostNickname: "Host" });
      let called = false;

      const unsubscribe = subscribeToRoomIdleDisconnect(room.code, () => {
        called = true;
      });

      unsubscribe();
      deleteRoom(room.code);

      expect(called).toBe(false);
    });

    it("closes the SSE stream and enqueues idle_disconnect event when room times out", async () => {
      const { room } = createRoom({ hostNickname: "Host" });

      const req = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/stream`, {
        signal: new AbortController().signal,
      });

      const res = await streamGetHandler(req, {
        params: Promise.resolve({ code: room.code }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");

      const stream = res.body;
      expect(stream).not.toBeNull();
      if (!stream) return;

      const reader = stream.getReader();
      const decoder = new TextDecoder();

      // Read initial state chunk
      const initialChunk = await reader.read();
      expect(initialChunk.done).toBe(false);
      const initialText = decoder.decode(initialChunk.value);
      expect(initialText).toContain(`"code":"${room.code}"`);

      // Advance timers by 90s to trigger idle timeout
      vi.advanceTimersByTime(IDLE_ROOM_TIMEOUT_MS);

      // Collect all remaining chunks until stream ends
      const remainingChunks: string[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        remainingChunks.push(decoder.decode(value));
      }

      // Verify that idle_disconnect was emitted and stream closed
      const allText = remainingChunks.join("");
      expect(allText).toContain("event: idle_disconnect");
      expect(allText).toContain('"reason":"idle_timeout"');
      expect(allText).toContain('"timeoutMs":90000');
    });
  });

  describe("Live Per-Question Class Analytics Engine", () => {
    it("computes accurate missedPercent, optionCounts, and mostCommonWrongOption", () => {
      const { room, hostPlayer } = createRoom({
        hostNickname: "Jordan",
        pack: mockMicroeconomics,
      });

      const p1 = joinRoom(room.code, { nickname: "Alice" })!;
      const p2 = joinRoom(room.code, { nickname: "Bob" })!;
      const p3 = joinRoom(room.code, { nickname: "Charlie" })!;

      startRound(room, 0);

      const qItem = room.pack.questions[0];
      const correctIdx = qItem.correctIndex;
      const wrongOpt1 = (correctIdx + 1) % 4;
      const wrongOpt2 = (correctIdx + 2) % 4;

      // Host answers correctly
      submitAnswer(room.code, hostPlayer.id, correctIdx);
      // Alice answers wrongOpt1
      submitAnswer(room.code, p1.id, wrongOpt1);
      // Bob answers wrongOpt1
      submitAnswer(room.code, p2.id, wrongOpt1);
      // Charlie answers wrongOpt2
      submitAnswer(room.code, p3.id, wrongOpt2);

      // End question 0
      endRound(room);

      const analytics = computeClassAnalytics(room);
      expect(analytics.totalPlayers).toBe(4);
      expect(analytics.totalQuestions).toBe(room.pack.questions.length);
      expect(analytics.questionStats.length).toBe(1);

      const q0Stat = analytics.questionStats[0];
      expect(q0Stat.questionNumber).toBe(1);
      expect(q0Stat.totalAttempts).toBe(4);
      expect(q0Stat.correctCount).toBe(1);
      expect(q0Stat.missedCount).toBe(3);
      // 3 / 4 missed = 75%
      expect(q0Stat.missedPercent).toBe(75);
      expect(q0Stat.optionCounts[correctIdx]).toBe(1);
      expect(q0Stat.optionCounts[wrongOpt1]).toBe(2);
      expect(q0Stat.optionCounts[wrongOpt2]).toBe(1);
      expect(q0Stat.mostCommonWrongOption).toBe(wrongOpt1);

      // Accuracy: 1 correct out of 4 attempts = 25%
      expect(analytics.averageAccuracyPercent).toBe(25);
    });

    it("returns null for mostCommonWrongOption when all players answered correctly", () => {
      const { room, hostPlayer } = createRoom({
        hostNickname: "Jordan",
        pack: mockMicroeconomics,
      });

      const p1 = joinRoom(room.code, { nickname: "Alice" })!;

      startRound(room, 0);
      const correctIdx = room.pack.questions[0].correctIndex;
      submitAnswer(room.code, hostPlayer.id, correctIdx);
      submitAnswer(room.code, p1.id, correctIdx);

      endRound(room);

      const analytics = computeClassAnalytics(room);
      const q0Stat = analytics.questionStats[0];
      expect(q0Stat.correctCount).toBe(2);
      expect(q0Stat.missedCount).toBe(0);
      expect(q0Stat.missedPercent).toBe(0);
      expect(q0Stat.mostCommonWrongOption).toBeNull();
      expect(analytics.averageAccuracyPercent).toBe(100);
    });

    it("tracks earlyEliminatedNicknames for players losing all 3 hearts before Round 5", () => {
      const { room, hostPlayer } = createRoom({
        hostNickname: "Jordan",
        pack: mockMicroeconomics,
      });

      const p1 = joinRoom(room.code, { nickname: "UnluckyAlice" })!;
      const correctIdx0 = room.pack.questions[0].correctIndex;
      const wrongIdx0 = (correctIdx0 + 1) % 4;

      // Simulate Alice having only 1 life entering round 0
      room.players[p1.id].lives = 1;

      startRound(room, 0);

      submitAnswer(room.code, hostPlayer.id, correctIdx0);
      submitAnswer(room.code, p1.id, wrongIdx0); // Alice loses last life in Round 0 (index 0 < Round 5)

      endRound(room);

      expect(room.players[p1.id].lives).toBe(0);
      expect(room.players[p1.id].status).toBe("eliminated");

      const analytics = computeClassAnalytics(room);
      expect(analytics.earlyEliminatedCount).toBe(1);
      expect(analytics.earlyEliminatedNicknames).toEqual(["UnluckyAlice"]);
    });

    it("does not tag players eliminated on or after Round 5 as earlyEliminated", () => {
      const { room, hostPlayer } = createRoom({
        hostNickname: "Jordan",
        pack: mockMicroeconomics,
      });

      const p1 = joinRoom(room.code, { nickname: "LateElimPlayer" })!;
      room.players[p1.id].lives = 1;

      // Question index 4 is Round 5
      startRound(room, 4);

      const qItem = room.pack.questions[4];
      const correctIdx = qItem.correctIndex;
      const wrongIdx = (correctIdx + 1) % 4;

      submitAnswer(room.code, hostPlayer.id, correctIdx);
      submitAnswer(room.code, p1.id, wrongIdx);

      endRound(room);

      expect(room.players[p1.id].lives).toBe(0);

      const analytics = computeClassAnalytics(room);
      expect(analytics.earlyEliminatedCount).toBe(0);
      expect(analytics.earlyEliminatedNicknames).toEqual([]);
    });

    it("resets roundHistory and earlyEliminatedIds cleanly on REMATCH", () => {
      const { room, hostPlayer } = createRoom({
        hostNickname: "Jordan",
        pack: mockMicroeconomics,
      });

      const p1 = joinRoom(room.code, { nickname: "Alice" })!;
      room.players[p1.id].lives = 1;

      startRound(room, 0);
      const correctIdx = room.pack.questions[0].correctIndex;
      submitAnswer(room.code, hostPlayer.id, correctIdx);
      submitAnswer(room.code, p1.id, (correctIdx + 1) % 4);

      endRound(room);

      // Verify analytics before rematch
      const beforeRematch = computeClassAnalytics(room);
      expect(beforeRematch.questionStats.length).toBe(1);
      expect(beforeRematch.earlyEliminatedCount).toBe(1);
      expect(Object.keys(room.roundHistory).length).toBe(1);
      expect(room.earlyEliminatedIds.size).toBe(1);

      // Execute rematch
      const rematched = rematch(room.code, hostPlayer.id);
      expect(rematched).toBe(true);
      expect(room.status).toBe("lobby");
      expect(Object.keys(room.roundHistory).length).toBe(0);
      expect(room.earlyEliminatedIds.size).toBe(0);

      // Verify analytics after rematch is cleanly cleared
      const afterRematch = computeClassAnalytics(room);
      expect(afterRematch.questionStats.length).toBe(0);
      expect(afterRematch.earlyEliminatedCount).toBe(0);
      expect(afterRematch.earlyEliminatedNicknames).toEqual([]);
      expect(afterRematch.averageAccuracyPercent).toBe(0);
      expect(room.players[p1.id].lives).toBe(3);
    });
  });
});
