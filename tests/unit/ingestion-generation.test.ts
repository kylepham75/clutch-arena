import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { APICallError, type LanguageModel } from "ai";
import {
  generateQuestions,
  validateGeneratedStudy,
  splitIntoBatchCounts,
  partitionSourcesAcrossBatches,
  groupSlidesByConcept,
  computeOverGeneratedCount,
  hasBannedNegationOrMetaOption,
  shuffleQuestionOptions,
  MCQ_GENERATION_TEMPERATURE,
  MCQ_GENERATION_TOP_P,
} from "@/lib/ai/generate-questions";
import { ingestionSystemPrompt } from "@/lib/ai/prompts";
import { getGenerationModel } from "@/lib/ai/provider";
import { solveFinanceSpec } from "@/lib/math/finance-solver";
import {
  ingestionOptionsSchema,
  type ParsedDocument,
  type SourceBlock,
} from "@/lib/schemas/ingestion";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import { studyText } from "../helpers/documents";

const document: ParsedDocument = {
  fileName: "notes.txt",
  format: "txt",
  sources: [{ id: "lines-1-1", label: "Lines 1–1", text: studyText }],
  characterCount: studyText.length,
  pageCount: null,
  warnings: [],
};
const options = ingestionOptionsSchema.parse({ questionCount: 1 });
const output = () => ({
  title: "Price elasticity",
  sourceKind: "lecture",
  questions: [structuredClone(mockMicroeconomics.questions[0])],
  annotations: [
    {
      questionId: "elasticity",
      sourceId: "lines-1-1",
      excerpt:
        "Demand is elastic when the absolute price elasticity exceeds one.",
      topic: "Elasticity",
      chapter: "Chapter 4",
      rule: "Absolute elasticity > 1 means elastic demand.",
    },
  ],
  warnings: [],
});
type TestModel = Exclude<LanguageModel, string>;
const modelFor = (raw: unknown) =>
  ({
    specificationVersion: "v2" as const,
    provider: "test",
    modelId: "fixture",
    supportedUrls: {},
    doGenerate: vi.fn<TestModel["doGenerate"]>(async () => ({
      content: [{ type: "text", text: JSON.stringify(raw) }],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      warnings: [],
    })),
    doStream: async () => {
      throw new Error("Streaming is not used by ingestion");
    },
  }) satisfies TestModel;
afterEach(() => vi.unstubAllEnvs());

