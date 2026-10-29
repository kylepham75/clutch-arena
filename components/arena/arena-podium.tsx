"use client";

import React, { useEffect, useState } from "react";
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
  BarChart3,
  Download,
  AlertTriangle,
} from "lucide-react";
import type { ArenaPlayer, ArenaQuestionStat, ArenaRoomState } from "@/lib/schemas/multiplayer";
import { Button } from "@/components/ui/button";
import {
  copyTextWithFallback,
  downloadTextFile,
  slugify,
} from "@/lib/game/pack-transfer";
import { translations, type Language, type TranslationDict } from "@/lib/i18n/translations";

let testLanguageOverride: { language: Language; t: TranslationDict } | null = null;

export function setArenaPodiumTestLanguage(lang: Language | null) {
  testLanguageOverride = lang ? { language: lang, t: translations[lang] } : null;
}

let realUseLanguage:
  | (() => { language: Language; setLanguage: (lang: Language) => void; t: TranslationDict })
  | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ctx = require("@/lib/i18n/context");
  if (ctx && typeof ctx.useLanguage === "function") {
    realUseLanguage = ctx.useLanguage;
  }
} catch {
  // Graceful fallback in environments (such as custom test transpilers)
  // where relative imports inside @/lib/i18n/context cannot be resolved.
}

export function useLanguage() {
  if (testLanguageOverride) {
    return {
      language: testLanguageOverride.language,
      setLanguage: (lang: Language) => {
        testLanguageOverride = { language: lang, t: translations[lang] };
      },
      t: testLanguageOverride.t,
    };
  }
  if (realUseLanguage) {
    try {
      return realUseLanguage();
    } catch {
      // Fallback
    }
  }
  return {
    language: "en" as Language,
    setLanguage: () => {},
    t: translations.en,
  };
}

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

