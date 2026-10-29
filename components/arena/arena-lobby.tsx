"use client";

import { useState } from "react";
import {
  Users,
  Copy,
  Check,
  Bot,
  Crown,
  Play,
  Share2,
  Trash2,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ArenaPlayer, ArenaRoomState } from "@/lib/schemas/multiplayer";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

export function ArenaLobby({
  room,
  currentPlayer,
  onStartMatch,
  onToggleReady,
  onAddBot,
  onRemoveBot,
}: {
  room: ArenaRoomState;
  currentPlayer: ArenaPlayer;
  onStartMatch: () => void;
  onToggleReady: () => void;
  onAddBot: (type?: "speed" | "steady" | "wildcard") => void;
  onRemoveBot: (botId: string) => void;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const isHost = currentPlayer.isHost;
  const players = Object.values(room.players);
  const botCount = players.filter((p) => p.isBot).length;

  const copyRoomCode = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(room.code).then(() => {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
      });
    }
  };

  const copyRoomLink = () => {
    if (typeof window !== "undefined") {
      const url = `${window.location.origin}/arena?room=${room.code}`;
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="arena-lobby-container">
      <div className="arena-lobby-header surface">
        <div className="arena-title-area">
          <div className="eyebrow">
            <span className="tiny-star">✦</span> {t.arena.lobbyEyebrow}
          </div>
          <h2>{room.title}</h2>
          <div className="lobby-meta-row">
            <button
              type="button"
              onClick={copyRoomCode}
              className="room-code-tag cursor-pointer"
              title={t.arena.clickToCopyCode}
            >
              {t.arena.codeLabel} <strong>{room.code}</strong>
              {codeCopied && <span className="copied-pill">{t.arena.copiedPill}</span>}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyRoomLink}
              className="copy-code-btn"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? t.arena.linkCopiedBtn : t.arena.shareRoomLinkBtn}</span>
            </Button>
            <span className="mode-badge">
              {room.mode === "variants" ? t.arena.conceptRemix : t.arena.classicRecall}
            </span>
            <span className="question-count-badge">
              {room.totalQuestions} {t.arena.questionsUnit}
            </span>
          </div>
        </div>
      </div>

      <div className="arena-lobby-grid">
        {/* Players roster */}
        <div className="lobby-roster-card surface">
          <div className="roster-header">
            <div>
              <h3>{t.arena.contendersHeader}</h3>
              <p>
                {players.length} {t.arena.playersWord} {t.arena.joinedWord}
              </p>
            </div>

            {isHost && botCount < 3 && (
              <div className="add-bot-dropdown flex items-center gap-1.5 flex-wrap justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAddBot()}
                  className="add-bot-btn"
                >
                  <Bot size={14} />
                  <span>{t.arena.addPracticeBot}</span>
                  <Plus size={13} />
                </Button>
                <div className="bot-archetype-chips">
                  <button
                    type="button"
                    onClick={() => onAddBot("speed")}
                    className="bot-chip"
                    title={t.arena.botSpeedTitle}
                  >
                    {t.arena.botSpeed}
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddBot("steady")}
                    className="bot-chip"
                    title={t.arena.botSteadyTitle}
                  >
                    {t.arena.botSteady}
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddBot("wildcard")}
                    className="bot-chip"
                    title={t.arena.botWildcardTitle}
                  >
                    {t.arena.botWildcard}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="roster-list">
            {players.map((p) => {
              const isMe = p.id === currentPlayer.id;
              return (
                <div
                  key={p.id}
                  className={`roster-item ${isMe ? "roster-item-me" : ""}`}
                >
                  <div className="player-avatar-circle">
                    <span>{p.avatar}</span>
                    {p.isHost && (
                      <span className="host-crown-badge" title={t.arena.roleHost}>
                        <Crown size={12} fill="currentColor" />
                      </span>
                    )}
                  </div>

                  <div className="player-info-cell">
                    <strong>
                      {p.nickname} {isMe && <span className="you-pill">{t.arena.youPill}</span>}
                    </strong>
                    <small>
                      {p.isBot ? t.arena.roleBot : p.isHost ? t.arena.roleHost : t.arena.roleChallenger}
                    </small>
                  </div>

                  <div className="player-status-cell">
                    {p.isReady ? (
                      <span className="ready-tag">
                        <Check size={12} /> {t.arena.readyTag}
                      </span>
                    ) : (
                      <span className="not-ready-tag">{t.arena.waitingTag}</span>
                    )}

                    {isHost && p.isBot && (
                      <button
                        type="button"
                        className="remove-bot-btn"
                        onClick={() => onRemoveBot(p.id)}
                        title={t.arena.removeBotTitle}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {players.length < 4 && (
              <div className="roster-item roster-item-empty">
                <div className="player-avatar-circle slot-empty-circle">
                  <span>+</span>
                </div>
                <div className="player-info-cell">
                  <strong>{t.arena.openSlotTitle}</strong>
                  <small>{t.arena.openSlotDescPrefix} {room.code} {t.arena.openSlotDescSuffix}</small>
                </div>
                <span className="not-ready-tag">{t.arena.openTag}</span>
              </div>
            )}
          </div>
        </div>

        {/* Match briefing & Start panel */}
        <div className="lobby-briefing-card surface">
          <div className="eyebrow">{t.arena.matchRulesEyebrow}</div>
          <h4>{t.arena.matchRulesTitle}</h4>
          <ul className="rules-list">
            <li>
              <Zap size={14} />
              <span>
                <strong>{t.arena.rule1Bold}</strong>: {t.arena.rule1Text}
              </span>
            </li>
            <li>
              <Sparkles size={14} />
              <span>
                <strong>{t.arena.rule2Bold}</strong>: {t.arena.rule2Text}
              </span>
            </li>
            <li>
              <Users size={14} />
              <span>
                <strong>{t.arena.rule3Bold}</strong>: {t.arena.rule3Text}
              </span>
            </li>
          </ul>

          <div className="lobby-action-box">
            {isHost ? (
              <Button
                className="start-match-cta"
                onClick={onStartMatch}
                disabled={players.length === 0}
              >
                <Play size={16} fill="currentColor" />
                <span>{t.arena.startMatchBtn} ({players.length} {t.arena.playersWord})</span>
              </Button>
            ) : (
              <Button
                variant={currentPlayer.isReady ? "outline" : "dark"}
                className="ready-toggle-cta"
                onClick={onToggleReady}
              >
                <Check size={16} />
                <span>
                  {currentPlayer.isReady ? t.arena.cancelReadyBtn : t.arena.imReadyBtn}
                </span>
              </Button>
            )}
            <p className="host-caption">
              {isHost ? t.arena.hostCaption : t.arena.guestCaption}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
