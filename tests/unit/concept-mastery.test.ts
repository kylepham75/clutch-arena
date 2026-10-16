import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  readMasteryStore,
  saveMasteryStore,
  recordConceptAttempt,
  recordRunMastery,
  getMasteryLevel,
  getWeakSpotsForPack,
  createWeakSpotSprintPack,
} from "@/lib/game/concept-mastery";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { Attempt } from "@/lib/game/reducer";

describe("Concept Mastery & Weak Spot Sprint Generation", () => {
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

  it("initializes with an empty store and handles recording single attempts", () => {
    expect(readMasteryStore()).toEqual({});

    const stats1 = recordConceptAttempt("Price Elasticity of Demand", true);
    expect(stats1.totalAttempts).toBe(1);
    expect(stats1.correctAttempts).toBe(1);
    expect(stats1.consecutiveCorrect).toBe(1);
    expect(stats1.history).toEqual([true]);

    const stats2 = recordConceptAttempt("Price Elasticity of Demand", false);
    expect(stats2.totalAttempts).toBe(2);
    expect(stats2.correctAttempts).toBe(1);
    expect(stats2.consecutiveCorrect).toBe(0);
    expect(stats2.history).toEqual([true, false]);
  });

  it("accurately categorizes mastery levels", () => {
    // Untested
    expect(getMasteryLevel(null).level).toBe("untested");

    // Mastered: >= 80%, >= 2 attempts, no recent misses
    const masteredStats = {
      topic: "Opportunity Cost",
      totalAttempts: 5,
      correctAttempts: 5,
      lastAttemptedAt: new Date().toISOString(),
      consecutiveCorrect: 5,
      history: [true, true, true, true, true],
    };
    const mastered = getMasteryLevel(masteredStats);
    expect(mastered.level).toBe("mastered");
    expect(mastered.score).toBe(100);

    // Weak: < 60%
    const weakStats = {
      topic: "Price Ceilings",
      totalAttempts: 3,
      correctAttempts: 1,
      lastAttemptedAt: new Date().toISOString(),
      consecutiveCorrect: 0,
      history: [false, true, false],
    };
    const weak = getMasteryLevel(weakStats);
    expect(weak.level).toBe("weak");
    expect(weak.score).toBe(33);

    // Learning: 60 - 79%
    const learningStats = {
      topic: "Cross-Price Elasticity",
      totalAttempts: 3,
      correctAttempts: 2,
      lastAttemptedAt: new Date().toISOString(),
      consecutiveCorrect: 1,
      history: [true, false, true],
    };
    const learning = getMasteryLevel(learningStats);
    expect(learning.level).toBe("learning");
    expect(learning.score).toBe(67);
  });

  it("records run attempts in bulk across multiple concepts", () => {
    const attempts: Attempt[] = [
      {
        id: mockMicroeconomics.questions[0].id,
        variant: false,
        correct: false,
        points: 0,
        selected: 0,
      },
      {
        id: mockMicroeconomics.questions[1].id,
        variant: false,
        correct: true,
        points: 100,
        selected: 1,
      },
    ];

    const store = recordRunMastery(mockMicroeconomics, attempts);
    const q0Topic =
      mockMicroeconomics.metadata[mockMicroeconomics.questions[0].id]?.topic ||
      "";
    const q1Topic =
      mockMicroeconomics.metadata[mockMicroeconomics.questions[1].id]?.topic ||
      "";

    expect(store[q0Topic.toLowerCase()]).toBeDefined();
    expect(store[q0Topic.toLowerCase()].correctAttempts).toBe(0);
    expect(store[q1Topic.toLowerCase()]).toBeDefined();
    expect(store[q1Topic.toLowerCase()].correctAttempts).toBe(1);
  });

  it("identifies weak spots and generates a focused sprint pack", () => {
    const q0 = mockMicroeconomics.questions[0];
    const q0Topic = mockMicroeconomics.metadata[q0.id]?.topic || "";

    // Fail q0 twice
    recordConceptAttempt(q0Topic, false);
    recordConceptAttempt(q0Topic, false);

    const weakSpots = getWeakSpotsForPack(mockMicroeconomics);
    expect(weakSpots.length).toBeGreaterThanOrEqual(1);
    expect(weakSpots[0].questionId).toBe(q0.id);

    // Create weak spot sprint pack
    const sprintPack = createWeakSpotSprintPack(mockMicroeconomics, 3);
    expect(sprintPack.title).toContain("Comeback Sprint");
    expect(sprintPack.questions.length).toBe(3);
    // The weakest question must be included first
    expect(sprintPack.questions[0].id).toBe(q0.id);
  });
});
