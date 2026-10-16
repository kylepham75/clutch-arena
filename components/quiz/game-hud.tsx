import { Flame, Heart, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { streakLabel } from "@/lib/game/scoring";
import type { GameState } from "@/lib/game/reducer";
import { useLanguage } from "@/lib/i18n/context";

export function GameHud({ state }: { state: GameState }) {
  const { language, t } = useLanguage();
  return (
    <div className="game-hud">
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
        <span className="hud-label">{language === "vi" ? "CƠ HỘI" : "LIVES"}</span>
        <div
          className="hearts"
          aria-label={`${state.lives} lives remaining`}
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
    </div>
  );
}
