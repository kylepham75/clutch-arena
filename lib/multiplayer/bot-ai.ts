export type BotProfile = {
  id: string;
  nickname: string;
  avatar: string;
  type: "speed" | "steady" | "wildcard";
  minDelayMs: number;
  maxDelayMs: number;
  accuracy: number;
};

export const BOT_ARCHETYPES: BotProfile[] = [
  {
    id: "bot_alex",
    nickname: "Alex (Speed)",
    avatar: "⚡",
    type: "speed",
    minDelayMs: 3_500,
    maxDelayMs: 6_500,
    accuracy: 0.8,
  },
  {
    id: "bot_maya",
    nickname: "Maya (Steady)",
    avatar: "🦉",
    type: "steady",
    minDelayMs: 7_000,
    maxDelayMs: 11_500,
    accuracy: 0.9,
  },
  {
    id: "bot_sam",
    nickname: "Sam (Wildcard)",
    avatar: "🔥",
    type: "wildcard",
    minDelayMs: 4_000,
    maxDelayMs: 10_000,
    accuracy: 0.72,
  },
];

export function generateBotDecision(
  bot: BotProfile,
  correctIndex: number,
): { delayMs: number; selectedIndex: number } {
  const delayMs =
    bot.minDelayMs + Math.random() * (bot.maxDelayMs - bot.minDelayMs);
  const isCorrect = Math.random() < bot.accuracy;

  let selectedIndex = correctIndex;
  if (!isCorrect) {
    const wrongOptions = [0, 1, 2, 3].filter((i) => i !== correctIndex);
    selectedIndex =
      wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
  }

  return {
    delayMs: Math.round(delayMs),
    selectedIndex,
  };
}
