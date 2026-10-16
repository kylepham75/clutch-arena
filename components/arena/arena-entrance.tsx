"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Zap,
  ArrowRight,
  Sparkles,
  Layers3,
  Flame,
  ShieldCheck,
  Plus,
  LogIn,
  FileCheck,
} from "lucide-react";
import { AVATAR_OPTIONS, type ArenaRoomState } from "@/lib/schemas/multiplayer";
import type { StudyPack } from "@/lib/schemas/question";
import { readLibrary, type SavedStudyItem } from "@/lib/game/library";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

export function ArenaEntrance({
  onJoinRoom,
  onCreateRoom,
  openRooms = [],
  presetPack: presetPackProp = null,
}: {
  onJoinRoom: (code: string, nickname: string, avatar: string) => Promise<boolean>;
  onCreateRoom: (params: {
    nickname: string;
    avatar: string;
    mode: "exact" | "variants";
    title?: string;
    pack?: any;
  }) => Promise<string | null>;
  openRooms?: ArenaRoomState[];
  presetPack?: StudyPack | null;
}) {
  const { t } = useLanguage();
  // The sample pack already has its own row.
  const presetPack =
    presetPackProp && presetPackProp.id !== mockMicroeconomics.id ? presetPackProp : null;
  const [tab, setTab] = useState<"join" | "create">("create");
  const [nickname, setNickname] = useState("ClutchStudent");
  const [avatar, setAvatar] = useState("⚡");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<"exact" | "variants">("exact");
  const [selectedPackId, setSelectedPackId] = useState(presetPack ? "preset" : "mock");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<SavedStudyItem[]>([]);

  useEffect(() => {
    // Hide the library copy of the preset pack so it isn't listed twice.
    setLibraryItems(readLibrary().filter((i) => i.id !== presetPack?.id));
  }, [presetPack?.id]);

  useEffect(() => {
    if (presetPack) setSelectedPackId("preset");
  }, [presetPack]);

  const handleJoin = async (codeToJoin?: string) => {
    const targetCode = (codeToJoin || roomCode).trim().toUpperCase();
    if (!targetCode) {
      setError("Please enter a room code.");
      return;
    }
    if (!nickname.trim()) {
      setError("Please enter a nickname.");
      return;
    }

    setError(null);
    setSubmitting(true);
    const success = await onJoinRoom(targetCode, nickname.trim(), avatar);
    setSubmitting(false);
    if (!success) {
      setError("Could not join room. Check code or room may have already started.");
    }
  };

  const handleCreate = async () => {
    if (!nickname.trim()) {
      setError("Please enter a nickname.");
      return;
    }

    setError(null);
    setSubmitting(true);

    let chosenPack: StudyPack = mockMicroeconomics;
    if (selectedPackId === "preset" && presetPack) {
      chosenPack = presetPack;
    } else if (selectedPackId !== "mock") {
      const saved = libraryItems.find((i) => i.id === selectedPackId);
      if (saved) chosenPack = saved.pack;
    }

    const code = await onCreateRoom({
      nickname: nickname.trim(),
      avatar,
      mode,
      title: `${chosenPack.title} Arena`.slice(0, 100),
      pack: chosenPack,
    });
    setSubmitting(false);
    if (!code) {
      setError("Could not create arena room. Please try again.");
    }
  };

  return (
    <div className="arena-entrance-container">
      <div className="arena-hero">
        <div className="arena-badge">
          <Flame size={14} />
          <span>{t.arena.badge}</span>
        </div>
        <h2>{t.arena.heroTitle}</h2>
        <p>
          {t.arena.heroDesc}
        </p>
      </div>

      <div className="arena-card surface">
        {/* Profile customizer */}
        <div className="arena-profile-row">
          <div className="arena-avatar-picker">
            <span className="field-label">{t.arena.avatarLabel}</span>
            <div className="avatar-options">
              {AVATAR_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`avatar-chip ${avatar === opt ? "selected" : ""}`}
                  onClick={() => setAvatar(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="arena-nickname-field">
            <label htmlFor="arena-nickname" className="field-label">
              {t.arena.nicknameLabel}
            </label>
            <input
              id="arena-nickname"
              type="text"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="text-input arena-nickname-input"
              placeholder={t.arena.nicknamePlaceholder}
            />
          </div>
        </div>

        {/* Tab switch: Create vs Join */}
        <div className="arena-tabs">
          <button
            type="button"
            className={`arena-tab ${tab === "create" ? "active" : ""}`}
            onClick={() => {
              setTab("create");
              setError(null);
            }}
          >
            <Plus size={16} />
            <span>{t.arena.createTab}</span>
          </button>
          <button
            type="button"
            className={`arena-tab ${tab === "join" ? "active" : ""}`}
            onClick={() => {
              setTab("join");
              setError(null);
            }}
          >
            <LogIn size={16} />
            <span>{t.arena.joinTab}</span>
          </button>
        </div>

        {error && <div className="arena-error-banner">{error}</div>}

        {tab === "create" ? (
          <div className="arena-create-form">
            <div className="field-label">{t.arena.selectPack}</div>
            <div className="arena-pack-selector">
              {presetPack && (
                <label
                  className={`pack-select-item pack-select-preset ${selectedPackId === "preset" ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="pack"
                    value="preset"
                    checked={selectedPackId === "preset"}
                    onChange={() => setSelectedPackId("preset")}
                  />
                  <span className="pack-select-icon">
                    <FileCheck size={16} />
                  </span>
                  <div>
                    <strong>{presetPack.title}</strong>
                    <small data-testid="arena-preset-pack">
                      {presetPack.questions.length} {t.library.questionsCount} · {t.arena.currentPack}
                    </small>
                  </div>
                </label>
              )}
              <label
                className={`pack-select-item ${selectedPackId === "mock" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="pack"
                  value="mock"
                  checked={selectedPackId === "mock"}
                  onChange={() => setSelectedPackId("mock")}
                />
                <span className="pack-select-icon">
                  <Zap size={16} />
                </span>
                <div>
                  <strong>{mockMicroeconomics.title}</strong>
                  <small>
                    {mockMicroeconomics.questions.length} {t.library.questionsCount} · {t.arena.samplePack}
                  </small>
                </div>
              </label>

              {libraryItems.map((item) => (
                <label
                  key={item.id}
                  className={`pack-select-item ${selectedPackId === item.id ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="pack"
                    value={item.id}
                    checked={selectedPackId === item.id}
                    onChange={() => setSelectedPackId(item.id)}
                  />
                  <span className="pack-select-icon">
                    <Layers3 size={16} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.questionCount} {t.library.questionsCount} · {t.arena.userLibrary}</small>
                  </div>
                </label>
              ))}
            </div>

            <div className="field-label" style={{ marginTop: 16 }}>
              {t.arena.practiceMode}
            </div>
            <div className="arena-mode-grid">
              <button
                type="button"
                className={`mode-btn ${mode === "exact" ? "active" : ""}`}
                onClick={() => setMode("exact")}
              >
                <strong>{t.arena.classicRecall}</strong>
                <span>{t.arena.classicRecallDesc}</span>
              </button>
              <button
                type="button"
                className={`mode-btn ${mode === "variants" ? "active" : ""}`}
                onClick={() => setMode("variants")}
              >
                <Sparkles size={14} />
                <strong>{t.arena.conceptRemix}</strong>
                <span>{t.arena.conceptRemixDesc}</span>
              </button>
            </div>

            <Button
              className="arena-cta-btn"
              onClick={handleCreate}
              disabled={submitting}
            >
              <Zap size={16} fill="currentColor" />
              <span>{submitting ? t.arena.creatingBtn : t.arena.launchBtn}</span>
              <ArrowRight size={16} />
            </Button>
          </div>
        ) : (
          <div className="arena-join-form">
            <label htmlFor="arena-code" className="field-label">
              {t.arena.roomCodeLabel}
            </label>
            <div className="code-input-row">
              <input
                id="arena-code"
                type="text"
                maxLength={6}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleJoin();
                  }
                }}
                placeholder="CLUTCH"
                className="text-input arena-code-input"
              />
              <Button onClick={() => handleJoin()} disabled={submitting}>
                <LogIn size={15} />
                <span>{t.arena.joinBtn}</span>
              </Button>
            </div>

            <div className="open-rooms-section">
              <span className="field-label">{t.arena.openLobbies}</span>
              {openRooms.length > 0 ? (
                <div className="open-rooms-list">
                  {openRooms.map((r) => (
                    <div
                      key={r.code}
                      className="open-room-item"
                      onClick={() => handleJoin(r.code)}
                    >
                      <div>
                        <strong>{r.title}</strong>
                        <small>
                          Code: <b>{r.code}</b> · {Object.keys(r.players).length}{" "}
                          player(s)
                        </small>
                      </div>
                      <Button size="sm" variant="outline">
                        {t.arena.joinBtn}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="open-rooms-empty">
                  <Users size={15} />
                  <span>{t.arena.noOpenLobbies}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="arena-feature-footer">
          <span>
            <ShieldCheck size={14} />
            {t.arena.serverVerified}
          </span>
          <span>·</span>
          <span>
            <Users size={14} />
            {t.arena.botsSupported}
          </span>
          <span>·</span>
          <span>
            <Zap size={14} />
            {t.arena.liveSync}
          </span>
        </div>
      </div>
    </div>
  );
}
