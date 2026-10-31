import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ArenaServer, {
  STALE_LOBBY_TIMEOUT_MS,
  type PartyRoomData,
} from "../../party/arena";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { ArenaRoomState } from "@/lib/schemas/multiplayer";
import type * as Party from "partykit/server";

interface MockConnection {
  id: string;
  sentMessages: string[];
  isClosed: boolean;
  send: (msg: string) => void;
  close: () => void;
}

function createMockConnection(id = `conn_${Math.random().toString(36).slice(2, 8)}`): MockConnection {
  const conn: MockConnection = {
    id,
    sentMessages: [],
    isClosed: false,
    send: vi.fn((msg: string) => {
      conn.sentMessages.push(msg);
    }),
    close: vi.fn(() => {
      conn.isClosed = true;
    }),
  };
  return conn;
}

function createMockPartyRoom(roomId = "TEST-ROOM"): {
  room: Party.Room;
  storageData: Map<string, any>;
  alarmTime: { current: number | null };
  connections: Map<string, MockConnection>;
  lobbyFetchSpy: ReturnType<typeof vi.fn>;
  broadcastSpy: ReturnType<typeof vi.fn>;
} {
  const storageData = new Map<string, any>();
  const alarmTime = { current: null as number | null };
  const connections = new Map<string, MockConnection>();
  const lobbyFetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  const broadcastSpy = vi.fn();

  const fakeRoom = {
    id: roomId,
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
        return storageData.get(key);
      }),
      put: vi.fn(async (key: string, val: any): Promise<void> => {
        storageData.set(key, val);
      }),
      deleteAll: vi.fn(async (): Promise<void> => {
        storageData.clear();
      }),
      setAlarm: vi.fn(async (time: number): Promise<void> => {
        alarmTime.current = time;
      }),
      getAlarm: vi.fn(async (): Promise<number | null> => {
        return alarmTime.current;
      }),
    },
    getConnections: vi.fn((): Iterable<Party.Connection> => {
      return Array.from(connections.values()) as unknown as Iterable<Party.Connection>;
    }),
    broadcast: broadcastSpy,
    context: {
      parties: {
        arena: {
          get: vi.fn((_name: string) => ({
            fetch: lobbyFetchSpy,
          })),
        },
      },
    },
  } as unknown as Party.Room;

  return {
    room: fakeRoom,
    storageData,
    alarmTime,
    connections,
    lobbyFetchSpy,
    broadcastSpy,
  };
}

