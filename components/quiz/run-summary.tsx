import {
  ArrowRight,
  Check,
  RotateCcw,
  Trophy,
  BookOpen,
  Target,
  Flame,
  Zap,
  Sparkles,
  Download,
  FolderSync,
  FileText,
} from "lucide-react";
import { motion } from "framer-motion";
import type { GameState } from "@/lib/game/reducer";
import type { StudyPack } from "@/lib/schemas/question";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { useLanguage } from "@/lib/i18n/context";

export function RunSummary({
  state,
  pack,
  onRestart,
  onChangeDeck,
  onDebriefCoach,
  onExport,
  onSprintMissed,
  onExportCheatSheet,
}: {
  state: GameState;
  pack: StudyPack;
  onRestart: () => void;
  onChangeDeck?: () => void;
  onDebriefCoach?: () => void;
  onExport?: () => void;
  onSprintMissed?: () => void;
  onExportCheatSheet?: () => void;
}) {
  const { t } = useLanguage();
  const correct = state.attempts.filter((a) => a.correct).length;
  const accuracy = state.attempts.length
    ? Math.round((correct / state.attempts.length) * 100)
    : 0;
  return (
    <motion.section
      className="summary"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="summary-trophy">
        <Trophy size={38} />
      </div>
      <span className="eyebrow">
        {state.lives > 0 ? t.run.summaryEyebrowWon : t.run.summaryEyebrowLost}
      </span>
      <h1>
        {state.lives > 0
          ? t.run.summaryTitleWon
          : t.run.summaryTitleLost}
      </h1>
      <p>
        {state.lives > 0
          ? t.run.summarySubtitleWon
          : t.run.summarySubtitleLost}
      </p>
      <div className="summary-stats">
        <div>
          <Zap size={19} />
          <strong>{state.score}</strong>
          <span>{t.run.xpEarned}</span>
        </div>
        <div>
          <Target size={19} />
          <strong>{accuracy}%</strong>
          <span>
            {t.run.accuracy} · {correct}/{state.attempts.length}
          </span>
        </div>
        <div>
          <Flame size={19} />
          <strong>{state.bestStreak}</strong>
          <span>{t.run.maxStreak}</span>
        </div>
      </div>
      {state.missed.length > 0 ? (
        <div className="summary-review">
          <h3>
            <BookOpen size={18} />
            {t.run.takeaways}
          </h3>
          {state.missed.map((id) => (
            <div className="takeaway" key={id}>
              <span
                className={
                  state.mastery[id] >= 2 ? "mastered-icon" : "review-icon"
                }
              >
                {state.mastery[id] >= 2 ? (
                  <Check size={17} />
                ) : (
                  <RotateCcw size={17} />
                )}
              </span>
              <div>
                <strong>
                  {pack.metadata[id]?.topic || t.nav.workspace}
                  <small>
                    {state.mastery[id] >= 2
                      ? t.run.masteryMastered
                      : t.run.masteryNeedsReview}
                  </small>
                </strong>
                <p>
                  <MathText
                    content={
                      pack.metadata[id]?.rule ||
                      pack.questions.find((q) => q.id === id)?.explanation
                    }
                  />
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="perfect-note">
          <Check size={17} />
          {t.run.perfectRun}
        </div>
      )}
      <div className="summary-actions flex flex-wrap items-center justify-center gap-3">
        {onSprintMissed && state.missed.length > 0 && (
          <Button variant="dark" onClick={onSprintMissed} type="button">
            <Zap size={17} />
            {t.run.weakSpotSprint} ({state.missed.length})
          </Button>
        )}
        {onExportCheatSheet && (
          <Button variant="outline" onClick={onExportCheatSheet} type="button" className="cheat-sheet-btn">
            <FileText size={17} className="text-amber-600" />
            <span>1-Click PDF Cheat Sheet</span>
          </Button>
        )}
        {onExport && (
          <Button variant="outline" onClick={onExport} type="button">
            <Download size={17} />
            {t.run.exportDeck}
          </Button>
        )}
        {onDebriefCoach && (
          <Button variant="outline" onClick={onDebriefCoach} type="button">
            <Sparkles size={17} />
            {t.run.debriefCoach}
          </Button>
        )}
        {onChangeDeck && (
          <Button variant="outline" onClick={onChangeDeck} type="button">
            <FolderSync size={17} />
            {t.run.changeDeck}
          </Button>
        )}
        <Button onClick={onRestart}>
          {t.run.playAgain} <ArrowRight size={17} />
        </Button>
      </div>
      <p className="summary-footnote">
        This run is saved on this device when browser storage is available.
      </p>
    </motion.section>
  );
}
