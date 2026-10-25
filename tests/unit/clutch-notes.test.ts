import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { zodSchema } from "ai";
import { clutchNoteSchema } from "@/lib/schemas/notes";
import {
  generatedClutchNoteSchema,
  applyHallucinationShield,
  sanitizeAcademicHeader,
  ensureInlineMathDelimiters,
  deduplicateSectionFormulas,
  cleanTypoString,
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

    // Stage 4 Additions: Arithmetic Mean vs Sample Variance and Typography Shield
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("Arithmetic Mean ALWAYS divides by total periods T");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("NEVER divide Arithmetic Mean by T - 1");
    expect(CLUTCH_NOTES_SYSTEM_PROMPT).toContain("NEVER substitute Greek Sigma");
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
      "Deferred price step: $P_{t-1} = \\frac{D_t}{R_p}$ and $P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}$",
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

  it("accurately preserves Chapter 10 Historical Risk & Return sections and formulas, intercepts biased variance denominator, and injects missing core problem formulas", () => {
    const rawSlideText =
      "Chapter 10: Some Lessons from Capital Market History. Historical returns, arithmetic vs geometric averages, sample variance with T - 1, and efficient markets.";

    const mockChapter10Sections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TỔNG QUAN LỢI SUẤT & LỢI SUẤT LỊCH SỬ",
        bulletPoints: ["Total return includes dividend yield and capital gains yield."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. TRUNG BÌNH SỐ HỌC VÀ HÌNH HỌC",
        bulletPoints: ["Arithmetic vs Geometric average returns."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. PHƯƠNG SAI VÀ ĐỘ LỆCH CHUẨN LỊCH SỬ",
        bulletPoints: ["Sample variance calculation over T periods."],
        formulas: [
          {
            leadText: "Sample variance (corrupted with T instead of T - 1):",
            latex: "s^2 = \\frac{1}{T} \\sum_{t=1}^T (R_t - \\bar{R})^2",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-d",
        letter: "D",
        titleVi: "D. THỊ TRƯỜNG HIỆU QUẢ (EFFICIENT CAPITAL MARKETS)",
        bulletPoints: [
          "Weak form: past prices.",
          "Semi-strong form: all public information.",
          "Strong form: all information including insider info.",
        ],
        formulas: [],
        subSections: [],
      },
    ];

    // Verify academic headers are not overwritten
    expect(sanitizeAcademicHeader("A. TỔNG QUAN LỢI SUẤT & LỢI SUẤT LỊCH SỬ", "A")).toBe(
      "A. TỔNG QUAN LỢI SUẤT & LỢI SUẤT LỊCH SỬ",
    );
    expect(sanitizeAcademicHeader("C. PHƯƠNG SAI VÀ ĐỘ LỆCH CHUẨN LỊCH SỬ", "C")).toBe(
      "C. PHƯƠNG SAI VÀ ĐỘ LỆCH CHUẨN LỊCH SỬ",
    );

    const shielded = applyHallucinationShield(mockChapter10Sections, rawSlideText);

    // Verify Chapter 10 titles are preserved
    expect(shielded.length).toBeGreaterThanOrEqual(4);
    expect(shielded[0].titleVi).toContain("TỔNG QUAN LỢI SUẤT");
    expect(shielded[1].titleVi).toContain("TRUNG BÌNH SỐ HỌC VÀ HÌNH HỌC");
    expect(shielded[2].titleVi).toContain("PHƯƠNG SAI VÀ ĐỘ LỆCH CHUẨN LỊCH SỬ");
    expect(shielded[3].titleVi).toContain("THỊ TRƯỜNG HIỆU QUẢ");

    // ZERO Chapter 9 or Chapter 13 titles
    const allTitles = shielded.map((s) => s.titleVi).join(" ");
    expect(allTitles).not.toContain("NGUYÊN LÝ CƠ BẢN");
    expect(allTitles).not.toContain("DDM (DIVIDEND DISCOUNT MODEL)");
    expect(allTitles).not.toContain("CHI PHÍ SỬ DỤNG VỐN");

    // Verify biased variance denominator 1/T is intercepted and corrected to 1/(T - 1)
    const varSec = shielded[2];
    expect(varSec.formulas[0].latex).toContain("T - 1");
    expect(varSec.formulas[0].latex).not.toContain("\\frac{1}{T} \\sum");

    // Verify core problem formulas injected into Chapter 10 (Total Return, Geometric, Arithmetic)
    const secA = shielded[0];
    expect(secA.formulas.some((f: any) => f.latex.includes("D_{t+1} + P_{t+1} - P_t"))).toBe(true);
    const secB = shielded[1];
    expect(secB.formulas.some((f: any) => f.latex.includes("\\bar{R}_{\\text{geom}}"))).toBe(true);
    expect(secB.formulas.some((f: any) => f.latex.includes("\\prod_{t=1}^T (1 + R_t)"))).toBe(true);
  });

  it("accurately preserves Chapter 11 Expected Return, Portfolio Theory & CAPM sections, corrects scenario variance, and safeguards 4 core calculation problem formulas", () => {
    const rawSlideText =
      "Chapter 11: Risk and Return - Capital Asset Pricing Model (CAPM). Portfolio expected returns, portfolio variance for 2 assets, covariance, correlation coefficient, systematic risk and beta.";

    const mockChapter11Sections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TỶ SUẤT SINH LỜI KỲ VỌNG VÀ PHƯƠNG SAI KỊCH BẢN",
        bulletPoints: ["Expected return and scenario variance using probabilities P_i."],
        formulas: [
          {
            leadText: "Scenario variance (corrupted with T - 1 degrees of freedom):",
            latex: "\\sigma^2 = \\frac{1}{T - 1} \\sum_{i=1}^n P_i (R_i - E[R])^2",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. DANH MỤC ĐẦU TƯ VÀ RỦI RO DANH MỤC",
        bulletPoints: ["Portfolio weights w_A + w_B = 1."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. HIỆP PHƯƠNG SAI VÀ HỆ SỐ TƯƠNG QUAN",
        bulletPoints: ["Covariance measures how two assets co-move."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-d",
        letter: "D",
        titleVi: "D. ĐA DẠNG HÓA VÀ RỦI RO HỆ THỐNG",
        bulletPoints: ["Unsystematic risk is diversifiable; systematic risk is non-diversifiable."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-e",
        letter: "E",
        titleVi: "E. ĐƯỜNG THỊ TRƯỜNG CHỨNG KHOÁN (SML) VÀ MÔ HÌNH CAPM",
        bulletPoints: ["SML represents market equilibrium."],
        formulas: [],
        subSections: [],
      },
    ];

    // Verify academic headers are not overwritten
    expect(sanitizeAcademicHeader("A. TỶ SUẤT SINH LỜI KỲ VỌNG VÀ PHƯƠNG SAI KỊCH BẢN", "A")).toBe(
      "A. TỶ SUẤT SINH LỜI KỲ VỌNG VÀ PHƯƠNG SAI KỊCH BẢN",
    );
    expect(sanitizeAcademicHeader("E. ĐƯỜNG THỊ TRƯỜNG CHỨNG KHOÁN (SML) VÀ MÔ HÌNH CAPM", "E")).toBe(
      "E. ĐƯỜNG THỊ TRƯỜNG CHỨNG KHOÁN (SML) VÀ MÔ HÌNH CAPM",
    );

    const shielded = applyHallucinationShield(mockChapter11Sections, rawSlideText);

    // Verify Chapter 11 titles preserved
    expect(shielded.length).toBe(5);
    expect(shielded[0].titleVi).toContain("TỶ SUẤT SINH LỜI KỲ VỌNG");
    expect(shielded[1].titleVi).toContain("DANH MỤC ĐẦU TƯ");
    expect(shielded[2].titleVi).toContain("HIỆP PHƯƠNG SAI");
    expect(shielded[3].titleVi).toContain("ĐA DẠNG HÓA");
    expect(shielded[4].titleVi).toContain("MÔ HÌNH CAPM");

    // Verify scenario variance denominator corruption (T - 1) is purged
    const secA = shielded[0];
    expect(secA.formulas[0].latex).toContain("\\sum_{i=1}^n P_i (R_i - E[R])^2");
    expect(secA.formulas[0].latex).not.toContain("T - 1");

    // Verify 4 Core Calculation Problem Types formulas are safeguarded/injected:
    // 1. Portfolio Return & Portfolio Risk
    const secB = shielded[1];
    expect(secB.formulas.some((f: any) => f.latex.includes("\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2"))).toBe(true);
    expect(secB.formulas.some((f: any) => f.latex.includes("E[R_p] = w_A E[R_A] + w_B E[R_B]"))).toBe(true);

    // 2. Covariance & Correlation
    const secC = shielded[2];
    expect(secC.formulas.some((f: any) => f.latex.includes("\\text{Cov}(R_A, R_B)"))).toBe(true);
    expect(secC.formulas.some((f: any) => f.latex.includes("\\rho_{AB} = \\text{Corr}(R_A, R_B)"))).toBe(true);

    // 3. CAPM / SML & Beta
    const secE = shielded[4];
    expect(secE.formulas.some((f: any) => f.latex.includes("E[R_i] = R_f + \\beta_i (E[R_M] - R_f)"))).toBe(true);
    expect(secE.formulas.some((f: any) => f.latex.includes("\\beta_p = \\sum"))).toBe(true);
  });

  it("prevents raw LaTeX code leakage across all note fields using ensureInlineMathDelimiters", () => {
    const rawNoteContent = {
      leadText: "Calculated via \\sigma_p = \\sqrt{\\sigma_p^2} for the portfolio:",
      description: "where \\beta_i measures systematic risk, \\rho_{AB} is correlation, and \\text{Cov}(R_A, R_B) is covariance.",
      variables: [
        { symbol: "\\sigma_p^2", definition: "Portfolio variance given by \\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B)." },
        { symbol: "\\beta_i", definition: "Asset beta defined as \\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}." },
      ],
      bulletPoints: [
        "Historical sample variance uses unbiased degrees of freedom: s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2.",
        "Expected return in probability states: E[R] = \\sum_{i=1}^n P_i R_i.",
      ],
    };

    const sanitizedLead = ensureInlineMathDelimiters(rawNoteContent.leadText);
    expect(sanitizedLead).toContain("$\\sigma_p = \\sqrt{\\sigma_p^2}$");

    const sanitizedDesc = ensureInlineMathDelimiters(rawNoteContent.description);
    expect(sanitizedDesc).toContain("$\\beta_i$");
    expect(sanitizedDesc).toContain("$\\rho_{AB}$");
    expect(sanitizedDesc).toContain("$\\text{Cov}(R_A, R_B)$");

    const sanitizedVarDef = ensureInlineMathDelimiters(rawNoteContent.variables[0].definition);
    expect(sanitizedVarDef).toContain("$\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B)$.");

    const sanitizedBullet = ensureInlineMathDelimiters(rawNoteContent.bulletPoints[0]);
    expect(sanitizedBullet).toContain("$s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2$.");
  });

  it("accurately preserves Capital Budgeting & Project Evaluation sections, preserves NPV formula with decision rule, and rejects Stock Valuation or WACC contamination", () => {
    const rawSlideText = `
Chapter 9: Net Present Value and Other Investment Criteria.
Capital Budgeting principles: Evaluating capital investments using discounted cash flow criteria.
1. Net Present Value (NPV): Market value minus initial investment cost. Accept if NPV > 0.
2. Internal Rate of Return (IRR): Discount rate equating NPV to zero. Accept if IRR > r.
3. Profitability Index (PI): Benefit-cost ratio of present value of future cash flows to initial outlay.
4. Payback Period: Years required to recover initial investment outlay.
`;

    const mockCapitalBudgetingSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. GIÁ TRỊ HIỆN TẠI THUẦN (NET PRESENT VALUE - NPV)",
        coreStatement: "The Net Present Value (NPV) evaluates whether an investment creates value.",
        bulletPoints: [
          "NPV Decision Rule: Accept an investment if NPV > 0; reject if NPV < 0.",
          "NPV directly measures the increase in firm value from undertaking the project.",
        ],
        formulas: [
          {
            leadText: "General Net Present Value formula:",
            latex: "NPV = -I_0 + \\sum_{t=1}^n \\frac{CF_t}{(1 + r)^t}",
            description: "Accept when NPV > 0.",
            variables: [
              { symbol: "I_0", definition: "Initial investment cash outlay at period 0" },
              { symbol: "CF_t", definition: "Operating cash flow generated in period t" },
              { symbol: "r", definition: "Required rate of return (hurdle rate / discount rate)" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. TỶ SUẤT HOÀN VỐN NỘI BỘ (INTERNAL RATE OF RETURN - IRR)",
        coreStatement: "IRR is the break-even discount rate that forces NPV to equal exactly zero.",
        bulletPoints: [
          "Decision rule: Accept the project if IRR > hurdle rate (r).",
          "Pitfall: Multiple IRRs can occur if cash flows are unconventional (change signs more than once).",
        ],
        formulas: [
          {
            leadText: "IRR equilibrium equation:",
            latex: "0 = -I_0 + \\sum_{t=1}^n \\frac{CF_t}{(1 + \\text{IRR})^t}",
            description: "IRR is the root of the polynomial equation where NPV = 0.",
            variables: [
              { symbol: "\\text{IRR}", definition: "Internal rate of return" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. CHỈ SỐ KHẢ NĂNG SINH LỜI (PROFITABILITY INDEX - PI)",
        bulletPoints: [
          "Measures the present value of future cash flows per unit of initial investment.",
          "Decision rule: Accept project if PI > 1.0.",
        ],
        formulas: [
          {
            leadText: "Profitability Index formula:",
            latex: "\\text{PI} = \\frac{\\sum_{t=1}^n \\frac{CF_t}{(1 + r)^t}}{I_0}",
            description: "PI is especially useful when capital rationing constraints apply.",
            variables: [
              { symbol: "\\text{PI}", definition: "Profitability index (benefit-cost ratio)" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-d",
        letter: "D",
        titleVi: "D. THỜI GIAN HOÀN VỐN (PAYBACK PERIOD)",
        bulletPoints: [
          "Payback period is the time required for accumulated cash flows to equal initial outlay.",
          "Disadvantages: Ignores the time value of money and cash flows beyond the cutoff date.",
        ],
        formulas: [],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockCapitalBudgetingSections, rawSlideText);

    // 1. Verify sections remain within canonical length (4 sections)
    expect(shielded.length).toBe(4);
    expect(shielded.map((s) => s.letter)).toEqual(["A", "B", "C", "D"]);

    // 2. Canonical Capital Budgeting titles preserved
    expect(shielded[0].titleVi).toContain("NET PRESENT VALUE");
    expect(shielded[1].titleVi).toContain("INTERNAL RATE OF RETURN");
    expect(shielded[2].titleVi).toContain("PROFITABILITY INDEX");
    expect(shielded[3].titleVi).toContain("THỜI GIAN HOÀN VỐN");

    // 3. ZERO Stock Valuation or WACC contamination
    const allText = JSON.stringify(shielded);
    expect(allText).not.toContain("NGUYÊN LÝ CƠ BẢN");
    expect(allText).not.toContain("DDM (DIVIDEND DISCOUNT MODEL)");
    expect(allText).not.toContain("Gordon");
    expect(allText).not.toContain("P_N = \\frac{D_{N+1}}{R - g}");
    expect(allText).not.toContain("Deferred Preferred");
    expect(allText).not.toContain("CHI PHÍ SỬ DỤNG VỐN BÌNH QUÂN");
    expect(allText).not.toContain("WACC");

    // 4. Boxed NPV formula and decision rule strictly preserved
    const npvSec = shielded[0];
    expect(npvSec.formulas[0].latex).toBe("NPV = -I_0 + \\sum_{t=1}^n \\frac{CF_t}{(1 + r)^t}");
    expect(npvSec.formulas[0].description).toContain("Accept when NPV > 0.");
    expect(npvSec.bulletPoints[0]).toContain("NPV > 0");

    // 5. IRR and PI formulas preserved
    const irrSec = shielded[1];
    expect(irrSec.formulas[0].latex).toContain("\\text{IRR}");
    const piSec = shielded[2];
    expect(piSec.formulas[0].latex).toContain("\\text{PI}");
  });

  it("accurately preserves Time Value of Money (TVM) formulas, shields growing perpetuity denominator to r - g (intercepting r + g), and preserves EAR vs APR", () => {
    const rawSlideText = `
Time Value of Money (TVM) & Cash Flow Valuation.
Topics: Present Value, Future Value, Ordinary Annuities, Perpetuities, and Compounding Frequencies.
EAR vs APR conversions.
`;

    const mockTvmSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. GIÁ TRỊ THỜI GIAN CỦA TIỀN & DÒNG TIỀN ĐƠN (TVM & SINGLE CASH FLOWS)",
        bulletPoints: [
          "Future Value (FV) compounds a present cash flow forward in time.",
          "Present Value (PV) discounts a future cash flow back to today.",
        ],
        formulas: [
          {
            leadText: "Future Value (FV) and Present Value (PV) of a lump sum:",
            latex: "FV_t = PV \\cdot (1 + r)^t, \\quad PV = \\frac{FV_t}{(1 + r)^t}",
            description: "Basic compounding and discounting relation.",
            variables: [
              { symbol: "FV_t", definition: "Future value at period t" },
              { symbol: "PV", definition: "Present value today (t = 0)" },
              { symbol: "r", definition: "Interest rate per period" },
              { symbol: "t", definition: "Number of compounding periods" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. NIÊN KIM VÀ DÒNG TIỀN VĨNH CỬU (ANNUITIES & PERPETUITIES)",
        bulletPoints: [
          "Ordinary annuity: Equal cash flows at the end of each period.",
          "Perpetuity: Infinite stream of equal periodic cash flows.",
        ],
        formulas: [
          {
            leadText: "Present value of an ordinary annuity:",
            latex: "PV = C \\cdot \\left[ \\frac{1 - (1 + r)^{-t}}{r} \\right]",
            description: "",
            variables: [],
          },
          {
            leadText: "Present value of an ordinary perpetuity:",
            latex: "PV = \\frac{C}{r}",
            description: "",
            variables: [],
          },
          {
            // Simulate hallucinated r + g denominator in growing perpetuity
            leadText: "Present value of a growing perpetuity (corrupted with r + g):",
            latex: "PV = \\frac{C_1}{r + g}",
            description: "Perpetual cash flow growing at constant rate g.",
            variables: [
              { symbol: "C_1", definition: "Cash flow to be received in period 1" },
              { symbol: "r", definition: "Discount rate" },
              { symbol: "g", definition: "Constant growth rate per period" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. LÃI SUẤT HIỆU DỤNG (EAR VS APR)",
        bulletPoints: [
          "APR (Annual Percentage Rate): Nominal quoted annual rate.",
          "EAR (Effective Annual Rate): The true annual rate accounting for compounding frequency m.",
        ],
        formulas: [
          {
            leadText: "Effective Annual Rate conversion formula:",
            latex: "EAR = \\left(1 + \\frac{\\text{APR}}{m}\\right)^m - 1",
            description: "Used to compare investments with different compounding frequencies.",
            variables: [
              { symbol: "EAR", definition: "Effective annual rate" },
              { symbol: "\\text{APR}", definition: "Annual percentage rate (nominal quoted rate)" },
              { symbol: "m", definition: "Number of compounding periods per year" },
            ],
          },
        ],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockTvmSections, rawSlideText);

    expect(shielded.length).toBe(3);
    expect(shielded[0].titleVi).toContain("GIÁ TRỊ THỜI GIAN CỦA TIỀN");
    expect(shielded[1].titleVi).toContain("NIÊN KIM VÀ DÒNG TIỀN VĨNH CỬU");
    expect(shielded[2].titleVi).toContain("LÃI SUẤT HIỆU DỤNG");

    // Verify growing perpetuity denominator is intercepted and corrected to r - g
    const perpetuitySec = shielded[1];
    const growingPerpFormula = perpetuitySec.formulas.find((f: any) => f.latex.includes("C_1"));
    expect(growingPerpFormula).toBeDefined();
    expect(growingPerpFormula?.latex).toBe("PV = \\frac{C_1}{r - g}");
    expect(growingPerpFormula?.latex).not.toContain("r + g");

    // Verify ordinary annuity and ordinary perpetuity formulas preserved
    expect(perpetuitySec.formulas.some((f: any) => f.latex.includes("\\frac{C}{r}"))).toBe(true);
    expect(perpetuitySec.formulas.some((f: any) => f.latex.includes("(1 + r)^{-t}"))).toBe(true);

    // Verify EAR vs APR formula preserved intact
    const earSec = shielded[2];
    expect(earSec.formulas[0].latex).toBe("EAR = \\left(1 + \\frac{\\text{APR}}{m}\\right)^m - 1");
    expect(earSec.formulas[0].variables.some((v: any) => v.symbol === "EAR")).toBe(true);
  });

  it("accurately preserves Financial Statement Analysis and DuPont Identity formulas across 3-stage and 5-stage decompositions", () => {
    const rawSlideText = `
Financial Statement Analysis and Firm Performance.
Ratio analysis: Liquidity, Solvency, Turnover, and Profitability.
The DuPont Identity decomposes Return on Equity (ROE) into operating efficiency, asset use efficiency, and financial leverage.
`;

    const mockDuPontSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TỔNG QUAN PHÂN TÍCH BÁO CÁO TÀI CHÍNH (FINANCIAL STATEMENT OVERVIEW)",
        bulletPoints: [
          "Financial ratios allow comparison across time and between firms of different sizes.",
          "DuPont analysis explains the root drivers of Return on Equity (ROE).",
        ],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. ĐẲNG THỨC DUPONT 3 THÀNH PHẦN (3-STAGE DUPONT IDENTITY)",
        bulletPoints: [
          "Decomposes ROE into Profit Margin, Total Asset Turnover, and Equity Multiplier.",
        ],
        formulas: [
          {
            leadText: "Standard 3-Stage DuPont Identity:",
            latex: "ROE = \\text{Profit Margin} \\times \\text{Total Asset Turnover} \\times \\text{Equity Multiplier}",
            description: "Operating efficiency x Asset use efficiency x Financial leverage.",
            variables: [
              { symbol: "ROE", definition: "Return on Equity (\\frac{\\text{Net Income}}{\\text{Total Equity}})" },
              { symbol: "\\text{Profit Margin}", definition: "\\frac{\\text{Net Income}}{\\text{Sales}}" },
              { symbol: "\\text{Total Asset Turnover}", definition: "\\frac{\\text{Sales}}{\\text{Total Assets}}" },
              { symbol: "\\text{Equity Multiplier}", definition: "\\frac{\\text{Total Assets}}{\\text{Total Equity}} = 1 + \\frac{\\text{Debt}}{\\text{Equity}}" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. ĐẲNG THỨC DUPONT MỞ RỘNG 5 THÀNH PHẦN (5-STAGE DUPONT IDENTITY)",
        bulletPoints: [
          "Isolates tax burden, interest burden, and operating profit margin (EBIT / Sales).",
        ],
        formulas: [
          {
            leadText: "Extended 5-Stage DuPont Identity:",
            latex: "ROE = \\frac{\\text{Net Income}}{\\text{EBT}} \\times \\frac{\\text{EBT}}{\\text{EBIT}} \\times \\frac{\\text{EBIT}}{\\text{Sales}} \\times \\frac{\\text{Sales}}{\\text{Assets}} \\times \\frac{\\text{Assets}}{\\text{Equity}}",
            description: "Tax Burden x Interest Burden x Operating Margin x Asset Turnover x Leverage.",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockDuPontSections, rawSlideText);

    expect(shielded.length).toBe(3);
    expect(shielded[0].titleVi).toContain("FINANCIAL STATEMENT OVERVIEW");
    expect(shielded[1].titleVi).toContain("3-STAGE DUPONT IDENTITY");
    expect(shielded[2].titleVi).toContain("5-STAGE DUPONT IDENTITY");

    // 3-Stage DuPont equation preserved
    const dupont3Sec = shielded[1];
    expect(dupont3Sec.formulas[0].latex).toContain("\\text{Profit Margin}");
    expect(dupont3Sec.formulas[0].latex).toContain("\\text{Total Asset Turnover}");
    expect(dupont3Sec.formulas[0].latex).toContain("\\text{Equity Multiplier}");

    // 5-Stage DuPont equation preserved
    const dupont5Sec = shielded[2];
    expect(dupont5Sec.formulas[0].latex).toContain("\\frac{\\text{Net Income}}{\\text{EBT}}");
    expect(dupont5Sec.formulas[0].latex).toContain("\\frac{\\text{EBT}}{\\text{EBIT}}");
    expect(dupont5Sec.formulas[0].latex).toContain("\\frac{\\text{EBIT}}{\\text{Sales}}");

    // Zero unwanted stock valuation injections
    const fullJson = JSON.stringify(shielded);
    expect(fullJson).not.toContain("DDM");
    expect(fullJson).not.toContain("Gordon");
  });

  it("accurately preserves Bond Valuation pricing equations, annuity coupon discounting, par value mechanics, and YTM relationships", () => {
    const rawSlideText = `
Bond Valuation and Interest Rates.
Key concepts: Face value (Par), Coupon payment (C), Yield to Maturity (y or YTM), Time to maturity (t).
Bond pricing formula combines an annuity of coupon payments and lump sum par value.
Premium vs Discount bonds.
`;

    const mockBondSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. CƠ CHẾ VÀ ĐỊNH GIÁ TRÁI PHIẾU (BOND VALUATION & PRICING)",
        coreStatement: "The market price of a bond is the present value of its promised cash flows (coupons + face value).",
        bulletPoints: [
          "Coupons form an annuity stream; par value is a lump sum at maturity.",
        ],
        formulas: [
          {
            leadText: "Comprehensive bond pricing equation:",
            latex: "P_B = C \\left[ \\frac{1 - (1 + y)^{-t}}{y} \\right] + \\frac{F}{(1 + y)^t}",
            description: "PV of coupon annuity + PV of par value.",
            variables: [
              { symbol: "P_B", definition: "Current market price of the bond" },
              { symbol: "C", definition: "Periodic coupon payment ($C = \\text{Coupon Rate} \\times F$)" },
              { symbol: "y", definition: "Yield to maturity (YTM) per period" },
              { symbol: "t", definition: "Number of periods until maturity" },
              { symbol: "F", definition: "Face value (par value) of the bond (typically $1,000)" },
            ],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. LỢI SUẤT ĐÁO HẠN VÀ RỦI RO LÃI SUẤT (YTM & INTEREST RATE RISK)",
        bulletPoints: [
          "If Coupon Rate = YTM, then Bond Price = Par Value (Par bond).",
          "If Coupon Rate > YTM, then Bond Price > Par Value (Premium bond).",
          "If Coupon Rate < YTM, then Bond Price < Par Value (Discount bond).",
          "Interest rate risk: Bond prices move inversely to market yields.",
        ],
        formulas: [
          {
            leadText: "Current yield approximation:",
            latex: "\\text{Current Yield} = \\frac{\\text{Annual Coupon}}{P_B}",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. TRÁI PHIẾU KHÔNG TRẢ LÃI ĐỊNH KỲ (ZERO-COUPON BONDS)",
        bulletPoints: [
          "Zero-coupon bonds pay no coupons and sell at a deep discount to par value.",
        ],
        formulas: [
          {
            leadText: "Price of a pure discount (zero-coupon) bond:",
            latex: "P_{\\text{zero}} = \\frac{F}{(1 + y)^t}",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockBondSections, rawSlideText);

    expect(shielded.length).toBe(3);
    expect(shielded[0].titleVi).toContain("BOND VALUATION & PRICING");
    expect(shielded[1].titleVi).toContain("YTM & INTEREST RATE RISK");
    expect(shielded[2].titleVi).toContain("ZERO-COUPON BONDS");

    // Verify bond pricing equation preserved with brackets and exponents
    const bondPricingSec = shielded[0];
    expect(bondPricingSec.formulas[0].latex).toContain("P_B = C \\left[ \\frac{1 - (1 + y)^{-t}}{y} \\right] + \\frac{F}{(1 + y)^t}");
    expect(bondPricingSec.formulas[0].variables.some((v: any) => v.symbol === "P_B")).toBe(true);
    expect(bondPricingSec.formulas[0].variables.some((v: any) => v.symbol === "F")).toBe(true);

    // Verify YTM relationships and zero-coupon formula preserved
    const zeroSec = shielded[2];
    expect(zeroSec.formulas[0].latex).toBe("P_{\\text{zero}} = \\frac{F}{(1 + y)^t}");
  });

  it("harvests calculation equations from bulletPoints when LLM leaves formulas: [] and constructs boxed NoteFormula with non-redundant variables", () => {
    // Section with formulas: [] where formulas are only written inside bulletPoints
    const rawSlideText = "Corporate Financial Analysis and Capital Budgeting criteria.";

    const mockUnboxedSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. PHÂN TÍCH CHỈ SỐ ROE (ROE DECOMPOSITION)",
        bulletPoints: [
          "Return on Equity can be computed through the DuPont formula.",
          "DuPont Identity equation: ROE = \\text{Profit Margin} \\times \\text{Total Asset Turnover} \\times \\text{Equity Multiplier}",
        ],
        formulas: [], // Left empty by LLM!
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. QUY TẮC ĐỊNH GIÁ NPV (NET PRESENT VALUE RULE)",
        bulletPoints: [
          "Discounted cash flows determine project profitability.",
          "Net Present Value definition: $NPV = -I_0 + \\sum_{t=1}^n \\frac{CF_t}{(1+r)^t}$ for all future cash flows",
        ],
        formulas: [], // Left empty by LLM!
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. TRÁI PHIẾU ĐỊNH KỲ (BOND PRICING)",
        bulletPoints: ["Bonds pay coupon and principal."],
        formulas: [],
        subSections: [
          {
            heading: "1. Bond Valuation Equation",
            bulletPoints: [
              "General formula: P_B = C \\left[ \\frac{1 - (1+y)^{-t}}{y} \\right] + \\frac{F}{(1+y)^t}",
            ],
            formulas: [], // Left empty in subSection by LLM!
          },
        ],
      },
    ];

    const shielded = applyHallucinationShield(mockUnboxedSections, rawSlideText);

    // Section A: Harvested DuPont ROE formula into formulas array
    const secA = shielded[0];
    expect(secA.formulas.length).toBeGreaterThanOrEqual(1);
    expect(secA.formulas[0].latex).toContain("ROE = \\text{Profit Margin} \\times \\text{Total Asset Turnover} \\times \\text{Equity Multiplier}");
    expect(secA.formulas[0].leadText).toContain("DuPont Identity equation:");
    expect(secA.formulas[0].variables).toEqual([]);

    // Section B: Harvested NPV formula into formulas array
    const secB = shielded[1];
    expect(secB.formulas.length).toBeGreaterThanOrEqual(1);
    expect(secB.formulas[0].latex).toContain("NPV = -I_0 + \\sum_{t=1}^n \\frac{CF_t}{(1+r)^t}");
    expect(secB.formulas[0].leadText).toContain("Net Present Value definition:");
    expect(secB.formulas[0].variables).toEqual([]);

    // Section C SubSection: Harvested Bond pricing equation into subSection formulas array
    const secC = shielded[2];
    const subSecC = secC.subSections[0];
    expect(subSecC.formulas.length).toBeGreaterThanOrEqual(1);
    expect(subSecC.formulas[0].latex).toContain("P_B = C \\left[ \\frac{1 - (1+y)^{-t}}{y} \\right] + \\frac{F}{(1+y)^t}");
    expect(subSecC.formulas[0].variables).toEqual([]);
  });

  it("verifies sanitizeAcademicHeader does not force Chapter 9 titles on Capital Budgeting, Bonds, Macroeconomics, or Machine Learning topics", () => {
    // 1. Capital Budgeting
    expect(
      sanitizeAcademicHeader("Header A: QUY TRÌNH NGÂN SÁCH VỐN (CAPITAL BUDGETING)", "A"),
    ).toBe("A. QUY TRÌNH NGÂN SÁCH VỐN (CAPITAL BUDGETING)");
    expect(
      sanitizeAcademicHeader("Header B: GIÁ TRỊ HIỆN TẠI THUẦN (NET PRESENT VALUE - NPV)", "B"),
    ).toBe("B. GIÁ TRỊ HIỆN TẠI THUẦN (NET PRESENT VALUE - NPV)");

    // 2. Bond Valuation (with isStockValuation explicitly false)
    expect(
      sanitizeAcademicHeader("Header A: BOND VALUATION & YIELD TO MATURITY", "A", false),
    ).toBe("A. BOND VALUATION & YIELD TO MATURITY");
    expect(
      sanitizeAcademicHeader("Header B: TRÁI PHIẾU VÀ ĐỊNH GIÁ TRÁI PHIẾU", "B", false),
    ).toBe("B. TRÁI PHIẾU VÀ ĐỊNH GIÁ TRÁI PHIẾU");

    // 3. Macroeconomics / Economics
    expect(
      sanitizeAcademicHeader("Header A: IS-LM FRAMEWORK & AGGREGATE DEMAND", "A"),
    ).toBe("A. IS-LM FRAMEWORK & AGGREGATE DEMAND");
    expect(
      sanitizeAcademicHeader("Header B: CUNG TIỀN VÀ LẠM PHÁT (MONEY SUPPLY & INFLATION)", "B"),
    ).toBe("B. CUNG TIỀN VÀ LẠM PHÁT (MONEY SUPPLY & INFLATION)");

    // 4. Machine Learning & STEM
    expect(
      sanitizeAcademicHeader("Header A: SUPERVISED LEARNING & GRADIENT DESCENT OPTIMIZATION", "A", false),
    ).toBe("A. SUPERVISED LEARNING & GRADIENT DESCENT OPTIMIZATION");
    expect(
      sanitizeAcademicHeader("Header C: PROBABILITY DISTRIBUTIONS & BAYES THEOREM", "C"),
    ).toBe("C. PROBABILITY DISTRIBUTIONS & BAYES THEOREM");

    // 5. Machine translation purging even in non-stock topics:
    // "giáo dục" -> "ĐỊNH GIÁ"
    expect(
      sanitizeAcademicHeader("Header B: CHỌN MÔ HÌNH GIÁO DỤC TÀI CHÍNH", "B"),
    ).toBe("B. CHỌN MÔ HÌNH ĐỊNH GIÁ TÀI CHÍNH");
  });

  it("strictly separates Arithmetic Mean (dividing by T, never T - 1) from Sample Variance (dividing by T - 1)", () => {
    const rawSlideText =
      "Chapter 10: Historical Risk and Return. Arithmetic Mean vs Geometric Mean. Sample Variance with T - 1.";

    const mockChapter10Deck: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TỔNG QUAN LỢI SUẤT LỊCH SỬ",
        bulletPoints: ["Total return includes dividend and capital gain."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. TRUNG BÌNH SỐ HỌC VÀ HÌNH HỌC (ARITHMETIC & GEOMETRIC AVERAGE)",
        bulletPoints: ["Arithmetic mean is typical single-period return; geometric is compound return."],
        formulas: [
          {
            leadText: "Trung bình số học (hallucinated with T - 1 degrees of freedom):",
            latex: "\\bar{R}_{\\text{arith}} = \\frac{1}{T - 1} \\sum_{t=1}^T R_t",
            description: "",
            variables: [],
          },
          {
            leadText: "Trung bình hình học (hallucinated with 1/(T - 1) exponent):",
            latex: "\\bar{R}_{\\text{geom}} = \\left[ \\prod_{t=1}^T (1 + R_t) \\right]^{1/(T - 1)} - 1",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. PHƯƠNG SAI VÀ ĐỘ LỆCH CHUẨN MẪU LỊCH SỬ",
        bulletPoints: ["Sample variance divides by T - 1."],
        formulas: [
          {
            leadText: "Phương sai mẫu (hallucinated with biased denominator T):",
            latex: "s^2 = \\frac{1}{T} \\sum_{t=1}^T (R_t - \\bar{R})^2",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockChapter10Deck, rawSlideText);

    // Section B: Arithmetic Mean MUST divide by T, NEVER T - 1!
    const secB = shielded[1];
    const arithFormula = secB.formulas.find((f: any) => f.latex.includes("arith"));
    expect(arithFormula).toBeDefined();
    expect(arithFormula?.latex).toContain("\\frac{1}{T} \\sum_{t=1}^T R_t");
    expect(arithFormula?.latex).not.toContain("T - 1");

    // Geometric Mean exponent MUST be 1/T, NEVER 1/(T - 1)!
    const geomFormula = secB.formulas.find((f: any) => f.latex.includes("geom"));
    expect(geomFormula).toBeDefined();
    expect(geomFormula?.latex).toContain("^{1/T}");
    expect(geomFormula?.latex).not.toContain("T - 1");

    // Section C: Sample Variance MUST divide by T - 1 degrees of freedom!
    const secC = shielded[2];
    const varFormula = secC.formulas[0];
    expect(varFormula.latex).toContain("\\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2");
    expect(varFormula.latex).not.toContain("\\frac{1}{T} \\sum");
  });

  it("enforces targeted section routing and universal deduplication between Section B (Scenario Return & Risk) and Section C (Portfolio Return & Risk)", () => {
    const rawSlideText =
      "Chapter 11: Risk and Return - Scenario Analysis & Portfolio Theory. Individual asset return and variance under scenarios, 2-asset portfolio return and risk, covariance, correlation, and CAPM.";

    // Simulated deck where Section B is Scenario Return & Risk of Individual Assets,
    // and Section C is Portfolio Return & Risk with duplicated formulas.
    const mockSections: any[] = [
      {
        id: "sec-a",
        letter: "A",
        titleVi: "A. TỔNG QUAN RỦI RO VÀ TỶ SUẤT SINH LỜI",
        bulletPoints: ["Overview of risk and return."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-b",
        letter: "B",
        titleVi: "B. TỶ SUẤT SINH LỜI VÀ PHƯƠNG SAI THEO KỊCH BẢN XÁC SUẤT",
        bulletPoints: ["Scenario return and variance of individual assets."],
        formulas: [
          // Simulated LLM error: mistakenly injected a portfolio formula into Section B!
          {
            name: "",
            leadText: "Tỷ suất sinh lời kỳ vọng của danh mục (mistakenly placed in Section B):",
            latex: "E[R_p] = w_A E[R_A] + w_B E[R_B]",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-c",
        letter: "C",
        titleVi: "C. DANH MỤC ĐẦU TƯ VÀ RỦI RO DANH MỤC",
        bulletPoints: ["Portfolio weights and variance."],
        formulas: [
          // Combined formula that already defines both variance and standard deviation
          {
            name: "",
            leadText: "Phương sai và độ lệch chuẩn của danh mục 2 tài sản:",
            latex: "\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B) = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\sigma_A \\sigma_B \\rho_{AB}, \\quad \\sigma_p = \\sqrt{\\sigma_p^2}",
            description: "Đo lường tổng rủi ro của danh mục.",
            variables: [],
          },
          // Redundant standalone standard deviation card right below it
          {
            name: "",
            leadText: "Độ lệch chuẩn danh mục:",
            latex: "\\sigma_p = \\sqrt{\\sigma_p^2}",
            description: "Căn bậc hai phương sai.",
            variables: [],
          },
          // Expected portfolio return
          {
            name: "",
            leadText: "Tỷ suất sinh lời kỳ vọng của danh mục 2 tài sản:",
            latex: "E[R_p] = w_A E[R_A] + w_B E[R_B]",
            description: "Bình quân gia quyền tỷ trọng đầu tư.",
            variables: [],
          },
          // Duplicate expected portfolio return
          {
            name: "",
            leadText: "Tỷ suất sinh lời kỳ vọng danh mục (Duplicate):",
            latex: "E[R_p] = w_A E[R_A] + w_B E[R_B]",
            description: "",
            variables: [],
          },
        ],
        subSections: [],
      },
      {
        id: "sec-d",
        letter: "D",
        titleVi: "D. HIỆP PHƯƠNG SAI VÀ HỆ SỐ TƯƠNG QUAN",
        bulletPoints: ["Covariance and correlation between assets."],
        formulas: [],
        subSections: [],
      },
      {
        id: "sec-e",
        letter: "E",
        titleVi: "E. ĐƯỜNG THỊ TRƯỜNG CHỨNG KHOÁN (SML) VÀ CAPM",
        bulletPoints: ["SML equation."],
        formulas: [],
        subSections: [],
      },
    ];

    const shielded = applyHallucinationShield(mockSections, rawSlideText);

    // 1. Section B (Scenario Return & Risk of Individual Assets):
    // Must contain Scenario Return and Scenario Variance:
    const secB = shielded[1];
    expect(secB.titleVi).toContain("KỊCH BẢN XÁC SUẤT");
    expect(secB.formulas.some((f: any) => f.latex.includes("E[R] = \\sum_{i=1}^n P_i R_i"))).toBe(true);
    expect(secB.formulas.some((f: any) => f.latex.includes("\\sigma^2 = \\sum_{i=1}^n P_i (R_i - E[R])^2"))).toBe(true);

    // Section B MUST NEVER contain Portfolio formulas:
    expect(secB.formulas.some((f: any) => f.latex.includes("E[R_p]"))).toBe(false);
    expect(secB.formulas.some((f: any) => f.latex.includes("\\sigma_p^2"))).toBe(false);
    expect(secB.formulas.some((f: any) => f.latex.includes("w_A^2"))).toBe(false);

    // 2. Section C (Portfolio Return & Risk):
    // Must contain Portfolio Return and Portfolio Variance:
    const secC = shielded[2];
    expect(secC.titleVi).toContain("DANH MỤC ĐẦU TƯ");
    expect(secC.formulas.some((f: any) => f.latex.includes("E[R_p] = w_A E[R_A] + w_B E[R_B]"))).toBe(true);
    expect(secC.formulas.some((f: any) => f.latex.includes("\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2"))).toBe(true);

    // Redundant standalone \sigma_p = \sqrt{\sigma_p^2} card MUST be pruned:
    const standaloneStdDev = secC.formulas.filter(
      (f: any) => f.latex.trim() === "\\sigma_p = \\sqrt{\\sigma_p^2}",
    );
    expect(standaloneStdDev.length).toBe(0);

    // Duplicate E[R_p] card MUST be pruned:
    const portfolioReturnCards = secC.formulas.filter((f: any) =>
      f.latex.includes("E[R_p] = w_A E[R_A] + w_B E[R_B]"),
    );
    expect(portfolioReturnCards.length).toBe(1);

    // Total formula cards in Section C should be exactly 2:
    expect(secC.formulas.length).toBe(2);
  });

  it("deduplicateSectionFormulas removes equivalent formula cards and prunes redundant standard deviation cards within sections and subSections", () => {
    const rawSection = {
      id: "sec-test",
      letter: "B",
      titleVi: "B. KIỂM TRA DEDUPLICATION FORMULAS",
      bulletPoints: ["Test bullet."],
      formulas: [
        {
          name: "",
          leadText: "Portfolio Variance:",
          latex: "\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B), \\quad \\sigma_p = \\sqrt{\\sigma_p^2}",
          description: "",
          variables: [],
        },
        {
          name: "",
          leadText: "Standalone Portfolio Std Dev (Redundant):",
          latex: "\\sigma_p = \\sqrt{\\sigma_p^2}",
          description: "",
          variables: [],
        },
        {
          name: "",
          leadText: "Expected Return:",
          latex: "E[R_p] = w_A E[R_A] + w_B E[R_B]",
          description: "",
          variables: [],
        },
        {
          name: "",
          leadText: "Expected Return Duplicate with extra whitespace and \\left\\right:",
          latex: "E[R_p] = \\left( w_A E[R_A] + w_B E[R_B] \\right)",
          description: "",
          variables: [],
        },
        {
          name: "",
          leadText: "Historical Sample Variance:",
          latex: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2, \\quad s = \\sqrt{s^2}",
          description: "",
          variables: [],
        },
        {
          name: "",
          leadText: "Standalone Sample Std Dev (Redundant):",
          latex: "s = \\sqrt{s^2}",
          description: "",
          variables: [],
        },
      ],
      subSections: [
        {
          heading: "Sub-case",
          bulletPoints: [],
          formulas: [
            {
              name: "",
              latex: "E[R] = \\sum_{i=1}^n P_i R_i",
              variables: [],
            },
            {
              name: "",
              latex: "E[R] = \\sum_{i=1}^n P_i R_i",
              variables: [],
            },
          ],
        },
      ],
    };

    const deduped = deduplicateSectionFormulas(rawSection as any);

    // Section top-level formulas: 6 cards reduced to exactly 3 (variance, expected return, sample variance)
    expect(deduped.formulas.length).toBe(3);
    expect(deduped.formulas[0].latex).toContain("\\sigma_p^2");
    expect(deduped.formulas[1].latex).toContain("E[R_p]");
    expect(deduped.formulas[2].latex).toContain("s^2");

    // Sub-section duplicate formula pruned: 2 cards reduced to 1
    expect(deduped.subSections?.[0].formulas.length).toBe(1);
    expect(deduped.subSections?.[0].formulas[0].latex).toBe("E[R] = \\sum_{i=1}^n P_i R_i");
  });
});
