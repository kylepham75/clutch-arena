import { mockMicroeconomics } from "@/data/mock-microeconomics";
import { pointsForStreak } from "@/lib/game/scoring";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  BOT_ARCHETYPES,
  generateBotDecision,
  type BotProfile,
} from "./bot-ai";
import type {
  ArenaPlayer,
  ArenaRoomState,
  MultiplayerQuestion,
  RevealedFeedback,
  RoomStatus,
} from "@/lib/schemas/multiplayer";
import type { QuestionItem, StudyPack } from "@/lib/schemas/question";

export type ServerRoom = {
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
  botTimeouts: NodeJS.Timeout[];
  roundTimeout: NodeJS.Timeout | null;
  feedbackTimeout: NodeJS.Timeout | null;
  countdownTimeout: NodeJS.Timeout | null;
  subscribers: Set<(state: ArenaRoomState) => void>;
  createdAt: string;
  podium: ArenaRoomState["podium"];
};

declare global {
  // eslint-disable-next-line no-var
  var __arenaRooms: Map<string, ServerRoom> | undefined;
}

const rooms = global.__arenaRooms ?? new Map<string, ServerRoom>();
global.__arenaRooms = rooms;

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function getRoom(code: string): ServerRoom | null {
  return rooms.get(code.toUpperCase()) ?? null;
}

export function getAllRooms(): ArenaRoomState[] {
  return Array.from(rooms.values()).map((r) => getClientState(r));
}

function broadcastRoom(room: ServerRoom) {
  const state = getClientState(room);
  room.subscribers.forEach((notify) => {
    try {
      notify(state);
    } catch {
      // ignore client subscriber errors
    }
  });

  const supabase = getSupabaseServerClient();
  if (supabase) {
    void supabase
      .channel(`arena:${room.code}`)
      .send({
        type: "broadcast",
        event: "room_state",
        payload: state,
      })
      .catch(() => {});
  }
}

function getActiveQuestionItem(room: ServerRoom): QuestionItem | null {
  if (room.currentQuestionIndex < 0 || room.currentQuestionIndex >= room.pack.questions.length) {
    return null;
  }
  return room.pack.questions[room.currentQuestionIndex];
}

