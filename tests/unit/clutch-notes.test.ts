import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { zodSchema } from "ai";
import { clutchNoteSchema } from "@/lib/schemas/notes";
import { generatedClutchNoteSchema, applyHallucinationShield } from "@/lib/ai/generate-notes";
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
      const case1 = sectionC?.subSections?.[0];
      expect(case1?.heading).toContain("g = 0");
      expect(case1?.heading).not.toContain("g = o");

      const case2 = sectionC?.subSections?.find((sub) =>
        sub.heading.includes("Constant Growth"),
      );
      expect(case2).toBeDefined();
      expect(case2?.formulas[0].latex).toContain("\\frac{D_1}{R - g}");
      expect(case2?.formulas[0].variables.length).toBe(0);

      const case3 = sectionC?.subSections?.find((sub) =>
        sub.heading.includes("Differential Growth"),
      );
      expect(case3).toBeDefined();
      expect(case3?.formulas.some((f) => f.latex.includes("P_N"))).toBe(true);

      // Verify Section D growth rate formula (Retention ratio * ROE) and R decomposition
      const sectionD = note.sections.find((s) => s.letter === "D");
      expect(sectionD).toBeDefined();
      const growthSub = sectionD?.subSections?.find((sub) => sub.heading.includes("growth rate"));
      expect(growthSub?.formulas[0].latex).toContain("\\text{Retention ratio}");
      expect(growthSub?.formulas[0].latex).toContain("\\text{Return on retained earnings");
      expect(growthSub?.formulas[0].latex).not.toContain("P_1 - P_0");

      const discountSub = sectionD?.subSections?.find((sub) => sub.heading.includes("discount rate"));
      expect(discountSub?.formulas[0].latex).toContain("Dividend Yield");
      expect(discountSub?.formulas[0].latex).toContain("Capital Gains Yield");

      // Verify Section E includes Deferred Preferred Stock
      const sectionE = note.sections.find((s) => s.letter === "E");
      expect(sectionE).toBeDefined();
      const deferredSub = sectionE?.subSections?.find((sub) => sub.heading.includes("Deferred"));
      expect(deferredSub).toBeDefined();
      expect(deferredSub?.formulas[0].latex).toContain("P_{t-1}");

      // Verify crisp Key Takeaways box with structured items and boundary condition (g < R)
      expect(sectionC?.keyTakeaways).toBeDefined();
      expect(sectionC?.keyTakeaways?.title).toBe("KEY TAKEAWAYS");
      expect(sectionC?.keyTakeaways?.items?.length).toBe(4);
      expect(sectionC?.keyTakeaways?.items?.[1].subBullets).toContain(
        "Constant growth → Gordon model",
      );
      expect(sectionC?.keyTakeaways?.boundaryConditions).toContain("g < R");
    }
  });

  it("strictly enforces all pedagogical & conciseness rules and hallucination shield in the prompt", () => {
    // 1. STRIP ALL NOISE
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("1. STRIP ALL NOISE");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("attendance QR codes");

    // 2. STRICT ACADEMIC HALLUCINATION SHIELD
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("STRICT ACADEMIC HALLUCINATION SHIELD");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("FUNDAMENTAL GROWTH RATE (g)");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Retention ratio");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("REQUIRED RETURN (R) DECOMPOSITION");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Dividend Yield");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Capital Gains Yield");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("MULTI-STAGE TERMINAL VALUE (P_N)");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("DEFERRED PREFERRED STOCK");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("g = 0");

    // 3. HIERARCHICAL STRUCTURE
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("3. HIERARCHICAL STRUCTURE");

    // 4. BILINGUAL COGNITIVE ANCHORING
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("4. BILINGUAL COGNITIVE ANCHORING (EN/VI)");

    // 5. FORMULA STANDARDIZATION & NON-REDUNDANCY
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("5. FORMULA STANDARDIZATION");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("LaTeX");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('"Trong đó:" (Where:)');

    // 6. SYNTHESIZE "KEY TAKEAWAYS"
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('6. SYNTHESIZE "KEY TAKEAWAYS"');

    // 7. RADICAL BREVITY & ZERO FLUFF
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("7. RADICAL BREVITY & ZERO FLUFF");
  });

  it("applyHallucinationShield intercepts circular formulas, fixes typos, and injects missing mechanisms", () => {
    const rawSlideText = "NovaCo issued deferred preferred stock beginning 12 years from now. Required return is 6%.";

    const mockSections: any[] = [
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. DDM",
        bulletPoints: ["Dividends remain same (g = o)"],
        formulas: [],
        subSections: [
          {
            heading: "CASE 1: Zero Growth (g = o)",
            bulletPoints: ["Constant cash flow (g = o)"],
            formulas: [{ latex: "P_o = \\frac{D}{R_o}", variables: [] }],
          },
          {
            heading: "CASE 3: Differential Growth",
            bulletPoints: ["Non-constant dividends"],
            formulas: [{ latex: "P_0 = \\sum \\frac{D_t}{(1+R)^t}", variables: [] }],
          },
        ],
      },
      {
        id: "sec-d",
        letter: "D",
        titleVi: "D. PARAMETERS",
        bulletPoints: [],
        formulas: [],
        subSections: [
          {
            heading: "1. Finding the growth rate (g)",
            bulletPoints: [],
            formulas: [{ latex: "g = \\frac{P_1 - P_0}{P_0}", variables: [] }],
          },
          {
            heading: "2. Finding the discount rate (R)",
            bulletPoints: [],
            formulas: [{ latex: "R = \\frac{D_1}{P_0} + g", variables: [] }],
          },
        ],
      },
      {
        id: "sec-e",
        letter: "E",
        titleVi: "E. VALUE OF PREFERENCE SHARE",
        bulletPoints: [],
        formulas: [{ latex: "P_p = \\frac{D_p}{R_p}", variables: [] }],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockSections, rawSlideText);

    // 1. Typos fixed
    expect(shielded[0].subSections[0].heading).toContain("g = 0");
    expect(shielded[0].subSections[0].heading).not.toContain("g = o");
    expect(shielded[0].subSections[0].formulas[0].latex).toContain("P_0");
    expect(shielded[0].subSections[0].formulas[0].latex).toContain("R_0");

    // 2. Case 3 Terminal Value injected
    const case3 = shielded[0].subSections[1];
    expect(case3.formulas.some((f: any) => f.latex.includes("P_N"))).toBe(true);

    // 3. Circular growth rate replaced with Retention Ratio * Return on retained earnings
    const growthSub = shielded[1].subSections[0];
    expect(growthSub.formulas[0].latex).toContain("\\text{Retention ratio}");
    expect(growthSub.formulas[0].latex).toContain("\\text{Return on retained earnings");
    expect(growthSub.formulas[0].latex).not.toContain("P_1 - P_0");

    // 4. R decomposition underbraces and bullets added
    const discountSub = shielded[1].subSections[1];
    expect(discountSub.formulas[0].latex).toContain("Dividend Yield");
    expect(discountSub.formulas[0].latex).toContain("Capital Gains Yield");
    expect(discountSub.bulletPoints.some((bp: string) => bp.includes("Dividend Yield"))).toBe(true);

    // 5. Deferred Preferred Stock injected because rawSlideText mentions deferred
    const prefSec = shielded[2];
    const deferredSub = prefSec.subSections.find((sub: any) => sub.heading.includes("Deferred"));
    expect(deferredSub).toBeDefined();
    expect(deferredSub?.formulas[0].latex).toContain("P_{t-1}");
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

  it("requires 100% of fields in generatedClutchNoteSchema so Gemini structured decoding never omits section content", () => {
    const jsonSchema = zodSchema(generatedClutchNoteSchema).jsonSchema as Record<string, any>;

    function assertAllObjectPropertiesRequired(node: any, path = "root") {
      if (!node || typeof node !== "object") return;
      if (node.type === "object" && node.properties) {
        const propKeys = Object.keys(node.properties).sort();
        const requiredKeys = [...(node.required ?? [])].sort();
        expect(requiredKeys, `Missing required keys at ${path}`).toEqual(propKeys);

        for (const [key, child] of Object.entries<any>(node.properties)) {
          expect(child.default, `Unexpected .default() at ${path}.${key}`).toBeUndefined();
          assertAllObjectPropertiesRequired(child, `${path}.${key}`);
        }
      }
      if (node.type === "array" && node.items) {
        assertAllObjectPropertiesRequired(node.items, `${path}[]`);
      }
    }

    assertAllObjectPropertiesRequired(jsonSchema);
  });
});
