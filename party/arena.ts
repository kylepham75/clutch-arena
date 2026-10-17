import type * as Party from "partykit/server";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import { pointsForStreak } from "@/lib/game/scoring";
import {
  BOT_ARCHETYPES,
  generateBotDecision,
  type BotProfile,
} from "@/lib/multiplayer/bot-ai";
import type {
  ArenaPlayer,
  ArenaRoomState,
  MultiplayerQuestion,
  RevealedFeedback,
  RoomAction,
  RoomStatus,
} from "@/lib/schemas/multiplayer";
import type { QuestionItem, StudyPack } from "@/lib/schemas/question";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export type PartyRoomData = {
  code: string;
  title: string;
  hostId: string;
  status: RoomStatus;
  mode: "exact" | "variants";
  pack: StudyPack;
  currentQuestionIndex: number;
  totalQuestions: number;
  roundDeadline: number;
  feedbackDeadline: number;
  countdownEndsAt: number;
  players: Record<string, ArenaPlayer>;
  createdAt: string;
  podium: ArenaRoomState["podium"];
};

export type OpenRoomSummary = {
  code: string;
  title: string;
  status: RoomStatus;
  playerCount: number;
  mode: "exact" | "variants";
  totalQuestions: number;
  createdAt: string;
};

export default class ArenaServer implements Party.Server {
  private state: PartyRoomData | null = null;
  private botTimeouts: any[] = [];
  private roundTimeout: any = null;
  private feedbackTimeout: any = null;
  private countdownTimeout: any = null;

  // Directory state if this instance is running as the "__lobby__" room
  private directory: Map<string, OpenRoomSummary> = new Map();

  constructor(readonly room: Party.Room) {}

  async onStart() {
    // Restore persistent state if available
    if (this.room.id === "__lobby__") {
      const stored = await this.room.storage.get<Record<string, OpenRoomSummary>>("directory");
      if (stored) {
        this.directory = new Map(Object.entries(stored));
      }
      return;
    }

    const stored = await this.room.storage.get<PartyRoomData>("room_data");
    if (stored) {
      this.state = stored;
    }
  }

  // -------------------------------------------------------------
  // WebSocket Handlers
  // -------------------------------------------------------------
  onConnect(conn: Party.Connection) {
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

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const parsed = JSON.parse(message);

      if (parsed.type === "INIT_ROOM") {
        const { hostPlayer } = this.initializeRoom(parsed.payload);
        sender.send(
          JSON.stringify({
            type: "INIT_SUCCESS",
            code: this.room.id,
            hostPlayer,
            room: this.getClientState(),
          }),
        );
        await this.persist();
        this.broadcastRoom();
        await this.notifyDirectory();
        return;
      }

      if (parsed.type === "JOIN_ROOM") {
        const player = this.joinPlayer(parsed.payload);
        if (player) {
          sender.send(
            JSON.stringify({
              type: "JOIN_SUCCESS",
              code: this.room.id,
              player,
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
        const { playerId, action } = parsed;
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
    } catch (err: any) {
      sender.send(JSON.stringify({ type: "ERROR", message: err?.message || "Unknown error" }));
    }
  }

  // -------------------------------------------------------------
  // HTTP REST API Handlers (Supports Vercel & CORS)
  // -------------------------------------------------------------
  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    // If lobby directory
    if (this.room.id === "__lobby__") {
      if (req.method === "GET") {
        const rooms = Array.from(this.directory.values()).filter((r) => r.status === "lobby");
        return Response.json({ ok: true, rooms }, { headers: CORS_HEADERS });
      }

      if (req.method === "POST") {
        const summary: OpenRoomSummary = await req.json();
        if (summary.status === "podium") {
          this.directory.delete(summary.code);
        } else {
          this.directory.set(summary.code, summary);
        }
        await this.room.storage.put("directory", Object.fromEntries(this.directory));
        return Response.json({ ok: true }, { headers: CORS_HEADERS });
      }
    }

    // Normal Room HTTP Handlers
    if (req.method === "GET") {
      if (!this.state) {
        return Response.json(
          { ok: false, error: { message: `Room "${this.room.id}" not found.` } },
          { status: 404, headers: CORS_HEADERS },
        );
      }
      return Response.json(
        { ok: true, room: this.getClientState() },
        { headers: CORS_HEADERS },
      );
    }

    if (req.method === "POST") {
      const pathname = url.pathname;

      if (pathname.endsWith("/init") || pathname.endsWith("/create")) {
        const body = (await req.json()) as any;
        const { hostPlayer } = this.initializeRoom(body);
        await this.persist();
        this.broadcastRoom();
        await this.notifyDirectory();
        return Response.json(
          {
            ok: true,
            code: this.room.id,
            hostPlayer,
            player: hostPlayer,
            room: this.getClientState(),
          },
          { status: 201, headers: CORS_HEADERS },
        );
      }

      if (pathname.endsWith("/join")) {
        const body = (await req.json()) as any;
        const player = this.joinPlayer(body);
        if (!player) {
          return Response.json(
            { ok: false, error: { message: "Cannot join room." } },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        await this.persist();
        this.broadcastRoom();
        await this.notifyDirectory();
        return Response.json(
          { ok: true, player, room: this.getClientState() },
          { headers: CORS_HEADERS },
        );
      }

      if (pathname.endsWith("/action")) {
        const body = (await req.json()) as any;
        const ok = this.handleAction(body.playerId, body.action);
        if (!ok) {
          return Response.json(
            { ok: false, error: { message: "Action rejected." } },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        await this.persist();
        this.broadcastRoom();
        return Response.json(
          { ok: true, room: this.getClientState() },
          { headers: CORS_HEADERS },
        );
      }
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
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
  }): { hostPlayer: ArenaPlayer } {
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

    const pack = params.pack || mockMicroeconomics;

    this.state = {
      code: this.room.id,
      title: params.title?.trim() || `${pack.title} Arena`,
      hostId: hostPlayer.id,
      status: "lobby",
      mode: params.mode || "exact",
      pack,
      currentQuestionIndex: -1,
      totalQuestions: pack.questions.length,
      roundDeadline: 0,
      feedbackDeadline: 0,
      countdownEndsAt: 0,
      players: {
        [hostPlayer.id]: hostPlayer,
      },
      createdAt: new Date().toISOString(),
      podium: null,
    };

    return { hostPlayer };
  }

  private joinPlayer(params: { nickname: string; avatar?: string }): ArenaPlayer | null {
    if (!this.state || this.state.status !== "lobby") return null;

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

    this.state.players[player.id] = player;
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

  private getClientState(): ArenaRoomState {
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
      players: this.state.players,
      currentQuestion,
      revealedFeedback,
      createdAt: this.state.createdAt,
      mode: this.state.mode,
      packId: this.state.pack.id,
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
      await this.room.storage.put("room_data", this.state);
    }
  }

  private async notifyDirectory() {
    if (!this.state || this.room.id === "__lobby__") return;
    try {
      const lobby = this.room.context.parties.arena.get("__lobby__");
      await lobby.fetch({
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
