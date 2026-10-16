import type { QuestionItem } from "../schemas/question";
import {
  QUESTION_DURATION_MS,
  STARTING_LIVES,
  WRONG_ANSWER_PAUSE_MS,
} from "./constants";
import { pointsForStreak } from "./scoring";

export type QueueEntry = { id: string; variant: boolean; review: boolean };
export type Attempt = {
  id: string;
  variant: boolean;
  selected: number | null;
  correct: boolean;
  points: number;
};
export type GameState = {
  phase: "ready" | "answering" | "feedback" | "paused" | "finished";
  questions: QuestionItem[];
  queue: QueueEntry[];
  index: number;
  lives: number;
  score: number;
  streak: number;
  bestStreak: number;
  deadline: number;
  unlockAt: number;
  pausedRemaining: number;
  attempts: Attempt[];
  missed: string[];
  mastery: Record<string, number>;
  mode: "exact" | "variants";
};
export type GameAction =
  | { type: "START"; now: number; mode: "exact" | "variants" }
  | { type: "ANSWER"; choice: number | null; now: number; index: number }
  | { type: "NEXT"; now: number }
  | { type: "PAUSE"; now: number }
  | { type: "RESUME"; now: number }
  | { type: "RESET" }
  | { type: "LOAD_PACK"; questions: QuestionItem[] };

export function createGame(questions: QuestionItem[]): GameState {
  return {
    phase: "ready",
    questions,
    queue: [],
    index: 0,
    lives: STARTING_LIVES,
    score: 0,
    streak: 0,
    bestStreak: 0,
    deadline: 0,
    unlockAt: 0,
    pausedRemaining: 0,
    attempts: [],
    missed: [],
    mastery: {},
    mode: "exact",
  };
}

export function activeQuestion(state: GameState) {
  const entry = state.queue[state.index];
  const original = state.questions.find((q) => q.id === entry?.id);
  if (!original) return null;
  return {
    ...original,
    ...(entry.variant ? original.conceptVariant : {}),
    entry,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START": {
      if (state.phase !== "ready" || !state.questions.length) return state;
      return {
        ...createGame(state.questions),
        mode: action.mode,
        phase: "answering",
        queue: state.questions.map((q) => ({
          id: q.id,
          variant: action.mode === "variants",
          review: false,
        })),
        deadline: action.now + QUESTION_DURATION_MS,
      };
    }
    case "ANSWER": {
      if (state.phase !== "answering" || action.index !== state.index)
        return state;
      if (
        action.choice !== null &&
        (!Number.isInteger(action.choice) ||
          action.choice < 0 ||
          action.choice > 3)
      )
        return state;
      const current = activeQuestion(state);
      if (!current) return state;
      // A late input is a timeout, even if the browser throttled its timer.
      const selected = action.now >= state.deadline ? null : action.choice;
      if (selected === null && action.now < state.deadline) return state;
      const correct = selected === current.correctIndex;
      const streak = correct ? state.streak + 1 : 0;
      const points = correct ? pointsForStreak(streak) : 0;
      const mastery = { ...state.mastery };
      const missed =
        correct || state.missed.includes(current.id)
          ? state.missed
          : [...state.missed, current.id];
      let queue = state.queue;
      if (!correct || current.entry.review) {
        mastery[current.id] = correct ? (mastery[current.id] || 0) + 1 : 0;
        if (mastery[current.id] < 2) {
          // Alternate exact and variant forms, with remaining questions as spacing.
          queue = [
            ...queue,
            { id: current.id, variant: !current.entry.variant, review: true },
          ];
        }
      }
      return {
        ...state,
        phase: "feedback",
        queue,
        mastery,
        missed,
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        score: state.score + points,
        lives: correct ? state.lives : state.lives - 1,
        pausedRemaining: Math.max(0, state.deadline - action.now),
        unlockAt: action.now + (correct ? 0 : WRONG_ANSWER_PAUSE_MS),
        attempts: [
          ...state.attempts,
          {
            id: current.id,
            variant: current.entry.variant,
            selected,
            correct,
            points,
          },
        ],
      };
    }
    case "NEXT": {
      if (state.phase !== "feedback" || action.now < state.unlockAt)
        return state;
      if (state.lives === 0 || state.index + 1 >= state.queue.length)
        return { ...state, phase: "finished" };
      return {
        ...state,
        phase: "answering",
        index: state.index + 1,
        deadline: action.now + QUESTION_DURATION_MS,
      };
    }
    case "PAUSE": {
      if (state.phase !== "answering") return state;
      if (action.now >= state.deadline)
        return gameReducer(state, {
          type: "ANSWER",
          choice: null,
          now: action.now,
          index: state.index,
        });
      return {
        ...state,
        phase: "paused",
        pausedRemaining: state.deadline - action.now,
      };
    }
    case "RESUME":
      return state.phase === "paused"
        ? {
            ...state,
            phase: "answering",
            deadline: action.now + state.pausedRemaining,
          }
        : state;
    case "RESET":
      return createGame(state.questions);
    case "LOAD_PACK":
      return createGame(action.questions);
    default:
      return state;
  }
}