export function getClientState(
  room: ServerRoom,
  _forPlayerId?: string,
): ArenaRoomState {
  const qItem = getActiveQuestionItem(room);
  let currentQuestion: MultiplayerQuestion | null = null;
  let revealedFeedback: RevealedFeedback | null = null;

  if (qItem && (room.status === "answering" || room.status === "feedback")) {
    const isVariant = room.mode === "variants" && qItem.conceptVariant;
    const textQuestion = isVariant ? qItem.conceptVariant.question : qItem.question;
    const textOptions = isVariant ? qItem.conceptVariant.options : qItem.options;
    const meta = room.pack.metadata[qItem.id];

    currentQuestion = {
      id: qItem.id,
      question: textQuestion,
      options: textOptions,
      number: room.currentQuestionIndex + 1,
      total: room.pack.questions.length,
      citation: meta?.citation,
      topic: meta?.topic,
    };

    if (room.status === "feedback") {
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
    code: room.code,
    title: room.title,
    hostId: room.hostId,
    status: room.status,
    currentQuestionIndex: room.currentQuestionIndex,
    totalQuestions: room.pack.questions.length,
    roundDeadline: room.roundDeadline,
    feedbackDeadline: room.feedbackDeadline,
    countdownEndsAt: room.countdownEndsAt,
    players: room.players,
    currentQuestion,
    revealedFeedback,
    createdAt: room.createdAt,
    mode: room.mode,
    packId: room.pack.id,
    podium: room.podium,
  };
}

export function createRoom(params: {
  hostNickname: string;
  hostAvatar?: string;
  title?: string;
  mode?: "exact" | "variants";
  pack?: StudyPack;
}): { room: ServerRoom; hostPlayer: ArenaPlayer } {
  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  const hostPlayer: ArenaPlayer = {
    id: `player_${crypto.randomUUID().slice(0, 8)}`,
    nickname: params.hostNickname.trim(),
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
  const room: ServerRoom = {
    code,
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
    botTimeouts: [],
    roundTimeout: null,
    feedbackTimeout: null,
    countdownTimeout: null,
    subscribers: new Set(),
    createdAt: new Date().toISOString(),
    podium: null,
  };

  rooms.set(code, room);
  return { room, hostPlayer };
}

export function joinRoom(
  code: string,
  params: { nickname: string; avatar?: string },
): ArenaPlayer | null {
  const room = getRoom(code);
  if (!room) return null;
  if (room.status !== "lobby") return null;

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

  room.players[player.id] = player;
  broadcastRoom(room);
  return player;
}

export function addBotToRoom(code: string, botType?: BotProfile["type"]): ArenaPlayer | null {
  const room = getRoom(code);
  if (!room || room.status !== "lobby") return null;

  const existingBotNames = new Set(
    Object.values(room.players)
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

  room.players[botPlayer.id] = botPlayer;
  broadcastRoom(room);
  return botPlayer;
}

export function removeBotFromRoom(code: string, botId: string): boolean {
  const room = getRoom(code);
  if (!room || room.status !== "lobby") return false;
  if (room.players[botId]?.isBot) {
    delete room.players[botId];
    broadcastRoom(room);
    return true;
  }
  return false;
}

export function togglePlayerReady(code: string, playerId: string): boolean {
  const room = getRoom(code);
  if (!room || room.status !== "lobby") return false;
  const player = room.players[playerId];
  if (!player) return false;

  player.isReady = !player.isReady;
  broadcastRoom(room);
  return true;
}

export function startMatch(code: string, hostId: string): boolean {
  const room = getRoom(code);
  if (!room || room.status !== "lobby") return false;
  if (room.hostId !== hostId) return false;

  room.status = "countdown";
  room.countdownEndsAt = Date.now() + 3_000;
  broadcastRoom(room);

  if (room.countdownTimeout) clearTimeout(room.countdownTimeout);
  room.countdownTimeout = setTimeout(() => {
    startRound(room, 0);
  }, 3_000);

  return true;
}

export function startRound(room: ServerRoom, questionIndex: number) {
  clearTimers(room);

  room.status = "answering";
  room.currentQuestionIndex = questionIndex;
  room.roundDeadline = Date.now() + 15_000;

  const qItem = getActiveQuestionItem(room);
  if (!qItem) {
    endMatch(room);
    return;
  }

  const isVariant = room.mode === "variants" && qItem.conceptVariant;
  const correctIdx = isVariant
    ? qItem.conceptVariant.correctIndex
    : qItem.correctIndex;

  Object.values(room.players).forEach((p) => {
    if (p.lives > 0) {
      p.status = "answering";
      p.lastAnswer = null;
    } else {
      p.status = "eliminated";
    }
  });

  // Schedule bot answers
  Object.values(room.players)
    .filter((p) => p.isBot && p.lives > 0)
    .forEach((botPlayer) => {
      const template =
        BOT_ARCHETYPES.find((b) => b.avatar === botPlayer.avatar) ||
        BOT_ARCHETYPES[0];
      const decision = generateBotDecision(template, correctIdx);

      const timeout = setTimeout(() => {
        if (room.status === "answering" && botPlayer.status === "answering") {
          submitAnswer(room.code, botPlayer.id, decision.selectedIndex);
        }
      }, Math.min(decision.delayMs, 14_500));

      room.botTimeouts.push(timeout);
    });

  // Schedule deadline timeout
  room.roundTimeout = setTimeout(() => {
    if (room.status === "answering") {
      handleRoundTimeout(room);
    }
  }, 15_000);

  broadcastRoom(room);
}

export function submitAnswer(
  code: string,
  playerId: string,
  selectedIndex: number,
): boolean {
  const room = getRoom(code);
  if (!room || room.status !== "answering") return false;

  const player = room.players[playerId];
  if (!player || player.lives <= 0 || player.status !== "answering") {
    return false;
  }

  const qItem = getActiveQuestionItem(room);
  if (!qItem) return false;

  const isVariant = room.mode === "variants" && qItem.conceptVariant;
  const correctIdx = isVariant
    ? qItem.conceptVariant.correctIndex
    : qItem.correctIndex;

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

  // Check if all active players have submitted
  const activePlayers = Object.values(room.players).filter((p) => p.lives > 0);
  const allSubmitted = activePlayers.every((p) => p.status === "submitted");

  if (allSubmitted) {
    if (room.roundTimeout) clearTimeout(room.roundTimeout);
    endRound(room);
  } else {
    broadcastRoom(room);
  }

  return true;
}

function handleRoundTimeout(room: ServerRoom) {
  // Mark anyone who hasn't answered as timed out
  Object.values(room.players).forEach((p) => {
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

  endRound(room);
}

export function endRound(room: ServerRoom) {
  clearTimers(room);

  room.status = "feedback";
  room.feedbackDeadline = Date.now() + 4_000;
  broadcastRoom(room);

  room.feedbackTimeout = setTimeout(() => {
    const aliveCount = Object.values(room.players).filter((p) => p.lives > 0).length;
    const nextIndex = room.currentQuestionIndex + 1;

    if (aliveCount === 0 || nextIndex >= room.pack.questions.length) {
      endMatch(room);
    } else {
      startRound(room, nextIndex);
    }
  }, 4_000);
}

export function endMatch(room: ServerRoom) {
  clearTimers(room);
  room.status = "podium";

  const ranked = Object.values(room.players).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.lives !== a.lives) return b.lives - a.lives;
    return b.bestStreak - a.bestStreak;
  });

  room.podium = {
    first: ranked[0] || null,
    second: ranked[1] || null,
    third: ranked[2] || null,
    rankings: ranked,
  };

  broadcastRoom(room);
}

export function rematch(code: string, hostId: string): boolean {
  const room = getRoom(code);
  if (!room) return false;
  if (room.hostId !== hostId) return false;

  clearTimers(room);
  room.status = "lobby";
  room.currentQuestionIndex = -1;
  room.podium = null;
  room.roundDeadline = 0;
  room.feedbackDeadline = 0;
  room.countdownEndsAt = 0;

  Object.values(room.players).forEach((p) => {
    p.score = 0;
    p.streak = 0;
    p.bestStreak = 0;
    p.lives = 3;
    p.status = "waiting";
    p.lastAnswer = null;
    p.isReady = p.isHost || p.isBot;
  });

  broadcastRoom(room);
  return true;
}

function clearTimers(room: ServerRoom) {
  if (room.roundTimeout) clearTimeout(room.roundTimeout);
  if (room.feedbackTimeout) clearTimeout(room.feedbackTimeout);
  if (room.countdownTimeout) clearTimeout(room.countdownTimeout);
  room.botTimeouts.forEach((t) => clearTimeout(t));
  room.botTimeouts = [];
}

export function subscribeToRoom(
  code: string,
  callback: (state: ArenaRoomState) => void,
): () => void {
  const room = getRoom(code);
  if (!room) return () => {};

  room.subscribers.add(callback);
  return () => {
    room.subscribers.delete(callback);
  };
}
