import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ArenaServer, {
  CORS_HEADERS,
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

      // Cram pass: maxPlayers capped at 15 via authorized HTTP init
      const mock2 = createMockPartyRoom("ROOM-CRAM");
      const server2 = new ArenaServer(mock2.room);
      const req2 = new Request("http://localhost:1999/party/ROOM-CRAM/init", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-party-internal": "1" },
        body: JSON.stringify({
          hostNickname: "CramHost",
          hostTier: "cram_pass",
        }),
      });
      const res2 = await (await server2.onRequest(req2 as unknown as Party.Request)).json();
      expect(res2.room.maxPlayers).toBe(15);

      // Pro: maxPlayers capped at 15
      const mock3 = createMockPartyRoom("ROOM-PRO");
      const server3 = new ArenaServer(mock3.room);
      const req3 = new Request("http://localhost:1999/party/ROOM-PRO/init", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-party-internal": "1" },
        body: JSON.stringify({
          hostNickname: "ProHost",
          hostTier: "pro",
          mode: "variants",
          maxPlayers: 25, // Request 25, clamped to 15
        }),
      });
      const res3 = await (await server3.onRequest(req3 as unknown as Party.Request)).json();
      expect(res3.room.maxPlayers).toBe(15);
      expect(res3.room.mode).toBe("variants");

      // Tutor: maxPlayers up to 50, or smaller if requested
      const mock4 = createMockPartyRoom("ROOM-TUTOR");
      const server4 = new ArenaServer(mock4.room);
      const req4 = new Request("http://localhost:1999/party/ROOM-TUTOR/init", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-party-internal": "1" },
        body: JSON.stringify({
          hostNickname: "TutorHost",
          hostTier: "tutor",
          maxPlayers: 10,
        }),
      });
      const res4 = await (await server4.onRequest(req4 as unknown as Party.Request)).json();
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
        headers: { "Content-Type": "application/json", "x-party-internal": "1" },
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

  describe("4. Security Hardening (SA-12 & SA-14)", () => {
    it("rejects INIT_ROOM (WS) and POST /init (HTTP) on an already-initialized room without wiping state", async () => {
      const mock = createMockPartyRoom("NO-WIPE-ROOM");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host_conn");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "OriginalHost", hostTier: "pro", title: "Original Title" },
        }),
        hostConn as unknown as Party.Connection,
      );

      const initRes = JSON.parse(hostConn.sentMessages[0]);
      expect(initRes.type).toBe("INIT_SUCCESS");
      expect(initRes.playerToken).toMatch(/^tok_/);
      const originalHostId = initRes.hostPlayer.id;

      // Attacker tries to overwrite room via WS INIT_ROOM
      const attackerConn = createMockConnection("attacker_conn");
      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "AttackerHost", title: "Hacked Title" },
        }),
        attackerConn as unknown as Party.Connection,
      );

      const wsErr = JSON.parse(attackerConn.sentMessages[0]);
      expect(wsErr.type).toBe("ERROR");
      expect(wsErr.code).toBe("ALREADY_INITIALIZED");
      expect((server as any).state.hostId).toBe(originalHostId);
      expect((server as any).state.title).toBe("Original Title");

      // Attacker tries to overwrite room via HTTP POST /init
      const httpInitReq = new Request("http://localhost:1999/party/NO-WIPE-ROOM/init", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-party-internal": "1" },
        body: JSON.stringify({ hostNickname: "HttpAttacker", title: "Http Hacked" }),
      });
      const httpRes = await server.onRequest(httpInitReq as unknown as Party.Request);
      expect(httpRes.status).toBe(409);
      const httpBody = await httpRes.json();
      expect(httpBody.ok).toBe(false);
      expect(httpBody.error.code).toBe("ALREADY_INITIALIZED");
      expect((server as any).state.hostId).toBe(originalHostId);
      expect((server as any).state.title).toBe("Original Title");
    });

    it("prevents guest WebSocket connection from spoofing host or other player actions (UNAUTHORIZED_PLAYER)", async () => {
      const mock = createMockPartyRoom("AUTH-GUARD-ROOM");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host_conn");
      const guestConn = createMockConnection("guest_conn");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "RealHost", hostTier: "pro" },
        }),
        hostConn as unknown as Party.Connection,
      );
      const hostId = JSON.parse(hostConn.sentMessages[0]).hostPlayer.id;

      await server.onMessage(
        JSON.stringify({
          type: "JOIN_ROOM",
          payload: { nickname: "GuestSpoofer" },
        }),
        guestConn as unknown as Party.Connection,
      );
      const joinMsg = JSON.parse(guestConn.sentMessages[0]);
      expect(joinMsg.type).toBe("JOIN_SUCCESS");
      expect(joinMsg.playerToken).toMatch(/^tok_/);

      // Guest attempts to dispatch START_MATCH using hostId
      await server.onMessage(
        JSON.stringify({
          type: "ACTION",
          playerId: hostId,
          action: { type: "START_MATCH" },
        }),
        guestConn as unknown as Party.Connection,
      );

      const lastGuestMsg = JSON.parse(guestConn.sentMessages[guestConn.sentMessages.length - 1]);
      expect(lastGuestMsg.type).toBe("ERROR");
      expect(lastGuestMsg.code).toBe("UNAUTHORIZED_PLAYER");
      expect((server as any).state.status).toBe("lobby");

      // Start round legitimately and verify guest cannot submit answer on behalf of hostId
      (server as any).startRound(0);
      await server.onMessage(
        JSON.stringify({
          type: "ACTION",
          playerId: hostId,
          action: { type: "SUBMIT_ANSWER", selected: 0 },
        }),
        guestConn as unknown as Party.Connection,
      );

      const errAfterSubmit = JSON.parse(guestConn.sentMessages[guestConn.sentMessages.length - 1]);
      expect(errAfterSubmit.type).toBe("ERROR");
      expect(errAfterSubmit.code).toBe("UNAUTHORIZED_PLAYER");
      expect((server as any).state.players[hostId].lastAnswer).toBeNull();
    });

    it("prevents unbound connection from locking out host or spoofing actions without valid token (SA2-04)", async () => {
      const mock = createMockPartyRoom("LOCKOUT-GUARD-ROOM");
      const server = new ArenaServer(mock.room);

      // Room initialized via HTTP (host not yet connected via WebSocket)
      const httpInitReq = new Request("http://localhost:1999/party/LOCKOUT-GUARD-ROOM/init", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-party-internal": "1" },
        body: JSON.stringify({ hostNickname: "RealHost", hostTier: "pro" }),
      });
      const initRes = await server.onRequest(httpInitReq as unknown as Party.Request);
      const initData = await initRes.json();
      const hostId = initData.hostPlayer.id;
      const hostToken = initData.playerToken;

      expect(hostToken).toMatch(/^tok_/);
      expect((server as any).connectionPlayers.size).toBe(0);

      // 1. Attacker connects via WebSocket before host connects
      const attackerConn = createMockConnection("attacker_conn");

      // Attacker attempts ACTION without token claiming hostId
      await server.onMessage(
        JSON.stringify({
          type: "ACTION",
          playerId: hostId,
          action: { type: "START_MATCH" },
        }),
        attackerConn as unknown as Party.Connection,
      );

      const errWithoutToken = JSON.parse(attackerConn.sentMessages[0]);
      expect(errWithoutToken.type).toBe("ERROR");
      expect(errWithoutToken.code).toBe("UNAUTHORIZED_PLAYER");
      // Connection MUST NOT be bound!
      expect((server as any).connectionPlayers.has("attacker_conn")).toBe(false);

      // Attacker attempts ACTION with invalid token claiming hostId
      await server.onMessage(
        JSON.stringify({
          type: "ACTION",
          playerId: hostId,
          token: "tok_invalid_attacker_guess",
          action: { type: "START_MATCH" },
        }),
        attackerConn as unknown as Party.Connection,
      );

      const errWithWrongToken = JSON.parse(attackerConn.sentMessages[1]);
      expect(errWithWrongToken.type).toBe("ERROR");
      expect(errWithWrongToken.code).toBe("UNAUTHORIZED_PLAYER");
      expect((server as any).connectionPlayers.has("attacker_conn")).toBe(false);

      // 2. Real host connects via WebSocket and provides valid token
      const realHostConn = createMockConnection("real_host_conn");
      await server.onMessage(
        JSON.stringify({
          type: "ACTION",
          playerId: hostId,
          token: hostToken,
          action: { type: "TOGGLE_READY" },
        }),
        realHostConn as unknown as Party.Connection,
      );

      // Real host connection binds successfully
      expect((server as any).connectionPlayers.get("real_host_conn")).toBe(hostId);

      // 3. HTTP POST /parties/arena/[id]/action requires valid token
      const httpBadAction = new Request("http://localhost:1999/party/LOCKOUT-GUARD-ROOM/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: hostId,
          action: { type: "START_MATCH" },
        }),
      });
      const httpBadRes = await server.onRequest(httpBadAction as unknown as Party.Request);
      expect(httpBadRes.status).toBe(403);
      const httpBadData = await httpBadRes.json();
      expect(httpBadData.ok).toBe(false);
      expect(httpBadData.error.code).toBe("UNAUTHORIZED_PLAYER");

      const httpGoodAction = new Request("http://localhost:1999/party/LOCKOUT-GUARD-ROOM/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: hostId,
          token: hostToken,
          action: { type: "START_MATCH" },
        }),
      });
      const httpGoodRes = await server.onRequest(httpGoodAction as unknown as Party.Request);
      expect(httpGoodRes.status).toBe(200);
      const httpGoodData = await httpGoodRes.json();
      expect(httpGoodData.ok).toBe(true);
      expect((server as any).state.status).toBe("countdown");
    });

    it("rejects direct external HTTP POST and DELETE to __lobby__ without x-party-internal header", async () => {
      const mock = createMockPartyRoom("__lobby__");
      const server = new ArenaServer(mock.room);

      const postReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "FAKE01",
          title: "Fake Lobby",
          status: "lobby",
          playerCount: 99,
          mode: "exact",
          totalQuestions: 10,
          createdAt: new Date().toISOString(),
        }),
      });
      const postRes = await server.onRequest(postReq as unknown as Party.Request);
      expect(postRes.status).toBe(403);
      const postData = await postRes.json();
      expect(postData.ok).toBe(false);
      expect(postData.error.code).toBe("FORBIDDEN");

      const delReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "FAKE01" }),
      });
      const delRes = await server.onRequest(delReq as unknown as Party.Request);
      expect(delRes.status).toBe(403);

      // Internal call with x-party-internal: 1 succeeds
      const internalPostReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-party-internal": "1",
        },
        body: JSON.stringify({
          code: "VALID1",
          title: "Valid Lobby",
          status: "lobby",
          playerCount: 1,
          mode: "exact",
          totalQuestions: 5,
          createdAt: new Date().toISOString(),
        }),
      });
      const internalRes = await server.onRequest(internalPostReq as unknown as Party.Request);
      expect(internalRes.status).toBe(200);
    });

    it("masks lastAnswer.correct and lastAnswer.points in ArenaServer.getClientState() during answering (SA-12)", async () => {
      const mock = createMockPartyRoom("MASK-ORACLE");
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

      const hostId = JSON.parse(hostConn.sentMessages[0]).hostPlayer.id;
      (server as any).startRound(0);

      const correctIdx = mockMicroeconomics.questions[0].correctIndex;
      (server as any).submitAnswer(hostId, correctIdx);

      // Room is still in "answering" because guest has not submitted
      expect((server as any).state.status).toBe("answering");

      const clientState = (server as any).getClientState() as ArenaRoomState;
      expect(clientState.players[hostId].lastAnswer).toEqual({
        selected: null,
        correct: null,
        points: 0,
        answeredAtMs: expect.any(Number),
      });
    });

    it("masks score, lives, streak, and status in ArenaServer.getClientState() during answering (SA2-21)", async () => {
      const mock = createMockPartyRoom("MASK-SCORE-LIVES");
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

      const hostId = JSON.parse(hostConn.sentMessages[0]).hostPlayer.id;
      const guestId = JSON.parse(guestConn.sentMessages[0]).player.id;

      // Complete round 0 to establish streak 1 and score 100
      (server as any).startRound(0);
      const q0CorrectIdx = mockMicroeconomics.questions[0].correctIndex;
      (server as any).submitAnswer(hostId, q0CorrectIdx);
      (server as any).submitAnswer(guestId, q0CorrectIdx);
      (server as any).endRound();

      expect((server as any).state.players[hostId].score).toBe(100);
      expect((server as any).state.players[hostId].streak).toBe(1);

      // Start round 1
      (server as any).startRound(1);
      expect((server as any).state.status).toBe("answering");

      // Host submits correct answer for question 1 (streak -> 2, score -> 200)
      const q1CorrectIdx = mockMicroeconomics.questions[1].correctIndex;
      (server as any).submitAnswer(hostId, q1CorrectIdx);
      expect((server as any).state.status).toBe("answering");

      // Public broadcast getClientState() masks host's score and streak
      const publicState = (server as any).getClientState() as ArenaRoomState;
      expect(publicState.players[hostId].score).toBe(100);
      expect(publicState.players[hostId].streak).toBe(1);
      expect(publicState.players[hostId].lives).toBe(3);
      expect(publicState.players[hostId].status).toBe("submitted");
      expect(publicState.players[hostId].lastAnswer?.correct).toBeNull();
      expect(publicState.players[hostId].lastAnswer?.points).toBe(0);
      expect(publicState.players[hostId].lastAnswer?.selected).toBeNull();

      // Guest perspective masks host's score and streak
      const guestPerspective = (server as any).getClientState(guestId) as ArenaRoomState;
      expect(guestPerspective.players[hostId].score).toBe(100);
      expect(guestPerspective.players[hostId].streak).toBe(1);
      expect(guestPerspective.players[hostId].lives).toBe(3);
      expect(guestPerspective.players[hostId].status).toBe("submitted");

      // Host sees their own true score and streak
      const hostPerspective = (server as any).getClientState(hostId) as ArenaRoomState;
      expect(hostPerspective.players[hostId].score).toBe(200);
      expect(hostPerspective.players[hostId].streak).toBe(2);
      expect(hostPerspective.players[hostId].lives).toBe(3);
      expect(hostPerspective.players[hostId].status).toBe("submitted");
      expect(hostPerspective.players[hostId].lastAnswer?.selected).toBe(q1CorrectIdx);

      // End round 1
      (server as any).endRound();

      // Start round 2 to test elimination masking
      (server as any).startRound(2);
      (server as any).state.players[guestId].lives = 1;
      const q2CorrectIdx = mockMicroeconomics.questions[2].correctIndex;
      const wrongIdx = (q2CorrectIdx + 1) % 4;

      (server as any).submitAnswer(guestId, wrongIdx);
      expect((server as any).state.status).toBe("answering");
      expect((server as any).state.players[guestId].lives).toBe(0);
      expect((server as any).state.players[guestId].status).toBe("eliminated");

      // Competitors and public see guest lives masked to 1 and status masked to "submitted"
      const maskedPublic = (server as any).getClientState() as ArenaRoomState;
      expect(maskedPublic.players[guestId].lives).toBe(1);
      expect(maskedPublic.players[guestId].status).toBe("submitted");

      const hostPerspectiveOnGuest = (server as any).getClientState(hostId) as ArenaRoomState;
      expect(hostPerspectiveOnGuest.players[guestId].lives).toBe(1);
      expect(hostPerspectiveOnGuest.players[guestId].status).toBe("submitted");

      // Guest themselves sees their true eliminated status and 0 lives
      const guestPerspectiveOnSelf = (server as any).getClientState(guestId) as ArenaRoomState;
      expect(guestPerspectiveOnSelf.players[guestId].lives).toBe(0);
      expect(guestPerspectiveOnSelf.players[guestId].status).toBe("eliminated");

      // Once round transitions to feedback, revealed feedback and true status are exposed
      (server as any).endRound();
      expect((server as any).state.status).toBe("feedback");
      const feedbackState = (server as any).getClientState() as ArenaRoomState;
      expect(feedbackState.players[guestId].lives).toBe(0);
      expect(feedbackState.players[guestId].status).toBe("eliminated");
      expect(feedbackState.revealedFeedback).not.toBeNull();
      expect(feedbackState.revealedFeedback?.correctIndex).toBe(q2CorrectIdx);
    });

    it("rejects invalid join and action payloads with Zod schema validation errors (SA2-21)", async () => {
      const mock = createMockPartyRoom("ZOD-VALIDATE-ROOM");
      const server = new ArenaServer(mock.room);
      const hostConn = createMockConnection("host");
      const guestConn = createMockConnection("guest");

      // Initialize room
      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: { hostNickname: "Host", hostTier: "contender" },
        }),
        hostConn as unknown as Party.Connection,
      );
      const hostId = JSON.parse(hostConn.sentMessages[0]).hostPlayer.id;
      const hostToken = JSON.parse(hostConn.sentMessages[0]).playerToken;

      // 1. WebSocket JOIN_ROOM with invalid payload (empty nickname)
      await server.onMessage(
        JSON.stringify({
          type: "JOIN_ROOM",
          payload: { nickname: "" },
        }),
        guestConn as unknown as Party.Connection,
      );

      const joinErr = JSON.parse(guestConn.sentMessages[0]);
      expect(joinErr.type).toBe("ERROR");
      expect(joinErr.code).toBe("INVALID_PAYLOAD");
      expect(joinErr.message).toBe("Invalid join payload.");
      expect(joinErr.errors).toBeDefined();

      // 2. WebSocket ACTION with invalid action type
      await server.onMessage(
        JSON.stringify({
          type: "ACTION",
          playerId: hostId,
          token: hostToken,
          action: { type: "NOT_A_REAL_ACTION" },
        }),
        hostConn as unknown as Party.Connection,
      );

      const actionErr = JSON.parse(hostConn.sentMessages[hostConn.sentMessages.length - 1]);
      expect(actionErr.type).toBe("ERROR");
      expect(actionErr.code).toBe("INVALID_ACTION");
      expect(actionErr.message).toBe("Invalid room action.");
      expect(actionErr.errors).toBeDefined();

      // 3. WebSocket ACTION with out-of-bounds selected answer (e.g. 5)
      await server.onMessage(
        JSON.stringify({
          type: "ACTION",
          playerId: hostId,
          token: hostToken,
          action: { type: "SUBMIT_ANSWER", selected: 5 },
        }),
        hostConn as unknown as Party.Connection,
      );

      const submitErr = JSON.parse(hostConn.sentMessages[hostConn.sentMessages.length - 1]);
      expect(submitErr.type).toBe("ERROR");
      expect(submitErr.code).toBe("INVALID_ACTION");
      expect(submitErr.message).toBe("Invalid room action.");
      expect(submitErr.errors).toBeDefined();

      // 4. HTTP POST /join with invalid payload
      const httpJoinBad = new Request("http://localhost:1999/party/ZOD-VALIDATE-ROOM/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: "   " }),
      });
      const httpJoinRes = await server.onRequest(httpJoinBad as unknown as Party.Request);
      expect(httpJoinRes.status).toBe(400);
      const httpJoinData = await httpJoinRes.json();
      expect(httpJoinData.ok).toBe(false);
      expect(httpJoinData.error).toBeDefined();

      // 5. HTTP POST /action with invalid action type
      const httpActionBad = new Request("http://localhost:1999/party/ZOD-VALIDATE-ROOM/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: hostId,
          token: hostToken,
          action: { type: "INVALID_ACTION" },
        }),
      });
      const httpActionRes = await server.onRequest(httpActionBad as unknown as Party.Request);
      expect(httpActionRes.status).toBe(400);
      const httpActionData = await httpActionRes.json();
      expect(httpActionData.ok).toBe(false);
      expect(httpActionData.error).toBeDefined();

      // 6. HTTP POST /action with negative selected answer
      const httpActionNegative = new Request("http://localhost:1999/party/ZOD-VALIDATE-ROOM/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: hostId,
          token: hostToken,
          action: { type: "SUBMIT_ANSWER", selected: -1 },
        }),
      });
      const httpActionNegRes = await server.onRequest(httpActionNegative as unknown as Party.Request);
      expect(httpActionNegRes.status).toBe(400);
      const httpActionNegData = await httpActionNegRes.json();
      expect(httpActionNegData.ok).toBe(false);
      expect(httpActionNegData.error).toBeDefined();
    });
  });

  describe("5. Room Initialization Authorization & Directory Hardening (SA2-12, SA2-13)", () => {
    it("CORS_HEADERS does not contain x-party-internal", () => {
      expect(CORS_HEADERS["Access-Control-Allow-Headers"]).not.toContain("x-party-internal");
      expect(CORS_HEADERS["Access-Control-Allow-Headers"]).toBe("Content-Type, x-player-token");
    });

    it("HTTP POST /init returns 401 UNAUTHORIZED when x-party-internal header is missing", async () => {
      const mock = createMockPartyRoom("AUTH-INIT-401");
      const server = new ArenaServer(mock.room);

      const initReq = new Request("http://localhost:1999/party/AUTH-INIT-401/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostNickname: "UntrustedCaller",
          hostTier: "tutor",
        }),
      });

      const res = await server.onRequest(initReq as unknown as Party.Request);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe("UNAUTHORIZED");
      expect(data.error.message).toBe("Direct room initialization requires server authorization.");
    });

    it("clamps direct WebSocket INIT_ROOM with hostTier: 'tutor' and maxPlayers: 50 to contender tier defaults (SA2-12)", async () => {
      const mock = createMockPartyRoom("SPOOF-WS-ROOM");
      const server = new ArenaServer(mock.room);
      const conn = createMockConnection("attacker_conn");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: {
            hostNickname: "Spoofer",
            hostTier: "tutor",
            maxPlayers: 50,
            mode: "variants",
          },
        }),
        conn as unknown as Party.Connection,
      );

      const msg = JSON.parse(conn.sentMessages[0]);
      expect(msg.type).toBe("INIT_SUCCESS");
      expect(msg.room.hostTier).toBe("contender");
      expect(msg.room.maxPlayers).toBe(8);
      expect(msg.room.mode).toBe("exact");
    });

    it("rejects direct WebSocket INIT_ROOM with INVALID_PAYLOAD if payload is invalid", async () => {
      const mock = createMockPartyRoom("INVALID-WS-ROOM");
      const server = new ArenaServer(mock.room);
      const conn = createMockConnection("bad_conn");

      await server.onMessage(
        JSON.stringify({
          type: "INIT_ROOM",
          payload: {
            title: "No Nickname Provided",
          },
        }),
        conn as unknown as Party.Connection,
      );

      const msg = JSON.parse(conn.sentMessages[0]);
      expect(msg.type).toBe("ERROR");
      expect(msg.code).toBe("INVALID_PAYLOAD");
      expect(msg.message).toBe("Invalid room creation payload.");
    });

    it("rejects direct __lobby__ mutation with 403 FORBIDDEN when secret header is missing", async () => {
      const mock = createMockPartyRoom("__lobby__");
      const server = new ArenaServer(mock.room);

      const postReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "FORBIDDEN_ROOM", status: "lobby" }),
      });
      const postRes = await server.onRequest(postReq as unknown as Party.Request);
      expect(postRes.status).toBe(403);
      const postData = await postRes.json();
      expect(postData.ok).toBe(false);
      expect(postData.error.code).toBe("FORBIDDEN");
      expect(postData.error.message).toBe("Direct lobby mutation is forbidden.");

      const delReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "FORBIDDEN_ROOM" }),
      });
      const delRes = await server.onRequest(delReq as unknown as Party.Request);
      expect(delRes.status).toBe(403);
      const delData = await delRes.json();
      expect(delData.ok).toBe(false);
      expect(delData.error.code).toBe("FORBIDDEN");
    });

    it("enforces configured PARTYKIT_INTERNAL_SECRET when room.env has secret configured", async () => {
      const mock = createMockPartyRoom("__lobby__");
      (mock.room as any).env = { PARTYKIT_INTERNAL_SECRET: "custom-configured-secret" };
      const server = new ArenaServer(mock.room);

      // Attempt with fallback "1" should be rejected when secret is configured
      const fallbackReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-party-internal": "1",
        },
        body: JSON.stringify({ code: "CUSTOM_ROOM", status: "lobby" }),
      });
      const fallbackRes = await server.onRequest(fallbackReq as unknown as Party.Request);
      expect(fallbackRes.status).toBe(403);

      // Attempt with matching x-party-internal should succeed
      const validReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-party-internal": "custom-configured-secret",
        },
        body: JSON.stringify({
          code: "CUSTOM_ROOM",
          title: "Custom Room",
          status: "lobby",
          playerCount: 1,
          mode: "exact",
          totalQuestions: 5,
          createdAt: new Date().toISOString(),
        }),
      });
      const validRes = await server.onRequest(validReq as unknown as Party.Request);
      expect(validRes.status).toBe(200);

      // Attempt with Authorization Bearer header should succeed
      const bearerReq = new Request("http://localhost:1999/party/__lobby__", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer custom-configured-secret",
        },
        body: JSON.stringify({
          code: "CUSTOM_ROOM_2",
          title: "Custom Room 2",
          status: "lobby",
          playerCount: 2,
          mode: "exact",
          totalQuestions: 5,
          createdAt: new Date().toISOString(),
        }),
      });
      const bearerRes = await server.onRequest(bearerReq as unknown as Party.Request);
      expect(bearerRes.status).toBe(200);
    });
  });
});
