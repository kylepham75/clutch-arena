import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  ArenaClassAnalytics,
  ArenaPlayer,
  ArenaRoomState,
} from "@/lib/schemas/multiplayer";

// In-memory TSX module loader that transpiles TypeScript & JSX on the fly
// adhering strictly to zero modifications outside authorized files.
const moduleCache = new Map<string, unknown>();

function loadTsxModule<T = Record<string, unknown>>(relPath: string): T {
  let fullPath = path.resolve(relPath);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    if (fs.existsSync(`${fullPath}.ts`)) fullPath = `${fullPath}.ts`;
    else if (fs.existsSync(`${fullPath}.tsx`)) fullPath = `${fullPath}.tsx`;
    else if (fs.existsSync(path.join(fullPath, "index.ts"))) {
      fullPath = path.join(fullPath, "index.ts");
    } else if (fs.existsSync(path.join(fullPath, "index.tsx"))) {
      fullPath = path.join(fullPath, "index.tsx");
    }
  }

  if (moduleCache.has(fullPath)) {
    return moduleCache.get(fullPath) as T;
  }

  const sourceCode = fs.readFileSync(fullPath, "utf8");
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const mod = { exports: {} as Record<string, unknown> };
  moduleCache.set(fullPath, mod.exports);

  const customRequire = (id: string) => {
    if (id === "react") {
      return Object.assign({ default: React }, React);
    }
    if (id.startsWith("@/")) {
      return loadTsxModule(id.replace("@/", "./"));
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(id);
  };

  (globalThis as any).React = React;

  const fn = new Function("require", "module", "exports", transpiled.outputText);
  fn(customRequire, mod, mod.exports);
  moduleCache.set(fullPath, mod.exports);

  return mod.exports as T;
}

interface ArenaPodiumModule {
  ArenaPodium: React.ComponentType<{
    room: ArenaRoomState;
    currentPlayer: ArenaPlayer;
    onRematch: () => void;
    onDebriefCoach?: () => void;
    onLeave: () => void;
  }>;
  buildClassGradebookCsv: (room: ArenaRoomState) => string;
  exportClassGradebookCsv: (room: ArenaRoomState) => string;
}

const {
  ArenaPodium,
  buildClassGradebookCsv,
  exportClassGradebookCsv,
} = loadTsxModule<ArenaPodiumModule>("components/arena/arena-podium.tsx");

function createMockPlayer(overrides: Partial<ArenaPlayer> = {}): ArenaPlayer {
  return {
    id: "p-1",
    nickname: "Alex Host",
    avatar: "⚡",
    score: 1850,
    streak: 5,
    bestStreak: 7,
    lives: 3,
    isReady: true,
    isHost: true,
    isBot: false,
    status: "waiting",
    lastAnswer: null,
    ...overrides,
  };
}

