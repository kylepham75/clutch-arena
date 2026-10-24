import { describe, it, expect } from "vitest";
import { clutchNoteSchema } from "@/lib/schemas/notes";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import { CLUTCH_NOTES_SYSTEM_PROMPT, buildNotesPrompt } from "@/lib/ai/prompts-notes";

describe("Clutch Notes AI Schema & Prompt Verification", () => {
  it("validates that the gold-standard sample note strictly conforms to clutchNoteSchema", () => {
    const parseResult = clutchNoteSchema.safeParse(SAMPLE_CLUTCH_NOTE);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      const note = parseResult.data;
      expect(note.title).toBe("CHAPTER 9: STOCK VALUATION");
      expect(note.originalSlideCount).toBe(27);
      expect(note.estimatedDistilledPages).toBe(3);
      expect(note.noiseReductionRate).toBe(89);
      expect(note.sections.length).toBe(5);

      // Verify Section A–E concise handout hierarchy
      expect(note.sections[0].letter).toBe("A");
      expect(note.sections[0].titleVi).toContain("NGUYÊN LÝ CƠ BẢN");
      expect(note.sections[0].coreStatement).toContain("present value (PV)");

      expect(note.sections[1].letter).toBe("B");
      expect(note.sections[1].titleVi).toContain("CÔNG THỨC TỔNG QUÁT");

      // Verify Section B defines primary variables once ("Trong đó:")
      const onePeriodFormula = note.sections[1].formulas[0];
      expect(onePeriodFormula).toBeDefined();
      expect(onePeriodFormula.leadText).toContain("Nếu chỉ đầu tư trong 1 năm:");
      expect(onePeriodFormula.variables.length).toBe(4);
      expect(onePeriodFormula.variables.some((v) => v.symbol === "P_0")).toBe(true);
      expect(onePeriodFormula.variables.some((v) => v.symbol === "D_1")).toBe(true);

      // Verify Section C subSections (CASE 1, CASE 2, CASE 3) & non-redundant variables
      const sectionC = note.sections.find((s) => s.letter === "C");
      expect(sectionC?.subSections?.length).toBe(3);
      const case2 = sectionC?.subSections?.find((sub) =>
        sub.heading.includes("Constant Growth"),
      );
      expect(case2).toBeDefined();
      expect(case2?.formulas[0].latex).toContain("\\frac{D_1}{R - g}");
      expect(case2?.formulas[0].variables.length).toBe(0);

      // Verify crisp Key Takeaways box with structured items and boundary condition (g < r)
      expect(sectionC?.keyTakeaways).toBeDefined();
      expect(sectionC?.keyTakeaways?.title).toBe("KEY TAKEAWAYS");
      expect(sectionC?.keyTakeaways?.items?.length).toBe(4);
      expect(sectionC?.keyTakeaways?.items?.[1].subBullets).toContain(
        "Constant growth → Gordon model",
      );
      expect(sectionC?.keyTakeaways?.boundaryConditions).toContain("g < r");
    }
  });

  it("strictly enforces all 6 pedagogical & conciseness rules in the system prompt", () => {
    // 1. STRIP ALL NOISE
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("1. STRIP ALL NOISE");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("attendance QR codes");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("repetitive step-by-step practice exercises");

    // 2. HIERARCHICAL STRUCTURE
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("2. HIERARCHICAL STRUCTURE");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("alphabetical sections (A, B, C, D, E...)");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("subSections");

    // 3. BILINGUAL COGNITIVE ANCHORING
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("3. BILINGUAL COGNITIVE ANCHORING (EN/VI)");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Vietnamese section headers");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("inline Vietnamese translations in parentheses");

    // 4. FORMULA STANDARDIZATION & NON-REDUNDANCY
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("4. FORMULA STANDARDIZATION");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("LaTeX");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('"Trong đó:" (Where:)');
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("NON-REDUNDANT");

    // 5. SYNTHESIZE "KEY TAKEAWAYS"
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('5. SYNTHESIZE "KEY TAKEAWAYS"');
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("how to choose between models");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("mathematical boundary conditions/pitfalls");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("g < r");

    // 6. RADICAL BREVITY & ZERO FLUFF
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("6. RADICAL BREVITY & ZERO FLUFF");
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
