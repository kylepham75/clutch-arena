import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { zodSchema } from "ai";
import { clutchNoteSchema } from "@/lib/schemas/notes";
import {
  generatedClutchNoteSchema,
  applyHallucinationShield,
  sanitizeAcademicHeader,
  ensureInlineMathDelimiters,
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

    // 4. Case 3 Terminal Value injected with LaTeX math delimiters
    const case3 = secC.subSections[2];
    const case3Terminal = case3.formulas.find((f: any) => f.latex.includes("P_N"));
    expect(case3Terminal).toBeDefined();
    expect(case3Terminal?.description).toBe(
      "$P_N$ represents the present value of the constant growth perpetuity at the end of Year $N$.",
    );
    expect(
      case3Terminal?.variables.find((v: any) => v.symbol === "D_{N+1}")?.definition,
    ).toBe("First dividend in the constant growth stage ($D_N \\times (1 + g)$)");

    // 5. Circular growth rate replaced with Retention Ratio * Return on retained earnings
    const secD = shielded[3];
    expect(secD.titleVi).toBe("D. PARAMETERS IN DIVIDEND DISCOUNT MODEL");
    const growthSub = secD.subSections[0];
    expect(growthSub.formulas[0].latex).toContain("\\text{Retention ratio}");
    expect(growthSub.formulas[0].latex).toContain("\\text{Return on retained earnings");
    expect(growthSub.formulas[0].latex).not.toContain("P_1 - P_0");

    // 6. R decomposition underbraces and bullets added with $...$ inline math delimiters
    const discountSub = secD.subSections[1];
    expect(discountSub.formulas[0].latex).toContain("Dividend Yield");
    expect(discountSub.formulas[0].latex).toContain("Capital Gains Yield");
    expect(discountSub.bulletPoints[0]).toBe(
      "Dividend Yield (Lợi suất cổ tức) $= \\frac{D_1}{P_0}$: Expected annual dividend divided by current stock price (tested independently).",
    );
    expect(discountSub.bulletPoints[1]).toBe(
      "Capital Gains Yield (Lợi suất tăng vốn) $= g$: The rate at which the stock price increases over time.",
    );

    // 7. Preferred stock header sanitized & Deferred Preferred Stock injected with $...$ delimiters
    const prefSec = shielded[4];
    expect(prefSec.titleVi).toBe("E. VALUE OF PREFERENCE SHARE");
    const deferredSub = prefSec.subSections.find((sub: any) => sub.heading.includes("Deferred"));
    expect(deferredSub).toBeDefined();
    expect(deferredSub?.formulas[0].latex).toContain("P_{t-1}");
    expect(deferredSub?.bulletPoints[0]).toBe(
      "Step 1: Calculate the price at Year $t-1$ (one year before first dividend): $P_{t-1} = \\frac{D_t}{R_p}$",
    );
    expect(deferredSub?.bulletPoints[1]).toBe(
      "Step 2: Discount $P_{t-1}$ back to Year 0: $P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}$",
    );
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

  it("wraps bare \\frac{...}{...} in prose bulletPoints in $...$ delimiters without modifying strings that already have $", () => {
    // 1. Bare fraction wrapped in $...$
    const rawBullet = "Dividend Yield = \\frac{D_1}{P_0}: Expected annual dividend";
    expect(ensureInlineMathDelimiters(rawBullet)).toBe(
      "Dividend Yield = $\\frac{D_1}{P_0}$: Expected annual dividend",
    );

    // 2. Bare fraction with 1 level of nested braces wrapped in $...$
    const nestedBullet =
      "Deferred price step: P_{t-1} = \\frac{D_t}{R_p} and P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}";
    expect(ensureInlineMathDelimiters(nestedBullet)).toBe(
      "Deferred price step: P_{t-1} = $\\frac{D_t}{R_p}$ and P_0 = $\\frac{P_{t-1}}{(1 + R_p)^{t-1}}$",
    );

    // 3. String that already has $ is preserved as-is
    const alreadyWrapped = "Dividend Yield $= \\frac{D_1}{P_0}$: already has delimiters";
    expect(ensureInlineMathDelimiters(alreadyWrapped)).toBe(alreadyWrapped);

    // 4. String without fraction is untouched
    const plainText = "Standard bullet point with no math formulas.";
    expect(ensureInlineMathDelimiters(plainText)).toBe(plainText);

    // 5. Bare fraction in Section bulletPoints processed via applyHallucinationShield
    const testSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. NGUYÊN LÝ CƠ BẢN",
        bulletPoints: ["Raw fraction bullet: \\frac{CF_t}{(1+r)^t} without dollars"],
        formulas: [],
        subSections: [],
      },
    ];
    const result = applyHallucinationShield(testSections, "");
    expect(result[0].bulletPoints[0]).toBe(
      "Raw fraction bullet: $\\frac{CF_t}{(1+r)^t}$ without dollars",
    );
  });

  it("accurately preserves Chapter 13 Cost of Capital & WACC sections and formulas without injecting Chapter 9 Stock Valuation content", () => {
    const rawSlideText = `
Chapter 13: Cost of Capital & WACC.
The Cost of Capital: An Overview.
Cost of Equity: SML (CAPM) approach R_E = R_f + beta_E * (R_M - R_f) and Dividend Growth Model (DGM) approach R_E = D_1 / P_0 + g.
Cost of Debt: After-tax cost of debt is R_D * (1 - T_C).
Cost of Preferred Stock: R_P = D / P_0.
Weighted Average Cost of Capital (WACC):
WACC = (E/V) * R_E + (P/V) * R_P + (D/V) * R_D * (1 - T_C).
Divisional Risk & The Pure Play Approach.
Flotation Costs: f_A = (E/V) * f_E + (D/V) * f_D, Initial Outlay = Project Cost / (1 - f_A).
`;

    const mockChapter13Sections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TỔNG QUAN VỀ CHI PHÍ SỬ DỤNG VỐN (COST OF CAPITAL OVERVIEW)",
        coreStatement: "The cost of capital depends primarily on the use of funds, not the source.",
        overview: "The firm's overall cost of capital reflects the required return on the firm as a whole.",
        bulletPoints: [
          "Cost of capital is the minimum required rate of return on new investments.",
          "Capital structure weights depend on market values: $V = E + D + P$.",
        ],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. CHI PHÍ VỐN CỔ PHẦN (COST OF EQUITY)",
        bulletPoints: ["The return that equity investors require on their investment in the firm."],
        formulas: [],
        subSections: [
          {
            heading: "1. The SML / CAPM Approach",
            bulletPoints: [
              "Risk-free rate $R_f$: Usually measured by U.S. Treasury bill rate.",
              "Beta $\\beta_E$: Systematic risk of the firm's equity.",
            ],
            formulas: [
              {
                leadText: "Cost of equity via CAPM:",
                latex: "R_E = R_f + \\beta_E (R_M - R_f)",
                description: "",
                variables: [
                  { symbol: "R_f", definition: "Risk-free rate" },
                  { symbol: "\\beta_E", definition: "Beta of equity" },
                  { symbol: "R_M - R_f", definition: "Market risk premium" },
                ],
              },
            ],
          },
          {
            heading: "2. The Dividend Growth Model (DGM) Approach",
            bulletPoints: ["Alternative approach for dividend-paying companies."],
            formulas: [
              {
                leadText: "Cost of equity via DGM:",
                latex: "R_E = \\frac{D_1}{P_0} + g",
                description: "",
                variables: [
                  { symbol: "D_1", definition: "Next expected dividend" },
                  { symbol: "P_0", definition: "Current stock price" },
                  { symbol: "g", definition: "Sustainable dividend growth rate" },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. CHI PHÍ NỢ VAY VÀ CỔ PHIẾU ƯU ĐÃI (COST OF DEBT & PREFERRED STOCK)",
        bulletPoints: ["Interest expense on debt is tax-deductible, creating an interest tax shield."],
        formulas: [
          {
            leadText: "After-tax cost of debt:",
            latex: "R_{D,\\text{after-tax}} = R_D (1 - T_C)",
            description: "",
            variables: [
              { symbol: "R_D", definition: "Pre-tax cost of debt (yield to maturity on existing bonds)" },
              { symbol: "T_C", definition: "Corporate tax rate" },
            ],
          },
          {
            leadText: "Cost of preferred stock (no tax deduction):",
            latex: "R_P = \\frac{D}{P_0}",
            description: "",
            variables: [
              { symbol: "D", definition: "Fixed dividend payment" },
              { symbol: "P_0", definition: "Current market price of preferred share" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-d",
        letter: "D",
        titleVi: "D. CHI PHÍ SỬ DỤNG VỐN BÌNH QUÂN (WACC)",
        coreStatement: "WACC is the overall required return on the firm as a whole.",
        bulletPoints: [
          "Capital structure weights use market values: $E/V + P/V + D/V = 1$.",
        ],
        formulas: [
          {
            leadText: "Weighted Average Cost of Capital:",
            latex: "WACC = \\left(\\frac{E}{V}\\right) R_E + \\left(\\frac{P}{V}\\right) R_P + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)",
            description: "",
            variables: [
              { symbol: "E/V", definition: "Equity weight in capital structure" },
              { symbol: "D/V", definition: "Debt weight in capital structure" },
              { symbol: "P/V", definition: "Preferred stock weight in capital structure" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-e",
        letter: "E",
        titleVi: "E. RỦI RO BỘ PHẬN VÀ CHI PHÍ PHÁT HÀNH (DIVISIONAL RISK & FLOTATION COSTS)",
        bulletPoints: [
          "Using firm-wide WACC for all projects can lead to incorrect accept/reject decisions.",
        ],
        formulas: [
          {
            leadText: "Weighted average flotation cost:",
            latex: "f_A = \\left(\\frac{E}{V}\\right) f_E + \\left(\\frac{D}{V}\\right) f_D",
            description: "",
            variables: [
              { symbol: "f_A", definition: "Average flotation cost percentage" },
            ],
          },
        ],
        subSections: [
          {
            heading: "Pure Play Approach & Subjective Approach",
            bulletPoints: [
              "Pure play: Find a standalone company whose business is in the same industry as the project.",
              "Subjective approach: Adjust firm WACC upward for high-risk projects and downward for low-risk projects.",
            ],
            formulas: [],
          },
        ],
      },
    ];

    // Test direct header sanitization for Chapter 13 titles
    expect(
      sanitizeAcademicHeader("Header A: TỔNG QUAN VỀ CHI PHÍ SỬ DỤNG VỐN (COST OF CAPITAL OVERVIEW)", "A"),
    ).toBe("A. TỔNG QUAN VỀ CHI PHÍ SỬ DỤNG VỐN (COST OF CAPITAL OVERVIEW)");
    expect(
      sanitizeAcademicHeader("Header B: CHI PHÍ VỐN CHỦ SỞ HỮU (COST OF EQUITY)", "B"),
    ).toBe("B. CHI PHÍ VỐN CHỦ SỞ HỮU (COST OF EQUITY)");
    expect(
      sanitizeAcademicHeader("Header C: CHI PHÍ NỢ VAY VÀ CỔ PHIẾU ƯU ĐÃI (COST OF DEBT & PREFERRED STOCK)", "C"),
    ).toBe("C. CHI PHÍ NỢ VAY VÀ CỔ PHIẾU ƯU ĐÃI (COST OF DEBT & PREFERRED STOCK)");
    expect(
      sanitizeAcademicHeader("Header D: CHI PHÍ SỬ DỤNG VỐN BÌNH QUÂN (WACC)", "D"),
    ).toBe("D. CHI PHÍ SỬ DỤNG VỐN BÌNH QUÂN (WACC)");
    expect(
      sanitizeAcademicHeader("Header E: RỦI RO BỘ PHẬN VÀ CHI PHÍ PHÁT HÀNH (DIVISIONAL RISK & FLOTATION COSTS)", "E"),
    ).toBe("E. RỦI RO BỘ PHẬN VÀ CHI PHÍ PHÁT HÀNH (DIVISIONAL RISK & FLOTATION COSTS)");

    const shielded = applyHallucinationShield(mockChapter13Sections, rawSlideText);

    // Verify 5 sections with exact Chapter 13 titles
    expect(shielded.length).toBe(5);
    expect(shielded.map((s) => s.letter)).toEqual(["A", "B", "C", "D", "E"]);
    expect(shielded[0].titleVi).toContain("CHI PHÍ SỬ DỤNG VỐN");
    expect(shielded[1].titleVi).toContain("COST OF EQUITY");
    expect(shielded[2].titleVi).toContain("COST OF DEBT & PREFERRED STOCK");
    expect(shielded[3].titleVi).toContain("WACC");
    expect(shielded[4].titleVi).toContain("DIVISIONAL RISK & FLOTATION COSTS");

    // ZERO Chapter 9 titles should be present
    const allTitles = shielded.map((s) => s.titleVi).join(" ");
    expect(allTitles).not.toContain("NGUYÊN LÝ CƠ BẢN");
    expect(allTitles).not.toContain("CÔNG THỨC TỔNG QUÁT");
    expect(allTitles).not.toContain("DDM (DIVIDEND DISCOUNT MODEL)");
    expect(allTitles).not.toContain("PARAMETERS IN DIVIDEND DISCOUNT MODEL");
    expect(allTitles).not.toContain("VALUE OF PREFERENCE SHARE");

    // Verify WACC formula is preserved intact
    const waccSec = shielded[3];
    expect(waccSec.formulas[0].latex).toContain("WACC");
    expect(waccSec.formulas[0].latex).toContain("(1 - T_C)");

    // Verify Cost of Debt with tax shield formula is preserved intact
    const debtSec = shielded[2];
    expect(debtSec.formulas.some((f: any) => f.latex.includes("1 - T_C"))).toBe(true);

    // Verify Cost of Equity CAPM formula is preserved intact
    const equitySec = shielded[1];
    const capmSub = equitySec.subSections?.find((sub: any) => sub.heading.includes("CAPM"));
    expect(capmSub?.formulas[0].latex).toContain("R_f + \\beta_E");

    // ZERO Chapter 9 formulas or injected bullets should exist
    const allLatex = JSON.stringify(shielded);
    expect(allLatex).not.toContain("P_N = \\frac{D_{N+1}}{R - g}");
    expect(allLatex).not.toContain("P_{t-1} = \\frac{D_t}{R_p}");
    expect(allLatex).not.toContain("Dividend Yield (Lợi suất cổ tức)");
    expect(allLatex).not.toContain("Capital Gains Yield (Lợi suất tăng vốn)");
  });
});
