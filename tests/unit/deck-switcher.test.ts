import { describe, expect, it, beforeEach } from "vitest";
import {
  readLibrary,
  saveStudyItem,
  deleteStudyItem,
  type SavedStudyItem,
} from "@/lib/game/library";
import { documentFromPack } from "@/lib/game/pack-transfer";
import { mockMicroeconomics, mockMicroeconomicsDoc } from "@/data/mock-microeconomics";
import { createGame, gameReducer } from "@/lib/game/reducer";
import type { StudyPack } from "@/lib/schemas/question";

const customBiologyPack: StudyPack = {
  id: "bio-101-pack",
  title: "Cell Biology 101",
  subtitle: "Organelles, mitosis, and energy systems",
  questions: [
    {
      id: "bio-q1",
      question: "Which organelle generates the majority of ATP in eukaryotic cells?",
      options: ["Mitochondria", "Ribosome", "Endoplasmic reticulum", "Golgi apparatus"],
      correctIndex: 0,
      explanation: "Mitochondria produce ATP through oxidative phosphorylation.",
      conceptVariant: {
        question: "Oxidative phosphorylation occurs primarily inside which organelle?",
        options: ["Mitochondria", "Ribosome", "Endoplasmic reticulum", "Golgi apparatus"],
        correctIndex: 0,
        explanation: "Mitochondria are the primary site of oxidative phosphorylation.",
      },
    },
    {
      id: "bio-q2",
      question: "What is the primary function of ribosomes?",
      options: ["Lipid synthesis", "Protein synthesis", "DNA replication", "Waste digestion"],
      correctIndex: 1,
      explanation: "Ribosomes translate mRNA into polypeptide chains.",
      conceptVariant: {
        question: "Which cellular machinery translates mRNA into polypeptide chains?",
        options: ["Lipid synthesis", "Ribosomes", "DNA polymerase", "Lysosomes"],
        correctIndex: 1,
        explanation: "Ribosomes translate mRNA into proteins.",
      },
    },
  ],
  metadata: {
    "bio-q1": {
      topic: "Cellular Respiration",
      chapter: "Chapter 4",
      citation: "Slide 12",
      rule: "Mitochondria are the powerhouses that generate ATP.",
    },
    "bio-q2": {
      topic: "Protein Synthesis",
      chapter: "Chapter 5",
      citation: "Slide 24",
      rule: "Ribosomes synthesize proteins from amino acids.",
    },
  },
};

describe("Clutch Run deck switching & library management", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {
        mockStorage = {};
      },
    };
    (global as any).window = { localStorage: storageMock };
    (global as any).localStorage = storageMock;
  });

  it("saves and retrieves multiple study packs for quick deck switching", () => {
    const item1: SavedStudyItem = {
      id: customBiologyPack.id,
      title: customBiologyPack.title,
      createdAt: new Date().toISOString(),
      questionCount: customBiologyPack.questions.length,
      format: "pdf",
      fileName: "Biology-Notes.pdf",
      pack: customBiologyPack,
      document: documentFromPack(customBiologyPack, "Biology-Notes.pdf"),
    };

    saveStudyItem(item1);
    const stored = readLibrary();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("bio-101-pack");
    expect(stored[0].title).toBe("Cell Biology 101");
    expect(stored[0].questionCount).toBe(2);
  });

  it("deletes a study pack cleanly from the library", () => {
    const item: SavedStudyItem = {
      id: "deck-to-delete",
      title: "Temp Deck",
      createdAt: new Date().toISOString(),
      questionCount: 1,
      format: "txt",
      fileName: "temp.txt",
      pack: {
        id: "deck-to-delete",
        title: "Temp Deck",
        subtitle: "Temp Subtitle",
        questions: [],
        metadata: {},
      },
      document: {
        format: "txt",
        fileName: "temp.txt",
        characterCount: 0,
        pageCount: null,
        sources: [],
        warnings: [],
      },
    };

    saveStudyItem(item);
    expect(readLibrary()).toHaveLength(1);

    const updated = deleteStudyItem("deck-to-delete");
    expect(updated).toHaveLength(0);
    expect(readLibrary()).toHaveLength(0);
  });

  it("generates a fallback grounded ParsedDocument when switching to an imported pack", () => {
    const doc = documentFromPack(customBiologyPack, "Biology-Notes.pdf");
    expect(doc.fileName).toBe("Biology-Notes.pdf");
    expect(doc.sources.length).toBeGreaterThan(0);
    // Verified citations exist for coach and document viewer
    expect(doc.sources.some((s) => s.text.includes("Mitochondria are the powerhouses"))).toBe(true);
    expect(doc.sources.some((s) => s.label.includes("Slide 12"))).toBe(true);
  });

  it("resets solo game engine and loads new questions when switching active decks", () => {
    // Initial state with default Microeconomics pack (5 questions)
    let state = createGame(mockMicroeconomics.questions);
    expect(state.phase).toBe("ready");
    expect(state.questions).toHaveLength(5);

    // Starting run with initial pack
    state = gameReducer(state, {
      type: "START",
      mode: "exact",
      now: 1000,
    });
    expect(state.phase).toBe("answering");
    expect(state.queue).toHaveLength(5);

    // Simulate switching active pack to customBiologyPack (2 questions)
    state = gameReducer(state, {
      type: "LOAD_PACK",
      questions: customBiologyPack.questions,
    });
    expect(state.phase).toBe("ready");
    expect(state.questions).toHaveLength(2);
    expect(state.attempts).toHaveLength(0);
    expect(state.score).toBe(0);

    // Starting the run uses the switched deck
    state = gameReducer(state, {
      type: "START",
      mode: "exact",
      now: 2000,
    });
    expect(state.phase).toBe("answering");
    expect(state.queue).toHaveLength(2);
    expect(state.queue[0].id).toBe("bio-q1");
    expect(state.lives).toBe(3);
  });
});
