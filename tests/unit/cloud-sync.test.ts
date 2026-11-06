import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import {
  readHistory,
  saveRun,
  syncRunToCloud,
  clearSessionHistory,
  type SavedRun,
} from "@/lib/game/history";
import {
  readMasteryStore,
  saveMasteryStore,
  recordConceptAttempt,
  syncMasteryStoreToCloud,
  clearSessionMastery,
} from "@/lib/game/concept-mastery";
import * as library from "@/lib/game/library";

describe("Cloud Sync & LocalStorage Migration", () => {
  let memoryStore: Record<string, string> = {};

  beforeAll(() => {
    const mockStorage = {
      getItem: (k: string) => memoryStore[k] ?? null,
      setItem: (k: string, v: string) => {
        memoryStore[k] = v;
      },
      removeItem: (k: string) => {
        delete memoryStore[k];
      },
      clear: () => {
        memoryStore = {};
      },
    };
    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).window = { localStorage: mockStorage };
  });

  beforeEach(() => {
    memoryStore = {};
  });

  it("saves and reads local run history correctly", () => {
    const run: SavedRun = {
      id: "run-1",
      date: new Date().toISOString(),
      score: 1200,
      correct: 8,
      total: 10,
      bestStreak: 5,
    };

    saveRun(run);
    const history = readHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe("run-1");
    expect(history[0].score).toBe(1200);
  });

  it("clears session history on logout", () => {
    const run: SavedRun = {
      id: "run-2",
      date: new Date().toISOString(),
      score: 800,
      correct: 6,
      total: 10,
      bestStreak: 3,
    };

    saveRun(run);
    expect(readHistory().length).toBe(1);
    clearSessionHistory();
    expect(readHistory().length).toBe(0);
  });

  it("records concept attempts and clears session mastery on logout", () => {
    recordConceptAttempt("Marginal Revenue", true);
    recordConceptAttempt("Marginal Revenue", false);

    const store = readMasteryStore();
    expect(store["marginal revenue"]).toBeDefined();
    expect(store["marginal revenue"].totalAttempts).toBe(2);
    expect(store["marginal revenue"].correctAttempts).toBe(1);

    clearSessionMastery();
    const emptyStore = readMasteryStore();
    expect(Object.keys(emptyStore).length).toBe(0);
  });

  it("handles unconfigured cloud sync gracefully without throwing", async () => {
    const run: SavedRun = {
      id: "run-3",
      date: new Date().toISOString(),
      score: 950,
      correct: 7,
      total: 10,
      bestStreak: 4,
    };

    // When Supabase is offline/unauthenticated, returns false safely without throwing
    const runSyncResult = await syncRunToCloud(run);
    expect(typeof runSyncResult).toBe("boolean");

    const masterySyncResult = await syncMasteryStoreToCloud({
      "test topic": {
        topic: "test topic",
        totalAttempts: 1,
        correctAttempts: 1,
        consecutiveCorrect: 1,
        lastAttemptedAt: new Date().toISOString(),
        history: [true],
      },
    });
    expect(typeof masterySyncResult).toBe("boolean");
  });

  it("saveStudyItem with skipCloudSync: true does not call syncStudyItemToCloud", () => {
    const syncSpy = vi.spyOn(library, "syncStudyItemToCloud").mockResolvedValue(true);

    const testItem: library.SavedStudyItem = {
      id: "shared-unconfirmed-deck-1",
      title: "Shared Economics Review",
      createdAt: new Date().toISOString(),
      questionCount: 0,
      format: "txt",
      fileName: "review.json",
      pack: {
        id: "shared-unconfirmed-deck-1",
        title: "Shared Economics Review",
        subtitle: "Unit test deck",
        questions: [],
        metadata: {},
      },
      document: {
        format: "txt",
        fileName: "review.json",
        characterCount: 100,
        pageCount: null,
        sources: [],
        warnings: [],
      },
    };

    // Save with skipCloudSync: true
    library.saveStudyItem(testItem, { skipCloudSync: true });

    // Verify item saved locally in localStorage
    expect(library.readLibrary().some((i) => i.id === "shared-unconfirmed-deck-1")).toBe(true);

    // Verify syncStudyItemToCloud was NOT called
    expect(syncSpy).not.toHaveBeenCalled();

    // Now save without skipCloudSync and verify syncStudyItemToCloud IS called
    library.saveStudyItem(testItem);
    expect(syncSpy).toHaveBeenCalledWith(testItem);

    syncSpy.mockRestore();
  });
});
