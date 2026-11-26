import { mockMicroeconomics } from "@/data/mock-microeconomics";
import { pointsForStreak } from "@/lib/game/scoring";
import {
  BOT_ARCHETYPES,
  generateBotDecision,
  type BotProfile,
} from "@/lib/multiplayer/bot-ai";
import {
  computeClassAnalytics,
  finishQuestionRound,
  type ServerRoom,
} from "@/lib/multiplayer/room-manager";
import { getMaxArenaPlayersForTier, type UserTier } from "@/lib/pricing/tiers";
import {
  createRoomSchema,
  joinRoomSchema,
  roomActionSchema,
  type ArenaPlayer,
  type ArenaRoomState,
  type MultiplayerQuestion,
  type RevealedFeedback,
  type RoomAction,
  type RoomStatus,
} from "@/lib/schemas/multiplayer";
import type { QuestionItem, StudyPack } from "@/lib/schemas/question";

const DEFAULT_ALLOWED_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": DEFAULT_ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-player-token",
};

export const STALE_LOBBY_TIMEOUT_MS = 15 * 60_000;
export const STALE_MATCH_TIMEOUT_MS = 60 * 60_000;

function timingSafeMatch(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export type PartyRoomData = {
  code: string;
  title: string;
  hostId: string;
  hostTier: UserTier;
  maxPlayers: number;
  lastActiveAt: number;
  roundHistory: ServerRoom["roundHistory"];
  earlyEliminatedIds: Set<string>;
  status: RoomStatus;
  mode: "exact" | "variants";
  pack: StudyPack;
  currentQuestionIndex: number;
  totalQuestions: number;
  roundDeadline: number;
  feedbackDeadline: number;
  countdownEndsAt: number;
  players: Record<string, ArenaPlayer>;
  playerTokens?: Record<string, string>;
  createdAt: string;
  podium: ArenaRoomState["podium"];
};

export interface PartyConnection {
  id: string;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

export interface PartyStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean | void>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm?: () => Promise<number | null>;
  deleteAlarm?: () => Promise<void>;
}

export interface PartyRoom {
  id: string;
  env: Record<string, unknown>;
  storage: PartyStorage;
  broadcast(msg: string, without?: string[]): void;
  getConnections(): Iterable<PartyConnection>;
  context: {
    parties: {
      arena: {
        get(name: string): { fetch(init: RequestInit): Promise<Response> };
      };
    };
  };
}

export type PartyRequest = Request;

export interface PartyServer {
  onStart?(): Promise<void> | void;
  onAlarm?(): Promise<void> | void;
  onConnect?(conn: PartyConnection): Promise<void> | void;
  onClose?(conn: PartyConnection): Promise<void> | void;
  onMessage?(message: string, sender: PartyConnection): Promise<void> | void;
  onRequest?(req: PartyRequest): Promise<Response> | Response;
}

export type OpenRoomSummary = {
  code: string;
  title: string;
  status: RoomStatus;
  playerCount: number;
  mode: "exact" | "variants";
  totalQuestions: number;
  createdAt: string;
};

export default class ArenaServer implements PartyServer {
  private state: PartyRoomData | null = null;
  private botTimeouts: any[] = [];
  private roundTimeout: any = null;
  private feedbackTimeout: any = null;
  private countdownTimeout: any = null;
  private connectionPlayers: Map<string, string> = new Map();

  // Directory state if this instance is running as the "__lobby__" room
  private directory: Map<string, OpenRoomSummary> = new Map();

  constructor(readonly room: PartyRoom) {}

  async onStart() {
    // Restore persistent state if available
    if (this.room.id === "__lobby__") {
      const stored = await this.room.storage.get<Record<string, OpenRoomSummary>>("directory");
      if (stored) {
        this.directory = new Map(Object.entries(stored));
      }
      return;
    }

    const stored = await this.room.storage.get<any>("room_data");
    if (stored) {
      const rawEarly = stored.earlyEliminatedIds;
      const earlyEliminated = Array.isArray(rawEarly)
        ? rawEarly
        : rawEarly instanceof Set
        ? Array.from(rawEarly)
        : [];
      this.state = {
        ...stored,
        hostTier: stored.hostTier ?? "contender",
        maxPlayers: stored.maxPlayers ?? getMaxArenaPlayersForTier("contender"),
        lastActiveAt: stored.lastActiveAt ?? Date.now(),
        roundHistory: stored.roundHistory ?? {},
        earlyEliminatedIds: new Set(earlyEliminated),
        playerTokens: stored.playerTokens ?? {},
      };
      await this.cleanupIfStaleLobby();
    }
  }

  async onAlarm() {
    await this.cleanupIfStaleLobby();
  }

  private getConfiguredInternalSecret(): string | null {
    const raw =
      (this.room.env as Record<string, unknown> | undefined)
        ?.PARTYKIT_INTERNAL_SECRET ??
      process.env.PARTYKIT_INTERNAL_SECRET;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private getCorsHeaders(req?: PartyRequest): Record<string, string> {
    const reqOrigin = req?.headers.get("origin");
    if (reqOrigin) {
      try {
        const parsed = new URL(reqOrigin);
        const envObj = (this.room.env as Record<string, unknown> | undefined) ?? {};
        const configuredOrigins = [
          envObj.NEXT_PUBLIC_SITE_URL,
          envObj.NEXT_PUBLIC_APP_URL,
          process.env.NEXT_PUBLIC_SITE_URL,
          process.env.NEXT_PUBLIC_APP_URL,
          ...(typeof envObj.ALLOWED_ORIGINS === "string"
            ? envObj.ALLOWED_ORIGINS.split(",")
            : []),
          ...(typeof process.env.ALLOWED_ORIGINS === "string"
            ? process.env.ALLOWED_ORIGINS.split(",")
            : []),
        ]
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => {
            try {
              return new URL(v.trim()).origin;
            } catch {
              return v.trim();
            }
          });

        const isLocalDev =
          process.env.NODE_ENV !== "production" &&
          (parsed.hostname === "localhost" ||
            parsed.hostname === "127.0.0.1" ||
            parsed.hostname === "0.0.0.0");

        if (configuredOrigins.includes(parsed.origin) || isLocalDev) {
          return {
            ...CORS_HEADERS,
            "Access-Control-Allow-Origin": parsed.origin,
            Vary: "Origin",
          };
        }
      } catch {
        // Ignore malformed Origin header and fall back to default configured origin
      }
    }
    return {
      ...CORS_HEADERS,
      Vary: "Origin",
    };
  }

  /** Removes a room that has sat idle past its status timeout (15m lobby, 60m match/podium). */
  private async cleanupIfStaleLobby(): Promise<boolean> {
    if (!this.state) return false;
    const timeoutMs =
      this.state.status === "lobby"
        ? STALE_LOBBY_TIMEOUT_MS
        : STALE_MATCH_TIMEOUT_MS;
    if (Date.now() - this.state.lastActiveAt < timeoutMs) return false;

    const code = this.state.code;
    this.clearTimers();
    this.state = null;
    this.connectionPlayers.clear();
    await this.room.storage.deleteAll();
    for (const conn of this.room.getConnections()) {
      conn.close();
    }
    try {
      const secret =
        this.getConfiguredInternalSecret() ??
        (process.env.NODE_ENV === "test" ? "1" : null);
      if (secret) {
        await this.room.context.parties.arena
          .get("__lobby__")
          .fetch({
            method: "DELETE",
            headers: { "Content-Type": "application/json", "x-party-internal": secret },
            body: JSON.stringify({ code }),
          });
      }
    } catch {
      // directory notification is non-blocking
    }
    return true;
  }

  // -------------------------------------------------------------
  // WebSocket Handlers
  // -------------------------------------------------------------
  onConnect(conn: PartyConnection) {
    if (this.room.id === "__lobby__") {
      conn.send(
        JSON.stringify({
          type: "lobby_rooms",
          rooms: Array.from(this.directory.values()).filter((r) => r.status === "lobby"),
        }),
      );
      return;
    }

    if (this.state) {
      conn.send(
        JSON.stringify({
          type: "room_state",
          payload: this.getClientState(),
        }),
      );
    }
  }

  onClose(conn: PartyConnection) {
    this.connectionPlayers.delete(conn.id);
  }

  async onMessage(message: string, sender: PartyConnection) {
    try {
      const parsed = JSON.parse(message);

      if (parsed.type === "INIT_ROOM") {
        if (this.state !== null) {
          sender.send(
            JSON.stringify({
              type: "ERROR",
              code: "ALREADY_INITIALIZED",
              message: "Room is already initialized.",
            }),
          );
          return;
        }

        const configuredSecret = this.getConfiguredInternalSecret();
        if (configuredSecret !== null || process.env.NODE_ENV === "production") {
          const providedInternalSecret =
            typeof parsed.internalSecret === "string" ? parsed.internalSecret : "";
          if (
            !configuredSecret ||
            !providedInternalSecret ||
            !timingSafeMatch(providedInternalSecret, configuredSecret)
          ) {
            sender.send(
              JSON.stringify({
                type: "ERROR",
                code: "UNAUTHORIZED",
                message: "Direct room initialization requires server authorization.",
              }),
            );
            return;
          }
        }

        const parsedPayload = createRoomSchema.safeParse(parsed.payload);
        if (!parsedPayload.success) {
          sender.send(
            JSON.stringify({
              type: "ERROR",
              code: "INVALID_PAYLOAD",
              message: "Invalid room creation payload.",
            }),
          );
          return;
        }

        const { hostPlayer, playerToken } = this.initializeRoom({
          ...parsedPayload.data,
          hostTier: "contender",
          maxPlayers: Math.min(parsedPayload.data.maxPlayers ?? 8, 8),
        });
        this.connectionPlayers.set(sender.id, hostPlayer.id);
        sender.send(
          JSON.stringify({
            type: "INIT_SUCCESS",
            code: this.room.id,
            hostPlayer,
            playerToken,
            room: this.getClientState(),
          }),
        );
        await this.persist();
        this.broadcastRoom();
        await this.notifyDirectory();
        return;
      }

      if (parsed.type === "JOIN_ROOM") {
        const parsedJoin = joinRoomSchema.safeParse(parsed.payload);
        if (!parsedJoin.success) {
          sender.send(
            JSON.stringify({
              type: "ERROR",
              code: "INVALID_PAYLOAD",
              message: "Invalid join payload.",
              errors: parsedJoin.error.flatten(),
            }),
          );
          return;
        }

        if (
          this.state &&
          Object.keys(this.state.players).length >= (this.state.maxPlayers || 8)
        ) {
          sender.send(
            JSON.stringify({
              type: "ERROR",
              code: "ROOM_FULL",
              message: `Arena room "${this.room.id}" is full (maximum ${this.state.maxPlayers} players for ${this.state.hostTier} tier).`,
              maxPlayers: this.state.maxPlayers,
              hostTier: this.state.hostTier,
            }),
          );
          return;
        }
        const player = this.joinPlayer(parsedJoin.data);
        if (player) {
          this.connectionPlayers.set(sender.id, player.id);
          sender.send(
            JSON.stringify({
              type: "JOIN_SUCCESS",
              code: this.room.id,
              player,
              playerToken: this.state!.playerTokens?.[player.id],
              room: this.getClientState(),
            }),
          );
          await this.persist();
          this.broadcastRoom();
          await this.notifyDirectory();
        } else {
          sender.send(
            JSON.stringify({
              type: "ERROR",
              message: "Unable to join room (room not found or already started).",
            }),
          );
        }
        return;
      }

      if (parsed.type === "ACTION") {
        const parsedAction = roomActionSchema.safeParse(parsed.action);
        if (!parsedAction.success) {
          sender.send(
            JSON.stringify({
              type: "ERROR",
              code: "INVALID_ACTION",
              message: "Invalid room action.",
              errors: parsedAction.error.flatten(),
            }),
          );
          return;
        }

        const action = parsedAction.data;
        const { playerId } = parsed;
        if (this.connectionPlayers.has(sender.id)) {
          if (this.connectionPlayers.get(sender.id) !== playerId) {
            sender.send(
              JSON.stringify({
                type: "ERROR",
                code: "UNAUTHORIZED_PLAYER",
                message: "Unauthorized player action.",
              }),
            );
            return;
          }
          if (
            parsed.token !== undefined &&
            parsed.token !== null &&
            parsed.token !== this.state?.playerTokens?.[playerId]
          ) {
            sender.send(
              JSON.stringify({
                type: "ERROR",
                code: "UNAUTHORIZED_PLAYER",
                message: "Unauthorized player action.",
              }),
            );
            return;
          }
        } else {
          const expectedToken = this.state?.playerTokens?.[playerId];
          const isPlayerBoundToOtherConn = Array.from(this.connectionPlayers.entries()).some(
            ([connId, boundPlayerId]) => connId !== sender.id && boundPlayerId === playerId,
          );
          if (
            !expectedToken ||
            !parsed.token ||
            parsed.token !== expectedToken ||
            isPlayerBoundToOtherConn
          ) {
            sender.send(
              JSON.stringify({
                type: "ERROR",
                code: "UNAUTHORIZED_PLAYER",
                message: "Unauthorized player action.",
              }),
            );
            return;
          }
          this.connectionPlayers.set(sender.id, playerId);
        }
        const ok = this.handleAction(playerId, action);
        if (ok) {
          await this.persist();
          this.broadcastRoom();
          if (action.type === "START_MATCH" || action.type === "REMATCH") {
            await this.notifyDirectory();
          }
        }
        return;
      }

      if (parsed.type === "GET_STATE") {
        if (this.state) {
          sender.send(
            JSON.stringify({
              type: "room_state",
              payload: this.getClientState(),
            }),
          );
        }
        return;
      }
    } catch (err: unknown) {
      console.error(
        "[PartyArena] WebSocket message handling failed:",
        err instanceof Error ? err.message : err,
      );
      sender.send(
        JSON.stringify({
          type: "ERROR",
          code: "INVALID_MESSAGE",
          message: "Unable to process room message.",
        }),
      );
    }
  }

  private isInternalAuthorized(req: PartyRequest): boolean {
    const configuredSecret = this.getConfiguredInternalSecret();
    const providedSecret =
      req.headers.get("x-party-internal") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (configuredSecret) {
      return Boolean(
        providedSecret && timingSafeMatch(providedSecret, configuredSecret),
      );
    }
    if (process.env.NODE_ENV === "test") {
      return providedSecret === "1";
    }
    return false;
  }

  // -------------------------------------------------------------
  // HTTP REST API Handlers (Supports Vercel & CORS)
  // -------------------------------------------------------------
  async onRequest(req: PartyRequest): Promise<Response> {
    const corsHeaders = this.getCorsHeaders(req);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url);

    // If lobby directory
    if (this.room.id === "__lobby__") {
      if (req.method === "GET") {
        const rooms = Array.from(this.directory.values()).filter((r) => r.status === "lobby");
        return Response.json({ ok: true, rooms }, { headers: corsHeaders });
      }

      if (req.method === "POST" || req.method === "DELETE") {
        if (!this.isInternalAuthorized(req)) {
          return Response.json(
            {
              ok: false,
              error: {
                code: "FORBIDDEN",
                message: "Direct lobby mutation is forbidden.",
              },
            },
            { status: 403, headers: corsHeaders },
          );
        }
      }

      if (req.method === "POST") {
        const summary: OpenRoomSummary = await req.json();
        if (summary.status === "podium") {
          this.directory.delete(summary.code);
        } else {
          if (!this.directory.has(summary.code) && this.directory.size >= 500) {
            const oldestKey = this.directory.keys().next().value;
            if (oldestKey !== undefined) {
              this.directory.delete(oldestKey);
            }
          }
          this.directory.set(summary.code, summary);
        }
        await this.room.storage.put("directory", Object.fromEntries(this.directory));
        return Response.json({ ok: true }, { headers: corsHeaders });
      }

      if (req.method === "DELETE") {
        const { code } = (await req.json()) as { code: string };
        this.directory.delete(code);
        await this.room.storage.put("directory", Object.fromEntries(this.directory));
        return Response.json({ ok: true }, { headers: corsHeaders });
      }
    }

    // Normal Room HTTP Handlers
    if (req.method === "GET") {
      if (!this.state) {
        return Response.json(
          { ok: false, error: { message: `Room "${this.room.id}" not found.` } },
          { status: 404, headers: corsHeaders },
        );
      }
      return Response.json(
        { ok: true, room: this.getClientState() },
        { headers: corsHeaders },
      );
    }

    if (req.method === "POST") {
      const pathname = url.pathname;

      if (pathname.endsWith("/init") || pathname.endsWith("/create")) {
        if (!this.isInternalAuthorized(req)) {
          return Response.json(
            {
              ok: false,
              error: {
                code: "UNAUTHORIZED",
                message: "Direct room initialization requires server authorization.",
              },
            },
            { status: 401, headers: corsHeaders },
          );
        }

        if (this.state !== null) {
          return Response.json(
            {
              ok: false,
              error: {
                code: "ALREADY_INITIALIZED",
                message: "Room is already initialized.",
              },
            },
            { status: 409, headers: corsHeaders },
          );
        }
        const body = (await req.json()) as unknown;
        const parsedInit = createRoomSchema.safeParse(body);
        if (!parsedInit.success) {
          return Response.json(
            {
              ok: false,
              error: {
                code: "INVALID_PAYLOAD",
                message: "Invalid room initialization payload.",
                details: parsedInit.error.flatten(),
              },
            },
            { status: 400, headers: corsHeaders },
          );
        }
        const { hostPlayer, playerToken } = this.initializeRoom(parsedInit.data);
        await this.persist();
        this.broadcastRoom();
        await this.notifyDirectory();
        return Response.json(
          {
            ok: true,
            code: this.room.id,
            hostPlayer,
            player: hostPlayer,
            playerToken,
            room: this.getClientState(),
          },
          { status: 201, headers: corsHeaders },
        );
      }

      if (pathname.endsWith("/join")) {
        const body = (await req.json()) as any;
        const parsedJoin = joinRoomSchema.safeParse(body);
        if (!parsedJoin.success) {
          return Response.json(
            { ok: false, error: parsedJoin.error.flatten() },
            { status: 400, headers: corsHeaders },
          );
        }
        if (!this.state) {
          return Response.json(
            { ok: false, error: { message: `Arena room "${this.room.id}" not found.` } },
            { status: 404, headers: corsHeaders },
          );
        }
        if (this.state.status !== "lobby") {
          return Response.json(
            { ok: false, error: { message: "This arena match has already started." } },
            { status: 400, headers: corsHeaders },
          );
        }
        if (Object.keys(this.state.players).length >= (this.state.maxPlayers || 8)) {
          return Response.json(
            {
              ok: false,
              error: {
                code: "ROOM_FULL",
                message: `Arena room "${this.room.id}" is full (maximum ${this.state.maxPlayers} players for ${this.state.hostTier} tier).`,
                maxPlayers: this.state.maxPlayers,
                hostTier: this.state.hostTier,
              },
            },
            { status: 403, headers: corsHeaders },
          );
        }
        const player = this.joinPlayer(parsedJoin.data);
        if (!player) {
          return Response.json(
            { ok: false, error: { message: "Cannot join room." } },
            { status: 400, headers: corsHeaders },
          );
        }
        await this.persist();
        this.broadcastRoom();
        await this.notifyDirectory();
        return Response.json(
          {
            ok: true,
            player,
            playerToken: this.state.playerTokens?.[player.id],
            room: this.getClientState(),
          },
          { headers: corsHeaders },
        );
      }

      if (pathname.endsWith("/action")) {
        const body = (await req.json()) as any;
        const parsedAction = roomActionSchema.safeParse(body?.action);
        if (!parsedAction.success) {
          return Response.json(
            { ok: false, error: parsedAction.error.flatten() },
            { status: 400, headers: corsHeaders },
          );
        }
        const providedToken = body.token ?? req.headers.get("x-player-token");
        const expectedToken = this.state?.playerTokens?.[body.playerId];
        if (!expectedToken || !providedToken || providedToken !== expectedToken) {
          return Response.json(
            {
              ok: false,
              error: {
                code: "UNAUTHORIZED_PLAYER",
                message: "Invalid player token.",
              },
            },
            { status: 403, headers: corsHeaders },
          );
        }
        const ok = this.handleAction(body.playerId, parsedAction.data);
        if (!ok) {
          return Response.json(
            { ok: false, error: { message: "Action rejected." } },
            { status: 400, headers: corsHeaders },
          );
        }
        await this.persist();
        this.broadcastRoom();
        return Response.json(
          { ok: true, room: this.getClientState() },
          { headers: corsHeaders },
        );
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  }

  // -------------------------------------------------------------
  // Internal Game Logic (Mirrored from tested room-manager)
  // -------------------------------------------------------------
  private initializeRoom(params: {
    hostNickname: string;
    hostAvatar?: string;
    title?: string;
    mode?: "exact" | "variants";
    pack?: StudyPack;
    maxPlayers?: number;
    hostTier?: UserTier;
  }): { hostPlayer: ArenaPlayer; playerToken: string } {
    this.clearTimers();

    const hostPlayer: ArenaPlayer = {
      id: `player_${crypto.randomUUID().slice(0, 8)}`,
      nickname: params.hostNickname?.trim() || "Host",
      avatar: params.hostAvatar || "⚡",
      score: 0,
      streak: 0,
      bestStreak: 0,
      lives: 3,
      isReady: true,
      isHost: true,
      isBot: false,
      status: "waiting",
      lastAnswer: null,
    };
    const hostToken = `tok_${crypto.randomUUID().replace(/-/g, "")}`;

    const pack = params.pack || mockMicroeconomics;
    const hostTier: UserTier = params.hostTier || "contender";

    let maxPlayers: number;
    if (params.hostTier !== undefined) {
      const tierCap = getMaxArenaPlayersForTier(params.hostTier);
      maxPlayers =
        params.maxPlayers !== undefined ? Math.min(params.maxPlayers, tierCap) : tierCap;
    } else {
      maxPlayers = params.maxPlayers ?? getMaxArenaPlayersForTier("contender");
    }

    let mode = params.mode || "exact";
    if (hostTier === "contender") {
      mode = "exact";
    }

    this.state = {
      code: this.room.id,
      title: params.title?.trim() || `${pack.title} Arena`,
      hostId: hostPlayer.id,
      hostTier,
      maxPlayers,
      lastActiveAt: Date.now(),
      roundHistory: {},
      earlyEliminatedIds: new Set(),
      status: "lobby",
      mode,
      pack,
      currentQuestionIndex: -1,
      totalQuestions: pack.questions.length,
      roundDeadline: 0,
      feedbackDeadline: 0,
      countdownEndsAt: 0,
      players: {
        [hostPlayer.id]: hostPlayer,
      },
      playerTokens: {
        [hostPlayer.id]: hostToken,
      },
      createdAt: new Date().toISOString(),
      podium: null,
    };

    return { hostPlayer, playerToken: hostToken };
  }

  private joinPlayer(params: { nickname: string; avatar?: string }): ArenaPlayer | null {
    if (!this.state || this.state.status !== "lobby") return null;
    if (Object.keys(this.state.players).length >= (this.state.maxPlayers || 8)) return null;

    const player: ArenaPlayer = {
      id: `player_${crypto.randomUUID().slice(0, 8)}`,
      nickname: params.nickname.trim(),
      avatar: params.avatar || "🧠",
      score: 0,
      streak: 0,
      bestStreak: 0,
      lives: 3,
      isReady: false,
      isHost: false,
      isBot: false,
      status: "waiting",
      lastAnswer: null,
    };
    const playerToken = `tok_${crypto.randomUUID().replace(/-/g, "")}`;

    this.state.players[player.id] = player;
    if (!this.state.playerTokens) {
      this.state.playerTokens = {};
    }
    this.state.playerTokens[player.id] = playerToken;
    return player;
  }

  private handleAction(playerId: string, action: RoomAction): boolean {
    if (!this.state) return false;

    switch (action.type) {
      case "START_MATCH":
        return this.startMatch(playerId);
      case "SUBMIT_ANSWER":
        return this.submitAnswer(playerId, action.selected);
      case "TOGGLE_READY":
        return this.toggleReady(playerId);
      case "ADD_BOT":
        return this.addBot(playerId, action.botType);
      case "REMOVE_BOT":
        return this.removeBot(playerId, action.botId);
      case "REMATCH":
        return this.rematch(playerId);
      default:
        return false;
    }
  }

  private startMatch(hostId: string): boolean {
    if (!this.state || this.state.status !== "lobby") return false;
    if (this.state.hostId !== hostId) return false;

    this.state.status = "countdown";
    this.state.countdownEndsAt = Date.now() + 3_000;
    this.broadcastRoom();

    if (this.countdownTimeout) clearTimeout(this.countdownTimeout);
    this.countdownTimeout = setTimeout(() => {
      this.startRound(0);
    }, 3_000);

    return true;
  }

  private startRound(questionIndex: number) {
    if (!this.state) return;
    this.clearTimers();

    this.state.status = "answering";
    this.state.currentQuestionIndex = questionIndex;
    this.state.roundDeadline = Date.now() + 15_000;

    const qItem = this.getActiveQuestionItem();
    if (!qItem) {
      this.endMatch();
      return;
    }

    const isVariant = this.state.mode === "variants" && qItem.conceptVariant;
    const correctIdx = isVariant ? qItem.conceptVariant.correctIndex : qItem.correctIndex;

    Object.values(this.state.players).forEach((p) => {
      if (p.lives > 0) {
        p.status = "answering";
        p.lastAnswer = null;
      } else {
        p.status = "eliminated";
      }
    });

    // Schedule bot answers natively
    Object.values(this.state.players)
      .filter((p) => p.isBot && p.lives > 0)
      .forEach((botPlayer) => {
        const template =
          BOT_ARCHETYPES.find((b) => b.avatar === botPlayer.avatar) || BOT_ARCHETYPES[0];
        const decision = generateBotDecision(template, correctIdx);

        const timeout = setTimeout(() => {
          if (this.state?.status === "answering" && botPlayer.status === "answering") {
            this.submitAnswer(botPlayer.id, decision.selectedIndex);
            this.broadcastRoom();
          }
        }, Math.min(decision.delayMs, 14_500));

        this.botTimeouts.push(timeout);
      });

    // Schedule deadline timeout natively
    this.roundTimeout = setTimeout(() => {
      if (this.state?.status === "answering") {
        this.handleRoundTimeout();
      }
    }, 15_000);

    this.broadcastRoom();
  }

  private submitAnswer(playerId: string, selectedIndex: number): boolean {
    if (!this.state || this.state.status !== "answering") return false;

    const player = this.state.players[playerId];
    if (!player || player.lives <= 0 || player.status !== "answering") {
      return false;
    }

    const qItem = this.getActiveQuestionItem();
    if (!qItem) return false;

    const isVariant = this.state.mode === "variants" && qItem.conceptVariant;
    const correctIdx = isVariant ? qItem.conceptVariant.correctIndex : qItem.correctIndex;
    const isCorrect = selectedIndex === correctIdx;
    const answeredAtMs = Date.now();

    let earnedPoints = 0;
    if (isCorrect) {
      player.streak += 1;
      if (player.streak > player.bestStreak) {
        player.bestStreak = player.streak;
      }
      earnedPoints = pointsForStreak(player.streak);
      player.score += earnedPoints;
    } else {
      player.streak = 0;
      player.lives = Math.max(0, player.lives - 1);
    }

    player.lastAnswer = {
      selected: selectedIndex,
      correct: isCorrect,
      points: earnedPoints,
      answeredAtMs,
    };

    player.status = player.lives === 0 ? "eliminated" : "submitted";

    const activePlayers = Object.values(this.state.players).filter((p) => p.lives > 0);
    const allSubmitted = activePlayers.every((p) => p.status === "submitted");

    if (allSubmitted) {
      if (this.roundTimeout) clearTimeout(this.roundTimeout);
      this.endRound();
    } else {
      this.broadcastRoom();
    }

    return true;
  }

  private handleRoundTimeout() {
    if (!this.state) return;

    Object.values(this.state.players).forEach((p) => {
      if (p.lives > 0 && p.status === "answering") {
        p.streak = 0;
        p.lives = Math.max(0, p.lives - 1);
        p.status = p.lives === 0 ? "eliminated" : "submitted";
        p.lastAnswer = {
          selected: null,
          correct: false,
          points: 0,
          answeredAtMs: Date.now(),
        };
      }
    });

    this.endRound();
  }

  private endRound() {
    if (!this.state) return;
    this.clearTimers();
    finishQuestionRound(this.state as ServerRoom);

    this.state.status = "feedback";
    this.state.feedbackDeadline = Date.now() + 4_000;
    this.broadcastRoom();

    this.feedbackTimeout = setTimeout(() => {
      if (!this.state) return;
      const aliveCount = Object.values(this.state.players).filter((p) => p.lives > 0).length;
      const nextIndex = this.state.currentQuestionIndex + 1;

      if (aliveCount === 0 || nextIndex >= this.state.pack.questions.length) {
        this.endMatch();
      } else {
        this.startRound(nextIndex);
      }
    }, 4_000);
  }

  private endMatch() {
    if (!this.state) return;
    this.clearTimers();
    if (
      this.state.currentQuestionIndex >= 0 &&
      !this.state.roundHistory[this.state.currentQuestionIndex]
    ) {
      finishQuestionRound(this.state as ServerRoom);
    }
    this.state.status = "podium";

    const ranked = Object.values(this.state.players).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.lives !== a.lives) return b.lives - a.lives;
      return b.bestStreak - a.bestStreak;
    });

    this.state.podium = {
      first: ranked[0] || null,
      second: ranked[1] || null,
      third: ranked[2] || null,
      rankings: ranked,
    };

    this.broadcastRoom();
  }

  private rematch(hostId: string): boolean {
    if (!this.state || this.state.hostId !== hostId) return false;

    this.clearTimers();
    this.state.status = "lobby";
    this.state.currentQuestionIndex = -1;
    this.state.podium = null;
    this.state.roundDeadline = 0;
    this.state.feedbackDeadline = 0;
    this.state.countdownEndsAt = 0;
    this.state.roundHistory = {};
    this.state.earlyEliminatedIds.clear();

    Object.values(this.state.players).forEach((p) => {
      p.score = 0;
      p.streak = 0;
      p.bestStreak = 0;
      p.lives = 3;
      p.status = "waiting";
      p.lastAnswer = null;
      p.isReady = p.isHost || p.isBot;
    });

    this.broadcastRoom();
    return true;
  }

  private toggleReady(playerId: string): boolean {
    if (!this.state || this.state.status !== "lobby") return false;
    const player = this.state.players[playerId];
    if (!player) return false;

    player.isReady = !player.isReady;
    this.broadcastRoom();
    return true;
  }

  private addBot(hostId: string, botType?: BotProfile["type"]): boolean {
    if (!this.state || this.state.status !== "lobby") return false;
    if (this.state.hostId !== hostId) return false;
    if (Object.keys(this.state.players).length >= (this.state.maxPlayers || 8)) return false;

    const existingBotNames = new Set(
      Object.values(this.state.players)
        .filter((p) => p.isBot)
        .map((p) => p.nickname),
    );

    const template =
      BOT_ARCHETYPES.find(
        (b) => (!botType || b.type === botType) && !existingBotNames.has(b.nickname),
      ) || BOT_ARCHETYPES[0];

    const botPlayer: ArenaPlayer = {
      id: `bot_${crypto.randomUUID().slice(0, 8)}`,
      nickname: existingBotNames.has(template.nickname)
        ? `${template.nickname} ${Math.floor(Math.random() * 90 + 10)}`
        : template.nickname,
      avatar: template.avatar,
      score: 0,
      streak: 0,
      bestStreak: 0,
      lives: 3,
      isReady: true,
      isHost: false,
      isBot: true,
      status: "waiting",
      lastAnswer: null,
    };

    this.state.players[botPlayer.id] = botPlayer;
    this.broadcastRoom();
    return true;
  }

  private removeBot(hostId: string, botId: string): boolean {
    if (!this.state || this.state.status !== "lobby") return false;
    if (this.state.hostId !== hostId) return false;

    if (this.state.players[botId]?.isBot) {
      delete this.state.players[botId];
      this.broadcastRoom();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  private clearTimers() {
    if (this.roundTimeout) clearTimeout(this.roundTimeout);
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    if (this.countdownTimeout) clearTimeout(this.countdownTimeout);
    this.botTimeouts.forEach((t) => clearTimeout(t));
    this.botTimeouts = [];
  }

  private getActiveQuestionItem(): QuestionItem | null {
    if (!this.state) return null;
    if (
      this.state.currentQuestionIndex < 0 ||
      this.state.currentQuestionIndex >= this.state.pack.questions.length
    ) {
      return null;
    }
    return this.state.pack.questions[this.state.currentQuestionIndex];
  }

  private getClientState(_forPlayerId?: string): ArenaRoomState {
    if (!this.state) {
      throw new Error("No room state initialized.");
    }

    const qItem = this.getActiveQuestionItem();
    let currentQuestion: MultiplayerQuestion | null = null;
    let revealedFeedback: RevealedFeedback | null = null;

    if (qItem && (this.state.status === "answering" || this.state.status === "feedback")) {
      const isVariant = this.state.mode === "variants" && qItem.conceptVariant;
      const textQuestion = isVariant ? qItem.conceptVariant.question : qItem.question;
      const textOptions = isVariant ? qItem.conceptVariant.options : qItem.options;
      const meta = this.state.pack.metadata[qItem.id];

      currentQuestion = {
        id: qItem.id,
        question: textQuestion,
        options: textOptions,
        number: this.state.currentQuestionIndex + 1,
        total: this.state.pack.questions.length,
        citation: meta?.citation,
        topic: meta?.topic,
      };

      if (this.state.status === "feedback") {
        const correctIdx = isVariant
          ? qItem.conceptVariant.correctIndex
          : qItem.correctIndex;
        const explanationText = isVariant
          ? qItem.conceptVariant.explanation
          : qItem.explanation;

        revealedFeedback = {
          correctIndex: correctIdx,
          explanation: explanationText,
          rule: meta?.rule,
          citation: meta?.citation,
        };
      }
    }

    const clientPlayers: Record<string, ArenaPlayer> =
      this.state.status === "answering"
        ? Object.fromEntries(
            Object.entries(this.state.players).map(([id, p]) => {
              const isSelf = Boolean(_forPlayerId && _forPlayerId === p.id);
              if (!p.lastAnswer) {
                return [
                  id,
                  {
                    ...p,
                    lastAnswer: null,
                  },
                ];
              }

              const maskedScore = p.score - (p.lastAnswer.points || 0);
              const maskedLives = !p.lastAnswer.correct ? p.lives + 1 : p.lives;

              let preStreak = 0;
              for (let q = this.state!.currentQuestionIndex - 1; q >= 0; q--) {
                if (this.state!.roundHistory?.[q]?.[p.id]?.correct) {
                  preStreak++;
                } else {
                  break;
                }
              }
              let preBestStreak = 0;
              let runningBest = 0;
              for (let q = 0; q < this.state!.currentQuestionIndex; q++) {
                if (this.state!.roundHistory?.[q]?.[p.id]?.correct) {
                  runningBest++;
                  if (runningBest > preBestStreak) {
                    preBestStreak = runningBest;
                  }
                } else {
                  runningBest = 0;
                }
              }
              const maskedStreak = preStreak;
              const maskedBestStreak = preBestStreak;
              const maskedStatus = p.status === "eliminated" ? "submitted" : p.status;

              return [
                id,
                {
                  ...p,
                  score: isSelf ? p.score : maskedScore,
                  lives: isSelf ? p.lives : maskedLives,
                  streak: isSelf ? p.streak : maskedStreak,
                  bestStreak: isSelf ? p.bestStreak : maskedBestStreak,
                  status: isSelf ? p.status : maskedStatus,
                  lastAnswer: {
                    selected: isSelf ? p.lastAnswer.selected : null,
                    correct: null,
                    points: 0,
                    answeredAtMs: p.lastAnswer.answeredAtMs,
                  },
                },
              ];
            }),
          )
        : this.state.players;

    return {
      code: this.state.code,
      title: this.state.title,
      hostId: this.state.hostId,
      status: this.state.status,
      currentQuestionIndex: this.state.currentQuestionIndex,
      totalQuestions: this.state.pack.questions.length,
      roundDeadline: this.state.roundDeadline,
      feedbackDeadline: this.state.feedbackDeadline,
      countdownEndsAt: this.state.countdownEndsAt,
      players: clientPlayers,
      currentQuestion,
      revealedFeedback,
      createdAt: this.state.createdAt,
      maxPlayers: this.state.maxPlayers,
      mode: this.state.mode,
      packId: this.state.pack.id,
      hostTier: this.state.hostTier,
      classAnalytics: computeClassAnalytics(this.state as ServerRoom),
      podium: this.state.podium,
    };
  }

  private broadcastRoom() {
    if (!this.state) return;
    const clientState = this.getClientState();
    this.room.broadcast(
      JSON.stringify({
        type: "room_state",
        payload: clientState,
      }),
    );
  }

  private async persist() {
    if (this.state) {
      this.state.lastActiveAt = Date.now();
      const serializable = {
        ...this.state,
        earlyEliminatedIds: Array.from(this.state.earlyEliminatedIds),
      };
      await this.room.storage.put("room_data", serializable);
      const timeoutMs =
        this.state.status === "lobby"
          ? STALE_LOBBY_TIMEOUT_MS
          : STALE_MATCH_TIMEOUT_MS;
      await this.room.storage.setAlarm(this.state.lastActiveAt + timeoutMs);
    }
  }

  private async notifyDirectory() {
    if (!this.state || this.room.id === "__lobby__") return;
    try {
      const secret =
        this.getConfiguredInternalSecret() ??
        (process.env.NODE_ENV === "test" ? "1" : null);
      if (!secret) return;
      const lobby = this.room.context.parties.arena.get("__lobby__");
      await lobby.fetch({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-party-internal": secret,
        },
        body: JSON.stringify({
          code: this.state.code,
          title: this.state.title,
          status: this.state.status,
          playerCount: Object.keys(this.state.players).length,
          mode: this.state.mode,
          totalQuestions: this.state.totalQuestions,
          createdAt: this.state.createdAt,
        }),
      });
    } catch {
      // directory notification is non-blocking
    }
  }
}
