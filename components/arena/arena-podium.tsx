"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Trophy,
  Crown,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Flame,
  Zap,
  Users,
  Copy,
  Check,
  Share2,
} from "lucide-react";
import type { ArenaPlayer, ArenaRoomState } from "@/lib/schemas/multiplayer";
import { Button } from "@/components/ui/button";

export function ArenaPodium({
  room,
  currentPlayer,
  onRematch,
  onDebriefCoach,
  onLeave,
}: {
  room: ArenaRoomState;
  currentPlayer: ArenaPlayer;
  onRematch: () => void;
  onDebriefCoach?: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = currentPlayer.isHost;
  const podium = room.podium;
  const rankings = podium?.rankings || Object.values(room.players);
  const winner = podium?.first;

  const copyScoreboard = () => {
    if (typeof window === "undefined") return;
    const lines = [
      `🏆 Clutch Arena Match: ${room.title}`,
      `Code: ${room.code} · ${room.totalQuestions} Questions`,
      "--------------------------------",
      ...rankings.map(
        (p, idx) =>
          `#${idx + 1} ${p.avatar} ${p.nickname}: ${p.score} XP (Streak: ${p.bestStreak})`,
      ),
      "--------------------------------",
      `My Stats: ${currentPlayer.score} XP · ${currentPlayer.bestStreak} Best Streak`,
      "Play live study battles at Clutch Arena!",
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Trigger confetti for the match finish
  useEffect(() => {
    void import("canvas-confetti")
      .then(({ default: confetti }) => {
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.5 },
          colors: ["#ee714c", "#f3c77b", "#66876a"],
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="arena-podium-container">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="podium-card surface"
      >
        <div className="podium-trophy-circle">
          <Trophy size={42} />
        </div>
        <span className="eyebrow">ARENA MATCH CONCLUDED</span>
        <h2>{winner ? `${winner.nickname} claims victory!` : "Match Complete!"}</h2>
        <p>A battle of speed, precision, and focus.</p>

        {/* 1st, 2nd, 3rd visual podium */}
        <div className="podium-stages">
          {/* 2nd place */}
          {podium?.second && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="podium-pillar pillar-second"
            >
              <div className="pillar-avatar">{podium.second.avatar}</div>
              <strong className="pillar-name">{podium.second.nickname}</strong>
              <span className="pillar-score">{podium.second.score} XP</span>
              <div className="pillar-block block-2">2ND</div>
            </motion.div>
          )}

          {/* 1st place */}
          {podium?.first && (
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="podium-pillar pillar-first"
            >
              <div className="crown-icon">
                <Crown size={22} fill="currentColor" />
              </div>
              <div className="pillar-avatar avatar-winner">
                {podium.first.avatar}
              </div>
              <strong className="pillar-name">{podium.first.nickname}</strong>
              <span className="pillar-score">{podium.first.score} XP</span>
              <div className="pillar-block block-1">1ST</div>
            </motion.div>
          )}

          {/* 3rd place */}
          {podium?.third && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="podium-pillar pillar-third"
            >
              <div className="pillar-avatar">{podium.third.avatar}</div>
              <strong className="pillar-name">{podium.third.nickname}</strong>
              <span className="pillar-score">{podium.third.score} XP</span>
              <div className="pillar-block block-3">3RD</div>
            </motion.div>
          )}
        </div>

        {/* Full rankings table */}
        <div className="podium-scoreboard">
          <div className="scoreboard-title">FINAL SCOREBOARD</div>
          <div className="scoreboard-list">
            {rankings.map((p, rank) => {
              const isMe = p.id === currentPlayer.id;
              return (
                <div
                  key={p.id}
                  className={`scoreboard-row ${isMe ? "scoreboard-row-me" : ""}`}
                >
                  <span className="score-rank">#{rank + 1}</span>
                  <span className="score-avatar">{p.avatar}</span>
                  <div className="score-name-cell">
                    <strong>
                      {p.nickname} {isMe && <small>(You)</small>}
                    </strong>
                    <small>
                      Best streak: {p.bestStreak} · {p.lives} lives remaining
                    </small>
                  </div>
                  <strong className="score-xp">{p.score} XP</strong>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions row */}
        <div className="podium-actions-row">
          {isHost ? (
            <Button onClick={onRematch} className="rematch-btn">
              <RotateCcw size={16} />
              <span>Host Rematch</span>
            </Button>
          ) : (
            <div className="rematch-waiting-note">
              <span className="live-pulse" />
              <span>Waiting for host to rematch…</span>
            </div>
          )}

          <Button
            variant="outline"
            onClick={copyScoreboard}
            className="copy-scoreboard-btn"
          >
            {copied ? <Check size={16} /> : <Share2 size={16} />}
            <span>{copied ? "Scoreboard Copied!" : "Share Results"}</span>
          </Button>

          {onDebriefCoach && (
            <Button
              variant="outline"
              onClick={onDebriefCoach}
              className="debrief-coach-btn"
            >
              <Sparkles size={16} />
              <span>Debrief with Coach</span>
            </Button>
          )}

          <Button variant="ghost" onClick={onLeave}>
            Leave Arena
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
