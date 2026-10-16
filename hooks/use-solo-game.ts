"use client";
import { useCallback, useEffect, useReducer } from "react";
import type { QuestionItem } from "@/lib/schemas/question";
import { createGame, gameReducer } from "@/lib/game/reducer";

export function useSoloGame(questions: QuestionItem[]) {
  const [state, dispatch] = useReducer(gameReducer, questions, createGame);
  useEffect(() => {
    if (state.phase !== "answering") return;
    const expire = () =>
      dispatch({
        type: "ANSWER",
        choice: null,
        now: Date.now(),
        index: state.index,
      });
    const timer = window.setTimeout(
      expire,
      Math.max(0, state.deadline - Date.now()),
    );
    const onVisible = () => {
      if (Date.now() >= state.deadline) expire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.phase, state.deadline, state.index]);
  const answer = useCallback(
    (choice: number) =>
      dispatch({ type: "ANSWER", choice, now: Date.now(), index: state.index }),
    [state.index],
  );
  const next = useCallback(
    () => dispatch({ type: "NEXT", now: Date.now() }),
    [],
  );
  return { state, dispatch, answer, next };
}
