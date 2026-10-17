import { z } from "zod";
import type { Attempt } from "./reducer";
import type { StudyPack, QuestionItem } from "@/lib/schemas/question";

export type MasteryLevel = "mastered" | "learning" | "weak" | "untested";

export const conceptStatsSchema = z.object({
  topic: z.string(),
  totalAttempts: z.number().nonnegative(),
  correctAttempts: z.number().nonnegative(),
  lastAttemptedAt: z.string(),
  consecutiveCorrect: z.number().nonnegative(),
  history: z.array(z.boolean()).max(10),
});

export type ConceptStats = z.infer<typeof conceptStatsSchema>;

const STORAGE_KEY = "clutch:mastery:v1";

export function readMasteryStore(): Record<string, ConceptStats> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const store: Record<string, ConceptStats> = {};
    for (const [key, val] of Object.entries(parsed)) {
      const res = conceptStatsSchema.safeParse(val);
      if (res.success) {
        store[key] = res.data;
      }
    }
    return store;
  } catch {
    return {};
  }
}

export function saveMasteryStore(store: Record<string, ConceptStats>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* Storage unavailable or full */
  }
  void syncMasteryStoreToCloud(store);
}

export function normalizeTopicKey(topic: string): string {
  return topic.trim().toLowerCase();
}

export function recordConceptAttempt(
  topic: string,
  correct: boolean,
): ConceptStats {
  const store = readMasteryStore();
  const key = normalizeTopicKey(topic);
  const existing = store[key] || {
    topic: topic.trim(),
    totalAttempts: 0,
    correctAttempts: 0,
    lastAttemptedAt: new Date().toISOString(),
    consecutiveCorrect: 0,
    history: [],
  };

  const updated: ConceptStats = {
    topic: existing.topic || topic.trim(),
    totalAttempts: existing.totalAttempts + 1,
    correctAttempts: existing.correctAttempts + (correct ? 1 : 0),
    lastAttemptedAt: new Date().toISOString(),
    consecutiveCorrect: correct ? existing.consecutiveCorrect + 1 : 0,
    history: [...existing.history.slice(-9), correct],
  };

  store[key] = updated;
  saveMasteryStore(store);
  return updated;
}

export function recordRunMastery(
  pack: StudyPack,
  attempts: Attempt[],
): Record<string, ConceptStats> {
  const store = readMasteryStore();

  for (const attempt of attempts) {
    const meta = pack.metadata[attempt.id];
    const topic = meta?.topic || attempt.id;
    const key = normalizeTopicKey(topic);

    const existing = store[key] || {
      topic: topic.trim(),
      totalAttempts: 0,
      correctAttempts: 0,
      lastAttemptedAt: new Date().toISOString(),
      consecutiveCorrect: 0,
      history: [],
    };

    const updated: ConceptStats = {
      topic: existing.topic || topic.trim(),
      totalAttempts: existing.totalAttempts + 1,
      correctAttempts: existing.correctAttempts + (attempt.correct ? 1 : 0),
      lastAttemptedAt: new Date().toISOString(),
      consecutiveCorrect: attempt.correct ? existing.consecutiveCorrect + 1 : 0,
      history: [...existing.history.slice(-9), attempt.correct],
    };

    store[key] = updated;
  }

  saveMasteryStore(store);
  return store;
}

export function getMasteryLevel(stats?: ConceptStats | null): {
  score: number;
  level: MasteryLevel;
  label: string;
} {
  if (!stats || stats.totalAttempts === 0) {
    return { score: 0, level: "untested", label: "New" };
  }

  const accuracy = Math.round(
    (stats.correctAttempts / stats.totalAttempts) * 100,
  );

  // Consider recent performance (last 3 attempts)
  const recent = stats.history.slice(-3);
  const recentMissCount = recent.filter((r) => !r).length;

  if (accuracy >= 80 && stats.totalAttempts >= 2 && recentMissCount === 0) {
    return { score: accuracy, level: "mastered", label: `${accuracy}% Mastered` };
  }

  if (accuracy < 60 || recentMissCount >= 2) {
    return { score: accuracy, level: "weak", label: `${accuracy}% Needs Review` };
  }

  return { score: accuracy, level: "learning", label: `${accuracy}% In Progress` };
}

