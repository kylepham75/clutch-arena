import { z } from "zod";
import type { StudyPack } from "@/lib/schemas/question";
import type { ParsedDocument, SourceReference } from "@/lib/schemas/ingestion";

export type SavedStudyItem = {
  id: string;
  title: string;
  createdAt: string;
  questionCount: number;
  format: ParsedDocument["format"];
  fileName: string;
  pack: StudyPack;
  document: ParsedDocument;
  references?: Record<string, SourceReference>;
};

const KEY = "clutch:library:v1";
const MAX_LIBRARY_ITEMS = 25;

export function readLibrary(): SavedStudyItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_LIBRARY_ITEMS);
  } catch {
    return [];
  }
}

export function saveStudyItem(item: SavedStudyItem): SavedStudyItem[] {
  if (typeof window === "undefined") return [];
  const current = readLibrary().filter((i) => i.id !== item.id);
  const updated = [item, ...current].slice(0, MAX_LIBRARY_ITEMS);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // If quota exceeded, try dropping the oldest half
    try {
      const trimmed = updated.slice(0, Math.max(1, Math.floor(updated.length / 2)));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      /* Storage full or blocked */
    }
  }
  void syncStudyItemToCloud(item);
  return updated;
}

export function deleteStudyItem(id: string): SavedStudyItem[] {
  if (typeof window === "undefined") return [];
  const updated = readLibrary().filter((i) => i.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    /* Storage blocked */
  }
  return updated;
}

export function getStudyItem(id: string): SavedStudyItem | undefined {
  return readLibrary().find((i) => i.id === id);
}

export async function syncStudyItemToCloud(item: SavedStudyItem): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return false;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.from("user_study_packs").upsert({
      id: item.id,
      user_id: user.id,
      title: item.title,
      question_count: item.questionCount,
      pack: item.pack,
      document: item.document,
      updated_at: new Date().toISOString(),
    });

    return !error;
  } catch {
    return false;
  }
}
