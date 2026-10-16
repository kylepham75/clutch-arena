"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  Flame,
  Zap,
  Clock3,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Check,
  BookOpen,
  Keyboard,
  Eye,
  Lock,
} from "lucide-react";
import type { ArenaPlayer, ArenaRoomState } from "@/lib/schemas/multiplayer";
import { TimerBar } from "@/components/quiz/timer-bar";
import { streakLabel } from "@/lib/game/scoring";
import { MathText } from "@/components/ui/math-text";
import { useGameAudio } from "@/hooks/use-game-audio";

export function ArenaGame({
  room,
  currentPlayer,
  onSubmitAnswer,
}: {
  room: ArenaRoomState;
  currentPlayer: ArenaPlayer;
  onSubmitAnswer: (selected: number) => void;
}) {
  const audio = useGameAudio();
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const myPlayer = room.players[currentPlayer.id] || currentPlayer;
  const isEliminated = myPlayer.lives <= 0;

  // Reset choice when moving to a new question
  useEffect(() => {
    setSelectedChoice(null);
  }, [room.currentQuestionIndex]);

  // Keyboard navigation for answering
  useEffect(() => {
    if (
      room.status !== "answering" ||
      isEliminated ||
      selectedChoice !== null ||
      myPlayer.status === "submitted"
    ) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const key = e.key.toLowerCase();
      let index = -1;
      if (key === "1" || key === "a") index = 0;
      else if (key === "2" || key === "b") index = 1;
      else if (key === "3" || key === "c") index = 2;
      else if (key === "4" || key === "d") index = 3;

      if (index >= 0) {
        e.preventDefault();
        void audio.unlock();
        setSelectedChoice(index);
        onSubmitAnswer(index);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [room.status, isEliminated, selectedChoice, myPlayer.status, onSubmitAnswer, audio]);

  const handleSelect = (idx: number) => {
    if (
      room.status !== "answering" ||
      isEliminated ||
      selectedChoice !== null ||
      myPlayer.status === "submitted"
    ) {
      return;
    }

    void audio.unlock();
    setSelectedChoice(idx);
    onSubmitAnswer(idx);
  };

  // Sort leaderboard by score descending
  const sortedPlayers = useMemo(() => {
    return Object.values(room.players).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.lives !== a.lives) return b.lives - a.lives;
      return b.bestStreak - a.bestStreak;
    });
  }, [room.players]);

  const q = room.currentQuestion;
  const fb = room.revealedFeedback;

  return (
    <div className="arena-game-container">
      {/* 3-2-1 Countdown Overlay */}
      {room.status === "countdown" && (
        <div className="arena-countdown-overlay">
          <motion.div
            key="countdown"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="countdown-box"
          >
            <span className="countdown-eyebrow">MATCH STARTING</span>
            <h2>Get Ready!</h2>
            <div className="countdown-pulse-circle">
              <Zap size={48} fill="currentColor" />
            </div>
            <p>15 seconds per round · Synchronized answers</p>
          </motion.div>
        </div>
      )}

      <div className="arena-game-layout">
        {/* Main Quiz Area */}
        <div className="arena-main-column">
          {/* Round Header & Player HUD */}
          <div className="arena-hud surface">
            <div className="hud-metric">
              <span className="metric-label">ROUND</span>
              <strong>
                {room.currentQuestionIndex + 1}
                <small>/{room.totalQuestions}</small>
              </strong>
            </div>

            <div className="hud-metric">
              <span className="metric-label">SCORE</span>
              <strong className="score-val">{myPlayer.score} XP</strong>
            </div>

            <div className="hud-metric">
              <span className="metric-label">STREAK</span>
              <strong className="streak-val">
                <Flame
                  size={15}
                  className={myPlayer.streak >= 3 ? "text-amber-500 fill-amber-500" : ""}
                />
                {myPlayer.streak} ({streakLabel(myPlayer.streak)})
              </strong>
            </div>

            <div className="hud-metric">
              <span className="metric-label">LIVES</span>
              <div className="lives-row">
                {[1, 2, 3].map((heart) => (
                  <Heart
                    key={heart}
                    size={17}
                    fill={heart <= myPlayer.lives ? "#e96943" : "none"}
                    color={heart <= myPlayer.lives ? "#e96943" : "#cbd2c2"}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Quiz Card */}
          <div className="quiz-card surface arena-quiz-card">
            <TimerBar
              deadline={room.roundDeadline}
              running={room.status === "answering"}
            />

            {q && (
              <div className="arena-question-body">
                <div className="arena-question-meta">
                  <span className="eyebrow">
                    QUESTION {q.number} OF {q.total}
                  </span>
                  {q.topic && <span className="topic-badge">{q.topic}</span>}
                </div>

                <h3 className="arena-question-text">
                  <MathText content={q.question} />
                </h3>

                <div className="arena-options-grid">
                  {q.options.map((option, idx) => {
                    const letters = ["A", "B", "C", "D"];
                    const isSelected = selectedChoice === idx;
                    const isRevealedCorrect =
                      room.status === "feedback" && fb?.correctIndex === idx;
                    const isRevealedWrong =
                      room.status === "feedback" &&
                       isSelected &&
                      fb?.correctIndex !== idx;

                    let optionClass = "arena-option";
                    if (isSelected) optionClass += " selected";
                    if (isRevealedCorrect) optionClass += " option-correct";
                    if (isRevealedWrong) optionClass += " option-wrong";

                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={
                          room.status !== "answering" ||
                          isEliminated ||
                          selectedChoice !== null ||
                          myPlayer.status === "submitted"
                        }
                        onClick={() => handleSelect(idx)}
                        className={optionClass}
                      >
                        <span className="option-kbd">{letters[idx]}</span>
                        <span className="option-label">
                          <MathText content={option} inline />
                        </span>
                        {isRevealedCorrect && <Check size={16} className="status-icon" />}
                      </button>
                    );
                  })}
                </div>

                {/* Submitting / Status Banner */}
                {room.status === "answering" && selectedChoice !== null && (
                  <div className="arena-submitted-banner">
                    <CheckCircle2 size={16} />
                    <span>Answer locked in! Waiting for other contenders…</span>
                  </div>
                )}

                {/* Spectator Banner */}
                {isEliminated && (
                  <div className="arena-spectator-banner">
                    <Eye size={16} />
                    <span>Out of hearts — Spectating remaining contenders. Final standings appear on the podium!</span>
                  </div>
                )}

                {/* Feedback Panel */}
                {room.status === "feedback" && fb && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="arena-round-feedback"
                  >
                    <div className="feedback-result-row">
                      {myPlayer.lastAnswer?.correct ? (
                        <div className="result-chip chip-correct">
                          <CheckCircle2 size={16} />
                          <strong>
                            Clutch! +{myPlayer.lastAnswer.points} XP
                          </strong>
                        </div>
                      ) : (
                        <div className="result-chip chip-wrong">
                          <XCircle size={16} />
                          <strong>
                            {myPlayer.lastAnswer?.selected === null
                              ? "Timed out! -1 Life"
                              : "Missed! -1 Life"}
                          </strong>
                        </div>
                      )}
                      <span className="next-countdown">Next round in 4s…</span>
                    </div>

                    <p className="feedback-explanation">
                      <MathText content={fb.explanation} inline />
                    </p>
                    {fb.citation && (
                      <small className="feedback-citation">
                        <BookOpen size={13} />
                        {fb.citation}
                      </small>
                    )}
                  </motion.div>
                )}
              </div>
            )}
          </div>

          <div className="keyboard-footer">
            <Keyboard size={15} />
            <span>
              <kbd>A</kbd>–<kbd>D</kbd> or <kbd>1</kbd>–<kbd>4</kbd> to submit
            </span>
            <span className="keyboard-separator" />
            <span>Synchronized server deadline</span>
          </div>
        </div>

        {/* Live Leaderboard Sidebar */}
        <aside className="arena-sidebar">
          <div className="leaderboard-card surface">
            <div className="leaderboard-header">
              <span className="eyebrow">LIVE LEADERBOARD</span>
              <h4>Arena Rankings</h4>
            </div>

            <div className="leaderboard-list">
              <AnimatePresence>
                {sortedPlayers.map((player, rank) => {
                  const isMe = player.id === currentPlayer.id;
                  const isDead = player.lives <= 0;

                  return (
                    <motion.div
                      key={player.id}
                      layout
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                      className={`leaderboard-row ${isMe ? "leaderboard-row-me" : ""} ${isDead ? "eliminated" : ""}`}
                    >
                      <div className="rank-badge">#{rank + 1}</div>
                      <div className="avatar-chip">{player.avatar}</div>
                      <div className="player-details">
                        <span className="player-name">
                          {player.nickname}
                          {isMe && <small>(You)</small>}
                        </span>
                        <div className="player-stats-sub">
                          <span className="lives-dots">
                            {"♥".repeat(player.lives)}
                          </span>
                          {player.streak >= 3 && (
                            <span className="streak-tag">
                              🔥 {player.streak}
                            </span>
                          )}
                          {room.status === "answering" && !isDead && (
                            player.status === "submitted" ? (
                              <span className="player-live-tag tag-locked">✓ In</span>
                            ) : (
                              <span className="player-live-tag tag-thinking">Thinking…</span>
                            )
                          )}
                          {room.status === "feedback" && player.lastAnswer && (
                            <span
                              className={`player-live-tag ${player.lastAnswer.correct ? "tag-round-correct" : "tag-round-wrong"}`}
                            >
                              {player.lastAnswer.correct
                                ? `+${player.lastAnswer.points}`
                                : "Miss"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="score-badge">{player.score} XP</div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
