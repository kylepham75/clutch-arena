import { Check, X, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import type { QuestionItem, QuestionMetadata } from "@/lib/schemas/question";
import type { Attempt } from "@/lib/game/reducer";
import { MathText } from "@/components/ui/math-text";
import { useLanguage } from "@/lib/i18n/context";

export function QuestionCard({
  question,
  metadata,
  attempt,
  disabled,
  number,
  variant,
  review,
  onAnswer,
}: {
  question: QuestionItem;
  metadata?: QuestionMetadata;
  attempt?: Attempt;
  disabled: boolean;
  number: number;
  variant: boolean;
  review: boolean;
  onAnswer: (index: number) => void;
}) {
  const { language } = useLanguage();
  return (
    <motion.div
      className="question-content"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div className="question-meta">
        <span className="eyebrow">
          {language === "vi" ? "CÂU HỎI" : "QUESTION"} {String(number).padStart(2, "0")}
        </span>
        <span className={`tag ${review ? "tag-purple" : ""}`}>
          {review ? (
            <>
              <Sparkles size={12} />
              {language === "vi" ? "Vòng khắc phục" : "Mastery round"}
            </>
          ) : variant ? (
            language === "vi" ? "Biến thể tương đương" : "Concept variant"
          ) : (
            metadata?.topic || (language === "vi" ? "Luyện tập" : "Practice")
          )}
        </span>
      </div>
      <h2 className="question-title">
        <MathText content={question.question} />
      </h2>
      <div className="answers" role="group" aria-label="Answer options">
        {question.options.map((option, index) => {
          const isCorrect = attempt && index === question.correctIndex;
          const isWrong =
            attempt && attempt.selected === index && !attempt.correct;
          return (
            <button
              key={`${question.id}-${index}`}
              className={`answer ${isCorrect ? "answer-correct" : ""} ${isWrong ? "answer-wrong" : ""} ${attempt && !isCorrect && !isWrong ? "answer-muted" : ""}`}
              disabled={disabled}
              onClick={() => onAnswer(index)}
              aria-label={`${"ABCD"[index]}. ${option}`}
            >
              <kbd>{"ABCD"[index]}</kbd>
              <span>
                <MathText content={option} inline />
              </span>
              <span className="answer-end">
                {isCorrect ? (
                  <Check size={19} />
                ) : isWrong ? (
                  <X size={19} />
                ) : (
                  <small>{index + 1}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
