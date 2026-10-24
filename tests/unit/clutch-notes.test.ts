import { describe, it, expect } from "vitest";
import { clutchNoteSchema } from "@/lib/schemas/notes";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import { CLUTCH_NOTES_SYSTEM_PROMPT, buildNotesPrompt } from "@/lib/ai/prompts-notes";

describe("Clutch Notes AI Schema & Prompt Verification", () => {
  it("validates that the production sample note strictly conforms to clutchNoteSchema", () => {
    const parseResult = clutchNoteSchema.safeParse(SAMPLE_CLUTCH_NOTE);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const note = parseResult.data;
      expect(note.originalSlideCount).toBe(27);
      expect(note.estimatedDistilledPages).toBe(3);
      expect(note.noiseReductionRate).toBe(89);
      expect(note.sections.length).toBeGreaterThanOrEqual(3);

      // Verify Section A, B, C hierarchy
      expect(note.sections[0].letter).toBe("A");
      expect(note.sections[0].titleVi).toContain("NGUYÊN LÝ CƠ BẢN");

      expect(note.sections[1].letter).toBe("B");
      expect(note.sections[1].titleVi).toContain("CÔNG THỨC TỔNG QUÁT");

      // Verify LaTeX formulas and "Trong đó:" variable definitions
      const constantGrowthFormula = note.sections[1].formulas.find((f) =>
        f.name.includes("Constant Growth"),
      );
      expect(constantGrowthFormula).toBeDefined();
      expect(constantGrowthFormula?.latex).toContain("\\frac{D_1}{r - g}");
      expect(constantGrowthFormula?.variables.length).toBeGreaterThanOrEqual(4);
      expect(constantGrowthFormula?.variables.some((v) => v.symbol === "P_0")).toBe(true);
      expect(constantGrowthFormula?.variables.some((v) => v.symbol === "D_1")).toBe(true);

      // Verify Key Takeaways synthesis with boundary condition (g < r)
      const sectionC = note.sections.find((s) => s.letter === "C");
      expect(sectionC?.keyTakeaways).toBeDefined();
      expect(sectionC?.keyTakeaways?.title).toContain("KEY TAKEAWAYS");
      expect(sectionC?.keyTakeaways?.boundaryConditions).toContain("g < r");
    }
  });

  it("strictly enforces all 5 pedagogical rules in the system prompt", () => {
    // 1. STRIP ALL NOISE
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("1. STRIP ALL NOISE");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("attendance QR codes");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("repetitive step-by-step practice exercises");

    // 2. HIERARCHICAL STRUCTURE
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("2. HIERARCHICAL STRUCTURE");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("alphabetical sections (A, B, C, D, E...)");

    // 3. BILINGUAL COGNITIVE ANCHORING
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("3. BILINGUAL COGNITIVE ANCHORING (EN/VI)");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Vietnamese section headers");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("inline Vietnamese translations in parentheses");

    // 4. FORMULA STANDARDIZATION
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("4. FORMULA STANDARDIZATION");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("LaTeX");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('"Trong đó:" (Where:)');

    // 5. SYNTHESIZE "KEY TAKEAWAYS"
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('5. SYNTHESIZE "KEY TAKEAWAYS"');
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("how to choose between models");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("mathematical boundary conditions/pitfalls");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("g < r");
  });

  it("builds a structured synthesis user prompt formatting raw slides", () => {
    const prompt = buildNotesPrompt({
      fileName: "Corporate_Finance_Week4.pptx",
      slides: [
        { label: "Slide 1", text: "Welcome & Attendance QR" },
        { label: "Slide 2", text: "Valuation models: P0 = D1 / (r - g)" },
      ],
      focus: "Discounted Cash Flows",
    });

    expect(prompt).toContain("Corporate_Finance_Week4.pptx");
    expect(prompt).toContain("Discounted Cash Flows");
    expect(prompt).toContain("=== Slide 1 ===");
    expect(prompt).toContain("=== Slide 2 ===");
    expect(prompt).toContain("Valuation models: P0 = D1 / (r - g)");
  });
});
