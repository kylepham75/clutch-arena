import { describe, expect, it, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translations, type Language, type TranslationDict } from "@/lib/i18n/translations";
import type { ArenaPlayer, ArenaRoomState } from "@/lib/schemas/multiplayer";

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
    if (id.startsWith("./") || id.startsWith("../")) {
      const resolved = path.resolve(path.dirname(fullPath), id);
      return loadTsxModule(path.relative(process.cwd(), resolved));
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

const { ArenaGame, setArenaGameTestLanguage } = loadTsxModule<{
  ArenaGame: React.ComponentType<{
    room: ArenaRoomState;
    currentPlayer: ArenaPlayer;
    onSubmitAnswer: (selected: number) => void;
  }>;
  setArenaGameTestLanguage: (lang: Language | null) => void;
}>("components/arena/arena-game.tsx");

const { ArenaPodium, setArenaPodiumTestLanguage } = loadTsxModule<{
  ArenaPodium: React.ComponentType<{
    room: ArenaRoomState;
    currentPlayer: ArenaPlayer;
    onRematch: () => void;
    onLeave: () => void;
  }>;
  setArenaPodiumTestLanguage: (lang: Language | null) => void;
}>("components/arena/arena-podium.tsx");

describe("i18n Vietnamese & English translations", () => {
  it("provides comprehensive translations for both English and Vietnamese", () => {
    expect(translations.en).toBeDefined();
    expect(translations.vi).toBeDefined();
  });

  it("has matching top-level and nested structure between EN and VI", () => {
    const enSections = Object.keys(translations.en) as Array<keyof TranslationDict>;
    const viSections = Object.keys(translations.vi) as Array<keyof TranslationDict>;

    expect(viSections).toEqual(enSections);

    for (const section of enSections) {
      const enKeys = Object.keys(translations.en[section]).sort();
      const viKeys = Object.keys(translations.vi[section]).sort();
      expect(viKeys).toEqual(enKeys);
    }
  });

  it("contains valid Vietnamese translations for core navigation and actions", () => {
    expect(translations.vi.nav.clutchRun).toBe("Luyện thi tốc độ");
    expect(translations.vi.nav.uploadNotes).toBe("Tải tài liệu lên");
    expect(translations.vi.nav.aiCoach).toBe("Gia sư AI");
    expect(translations.vi.run.changeDeck).toBe("Đổi bộ đề");
    expect(translations.vi.run.startRun).toBe("Bắt đầu làm bài");
    expect(translations.vi.run.correct).toBe("Chính xác!");
    expect(translations.vi.run.wrong).toBe("Chưa đúng");
    expect(translations.vi.run.timeout).toBe("Hết giờ!");
  });

  it("contains valid English translations for core navigation and actions", () => {
    expect(translations.en.nav.clutchRun).toBe("Clutch Run");
    expect(translations.en.nav.uploadNotes).toBe("Upload notes");
    expect(translations.en.nav.aiCoach).toBe("AI study coach");
    expect(translations.en.run.changeDeck).toBe("Change Deck");
    expect(translations.en.run.startRun).toBe("Start Clutch Run");
  });

  it("verifies all 19 expected top-level namespaces exist on both translations.en and translations.vi", () => {
    const expectedNamespaces: Array<keyof TranslationDict> = [
      "brand",
      "nav",
      "sidebar",
      "topbar",
      "headings",
      "run",
      "upload",
      "coach",
      "library",
      "help",
      "arena",
      "flashcard",
      "docViewer",
      "share",
      "notes",
      "auth",
      "pricing",
      "tutorial",
      "common",
    ];

    expect(expectedNamespaces).toHaveLength(19);

    for (const ns of expectedNamespaces) {
      expect(translations.en[ns]).toBeDefined();
      expect(translations.vi[ns]).toBeDefined();
      expect(typeof translations.en[ns]).toBe("object");
      expect(typeof translations.vi[ns]).toBe("object");
    }

    expect(Object.keys(translations.en).sort()).toEqual([...expectedNamespaces].sort());
    expect(Object.keys(translations.vi).sort()).toEqual([...expectedNamespaces].sort());
  });

  it("recursively validates that all leaf values in EN and VI are non-empty strings with zero undefined or TODO placeholders", () => {
    function assertValidLeaves(obj: Record<string, unknown>, path: string) {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key;
        expect(value, `Expected ${fullPath} to not be undefined`).toBeDefined();

        if (typeof value === "object" && value !== null) {
          assertValidLeaves(value as Record<string, unknown>, fullPath);
        } else {
          expect(typeof value, `Expected ${fullPath} to be a string`).toBe("string");
          const str = value as string;
          expect(str.trim().length, `Expected ${fullPath} to be non-empty`).toBeGreaterThan(0);
          expect(str.toUpperCase().includes("TODO"), `Expected ${fullPath} not to contain TODO placeholder`).toBe(false);
        }
      }
    }

    assertValidLeaves(translations.en as unknown as Record<string, unknown>, "en");
    assertValidLeaves(translations.vi as unknown as Record<string, unknown>, "vi");
  });

  it("verifies key bilingual distinctions across the new namespaces", () => {
    expect(translations.en.notes.whereVariables).toBe("Where:");
    expect(translations.vi.notes.whereVariables).toBe("Trong đó:");
    expect(translations.en.notes.whereLabel).toBe("Where:");
    expect(translations.vi.notes.whereLabel).toBe("Trong đó:");

    expect(translations.en.flashcard.eyebrow).toBe("FLASHCARD REVIEW");
    expect(translations.vi.flashcard.eyebrow).toBe("ÔN TẬP FLASHCARD");

    expect(translations.en.pricing.verifyPaymentBtn).toBe("Verify Payment Status");
    expect(translations.vi.pricing.verifyPaymentBtn).toBe("Kiểm tra trạng thái thanh toán");

    expect(translations.en.auth.signInTitle).toBe("Sign In to ClutchArena");
    expect(translations.vi.auth.signInTitle).toBe("Đăng nhập ClutchArena");

    expect(translations.en.docViewer.emptyTitle).toBe("No study material loaded");
    expect(translations.vi.docViewer.emptyTitle).toBe("Chưa nạp tài liệu học tập");

    expect(translations.en.share.title).toBe("Share & Export Study Deck");
    expect(translations.vi.share.title).toBe("Chia sẻ & Xuất bộ đề học tập");

    expect(translations.en.tutorial.quickTourBadge).toBe("Quick Tour");
    expect(translations.vi.tutorial.quickTourBadge).toBe("Hướng dẫn nhanh");

    expect(translations.en.common.errorTitle).toBe("Let’s take that again.");
    expect(translations.vi.common.errorTitle).toBe("Hãy thử lại một lần nữa nhé.");
  });

  it("verifies Pricing and Auth decoupling across EN and VI namespaces", () => {
    expect(translations.en.auth).toBeDefined();
    expect(translations.en.pricing).toBeDefined();
    expect(translations.vi.auth).toBeDefined();
    expect(translations.vi.pricing).toBeDefined();

    // Key auth strings
    expect(translations.en.auth.signInTitle).toBe("Sign In to ClutchArena");
    expect(translations.vi.auth.signInTitle).toBe("Đăng nhập ClutchArena");
    expect(translations.en.auth.createAccountTitle).toBe("Create a Free Account");
    expect(translations.vi.auth.createAccountTitle).toBe("Tạo tài khoản miễn phí");
    expect(translations.en.auth.signInTab).toBe("Sign In");
    expect(translations.vi.auth.signInTab).toBe("Đăng nhập");
    expect(translations.en.auth.signUpTab).toBe("Create Account");
    expect(translations.vi.auth.signUpTab).toBe("Đăng ký");

    // Key pricing strings
    expect(translations.en.pricing.vietQrHeader).toBe("Scan VietQR (MoMo, ZaloPay, Any Banking App)");
    expect(translations.vi.pricing.vietQrHeader).toBe("Quét mã VietQR (MoMo, ZaloPay, Mọi Ngân Hàng)");
    expect(translations.en.pricing.verifyPaymentBtn).toBe("Verify Payment Status");
    expect(translations.vi.pricing.verifyPaymentBtn).toBe("Kiểm tra trạng thái thanh toán");
    expect(translations.en.pricing.backToPlans).toBe("Back to all plans");
    expect(translations.vi.pricing.backToPlans).toBe("Quay lại danh sách gói");

    // Decoupling verification: No auth keys exist in pricing and vice versa
    const authKeys = new Set(Object.keys(translations.en.auth));
    const pricingKeys = new Set(Object.keys(translations.en.pricing));
    expect(authKeys.has("vietQrHeader")).toBe(false);
    expect(authKeys.has("verifyPaymentBtn")).toBe(false);
    expect(pricingKeys.has("signInTitle")).toBe(false);
    expect(pricingKeys.has("createAccountTitle")).toBe(false);
  });

  it("verifies complete Arena localization dictionary parity for ArenaGame and ArenaPodium", () => {
    // ArenaGame strings
    expect(translations.en.arena.matchStartingEyebrow).toBe("MATCH STARTING");
    expect(translations.vi.arena.matchStartingEyebrow).toBe("TRẬN ĐẤU BẮT ĐẦU");
    expect(translations.en.arena.getReadyTitle).toBe("Get Ready!");
    expect(translations.vi.arena.getReadyTitle).toBe("Chuẩn bị!");
    expect(translations.en.arena.countdownSubtitle).toBe("15 seconds per round · Synchronized answers");
    expect(translations.vi.arena.countdownSubtitle).toBe("15 giây mỗi vòng · Đồng bộ thời gian thực");

    expect(translations.en.arena.roundLabel).toBe("ROUND");
    expect(translations.vi.arena.roundLabel).toBe("VÒNG");
    expect(translations.en.arena.scoreLabel).toBe("SCORE");
    expect(translations.vi.arena.scoreLabel).toBe("ĐIỂM");
    expect(translations.en.arena.streakLabel).toBe("STREAK");
    expect(translations.vi.arena.streakLabel).toBe("CHUỖI");
    expect(translations.en.arena.livesLabel).toBe("LIVES");
    expect(translations.vi.arena.livesLabel).toBe("MẠNG");

    expect(translations.en.arena.questionNum).toBe("QUESTION");
    expect(translations.vi.arena.questionNum).toBe("CÂU HỎI");
    expect(translations.en.arena.of).toBe("OF");
    expect(translations.vi.arena.of).toBe("TRÊN");

    expect(translations.en.arena.answerLockedBanner).toContain("Answer locked in!");
    expect(translations.vi.arena.answerLockedBanner).toContain("Đã chốt đáp án!");
    expect(translations.en.arena.spectatorBanner).toContain("Out of hearts");
    expect(translations.vi.arena.spectatorBanner).toContain("Đã hết tim");

    expect(translations.en.arena.clutchCorrectPrefix).toBe("Clutch!");
    expect(translations.vi.arena.clutchCorrectPrefix).toBe("Chuẩn xác!");
    expect(translations.en.arena.timedOutLife).toBe("Timed out! -1 Life");
    expect(translations.vi.arena.timedOutLife).toBe("Hết giờ! -1 Mạng");
    expect(translations.en.arena.missedLife).toBe("Missed! -1 Life");
    expect(translations.vi.arena.missedLife).toBe("Chưa đúng! -1 Mạng");
    expect(translations.en.arena.nextRoundIn4s).toBe("Next round in 4s…");
    expect(translations.vi.arena.nextRoundIn4s).toBe("Vòng tiếp theo sau 4s…");

    expect(translations.en.arena.orWord).toBe("or");
    expect(translations.vi.arena.orWord).toBe("hoặc");
    expect(translations.en.arena.toSubmitHint).toBe("to submit");
    expect(translations.vi.arena.toSubmitHint).toBe("để chọn đáp án");
    expect(translations.en.arena.syncServerDeadline).toBe("Synchronized server deadline");
    expect(translations.vi.arena.syncServerDeadline).toBe("Đồng bộ thời gian máy chủ");

    expect(translations.en.arena.liveLeaderboardEyebrow).toBe("LIVE LEADERBOARD");
    expect(translations.vi.arena.liveLeaderboardEyebrow).toBe("BẢNG XẾP HẠNG TRỰC TIẾP");
    expect(translations.en.arena.arenaRankingsTitle).toBe("Arena Rankings");
    expect(translations.vi.arena.arenaRankingsTitle).toBe("Thứ hạng Đấu trường");
    expect(translations.en.arena.youPill).toBe("YOU");
    expect(translations.vi.arena.youPill).toBe("BẠN");
    expect(translations.en.arena.lockedInTag).toBe("✓ In");
    expect(translations.vi.arena.lockedInTag).toBe("✓ Đã chốt");
    expect(translations.en.arena.thinkingTag).toBe("Thinking…");
    expect(translations.vi.arena.thinkingTag).toBe("Đang nghĩ…");
    expect(translations.en.arena.missTag).toBe("Miss");
    expect(translations.vi.arena.missTag).toBe("Sai");

    // ArenaPodium strings
    expect(translations.en.arena.matchConcludedEyebrow).toBe("ARENA MATCH CONCLUDED");
    expect(translations.vi.arena.matchConcludedEyebrow).toBe("TRẬN ĐẤU KẾT THÚC");
    expect(translations.en.arena.claimsVictorySuffix).toBe("claims victory!");
    expect(translations.vi.arena.claimsVictorySuffix).toBe("giành chiến thắng!");
    expect(translations.en.arena.matchCompleteTitle).toBe("Match Complete!");
    expect(translations.vi.arena.matchCompleteTitle).toBe("Hoàn thành trận đấu!");
    expect(translations.en.arena.finalScoreboard).toBe("FINAL SCOREBOARD");
    expect(translations.vi.arena.finalScoreboard).toBe("BẢNG ĐIỂM CHUNG CUỘC");
    expect(translations.en.arena.bestStreakLabel).toBe("Best streak");
    expect(translations.vi.arena.bestStreakLabel).toBe("Chuỗi tốt nhất");
    expect(translations.en.arena.livesRemaining).toBe("lives remaining");
    expect(translations.vi.arena.livesRemaining).toBe("mạng còn lại");

    expect(translations.en.arena.classAnalyticsTitle).toBe("Post-Match Class Analytics");
    expect(translations.vi.arena.classAnalyticsTitle).toBe("Phân tích Lớp học Sau Trận đấu");
    expect(translations.en.arena.exportGradebookBtn).toBe("Export Gradebook CSV");
    expect(translations.vi.arena.exportGradebookBtn).toBe("Xuất bảng điểm CSV");
    expect(translations.en.arena.earlyEliminationPrefix).toBe("student(s)");
    expect(translations.vi.arena.earlyEliminationPrefix).toBe("học viên");
    expect(translations.en.arena.earlyEliminationSuffix).toBe("lost all 3 hearts before Round 5.");
    expect(translations.vi.arena.earlyEliminationSuffix).toBe("đã mất hết 3 tim trước Vòng 5.");
    expect(translations.en.arena.classAvgAccuracy).toBe("Class Average Accuracy");
    expect(translations.vi.arena.classAvgAccuracy).toBe("Độ chính xác trung bình");
    expect(translations.en.arena.totalPlayersKpi).toBe("Total Players");
    expect(translations.vi.arena.totalPlayersKpi).toBe("Tổng người chơi");
    expect(translations.en.arena.totalQuestionsKpi).toBe("Total Questions");
    expect(translations.vi.arena.totalQuestionsKpi).toBe("Tổng số câu hỏi");
    expect(translations.en.arena.missedDiagnosticHeader).toBe("Missed Questions Diagnostic (Sorted Worst First)");
    expect(translations.vi.arena.missedDiagnosticHeader).toBe("Chẩn đoán Câu trả lời sai (Sắp xếp từ sai nhiều nhất)");
    expect(translations.en.arena.needsReteachBadge).toBe("Needs Re-Teach");
    expect(translations.vi.arena.needsReteachBadge).toBe("Cần giảng lại");
    expect(translations.en.arena.topTrapPrefix).toBe("Top trap: Option");
    expect(translations.vi.arena.topTrapPrefix).toBe("Bẫy nhiều người chọn: Đáp án");
    expect(translations.en.arena.missedWord).toBe("missed");
    expect(translations.vi.arena.missedWord).toBe("làm sai");

    expect(translations.en.arena.hostRematchBtn).toBe("Host Rematch");
    expect(translations.vi.arena.hostRematchBtn).toBe("Đấu lại trận mới");
    expect(translations.en.arena.waitingForRematch).toBe("Waiting for host to rematch…");
    expect(translations.vi.arena.waitingForRematch).toBe("Đang chờ chủ phòng mở trận đấu lại…");
    expect(translations.en.arena.hideAnalyticsBtn).toBe("Hide Class Analytics");
    expect(translations.vi.arena.hideAnalyticsBtn).toBe("Ẩn phân tích lớp học");
    expect(translations.en.arena.viewAnalyticsBtn).toBe("View Class Analytics");
    expect(translations.vi.arena.viewAnalyticsBtn).toBe("Xem phân tích lớp học");
    expect(translations.en.arena.scoreboardCopiedBtn).toBe("Scoreboard Copied!");
    expect(translations.vi.arena.scoreboardCopiedBtn).toBe("Đã chép bảng điểm!");
    expect(translations.en.arena.shareResultsBtn).toBe("Share Results");
    expect(translations.vi.arena.shareResultsBtn).toBe("Chia sẻ kết quả");
    expect(translations.en.arena.debriefWithCoachBtn).toBe("Debrief with Coach");
    expect(translations.vi.arena.debriefWithCoachBtn).toBe("Tổng kết cùng Gia sư AI");
    expect(translations.en.arena.leaveArenaBtn).toBe("Leave Arena");
    expect(translations.vi.arena.leaveArenaBtn).toBe("Rời Đấu trường");
  });

  describe("Arena UI component bilingual rendering & switching", () => {
    const mockPlayer: ArenaPlayer = {
      id: "p-1",
      nickname: "Alex",
      avatar: "⚡",
      score: 1850,
      streak: 4,
      bestStreak: 6,
      lives: 3,
      isReady: true,
      isHost: true,
      isBot: false,
      status: "submitted",
      lastAnswer: { selected: 0, correct: true, points: 250, answeredAtMs: 1200 },
    };

    const mockRoom: ArenaRoomState = {
      code: "CLUTCH",
      title: "Microeconomics 101",
      hostId: "p-1",
      status: "answering",
      currentQuestionIndex: 0,
      totalQuestions: 5,
      roundDeadline: Date.now() + 15000,
      feedbackDeadline: 0,
      countdownEndsAt: Date.now() + 3000,
      players: { "p-1": mockPlayer },
      currentQuestion: {
        id: "q-1",
        number: 1,
        total: 5,
        question: "What produces ATP in eukaryotic cells?",
        options: [
          "Mitochondria",
          "Nucleus",
          "Ribosome",
          "Endoplasmic Reticulum",
        ] as [string, string, string, string],
        topic: "Cell Biology",
      },
      revealedFeedback: null,
      createdAt: new Date().toISOString(),
      mode: "exact",
      packId: "pack-1",
      classAnalytics: {
        totalPlayers: 1,
        totalQuestions: 5,
        averageAccuracyPercent: 80,
        earlyEliminatedCount: 0,
        earlyEliminatedNicknames: [],
        questionStats: [
          {
            questionId: "q-1",
            questionNumber: 1,
            questionText: "What produces ATP in eukaryotic cells?",
            topic: "Cell Biology",
            correctIndex: 0,
            totalAttempts: 1,
            correctCount: 1,
            missedCount: 0,
            missedPercent: 0,
            optionCounts: [1, 0, 0, 0],
            mostCommonWrongOption: null,
          },
        ],
      },
      podium: {
        first: mockPlayer,
        second: null,
        third: null,
        rankings: [mockPlayer],
      },
    };

    afterEach(() => {
      setArenaGameTestLanguage(null);
      setArenaPodiumTestLanguage(null);
    });

    it("renders ArenaGame with English strings and dynamically switches to Vietnamese", () => {
      // 1. English render
      setArenaGameTestLanguage("en");
      const enHtml = renderToStaticMarkup(
        React.createElement(ArenaGame, {
          room: mockRoom,
          currentPlayer: mockPlayer,
          onSubmitAnswer: () => {},
        }),
      );

      expect(enHtml).toContain("ROUND");
      expect(enHtml).toContain("SCORE");
      expect(enHtml).toContain("STREAK");
      expect(enHtml).toContain("LIVES");
      expect(enHtml).toContain("QUESTION 1 OF 5");
      expect(enHtml).toContain("LIVE LEADERBOARD");
      expect(enHtml).toContain("Arena Rankings");
      expect(enHtml).toContain("Synchronized server deadline");
      expect(enHtml).toContain("(YOU)");

      // 2. Vietnamese render
      setArenaGameTestLanguage("vi");
      const viHtml = renderToStaticMarkup(
        React.createElement(ArenaGame, {
          room: mockRoom,
          currentPlayer: mockPlayer,
          onSubmitAnswer: () => {},
        }),
      );

      expect(viHtml).toContain("VÒNG");
      expect(viHtml).toContain("ĐIỂM");
      expect(viHtml).toContain("CHUỖI");
      expect(viHtml).toContain("MẠNG");
      expect(viHtml).toContain("CÂU HỎI 1 TRÊN 5");
      expect(viHtml).toContain("BẢNG XẾP HẠNG TRỰC TIẾP");
      expect(viHtml).toContain("Thứ hạng Đấu trường");
      expect(viHtml).toContain("Đồng bộ thời gian máy chủ");
      expect(viHtml).toContain("(BẠN)");
    });

    it("renders ArenaPodium with English strings and dynamically switches to Vietnamese", () => {
      // 1. English render
      setArenaPodiumTestLanguage("en");
      const enHtml = renderToStaticMarkup(
        React.createElement(ArenaPodium, {
          room: mockRoom,
          currentPlayer: mockPlayer,
          onRematch: () => {},
          onLeave: () => {},
        }),
      );

      expect(enHtml).toContain("ARENA MATCH CONCLUDED");
      expect(enHtml).toContain("Alex claims victory!");
      expect(enHtml).toContain("A battle of speed, precision, and focus.");
      expect(enHtml).toContain("FINAL SCOREBOARD");
      expect(enHtml).toContain("(YOU)");
      expect(enHtml).toContain("Best streak: 6 · 3 lives remaining");
      expect(enHtml).toContain("Post-Match Class Analytics");
      expect(enHtml).toContain("Export Gradebook CSV");
      expect(enHtml).toContain("Class Average Accuracy");
      expect(enHtml).toContain("Total Players");
      expect(enHtml).toContain("Total Questions");
      expect(enHtml).toContain("Host Rematch");
      expect(enHtml).toContain("Leave Arena");

      // 2. Vietnamese render
      setArenaPodiumTestLanguage("vi");
      const viHtml = renderToStaticMarkup(
        React.createElement(ArenaPodium, {
          room: mockRoom,
          currentPlayer: mockPlayer,
          onRematch: () => {},
          onLeave: () => {},
        }),
      );

      expect(viHtml).toContain("TRẬN ĐẤU KẾT THÚC");
      expect(viHtml).toContain("Alex giành chiến thắng!");
      expect(viHtml).toContain("Cuộc đua của tốc độ, sự chính xác và tập trung cao độ.");
      expect(viHtml).toContain("BẢNG ĐIỂM CHUNG CUỘC");
      expect(viHtml).toContain("(BẠN)");
      expect(viHtml).toContain("Chuỗi tốt nhất: 6 · 3 mạng còn lại");
      expect(viHtml).toContain("Phân tích Lớp học Sau Trận đấu");
      expect(viHtml).toContain("Xuất bảng điểm CSV");
      expect(viHtml).toContain("Độ chính xác trung bình");
      expect(viHtml).toContain("Tổng người chơi");
      expect(viHtml).toContain("Tổng số câu hỏi");
      expect(viHtml).toContain("Đấu lại trận mới");
      expect(viHtml).toContain("Rời Đấu trường");
    });
  });
});
