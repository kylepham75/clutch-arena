"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, MotionConfig, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileSpreadsheet,
  FileText,
  Flame,
  Heart,
  Keyboard,
  Layers3,
  Lightbulb,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
  Share2,
  FolderSync,
  Compass,
  Upload,
  MessageSquarePlus,
} from "lucide-react";
import type { StudyPack } from "@/lib/schemas/question";
import { activeQuestion } from "@/lib/game/reducer";
import { readHistory, saveRun, type SavedRun } from "@/lib/game/history";
import { useSoloGame } from "@/hooks/use-solo-game";
import { useGameKeyboard } from "@/hooks/use-game-keyboard";
import { useGameAudio } from "@/hooks/use-game-audio";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { GameHud } from "./game-hud";
import { TimerBar } from "./timer-bar";
import { QuestionCard } from "./question-card";
import { FeedbackCard } from "./feedback-card";
import { RunSummary } from "./run-summary";
import { DocumentViewer } from "@/components/workspace/document-viewer";
import { UploadPanel } from "@/components/workspace/upload-panel";
import { CoachPanel } from "@/components/workspace/coach-panel";
import { ClutchNotesPanel } from "@/components/notes/clutch-notes-panel";
import { LibraryDialog } from "@/components/workspace/library-dialog";
import { PackShareDialog } from "@/components/workspace/pack-share-dialog";
import { FlashcardReview } from "@/components/quiz/flashcard-review";
import { ArenaManager } from "@/components/arena/arena-manager";
import { useLanguage } from "@/lib/i18n/context";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { UserProfileButton } from "@/components/auth/user-profile-button";
import { readLibrary, saveStudyItem, LIBRARY_UPDATED_EVENT, type SavedStudyItem } from "@/lib/game/library";
import {
  readShareToken,
  decodeSharedPack,
  documentFromPack,
  printStudyGuide,
} from "@/lib/game/pack-transfer";
import {
  readMasteryStore,
  recordRunMastery,
  getMasteryLevel,
  getWeakSpotsForPack,
  createWeakSpotSprintPack,
  normalizeTopicKey,
  type ConceptStats,
} from "@/lib/game/concept-mastery";
import { mockMicroeconomicsDoc, mockMicroeconomics } from "@/data/mock-microeconomics";
import { TutorialDialog, isTutorialCompleted } from "@/components/tutorial/tutorial-dialog";
import { useUserTier } from "@/hooks/use-user-tier";
import { PricingModal } from "@/components/pricing/pricing-modal";
import { FeedbackDialog } from "@/components/workspace/feedback-dialog";
import type { FeedbackCategory } from "@/lib/schemas/telemetry";
import type { ParsedDocument } from "@/lib/schemas/ingestion";
import type { CoachFocus } from "@/lib/schemas/coach";

type Panel = "help" | "progress" | "leave" | null;

