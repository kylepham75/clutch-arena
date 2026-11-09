import { describe, expect, it } from "vitest";
import {
  budgetSourceBlocks,
  cleanSlideBoilerplate,
} from "@/lib/ai/budget-sources";
import type { SourceBlock } from "@/lib/schemas/ingestion";

describe("budgetSourceBlocks", () => {
  it("leaves sources untouched if total characters are below the budget", () => {
    const sources: SourceBlock[] = [
      { id: "src_1", label: "Page 1", text: "Short text for section 1." },
      { id: "src_2", label: "Page 2", text: "Short text for section 2." },
    ];

    const result = budgetSourceBlocks(sources, 5000);
    expect(result.wasBudgeted).toBe(false);
    expect(result.sources.length).toBe(2);
    expect(result.budgetedCharacterCount).toBe(result.originalCharacterCount);
  });

  it("reduces sources to fit within maxCharacters when original is large", () => {
    const sources: SourceBlock[] = Array.from({ length: 30 }, (_, i) => ({
      id: `src_${i + 1}`,
      label: `Page ${i + 1}`,
      text: `Paragraph ${i + 1}: Detailed description of macroeconomic theory and market elasticity. `.repeat(10),
    }));

    const originalLength = sources.reduce((sum, s) => sum + s.text.length, 0);
    expect(originalLength).toBeGreaterThan(20_000);

    const result = budgetSourceBlocks(sources, 5_000);
    expect(result.wasBudgeted).toBe(true);
    expect(result.budgetedCharacterCount).toBeLessThanOrEqual(5_000);
    expect(result.sources.length).toBeLessThan(sources.length);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it("distributes budget across all documents in a multi-document batch", () => {
    const doc0Blocks: SourceBlock[] = Array.from({ length: 10 }, (_, i) => ({
      id: `doc0_src_${i}`,
      label: `Doc0 Page ${i}`,
      text: `Lecture 1 concept ${i}: Elasticity of supply and price floors. `.repeat(5),
    }));
    const doc1Blocks: SourceBlock[] = Array.from({ length: 10 }, (_, i) => ({
      id: `doc1_src_${i}`,
      label: `Doc1 Page ${i}`,
      text: `Lecture 2 concept ${i}: Monopoly barriers and deadweight loss. `.repeat(5),
    }));

    const result = budgetSourceBlocks([...doc0Blocks, ...doc1Blocks], 3_000);
    expect(result.wasBudgeted).toBe(true);

    const hasDoc0 = result.sources.some((s) => s.id.startsWith("doc0_"));
    const hasDoc1 = result.sources.some((s) => s.id.startsWith("doc1_"));
    expect(hasDoc0).toBe(true);
    expect(hasDoc1).toBe(true);
  });

  it("prioritizes blocks containing focus terms when focus is provided", () => {
    const sources: SourceBlock[] = [
      {
        id: "src_1",
        label: "Page 1",
        text: "General introductory remarks about economics and course structure. ".repeat(8),
      },
      {
        id: "src_2",
        label: "Page 2",
        text: "Specific chapter on deadweight loss and monopoly rent seeking behavior. ".repeat(8),
      },
      {
        id: "src_3",
        label: "Page 3",
        text: "Logistics, grading syllabus, and midterm schedule details. ".repeat(8),
      },
    ];

    const result = budgetSourceBlocks(sources, 1_000, "monopoly deadweight");
    expect(result.wasBudgeted).toBe(true);
    const includedText = result.sources.map((s) => s.text).join(" ");
    expect(includedText).toContain("monopoly rent seeking");
  });

  it("samples evenly across early, middle, and late pages of a 100-page chapter without focus", () => {
    const sources: SourceBlock[] = Array.from({ length: 100 }, (_, i) => {
      const pageNum = i + 1;
      const body = `Slide ${pageNum}: Corporate finance valuation analysis where NPV = -$1,000 + $450 / (1 + 0.12)^t and WACC = 9.5%. `.repeat(
        6,
      );
      return {
        id: `doc0_page-${pageNum}`,
        label: `Page ${pageNum}`,
        text: body,
      };
    });

    const result = budgetSourceBlocks(sources);
    expect(result.wasBudgeted).toBe(true);
    expect(result.budgetedCharacterCount).toBeLessThanOrEqual(18_000);

    const selectedPages = result.sources.map((s) =>
      Number(s.id.replace("doc0_page-", "")),
    );
    const earlyPages = selectedPages.filter((p) => p <= 25);
    const middlePages = selectedPages.filter((p) => p >= 35 && p <= 65);
    const latePages = selectedPages.filter((p) => p >= 75);

    expect(earlyPages.length).toBeGreaterThanOrEqual(4);
    expect(middlePages.length).toBeGreaterThanOrEqual(4);
    expect(latePages.length).toBeGreaterThanOrEqual(4);
  });

  it("deprioritizes Pearson-style cover, outline, learning objectives, and copyright disclaimer slides", () => {
    const footer = "\nCopyright © 2024 Pearson Education, Ltd. All Rights Reserved";
    const header = "Sixth Edition\nCorporate Finance\n";

    expect(cleanSlideBoilerplate(`${header}Blank${footer}`)).toBe(
      "Corporate Finance",
    );

    const boilerplateSlides: SourceBlock[] = [
      {
        id: "doc0_page-1",
        label: "Page 1",
        text: `${header}Chapter 2\nFinancial Statement Analysis\nJonathan Berk | Peter DeMarzo${footer}`,
      },
      {
        id: "doc0_page-2",
        label: "Page 2",
        text: `${header}Chapter Outline\n2.1 Firms' Disclosure of Financial Information\n2.2 The Balance Sheet\n2.3 The Income Statement\n2.4 The Statement of Cash Flows${footer}`,
      },
      {
        id: "doc0_page-3",
        label: "Page 3",
        text: `${header}Learning Objectives\n• List the four major financial statements required by the SEC\n• Define the balance sheet identity and explain book value of equity\n• Distinguish between current and long-term assets${footer}`,
      },
      {
        id: "doc0_page-4",
        label: "Page 4",
        text: `${header}This work is protected by United States copyright laws and is provided solely for the use of instructors in teaching their courses and assessing student learning. Dissemination or sale of any part of this work is not permitted.${footer}`,
      },
      {
        id: "doc0_page-5",
        label: "Page 5",
        text: `${header}Table 2.1 Global Corporation's Balance Sheet for 2025 and 2024${footer}`,
      },
    ];

    const substantiveSlides: SourceBlock[] = Array.from({ length: 12 }, (_, i) => {
      const pageNum = i + 6;
      return {
        id: `doc0_page-${pageNum}`,
        label: `Page ${pageNum}`,
        text: `${header}2.${i + 1} Enterprise Valuation & Leverage Ratios\nEnterprise Value is defined as Market Capitalization + Debt - Cash = $520M + $180M - $60M = $640M. Return on Equity (ROE) = Net Income / Book Equity = 14.8%. `.repeat(
          3,
        ) + footer,
      };
    });

    const result = budgetSourceBlocks(
      [...boilerplateSlides, ...substantiveSlides],
      4_500,
    );

    expect(result.wasBudgeted).toBe(true);
    const selectedIds = new Set(result.sources.map((s) => s.id));

    for (const bp of boilerplateSlides) {
      expect(selectedIds.has(bp.id)).toBe(false);
    }
    expect(result.sources.length).toBeGreaterThanOrEqual(4);
    expect(
      result.sources.every((s) => s.id.startsWith("doc0_page-") && Number(s.id.replace("doc0_page-", "")) >= 6),
    ).toBe(true);
  });
});
