"use client";

import { useEffect, useState, useMemo } from "react";
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
  Heart,
  Clock3,
  Bot,
  Trophy,
  ArrowUpRight,
} from "lucide-react";
import { AVATAR_OPTIONS, type ArenaRoomState } from "@/lib/schemas/multiplayer";
import type { StudyPack } from "@/lib/schemas/question";
import { readLibrary, LIBRARY_UPDATED_EVENT, type SavedStudyItem } from "@/lib/game/library";
import { normalizeTopicKey } from "@/lib/game/concept-mastery";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";
import { useUserTier } from "@/hooks/use-user-tier";
import { PricingModal } from "@/components/pricing/pricing-modal";
import { TutorialDialog } from "@/components/tutorial/tutorial-dialog";

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
    maxPlayers?: number;
  }) => Promise<string | null>;
  openRooms?: ArenaRoomState[];
  presetPack?: StudyPack | null;
}) {
  const { t } = useLanguage();
  const { tier, limits, unlockedRemixRuns, consumeRemixRun } = useUserTier();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingReason, setPricingReason] = useState<string | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const presetPack = presetPackProp;
  const [tab, setTab] = useState<"join" | "create">("create");
  const [nickname, setNickname] = useState("ClutchStudent");
  const [avatar, setAvatar] = useState("⚡");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<"exact" | "variants">("exact");
  const [libraryItems, setLibraryItems] = useState<SavedStudyItem[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string>(() => {
    if (presetPack) return "preset";
    const items = readLibrary();
    return items.length > 0 ? items[0].id : "";
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Hide the library copy of the preset pack so it isn't listed twice.
    const update = () => {
      const items = readLibrary().filter((i) => i.id !== presetPack?.id);
      setLibraryItems(items);
      setSelectedPackId((prev) => {
        if (presetPack) return "preset";
        if (prev && items.some((i) => i.id === prev)) return prev;
        return items.length > 0 ? items[0].id : "";
      });
    };
    update();
    window.addEventListener(LIBRARY_UPDATED_EVENT, update);
    return () => window.removeEventListener(LIBRARY_UPDATED_EVENT, update);
  }, [presetPack]);

  const selectedPack = useMemo(() => {
    if (selectedPackId === "preset") return presetPack;
    const found = libraryItems.find((i) => i.id === selectedPackId);
    return found ? found.pack : presetPack;
  }, [selectedPackId, presetPack, libraryItems]);

  const uniqueConcepts = useMemo(() => {
    if (!selectedPack) return [];
    const seen = new Set<string>();
    const list: Array<{ id: string; topic: string; chapter?: string; questionCount: number }> = [];
    selectedPack.questions.forEach((q) => {
      const meta = selectedPack.metadata?.[q.id];
      const topicName = meta?.topic || "Khái niệm chung";
      const key = normalizeTopicKey(topicName);
      if (!seen.has(key)) {
        seen.add(key);
        const count = selectedPack.questions.filter(
          (otherQ) => normalizeTopicKey(selectedPack.metadata?.[otherQ.id]?.topic || "") === key,
        ).length;
        list.push({
          id: q.id,
          topic: topicName,
          chapter: meta?.chapter,
          questionCount: count,
        });
      }
    });
    return list;
  }, [selectedPack]);

  const handleJoin = async (codeToJoin?: string) => {
    const targetCode = (codeToJoin || roomCode).trim().toUpperCase();
    if (!targetCode) {
      setError(t.arena.enterCodeError);
      return;
    }
    if (!nickname.trim()) {
      setError(t.arena.enterNicknameError);
      return;
    }

    setError(null);
    setSubmitting(true);
    const success = await onJoinRoom(targetCode, nickname.trim(), avatar);
    setSubmitting(false);
    if (!success) {
      setError(t.arena.joinFailedError);
    }
  };

  const handleCreate = async () => {
    if (!nickname.trim()) {
      setError(t.arena.enterNicknameError);
      return;
    }

    setError(null);
    setSubmitting(true);

    let chosenPack: StudyPack | null = null;
    if (selectedPackId === "preset" && presetPack) {
      chosenPack = presetPack;
    } else {
      const saved = libraryItems.find((i) => i.id === selectedPackId);
      if (saved) chosenPack = saved.pack;
    }

    if (!chosenPack) {
      setError(t.arena.selectPackError);
      setSubmitting(false);
      return;
    }

    if (mode === "variants" && !limits.canHostArenaRemix) {
      if (unlockedRemixRuns > 0) {
        consumeRemixRun();
      } else {
        setPricingReason(t.arena.hostPrivilegesNotice);
        setPricingOpen(true);
        setSubmitting(false);
        return;
      }
    }

    const code = await onCreateRoom({
      nickname: nickname.trim(),
      avatar,
      mode,
      title: `${chosenPack.title} Arena`.slice(0, 100),
      pack: chosenPack,
      maxPlayers: limits.maxArenaPlayers,
    });
    setSubmitting(false);
    if (!code) {
      setError(t.arena.createFailedError);
    }
  };

  return (
    <div className="arena-entrance-container w-full">
      {/* Top Banner: Host privileges */}
      <div className="p-3.5 rounded-xl bg-orange-50/80 border border-orange-200/80 text-xs text-orange-950 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-orange-900 flex items-center gap-1.5">
            <Zap size={14} className="text-[#ea580c]" fill="currentColor" />
            {t.arena.hostPaysTitle}
          </span>
          <span className="text-stone-600">{t.arena.hostPaysDesc}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setPricingReason(null);
            setPricingOpen(true);
          }}
          className="text-xs font-bold underline shrink-0 text-[#ea580c] hover:text-orange-700 cursor-pointer"
        >
          {t.arena.viewTiersBtn}
        </button>
      </div>

      <div className="setup-grid">
        {/* Left Column: The Main Arena Card */}
        <div className="arena-card setup-card surface space-y-6">
          {/* Profile customizer */}
          <div className="arena-profile-row">
            <div className="arena-avatar-picker">
              <span className="field-label text-xs font-semibold text-stone-700">{t.arena.avatarLabel}</span>
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
              <label htmlFor="arena-nickname" className="field-label text-xs font-semibold text-stone-700">
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
            <div className="arena-create-form space-y-5">
              <div>
                <label className="text-xs font-semibold text-stone-700 mb-2 block">
                  {t.arena.selectPack}
                </label>
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
                        className="sr-only"
                      />
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="pack-select-icon">
                          <FileCheck size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <strong className="truncate">{presetPack.title}</strong>
                          <small data-testid="arena-preset-pack">
                            {presetPack.questions.length} {t.arena.questionsUnit} · {t.arena.currentPack}
                          </small>
                        </div>
                      </div>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        selectedPackId === "preset" ? "border-[#ea580c]" : "border-stone-300"
                      }`}>
                        {selectedPackId === "preset" && <div className="w-2 h-2 rounded-full bg-[#ea580c]" />}
                      </div>
                    </label>
                  )}
                  {!presetPack && libraryItems.length === 0 && (
                    <div className="py-6 px-4 text-center text-xs text-stone-600 border border-dashed border-stone-200 rounded-xl my-2">
                      <p className="font-semibold text-stone-800 mb-1">{t.arena.noPacksTitle}</p>
                      <p>{t.arena.noPacksDesc}</p>
                    </div>
                  )}

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
                        className="sr-only"
                      />
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="pack-select-icon">
                          <Layers3 size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <strong className="truncate">{item.title}</strong>
                          <small>{item.questionCount} {t.arena.questionsUnit} · {t.arena.userLibrary}</small>
                        </div>
                      </div>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        selectedPackId === item.id ? "border-[#ea580c]" : "border-stone-300"
                      }`}>
                        {selectedPackId === item.id && <div className="w-2 h-2 rounded-full bg-[#ea580c]" />}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-stone-700 mb-2 block">
                  {t.arena.practiceMode}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    role="button"
                    tabIndex={0}
                    className={`mode-btn cursor-pointer ${mode === "exact" ? "active" : ""}`}
                    onClick={() => setMode("exact")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setMode("exact");
                    }}
                  >
                    <strong>{t.arena.classicRecall}</strong>
                    <span className="text-xs text-stone-500">{t.arena.classicRecallDesc}</span>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`mode-btn cursor-pointer ${mode === "variants" ? "active" : ""}`}
                    onClick={() => {
                      if (!limits.canHostArenaRemix && unlockedRemixRuns === 0) {
                        setPricingReason(t.arena.hostPrivilegesNotice);
                        setPricingOpen(true);
                        return;
                      }
                      setMode("variants");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        if (!limits.canHostArenaRemix && unlockedRemixRuns === 0) {
                          setPricingReason(t.arena.hostPrivilegesNotice);
                          setPricingOpen(true);
                          return;
                        }
                        setMode("variants");
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Sparkles size={14} className="text-[#ea580c]" />
                      <strong>{t.arena.conceptRemix}</strong>
                      {!limits.canHostArenaRemix && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-stone-900 text-white ml-auto">
                          {unlockedRemixRuns > 0 ? `${unlockedRemixRuns} ${t.arena.passSuffix}` : t.arena.proBadge}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-stone-500">{t.arena.conceptRemixDesc}</span>
                  </div>
                </div>
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
            <div className="arena-join-form space-y-4">
              <div>
                <label htmlFor="arena-code" className="text-xs font-semibold text-stone-700 mb-2 block">
                  {t.arena.roomCodeLabel}
                </label>
                <div className="code-input-row flex items-center gap-2">
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
                    placeholder={t.arena.roomCodePlaceholder}
                    className="text-input arena-code-input flex-1"
                  />
                  <Button onClick={() => handleJoin()} disabled={submitting} className="h-10 px-4">
                    <LogIn size={15} />
                    <span>{t.arena.joinBtn}</span>
                  </Button>
                </div>
              </div>

              <div className="open-rooms-section pt-3 border-t border-stone-100">
                <span className="field-label text-xs font-semibold text-stone-700 mb-2 block">
                  {t.arena.openLobbies}
                </span>
                {openRooms.length > 0 ? (
                  <div className="open-rooms-list space-y-2">
                    {openRooms.map((r) => (
                      <div
                        key={r.code}
                        className="open-room-item flex items-center justify-between p-3 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 cursor-pointer transition-colors"
                        onClick={() => handleJoin(r.code)}
                      >
                        <div className="min-w-0 flex-1 mr-3">
                          <strong className="block text-sm font-bold text-stone-900 truncate">{r.title}</strong>
                          <small className="text-xs text-stone-500">
                            {t.arena.codeLabel} <b>{r.code}</b> · {Object.keys(r.players).length}{" "}
                            {t.arena.playersWord}
                          </small>
                        </div>
                        <Button size="sm" variant="outline">
                          {t.arena.joinBtn}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="open-rooms-empty p-6 text-center text-xs text-stone-500 border border-dashed border-stone-200 rounded-xl flex flex-col items-center gap-1.5">
                    <Users size={18} className="text-stone-400" />
                    <span>{t.arena.noOpenLobbies}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="arena-feature-footer pt-4 border-t border-stone-100 flex items-center justify-center gap-3 text-xs text-stone-500 font-medium flex-wrap">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-600" />
              {t.arena.serverVerified}
            </span>
            <span className="text-stone-300">•</span>
            <span className="flex items-center gap-1.5">
              <Users size={14} className="text-amber-600" />
              {t.arena.botsSupported}
            </span>
            <span className="text-stone-300">•</span>
            <span className="flex items-center gap-1.5">
              <Zap size={14} className="text-[#ea580c]" />
              {t.arena.liveSync}
            </span>
          </div>
        </div>

        {/* Right Column: Arena Battle HUD & Concepts Intel */}
        <aside className="setup-aside space-y-4">
          {/* Card 1: Khái niệm trong phòng đấu */}
          <section className="how-card deck-intel-card rounded-2xl bg-white border border-stone-200/80 p-5 shadow-xs">
            <div className="deck-intel-header">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-stone-600">
                  Khái niệm trong phòng đấu
                </span>
                <span className="text-[11px] font-semibold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-md border border-stone-200/60">
                  {uniqueConcepts.length} khái niệm
                </span>
              </div>
              <div className="text-[11px] text-stone-500 mt-1 truncate">
                {selectedPack ? selectedPack.title : t.arena.noPacksTitle}
              </div>
              <div className="deck-intel-progress-track w-full h-1.5 rounded-full bg-stone-100 mt-2.5 overflow-hidden">
                <div
                  className="deck-intel-progress-fill h-full bg-[#ea580c] rounded-full"
                  style={{ width: `${Math.min(100, Math.max(15, uniqueConcepts.length * 15))}%` }}
                />
              </div>
            </div>

            {uniqueConcepts.length > 0 ? (
              <div className="topic-list mt-3.5 divide-y divide-stone-100 rounded-xl border border-stone-200/70 overflow-hidden bg-white">
                {uniqueConcepts.slice(0, 6).map((concept, i) => (
                  <div
                    key={concept.topic}
                    className="topic-item flex items-center justify-between gap-2.5 px-3 py-2 text-xs hover:bg-stone-50/70 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="topic-index text-[11px] font-mono font-medium text-stone-400 w-4 shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="topic-item-title font-medium text-stone-800 truncate" title={concept.topic}>
                        {concept.topic}
                      </span>
                    </div>
                    <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-md border bg-stone-100 text-stone-600 border-stone-200/60 shrink-0">
                      {concept.questionCount} câu
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-stone-500 border border-dashed border-stone-200 rounded-xl mt-3">
                Chưa có câu hỏi nào trong bộ đề đã chọn.
              </div>
            )}
          </section>

          {/* Card 2: Luật đấu trường & Cơ chế thi đấu */}
          <section className="how-card deck-intel-card rounded-2xl bg-white border border-stone-200/80 p-5 shadow-xs">
            <div className="text-xs font-semibold text-stone-600 mb-2.5">
              Luật đấu trường & Cơ chế thi đấu
            </div>
            <div className="arena-rules-grid grid grid-cols-3 gap-2">
              <div className="rule-tile py-2 px-1 rounded-lg bg-stone-50 border border-stone-200/60 text-center flex flex-col items-center gap-0.5">
                <Heart size={14} className="text-rose-500" />
                <strong className="text-xs font-bold text-stone-800">{t.run.livesCount}</strong>
                <span className="text-[10px] text-stone-400">Trượt 3 lần</span>
              </div>
              <div className="rule-tile py-2 px-1 rounded-lg bg-stone-50 border border-stone-200/60 text-center flex flex-col items-center gap-0.5">
                <Clock3 size={14} className="text-amber-500" />
                <strong className="text-xs font-bold text-stone-800">{t.run.timerCount}</strong>
                <span className="text-[10px] text-stone-400">15s/câu</span>
              </div>
              <div className="rule-tile py-2 px-1 rounded-lg bg-stone-50 border border-stone-200/60 text-center flex flex-col items-center gap-0.5">
                <Flame size={14} className="text-orange-500" />
                <strong className="text-xs font-bold text-stone-800">{t.run.streakBonus}</strong>
                <span className="text-[10px] text-stone-400">Nhân điểm</span>
              </div>
            </div>

            <div className="mt-3.5 space-y-2 pt-3 border-t border-stone-100 text-[11.5px] text-stone-600">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                <span>Chấm điểm máy chủ chống gian lận thời gian thực</span>
              </div>
              <div className="flex items-center gap-2">
                <Bot size={14} className="text-amber-600 shrink-0" />
                <span>Tự động thêm Bot AI khi luyện tập solo</span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy size={14} className="text-[#ea580c] shrink-0" />
                <span>Thưởng +50 XP khi trả lời đúng dưới 5 giây</span>
              </div>
            </div>

            <button
              type="button"
              className="learn-link mt-3.5 flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-orange-600 transition-colors cursor-pointer"
              onClick={() => setTutorialOpen(true)}
            >
              <span>{t.run.howToPlay}</span>
              <ArrowUpRight size={13} />
            </button>
          </section>
        </aside>
      </div>

      <TutorialDialog
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
      />
      <PricingModal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        initialReason={pricingReason}
      />
    </div>
  );
}
