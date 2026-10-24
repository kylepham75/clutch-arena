import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { zodSchema } from "ai";
import { clutchNoteSchema } from "@/lib/schemas/notes";
import {
  generatedClutchNoteSchema,
  applyHallucinationShield,
  sanitizeAcademicHeader,
} from "@/lib/ai/generate-notes";
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
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("ONE-PERIOD HOLDING HORIZON FORMULA");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("FUNDAMENTAL GROWTH RATE (g)");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Retention ratio");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("REQUIRED RETURN (R) DECOMPOSITION");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Dividend Yield");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Capital Gains Yield");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("MULTI-STAGE TERMINAL VALUE (P_N)");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("DEFERRED PREFERRED STOCK");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("g = 0");

    // 3. CANONICAL HIERARCHICAL ARCHITECTURE
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("3. CANONICAL HIERARCHICAL ARCHITECTURE");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("ZERO DUPLICATION / ZERO DOUBLE-PASTING");

    // 4. STRICT ACADEMIC HEADER POLICY
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("4. STRICT ACADEMIC HEADER POLICY");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("giáo dục");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("cứu trợ");

    // 5. FORMULA STANDARDIZATION & NON-REDUNDANCY
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("5. FORMULA STANDARDIZATION");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("LaTeX");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('"Trong đó:" (Where:)');

    // 6. SYNTHESIZE "KEY TAKEAWAYS"
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain('6. SYNTHESIZE "KEY TAKEAWAYS"');

    // 7. RADICAL BREVITY & ZERO FLUFF
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("7. RADICAL BREVITY & ZERO FLUFF");
  });

  it("sanitizeAcademicHeader purges machine-translation hallucinations and restores canonical titles", () => {
    expect(sanitizeAcademicHeader("Header B: CHỌN MÔ HÌNH GIÁO DỤC", "B")).toBe(
      "B. CÔNG THỨC TỔNG QUÁT",
    );
    expect(sanitizeAcademicHeader("Header C: RITM KHÔNG ĐỎI", "C")).toBe(
      "C. DDM (DIVIDEND DISCOUNT MODEL)",
    );
    expect(sanitizeAcademicHeader("Header D: MÔ HÌNH TĂNG TRƯỞNG HẠNH HẠNH", "C")).toBe(
      "C. DDM (DIVIDEND DISCOUNT MODEL)",
    );
    expect(sanitizeAcademicHeader("Header H: GIÁ TRỊ CỨU TRỢ CHỨNG KHOÁN ƯU TIÊN", "E")).toBe(
      "E. VALUE OF PREFERENCE SHARE",
    );
    expect(sanitizeAcademicHeader("CỔ PHIẾU ƯU TIÊN BỔ TRỢ HỢP TÁC", "E")).toBe(
      "E. VALUE OF PREFERENCE SHARE",
    );
    expect(sanitizeAcademicHeader("A. NGUYÊN LÝ CƠ BẢN", "A")).toBe("A. NGUYÊN LÝ CƠ BẢN");
  });

  it("applyHallucinationShield intercepts circular formulas, fixes exponent errors, prevents double-pasting, and consolidates fragmented sections", () => {
    const rawSlideText =
      "NovaCo issued deferred preferred stock beginning 12 years from now. Required return is 6%.";

    // Simulate fragmented sections with machine-translated headers and formula errors
    const mockSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. NGUYÊN LÝ CƠ BẢN",
        bulletPoints: ["Asset value = PV of future cash flows"],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "Header B: CHỌN MÔ HÌNH GIÁO DỤC",
        bulletPoints: [],
        formulas: [
          {
            latex: "P_0 = \\frac{D_1}{(1+R)^T} + \\frac{P_1}{(1+R)^T}",
            variables: [],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "Header C: RITM KHÔNG ĐỎI",
        bulletPoints: ["Dividends remain same (g = o)"],
        // Simulate double-pasting: Case 1 and Case 2 formulas placed at section top-level
        formulas: [
          { latex: "P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1+R)^t}", variables: [] },
          { latex: "P_0 = \\frac{D}{R}", variables: [] },
          { latex: "P_0 = \\frac{D_1}{R - g}", variables: [] },
        ],
        subSections: [
          {
            heading: "CASE 1: Zero Growth (g = o)",
            bulletPoints: ["Constant cash flow (g = o)"],
            formulas: [{ latex: "P_o = \\frac{D}{R_o}", variables: [] }],
          },
          {
            heading: "CASE 2: Constant Growth",
            bulletPoints: ["Dividends grow at rate g"],
            formulas: [{ latex: "P_0 = \\frac{D_1}{R - g}", variables: [] }],
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
        titleVi: "Header H: GIÁ TRỊ CỨU TRỢ CHỨNG KHOÁN ƯU TIÊN",
        bulletPoints: [],
        formulas: [{ latex: "P_p = \\frac{D_p}{R_p}", variables: [] }],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockSections, rawSlideText);

    // 1. One-year holding period exponent T fixed to 1 + R
    const secB = shielded[1];
    expect(secB.titleVi).toBe("B. CÔNG THỨC TỔNG QUÁT");
    expect(secB.formulas[0].latex).toContain("\\frac{D_1}{1 + R}");
    expect(secB.formulas[0].latex).toContain("\\frac{P_1}{1 + R}");
    expect(secB.formulas[0].latex).not.toContain("(1+R)^T");
    expect(secB.formulas[0].latex).not.toContain("(1 + R)^T");

    // 2. Section C header sanitized & double-pasting eliminated from top-level
    const secC = shielded[2];
    expect(secC.titleVi).toBe("C. DDM (DIVIDEND DISCOUNT MODEL)");
    // Top level must ONLY contain the general summation, NOT duplicate P_0 = D/R or P_0 = D_1/(R-g)
    expect(secC.formulas.length).toBe(1);
    expect(secC.formulas[0].latex).toContain("\\sum");

    // 3. Typo characters g = o fixed in subSections
    expect(secC.subSections[0].heading).toContain("g = 0");
    expect(secC.subSections[0].heading).not.toContain("g = o");
    expect(secC.subSections[0].formulas[0].latex).toContain("P_0");
    expect(secC.subSections[0].formulas[0].latex).toContain("R_0");

    // 4. Case 3 Terminal Value injected
    const case3 = secC.subSections[2];
    expect(case3.formulas.some((f: any) => f.latex.includes("P_N"))).toBe(true);

    // 5. Circular growth rate replaced with Retention Ratio * Return on retained earnings
    const secD = shielded[3];
    expect(secD.titleVi).toBe("D. PARAMETERS IN DIVIDEND DISCOUNT MODEL");
    const growthSub = secD.subSections[0];
    expect(growthSub.formulas[0].latex).toContain("\\text{Retention ratio}");
    expect(growthSub.formulas[0].latex).toContain("\\text{Return on retained earnings");
    expect(growthSub.formulas[0].latex).not.toContain("P_1 - P_0");

    // 6. R decomposition underbraces and bullets added
    const discountSub = secD.subSections[1];
    expect(discountSub.formulas[0].latex).toContain("Dividend Yield");
    expect(discountSub.formulas[0].latex).toContain("Capital Gains Yield");
    expect(discountSub.bulletPoints.some((bp: string) => bp.includes("Dividend Yield"))).toBe(true);

    // 7. Preferred stock header sanitized & Deferred Preferred Stock injected
    const prefSec = shielded[4];
    expect(prefSec.titleVi).toBe("E. VALUE OF PREFERENCE SHARE");
    const deferredSub = prefSec.subSections.find((sub: any) => sub.heading.includes("Deferred"));
    expect(deferredSub).toBeDefined();
    expect(deferredSub?.formulas[0].latex).toContain("P_{t-1}");
  });

  it("consolidates fragmented 9-section LLM outputs (A through I) into strictly 5 canonical sections", () => {
    const rawSlideText =
      "Stock Valuation Chapter 9. DDM models, Constant growth, Non-constant growth, NovaCo deferred preferred stock.";

    const fragmentedNineSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. NGUYÊN LÝ CƠ BẢN",
        bulletPoints: ["Asset value = PV of cash flows"],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "Header B: CHỌN MÔ HÌNH GIÁO DỤC",
        bulletPoints: [],
        formulas: [{ latex: "P_0 = \\frac{D_1}{(1+R)^T} + \\frac{P_1}{(1+R)^T}", variables: [] }],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "Header C: RITM KHÔNG ĐỎI",
        bulletPoints: ["Zero growth perpetuity"],
        formulas: [{ latex: "P_0 = \\frac{D}{R}", variables: [] }],
        subSections: [],
      },
      {
        id: "sec-d",
        letter: "D",
        titleVi: "Header D: MÔ HÌNH TĂNG TRƯỞNG HẠNH HẠNH",
        bulletPoints: ["Constant growth Gordon model"],
        formulas: [{ latex: "P_0 = \\frac{D_1}{R - g}", variables: [] }],
        subSections: [],
      },
      {
        id: "sec-e",
        letter: "E",
        titleVi: "CASE 3: DIFFERENTIAL GROWTH",
        bulletPoints: ["Multi-stage growth"],
        formulas: [{ latex: "P_0 = \\sum_{t=1}^N \\frac{D_t}{(1+R)^t} + \\frac{P_N}{(1+R)^N}", variables: [] }],
        subSections: [],
      },
      {
        id: "sec-f",
        letter: "F",
        titleVi: "1. Finding the growth rate (g)",
        bulletPoints: [],
        formulas: [{ latex: "g = \\frac{P_1 - P_0}{P_0}", variables: [] }],
        subSections: [],
      },
      {
        id: "sec-g",
        letter: "G",
        titleVi: "2. Finding the discount rate (R)",
        bulletPoints: [],
        formulas: [{ latex: "R = \\frac{D_1}{P_0} + g", variables: [] }],
        subSections: [],
      },
      {
        id: "sec-h",
        letter: "H",
        titleVi: "Header H: GIÁ TRỊ CỨU TRỢ CHỨNG KHOÁN ƯU TIÊN",
        bulletPoints: ["Fixed dividends, perpetuity"],
        formulas: [{ latex: "P_p = \\frac{D_p}{R_p}", variables: [] }],
        subSections: [],
      },
      {
        id: "sec-i",
        letter: "I",
        titleVi: "CỔ PHIẾU ƯU TIÊN BỔ TRỢ HỢP TÁC",
        bulletPoints: ["Dividends begin Year 12"],
        formulas: [{ latex: "P_{t-1} = \\frac{D_t}{R_p}", variables: [] }],
        subSections: [],
      },
    ];

    const consolidated = applyHallucinationShield(fragmentedNineSections, rawSlideText);

    // Exactly 5 sections: A, B, C, D, E (no F, G, H, I)
    expect(consolidated.length).toBe(5);
    expect(consolidated.map((s) => s.letter)).toEqual(["A", "B", "C", "D", "E"]);

    // Titles must be canonical and have zero machine-translation gibberish
    expect(consolidated[0].titleVi).toBe("A. NGUYÊN LÝ CƠ BẢN");
    expect(consolidated[1].titleVi).toBe("B. CÔNG THỨC TỔNG QUÁT");
    expect(consolidated[2].titleVi).toBe("C. DDM (DIVIDEND DISCOUNT MODEL)");
    expect(consolidated[3].titleVi).toBe("D. PARAMETERS IN DIVIDEND DISCOUNT MODEL");
    expect(consolidated[4].titleVi).toBe("E. VALUE OF PREFERENCE SHARE");

    // All banned machine translations must not exist anywhere in section titles
    const allTitles = consolidated.map((s) => s.titleVi).join(" ");
    expect(allTitles).not.toContain("giáo dục");
    expect(allTitles).not.toContain("cứu trợ");
    expect(allTitles).not.toContain("hạnh hạnh");
    expect(allTitles).not.toContain("ritm");
    expect(allTitles).not.toContain("bổ trợ hợp tác");

    // Section B formula exponent fixed
    expect(consolidated[1].formulas[0].latex).toBe("P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}");

    // Section C contains Case 1, 2, 3 in subSections
    expect(consolidated[2].subSections.length).toBeGreaterThanOrEqual(3);

    // Section D contains Finding g and Finding R
    expect(consolidated[3].subSections.length).toBeGreaterThanOrEqual(2);

    // Section E contains Deferred Preferred Stock
    expect(consolidated[4].subSections.some((sub) => sub.heading.includes("Deferred") || sub.heading.includes("hoãn trả"))).toBe(true);
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