function createMockRoom(overrides: Partial<ArenaRoomState> = {}): ArenaRoomState {
  const hostPlayer = createMockPlayer({ id: "p-1", nickname: "Alex Host", isHost: true, score: 2100 });
  const player2 = createMockPlayer({ id: "p-2", nickname: "Jordan Quick", isHost: false, score: 1750, bestStreak: 4, lives: 2 });
  const player3 = createMockPlayer({ id: "p-3", nickname: "Taylor Fallen", isHost: false, score: 620, bestStreak: 2, lives: 0, status: "eliminated" });

  const classAnalytics: ArenaClassAnalytics = {
    totalPlayers: 3,
    totalQuestions: 5,
    averageAccuracyPercent: 68,
    earlyEliminatedCount: 1,
    earlyEliminatedNicknames: ["Taylor Fallen"],
    questionStats: [
      {
        questionId: "q-1",
        questionNumber: 1,
        questionText: "What organelle produces ATP via cellular respiration?",
        topic: "Cell Biology",
        citation: "Chapter 3.2",
        correctIndex: 1,
        totalAttempts: 3,
        correctCount: 2,
        missedCount: 1,
        missedPercent: 33,
        optionCounts: [0, 2, 1, 0],
        mostCommonWrongOption: 2, // Option C
      },
      {
        questionId: "q-2",
        questionNumber: 2,
        questionText: "Which enzyme unzips DNA during replication?",
        topic: "Genetics",
        citation: "Slide 14",
        correctIndex: 0,
        totalAttempts: 3,
        correctCount: 0,
        missedCount: 3,
        missedPercent: 100,
        optionCounts: [0, 2, 1, 0],
        mostCommonWrongOption: 1, // Option B
      },
      {
        questionId: "q-3",
        questionNumber: 3,
        questionText: "What is the primary function of ribosomes in eukaryotic cells?",
        topic: "Cell Biology",
        correctIndex: 2,
        totalAttempts: 3,
        correctCount: 1,
        missedCount: 2,
        missedPercent: 67,
        optionCounts: [1, 0, 1, 1],
        mostCommonWrongOption: 0, // Option A
      },
      {
        questionId: "q-4",
        questionNumber: 4,
        questionText: "Which phase of mitosis separates sister chromatids?",
        topic: "Cell Division",
        correctIndex: 3,
        totalAttempts: 3,
        correctCount: 3,
        missedCount: 0,
        missedPercent: 0,
        optionCounts: [0, 0, 0, 3],
        mostCommonWrongOption: null,
      },
    ],
  };

  return {
    code: "BIO-101",
    title: "AP Biology Midterm Sprint",
    hostId: "p-1",
    status: "podium",
    currentQuestionIndex: 4,
    totalQuestions: 5,
    roundDeadline: 0,
    feedbackDeadline: 0,
    countdownEndsAt: 0,
    players: {
      "p-1": hostPlayer,
      "p-2": player2,
      "p-3": player3,
    },
    currentQuestion: null,
    revealedFeedback: null,
    createdAt: new Date().toISOString(),
    mode: "exact",
    packId: "pack-bio-1",
    classAnalytics,
    podium: {
      first: hostPlayer,
      second: player2,
      third: player3,
      rankings: [hostPlayer, player2, player3],
    },
    ...overrides,
  };
}

