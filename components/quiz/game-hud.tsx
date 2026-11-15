import { Clock3, Flame, Heart, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { streakLabel } from "@/lib/game/scoring";
import type { GameState } from "@/lib/game/reducer";
import { useLanguage } from "@/lib/i18n/context";

export function GameHud({
  state,
  onToggleUntimed,
}: {
  state: GameState;
  onToggleUntimed?: () => void;
}) {
  const { t, language } = useLanguage();
  const isVi = language === "vi";

  return (
    <div
      className="game-hud"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
      }}
    >
      <div className="hud-cell">
        <span className="hud-label">
          <Zap size={15} />
          {t.run.score}
        </span>
        <strong data-testid="score">
          {state.score.toLocaleString()}
          <small> XP</small>
        </strong>
      </div>
      <div className={`hud-cell ${state.streak >= 3 ? "streak-hot" : ""}`}>
        <span className="hud-label">
          <Flame size={15} />
          {t.run.streak}
        </span>
        <strong>
          <span data-testid="streak">{state.streak}</span>
          <span className="multiplier">{streakLabel(state.streak)}</span>
        </strong>
      </div>
      <div className="hud-cell">
        <span className="hud-label">{t.run.livesHud}</span>
        <div
          className="hearts"
          aria-label={`${state.lives} ${t.run.livesRemainingAria}`}
          data-testid="lives"
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              animate={{ scale: i < state.lives ? 1 : 0.85 }}
            >
              <Heart
                size={25}
                strokeWidth={1.7}
                className={i < state.lives ? "heart-alive" : "heart-lost"}
                fill={i < state.lives ? "currentColor" : "none"}
              />
            </motion.span>
          ))}
        </div>
      </div>
      <button
        type="button"
        data-testid="hud-untimed-toggle"
        aria-pressed={Boolean(state.untimed)}
        onClick={() => onToggleUntimed?.()}
        className={`hud-cell cursor-pointer text-left transition-all rounded-lg p-1.5 flex flex-col justify-center border-0 ${
          state.untimed
            ? "bg-amber-500/10 hover:bg-amber-500/15 text-amber-900 dark:text-amber-200"
            : "hover:bg-stone-50 dark:hover:bg-stone-800/50 text-stone-700 dark:text-stone-300"
        }`}
        title={
          state.untimed
            ? isVi
              ? "Bỏ giới hạn 15s, đáp án hiện ngay khi chọn sai. Nhấn để bật lại 15s."
              : "Untimed Cram active. Click to switch to 15s timer."
            : isVi
              ? "Đang tính giờ 15s/câu. Nhấn để chuyển sang Ôn cấp tốc không giới hạn."
              : "15s timer active. Click to switch to Untimed Cram."
        }
      >
        <span className="hud-label flex items-center gap-1.5 text-[11px]">
          <Clock3
            size={14}
            className={state.untimed ? "text-amber-600" : "text-stone-400"}
          />
          {isVi ? "Chế độ giờ" : "Timer Mode"}
        </span>
        <strong className="text-xs sm:text-[13px] font-bold mt-0.5 leading-snug">
          {state.untimed
            ? isVi
              ? "Không giới hạn giờ · Giải ngay"
              : "Untimed Cram · Instant"
            : isVi
              ? "Đếm ngược 15s · Bật Không giới hạn"
              : "15s Timed · Switch to Untimed"}
        </strong>
      </button>
    </div>
  );
}