export function getWeakSpotsForPack(
  pack: StudyPack,
  store: Record<string, ConceptStats> = readMasteryStore(),
): {
  questionId: string;
  topic: string;
  stats: ConceptStats | null;
  score: number;
  level: MasteryLevel;
}[] {
  const list = pack.questions.map((q) => {
    const meta = pack.metadata[q.id];
    const topic = meta?.topic || q.id;
    const key = normalizeTopicKey(topic);
    const stats = store[key] || null;
    const { score, level } = getMasteryLevel(stats);
    return {
      questionId: q.id,
      topic,
      stats,
      score,
      level,
    };
  });

  // Filter to items that are either explicitly "weak" or have low accuracy (< 70%)
  return list.filter((item) => item.level === "weak");
}

export function createWeakSpotSprintPack(
  basePack: StudyPack,
  targetCount = 5,
  store: Record<string, ConceptStats> = readMasteryStore(),
): StudyPack {
  const scoredQuestions = basePack.questions.map((q) => {
    const meta = basePack.metadata[q.id];
    const topic = meta?.topic || q.id;
    const key = normalizeTopicKey(topic);
    const stats = store[key] || null;
    const { score, level } = getMasteryLevel(stats);

    // Sorting weight: weak spots first, then lowest accuracy, then untested
    let weight = score;
    if (level === "weak") weight -= 100;
    else if (level === "untested") weight = 40; // prioritize untested before mastered

    return { question: q, weight, level };
  });

  // Sort lowest weight first (highest need for practice)
  scoredQuestions.sort((a, b) => a.weight - b.weight);

  const selectedQuestions = scoredQuestions
    .slice(0, Math.min(targetCount, basePack.questions.length))
    .map((item) => item.question);

  const newMetadata: StudyPack["metadata"] = {};
  for (const q of selectedQuestions) {
    if (basePack.metadata[q.id]) {
      newMetadata[q.id] = basePack.metadata[q.id];
    }
  }

  return {
    id: `${basePack.id}-weak-spots`,
    title: `${basePack.title} · Comeback Sprint`,
    subtitle: `Targeted practice focusing on ${selectedQuestions.length} concepts needing review`,
    questions: selectedQuestions,
    metadata: newMetadata,
  };
}

/**
 * Syncs the entire mastery store to Supabase under auth.uid()
 */
export async function syncMasteryStoreToCloud(
  store: Record<string, ConceptStats>,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return false;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const entries = Object.values(store);
    if (entries.length === 0) return true;

    const rows = entries.map((entry) => ({
      user_id: user.id,
      topic: entry.topic,
      total_attempts: entry.totalAttempts,
      correct_attempts: entry.correctAttempts,
      consecutive_correct: entry.consecutiveCorrect,
      last_attempted_at: entry.lastAttemptedAt,
      history: entry.history,
    }));

    const { error } = await supabase.from("user_concept_mastery").upsert(rows);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Fetches mastery statistics from Supabase for the authenticated user
 * and merges into local storage.
 */
export async function fetchCloudMastery(): Promise<Record<string, ConceptStats>> {
  if (typeof window === "undefined") return readMasteryStore();
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return readMasteryStore();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return readMasteryStore();

    const { data, error } = await supabase
      .from("user_concept_mastery")
      .select("topic, total_attempts, correct_attempts, consecutive_correct, last_attempted_at, history");

    if (error || !data) return readMasteryStore();

    const store: Record<string, ConceptStats> = {};
    for (const row of data) {
      const key = normalizeTopicKey(row.topic);
      store[key] = {
        topic: row.topic,
        totalAttempts: row.total_attempts,
        correctAttempts: row.correct_attempts,
        consecutiveCorrect: row.consecutive_correct,
        lastAttemptedAt: row.last_attempted_at,
        history: Array.isArray(row.history) ? row.history : [],
      };
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return store;
  } catch {
    return readMasteryStore();
  }
}

/**
 * Migrates local guest mastery to Supabase when a user registers.
 */
export async function migrateGuestMasteryToUser(
  userId: string,
): Promise<Record<string, ConceptStats>> {
  if (typeof window === "undefined") return {};
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return {};

    const localStore = readMasteryStore();
    const entries = Object.values(localStore);
    if (entries.length > 0) {
      const rows = entries.map((entry) => ({
        user_id: userId,
        topic: entry.topic,
        total_attempts: entry.totalAttempts,
        correct_attempts: entry.correctAttempts,
        consecutive_correct: entry.consecutiveCorrect,
        last_attempted_at: entry.lastAttemptedAt,
        history: entry.history,
      }));

      await supabase.from("user_concept_mastery").upsert(rows);
    }

    return await fetchCloudMastery();
  } catch {
    return {};
  }
}

export function clearSessionMastery(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, "{}");
  } catch {
    // ignore
  }
}
