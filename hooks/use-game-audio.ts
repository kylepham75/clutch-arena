"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Sound = "start" | "correct" | "wrong" | "streak" | "finish";
const notes: Record<Sound, number[]> = {
  start: [330, 440, 660],
  correct: [660, 880],
  wrong: [180, 120],
  streak: [523, 659, 784, 1047],
  finish: [523, 659, 784, 1047, 1319],
};
export function useGameAudio() {
  const context = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try {
      setMuted(localStorage.getItem("clutch:muted:v1") === "true");
    } catch {
      /* Storage may be unavailable. */
    }
    return () => {
      void context.current?.close().catch(() => {});
      context.current = null;
    };
  }, []);
  const unlock = useCallback(async () => {
    if (typeof window.AudioContext === "undefined") return;
    try {
      context.current ??= new AudioContext();
      await context.current.resume().catch(() => {});
    } catch {
      /* Gameplay works without audio. */
    }
  }, []);
  const play = useCallback(
    (sound: Sound) => {
      const ctx = context.current;
      if (muted || !ctx || ctx.state !== "running") return;
      notes[sound].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + index * 0.085;
        oscillator.type = sound === "wrong" ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.09, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.2);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      });
    },
    [muted],
  );
  const toggle = () => {
    void unlock();
    const nextMuted = !muted;
    setMuted(nextMuted);
    try {
      localStorage.setItem("clutch:muted:v1", String(nextMuted));
    } catch {
      /* Optional preference. */
    }
  };
  return { muted, toggle, unlock, play };
}
