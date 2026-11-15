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

describe("untimed cram mode", () => {
  it("defaults to untimed: false with 15s deadline and 4s lock on wrong answers", () => {
    const state = start();
    expect(state.untimed).toBe(false);
    expect(state.deadline).toBe(1_000 + QUESTION_DURATION_MS);
    const wrong = submit(state, false, 2_000);
    expect(wrong.unlockAt).toBe(2_000 + WRONG_ANSWER_PAUSE_MS);
    expect(gameReducer(wrong, { type: "NEXT", now: 2_000 })).toBe(wrong);
  });

  it("START with untimed: true accepts answers past deadline, ignores choice: null, and sets 0ms lock on wrong answers", () => {
    let state = gameReducer(createGame(mockMicroeconomics.questions.slice(0, 3)), {
      type: "START",
      mode: "exact",
      now: 1_000,
      untimed: true,
    });
    expect(state.untimed).toBe(true);

    // Ignores choice: null timeout action even well past deadline
    const ignoredTimeout = gameReducer(state, {
      type: "ANSWER",
      choice: null,
      now: 100_000,
      index: state.index,
    });
    expect(ignoredTimeout).toBe(state);

    // Accepts correct answer well past deadline without timing out
    const q0 = activeQuestion(state)!;
    const answered = gameReducer(state, {
      type: "ANSWER",
      choice: q0.correctIndex,
      now: 100_000,
      index: state.index,
    });
    expect(answered.phase).toBe("feedback");
    expect(answered.lives).toBe(3);
    expect(answered.score).toBe(100);
    expect(answered.attempts[0].correct).toBe(true);
    expect(answered.attempts[0].selected).toBe(q0.correctIndex);

    // Advance to next question
    state = gameReducer(answered, { type: "NEXT", now: 100_000 });
    expect(state.phase).toBe("answering");
    expect(state.index).toBe(1);
    expect(state.untimed).toBe(true);

    // Wrong answer has instant unlock (0ms lock), unlockAt === action.now
    const q1 = activeQuestion(state)!;
    const wrongChoice = (q1.correctIndex + 1) % 4;
    const wrong = gameReducer(state, {
      type: "ANSWER",
      choice: wrongChoice,
      now: 200_000,
      index: state.index,
    });
    expect(wrong.unlockAt).toBe(200_000);
    expect(wrong.lives).toBe(2);

    // Immediate NEXT at action.now succeeds without pause
    const nextState = gameReducer(wrong, { type: "NEXT", now: 200_000 });
    expect(nextState.phase).toBe("answering");
    expect(nextState.index).toBe(2);
    expect(nextState.untimed).toBe(true);
  });

  it("TOGGLE_UNTIMED toggles untimed flag, refreshes deadline when switching to timed mid-question, and unlocks feedback immediately", () => {
    // 1. Toggles state.untimed
    let state = start();
    expect(state.untimed).toBe(false);

    state = gameReducer(state, { type: "TOGGLE_UNTIMED" });
    expect(state.untimed).toBe(true);

    state = gameReducer(state, { type: "TOGGLE_UNTIMED" });
    expect(state.untimed).toBe(false);

    // Explicit untimed argument
    state = gameReducer(state, { type: "TOGGLE_UNTIMED", untimed: true });
    expect(state.untimed).toBe(true);

    // 2. Refresh deadline when switching back to timed mid-question
    const timedMidQuestion = gameReducer(state, {
      type: "TOGGLE_UNTIMED",
      untimed: false,
      now: 50_000,
    });
    expect(timedMidQuestion.untimed).toBe(false);
    expect(timedMidQuestion.deadline).toBe(50_000 + QUESTION_DURATION_MS);

    // 3. Immediately unlocks a locked wrong-answer feedback state when untimed is enabled
    const wrongLocked = submit(start(), false, 2_000);
    expect(wrongLocked.phase).toBe("feedback");
    expect(wrongLocked.unlockAt).toBe(2_000 + WRONG_ANSWER_PAUSE_MS);

    // Before unlockAt, NEXT is blocked
    expect(gameReducer(wrongLocked, { type: "NEXT", now: 3_000 })).toBe(wrongLocked);

    // Toggle untimed while in feedback at now: 3_000
    const unlocked = gameReducer(wrongLocked, {
      type: "TOGGLE_UNTIMED",
      untimed: true,
      now: 3_000,
    });
    expect(unlocked.untimed).toBe(true);
    expect(unlocked.unlockAt).toBe(3_000);

    // Can immediately advance at now: 3_000
    const advanced = gameReducer(unlocked, { type: "NEXT", now: 3_000 });
    expect(advanced.phase).toBe("answering");
    expect(advanced.index).toBe(1);
  });

  it("preserves untimed setting across RESET and handles PAUSE in untimed mode", () => {
    let state = gameReducer(createGame(mockMicroeconomics.questions.slice(0, 2)), {
      type: "START",
      mode: "exact",
      now: 1_000,
      untimed: true,
    });
    expect(state.untimed).toBe(true);

    // Pause well past original deadline does not expire
    const paused = gameReducer(state, { type: "PAUSE", now: 50_000 });
    expect(paused.phase).toBe("paused");
    expect(paused.pausedRemaining).toBe(QUESTION_DURATION_MS);

    const resumed = gameReducer(paused, { type: "RESUME", now: 60_000 });
    expect(resumed.phase).toBe("answering");
    expect(resumed.deadline).toBe(60_000 + QUESTION_DURATION_MS);

    // Reset preserves untimed
    const reset = gameReducer(resumed, { type: "RESET" });
    expect(reset.phase).toBe("ready");
    expect(reset.untimed).toBe(true);
  });
});

