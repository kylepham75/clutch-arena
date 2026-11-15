"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Flag, Lightbulb, Sparkles, Loader2, Wrench, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import type { Attempt } from "@/lib/game/reducer";
import type { QuestionMetadata } from "@/lib/schemas/question";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { useLanguage } from "@/lib/i18n/context";

export function FeedbackCard({
  attempt,
  explanation,
  metadata,
  unlockAt,
  last,
  onNext,
  onAskCoach,
  onCitationClick,
  onReportCitation,
  onVerifyAndFix,
}: {
  attempt: Attempt;
  explanation: string;
  metadata?: QuestionMetadata;
  unlockAt: number;
  last: boolean;
  onNext: () => void;
  onAskCoach?: () => void;
  onCitationClick?: (citation: string) => void;
  onReportCitation?: () => void;
  onVerifyAndFix?: () => Promise<{ hallucinationDetected?: boolean; summary?: string } | void>;
}) {
  const { t, language } = useLanguage();
  const [now, setNow] = useState(() => Date.now());
  const [verifying, setVerifying] = useState(false);
  const [repairStatus, setRepairStatus] = useState<{
    success: boolean;
    summary?: string;
  } | null>(null);

  const button = useRef<HTMLButtonElement>(null);
  const remaining = Math.max(0, Math.ceil((unlockAt - now) / 1000));

  useEffect(() => {
    setVerifying(false);
    setRepairStatus(null);
  }, [attempt.id, attempt.variant]);

  useEffect(() => {
    if (Date.now() >= unlockAt) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [unlockAt]);

  useEffect(() => {
    if (remaining === 0) button.current?.focus({ preventScroll: true });
  }, [remaining]);

  const handleVerifyClick = async () => {
    if (!onVerifyAndFix || verifying) return;
    setVerifying(true);
    setRepairStatus(null);
    try {
      const res = await onVerifyAndFix();
      setRepairStatus({
        success: true,
        summary: res?.summary,
      });
    } catch (err) {
      setRepairStatus({
        success: false,
        summary: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setVerifying(false);
    }
  };
  return (
    <motion.div
      className={`feedback ${attempt.correct ? "feedback-correct" : "feedback-wrong"}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div role="status" className="feedback-heading">
        {attempt.correct ? <CheckCircle2 size={20} /> : <Lightbulb size={20} />}
        <strong>
          {attempt.correct
            ? t.run.correct
            : attempt.selected === null
              ? t.run.timeout
              : t.run.wrong}
        </strong>
        {attempt.correct && <span>+{attempt.points} XP</span>}
      </div>
      <div className="feedback-explanation">
        <MathText content={explanation} />
      </div>
      {metadata && (
        <>
          <div className="rule">
            <MathText content={metadata.rule} />
          </div>
          {metadata.distractorRationale && (
            <div className="distractor-rationale text-xs text-stone-600 dark:text-stone-300 bg-stone-50 dark:bg-stone-900/40 p-2 rounded border border-stone-200/60 dark:border-stone-800">
              <span className="font-semibold text-stone-700 dark:text-stone-200">
                {language === "vi" ? "Vì sao các đáp án khác sai: " : "Why other options are wrong: "}
              </span>
              <MathText content={metadata.distractorRationale} />
            </div>
          )}
        </>
      )}
      {(metadata || onReportCitation || onVerifyAndFix) && (
        <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
          {metadata ? (
            <small
              className={`citation ${onCitationClick ? "cursor-pointer hover:underline" : ""}`}
              onClick={() => onCitationClick?.(metadata.citation)}
            >
              <BookOpen size={13} />
              {metadata.citation}
            </small>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {onVerifyAndFix && (
              <button
                type="button"
                data-testid="verify-fix-question-btn"
                disabled={verifying}
                onClick={handleVerifyClick}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-60 transition-colors py-1 px-2.5 rounded-md cursor-pointer shadow-2xs"
              >
                {verifying ? (
                  <Loader2 size={12} className="animate-spin text-emerald-600 shrink-0" />
                ) : repairStatus?.success ? (
                  <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                ) : (
                  <Wrench size={12} className="text-emerald-600 shrink-0" />
                )}
                <span>
                  {verifying
                    ? language === "vi"
                      ? "Đang kiểm tra & sửa..."
                      : "Checking & fixing..."
                    : repairStatus?.success
                      ? language === "vi"
                        ? "Đã kiểm tra & cập nhật bộ đề"
                        : "Verified & Updated in Deck"
                      : language === "vi"
                        ? "Báo sai Toán/Slide · Kiểm tra & Sửa ngay"
                        : "Flag Wrong Math · Check & Fix Now"}
                </span>
              </button>
            )}
            {onReportCitation && (
              <button
                type="button"
                onClick={onReportCitation}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 bg-stone-100 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 hover:bg-stone-200 dark:hover:bg-stone-700/60 transition-colors py-1 px-2 rounded-md cursor-pointer"
                aria-label={language === "vi" ? "Góp ý báo lỗi" : "Report issue"}
              >
                <Flag size={11} className="text-stone-500 shrink-0" />
                <span>{language === "vi" ? "Góp ý" : "Report"}</span>
              </button>
            )}
          </div>
        </div>
      )}
      {repairStatus && (
        <div
          data-testid="question-repair-status"
          className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 mt-2 ${
            repairStatus.success
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
              : "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200"
          }`}
        >
          {repairStatus.success ? (
            <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={15} className="text-red-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 leading-relaxed">
            <p className="font-semibold">
              {repairStatus.success
                ? language === "vi"
                  ? "Đã kiểm tra & sửa trực tiếp trong bộ đề"
                  : "Checked & updated in deck"
                : language === "vi"
                  ? "Không thể kiểm tra/sửa câu hỏi lúc này"
                  : "Failed to verify/fix question"}
            </p>
            {repairStatus.summary && (
              <p className="text-[11.5px] opacity-90 mt-0.5">
                {repairStatus.summary}
              </p>
            )}
          </div>
        </div>
      )}
      <div className="feedback-footer">
        <span>
          {attempt.correct ? t.run.keepMomentum : t.run.queuedForRetry}
        </span>
        <div className="flex items-center gap-2">
          {onAskCoach && !attempt.correct && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAskCoach}
              type="button"
            >
              <Sparkles size={14} />
              {t.run.askCoach}
            </Button>
          )}
          <Button
            ref={button}
            data-quiz-advance
            variant="dark"
            size="sm"
            disabled={remaining > 0}
            onClick={onNext}
          >
            {remaining > 0
              ? `${remaining}s`
              : last
                ? t.run.finishRun
                : t.run.nextQuestion}
            {remaining === 0 && <ArrowRight size={15} />}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
