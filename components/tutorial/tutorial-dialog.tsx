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
import { useLanguage } from "@/lib/i18n/context";

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
  const { t } = useLanguage();
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
                {t.tutorial.quickTourBadge} · {t.tutorial.stepWord} {step + 1} {t.tutorial.ofWord} 6
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkipOrComplete}
                className="text-stone-600 hover:text-stone-900 text-xs h-8 px-2 font-medium"
              >
                {t.tutorial.skipBtn}
              </Button>
              <DialogPrimitive.Close asChild>
                <button
                  onClick={handleSkipOrComplete}
                  className="dialog-close-btn p-1.5 rounded-lg text-stone-500 hover:text-stone-900"
                  aria-label={t.tutorial.closeAria}
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
                  {t.tutorial.step0Title}
                </h3>
                <p className="tutorial-desc">
                  {t.tutorial.step0Desc}
                </p>

                <div className="space-y-2.5 my-4">
                  <div className="tutorial-feature-card">
                    <span className="tutorial-feature-icon emerald">
                      <FileText size={16} />
                    </span>
                    <div className="tutorial-feature-content">
                      <strong>{t.tutorial.step0Feature1Title}</strong>
                      <span>{t.tutorial.step0Feature1Desc}</span>
                    </div>
                  </div>

                  <div className="tutorial-feature-card">
                    <span className="tutorial-feature-icon amber">
                      <Zap size={16} />
                    </span>
                    <div className="tutorial-feature-content">
                      <strong>{t.tutorial.step0Feature2Title}</strong>
                      <span>{t.tutorial.step0Feature2Desc}</span>
                    </div>
                  </div>

                  <div className="tutorial-feature-card">
                    <span className="tutorial-feature-icon blue">
                      <Users size={16} />
                    </span>
                    <div className="tutorial-feature-content">
                      <strong>{t.tutorial.step0Feature3Title}</strong>
                      <span>{t.tutorial.step0Feature3Desc}</span>
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
                  {t.tutorial.step1Title}
                </h3>
                <p className="tutorial-desc">
                  {t.tutorial.step1Desc}
                </p>

                <div className="tutorial-preview-box">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-stone-200 shadow-sm text-xs font-semibold text-stone-800 mb-2">
                    <FileText size={15} className="text-amber-600" />
                    {t.tutorial.step1SampleFile}
                  </div>
                  <div className="text-xs text-stone-600 mt-1">
                    {t.tutorial.step1FormatsPrefix}
                    <strong>PDF</strong>, <strong>DOCX</strong>, <strong>PPTX</strong>, {t.tutorial.andWord} <strong>TXT</strong>
                    {t.tutorial.step1FormatsSuffix}
                  </div>
                </div>

                <div className="space-y-2 text-xs text-stone-700">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span>{t.tutorial.step1Bullet1}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span>{t.tutorial.step1Bullet2}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span>{t.tutorial.step1Bullet3}</span>
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
                  {t.tutorial.step2Title}
                </h3>
                <p className="tutorial-desc">
                  {t.tutorial.step2DescPrefix}
                  <strong>{t.tutorial.step2DescHighlight}</strong>
                  {t.tutorial.step2DescSuffix}
                </p>

                {/* Microeconomics Sample Question Preview */}
                <div className="tutorial-sample-card">
                  <div className="tutorial-sample-header">
                    <span className="tutorial-sample-badge">{t.tutorial.step2SampleBadge}</span>
                    <span className="tutorial-sample-clock">{t.tutorial.step2SampleClock}</span>
                  </div>
                  <p className="tutorial-sample-question">
                    {t.tutorial.step2SampleQuestion}
                  </p>
                  <div>
                    <div className="tutorial-sample-option-correct">
                      <span>{t.tutorial.step2SampleOptionA}</span>
                      <CheckCircle2 size={15} className="text-emerald-700" />
                    </div>
                    <div className="tutorial-sample-option-other">
                      {t.tutorial.step2SampleOptionB}
                    </div>
                  </div>
                  <div className="tutorial-sample-citation">
                    <BookOpen size={13} />
                    <span>{t.tutorial.step2SampleCitation}</span>
                  </div>
                </div>

                <p className="text-xs text-stone-600">
                  {t.tutorial.step2Footer}
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box purple">
                  <Compass size={24} />
                </div>
                <h3 className="tutorial-title">
                  {t.tutorial.step3Title}
                </h3>
                <p className="tutorial-desc">
                  {t.tutorial.step3Desc}
                </p>

                <div className="tutorial-coach-box space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-stone-800">{t.tutorial.step3Topic1}</span>
                      <span className="text-emerald-700">{t.tutorial.step3Mastery1}</span>
                    </div>
                    <div className="tutorial-meter-track">
                      <div className="bg-emerald-500 h-full w-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-stone-800">{t.tutorial.step3Topic2}</span>
                      <span className="text-rose-600">{t.tutorial.step3Mastery2}</span>
                    </div>
                    <div className="tutorial-meter-track">
                      <div className="bg-rose-500 h-full w-2/5" />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-stone-600 leading-normal">
                  {t.tutorial.step3FooterPrefix}
                  <strong>{t.tutorial.step3FooterHighlight}</strong>
                  {t.tutorial.step3FooterSuffix}
                </p>
              </div>
            )}

            {step === 4 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box blue">
                  <Users size={24} />
                </div>
                <h3 className="tutorial-title">
                  {t.tutorial.step4Title}
                </h3>
                <p className="tutorial-desc">
                  {t.tutorial.step4Desc}
                </p>

                <div className="tutorial-arena-box">
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className="font-semibold text-amber-400">{t.tutorial.step4RoomLabel}</span>
                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono text-[11px]">
                      {t.tutorial.step4LiveBadge}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold py-1 border-b border-stone-800">
                    <span>{t.tutorial.step4User1}</span>
                    <span className="text-amber-400">{t.tutorial.step4Points1}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs py-1 text-stone-400">
                    <span>{t.tutorial.step4User2}</span>
                    <span>{t.tutorial.step4Points2}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs py-1 text-stone-500">
                    <span>{t.tutorial.step4User3}</span>
                    <span>{t.tutorial.step4Points3}</span>
                  </div>
                </div>

                <div className="text-xs text-stone-600 space-y-1">
                  <div>⚡ <strong>{t.tutorial.step4SpeedPointsTitle}</strong>{t.tutorial.step4SpeedPointsDesc}</div>
                  <div>🤖 <strong>{t.tutorial.step4AdaptiveBotsTitle}</strong>{t.tutorial.step4AdaptiveBotsDesc}</div>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="tutorial-step">
                <div className="tutorial-icon-box amber">
                  <Trophy size={24} />
                </div>
                <h3 className="tutorial-title">
                  {t.tutorial.step5Title}
                </h3>
                <p className="tutorial-desc">
                  {t.tutorial.step5DescPrefix}
                  <strong>{t.tutorial.step5DescHighlight}</strong>
                  {t.tutorial.step5DescSuffix}
                </p>

                <div className="space-y-2.5 my-4">
                  <Button
                    className="w-full justify-center py-5 text-sm font-semibold shadow-md bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handlePlaySample}
                  >
                    <Play size={16} fill="currentColor" className="mr-2" />
                    {t.tutorial.playSampleBtn}
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full justify-center py-5 text-sm font-semibold border-stone-300 hover:bg-stone-50"
                    onClick={handleUploadNotes}
                  >
                    <Upload size={16} className="mr-2" />
                    {t.tutorial.uploadOwnBtn}
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
                  aria-label={`${t.tutorial.goToStepAria} ${idx + 1}`}
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
                  {t.tutorial.backBtn}
                </Button>
              )}

              {step < 5 ? (
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="text-xs h-9 px-4 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {t.tutorial.nextBtn}
                  <ArrowRight size={14} className="ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSkipOrComplete}
                  className="text-xs h-9 px-3 text-stone-600 font-medium"
                >
                  {t.tutorial.closeExploreBtn}
                </Button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