function escapeCsvCell(raw: unknown): string {
  const val = String(raw ?? "");
  // Neutralise spreadsheet formula injection (OWASP CSV injection guidance).
  const sanitized = /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;
  return /[",\r\n]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
}

/**
 * Builds a two-section Gradebook CSV string containing:
 * 1. Player rankings (Rank, Nickname, Score XP, Best Streak, Lives Remaining, Status)
 * 2. Per-question class diagnostics (Question #, Topic, Question, Total Attempts, Correct, Missed, Missed %, Top Wrong Option)
 */
export function buildClassGradebookCsv(room: ArenaRoomState): string {
  const rankings = room.podium?.rankings?.length
    ? room.podium.rankings
    : Object.values(room.players || {});

  const playerHeaders = [
    "Rank",
    "Nickname",
    "Score XP",
    "Best Streak",
    "Lives Remaining",
    "Status",
  ];

  const playerRows = rankings.map((p, idx) => [
    idx + 1,
    p.nickname,
    p.score,
    p.bestStreak,
    p.lives,
    p.status,
  ]);

  const questionHeaders = [
    "Question #",
    "Topic",
    "Question",
    "Total Attempts",
    "Correct",
    "Missed",
    "Missed %",
    "Top Wrong Option",
  ];

  const sortedStats: ArenaQuestionStat[] = room.classAnalytics?.questionStats
    ? [...room.classAnalytics.questionStats].sort(
        (a, b) => b.missedPercent - a.missedPercent || a.questionNumber - b.questionNumber,
      )
    : [];

  const questionRows = sortedStats.map((stat) => {
    const topWrong =
      stat.mostCommonWrongOption !== null &&
      stat.mostCommonWrongOption >= 0 &&
      stat.mostCommonWrongOption < OPTION_LETTERS.length
        ? `Option ${OPTION_LETTERS[stat.mostCommonWrongOption]}`
        : "None";

    return [
      stat.questionNumber,
      stat.topic || stat.citation || "",
      stat.questionText,
      stat.totalAttempts,
      stat.correctCount,
      stat.missedCount,
      `${stat.missedPercent}%`,
      topWrong,
    ];
  });

  const lines = [
    playerHeaders.map(escapeCsvCell).join(","),
    ...playerRows.map((row) => row.map(escapeCsvCell).join(",")),
    "",
    questionHeaders.map(escapeCsvCell).join(","),
    ...questionRows.map((row) => row.map(escapeCsvCell).join(",")),
  ];

  return lines.join("\r\n");
}

export const exportClassGradebookCsv = buildClassGradebookCsv;

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
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const isHost = Boolean(currentPlayer.isHost);
  const podium = room.podium;
  const rankings = podium?.rankings?.length
    ? podium.rankings
    : Object.values(room.players || {});
  const winner = podium?.first;

  const classAnalytics = room.classAnalytics;
  const hasAnalytics = Boolean(
    classAnalytics && classAnalytics.questionStats && classAnalytics.questionStats.length > 0,
  );

  // Visible to Host by default, or expandable by any player via toggle button
  const [analyticsExpanded, setAnalyticsExpanded] = useState<boolean | null>(null);
  const isAnalyticsVisible =
    hasAnalytics && (analyticsExpanded !== null ? analyticsExpanded : isHost);

  const sortedQuestionStats: ArenaQuestionStat[] = classAnalytics?.questionStats
    ? [...classAnalytics.questionStats].sort(
        (a, b) => b.missedPercent - a.missedPercent || a.questionNumber - b.questionNumber,
      )
    : [];

  const copyScoreboard = async () => {
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
    const success = await copyTextWithFallback(lines.join("\n"));
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
        <span className="eyebrow">{t.arena.matchConcludedEyebrow}</span>
        <h2>{winner ? `${winner.nickname} ${t.arena.claimsVictorySuffix}` : t.arena.matchCompleteTitle}</h2>
        <p>{t.arena.podiumSubtitle}</p>

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
          <div className="scoreboard-title">{t.arena.finalScoreboard}</div>
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
                      {p.nickname} {isMe && <small> ({t.arena.youPill})</small>}
                    </strong>
                    <small>
                      {t.arena.bestStreakLabel}: {p.bestStreak} · {p.lives} {t.arena.livesRemaining}
                    </small>
                  </div>
                  <strong className="score-xp">{p.score} XP</strong>
                </div>
              );
            })}
          </div>
        </div>

        {/* Post-Match Class Analytics Dashboard */}
        {isAnalyticsVisible && classAnalytics && (
          <div
            className="class-analytics-dashboard"
            data-testid="class-analytics-dashboard"
          >
            <div className="analytics-header">
              <div className="analytics-title-group">
                <BarChart3 size={20} className="analytics-icon" />
                <div>
                  <h3 className="analytics-title">{t.arena.classAnalyticsTitle}</h3>
                  <p className="analytics-subtitle">
                    {t.arena.classAnalyticsSubtitle}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                data-testid="export-gradebook-btn"
                className="export-gradebook-btn"
                onClick={() => {
                  const fileName = `${slugify(room.title)}-gradebook-${room.code}.csv`;
                  downloadTextFile(fileName, buildClassGradebookCsv(room), "text/csv");
                }}
              >
                <Download size={15} />
                <span>{t.arena.exportGradebookBtn}</span>
              </Button>
            </div>

            {/* Diagnostic Alert Banner if early eliminations occurred */}
            {classAnalytics.earlyEliminatedCount > 0 && (
              <div
                className="early-elimination-alert"
                data-testid="early-elimination-alert"
              >
                <AlertTriangle size={18} className="alert-icon" />
                <span>
                  ⚠️ {classAnalytics.earlyEliminatedCount} {t.arena.earlyEliminationPrefix} (
                  {classAnalytics.earlyEliminatedNicknames.join(", ")}) {t.arena.earlyEliminationSuffix}
                </span>
              </div>
            )}

            {/* Summary KPI Strip */}
            <div className="analytics-kpi-strip" data-testid="analytics-kpi-strip">
              <div className="analytics-kpi-card">
                <span className="kpi-label">{t.arena.classAvgAccuracy}</span>
                <strong className="kpi-value">{classAnalytics.averageAccuracyPercent}%</strong>
              </div>
              <div className="analytics-kpi-card">
                <span className="kpi-label">{t.arena.totalPlayersKpi}</span>
                <strong className="kpi-value">{classAnalytics.totalPlayers}</strong>
              </div>
              <div className="analytics-kpi-card">
                <span className="kpi-label">{t.arena.totalQuestionsKpi}</span>
                <strong className="kpi-value">{classAnalytics.totalQuestions}</strong>
              </div>
            </div>

            {/* Missed-Question Diagnostic Breakdown */}
            <div className="missed-questions-list" data-testid="missed-questions-list">
              <div className="missed-questions-header">
                <h4>{t.arena.missedDiagnosticHeader}</h4>
              </div>
              <div className="missed-questions-items">
                {sortedQuestionStats.map((stat) => {
                  const isNeedsReteach = stat.missedPercent >= 50;
                  const trapLetter =
                    stat.mostCommonWrongOption !== null &&
                    stat.mostCommonWrongOption >= 0 &&
                    stat.mostCommonWrongOption < OPTION_LETTERS.length
                      ? OPTION_LETTERS[stat.mostCommonWrongOption]
                      : null;

                  return (
                    <div
                      key={stat.questionId || stat.questionNumber}
                      className={`question-stat-row ${isNeedsReteach ? "question-stat-reteach" : ""}`}
                      data-testid={`question-stat-${stat.questionNumber}`}
                    >
                      <div className="question-stat-main">
                        <div className="question-stat-tags">
                          <span className="question-num-tag">Q{stat.questionNumber}</span>
                          {(stat.topic || stat.citation) && (
                            <span className="question-topic-pill">
                              {stat.topic || stat.citation}
                            </span>
                          )}
                          {isNeedsReteach && (
                            <span className="needs-reteach-badge">{t.arena.needsReteachBadge}</span>
                          )}
                          {trapLetter && (
                            <span className="top-trap-badge">
                              {t.arena.topTrapPrefix} {trapLetter}
                            </span>
                          )}
                        </div>
                        <p className="question-stat-text">{stat.questionText}</p>
                      </div>
                      <div className="question-stat-meta">
                        <span className={`missed-badge ${isNeedsReteach ? "missed-badge-high" : ""}`}>
                          {stat.missedPercent}% {t.arena.missedWord} ({stat.missedCount}/{stat.totalAttempts})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Actions row */}
        <div className="podium-actions-row">
          {isHost ? (
            <Button onClick={onRematch} className="rematch-btn">
              <RotateCcw size={16} />
              <span>{t.arena.hostRematchBtn}</span>
            </Button>
          ) : (
            <div className="rematch-waiting-note">
              <span className="live-pulse" />
              <span>{t.arena.waitingForRematch}</span>
            </div>
          )}

          {hasAnalytics && (
            <Button
              variant="outline"
              data-testid="toggle-analytics-btn"
              onClick={() =>
                setAnalyticsExpanded((prev) =>
                  prev !== null ? !prev : !isHost,
                )
              }
              className="toggle-analytics-btn"
            >
              <BarChart3 size={16} />
              <span>{isAnalyticsVisible ? t.arena.hideAnalyticsBtn : t.arena.viewAnalyticsBtn}</span>
            </Button>
          )}

          <Button
            variant="outline"
            onClick={copyScoreboard}
            className="copy-scoreboard-btn"
          >
            {copied ? <Check size={16} /> : <Share2 size={16} />}
            <span>{copied ? t.arena.scoreboardCopiedBtn : t.arena.shareResultsBtn}</span>
          </Button>

          {onDebriefCoach && (
            <Button
              variant="outline"
              onClick={onDebriefCoach}
              className="debrief-coach-btn"
            >
              <Sparkles size={16} />
              <span>{t.arena.debriefWithCoachBtn}</span>
            </Button>
          )}

          <Button variant="ghost" onClick={onLeave}>
            {t.arena.leaveArenaBtn}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
