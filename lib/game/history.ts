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
  if (typeof window === "undefined") return [];
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
  if (typeof window === "undefined") return [];
  const history = [run, ...readHistory().filter((r) => r.id !== run.id)].slice(
    0,
    50,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(history));
  } catch {
    /* Runs remain playable if storage is blocked or full. */
  }
  // Sync to Supabase in background if user is authenticated
  void syncRunToCloud(run);
  return history;
}

/**
 * Saves a single run to Supabase user_runs table under auth.uid()
 */
export async function syncRunToCloud(run: SavedRun): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return false;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.from("user_runs").upsert({
      id: run.id,
      user_id: user.id,
      date: run.date,
      score: run.score,
      correct: run.correct,
      total: run.total,
      best_streak: run.bestStreak,
    });

    return !error;
  } catch {
    return false;
  }
}

/**
 * Fetches run history for the authenticated user from Supabase.
 * Syncs cloud history into local session storage.
 */
export async function fetchCloudHistory(): Promise<SavedRun[]> {
  if (typeof window === "undefined") return [];
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return readHistory();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return readHistory();

    const { data, error } = await supabase
      .from("user_runs")
      .select("id, date, score, correct, total, best_streak")
      .order("date", { ascending: false })
      .limit(50);

    if (error || !data) return readHistory();

    const runs: SavedRun[] = data.map((row) => ({
      id: row.id,
      date: row.date,
      score: row.score,
      correct: row.correct,
      total: row.total,
      bestStreak: row.best_streak,
    }));

    localStorage.setItem(KEY, JSON.stringify(runs));
    return runs;
  } catch {
    return readHistory();
  }
}

/**
 * Migrates local guest runs to Supabase when a user signs up.
 */
export async function migrateGuestRunsToUser(userId: string): Promise<SavedRun[]> {
  if (typeof window === "undefined") return [];
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const localRuns = readHistory();
    if (localRuns.length > 0) {
      const rows = localRuns.map((r) => ({
        id: r.id,
        user_id: userId,
        date: r.date,
        score: r.score,
        correct: r.correct,
        total: r.total,
        best_streak: r.bestStreak,
      }));

      await supabase.from("user_runs").upsert(rows);
    }

    return await fetchCloudHistory();
  } catch {
    return [];
  }
}

export function clearSessionHistory(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, "[]");
  } catch {
    // ignore
  }
}
