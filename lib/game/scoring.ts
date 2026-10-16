import { BASE_POINTS } from "./constants";
export function multiplierForStreak(streak: number): number {
  if (streak >= 5) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}
export function pointsForStreak(streak: number): number {
  return BASE_POINTS * multiplierForStreak(streak);
}
export function streakLabel(streak: number): string {
  return streak >= 7 ? "ON FIRE" : `${multiplierForStreak(streak).toFixed(1)}×`;
}
