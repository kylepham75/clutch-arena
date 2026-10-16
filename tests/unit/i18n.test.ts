import { describe, expect, it } from "vitest";
import { translations, type Language, type TranslationDict } from "@/lib/i18n/translations";

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
});
