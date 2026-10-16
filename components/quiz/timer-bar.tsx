"use client";
import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { QUESTION_DURATION_MS } from "@/lib/game/constants";
import { useLanguage } from "@/lib/i18n/context";

export function TimerBar({
  deadline,
  running,
  frozenRemaining = 0,
}: {
  deadline: number;
  running: boolean;
  frozenRemaining?: number;
}) {
  const { language } = useLanguage();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(timer);
  }, [running, deadline]);
  const remaining = running ? Math.max(0, deadline - now) : frozenRemaining;
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className={`timer ${seconds <= 5 && running ? "timer-urgent" : ""}`}>
      <div className="timer-label">
        <span>
          <Clock3 size={15} />
          {running
            ? language === "vi"
              ? "Thời gian suy nghĩ"
              : "Time to think"
            : language === "vi"
              ? "Đã tạm dừng"
              : "Clock paused"}
        </span>
        <strong data-testid="timer">
          {seconds}
          <small> / 15s</small>
        </strong>
      </div>
      <div
        className="timer-track"
        role="progressbar"
        aria-label="Time remaining"
        aria-valuemin={0}
        aria-valuemax={15}
        aria-valuenow={seconds}
      >
        <div
          style={{
            width: `${Math.min(100, (remaining / QUESTION_DURATION_MS) * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