describe("UPDATE_QUESTION in-place repair and retroactive correction", () => {
  it("replaces question in state.questions when ID matches, or returns state unmodified if ID not found", () => {
    const state = start(3);
    const originalQ = state.questions[0];
    const updatedQ = {
      ...originalQ,
      question: "Repaired question text?",
    };

    const nextState = gameReducer(state, {
      type: "UPDATE_QUESTION",
      question: updatedQ,
    });
    expect(nextState.questions[0].question).toBe("Repaired question text?");
    expect(nextState.questions[1]).toEqual(state.questions[1]);

    const unknownQ = {
      ...originalQ,
      id: "non-existent-id",
    };
    const untouchedState = gameReducer(nextState, {
      type: "UPDATE_QUESTION",
      question: unknownQ,
    });
    expect(untouchedState).toBe(nextState);
  });

  it("retroactively upgrades wrong attempt to correct when student's choice matches repaired correctIndex", () => {
    const initialState = start(3);
    const activeQ = activeQuestion(initialState)!;
    // Suppose activeQ.correctIndex was initially 0, but user selected 1 (wrong)
    const wrongChoice = (activeQ.correctIndex + 1) % 4;

    const answeredState = gameReducer(initialState, {
      type: "ANSWER",
      choice: wrongChoice,
      now: 2_000,
      index: initialState.index,
    });

    expect(answeredState.phase).toBe("feedback");
    expect(answeredState.lives).toBe(2);
    expect(answeredState.score).toBe(0);
    expect(answeredState.streak).toBe(0);
    expect(answeredState.attempts[0].correct).toBe(false);
    expect(answeredState.attempts[0].selected).toBe(wrongChoice);
    expect(answeredState.missed).toContain(activeQ.id);
    expect(answeredState.unlockAt).toBe(2_000 + WRONG_ANSWER_PAUSE_MS);

    // Verify queued retry was added
    const retryInQueue = answeredState.queue.slice(answeredState.index + 1).find(
      (entry) => entry.id === activeQ.id && entry.review,
    );
    expect(retryInQueue).toBeDefined();

    // Repair the question so that correctIndex becomes wrongChoice
    const repairedQ = {
      ...activeQ,
      correctIndex: wrongChoice,
      explanation: "Fixed explanation confirming choice was indeed correct.",
    };

    const repairedState = gameReducer(answeredState, {
      type: "UPDATE_QUESTION",
      question: repairedQ,
      now: 2_500,
    });

    // Verify attempt upgraded
    expect(repairedState.attempts[0].correct).toBe(true);
    expect(repairedState.attempts[0].points).toBe(100);
    expect(repairedState.score).toBe(100);
    expect(repairedState.streak).toBe(1);
    expect(repairedState.bestStreak).toBe(1);
    expect(repairedState.lives).toBe(3); // Restored 1 life (2 -> 3)
    expect(repairedState.missed).not.toContain(activeQ.id);
    expect(repairedState.unlockAt).toBe(2_500); // Unlocked immediately

    // Queued retry must be removed
    const retryRemaining = repairedState.queue.slice(repairedState.index + 1).find(
      (entry) => entry.id === activeQ.id && entry.review,
    );
    expect(retryRemaining).toBeUndefined();

    // Advancing NEXT now succeeds immediately at now: 2_500
    const advanced = gameReducer(repairedState, { type: "NEXT", now: 2_500 });
    expect(advanced.phase).toBe("answering");
    expect(advanced.index).toBe(1);
  });

  it("handles concept variant retroactively when attempt.variant is true", () => {
    let state = gameReducer(createGame(mockMicroeconomics.questions.slice(0, 2)), {
      type: "START",
      mode: "variants",
      now: 1_000,
    });
    const activeQ = activeQuestion(state)!;
    expect(activeQ.entry.variant).toBe(true);

    const wrongChoice = (activeQ.correctIndex + 1) % 4;
    state = gameReducer(state, {
      type: "ANSWER",
      choice: wrongChoice,
      now: 2_000,
      index: state.index,
    });

    expect(state.phase).toBe("feedback");
    expect(state.attempts[0].variant).toBe(true);
    expect(state.attempts[0].correct).toBe(false);

    // Repair conceptVariant correctIndex
    const repairedQ = {
      ...mockMicroeconomics.questions[0],
      conceptVariant: {
        ...mockMicroeconomics.questions[0].conceptVariant,
        correctIndex: wrongChoice,
      },
    };

    const repairedState = gameReducer(state, {
      type: "UPDATE_QUESTION",
      question: repairedQ,
      now: 2_100,
    });

    expect(repairedState.attempts[0].correct).toBe(true);
    expect(repairedState.lives).toBe(3);
    expect(repairedState.score).toBe(100);
  });

  it("retains question in missed list if there was an earlier wrong attempt for that same question", () => {
    // Start game, answer Q0 wrong, advance, review Q0 comes up, answer Q0 wrong again
    let state = start(1);
    const q0 = activeQuestion(state)!;
    const wrongChoice = (q0.correctIndex + 1) % 4;

    // 1st attempt wrong
    state = gameReducer(state, {
      type: "ANSWER",
      choice: wrongChoice,
      now: 2_000,
      index: state.index,
    });
    state = next(state);

    // 2nd attempt (review) wrong
    const q2 = activeQuestion(state)!;
    const wrongChoice2 = (q2.correctIndex + 1) % 4;
    state = gameReducer(state, {
      type: "ANSWER",
      choice: wrongChoice2,
      now: 8_000,
      index: state.index,
    });
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts[0].correct).toBe(false);
    expect(state.attempts[1].correct).toBe(false);
    expect(state.missed).toContain(q0.id);

    // Repair 2nd attempt so that its conceptVariant correctIndex matches wrongChoice2
    const repairedQ = {
      ...q0,
      conceptVariant: {
        ...q0.conceptVariant,
        correctIndex: wrongChoice2,
      },
    };

    const repairedState = gameReducer(state, {
      type: "UPDATE_QUESTION",
      question: repairedQ,
      now: 8_500,
    });

    // 2nd attempt is upgraded, but missed still retains q0.id because 1st attempt was wrong
    expect(repairedState.attempts[1].correct).toBe(true);
    expect(repairedState.missed).toContain(q0.id);
  });

  it("does not upgrade attempt if choice was null or still does not match repaired correctIndex", () => {
    const initialState = start(2);
    const activeQ = activeQuestion(initialState)!;
    // Timeout (choice: null)
    const timeoutState = gameReducer(initialState, {
      type: "ANSWER",
      choice: null,
      now: initialState.deadline,
      index: initialState.index,
    });

    const repairedQ = {
      ...activeQ,
      correctIndex: 2,
    };

    const nextState = gameReducer(timeoutState, {
      type: "UPDATE_QUESTION",
      question: repairedQ,
    });

    expect(nextState.attempts[0].correct).toBe(false);
    expect(nextState.lives).toBe(2);
    expect(nextState.score).toBe(0);
  });
});
