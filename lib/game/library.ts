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