describe("PartyKit ArenaServer Parity & Lifecycle Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("1. Tier Player Caps Enforcement", () => {
    it("enforces tier default caps during room initialization", async () => {
      // Contender: capped at 8, mode clamped to exact even if variants requested
      const mock1 = createMockPartyRoom("ROOM-CONTENDER");
      const server1 = new ArenaServer(mock1.room);
      const conn1 = createMockConnection("host_conn_1");

      await server1.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: {
            hostNickname: "ContenderHost",
            hostTier: "contender",
            mode: "variants",
            maxPlayers: 30, // Request 30, should be clamped to 8
          },
        }),
        conn1 as unknown as Party.Connection,
      );

      const res1 = JSON.parse(conn1.sentMessages[0]);
      expect(res1.type).toBe("INIT_SUCCESS");
      expect(res1.room.hostTier).toBe("contender");
      expect(res1.room.maxPlayers).toBe(8);
      expect(res1.room.mode).toBe("exact");

      // Cram pass: maxPlayers capped at 15
      const mock2 = createMockPartyRoom("ROOM-CRAM");
      const server2 = new ArenaServer(mock2.room);
      const conn2 = createMockConnection("host_conn_2");
      await server2.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: {
            hostNickname: "CramHost",
            hostTier: "cram_pass",
          },
        }),
        conn2 as unknown as Party.Connection,
      );
      const res2 = JSON.parse(conn2.sentMessages[0]);
      expect(res2.room.maxPlayers).toBe(15);

      // Pro: maxPlayers capped at 15
      const mock3 = createMockPartyRoom("ROOM-PRO");
      const server3 = new ArenaServer(mock3.room);
      const conn3 = createMockConnection("host_conn_3");
      await server3.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: {
            hostNickname: "ProHost",
            hostTier: "pro",
            mode: "variants",
            maxPlayers: 25, // Request 25, clamped to 15
          },
        }),
        conn3 as unknown as Party.Connection,
      );
      const res3 = JSON.parse(conn3.sentMessages[0]);
      expect(res3.room.maxPlayers).toBe(15);
      expect(res3.room.mode).toBe("variants");

      // Tutor: maxPlayers up to 50, or smaller if requested
      const mock4 = createMockPartyRoom("ROOM-TUTOR");
      const server4 = new ArenaServer(mock4.room);
      const conn4 = createMockConnection("host_conn_4");
      await server4.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: {
            hostNickname: "TutorHost",
            hostTier: "tutor",
            maxPlayers: 10,
          },
        }),
        conn4 as unknown as Party.Connection,
      );
      const res4 = JSON.parse(conn4.sentMessages[0]);
      expect(res4.room.maxPlayers).toBe(10);
    });

    it("blocks 9th player join on contender room via WebSocket", async () => {
      const mock = createMockPartyRoom("CAP-WS-8");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "ContenderHost", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      // Room has 1 host player. Join 7 more players to reach maxPlayers = 8.
      for (let i = 1; i <= 7; i++) {
        const clientConn = createMockConnection(`player_${i}`);
        await server.onMessage(
          JSON.stringify({
            type: "JOIN_ROOM",
            payload: { nickname: `Player${i}` },
          }),
          clientConn as unknown as Party.Connection,
        );
        const lastMsg = JSON.parse(clientConn.sentMessages[clientConn.sentMessages.length - 1]);
        expect(lastMsg.type).toBe("JOIN_SUCCESS");
      }

      const clientState = (server as any).getClientState() as ArenaRoomState;
      expect(Object.keys(clientState.players).length).toBe(8);

      // Attempt 9th join: must receive ERROR message indicating room is full
      const overflowConn = createMockConnection("overflow_9");
      await server.onMessage(
        JSON.stringify({
          type: "JOIN_ROOM",
          payload: { nickname: "Player9" },
        }),
        overflowConn as unknown as Party.Connection,
      );

      expect(overflowConn.sentMessages.length).toBe(1);
      const errMsg = JSON.parse(overflowConn.sentMessages[0]);
      expect(errMsg.type).toBe("ERROR");
      expect(errMsg.code).toBe("ROOM_FULL");
      expect(errMsg.maxPlayers).toBe(8);
      expect(errMsg.hostTier).toBe("contender");

      // Verify player count didn't increase
      const finalState = (server as any).getClientState() as ArenaRoomState;
      expect(Object.keys(finalState.players).length).toBe(8);
    });

    it("blocks join beyond capacity via HTTP POST /join with HTTP 403 ROOM_FULL", async () => {
      const mock = createMockPartyRoom("CAP-HTTP-2");
      const server = new ArenaServer(mock.room);

      // Init room via HTTP with cap of 2
      const initReq = new Request("http://localhost:1999/party/CAP-HTTP-2/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostNickname: "Host",
          hostTier: "contender",
          maxPlayers: 2,
        }),
      });
      const initRes = await server.onRequest(initReq as unknown as Party.Request);
      expect(initRes.status).toBe(201);

      // 2nd player joins via HTTP POST
      const joinReq2 = new Request("http://localhost:1999/party/CAP-HTTP-2/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: "Player2" }),
      });
      const joinRes2 = await server.onRequest(joinReq2 as unknown as Party.Request);
      expect(joinRes2.status).toBe(200);
      const joinData2 = await joinRes2.json();
      expect(joinData2.ok).toBe(true);
      expect(Object.keys(joinData2.room.players).length).toBe(2);

      // 3rd player attempts to join via HTTP POST -> should return 403 ROOM_FULL
      const joinReq3 = new Request("http://localhost:1999/party/CAP-HTTP-2/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: "Player3" }),
      });
      const joinRes3 = await server.onRequest(joinReq3 as unknown as Party.Request);
      expect(joinRes3.status).toBe(403);
      const joinData3 = await joinRes3.json();
      expect(joinData3.ok).toBe(false);
      expect(joinData3.error.code).toBe("ROOM_FULL");
      expect(joinData3.error.maxPlayers).toBe(2);
      expect(joinData3.error.hostTier).toBe("contender");
    });

    it("enforces player caps when host adds bots", async () => {
      const mock = createMockPartyRoom("CAP-BOT-3");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender", maxPlayers: 3 },
        }),
        hostConn as unknown as Party.Connection,
      );

      const hostId = (JSON.parse(hostConn.sentMessages[0]) as any).hostPlayer.id;

      // Add 1st bot -> succeeds (2 players)
      const actionRes1 = (server as any).handleAction(hostId, { type: "ADD_BOT" });
      expect(actionRes1).toBe(true);
      expect(Object.keys((server as any).state.players).length).toBe(2);

      // Add 2nd bot -> succeeds (3 players, reached cap)
      const actionRes2 = (server as any).handleAction(hostId, { type: "ADD_BOT" });
      expect(actionRes2).toBe(true);
      expect(Object.keys((server as any).state.players).length).toBe(3);

      // Add 3rd bot -> rejected because room is at cap 3
      const actionRes3 = (server as any).handleAction(hostId, { type: "ADD_BOT" });
      expect(actionRes3).toBe(false);
      expect(Object.keys((server as any).state.players).length).toBe(3);
    });

    it("blocks join when match is already started / not in lobby", async () => {
      const mock = createMockPartyRoom("STARTED-MATCH");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "pro" },
        }),
        hostConn as unknown as Party.Connection,
      );

      const hostId = (JSON.parse(hostConn.sentMessages[0]) as any).hostPlayer.id;

      // Start match -> countdown
      (server as any).handleAction(hostId, { type: "START_MATCH" });
      expect((server as any).state.status).toBe("countdown");

      // Attempt join via WebSocket
      const joinConn = createMockConnection("late_joiner");
      await server.onMessage(
        JSON.stringify({
          type: "JOIN_ROOM",
          payload: { nickname: "LateJoiner" },
        }),
        joinConn as unknown as Party.Connection,
      );

      const err = JSON.parse(joinConn.sentMessages[0]);
      expect(err.type).toBe("ERROR");
      expect(err.message).toContain("Unable to join room");
    });
  });

  describe("2. Stale Lobby Cleanup (STALE_LOBBY_TIMEOUT_MS = 15m)", () => {
    it("exports STALE_LOBBY_TIMEOUT_MS equal to 15 minutes (900,000 ms)", () => {
      expect(STALE_LOBBY_TIMEOUT_MS).toBe(15 * 60_000);
    });

    it("cleans up stale lobby room on onAlarm() when idle > 15 minutes", async () => {
      const mock = createMockPartyRoom("STALE-1");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host_c");
      const guestConn = createMockConnection("guest_c");
      mock.connections.set("host_c", hostConn);
      mock.connections.set("guest_c", guestConn);

      // Initialize room
      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      expect((server as any).state).not.toBeNull();
      expect(mock.storageData.has("room_data")).toBe(true);

      // Fast-forward lastActiveAt to 16 minutes in the past
      (server as any).state.lastActiveAt = Date.now() - 16 * 60_000;

      // Trigger alarm
      await server.onAlarm();

      // Room state should be cleaned up
      expect((server as any).state).toBeNull();
      // Storage should be cleared
      expect(mock.storageData.size).toBe(0);
      // All connections closed
      expect(hostConn.isClosed).toBe(true);
      expect(guestConn.isClosed).toBe(true);
      // Directory informed of deletion
      expect(mock.lobbyFetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ code: "STALE-1" }),
        }),
      );
    });

    it("does not clean up room on onAlarm() if room was active within 15 minutes", async () => {
      const mock = createMockPartyRoom("ACTIVE-LOBBY");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host_c");
      mock.connections.set("host_c", hostConn);

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      // Room active 5 minutes ago (< 15 mins)
      (server as any).state.lastActiveAt = Date.now() - 5 * 60_000;

      await server.onAlarm();

      // State and connections should be preserved
      expect((server as any).state).not.toBeNull();
      expect(mock.storageData.has("room_data")).toBe(true);
      expect(hostConn.isClosed).toBe(false);
      expect(mock.lobbyFetchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("does not clean up in-game rooms on onAlarm() even if round exceeds 15 minutes", async () => {
      const mock = createMockPartyRoom("ACTIVE-GAME");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host_c");
      mock.connections.set("host_c", hostConn);

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      // Transition to answering
      (server as any).state.status = "answering";
      (server as any).state.lastActiveAt = Date.now() - 25 * 60_000; // 25 mins ago

      await server.onAlarm();

      // Game state must NOT be wiped
      expect((server as any).state).not.toBeNull();
      expect((server as any).state.status).toBe("answering");
      expect(hostConn.isClosed).toBe(false);
    });

    it("cleans up stale lobby on onStart() server cold restart", async () => {
      const mock = createMockPartyRoom("RESTART-STALE");
      const conn = createMockConnection("conn1");
      mock.connections.set("conn1", conn);

      // Simulate stored room older than 15 minutes in lobby
      const storedRoomData: Partial<PartyRoomData> = {
        code: "RESTART-STALE",
        title: "Microeconomics Arena",
        hostId: "host_1",
        hostTier: "contender",
        maxPlayers: 8,
        status: "lobby",
        mode: "exact",
        pack: mockMicroeconomics,
        currentQuestionIndex: -1,
        totalQuestions: 5,
        roundDeadline: 0,
        feedbackDeadline: 0,
        countdownEndsAt: 0,
        players: {
          host_1: {
            id: "host_1",
            nickname: "Host",
            avatar: "⚡",
            score: 0,
            streak: 0,
            bestStreak: 0,
            lives: 3,
            isReady: true,
            isHost: true,
            isBot: false,
            status: "waiting",
            lastAnswer: null,
          },
        },
        createdAt: new Date().toISOString(),
        lastActiveAt: Date.now() - 20 * 60_000, // 20 mins ago
        roundHistory: {},
        earlyEliminatedIds: new Set(),
        podium: null,
      };

      mock.storageData.set("room_data", storedRoomData);

      const server = new ArenaServer(mock.room);
      await server.onStart();

      // Cold start should detect stale room and execute cleanup
      expect((server as any).state).toBeNull();
      expect(mock.storageData.size).toBe(0);
      expect(conn.isClosed).toBe(true);
      expect(mock.lobbyFetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ code: "RESTART-STALE" }),
        }),
      );
    });

    it("safely deserializes stored earlyEliminatedIds array on onStart() without TypeError", async () => {
      const mock = createMockPartyRoom("RESTART-FRESH");

      // When serialized to JSON, earlyEliminatedIds is an array
      const storedRoomData = {
        code: "RESTART-FRESH",
        title: "AP Bio Arena",
        hostId: "host_1",
        hostTier: "pro",
        maxPlayers: 15,
        status: "lobby",
        mode: "variants",
        pack: mockMicroeconomics,
        currentQuestionIndex: -1,
        totalQuestions: 5,
        roundDeadline: 0,
        feedbackDeadline: 0,
        countdownEndsAt: 0,
        players: {
          host_1: {
            id: "host_1",
            nickname: "Host",
            avatar: "⚡",
            score: 0,
            streak: 0,
            bestStreak: 0,
            lives: 3,
            isReady: true,
            isHost: true,
            isBot: false,
            status: "waiting",
            lastAnswer: null,
          },
        },
        createdAt: new Date().toISOString(),
        lastActiveAt: Date.now() - 60_000, // 1 min ago (fresh)
        roundHistory: {},
        earlyEliminatedIds: ["player_early_1", "player_early_2"], // Array from storage
        podium: null,
      };

      mock.storageData.set("room_data", storedRoomData);

      const server = new ArenaServer(mock.room);
      await server.onStart();

      // State is preserved and earlyEliminatedIds is successfully restored as a Set
      const state = (server as any).state;
      expect(state).not.toBeNull();
      expect(state.earlyEliminatedIds instanceof Set).toBe(true);
      expect(state.earlyEliminatedIds.has("player_early_1")).toBe(true);
      expect(state.earlyEliminatedIds.has("player_early_2")).toBe(true);
    });

    it("schedules stale lobby alarm when room is persisted in lobby status", async () => {
      const mock = createMockPartyRoom("ALARM-PERSIST");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      // Verify that setAlarm was called with lastActiveAt + 15m
      const alarm = mock.alarmTime.current;
      expect(alarm).not.toBeNull();
      const lastActive = (server as any).state.lastActiveAt;
      expect(alarm).toBe(lastActive + STALE_LOBBY_TIMEOUT_MS);
    });
  });

  describe("3. Class Analytics on Podium & Round Progression", () => {
    it("initializes room with empty questionStats classAnalytics structure", async () => {
      const mock = createMockPartyRoom("ANALYTICS-INIT");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      const state = (server as any).getClientState() as ArenaRoomState;
      expect(state.classAnalytics).toBeDefined();
      expect(state.classAnalytics!.totalPlayers).toBe(1);
      expect(state.classAnalytics!.totalQuestions).toBe(mockMicroeconomics.questions.length);
      expect(state.classAnalytics!.averageAccuracyPercent).toBe(0);
      expect(state.classAnalytics!.earlyEliminatedCount).toBe(0);
      expect(state.classAnalytics!.earlyEliminatedNicknames).toEqual([]);
      expect(state.classAnalytics!.questionStats).toEqual([]);
    });

    it("populates roundHistory and computes questionStats when round finishes", async () => {
      const mock = createMockPartyRoom("ANALYTICS-ROUND");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");
      const guestConn = createMockConnection("guest");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      await server.onMessage(
        JSON.stringify({
          type: "JOIN_ROOM",
          payload: { nickname: "Guest" },
        }),
        guestConn as unknown as Party.Connection,
      );

      const hostId = (JSON.parse(hostConn.sentMessages[0]) as any).hostPlayer.id;
      const guestId = (JSON.parse(guestConn.sentMessages[0]) as any).player.id;

      // Start round 0 manually
      (server as any).startRound(0);
      expect((server as any).state.status).toBe("answering");

      const q0 = mockMicroeconomics.questions[0];
      const correctIdx = q0.correctIndex;
      const wrongIdx = (correctIdx + 1) % 4;

      // Host answers correctly
      (server as any).submitAnswer(hostId, correctIdx);
      // Guest answers incorrectly
      (server as any).submitAnswer(guestId, wrongIdx);

      // Both submitted -> endRound() triggered automatically
      expect((server as any).state.status).toBe("feedback");

      // Verify roundHistory[0] recorded responses
      const historyQ0 = (server as any).state.roundHistory[0];
      expect(historyQ0).toBeDefined();
      expect(historyQ0[hostId]).toEqual({ selected: correctIdx, correct: true });
      expect(historyQ0[guestId]).toEqual({ selected: wrongIdx, correct: false });

      // Verify getClientState().classAnalytics computes stats for round 0
      const clientState = (server as any).getClientState() as ArenaRoomState;
      expect(clientState.classAnalytics).toBeDefined();
      expect(clientState.classAnalytics!.questionStats.length).toBe(1);
      const qStat = clientState.classAnalytics!.questionStats[0];
      expect(qStat.questionNumber).toBe(1);
      expect(qStat.totalAttempts).toBe(2);
      expect(qStat.correctCount).toBe(1);
      expect(qStat.missedCount).toBe(1);
      expect(qStat.missedPercent).toBe(50);
      expect(qStat.mostCommonWrongOption).toBe(wrongIdx);
      expect(qStat.optionCounts[correctIdx]).toBe(1);
      expect(qStat.optionCounts[wrongIdx]).toBe(1);
    });

    it("tracks early eliminated players in earlyEliminatedIds & classAnalytics", async () => {
      const mock = createMockPartyRoom("EARLY-ELIM");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");
      const fallenConn = createMockConnection("fallen");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "SurvivorHost", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );

      await server.onMessage(
        JSON.stringify({
          type: "JOIN_ROOM",
          payload: { nickname: "FallenStudent" },
        }),
        fallenConn as unknown as Party.Connection,
      );

      const hostId = (JSON.parse(hostConn.sentMessages[0]) as any).hostPlayer.id;
      const fallenId = (JSON.parse(fallenConn.sentMessages[0]) as any).player.id;

      // Set fallen player lives to 1 before round 0
      (server as any).state.players[fallenId].lives = 1;

      (server as any).startRound(0);

      const q0 = mockMicroeconomics.questions[0];
      const correctIdx = q0.correctIndex;
      const wrongIdx = (correctIdx + 1) % 4;

      // Host gets it right, FallenStudent gets it wrong and loses final life
      (server as any).submitAnswer(hostId, correctIdx);
      (server as any).submitAnswer(fallenId, wrongIdx);

      expect((server as any).state.players[fallenId].lives).toBe(0);
      expect((server as any).state.earlyEliminatedIds.has(fallenId)).toBe(true);

      const clientState = (server as any).getClientState() as ArenaRoomState;
      expect(clientState.classAnalytics).toBeDefined();
      expect(clientState.classAnalytics!.earlyEliminatedCount).toBe(1);
      expect(clientState.classAnalytics!.earlyEliminatedNicknames).toEqual(["FallenStudent"]);
    });

    it("provides full podium analytics on match conclusion and resets on rematch", async () => {
      const mock = createMockPartyRoom("PODIUM-MATCH");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");
      const guestConn = createMockConnection("guest");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "ProHost", hostTier: "pro" },
        }),
        hostConn as unknown as Party.Connection,
      );

      await server.onMessage(
        JSON.stringify({
          type: "JOIN_ROOM",
          payload: { nickname: "GuestPlayer" },
        }),
        guestConn as unknown as Party.Connection,
      );

      const hostId = (JSON.parse(hostConn.sentMessages[0]) as any).hostPlayer.id;
      const guestId = (JSON.parse(guestConn.sentMessages[0]) as any).player.id;

      // Play 2 rounds
      for (let r = 0; r < 2; r++) {
        (server as any).startRound(r);
        const q = mockMicroeconomics.questions[r];
        (server as any).submitAnswer(hostId, q.correctIndex); // Host 100%
        (server as any).submitAnswer(guestId, (q.correctIndex + 1) % 4); // Guest 0%
      }

      // Conclude match
      (server as any).endMatch();
      expect((server as any).state.status).toBe("podium");

      const podiumState = (server as any).getClientState() as ArenaRoomState;
      expect(podiumState.podium).toBeDefined();
      expect(podiumState.podium?.first?.id).toBe(hostId);
      expect(podiumState.podium?.second?.id).toBe(guestId);

      // Class analytics in podium state
      const analytics = podiumState.classAnalytics;
      expect(analytics).toBeDefined();
      expect(analytics!.questionStats.length).toBe(2);
      expect(analytics!.totalPlayers).toBe(2);
      // Total 4 attempts across 2 questions, 2 correct = 50% average
      expect(analytics!.averageAccuracyPercent).toBe(50);

      // Trigger REMATCH
      const rematchOk = (server as any).handleAction(hostId, { type: "REMATCH" });
      expect(rematchOk).toBe(true);

      const rematchedState = (server as any).getClientState() as ArenaRoomState;
      expect(rematchedState.status).toBe("lobby");
      expect(rematchedState.podium).toBeNull();
      expect(rematchedState.classAnalytics).toBeDefined();
      expect(rematchedState.classAnalytics!.questionStats).toEqual([]);
      expect(rematchedState.classAnalytics!.averageAccuracyPercent).toBe(0);
      expect(rematchedState.classAnalytics!.earlyEliminatedCount).toBe(0);
      expect(Object.keys((server as any).state.roundHistory).length).toBe(0);
    });
  });
});
