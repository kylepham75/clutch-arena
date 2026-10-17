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

export const LIBRARY_UPDATED_EVENT = "clutch:library-updated";

export function notifyLibraryUpdated(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(LIBRARY_UPDATED_EVENT));
    } catch {
      // In non-browser or test runners where CustomEvent is unavailable
    }
  }
}

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
      notifyLibraryUpdated();
      void syncStudyItemToCloud(item);
      return trimmed;
    } catch {
      /* Storage full or blocked */
    }
  }
  notifyLibraryUpdated();
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
  notifyLibraryUpdated();

  // Delete from cloud if user is signed in
  void (async () => {
    try {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("user_study_packs")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id);
      }
    } catch {
      // ignore
    }
  })();

  return updated;
}

export function getStudyItem(id: string): SavedStudyItem | undefined {
  return readLibrary().find((i) => i.id === id);
}

/**
 * Saves or updates a single study item in Supabase user_study_packs table
 */
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

/**
 * Fetches all study packs belonging to the logged-in user from Supabase.
 * Loads only this account's study packs into the active session.
 */
export async function fetchCloudLibrary(): Promise<SavedStudyItem[]> {
  if (typeof window === "undefined") return [];
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return readLibrary();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return readLibrary();

    const { data, error } = await supabase
      .from("user_study_packs")
      .select("id, title, question_count, pack, document, created_at")
      .order("created_at", { ascending: false });

    if (error || !data) return readLibrary();

    const cloudItems: SavedStudyItem[] = data.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      questionCount: row.question_count,
      format: (row.document?.format as any) || "txt",
      fileName: (row.document?.fileName as string) || `${row.title}.clutch.json`,
      pack: row.pack,
      document: row.document,
    }));

    // Cache locally for this user session
    localStorage.setItem(KEY, JSON.stringify(cloudItems));
    localStorage.setItem(`clutch:library:${user.id}`, JSON.stringify(cloudItems));
    notifyLibraryUpdated();

    return cloudItems;
  } catch {
    return readLibrary();
  }
}

/**
 * Migrates temporary anonymous guest study packs into a brand-new user account.
 * Only called when a fresh user signs up.
 */
export async function migrateGuestLibraryToUser(userId: string): Promise<SavedStudyItem[]> {
  if (typeof window === "undefined") return [];
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const guestItems = readLibrary();
    if (guestItems.length > 0) {
      const rows = guestItems.map((item) => ({
        id: item.id,
        user_id: userId,
        title: item.title,
        question_count: item.questionCount,
        pack: item.pack,
        document: item.document,
        created_at: item.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      await supabase.from("user_study_packs").upsert(rows);
    }

    // Reset guest usage counter now that they have created an account
    localStorage.removeItem("clutch:guest_usage:v1");

    const cloudDecks = await fetchCloudLibrary();
    notifyLibraryUpdated();
    return cloudDecks;
  } catch {
    return [];
  }
}

/**
 * Resets the local session library when a user signs out so an account's decks
 * do not leak onto the public/shared computer for another guest.
 */
export function clearSessionLibrary(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, "[]");
    localStorage.removeItem("clutch:guest_usage:v1");
  } catch {
    // ignore
  }
  notifyLibraryUpdated();
}

