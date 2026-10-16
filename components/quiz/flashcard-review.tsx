"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  RotateCcw,
  Shuffle,
  X,
  Zap,
  Repeat,
} from "lucide-react";
import type { StudyPack } from "@/lib/schemas/question";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";

type Verdict = "known" | "learning";
const LETTERS = ["A", "B", "C", "D"] as const;

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function FlashcardReview({
  pack,
  mode,
  onExit,
  onStartRun,
}: {
  pack: StudyPack;
  mode: "exact" | "variants";
  onExit: () => void;
  onStartRun: () => void;
}) {
  const allIds = useMemo(() => pack.questions.map((q) => q.id), [pack]);
  const [order, setOrder] = useState<string[]>(allIds);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});

  useEffect(() => {
    setOrder(allIds);
    setIndex(0);
    setFlipped(false);
    setVerdicts({});
  }, [allIds]);

  const finished = index >= order.length;
  const currentId = order[index];
  const question = pack.questions.find((q) => q.id === currentId);
  const card = question
    ? mode === "variants"
      ? question.conceptVariant
      : question
    : null;
  const meta = currentId ? pack.metadata[currentId] : undefined;

  const knownCount = order.filter((id) => verdicts[id] === "known").length;
  const learningIds = order.filter((id) => verdicts[id] === "learning");

  const go = useCallback(
    (delta: number) => {
      setFlipped(false);
      setIndex((i) => Math.min(Math.max(0, i + delta), order.length));
    },
    [order.length],
  );

  const mark = useCallback(
    (verdict: Verdict) => {
      if (!currentId) return;
      setVerdicts((v) => ({ ...v, [currentId]: verdict }));
      go(1);
    },
    [currentId, go],
  );

  const restart = (ids: string[]) => {
    setOrder(ids);
    setIndex(0);
    setFlipped(false);
    setVerdicts({});
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;
      if (finished) return;
      const onControl = !!target?.closest("button, a");
      if ((event.key === " " || event.key === "Enter") && !onControl) {
        event.preventDefault();
        setFlipped((f) => !f);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (flipped && event.key === "1") {
        event.preventDefault();
        mark("learning");
      } else if (flipped && event.key === "2") {
        event.preventDefault();
        mark("known");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished, flipped, go, mark]);

  const progress = order.length ? Math.min(index, order.length) / order.length : 0;

  return (
    <section className="flashcards surface" aria-label="Flashcard review">
      <header className="flashcards-header">
        <div>
          <span className="eyebrow">
            <span className="tiny-star">✦</span> FLASHCARD REVIEW
            {mode === "variants" ? " · CONCEPT REMIX" : ""}
          </span>
          <h2>{pack.title}</h2>
        </div>
        <div className="flashcards-header-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => restart(shuffled(order))}
            disabled={finished || order.length < 2}
          >
            <Shuffle size={14} />
            Shuffle
          </Button>
          <Button variant="ghost" size="sm" onClick={onExit}>
            <X size={15} />
            Exit
          </Button>
        </div>
      </header>

      <div
        className="flashcards-progress"
        role="progressbar"
        aria-label="Cards reviewed"
        aria-valuemin={0}
        aria-valuemax={order.length}
        aria-valuenow={Math.min(index, order.length)}
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      {finished ? (
        <div className="flashcards-summary">
          <div className="flashcards-summary-stats">
            <div>
              <strong data-testid="flashcards-known">{knownCount}</strong>
              <span>Got it</span>
            </div>
            <div>
              <strong data-testid="flashcards-learning">{learningIds.length}</strong>
              <span>Still learning</span>
            </div>
          </div>
          <h3>
            {learningIds.length === 0
              ? "Every card felt solid. Time to test it under pressure."
              : "Nice pass. Run the shaky ones again, or test yourself for real."}
          </h3>
          <div className="flashcards-summary-actions">
            <Button className="start-button" onClick={onStartRun}>
              <Zap size={17} fill="currentColor" />
              Start Clutch Run
              <ArrowRight size={17} />
            </Button>
            {learningIds.length > 0 && (
              <Button variant="outline" onClick={() => restart(learningIds)}>
                <Repeat size={15} />
                Review {learningIds.length} still learning
              </Button>
            )}
            <Button variant="ghost" onClick={() => restart(allIds)}>
              <RotateCcw size={15} />
              Restart all cards
            </Button>
          </div>
        </div>
      ) : (
        card && (
          <>
            <div className="flashcard-meta">
              <span>
                Card {index + 1} of {order.length}
              </span>
              {meta?.topic && <span className="topic-badge">{meta.topic}</span>}
            </div>

            <button
              type="button"
              className={`flashcard ${flipped ? "is-flipped" : ""}`}
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Show question" : "Reveal answer"}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${currentId}-${flipped ? "back" : "front"}`}
                  className="flashcard-face"
                  initial={{ rotateY: -90, opacity: 0 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  exit={{ rotateY: 90, opacity: 0 }}
                  transition={{ duration: 0.16 }}
                >
                  {!flipped ? (
                    <>
                      <span className="flashcard-side">QUESTION</span>
                      <h3 className="flashcard-question">
                        <MathText content={card.question} />
                      </h3>
                      <ol className="flashcard-options">
                        {card.options.map((opt, i) => (
                          <li key={i}>
                            <kbd>{LETTERS[i]}</kbd>
                            <MathText content={opt} inline />
                          </li>
                        ))}
                      </ol>
                      <span className="flashcard-hint">Click or press Space to flip</span>
                    </>
                  ) : (
                    <>
                      <span className="flashcard-side">ANSWER</span>
                      <h3 className="flashcard-answer" data-testid="flashcard-answer">
                        <kbd>{LETTERS[card.correctIndex]}</kbd>
                        <MathText content={card.options[card.correctIndex]} inline />
                      </h3>
                      <p className="flashcard-explanation">
                        <MathText content={card.explanation} inline />
                      </p>
                      {meta?.rule && (
                        <div className="flashcard-rule">
                          <span className="mr-1">💡</span>
                          <MathText content={meta.rule} />
                        </div>
                      )}
                      {meta?.citation && (
                        <small className="flashcard-citation">
                          <BookOpen size={13} /> {meta.citation}
                        </small>
                      )}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </button>

            <div className="flashcard-controls">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => go(-1)}
                disabled={index === 0}
                aria-label="Previous card"
              >
                <ArrowLeft size={15} />
              </Button>
              {flipped ? (
                <div className="flashcard-verdicts">
                  <Button variant="outline" onClick={() => mark("learning")}>
                    <Repeat size={15} />
                    Still learning <kbd>1</kbd>
                  </Button>
                  <Button variant="dark" onClick={() => mark("known")}>
                    <Check size={15} />
                    Got it <kbd>2</kbd>
                  </Button>
                </div>
              ) : (
                <Button variant="dark" onClick={() => setFlipped(true)}>
                  Reveal answer <kbd>Space</kbd>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => go(1)}
                aria-label="Skip card"
              >
                <ArrowRight size={15} />
              </Button>
            </div>
          </>
        )
      )}
    </section>
  );
}
