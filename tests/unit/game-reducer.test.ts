import { describe, expect, it } from "vitest";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import {
  activeQuestion,
  createGame,
  gameReducer,
  type GameState,
} from "@/lib/game/reducer";
import {
  QUESTION_DURATION_MS,
  WRONG_ANSWER_PAUSE_MS,
} from "@/lib/game/constants";

function start(count = 5) {
  return gameReducer(createGame(mockMicroeconomics.questions.slice(0, count)), {
    type: "START",
    mode: "exact",
    now: 1_000,
  });
}
function submit(
  state: GameState,
  correct = true,
  now = state.deadline - 1_000,
) {
  const q = activeQuestion(state)!;
  return gameReducer(state, {
    type: "ANSWER",
    choice: correct ? q.correctIndex : (q.correctIndex + 1) % 4,
    now,
    index: state.index,
  });
}
function next(state: GameState) {
  return gameReducer(state, { type: "NEXT", now: state.unlockAt });
}

describe("solo game transitions", () => {
  it("starts with three lives and a 15-second deadline", () => {
    const state = start();
    expect(state.lives).toBe(3);
    expect(state.deadline).toBe(1_000 + QUESTION_DURATION_MS);
    expect(state.queue).toHaveLength(5);
  });
  it("accepts only one answer per question, including rapid duplicate events", () => {
    const answered = submit(start());
    expect(submit(answered)).toBe(answered);
    expect(answered.score).toBe(100);
    expect(answered.attempts).toHaveLength(1);
  });
  it("ignores stale question callbacks and invalid answer indexes", () => {
    const state = next(submit(start()));
    expect(
      gameReducer(state, {
        type: "ANSWER",
        choice: 0,
        now: state.deadline - 1,
        index: 0,
      }),
    ).toBe(state);
    expect(
      gameReducer(state, {
        type: "ANSWER",
        choice: 7,
        now: state.deadline - 1,
        index: state.index,
      }),
    ).toBe(state);
  });
  it("treats a correct answer at the deadline as a timeout", () => {
    const state = start();
    const result = submit(state, true, state.deadline);
    expect(result.lives).toBe(2);
    expect(result.score).toBe(0);
    expect(result.attempts[0].selected).toBe(null);
  });
  it("ignores timeout events that arrive before the deadline", () => {
    const state = start();
    expect(
      gameReducer(state, {
        type: "ANSWER",
        choice: null,
        now: state.deadline - 1,
        index: 0,
      }),
    ).toBe(state);
  });
  it("blocks advancing during the four-second wrong-answer explanation", () => {
    const state = submit(start(), false);
    expect(gameReducer(state, { type: "NEXT", now: state.unlockAt - 1 })).toBe(
      state,
    );
    expect(state.unlockAt).toBe(state.deadline - 1_000 + WRONG_ANSWER_PAUSE_MS);
    expect(next(state).phase).toBe("answering");
  });
  it("pauses and resumes with exactly the remaining duration", () => {
    const state = start();
    const paused = gameReducer(state, { type: "PAUSE", now: 6_000 });
    expect(paused.pausedRemaining).toBe(10_000);
    const resumed = gameReducer(paused, { type: "RESUME", now: 100_000 });
    expect(resumed.deadline).toBe(110_000);
    expect(resumed.phase).toBe("answering");
  });
  it("does not let a pause rescue an expired question", () => {
    const state = start();
    const late = gameReducer(state, { type: "PAUSE", now: state.deadline });
    expect(late.phase).toBe("feedback");
    expect(late.lives).toBe(2);
  });
  it("awards 100, 100, 150, 150, 200 XP for a perfect five-question run", () => {
    let state = start();
    for (let i = 0; i < 5; i++) state = next(submit(state));
    expect(state.phase).toBe("finished");
    expect(state.score).toBe(700);
    expect(state.bestStreak).toBe(5);
    expect(state.attempts).toHaveLength(5);
  });
  it("ends after three misses and does not play queued retries", () => {
    let state = start();
    for (let i = 0; i < 3; i++) state = next(submit(state, false));
    expect(state.phase).toBe("finished");
    expect(state.lives).toBe(0);
    expect(state.attempts).toHaveLength(3);
  });
  it("queues a concept variant and requires two consecutive correct review answers", () => {
    let state = start(1);
    state = next(submit(state, false));
    expect(activeQuestion(state)?.entry.variant).toBe(true);
    expect(state.queue).toHaveLength(2);
    state = next(submit(state));
    expect(state.mastery.elasticity).toBe(1);
    expect(state.phase).toBe("answering");
    expect(activeQuestion(state)?.entry.variant).toBe(false);
    state = next(submit(state));
    expect(state.mastery.elasticity).toBe(2);
    expect(state.phase).toBe("finished");
    expect(state.attempts).toHaveLength(3);
  });
  it("resets mastery after a missed review and only completes after two new successes", () => {
    let state = next(submit(start(1), false));
    state = next(submit(state));
    state = next(submit(state, false));
    expect(state.mastery.elasticity).toBe(0);
    expect(state.streak).toBe(0);
    state = next(submit(state));
    expect(state.phase).toBe("answering");
    state = next(submit(state));
    expect(state.phase).toBe("finished");
    expect(state.mastery.elasticity).toBe(2);
  });
  it("starts with the variant when selected and fully resets the run", () => {
    let state = gameReducer(createGame(mockMicroeconomics.questions), {
      type: "START",
      mode: "variants",
      now: 0,
    });
    expect(activeQuestion(state)?.question).toBe(
      mockMicroeconomics.questions[0].conceptVariant.question,
    );
    state = gameReducer(submit(state), { type: "RESET" });
    expect(state.phase).toBe("ready");
    expect(state.score).toBe(0);
    expect(state.attempts).toEqual([]);
  });
  it("does not start an empty question bank", () => {
    const state = createGame([]);
    expect(gameReducer(state, { type: "START", now: 0, mode: "exact" })).toBe(
      state,
    );
  });
});
