"use client";
import { useEffect } from "react";

export function useGameKeyboard({
  enabled,
  phase,
  answer,
  next,
}: {
  enabled: boolean;
  phase: string;
  answer: (choice: number) => void;
  next: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      if (
        phase === "feedback" &&
        (event.key === " " || event.key === "Enter")
      ) {
        const control = target?.closest("button, a");
        if (control && !control.hasAttribute("data-quiz-advance")) return;
        event.preventDefault();
        next();
        return;
      }
      if (phase !== "answering") return;
      const letter = ["a", "b", "c", "d"].indexOf(event.key.toLowerCase());
      const digit = ["1", "2", "3", "4"].indexOf(event.key);
      const index = letter >= 0 ? letter : digit;
      if (index >= 0) {
        event.preventDefault();
        answer(index);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, phase, answer, next]);
}
