import { z } from "zod";
import { studyPackSchema, type StudyPack } from "./question";

export const AVATAR_OPTIONS = [
  "⚡",
  "🧠",
  "🔥",
  "🚀",
  "🎯",
  "🦉",
  "👑",
  "⭐",
  "💎",
  "🦁",
] as const;

export type AvatarEmoji = (typeof AVATAR_OPTIONS)[number];

export const playerSchema = z.object({
  id: z.string().min(1),
  nickname: z.string().trim().min(1).max(24),
  avatar: z.string().min(1).max(10),
  score: z.number().int().min(0),
  streak: z.number().int().min(0),
  bestStreak: z.number().int().min(0),
  lives: z.number().int().min(0).max(3),
  isReady: z.boolean(),
  isHost: z.boolean(),
  isBot: z.boolean(),
  status: z.enum(["waiting", "answering", "submitted", "eliminated"]),
  lastAnswer: z
    .object({
      selected: z.number().int().min(0).max(3).nullable(),
      correct: z.boolean().nullable(),
      points: z.number().int().min(0),
      answeredAtMs: z.number(),
    })
    .nullable(),
});

export type ArenaPlayer = z.infer<typeof playerSchema>;

export type RoomStatus =
  | "lobby"
  | "countdown"
  | "answering"
  | "feedback"
  | "podium";

export type MultiplayerQuestion = {
  id: string;
  question: string;
  options: [string, string, string, string];
  number: number;
  total: number;
  citation?: string;
  topic?: string;
};

export type RevealedFeedback = {
  correctIndex: number;
  explanation: string;
  rule?: string;
  citation?: string;
};

export type ArenaQuestionStat = {
  questionId: string;
  questionNumber: number;
  questionText: string;
  topic?: string;
  citation?: string;
  correctIndex: number;
  totalAttempts: number;
  correctCount: number;
  missedCount: number;
  missedPercent: number;
  optionCounts: [number, number, number, number];
  mostCommonWrongOption: number | null;
};

export type ArenaClassAnalytics = {
  totalPlayers: number;
  totalQuestions: number;
  averageAccuracyPercent: number;
  earlyEliminatedCount: number;
  earlyEliminatedNicknames: string[];
  questionStats: ArenaQuestionStat[];
};

export type ArenaRoomState = {
  code: string;
  title: string;
  hostId: string;
  status: RoomStatus;
  currentQuestionIndex: number;
  totalQuestions: number;
  roundDeadline: number;
  feedbackDeadline: number;
  countdownEndsAt: number;
  players: Record<string, ArenaPlayer>;
  currentQuestion: MultiplayerQuestion | null;
  revealedFeedback: RevealedFeedback | null;
  createdAt: string;
  maxPlayers?: number;
  mode: "exact" | "variants";
  packId: string;
  hostTier?: "contender" | "cram_pass" | "pro" | "tutor";
  classAnalytics?: ArenaClassAnalytics | null;
  podium: {
    first: ArenaPlayer | null;
    second: ArenaPlayer | null;
    third: ArenaPlayer | null;
    rankings: ArenaPlayer[];
  } | null;
};

export const createRoomSchema = z
  .object({
    hostNickname: z.string().trim().min(1).max(24).optional(),
    nickname: z.string().trim().min(1).max(24).optional(),
    hostAvatar: z.string().default("⚡"),
    avatar: z.string().optional(),
    title: z.string().trim().max(100).optional(),
    mode: z.enum(["exact", "variants"]).default("exact"),
    pack: studyPackSchema.optional(),
    maxPlayers: z.number().int().min(2).max(100).optional(),
    hostTier: z.enum(["contender", "cram_pass", "pro", "tutor"]).optional(),
  })
  .refine((data) => !!(data.hostNickname || data.nickname), {
    message: "Nickname is required.",
  })
  .transform((data) => ({
    hostNickname: data.hostNickname || data.nickname || "Host",
    hostAvatar: data.avatar || data.hostAvatar || "⚡",
    title: data.title,
    mode: data.mode,
    pack: data.pack,
    maxPlayers: data.maxPlayers,
    hostTier: data.hostTier,
  }));

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const joinRoomSchema = z.object({
  nickname: z.string().trim().min(1).max(24),
  avatar: z.string().default("🧠"),
});

export type JoinRoomInput = z.infer<typeof joinRoomSchema>;

export const roomActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START_MATCH") }),
  z.object({
    type: z.literal("SUBMIT_ANSWER"),
    selected: z.number().int().min(0).max(3),
  }),
  z.object({ type: z.literal("TOGGLE_READY") }),
  z.object({
    type: z.literal("ADD_BOT"),
    botType: z.enum(["speed", "steady", "wildcard"]).optional(),
  }),
  z.object({
    type: z.literal("REMOVE_BOT"),
    botId: z.string().min(1),
  }),
  z.object({
    type: z.literal("KICK_PLAYER"),
    playerId: z.string().min(1),
  }),
  z.object({ type: z.literal("NEXT_QUESTION") }),
  z.object({ type: z.literal("REMATCH") }),
]);

export type RoomAction = z.infer<typeof roomActionSchema>;