export function SoloEngine({
  pack: initialPack,
  initialDoc,
}: {
  pack?: StudyPack;
  initialDoc?: ParsedDocument;
} = {}) {
  const { language, t } = useLanguage();
  const { tier, limits, unlockedRemixRuns, consumeRemixRun } = useUserTier();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingReason, setPricingReason] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [libraryItems, setLibraryItems] = useState<SavedStudyItem[]>([]);
  const [pack, setPack] = useState<StudyPack | null>(() => initialPack ?? null);
  const [document, setDocument] = useState<ParsedDocument | null>(() => initialDoc ?? null);
  const [activeTab, setActiveTab] = useState<"play" | "ingest" | "coach" | "arena" | "notes">("play");
  const [showDocViewer, setShowDocViewer] = useState(false);
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null);
  const [highlightedExcerpt, setHighlightedExcerpt] = useState<string | null>(null);
  const [coachFocus, setCoachFocus] = useState<CoachFocus | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSeed, setFeedbackSeed] = useState<{
    category?: FeedbackCategory;
    questionId?: string;
    citation?: string;
  } | null>(null);

  // Prompt tutorial for first-time visitors / new accounts
  useEffect(() => {
    if (!isTutorialCompleted()) {
      setTutorialOpen(true);
    }
  }, []);

  useEffect(() => {
    const update = () => setLibraryItems(readLibrary());
    update();
    window.addEventListener(LIBRARY_UPDATED_EVENT, update);
    return () => window.removeEventListener(LIBRARY_UPDATED_EVENT, update);
  }, [libraryOpen]);

  // If no pack is active and library items exist, automatically select the first
  useEffect(() => {
    if (!pack && libraryItems.length > 0 && libraryItems[0].pack) {
      setPack(libraryItems[0].pack);
      if (libraryItems[0].document) {
        setDocument(libraryItems[0].document);
      }
    }
  }, [libraryItems, pack]);

  const availablePacks = useMemo(() => {
    const list: Array<{
      id: string;
      title: string;
      questionCount: number;
      pack: StudyPack;
      document?: ParsedDocument;
    }> = [];

    for (const item of libraryItems) {
      if (item.pack) {
        list.push({
          id: item.pack.id,
          title: item.title || item.pack.title,
          questionCount: item.pack.questions.length,
          pack: item.pack,
          document: item.document,
        });
      }
    }

    if (pack && !list.some((p) => p.id === pack.id)) {
      list.push({
        id: pack.id,
        title: pack.title,
        questionCount: pack.questions.length,
        pack,
        document: document || undefined,
      });
    }

    return list;
  }, [libraryItems, pack, document]);

  // Auto-load pack if URL contains #pack=<token> or ?pack=<token>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = readShareToken(window.location.hash, window.location.search);
    if (!token) return;
    void decodeSharedPack(token)
      .then((sharedPack) => {
        setPack(sharedPack);
        const doc = documentFromPack(sharedPack);
        setDocument(doc);
        saveStudyItem({
          id: sharedPack.id,
          title: sharedPack.title,
          createdAt: new Date().toISOString(),
          questionCount: sharedPack.questions.length,
          format: "txt",
          fileName: `${sharedPack.title}.clutch.json`,
          pack: sharedPack,
          document: doc,
        });
        const searchParams = new URLSearchParams(window.location.search);
        searchParams.delete("pack");
        const cleanSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
        window.history.replaceState(
          null,
          "",
          window.location.pathname + cleanSearch,
        );
      })
      .catch((err) => {
        console.warn("Could not load shared pack from URL:", err);
      });
  }, []);

  const { state, dispatch, answer, next } = useSoloGame(pack ? pack.questions : []);
  const audio = useGameAudio();
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<"exact" | "variants">("exact");
  const [panel, setPanel] = useState<Panel>(null);
  const [history, setHistory] = useState<SavedRun[]>([]);
  const [masteryStore, setMasteryStore] = useState<Record<string, ConceptStats>>({});
  const basePackRef = useRef<StudyPack | null>(pack);
  const [progressTab, setProgressTab] = useState<"runs" | "mastery">("runs");

  useEffect(() => {
    if (pack && !pack.id.endsWith("-weak-spots")) {
      basePackRef.current = pack;
    }
  }, [pack]);

  const prevInitialPackId = useRef(initialPack?.id);
  useEffect(() => {
    if (initialPack && initialPack.id !== prevInitialPackId.current) {
      prevInitialPackId.current = initialPack.id;
      setPack(initialPack);
      if (initialDoc) setDocument(initialDoc);
    }
  }, [initialPack, initialDoc]);

  const pendingSprintStart = useRef(false);
  useEffect(() => {
    if (pack) {
      dispatch({ type: "LOAD_PACK", questions: pack.questions });
      soundAttempt.current = 0;
      saved.current = false;
      if (pendingSprintStart.current) {
        pendingSprintStart.current = false;
        void audio.unlock();
        audio.play("start");
        runId.current = crypto.randomUUID();
        dispatch({ type: "START", mode: "exact", now: Date.now() });
        window.scrollTo(0, 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, dispatch]);

  const handleLoadSamplePack = useCallback(() => {
    setPack(mockMicroeconomics);
    setDocument(mockMicroeconomicsDoc);
  }, []);
  const soundAttempt = useRef(0);
  const saved = useRef(false);
  const runId = useRef("");
  const current = activeQuestion(state);
  const attempt =
    state.phase === "feedback" ? state.attempts.at(-1) : undefined;
  const inRun = ["answering", "feedback", "paused"].includes(state.phase);
  const totalXp = history.reduce((sum, item) => sum + item.score, 0);

  useEffect(() => {
    setHistory(readHistory());
    setMasteryStore(readMasteryStore());
  }, []);
  useEffect(() => {
    if (state.attempts.length <= soundAttempt.current) return;
    soundAttempt.current = state.attempts.length;
    const latest = state.attempts.at(-1)!;
    audio.play(
      latest.correct
        ? [3, 5, 7].includes(state.streak)
          ? "streak"
          : "correct"
        : "wrong",
    );
  }, [state.attempts, state.streak, audio.play]);
  useEffect(() => {
    if (state.phase !== "finished" || saved.current) return;
    saved.current = true;
    setHistory(
      saveRun({
        id: runId.current,
        date: new Date().toISOString(),
        score: state.score,
        correct: state.attempts.filter((a) => a.correct).length,
        total: state.attempts.length,
        bestStreak: state.bestStreak,
      }),
    );
    if (pack) {
      const updated = recordRunMastery(pack, state.attempts);
      setMasteryStore(updated);
    }
    audio.play("finish");
    if (state.lives > 0 && !reducedMotion) {
      void import("canvas-confetti")
        .then(({ default: confetti }) =>
          confetti({
            particleCount: 90,
            spread: 75,
            origin: { y: 0.55 },
            colors: ["#ee714c", "#f3c77b", "#66876a"],
            disableForReducedMotion: true,
          }),
        )
        .catch(() => {});
    }
  }, [state, pack, reducedMotion, audio.play]);
  useEffect(() => {
    if (!inRun) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [inRun]);

  const openLibrary = useCallback(() => {
    if (state.phase === "answering")
      dispatch({ type: "PAUSE", now: Date.now() });
    setLibraryOpen(true);
  }, [state.phase, dispatch]);

  const openPanel = (value: Panel) => {
    if (state.phase === "answering")
      dispatch({ type: "PAUSE", now: Date.now() });
    setPanel(value);
  };
  const closePanel = (open: boolean) => {
    if (!open) {
      setPanel(null);
      if (state.phase === "paused")
        dispatch({ type: "RESUME", now: Date.now() });
    }
  };
  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    setPanel(null);
    soundAttempt.current = 0;
    saved.current = false;
    window.scrollTo(0, 0);
  }, [dispatch]);
  const start = () => {
    if (!pack || !pack.questions.length) return;

    if (mode === "variants" && !limits.canUseConceptRemix) {
      if (unlockedRemixRuns > 0) {
        consumeRemixRun();
      } else {
        setPricingReason(
          language === "vi"
            ? "Chế độ Biến thể Concept Remix yêu cầu Vé Ôn Thi Cấp Tốc (Cram Pass) hoặc Clutch Pro."
            : "Concept Remix mode requires a 7-Day Cram Pass or Clutch Pro, or unlock free runs with Referrals!",
        );
        setPricingOpen(true);
        return;
      }
    }

    const cappedCount = Math.min(questionCount, limits.maxQuestionsPerRun, pack.questions.length);
    if (cappedCount < pack.questions.length) {
      dispatch({ type: "LOAD_PACK", questions: pack.questions.slice(0, cappedCount) });
    }

    void audio.unlock();
    audio.play("start");
    runId.current = crypto.randomUUID();
    dispatch({ type: "START", mode, now: Date.now() });
    window.scrollTo(0, 0);
  };

  const handleExportCheatSheet = useCallback(() => {
    if (!limits.canExportCheatSheet) {
      setPricingReason(
        language === "vi"
          ? "Xuất cẩm nang Cheat Sheet PDF kèm trích dẫn nguyên văn yêu cầu Vé Ôn Thi Cấp Tốc hoặc Clutch Pro."
          : "1-Click PDF Cheat Sheet export of missed questions and verbatim citations requires a 7-Day Cram Pass or Clutch Pro.",
      );
      setPricingOpen(true);
      return;
    }
    if (pack) {
      printStudyGuide(pack, state.missed.length > 0 ? state.missed : undefined);
    }
  }, [limits.canExportCheatSheet, pack, state.missed, language]);

  const handleLaunchWeakSpotSprint = useCallback(() => {
    if (!basePackRef.current) return;
    const sprintPack = createWeakSpotSprintPack(basePackRef.current, 5, masteryStore);
    pendingSprintStart.current = true;
    setPack(sprintPack);
    setPanel(null);
  }, [masteryStore]);

  const handleRestoreBasePack = useCallback(() => {
    if (basePackRef.current) {
      setPack(basePackRef.current);
      reset();
    }
  }, [reset]);

  useGameKeyboard({ enabled: !panel && activeTab === "play", phase: state.phase, answer, next });

  const handleAskCoach = useCallback((focus: CoachFocus) => {
    setCoachFocus(focus);
    setActiveTab("coach");
  }, []);

  const handleCitationClick = useCallback(
    (citationOrId: string, excerpt?: string) => {
      setShowDocViewer(true);
      const directMatch = document?.sources.find((b) => b.id === citationOrId);
      if (directMatch) {
        setHighlightedSourceId(directMatch.id);
      } else {
        const fuzzyMatch = document?.sources.find(
          (b) =>
            b.label.toLowerCase().includes(citationOrId.toLowerCase()) ||
            citationOrId.toLowerCase().includes(b.label.toLowerCase()),
        );
        setHighlightedSourceId(fuzzyMatch ? fuzzyMatch.id : citationOrId);
      }
      if (excerpt) setHighlightedExcerpt(excerpt);
    },
    [document],
  );

  const handleExplainMissWithCoach = useCallback(() => {
    if (!current || !attempt || !pack) return;
    const meta = pack.metadata[current.id];
    const sourceBlock =
      document?.sources.find(
        (b) =>
          meta?.citation &&
          (b.label.includes(meta.citation) || meta.citation.includes(b.label)),
      ) || document?.sources[0];

    handleAskCoach({
      type: "explain",
      question: current.question,
      options: current.options,
      correctIndex: current.correctIndex,
      selected: attempt.selected,
      explanation: current.explanation,
      topic: meta?.topic || "Concept Review",
      rule: meta?.rule || current.explanation,
      sourceId: sourceBlock?.id,
      excerpt: meta?.citation || (sourceBlock ? sourceBlock.text.slice(0, 300) : undefined),
    });
  }, [current, attempt, pack, document, handleAskCoach]);

  const handleDebriefCoach = useCallback(() => {
    if (!pack) return;
    const correctCount = state.attempts.filter((a) => a.correct).length;
    const concepts = pack.questions.map((q) => {
      const meta = pack.metadata[q.id];
      const isMissed = state.missed.includes(q.id);
      const masteryCount = state.mastery[q.id] || 0;
      const status: "needs-review" | "reinforced" | "correct" = isMissed
        ? masteryCount >= 2
          ? "reinforced"
          : "needs-review"
        : "correct";

      const sourceBlock = document?.sources.find(
        (b) =>
          meta?.citation &&
          (b.label.includes(meta.citation) || meta.citation.includes(b.label)),
      );

      return {
        topic: meta?.topic || q.id,
        rule: meta?.rule || q.explanation,
        status,
        sourceId: sourceBlock?.id,
        excerpt: meta?.citation,
      };
    });

    handleAskCoach({
      type: "debrief",
      packTitle: pack.title,
      score: state.score,
      correct: correctCount,
      total: state.attempts.length || pack.questions.length,
      bestStreak: state.bestStreak,
      livesLeft: state.lives,
      concepts,
    });
  }, [state, pack, document, handleAskCoach]);

  const handleSelectPackFromLibrary = useCallback(
    (newPack: StudyPack, newDoc?: ParsedDocument) => {
      setPack(newPack);
      setDocument(newDoc || documentFromPack(newPack, newPack.title));
      setActiveTab("play");
      setLibraryOpen(false);
      reset();
    },
    [reset],
  );

  const handlePackGenerated = useCallback(
    (
      newPack: StudyPack,
      newDoc: ParsedDocument,
      references?: Record<string, any>,
    ) => {
      saveStudyItem({
        id: newPack.id,
        title: newPack.title,
        createdAt: new Date().toISOString(),
        questionCount: newPack.questions.length,
        format: newDoc.format,
        fileName: newDoc.fileName,
        pack: newPack,
        document: newDoc,
        references,
      });
      setPack(newPack);
      setDocument(newDoc);
      setLibraryItems(readLibrary());
    },
    [],
  );

  const handlePlayPack = useCallback(
    (newPack: StudyPack) => {
      setPack(newPack);
      setActiveTab("play");
      reset();
    },
    [reset],
  );

  const handleHostArena = useCallback((targetPack: StudyPack) => {
    setPack(targetPack);
    setActiveTab("arena");
  }, []);

  const handleDocumentPreviewed = useCallback((newDoc: ParsedDocument) => {
    setDocument(newDoc);
    setShowDocViewer(true);
  }, []);

  const completedOriginals = Math.min(
    state.attempts.filter((_, index) => !state.queue[index]?.review).length,
    pack ? pack.questions.length : 0,
  );
  const topics = pack
    ? pack.questions.map((q) => ({
        id: q.id,
        ...pack.metadata[q.id],
      }))
    : [];

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <aside className="sidebar">
          <Link
            href="/"
            className="brand"
            onClick={(event) => {
              if (inRun) {
                event.preventDefault();
                openPanel("leave");
              }
            }}
          >
            <span className="brand-icon brand-icon-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand-icon.png" alt="Clutch Arena" className="brand-logo-img" />
            </span>
            <span>
              clutch<span className="brand-light">arena</span>
              <small>{t.brand.tagline}</small>
            </span>
          </Link>
          <div className="workspace">
            <span className="workspace-avatar">S</span>
            <div>
              <strong>{t.brand.space}</strong>
              <small>{t.brand.subspace}</small>
            </div>
            <ChevronRight size={14} />
          </div>
          <div className="nav-label">{t.nav.workspace}</div>
          <nav aria-label="Main navigation">
            <button
              className={`nav-item ${activeTab === "play" ? "active" : ""}`}
              onClick={() => {
                if (inRun) openPanel("leave");
                else {
                  setActiveTab("play");
                  reset();
                }
              }}
            >
              <Zap size={19} />
              <span>{t.nav.clutchRun}</span>
              {activeTab === "play" && <span className="nav-dot" />}
            </button>
            <button
              className={`nav-item ${activeTab === "ingest" ? "active" : ""}`}
              onClick={() => setActiveTab("ingest")}
            >
              <FileText size={19} />
              <span>{t.nav.uploadNotes}</span>
              {activeTab === "ingest" && <span className="nav-dot" />}
            </button>
            <button
              className={`nav-item ${activeTab === "notes" ? "active" : ""}`}
              onClick={() => setActiveTab("notes")}
            >
              <FileSpreadsheet size={19} />
              <span>{t.nav.clutchNotes || "Clutch Notes AI"}</span>
              <span className="live-pill" style={{ background: "#e96b44", color: "#ffffff", fontWeight: 800, padding: "1px 6px", fontSize: "10px" }}>PRO</span>
              {activeTab === "notes" && <span className="nav-dot" />}
            </button>
            <button
              className={`nav-item ${activeTab === "coach" ? "active" : ""}`}
              onClick={() => setActiveTab("coach")}
            >
              <Sparkles size={19} />
              <span>{t.nav.aiCoach}</span>
              {activeTab === "coach" && <span className="nav-dot" />}
            </button>
            <button className="nav-item" onClick={() => setLibraryOpen(true)}>
              <Layers3 size={19} />
              <span>{t.nav.library}</span>
            </button>
            <button className="nav-item" onClick={() => openPanel("progress")}>
              <Trophy size={19} />
              <span>{t.nav.myProgress}</span>
            </button>
            <button className="nav-item" onClick={() => setTutorialOpen(true)}>
              <Compass size={19} />
              <span>{t.nav.howToPlay}</span>
            </button>
          </nav>
          <div className="nav-label next-label">{t.nav.multiplayer}</div>
          <button
            className={`nav-item ${activeTab === "arena" ? "active" : ""}`}
            onClick={() => setActiveTab("arena")}
          >
            <Users size={19} />
            <span>{t.nav.studyArena}</span>
            <span className="live-pill">{t.nav.live}</span>
          </button>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <span className="note-star">✦</span>
              <h4>
                {t.sidebar.smallSessions}
                <br />
                {t.sidebar.bigComebacks}
              </h4>
              <p>
                {t.sidebar.focusQuote}
              </p>
              <span className="note-line" />
            </div>
            <UserProfileButton variant="sidebar" />
          </div>
        </aside>

        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <span>{t.topbar.workspace}</span>
              <ChevronRight size={14} />
              <strong>
                {activeTab === "play"
                  ? t.nav.clutchRun
                  : activeTab === "ingest"
                    ? t.headings.uploadTitle
                    : activeTab === "coach"
                      ? t.headings.coachTitle
                      : t.headings.arenaTitle}
              </strong>
            </div>

            <div className="topbar-nav-tabs" role="tablist" aria-label="Workspace views">
              <button
                role="tab"
                aria-selected={activeTab === "play"}
                className={`topbar-tab ${activeTab === "play" ? "active" : ""}`}
                onClick={() => setActiveTab("play")}
              >
                <Zap size={14} />
                <span>{t.topbar.play}</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === "ingest"}
                className={`topbar-tab ${activeTab === "ingest" ? "active" : ""}`}
                onClick={() => setActiveTab("ingest")}
              >
                <FileText size={14} />
                <span>{t.topbar.ingest}</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === "coach"}
                className={`topbar-tab ${activeTab === "coach" ? "active" : ""}`}
                onClick={() => setActiveTab("coach")}
              >
                <Sparkles size={14} />
                <span>{t.topbar.coach}</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === "arena"}
                className={`topbar-tab ${activeTab === "arena" ? "active" : ""}`}
                onClick={() => setActiveTab("arena")}
              >
                <Users size={14} />
                <span>{t.topbar.arena}</span>
              </button>
            </div>

            <div className="topbar-actions">
              <LanguageSwitcher />
              <button
                type="button"
                onClick={() => {
                  setPricingReason(null);
                  setPricingOpen(true);
                }}
                className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
                title="View student passes and pricing"
              >
                <Flame size={14} className="text-amber-600" />
                <span suppressHydrationWarning>
                  {tier === "contender"
                    ? language === "vi" ? "Gói Ôn Thi" : "Cram Pass"
                    : tier === "cram_pass"
                      ? "Cram Pass"
                      : tier === "pro"
                        ? "Pro"
                        : "Tutor"}
                </span>
              </button>
              <button
                type="button"
                className={`toggle-viewer-btn ${showDocViewer ? "active" : ""}`}
                onClick={() => setShowDocViewer(!showDocViewer)}
                title={showDocViewer ? "Hide Document Viewer" : "Show Document Viewer"}
                aria-label="Toggle Document Viewer"
              >
                <BookOpen size={14} />
                <span>{t.topbar.docViewer}</span>
              </button>
              <span className="topbar-divider" />
              <Button
                variant="ghost"
                size="icon"
                aria-label={audio.muted ? t.topbar.soundOn : t.topbar.muteSound}
                title={audio.muted ? t.topbar.soundOn : t.topbar.muteSound}
                onClick={audio.toggle}
              >
                {audio.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                data-testid="open-pilot-feedback"
                aria-label={language === "vi" ? "Góp ý & Báo lỗi" : "Send Feedback"}
                title={language === "vi" ? "Góp ý & Báo lỗi" : "Send Feedback"}
                onClick={() => {
                  setFeedbackSeed(null);
                  setFeedbackOpen(true);
                }}
              >
                <MessageSquarePlus size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.topbar.howToPlay}
                onClick={() => setTutorialOpen(true)}
              >
                <CircleHelp size={19} />
              </Button>
              <UserProfileButton variant="topbar" />
            </div>
          </header>

          <main id="main-content" className="main-content">
            {!inRun && (
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="tiny-star">✦</span> {t.headings.eyebrow}
                  </div>
                  <h1>
                    {activeTab === "arena"
                      ? t.headings.arenaTitle
                      : activeTab === "ingest"
                        ? t.headings.uploadTitle
                        : activeTab === "notes"
                          ? (t.headings.notesTitle || "Slide-to-Summary Note Generator")
                          : activeTab === "coach"
                            ? t.headings.coachTitle
                            : state.phase === "ready"
                              ? t.headings.clutchRunReady
                              : state.phase === "finished"
                                ? t.headings.clutchRunFinished
                                : t.headings.clutchRunInRun}
                  </h1>
                  <p>
                    {activeTab === "arena"
                      ? t.headings.arenaDesc
                      : activeTab === "ingest"
                        ? t.headings.ingestDesc
                        : activeTab === "notes"
                          ? (t.headings.notesDesc || "Transform lecture slides into exam-ready bilingual notes.")
                          : activeTab === "coach"
                            ? t.headings.coachDesc
                            : t.headings.playDesc}
                  </p>
                </div>
                <div className="session-pill">
                  <span className="pulse-dot" />
                  <span>
                    {activeTab === "arena"
                      ? t.run.statusArena
                      : activeTab === "ingest"
                        ? t.run.statusIngest
                        : activeTab === "notes"
                          ? (t.run.statusNotes || "NOTES ENGINE PRO")
                          : activeTab === "coach"
                            ? t.run.statusCoach
                            : t.run.statusSolo}
                  </span>
                </div>
              </div>
            )}

            <div className={showDocViewer ? "workspace-split" : "workspace-full"}>
              {showDocViewer && (
                <DocumentViewer
                  document={document}
                  highlightedSourceId={highlightedSourceId}
                  highlightedExcerpt={highlightedExcerpt}
                  onSelectSource={(sourceId) => setHighlightedSourceId(sourceId)}
                  onAskCoachAboutSource={(source) => {
                    handleAskCoach({
                      type: "explain",
                      question: `What are the key concepts covered in ${source.label}?`,
                      options: [
                        "Core economic principles and definitions",
                        "Market mechanism interactions and effects",
                        "Real-world behavioral implications",
                        "Mathematical modeling and constraints",
                      ],
                      correctIndex: 0,
                      selected: null,
                      explanation: source.text.slice(0, 500),
                      topic: source.label,
                      rule: source.text.slice(0, 200),
                      sourceId: source.id,
                      excerpt: source.text.slice(0, 300),
                    });
                  }}
                  onOpenUpload={() => setActiveTab("ingest")}
                />
              )}

              <div className="workspace-main-pane">
                {activeTab === "arena" ? (
                  <ArenaManager
                    presetPack={pack}
                    onDebriefCoach={(focus) => handleAskCoach(focus)}
                    onExitToSolo={() => setActiveTab("play")}
                  />
                ) : activeTab === "ingest" ? (
                  <UploadPanel
                    onPackGenerated={handlePackGenerated}
                    onDocumentPreviewed={handleDocumentPreviewed}
                    onPlayPack={handlePlayPack}
                    onHostArena={handleHostArena}
                  />
                ) : activeTab === "notes" ? (
                  <ClutchNotesPanel />
                ) : activeTab === "coach" ? (
                  <CoachPanel
                    document={document}
                    activeFocus={coachFocus}
                    onClearFocus={() => setCoachFocus(null)}
                    onSelectCitation={(sourceId) => handleCitationClick(sourceId)}
                    onOpenUpload={() => setActiveTab("ingest")}
                  />
                ) : (
                  <>
                    {state.phase === "ready" ? (
                      !pack ? (
                        <div className="setup-grid">
                          <section className="setup-card surface empty-study-card">
                            <div className="section-top mb-3">
                              <div className="section-icon">
                                <Sparkles size={20} className="text-amber-600" />
                              </div>
                              <div>
                                <h2>Welcome to Clutch Arena</h2>
                                <p>No study deck loaded yet. Take the quick tour to see how it works, upload your course notes, or try our example deck.</p>
                              </div>
                              <span className="tag tag-amber">Getting Started</span>
                            </div>

                            <div className="welcome-actions-grid">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setTutorialOpen(true)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") setTutorialOpen(true);
                                }}
                                className="welcome-action-card"
                              >
                                <div className="welcome-card-icon amber">
                                  <Compass size={18} />
                                </div>
                                <strong>Interactive Tutorial</strong>
                                <span>Take a 1-minute guided tour of active recall and live arenas.</span>
                              </div>

                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setActiveTab("notes")}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") setActiveTab("notes");
                                }}
                                className="welcome-action-card"
                              >
                                <div className="welcome-card-icon amber">
                                  <FileSpreadsheet size={18} />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <strong>Clutch Notes AI</strong>
                                  <span style={{ fontSize: "10px", fontWeight: 800, background: "#e96b44", color: "#fff", padding: "1px 5px", borderRadius: "4px" }}>PRO</span>
                                </div>
                                <span>Turn 27-slide lecture decks into 3-page bilingual revision notes with LaTeX &amp; PDF export.</span>
                              </div>

                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setActiveTab("ingest")}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") setActiveTab("ingest");
                                }}
                                className="welcome-action-card"
                              >
                                <div className="welcome-card-icon emerald">
                                  <Upload size={18} />
                                </div>
                                <strong>Upload Study Notes</strong>
                                <span>Drop your lecture PDFs, DOCX, or PPTX to generate study questions.</span>
                              </div>

                              <div
                                role="button"
                                tabIndex={0}
                                onClick={handleLoadSamplePack}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") handleLoadSamplePack();
                                }}
                                className="welcome-action-card"
                              >
                                <div className="welcome-card-icon blue">
                                  <Play size={18} fill="currentColor" />
                                </div>
                                <strong>Load Example Deck</strong>
                                <span>Try 15 questions from Microeconomics Ch 1–5 with citations.</span>
                              </div>
                            </div>
                          </section>
                        </div>
                      ) : showFlashcards ? (
                        <FlashcardReview
                          pack={pack}
                          mode={mode}
                          onExit={() => setShowFlashcards(false)}
                          onStartRun={() => {
                            setShowFlashcards(false);
                            void start();
                          }}
                        />
                      ) : (
                        <>
                          <div className="setup-grid">
                            <section className="setup-card surface">
                              <div className="section-top">
                                <div className="section-icon">
                                  <Zap size={19} />
                                </div>
                                <div>
                                  <h2>{t.run.soloPractice}</h2>
                                  <p>
                                    {pack.id === "mock-microeconomics"
                                      ? t.run.soloPracticeSubtitle
                                      : pack.subtitle ||
                                        `${pack.questions.length} ${t.library.questionsCount}`}
                                  </p>
                                </div>
                                <span className="tag tag-green">{t.run.readyToPlay}</span>
                              </div>
                     <div className="pack-preview">
                       <div className="pack-icon">
                         <BookOpen size={24} />
                       </div>
                       <div className="pack-info flex-1 min-w-0">
                         <div className="flex items-center gap-2 flex-wrap">
                           <strong className="truncate">{pack.title}</strong>
                           {pack.id.endsWith("-weak-spots") && (
                             <span className="mastery-badge badge-weak">{t.run.comebackSprint}</span>
                           )}
                         </div>
                         <span>
                           {pack.id === "mock-microeconomics"
                             ? t.run.soloPracticeSubtitle
                             : pack.subtitle || `${pack.questions.length} ${t.library.questionsCount}`}
                         </span>
                         {pack.id.endsWith("-weak-spots") && (
                           <div className="sprint-indicator-banner mt-1">
                             <button
                               type="button"
                               onClick={handleRestoreBasePack}
                               className="restore-pack-link"
                             >
                               {t.run.backToFullDeck}
                             </button>
                           </div>
                         )}
                       </div>
                       <div className="pack-preview-actions flex items-center gap-2 shrink-0">
                         <Button
                           variant="outline"
                           size="sm"
                           onClick={openLibrary}
                           title="Switch or import a different study deck"
                           className="change-deck-btn"
                           data-testid="clutch-run-change-deck-btn"
                         >
                           <FolderSync size={14} className="text-amber-700" />
                           <span>{t.run.changeDeck}</span>
                         </Button>
                         <Button
                           variant="outline"
                           size="sm"
                           onClick={() => setShareOpen(true)}
                           title="Share & export pack"
                         >
                           <Share2 size={14} />
                           <span>{t.library.shareBtn}</span>
                         </Button>
                         <span className="pack-count">
                           {pack.questions.length} {t.library.questionsCount}
                         </span>
                       </div>
                     </div>

                     {availablePacks.length > 1 && (
                       <div className="quick-deck-chips flex items-center gap-2 flex-wrap" role="region" aria-label="Quick deck switcher">
                         <span className="text-stone-500 font-medium shrink-0 flex items-center gap-1">
                           <Layers3 size={13} className="text-amber-700" />
                           <span>{t.run.quickSwitch}</span>
                         </span>
                         <div className="flex items-center gap-1.5 flex-wrap">
                           {availablePacks.map((item) => {
                             const isSelected = item.id === pack.id;
                             return (
                               <button
                                 key={item.id}
                                 type="button"
                                 onClick={() =>
                                   handleSelectPackFromLibrary(
                                     item.pack,
                                     item.document,
                                   )
                                 }
                                 className={`quick-deck-chip ${isSelected ? "selected" : ""}`}
                                 title={`Switch active deck to ${item.title}`}
                                 aria-pressed={isSelected}
                               >
                                 {isSelected && (
                                   <Check
                                     size={12}
                                     className="inline mr-1 text-emerald-600"
                                   />
                                 )}
                                 <span className="truncate max-w-[140px] inline-block align-bottom">
                                   {item.title}
                                 </span>
                                 <span className="text-[10px] opacity-70 ml-1">
                                   ({item.questionCount}Q)
                                 </span>
                               </button>
                             );
                           })}
                           <button
                             type="button"
                             onClick={openLibrary}
                             className="quick-deck-chip more-chip"
                             title="Open Study Library to browse all or import JSON"
                           >
                             <span>{t.run.moreInLibrary}</span>
                           </button>
                         </div>
                       </div>
                     )}
                     <div className="field-label flex items-center justify-between">
                       <span>{language === "vi" ? "Số lượng câu hỏi" : "Session Length"}</span>
                       {tier === "contender" && (
                         <span
                           suppressHydrationWarning
                           className="text-[11px] font-semibold text-amber-700 dark:text-amber-400"
                         >
                           Contender (Max 10Q)
                         </span>
                       )}
                     </div>
                     <div className="flex items-center gap-2 mb-4" role="group" aria-label="Question count selection">
                       {[10, 20, 30].map((count) => {
                         const isLocked = count > limits.maxQuestionsPerRun;
                         const isSelected = questionCount === count;
                         return (
                           <button
                             key={count}
                             type="button"
                             onClick={() => {
                               if (isLocked) {
                                 setPricingReason(
                                   language === "vi"
                                     ? `Chế độ ${count} câu hỏi yêu cầu Vé Ôn Thi Cấp Tốc (Cram Pass) hoặc Clutch Pro.`
                                     : `Full ${count}-question runs require a 7-Day Cram Pass or Clutch Pro.`,
                                 );
                                 setPricingOpen(true);
                                 return;
                               }
                               setQuestionCount(count);
                             }}
                             className={`flex-1 p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                               isSelected
                                 ? "border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:border-amber-500 dark:text-amber-200 shadow-xs"
                                 : "border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 hover:border-stone-300"
                             }`}
                           >
                             <span>{count} {language === "vi" ? "câu" : "Questions"}</span>
                             {isLocked && (
                               <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500 text-stone-950">
                                 Pro
                                </span>
                             )}
                           </button>
                         );
                       })}
                     </div>

                     <div className="field-label">
                       {t.run.howPractice}
                     </div>
                     <div
                       className="mode-options"
                       role="group"
                       aria-label="Practice mode"
                     >
                       <button
                         aria-pressed={mode === "exact"}
                         className={`mode-option ${mode === "exact" ? "selected" : ""}`}
                         onClick={() => setMode("exact")}
                       >
                         <ListChecks size={20} />
                         <div>
                           <strong>{t.run.classicRecall}</strong>
                           <span>{t.run.classicRecallDesc}</span>
                         </div>
                         <span className="radio">
                           {mode === "exact" && <span />}
                         </span>
                       </button>
                       <button
                         aria-pressed={mode === "variants"}
                         className={`mode-option ${mode === "variants" ? "selected" : ""}`}
                         onClick={() => {
                           if (!limits.canUseConceptRemix && unlockedRemixRuns === 0) {
                             setPricingReason(
                               language === "vi"
                                 ? "Chế độ Biến thể Concept Remix yêu cầu Vé Ôn Thi Cấp Tốc (Cram Pass) hoặc mở khóa bằng cách mời bạn bè!"
                                 : "Concept Remix mode requires a 7-Day Cram Pass or Clutch Pro, or unlock free runs with Referrals!",
                             );
                             setPricingOpen(true);
                             return;
                           }
                           setMode("variants");
                         }}
                       >
                         <Sparkles size={20} />
                         <div>
                           <div className="flex items-center gap-1.5 flex-wrap">
                             <strong>{t.run.conceptRemix}</strong>
                             {!limits.canUseConceptRemix && (
                               <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500 text-stone-950">
                                 {unlockedRemixRuns > 0 ? `${unlockedRemixRuns} Pass` : "Pro"}
                               </span>
                             )}
                           </div>
                           <span>{t.run.conceptRemixDesc}</span>
                         </div>
                         <span className="radio">
                           {mode === "variants" && <span />}
                         </span>
                       </button>
                     </div>
                     <div className="setup-details">
                       <span>
                         <Clock3 size={15} />
                         {t.run.about2Minutes}
                       </span>
                       <span>
                         <RotateCcw size={15} />
                         {t.run.smartRetry}
                       </span>
                       <span>
                         <Keyboard size={15} />
                         {t.run.keyboardReady}
                       </span>
                     </div>
                     <div className="start-actions-row flex items-center gap-3">
                       <Button
                         className="start-button flex-1"
                         onClick={start}
                         disabled={!pack.questions.length}
                       >
                         <Zap size={18} fill="currentColor" />
                         {t.run.startRun}
                         <ArrowRight size={19} />
                       </Button>
                       <Button
                         variant="outline"
                         className="flashcard-button"
                         onClick={() => setShowFlashcards(true)}
                         disabled={!pack.questions.length}
                         title="Review cards before the timed run"
                       >
                         <Layers3 size={16} />
                         {t.run.flashcards}
                       </Button>
                     </div>
                     <div className="start-caption">
                       <ShieldCheck size={13} />
                       {t.run.noAccount}
                     </div>
                   </section>
                  <aside className="setup-aside">
                    {getWeakSpotsForPack(pack, masteryStore).length > 0 && (
                      <div className="weak-spot-card">
                        <div className="weak-spot-header">
                          <span className="weak-spot-title">
                            <Zap size={13} fill="currentColor" />
                            Comeback Sprint Ready
                          </span>
                          <span className="mastery-badge badge-weak">
                            {getWeakSpotsForPack(pack, masteryStore).length} weak spot{getWeakSpotsForPack(pack, masteryStore).length > 1 ? "s" : ""}
                          </span>
                        </div>
                        <p className="weak-spot-desc">
                          Target {getWeakSpotsForPack(pack, masteryStore).slice(0, 2).map((w) => w.topic).join(", ")}
                          {getWeakSpotsForPack(pack, masteryStore).length > 2 ? ` +${getWeakSpotsForPack(pack, masteryStore).length - 2} more` : ""} in a rapid 5-question sprint.
                        </p>
                        <Button
                          size="sm"
                          variant="dark"
                          className="weak-spot-action"
                          onClick={handleLaunchWeakSpotSprint}
                          type="button"
                        >
                          <Zap size={13} fill="currentColor" />
                          {t.run.launchComeback}
                        </Button>
                      </div>
                    )}
                    <section className="how-card">
                      <div className="section-heading">
                        <span className="eyebrow">{t.run.deckConcepts}</span>
                        <span className="mini-spark">✦</span>
                      </div>
                      <h3>{topics.length} {t.run.keyConcepts}</h3>
                      <div className="topic-list" style={{ marginTop: 16 }}>
                        {topics.slice(0, 6).map((topic, i) => {
                          const topicKey = normalizeTopicKey(topic.topic || topic.id);
                          const stats = masteryStore[topicKey];
                          const mastery = getMasteryLevel(stats);
                          const masteryLabel =
                            mastery.level === "untested"
                              ? t.run.masteryUntested
                              : mastery.level === "mastered"
                                ? `${mastery.score}% ${t.run.masteryMastered}`
                                : mastery.level === "weak"
                                  ? `${mastery.score}% ${t.run.masteryNeedsReview}`
                                  : `${mastery.score}% ${t.run.masteryLearning}`;
                          return (
                            <div className="topic" key={topic.id}>
                              <span className="topic-number">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <div className="flex-1 min-w-0 pr-2">
                                <strong className="truncate block">{topic.topic || t.nav.workspace}</strong>
                                <small>{topic.chapter}</small>
                              </div>
                              <span className={`mastery-badge badge-${mastery.level}`}>
                                {masteryLabel}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div
                        className="setup-details"
                        style={{
                          marginTop: 18,
                          paddingTop: 14,
                          borderTop: "1px solid #e3e7db",
                        }}
                      >
                        <span>
                          <Heart size={14} /> {t.run.livesCount}
                        </span>
                        <span>
                          <Clock3 size={14} /> {t.run.timerCount}
                        </span>
                        <span>
                          <Flame size={14} /> {t.run.streakBonus}
                        </span>
                      </div>
                      <button
                        className="learn-link"
                        onClick={() => openPanel("help")}
                        style={{ marginTop: 14 }}
                      >
                        {t.run.howToPlay} <ArrowUpRight size={14} />
                      </button>
                    </section>
                  </aside>
                </div>
              </>
            )
          ) : state.phase === "finished" ? (
              <RunSummary
                state={state}
                pack={pack!}
                onRestart={reset}
                onChangeDeck={openLibrary}
                onDebriefCoach={handleDebriefCoach}
                onExport={() => setShareOpen(true)}
                onSprintMissed={handleLaunchWeakSpotSprint}
                onExportCheatSheet={handleExportCheatSheet}
              />
            ) : (
              <div className="play-grid">
                <section className="play-main">
                  <div className="run-heading">
                    <div>
                      <span className="run-pack-icon">
                        <BookOpen size={17} />
                      </span>
                      <strong>{pack ? pack.title : "Clutch Run"}</strong>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={openLibrary}
                        title="Switch study deck"
                      >
                        <FolderSync size={14} />
                        Switch deck
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openPanel("leave")}
                      >
                        <X size={15} />
                        Leave run
                      </Button>
                    </div>
                  </div>
                  <GameHud state={state} />
                  <div className="quiz-card surface">
                    <TimerBar
                      key={`${state.index}-${state.deadline}`}
                      deadline={state.deadline}
                      running={state.phase === "answering"}
                      frozenRemaining={state.pausedRemaining}
                    />
                    <AnimatePresence mode="wait">
                      {current && (
                        <QuestionCard
                          key={state.index}
                          question={current}
                          metadata={pack ? pack.metadata[current.id] : undefined}
                          attempt={attempt}
                          number={state.index + 1}
                          disabled={state.phase !== "answering"}
                          variant={current.entry.variant}
                          review={current.entry.review}
                          onAnswer={answer}
                        />
                      )}
                    </AnimatePresence>
                    {attempt && current && (
                      <FeedbackCard
                        key={`feedback-${state.index}`}
                        attempt={attempt}
                        explanation={current.explanation}
                        metadata={pack ? pack.metadata[current.id] : undefined}
                        unlockAt={state.unlockAt}
                        last={
                          state.lives === 0 ||
                          state.index + 1 === state.queue.length
                        }
                        onNext={next}
                        onAskCoach={handleExplainMissWithCoach}
                        onCitationClick={handleCitationClick}
                        onReportCitation={() => {
                          setFeedbackSeed({
                            category: "citation_mismatch",
                            questionId: current.id,
                            citation: pack?.metadata[current.id]?.citation,
                          });
                          setFeedbackOpen(true);
                        }}
                      />
                    )}
                  </div>
                  <div className="keyboard-footer">
                    <Keyboard size={16} />
                    <span>
                      <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> or{" "}
                      <kbd>1</kbd>–<kbd>4</kbd> to answer
                    </span>
                    <span className="keyboard-separator" />
                    <span>
                      <kbd>Enter</kbd> / <kbd>Space</kbd> to continue
                    </span>
                  </div>
                </section>
                <aside className="run-sidebar">
                  <section className="session-card">
                    <span className="eyebrow">YOUR SESSION</span>
                    <div className="session-progress-title">
                      <h3>One concept at a time.</h3>
                      <span>
                        {completedOriginals}/{pack ? pack.questions.length : 0}
                      </span>
                    </div>
                    <div className="session-progress">
                      <div
                        style={{
                          width: `${pack ? (completedOriginals / pack.questions.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="topic-list">
                      {topics.map((topic, i) => {
                        const answered = state.attempts.some(
                          (a) => a.id === topic.id && a.correct,
                        );
                        const mastered = !state.missed.includes(topic.id)
                          ? answered
                          : state.mastery[topic.id] >= 2;
                        const active = current?.id === topic.id;
                        return (
                          <div
                            className={`topic ${active ? "topic-active" : ""}`}
                            key={topic.id}
                          >
                            <span
                              className={`topic-number ${mastered ? "topic-done" : ""}`}
                            >
                              {mastered ? (
                                <Check size={13} />
                              ) : (
                                String(i + 1).padStart(2, "0")
                              )}
                            </span>
                            <div>
                              <strong>
                                {topic.topic || "Practice concept"}
                              </strong>
                              <small>
                                {state.missed.includes(topic.id) && !mastered
                                  ? `Reinforcing · ${state.mastery[topic.id] || 0}/2 correct`
                                  : mastered
                                    ? "Looking good"
                                    : topic.chapter}
                              </small>
                            </div>
                            {active && <span className="topic-active-dot" />}
                          </div>
                        );
                      })}
                    </div>
                    <div className="session-mode">
                      <Sparkles size={14} />
                      {mode === "variants" ? "Concept remix" : "Classic recall"}
                      <span>15s / question</span>
                    </div>
                  </section>
                  <Button
                    variant="outline"
                    className="pause-button"
                    onClick={() => {
                      if (state.phase === "answering")
                        dispatch({ type: "PAUSE", now: Date.now() });
                    }}
                    disabled={state.phase !== "answering"}
                  >
                    <Pause size={15} />
                    Take a breather
                  </Button>
                </aside>
              </div>
            )}
                  </>
                )}
              </div>
            </div>
            <footer className="page-footer">
              <span>
                {t.run.footerLeft}
              </span>
              <span>
                {t.run.footerRight} <Zap size={12} />
              </span>
            </footer>
          </main>
        </div>

        <TutorialDialog
          open={tutorialOpen || panel === "help"}
          onOpenChange={(open) => {
            setTutorialOpen(open);
            if (!open && panel === "help") {
              closePanel(false);
            }
          }}
          onSelectSamplePack={handleLoadSamplePack}
          onGoToUpload={() => setActiveTab("ingest")}
        />
        <FeedbackDialog
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          initialCategory={feedbackSeed?.category}
          context={{
            packTitle: pack?.title,
            questionId: feedbackSeed?.questionId,
            citation: feedbackSeed?.citation,
            tier,
          }}
        />
        <Dialog
          open={panel === "progress"}
          onOpenChange={closePanel}
          title="Every session adds up."
          description="Completed runs saved in this browser, on this device."
        >
          <div className="progress-totals">
            <div>
              <strong>{history.length}</strong>
              <span>Runs completed</span>
            </div>
            <div>
              <strong>{totalXp.toLocaleString()}</strong>
              <span>Total XP</span>
            </div>
            <div>
              <strong>
                {Math.max(0, ...history.map((r) => r.bestStreak))}
              </strong>
              <span>Best streak</span>
            </div>
            <div>
              <strong>
                {Object.values(masteryStore).filter((s) => getMasteryLevel(s).level === "mastered").length}
              </strong>
              <span>Mastered</span>
            </div>
          </div>
          <div className="progress-tabs-nav">
            <button
              type="button"
              className={`progress-tab-btn ${progressTab === "runs" ? "active" : ""}`}
              onClick={() => setProgressTab("runs")}
            >
              Runs History ({history.length})
            </button>
            <button
              type="button"
              className={`progress-tab-btn ${progressTab === "mastery" ? "active" : ""}`}
              onClick={() => setProgressTab("mastery")}
            >
              Concept Mastery ({Object.keys(masteryStore).length})
            </button>
          </div>
          {progressTab === "runs" ? (
            history.length ? (
              <div className="history-list">
                {history.slice(0, 10).map((run) => (
                  <div key={run.id}>
                    <span className="history-icon">
                      <Zap size={17} />
                    </span>
                    <div>
                      <strong>Microeconomics practice</strong>
                      <small>
                        {new Date(run.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        · {run.correct}/{run.total} correct
                      </small>
                    </div>
                    <b>{run.score} XP</b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="history-empty">
                <Target size={34} />
                <h3>Your first win is waiting.</h3>
                <p>Complete a run to start your progress story.</p>
              </div>
            )
          ) : (
            Object.keys(masteryStore).length ? (
              <div className="mastery-tab-content">
                {pack && getWeakSpotsForPack(pack, masteryStore).length > 0 && (
                  <Button
                    size="sm"
                    variant="dark"
                    className="w-full mb-3"
                    onClick={handleLaunchWeakSpotSprint}
                    type="button"
                  >
                    <Zap size={13} fill="currentColor" />
                    Launch Comeback Sprint ({getWeakSpotsForPack(pack, masteryStore).length} weak spots)
                  </Button>
                )}
                <div className="mastery-list max-h-[260px] overflow-y-auto pr-1">
                  {Object.values(masteryStore).map((stats) => {
                    const { score, level, label } = getMasteryLevel(stats);
                    return (
                      <div key={stats.topic} className="mastery-row">
                        <div className="flex-1 min-w-0 pr-3">
                          <strong className="block text-xs font-medium text-neutral-800 truncate">
                            {stats.topic}
                          </strong>
                          <small className="text-[10px] text-neutral-500">
                            {stats.correctAttempts}/{stats.totalAttempts} correct ({score}%) · {stats.consecutiveCorrect} in a row
                          </small>
                        </div>
                        <span className={`mastery-badge badge-${level}`}>
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="history-empty">
                <Target size={34} />
                <h3>No concept data yet.</h3>
                <p>Complete practice questions to build your topic mastery profile.</p>
              </div>
            )
          )}
          <Button onClick={() => closePanel(false)}>
            Back to practice <ArrowRight size={16} />
          </Button>
        </Dialog>
        <Dialog
          open={panel === "leave"}
          onOpenChange={closePanel}
          title="Call it a practice round?"
          description="Your clock is paused. Leaving discards this unfinished run; completed runs stay saved."
        >
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => closePanel(false)}>
              Keep going
            </Button>
            <Button onClick={reset}>Leave run</Button>
          </div>
        </Dialog>
        <Dialog
          open={state.phase === "paused" && !panel}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "RESUME", now: Date.now() });
          }}
          title="Breathe. You’ve got time."
          description="Your timer is paused. Take a moment and come back when you’re ready."
        >
          <div className="pause-illustration">
            <Pause size={36} />
          </div>
          <Button
            className="resume-button"
            onClick={() => dispatch({ type: "RESUME", now: Date.now() })}
          >
            <Play size={17} fill="currentColor" />
            Resume run
          </Button>
        </Dialog>

        <LibraryDialog
          open={libraryOpen}
          onOpenChange={(open) => {
            setLibraryOpen(open);
            if (!open && state.phase === "paused" && !panel) {
              dispatch({ type: "RESUME", now: Date.now() });
            }
          }}
          onSelectPack={handleSelectPackFromLibrary}
          onHostArena={handleHostArena}
        />
        {pack && (
          <PackShareDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            pack={pack}
            missedIds={state.missed}
          />
        )}
        <PricingModal
          open={pricingOpen}
          onClose={() => setPricingOpen(false)}
          initialReason={pricingReason}
        />
      </div>
    </MotionConfig>
  );
}
