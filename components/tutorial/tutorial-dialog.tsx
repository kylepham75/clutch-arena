"use client";

import { useState, useEffect, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Sparkles,
  FileText,
  Zap,
  Compass,
  Users,
  Trophy,
  ArrowRight,
  ArrowLeft,
  X,
  CheckCircle2,
  BookOpen,
  Upload,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const TUTORIAL_STORAGE_KEY = "clutch:tutorial_completed:v1";

export function isTutorialCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(TUTORIAL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function markTutorialCompleted(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
  } catch {
    // ignore
  }
}

interface TutorialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSamplePack?: () => void;
  onGoToUpload?: () => void;
}

export function TutorialDialog({
  open,
  onOpenChange,
  onSelectSamplePack,
  onGoToUpload,
}: TutorialDialogProps) {
  const [step, setStep] = useState(0);

  // Reset to first step whenever dialog opens
  useEffect(() => {
    if (open) {
      setStep(0);
    }
  }, [open]);

  const handleSkipOrComplete = useCallback(() => {
    markTutorialCompleted();
    onOpenChange(false);
  }, [onOpenChange]);

  const handleNext = () => {
    if (step < 5) {
      setStep((s) => s + 1);
    } else {
      handleSkipOrComplete();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep((s) => s - 1);
    }
  };

  const handlePlaySample = () => {
    markTutorialCompleted();
    onOpenChange(false);
    onSelectSamplePack?.();
  };

  const handleUploadNotes = () => {
    markTutorialCompleted();
    onOpenChange(false);
    onGoToUpload?.();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog-content tutorial-dialog-content">
          <div className="tutorial-header flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="tutorial-badge">
                <Sparkles size={13} className="text-amber-700" />
                Quick Tour · Step {step + 1} of 6
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkipOrComplete}
                className="text-stone-600 hover:text-stone-900 text-xs h-8 px-2 font-medium"
              >
                Skip Tutorial
              </Button>
              <DialogPrimitive.Close asChild>
                <button
                  onClick={handleSkipOrComplete}
                  className="dialog-close-btn p-1.5 rounded-lg text-stone-500 hover:text-stone-900"
                  aria-label="Close tutorial"
                >
                  <X size={18} />
                </button>
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="tutorial-body">
            {step === 0 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box amber">
                  <Sparkles size={24} />
                </div>
                <h3 className="tutorial-title">
                  Welcome to Clutch Arena
                </h3>
                <p className="tutorial-desc">
                  Clutch Arena transforms your static lecture slides, PDFs, notes, and testbanks into
                  high-yield active recall quizzes and real-time multiplayer arenas.
                </p>

                <div className="space-y-2.5 my-4">
                  <div className="tutorial-feature-card">
                    <span className="tutorial-feature-icon emerald">
                      <FileText size={16} />
                    </span>
                    <div className="tutorial-feature-content">
                      <strong>Drop Any Course Notes</strong>
                      <span>AI analyzes your documents and generates multi-choice questions with verified citations.</span>
                    </div>
                  </div>

                  <div className="tutorial-feature-card">
                    <span className="tutorial-feature-icon amber">
                      <Zap size={16} />
                    </span>
                    <div className="tutorial-feature-content">
                      <strong>Solo Clutch Run</strong>
                      <span>15-second pressure clock, combo multipliers, flashcard mode, and targeted weak-spot sprints.</span>
                    </div>
                  </div>

                  <div className="tutorial-feature-card">
                    <span className="tutorial-feature-icon blue">
                      <Users size={16} />
                    </span>
                    <div className="tutorial-feature-content">
                      <strong>Live Study Arena</strong>
                      <span>Real-time buzzer showdowns with classmates or adaptive bots using edge WebSockets.</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box emerald">
                  <Upload size={24} />
                </div>
                <h3 className="tutorial-title">
                  1. Upload Notes & AI Question Ingestion
                </h3>
                <p className="tutorial-desc">
                  Never waste hours manually typing flashcards. Just upload your study documents in the Ingest tab.
                </p>

                <div className="tutorial-preview-box">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-stone-200 shadow-sm text-xs font-semibold text-stone-800 mb-2">
                    <FileText size={15} className="text-amber-600" />
                    Lecture_Slides_Week_1_5.pdf
                  </div>
                  <div className="text-xs text-stone-600 mt-1">
                    Supports <strong>PDF</strong>, <strong>DOCX</strong>, <strong>PPTX</strong>, and <strong>TXT</strong> files.
                  </div>
                </div>

                <div className="space-y-2 text-xs text-stone-700">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span>Extracts key definitions, laws, and quantitative formulas</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span>Generates &quot;Concept Twin&quot; question variations to prevent rote memorization</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span>Pins precise textbook/slide excerpts to every question</span>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box amber">
                  <Zap size={24} />
                </div>
                <h3 className="tutorial-title">
                  2. Solo Clutch Run (Example: Microeconomics)
                </h3>
                <p className="tutorial-desc">
                  Questions are backed by <strong>zero-hallucination source citations</strong>. Here is how a question looks in our Microeconomics example deck:
                </p>

                {/* Microeconomics Sample Question Preview */}
                <div className="tutorial-sample-card">
                  <div className="tutorial-sample-header">
                    <span className="tutorial-sample-badge">Microeconomics Ch 5</span>
                    <span className="tutorial-sample-clock">15s Clock</span>
                  </div>
                  <p className="tutorial-sample-question">
                    A competitive firm observes that Marginal Revenue ($50) exceeds Marginal Cost ($45). To maximize profit, the firm should:
                  </p>
                  <div>
                    <div className="tutorial-sample-option-correct">
                      <span>A. Expand output until MR = MC</span>
                      <CheckCircle2 size={15} className="text-emerald-700" />
                    </div>
                    <div className="tutorial-sample-option-other">
                      B. Decrease output immediately
                    </div>
                  </div>
                  <div className="tutorial-sample-citation">
                    <BookOpen size={13} />
                    <span>Citation: Chapter 5 · Marginal Profit Condition (Page 142)</span>
                  </div>
                </div>

                <p className="text-xs text-stone-600">
                  Clicking citations opens the document viewer directly to the verbatim line in your lecture notes.
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box purple">
                  <Compass size={24} />
                </div>
                <h3 className="tutorial-title">
                  3. AI Coach & Weak Spot Sprints
                </h3>
                <p className="tutorial-desc">
                  Clutch Arena tracks your errors and builds customized drills so you don&apos;t repeat the same mistakes on test day.
                </p>

                <div className="tutorial-coach-box space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-stone-800">Consumer Surplus & Equilibrium</span>
                      <span className="text-emerald-700">100% Mastery</span>
                    </div>
                    <div className="tutorial-meter-track">
                      <div className="bg-emerald-500 h-full w-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-stone-800">Price Elasticity Calculations</span>
                      <span className="text-rose-600">40% Mastery (Weak Spot)</span>
                    </div>
                    <div className="tutorial-meter-track">
                      <div className="bg-rose-500 h-full w-2/5" />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-stone-600 leading-normal">
                  The AI Coach creates a <strong>5-question sprint</strong> focusing exclusively on your weak topics until you achieve mastery.
                </p>
              </div>
            )}

            {step === 4 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box blue">
                  <Users size={24} />
                </div>
                <h3 className="tutorial-title">
                  4. Live Study Arena (Multiplayer)
                </h3>
                <p className="tutorial-desc">
                  Turn study sessions into fast-paced live buzzer showdowns with your classmates or study groups.
                </p>

                <div className="tutorial-arena-box">
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className="font-semibold text-amber-400">ROOM: #ECON42</span>
                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono text-[11px]">
                      ● LIVE WEBSOCKET
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold py-1 border-b border-stone-800">
                    <span>1. Kyle (You)</span>
                    <span className="text-amber-400">1,240 pts ⚡</span>
                  </div>
                  <div className="flex items-center justify-between text-xs py-1 text-stone-400">
                    <span>2. StudyBot-Alpha</span>
                    <span>1,020 pts</span>
                  </div>
                  <div className="flex items-center justify-between text-xs py-1 text-stone-500">
                    <span>3. Alex</span>
                    <span>880 pts</span>
                  </div>
                </div>

                <div className="text-xs text-stone-600 space-y-1">
                  <div>⚡ <strong>Speed points</strong>: The fastest correct buzzer wins extra bonus XP.</div>
                  <div>🤖 <strong>Adaptive Bots</strong>: Fill empty spots with bots if practicing solo at night.</div>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box amber">
                  <Trophy size={24} />
                </div>
                <h3 className="tutorial-title">
                  Ready to Clutch Your Exam?
                </h3>
                <p className="tutorial-desc">
                  Choose how you want to begin: practice right now using the <strong>Microeconomics sample pack</strong>, or upload your own lecture notes!
                </p>

                <div className="space-y-2.5 my-4">
                  <Button
                    className="w-full justify-center py-5 text-sm font-semibold shadow-md bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handlePlaySample}
                  >
                    <Play size={16} fill="currentColor" className="mr-2" />
                    Practice with Example Deck (Microeconomics)
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full justify-center py-5 text-sm font-semibold border-stone-300 hover:bg-stone-50"
                    onClick={handleUploadNotes}
                  >
                    <Upload size={16} className="mr-2" />
                    Upload My Own Course Notes
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="tutorial-footer mt-6 pt-4 border-t border-stone-200 flex items-center justify-between">
            <div className="tutorial-dots">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <button
                  key={idx}
                  onClick={() => setStep(idx)}
                  className={`tutorial-dot ${step === idx ? "active" : ""}`}
                  aria-label={`Go to step ${idx + 1}`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBack}
                  className="text-xs h-9 px-3"
                >
                  <ArrowLeft size={14} className="mr-1" />
                  Back
                </Button>
              )}

              {step < 5 ? (
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="text-xs h-9 px-4 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  Next
                  <ArrowRight size={14} className="ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSkipOrComplete}
                  className="text-xs h-9 px-3 text-stone-600 font-medium"
                >
                  Close & Explore
                </Button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
