import type { StudyPack } from "@/lib/schemas/question";
import type { ParsedDocument, SourceReference } from "@/lib/schemas/ingestion";
import * as self from "./library";

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

export const STORAGE_KEY = "clutch:saved-packs:v1";
export const USER_SCOPED_STORAGE_PREFIX = "clutch:library:";
export const KEY = "clutch:library:v1";
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
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      raw = localStorage.getItem(STORAGE_KEY);
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_LIBRARY_ITEMS);
  } catch {
    return [];
  }
}

export interface SaveStudyItemOptions {
  overwrite?: boolean;
  skipCloudSync?: boolean;
}

/**
 * Computes a deterministic content fingerprint for a study pack.
 * Incorporates title, subtitle, sorted metadata, and canonical questions
 * so packs with identical questions but altered metadata or title produce distinct fingerprints.
 */
export function packQuestionsFingerprint(pack: StudyPack): string {
  if (!pack) return "";
  const title = (pack.title ?? "").trim();
  const subtitle = (pack.subtitle ?? "").trim();

  const metaObj = pack.metadata ?? {};
  const sortedMetaKeys = Object.keys(metaObj).sort();
  const canonicalMeta: Record<string, unknown> = {};
  for (const k of sortedMetaKeys) {
    canonicalMeta[k] = metaObj[k];
  }

  const questions = (pack.questions ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    conceptVariant: q.conceptVariant,
  }));

  const canonicalString = JSON.stringify({
    title,
    subtitle,
    metadata: canonicalMeta,
    questions,
  });

  // Deterministic 64-bit hash (cyrb53-based two-pass)
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c64e6d ^ 0;
  for (let i = 0; i < canonicalString.length; i++) {
    const ch = canonicalString.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  let h3 = 0xdeadbeef ^ 42;
  let h4 = 0x41c64e6d ^ 42;
  for (let i = 0; i < canonicalString.length; i++) {
    const ch = canonicalString.charCodeAt(i);
    h3 = Math.imul(h3 ^ ch, 2654435761);
    h4 = Math.imul(h4 ^ ch, 1597334677);
  }
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507);
  h3 ^= Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507);
  h4 ^= Math.imul(h3 ^ (h3 >>> 13), 3266489909);

  const part1 = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  const part2 = (4294967296 * (2097151 & h4) + (h3 >>> 0)).toString(16).padStart(14, "0");

  return `fp_${part1}${part2}`;
}

export function isLibraryIdCollision(id: string, incomingPack?: StudyPack): boolean {
  const existing = getStudyItem(id);
  if (!existing) return false;
  if (!incomingPack) return true;
  return (
    existing.title !== incomingPack.title ||
    existing.questionCount !== incomingPack.questions.length ||
    packQuestionsFingerprint(existing.pack) !== packQuestionsFingerprint(incomingPack)
  );
}

export function saveStudyItem(
  item: SavedStudyItem,
  options?: SaveStudyItemOptions,
): SavedStudyItem[] {
  if (typeof window === "undefined") return [];
  const current = readLibrary();
  const existing = current.find((i) => i.id === item.id);

  let itemToSave = item;

  if (existing) {
    if (options?.overwrite) {
      itemToSave = item;
    } else {
      const isIdentical =
        existing.title === item.title &&
        existing.questionCount === item.questionCount &&
        packQuestionsFingerprint(existing.pack) === packQuestionsFingerprint(item.pack);

      if (!isIdentical) {
        // Prevent silent overwrite of an existing deck by assigning a fresh collision-safe ID
        const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const newId = `${item.id}-copy-${suffix}`;
        itemToSave = {
          ...item,
          id: newId,
          pack: {
            ...item.pack,
            id: newId,
          },
        };
      }
    }
  }

  const currentWithoutItem = current.filter((i) => i.id !== itemToSave.id);
  const updated = [itemToSave, ...currentWithoutItem].slice(0, MAX_LIBRARY_ITEMS);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // If quota exceeded, try dropping the oldest half
    try {
      const trimmed = updated.slice(0, Math.max(1, Math.floor(updated.length / 2)));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      notifyLibraryUpdated();
      if (!options?.skipCloudSync) {
        void (self.syncStudyItemToCloud ?? syncStudyItemToCloud)(itemToSave);
      }
      return trimmed;
    } catch {
      /* Storage full or blocked */
    }
  }
  notifyLibraryUpdated();
  if (!options?.skipCloudSync) {
    void (self.syncStudyItemToCloud ?? syncStudyItemToCloud)(itemToSave);
  }
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
 * Purges all per-user library caches (`clutch:library:*`) and legacy storage (`clutch:saved-packs:v1`)
 * from localStorage when a user signs out so private study decks never leak into public/shared computers.
 */
export function clearLocalLibraryCaches(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(USER_SCOPED_STORAGE_PREFIX) || k === STORAGE_KEY)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    // Storage access may be restricted
  }
}

/**
 * Resets the local session library when a user signs out so an account's decks
 * do not leak onto the public/shared computer for another guest.
 */
export function clearSessionLibrary(): void {
  if (typeof window === "undefined") return;
  try {
    clearLocalLibraryCaches();
    localStorage.removeItem("clutch:guest_usage:v1");
  } catch {
    // ignore
  }
  notifyLibraryUpdated();
}

// Auto-register sign-out listener to purge local caches when Supabase auth signs out
if (typeof window !== "undefined") {
  try {
    import("@/lib/supabase/client")
      .then(({ getSupabaseBrowserClient }) => {
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          supabase.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
              clearLocalLibraryCaches();
            }
          });
        }
      })
      .catch(() => {});
  } catch {
    // ignore
  }
}