describe("structured generation", () => {
  it("runs the real SDK schema pipeline with a mocked model, produces a playable pack and source references", async () => {
    const model = modelFor(output());
    const result = await generateQuestions(
      document,
      options,
      new AbortController().signal,
      model,
    );
    expect(result.pack.questions[0].id).toBe("q-1");
    expect(result.pack.questions[0].options).toHaveLength(4);
    expect(result.pack.metadata["q-1"].citation).toBe("notes.txt · Lines 1–1");
    expect(result.references["q-1"].excerpt).toContain("Demand is elastic");
    expect(result.usage.totalTokens).toBe(300);
    expect(model.doGenerate.mock.calls[0][0].responseFormat?.type).toBe("json");
  });
  it("splits >10 question requests into parallel batches of <=10, deduplicates questions, and merges usage before citation matching", async () => {
    expect(splitIntoBatchCounts(10)).toEqual([10]);
    expect(splitIntoBatchCounts(25)).toEqual([9, 8, 8]);
    expect(splitIntoBatchCounts(30)).toEqual([10, 10, 10]);

    const multiSectionDoc: ParsedDocument = {
      fileName: "notes.txt",
      format: "txt",
      sources: [
        { id: "sec-1", label: "Section 1", text: studyText },
        { id: "sec-2", label: "Section 2", text: studyText },
        { id: "sec-3", label: "Section 3", text: studyText },
      ],
      characterCount: studyText.length * 3,
      pageCount: 3,
      warnings: [],
    };

    const partitions = partitionSourcesAcrossBatches(multiSectionDoc.sources, 3);
    expect(partitions).toHaveLength(3);
    expect(partitions[0][0].id).toBe("sec-1");
    expect(partitions[1][0].id).toBe("sec-2");
    expect(partitions[2][0].id).toBe("sec-3");

    let callIdx = 0;
    const batchModel: TestModel = {
      specificationVersion: "v2" as const,
      provider: "test",
      modelId: "fixture",
      supportedUrls: {},
      doGenerate: vi.fn<TestModel["doGenerate"]>(async () => {
        callIdx++;
        const qBase = structuredClone(mockMicroeconomics.questions[0]);
        const qUnique = structuredClone(mockMicroeconomics.questions[0]);
        qUnique.id = `unique-${callIdx}`;
        qUnique.question = `Batch ${callIdx} distinct question: What happens when absolute price elasticity exceeds one?`;

        // Include a duplicate question across batches to verify deduplication
        const batchPayload = {
          title: "Price elasticity",
          sourceKind: "lecture",
          questions: [qBase, qUnique],
          annotations: [
            {
              questionId: qBase.id,
              sourceId: `sec-${callIdx}`,
              excerpt:
                "Demand is elastic when the absolute price elasticity exceeds one.",
              topic: "Elasticity",
              chapter: "Chapter 4",
              rule: "Absolute elasticity > 1 means elastic demand.",
            },
            {
              questionId: qUnique.id,
              sourceId: `sec-${callIdx}`,
              excerpt:
                "Demand is elastic when the absolute price elasticity exceeds one.",
              topic: "Elasticity",
              chapter: "Chapter 4",
              rule: "Absolute elasticity > 1 means elastic demand.",
            },
          ],
          warnings: [],
        };

        return {
          content: [{ type: "text", text: JSON.stringify(batchPayload) }],
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          warnings: [],
        };
      }),
      doStream: async () => {
        throw new Error("Streaming is not used by ingestion");
      },
    };

    const batchOptions = ingestionOptionsSchema.parse({ questionCount: 25 });
    const res = await generateQuestions(
      multiSectionDoc,
      batchOptions,
      new AbortController().signal,
      batchModel,
    );

    // 25 questions -> 3 parallel batch calls
    expect(batchModel.doGenerate).toHaveBeenCalledTimes(3);
    // 1 shared duplicate + 3 unique = 4 deduplicated questions
    expect(res.pack.questions).toHaveLength(4);
    expect(res.usage.totalTokens).toBe(900);
  });
  it.each([
    "missing-source",
    "fabricated-excerpt",
    "whitespace-excerpt",
    "duplicate-options",
    "identical-variant",
    "duplicate-ids",
    "missing-annotation",
  ])("rejects %s", (problem) => {
    const raw = output();
    if (problem === "missing-source") raw.annotations[0].sourceId = "page-99";
    if (problem === "fabricated-excerpt")
      raw.annotations[0].excerpt =
        "Invented quote that is not in this document.";
    if (problem === "whitespace-excerpt")
      raw.annotations[0].excerpt = " ".repeat(20);
    if (problem === "duplicate-options")
      raw.questions[0].options[1] = raw.questions[0].options[0];
    if (problem === "identical-variant")
      raw.questions[0].conceptVariant.question = raw.questions[0].question;
    if (problem === "duplicate-ids") raw.questions.push(raw.questions[0]);
    if (problem === "missing-annotation") raw.annotations = [];
    expect(() => validateGeneratedStudy(raw, document, options)).toThrow(
      expect.objectContaining({ code: "INVALID_AI_OUTPUT" }),
    );
  });
  it("rejects generated wording in exact mode", () => {
    expect(() =>
      validateGeneratedStudy(output(), document, { ...options, mode: "exact" }),
    ).toThrow(expect.objectContaining({ code: "INVALID_AI_OUTPUT" }));
  });
  it("accepts exact wording present in the source", () => {
    const raw = output();
    const text = [
      studyText,
      raw.questions[0].question,
      ...raw.questions[0].options,
    ].join("\n");
    const exactSource = {
      ...document,
      sources: [{ ...document.sources[0], text }],
    };
    expect(
      validateGeneratedStudy(raw, exactSource, { ...options, mode: "exact" })
        .pack.questions,
    ).toHaveLength(1);
  });
  it("returns an honest shortfall and does not pad questions", () => {
    const result = validateGeneratedStudy(output(), document, {
      ...options,
      questionCount: 5,
    });
    expect(result.pack.questions).toHaveLength(1);
    expect(result.warnings[0]).toContain("1 of 5");
  });
  it("reports insufficient source material", () => {
    expect(() =>
      validateGeneratedStudy(
        { ...output(), questions: [], annotations: [] },
        document,
        options,
      ),
    ).toThrow(expect.objectContaining({ code: "NO_SUPPORTED_QUESTIONS" }));
  });
  it("rejects malformed model output through SDK validation", async () => {
    await expect(
      generateQuestions(
        document,
        options,
        new AbortController().signal,
        modelFor({ wrong: true }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });
  });
  it("maps provider quota errors without leaking upstream bodies", async () => {
    const model = modelFor(output());
    model.doGenerate.mockRejectedValue(
      new APICallError({
        message: "secret body",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 429,
        responseBody: "secret body",
        isRetryable: false,
      }),
    );
    await expect(
      generateQuestions(document, options, new AbortController().signal, model),
    ).rejects.toMatchObject({ code: "AI_RATE_LIMITED", status: 429 });
  });
  it("reports a missing key without reading or exposing secrets", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    expect(() => getGenerationModel()).toThrow(
      expect.objectContaining({ code: "AI_NOT_CONFIGURED" }),
    );
  });

  // ==========================================================================
  // Stage 3 Task 3.2 Psychometric & Solver Integration Tests
  // ==========================================================================

  it("enforces psychometric rules in ingestionSystemPrompt (negation ban, <=2 items/slide, financeSpec, distractorRationale)", () => {
    expect(ingestionSystemPrompt).toContain("EXCEPT");
    expect(ingestionSystemPrompt).toContain("NOT");
    expect(ingestionSystemPrompt).toContain("all of the above");
    expect(ingestionSystemPrompt).toContain("none of the above");
    expect(ingestionSystemPrompt).toContain("at most 2");
    expect(ingestionSystemPrompt).toContain("financeSpec");
    expect(ingestionSystemPrompt).toContain("distractorRationale");
  });

  it("groups contiguous worked-example slides together in groupSlidesByConcept", () => {
    const slides: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Introduction to Capital Budgeting\nNet Present Value overview.",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Worked Example: Bond Valuation\nStep 1: Identify coupon payments of $50 and face value of $1,000.",
      },
      {
        id: "slide-3",
        label: "Slide 3",
        text: "Worked Example: Bond Valuation (cont.)\nStep 2: Solution and discounting to present value.",
      },
      {
        id: "slide-4",
        label: "Slide 4",
        text: "Weighted Average Cost of Capital\nWACC combines after-tax debt and equity costs.",
      },
    ];

    const groups = groupSlidesByConcept(slides, 3);
    expect(groups).toHaveLength(3);
    expect(groups[0].map((s) => s.id)).toEqual(["slide-1"]);
    // Slide 2 and Slide 3 (worked example + continuation) are never sliced apart
    expect(groups[1].map((s) => s.id)).toEqual(["slide-2", "slide-3"]);
    expect(groups[2].map((s) => s.id)).toEqual(["slide-4"]);
  });

  it("over-generates by +20% (computeOverGeneratedCount) and passes generator temp (0.3-0.4), topP=0.95 to generateObject", async () => {
    expect(computeOverGeneratedCount(5)).toBe(6);
    expect(computeOverGeneratedCount(10)).toBe(12);
    expect(computeOverGeneratedCount(25)).toBe(30);
    expect(computeOverGeneratedCount(30)).toBe(36);
    expect(MCQ_GENERATION_TEMPERATURE).toBeGreaterThanOrEqual(0.3);
    expect(MCQ_GENERATION_TEMPERATURE).toBeLessThanOrEqual(0.4);

    const model = modelFor(output());
    await generateQuestions(
      document,
      ingestionOptionsSchema.parse({ questionCount: 5 }),
      new AbortController().signal,
      model,
    );

    const callArgs = model.doGenerate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(MCQ_GENERATION_TEMPERATURE);
    expect(callArgs.topP).toBe(MCQ_GENERATION_TOP_P);

    const promptText = JSON.stringify(callArgs.prompt);
    // 5 requested -> 6 requested in the prompt (+20%)
    expect(promptText).toContain('\\"questionCount\\":6');
  });

  it("delegates quantitative financeSpec items to the TypeScript solver in validateGeneratedStudy", () => {
    const raw = output();
    const bondSpec = {
      solver: "bond_price" as const,
      params: {
        faceValue: 1000,
        couponRate: 0.06,
        rate: 0.08,
        nper: 10,
        frequency: 2,
      },
      unit: "$" as const,
      decimals: 2,
      distractorModes: [
        "annual_instead_of_semiannual" as const,
        "forgot_to_discount_face" as const,
        "off_by_one_period" as const,
      ],
    };
    const expectedSolved = solveFinanceSpec(bondSpec);

    // Give LLM bogus mental-math options; validateGeneratedStudy must overwrite them with exact solver outputs
    raw.questions[0] = {
      ...raw.questions[0],
      options: ["$999.99", "$111.11", "$222.22", "$333.33"],
      correctIndex: 3,
      financeSpec: bondSpec,
    } as any;

    const validated = validateGeneratedStudy(raw, document, options);
    const q = validated.pack.questions[0];

    expect(new Set(q.options)).toEqual(new Set(expectedSolved.options));
    expect(q.options[q.correctIndex]).toBe(expectedSolved.correctOption);
  });

  it("enforces the hard gate on lowConfidenceSourceIds and drops questions from failed-vision pages", () => {
    const twoSlideDoc: ParsedDocument = {
      fileName: "slides.pdf",
      format: "pdf",
      sources: [
        { id: "page-1", label: "Page 1", text: studyText },
        { id: "page-2", label: "Page 2", text: studyText },
      ],
      characterCount: studyText.length * 2,
      pageCount: 2,
      warnings: [],
      lowConfidenceSourceIds: ["page-1"],
    };

    const q1 = structuredClone(mockMicroeconomics.questions[0]);
    q1.id = "q-low-conf";
    const q2 = structuredClone(mockMicroeconomics.questions[0]);
    q2.id = "q-high-conf";
    q2.question = "When price elasticity of demand is greater than 1, how does quantity respond?";

    const raw = {
      title: "Elasticity",
      sourceKind: "lecture",
      questions: [q1, q2],
      annotations: [
        {
          questionId: "q-low-conf",
          sourceId: "page-1",
          excerpt:
            "Demand is elastic when the absolute price elasticity exceeds one.",
          topic: "Elasticity",
          chapter: "Chapter 4",
          rule: "Elasticity rule",
        },
        {
          questionId: "q-high-conf",
          sourceId: "page-2",
          excerpt:
            "Demand is elastic when the absolute price elasticity exceeds one.",
          topic: "Elasticity",
          chapter: "Chapter 4",
          rule: "Elasticity rule",
        },
      ],
      warnings: [],
    };

    const result = validateGeneratedStudy(raw, twoSlideDoc, {
      ...options,
      questionCount: 2,
    });
    expect(result.pack.questions).toHaveLength(1);
    expect(result.references["q-1"].sourceId).toBe("page-2");
  });

  it("detects and filters banned negation stems (EXCEPT, NOT) and meta-options ('all of the above', 'none of the above')", () => {
    expect(
      hasBannedNegationOrMetaOption({
        question: "Which of the following is NOT a determinant of demand?",
        options: ["Income", "Price of substitutes", "Tastes", "Consumer age"],
      }),
    ).toBe(true);

    expect(
      hasBannedNegationOrMetaOption({
        question: "All of the following shift the demand curve EXCEPT:",
        options: ["Income", "Own price", "Preferences", "Expectations"],
      }),
    ).toBe(true);

    expect(
      hasBannedNegationOrMetaOption({
        question: "What causes a movement along the demand curve?",
        options: [
          "Change in income",
          "Change in own price",
          "All of the above",
          "None of the above",
        ],
      }),
    ).toBe(true);

    expect(
      hasBannedNegationOrMetaOption({
        question: "What happens when absolute price elasticity exceeds one?",
        options: [
          "Demand is elastic",
          "Demand is inelastic",
          "Demand is unit elastic",
          "Demand is zero",
        ],
      }),
    ).toBe(false);
  });

  it("shuffles question options deterministically in code, preserving the correct answer string and distributing correctIndex across 0..3", () => {
    const seenIndices = new Set<number>();
    for (let i = 0; i < 24; i++) {
      const item = {
        question: `Synthetic finance question #${i}: What is the present value of cash flow ${i * 100}?`,
        options: [
          `$${100 + i}.00 (Correct)`,
          `$${200 + i}.00`,
          `$${300 + i}.00`,
          `$${400 + i}.00`,
        ] as [string, string, string, string],
        correctIndex: 0,
      };
      const shuffled = shuffleQuestionOptions(item);
      expect(shuffled.options[shuffled.correctIndex]).toBe(
        `$${100 + i}.00 (Correct)`,
      );
      expect(new Set(shuffled.options)).toEqual(new Set(item.options));
      seenIndices.add(shuffled.correctIndex);
    }
    // Across 24 distinct questions, all 4 option positions (0, 1, 2, 3) are used
    expect(seenIndices.size).toBe(4);
  });

  it("integrates cross-family blind verification in generateQuestions, silently dropping rejected items and trimming to questionCount", async () => {
    const q1 = structuredClone(mockMicroeconomics.questions[0]);
    q1.id = "cand-1";
    q1.question = "Candidate 1: When absolute price elasticity exceeds one, demand is:";

    const q2 = structuredClone(mockMicroeconomics.questions[0]);
    q2.id = "cand-2";
    q2.question = "Candidate 2: Which condition defines elastic demand in microeconomics?";

    const q3 = structuredClone(mockMicroeconomics.questions[0]);
    q3.id = "cand-3";
    q3.question = "Candidate 3: Ambiguous question that the blind verifier rejects?";

    const genPayload = {
      title: "Price elasticity",
      sourceKind: "lecture",
      questions: [q1, q2, q3],
      annotations: ["cand-1", "cand-2", "cand-3"].map((id) => ({
        questionId: id,
        sourceId: "lines-1-1",
        excerpt:
          "Demand is elastic when the absolute price elasticity exceeds one.",
        topic: "Elasticity",
        chapter: "Chapter 4",
        rule: "Absolute elasticity > 1 means elastic demand.",
      })),
      warnings: [],
    };

    const generatorModel = modelFor(genPayload);
    const verifierModel = modelFor({
      verdicts: [
        {
          id: "cand-1",
          selectedIndex: q1.correctIndex,
          isAmbiguous: false,
          confidence: "high",
          reason: "Matches source directly.",
        },
        {
          id: "cand-2",
          selectedIndex: q2.correctIndex,
          isAmbiguous: false,
          confidence: "high",
          reason: "Matches source directly.",
        },
        {
          id: "cand-3",
          selectedIndex: (q3.correctIndex + 1) % 4, // Disagrees with answer key -> dropped!
          isAmbiguous: true,
          confidence: "low",
          reason: "Ambiguous options.",
        },
      ],
    });

    const result = await generateQuestions(
      document,
      ingestionOptionsSchema.parse({ questionCount: 1 }),
      new AbortController().signal,
      generatorModel,
      { verifierModel },
    );

    expect(verifierModel.doGenerate).toHaveBeenCalledTimes(1);
    expect(verifierModel.doGenerate.mock.calls[0][0].temperature).toBe(0.0);
    // cand-3 was dropped by blind verifier, and surviving [cand-1, cand-2] was trimmed to questionCount=1
    expect(result.pack.questions).toHaveLength(1);
    expect(result.pack.questions[0].question).toContain("Candidate 1");
  });
});
