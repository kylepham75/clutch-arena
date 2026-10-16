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
            <span className="tiny-star">✦</span> MULTIPLAYER STUDY ARENA LOBBY
          </div>
          <h2>{room.title}</h2>
          <div className="lobby-meta-row">
            <button
              type="button"
              onClick={copyRoomCode}
              className="room-code-tag cursor-pointer"
              title="Click to copy room code"
            >
              CODE: <strong>{room.code}</strong>
              {codeCopied && <span className="copied-pill">Copied!</span>}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyRoomLink}
              className="copy-code-btn"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? "Link Copied!" : "Share Room Link"}</span>
            </Button>
            <span className="mode-badge">
              {room.mode === "variants" ? "Concept remix" : "Classic recall"}
            </span>
            <span className="question-count-badge">
              {room.totalQuestions} questions
            </span>
          </div>
        </div>
      </div>

      <div className="arena-lobby-grid">
        {/* Players roster */}
        <div className="lobby-roster-card surface">
          <div className="roster-header">
            <div>
              <h3>Contenders in the Arena</h3>
              <p>
                {players.length} player{players.length === 1 ? "" : "s"} joined
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
                  <span>Add Practice Bot</span>
                  <Plus size={13} />
                </Button>
                <div className="bot-archetype-chips">
                  <button
                    type="button"
                    onClick={() => onAddBot("speed")}
                    className="bot-chip"
                    title="Add Alex (Speed Demon)"
                  >
                    ⚡ Speed
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddBot("steady")}
                    className="bot-chip"
                    title="Add Maya (Steady Scholar)"
                  >
                    🦉 Steady
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddBot("wildcard")}
                    className="bot-chip"
                    title="Add Sam (Wildcard)"
                  >
                    🔥 Wildcard
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
                      <span className="host-crown-badge" title="Room Host">
                        <Crown size={12} fill="currentColor" />
                      </span>
                    )}
                  </div>

                  <div className="player-info-cell">
                    <strong>
                      {p.nickname} {isMe && <span className="you-pill">YOU</span>}
                    </strong>
                    <small>
                      {p.isBot ? "AI Practice Bot" : p.isHost ? "Arena Host" : "Challenger"}
                    </small>
                  </div>

                  <div className="player-status-cell">
                    {p.isReady ? (
                      <span className="ready-tag">
                        <Check size={12} /> Ready
                      </span>
                    ) : (
                      <span className="not-ready-tag">Waiting</span>
                    )}

                    {isHost && p.isBot && (
                      <button
                        type="button"
                        className="remove-bot-btn"
                        onClick={() => onRemoveBot(p.id)}
                        title="Remove bot"
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
                  <strong>Open Contender Slot</strong>
                  <small>Share room code {room.code} or add a bot above</small>
                </div>
                <span className="not-ready-tag">Open</span>
              </div>
            )}
          </div>
        </div>

        {/* Match briefing & Start panel */}
        <div className="lobby-briefing-card surface">
          <div className="eyebrow">MATCH RULES</div>
          <h4>Fast recall under pressure.</h4>
          <ul className="rules-list">
            <li>
              <Zap size={14} />
              <span>
                <strong>15 seconds per question</strong>: Everyone answers at the
                same time.
              </span>
            </li>
            <li>
              <Sparkles size={14} />
              <span>
                <strong>Streak Multipliers</strong>: 3 in a row unlocks 1.5×, 5
                unlocks 2× XP.
              </span>
            </li>
            <li>
              <Users size={14} />
              <span>
                <strong>3 Hearts</strong>: A wrong answer or timeout costs 1
                heart. Last survivors take the podium!
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
                <span>Start Arena Match ({players.length} Players)</span>
              </Button>
            ) : (
              <Button
                variant={currentPlayer.isReady ? "outline" : "dark"}
                className="ready-toggle-cta"
                onClick={onToggleReady}
              >
                <Check size={16} />
                <span>
                  {currentPlayer.isReady ? "Cancel Ready" : "I’m Ready!"}
                </span>
              </Button>
            )}
            <p className="host-caption">
              {isHost
                ? "Once started, all players transition into the synchronized countdown."
                : "Waiting for the arena host to begin the countdown."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
