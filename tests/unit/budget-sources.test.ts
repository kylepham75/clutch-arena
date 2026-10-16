import { describe, expect, it } from "vitest";
import { budgetSourceBlocks } from "@/lib/ai/budget-sources";
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
});