describe("ArenaPodium Post-Match Class Analytics Dashboard", () => {
  it("renders the Post-Match Class Analytics Dashboard (data-testid='class-analytics-dashboard') when room.classAnalytics is populated for host", () => {
    const room = createMockRoom();
    const hostPlayer = room.players["p-1"];

    const html = renderToStaticMarkup(
      React.createElement(ArenaPodium, {
        room,
        currentPlayer: hostPlayer,
        onRematch: vi.fn(),
        onLeave: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="class-analytics-dashboard"');
    expect(html).toContain("Post-Match Class Analytics");
    expect(html).toContain('data-testid="analytics-kpi-strip"');
    expect(html).toContain("Class Average Accuracy");
    expect(html).toContain("68%");
    expect(html).toContain("Total Players");
    expect(html).toContain("3");
    expect(html).toContain("Total Questions");
    expect(html).toContain("5");
    expect(html).toContain('data-testid="export-gradebook-btn"');
    expect(html).toContain("Export Gradebook CSV");
  });

  it("does not render the dashboard when room.classAnalytics is null or empty", () => {
    const roomNoAnalytics = createMockRoom({ classAnalytics: null });
    const hostPlayer = roomNoAnalytics.players["p-1"];

    const html = renderToStaticMarkup(
      React.createElement(ArenaPodium, {
        room: roomNoAnalytics,
        currentPlayer: hostPlayer,
        onRematch: vi.fn(),
        onLeave: vi.fn(),
      }),
    );

    expect(html).not.toContain('data-testid="class-analytics-dashboard"');
    expect(html).not.toContain('data-testid="export-gradebook-btn"');
    expect(html).not.toContain('data-testid="toggle-analytics-btn"');
  });

  it("renders early elimination diagnostic alert banner when earlyEliminatedCount > 0", () => {
    const room = createMockRoom();
    const hostPlayer = room.players["p-1"];

    const html = renderToStaticMarkup(
      React.createElement(ArenaPodium, {
        room,
        currentPlayer: hostPlayer,
        onRematch: vi.fn(),
        onLeave: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="early-elimination-alert"');
    expect(html).toContain("1 student(s) (Taylor Fallen) lost all 3 hearts before Round 5.");
  });

  it("does not render early elimination diagnostic alert when earlyEliminatedCount is 0", () => {
    const room = createMockRoom();
    if (room.classAnalytics) {
      room.classAnalytics = {
        ...room.classAnalytics,
        earlyEliminatedCount: 0,
        earlyEliminatedNicknames: [],
      };
    }
    const hostPlayer = room.players["p-1"];

    const html = renderToStaticMarkup(
      React.createElement(ArenaPodium, {
        room,
        currentPlayer: hostPlayer,
        onRematch: vi.fn(),
        onLeave: vi.fn(),
      }),
    );

    expect(html).not.toContain('data-testid="early-elimination-alert"');
  });

  it("sorts missed questions worst-first by missedPercent descending and displays rate, Needs Re-Teach badge, and trap options", () => {
    const room = createMockRoom();
    const hostPlayer = room.players["p-1"];

    const html = renderToStaticMarkup(
      React.createElement(ArenaPodium, {
        room,
        currentPlayer: hostPlayer,
        onRematch: vi.fn(),
        onLeave: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="missed-questions-list"');

    // Individual stat items
    expect(html).toContain('data-testid="question-stat-2"'); // 100% missed
    expect(html).toContain('data-testid="question-stat-3"'); // 67% missed
    expect(html).toContain('data-testid="question-stat-1"'); // 33% missed
    expect(html).toContain('data-testid="question-stat-4"'); // 0% missed

    // Sorting order verification: Q2 (100%) should appear before Q3 (67%), which appears before Q1 (33%), then Q4 (0%)
    const posQ2 = html.indexOf('data-testid="question-stat-2"');
    const posQ3 = html.indexOf('data-testid="question-stat-3"');
    const posQ1 = html.indexOf('data-testid="question-stat-1"');
    const posQ4 = html.indexOf('data-testid="question-stat-4"');

    expect(posQ2).toBeLessThan(posQ3);
    expect(posQ3).toBeLessThan(posQ1);
    expect(posQ1).toBeLessThan(posQ4);

    // Q2 details (100% missed, Needs Re-Teach, Option B trap)
    expect(html).toContain("100% missed (3/3)");
    expect(html).toContain("Needs Re-Teach");
    expect(html).toContain("Top trap: Option B");

    // Q3 details (67% missed, Needs Re-Teach, Option A trap)
    expect(html).toContain("67% missed (2/3)");
    expect(html).toContain("Top trap: Option A");

    // Q1 details (33% missed, below 50% so NO Needs Re-Teach, Option C trap)
    expect(html).toContain("33% missed (1/3)");
    expect(html).toContain("Top trap: Option C");

    // Q4 details (0% missed, no trap option)
    expect(html).toContain("0% missed (0/3)");
    expect(html).not.toContain("Top trap: Option None");
  });

  it("provides toggle button for non-host player with collapsed initial state", () => {
    const room = createMockRoom();
    const nonHostPlayer = room.players["p-2"];

    const html = renderToStaticMarkup(
      React.createElement(ArenaPodium, {
        room,
        currentPlayer: nonHostPlayer,
        onRematch: vi.fn(),
        onLeave: vi.fn(),
      }),
    );

    // For non-host, dashboard is not rendered by default, but toggle button is present
    expect(html).toContain('data-testid="toggle-analytics-btn"');
    expect(html).toContain("View Class Analytics");
    expect(html).not.toContain('data-testid="class-analytics-dashboard"');
  });
});

describe("buildClassGradebookCsv & exportClassGradebookCsv helper", () => {
  it("exports identical functions under both names", () => {
    expect(exportClassGradebookCsv).toBe(buildClassGradebookCsv);
  });

  it("produces valid CSV rows for player rankings and per-question class diagnostics sorted worst-first", () => {
    const room = createMockRoom();
    const csv = buildClassGradebookCsv(room);

    // Header validations
    expect(csv).toContain("Rank,Nickname,Score XP,Best Streak,Lives Remaining,Status");
    expect(csv).toContain(
      "Question #,Topic,Question,Total Attempts,Correct,Missed,Missed %,Top Wrong Option",
    );

    // Player rows
    expect(csv).toContain("1,Alex Host,2100,7,3,waiting");
    expect(csv).toContain("2,Jordan Quick,1750,4,2,waiting");
    expect(csv).toContain("3,Taylor Fallen,620,2,0,eliminated");

    // Per-question diagnostic rows (sorted worst-first: Q2=100%, Q3=67%, Q1=33%, Q4=0%)
    const lines = csv.split("\r\n");
    const q2Line = lines.find((l) => l.startsWith("2,Genetics"));
    const q3Line = lines.find((l) => l.startsWith("3,Cell Biology"));
    const q1Line = lines.find((l) => l.startsWith("1,Cell Biology"));
    const q4Line = lines.find((l) => l.startsWith("4,Cell Division"));

    expect(q2Line).toBeDefined();
    expect(q2Line).toContain("100%");
    expect(q2Line).toContain("Option B");

    expect(q3Line).toBeDefined();
    expect(q3Line).toContain("67%");
    expect(q3Line).toContain("Option A");

    expect(q1Line).toBeDefined();
    expect(q1Line).toContain("33%");
    expect(q1Line).toContain("Option C");

    expect(q4Line).toBeDefined();
    expect(q4Line).toContain("0%");
    expect(q4Line).toContain("None");

    // Order check in CSV lines
    const idxQ2 = lines.findIndex((l) => l.startsWith("2,Genetics"));
    const idxQ3 = lines.findIndex((l) => l.startsWith("3,Cell Biology"));
    const idxQ1 = lines.findIndex((l) => l.startsWith("1,Cell Biology"));
    const idxQ4 = lines.findIndex((l) => l.startsWith("4,Cell Division"));

    expect(idxQ2).toBeLessThan(idxQ3);
    expect(idxQ3).toBeLessThan(idxQ1);
    expect(idxQ1).toBeLessThan(idxQ4);
  });

  it("handles rooms with no classAnalytics gracefully", () => {
    const room = createMockRoom({ classAnalytics: null });
    const csv = buildClassGradebookCsv(room);

    expect(csv).toContain("Rank,Nickname,Score XP,Best Streak,Lives Remaining,Status");
    expect(csv).toContain(
      "Question #,Topic,Question,Total Attempts,Correct,Missed,Missed %,Top Wrong Option",
    );
    expect(csv).toContain("1,Alex Host,2100,7,3,waiting");
  });

  it("sanitizes CSV formula injection characters according to OWASP guidelines", () => {
    const maliciousPlayer = createMockPlayer({
      id: "p-evil",
      nickname: "=cmd|' /C calc'!A0",
      score: 999,
    });
    const room = createMockRoom({
      players: { [maliciousPlayer.id]: maliciousPlayer },
      podium: {
        first: maliciousPlayer,
        second: null,
        third: null,
        rankings: [maliciousPlayer],
      },
    });

    const csv = buildClassGradebookCsv(room);
    // Malicious formula prefixing
    expect(csv).toContain("'=cmd|' /C calc'!A0");
  });

  it("quotes cells with commas properly", () => {
    const room = createMockRoom();
    if (room.classAnalytics) {
      room.classAnalytics.questionStats[0].questionText =
        "What organelle, found in eukaryotes, produces ATP?";
    }
    const csv = buildClassGradebookCsv(room);
    expect(csv).toContain('"What organelle, found in eukaryotes, produces ATP?"');
  });
});
