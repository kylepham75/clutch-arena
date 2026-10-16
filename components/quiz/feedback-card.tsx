"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Lightbulb, Sparkles } from "lucide-react";
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
}: {
  attempt: Attempt;
  explanation: string;
  metadata?: QuestionMetadata;
  unlockAt: number;
  last: boolean;
  onNext: () => void;
  onAskCoach?: () => void;
  onCitationClick?: (citation: string) => void;
}) {
  const { t } = useLanguage();
  const [now, setNow] = useState(() => Date.now());
  const button = useRef<HTMLButtonElement>(null);
  const remaining = Math.max(0, Math.ceil((unlockAt - now) / 1000));
  useEffect(() => {
    if (Date.now() >= unlockAt) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [unlockAt]);
  useEffect(() => {
    if (remaining === 0) button.current?.focus({ preventScroll: true });
  }, [remaining]);
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
          <small
            className={`citation ${onCitationClick ? "cursor-pointer hover:underline" : ""}`}
            onClick={() => onCitationClick?.(metadata.citation)}
          >
            <BookOpen size={13} />
            {metadata.citation}
          </small>
        </>
      )}
      <div className="feedback-footer">
        <span>
          {attempt.correct
            ? "Keep that momentum."
            : "Queued for a fresh attempt."}
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
