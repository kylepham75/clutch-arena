import { z } from "zod";
const resultSchema = z.object({
  id: z.string(),
  date: z.string(),
  score: z.number().nonnegative(),
  correct: z.number().nonnegative(),
  total: z.number().nonnegative(),
  bestStreak: z.number().nonnegative(),
});
export type SavedRun = z.infer<typeof resultSchema>;
const KEY = "clutch:runs:v1";
export function readHistory(): SavedRun[] {
  try {
    const parsed = z
      .array(resultSchema)
      .safeParse(JSON.parse(localStorage.getItem(KEY) || "[]"));
    return parsed.success ? parsed.data.slice(0, 50) : [];
  } catch {
    return [];
  }
}
export function saveRun(run: SavedRun): SavedRun[] {
  const history = [run, ...readHistory().filter((r) => r.id !== run.id)].slice(
    0,
    50,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(history));
  } catch {
    /* Runs remain playable if storage is blocked or full. */
  }
  return history;
}
