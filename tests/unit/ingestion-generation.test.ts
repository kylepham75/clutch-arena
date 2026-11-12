import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { z } from "zod";
import { APICallError, type LanguageModel } from "ai";
import {
  generateQuestions,
  validateGeneratedStudy,
  llmStudyOutputSchema,
  splitIntoBatchCounts,
  partitionSourcesAcrossBatches,
  groupSlidesByConcept,
  isNonContentSlide,
  isSubstantiveSlide,
  isUserFacingWarning,
  computeOverGeneratedCount,
  hasBannedNegationOrMetaOption,
  shuffleQuestionOptions,
  mergeAndDeduplicateBatches,
  compressSourcesForSonnetCascade,
  MAX_QUESTIONS_PER_BATCH,
  MCQ_GENERATION_TEMPERATURE,
  MCQ_GENERATION_TOP_P,
} from "@/lib/ai/generate-questions";
import { filterBlindVerifiedQuestions } from "@/lib/ai/verify-questions";
import { ingestionSystemPrompt } from "@/lib/ai/prompts";
import {
  getGenerationModel,
  assertSonnetInputTokenGuard,
  SONNET_MAX_INPUT_TOKENS,
} from "@/lib/ai/provider";
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
  it("splits >5 question requests into parallel batches of <=5, deduplicates questions, and merges usage before citation matching", async () => {
    expect(MAX_QUESTIONS_PER_BATCH).toBe(5);
    expect(splitIntoBatchCounts(5)).toEqual([5]);
    expect(splitIntoBatchCounts(10)).toEqual([5, 5]);
    expect(splitIntoBatchCounts(15)).toEqual([5, 5, 5]);
    expect(splitIntoBatchCounts(25)).toEqual([5, 5, 5, 5, 5]);
    expect(splitIntoBatchCounts(30)).toEqual([5, 5, 5, 5, 5, 5]);

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

    const batchOptions = ingestionOptionsSchema.parse({ questionCount: 15 });
    const res = await generateQuestions(
      multiSectionDoc,
      batchOptions,
      new AbortController().signal,
      batchModel,
    );

    // 15 questions -> 3 parallel batch calls of 5
    expect(batchModel.doGenerate).toHaveBeenCalledTimes(3);
    // 1 shared duplicate + 3 unique = 4 deduplicated questions
    expect(res.pack.questions).toHaveLength(4);
    expect(res.usage.totalTokens).toBe(900);
  });
  it("drops defective questions in a multi-question pack and returns valid questions without throwing INVALID_AI_OUTPUT", () => {
    const raw = output();
    // Valid question: raw.questions[0] (elasticity)

    // Defective question 1: fabricated excerpt
    const qFab = structuredClone(mockMicroeconomics.questions[0]);
    qFab.id = "defective-fabricated";
    qFab.question = "What is cross-price elasticity of demand?";
    raw.questions.push(qFab);
    raw.annotations.push({
      questionId: "defective-fabricated",
      sourceId: "lines-1-1",
      excerpt: "Completely fabricated quote that is not found in document.",
      topic: "Elasticity",
      chapter: "Chapter 4",
      rule: "Cross-price elasticity measures demand responsiveness to other goods.",
    });

    // Defective question 2: duplicate options
    const qDup = structuredClone(mockMicroeconomics.questions[0]);
    qDup.id = "defective-duplicate-opt";
    qDup.question = "What is income elasticity of demand?";
    qDup.options[1] = qDup.options[0];
    raw.questions.push(qDup);
    raw.annotations.push({
      questionId: "defective-duplicate-opt",
      sourceId: "lines-1-1",
      excerpt: "Demand is elastic when the absolute price elasticity exceeds one.",
      topic: "Elasticity",
      chapter: "Chapter 4",
      rule: "Income elasticity measures responsiveness to income changes.",
    });

    const result = validateGeneratedStudy(raw, document, {
      ...options,
      questionCount: 3,
    });

    // The two defective questions were dropped, leaving the 1 valid question
    expect(result.pack.questions).toHaveLength(1);
    expect(result.pack.questions[0].id).toBe("q-1");
    expect(result.pack.questions[0].question).toBe(raw.questions[0].question);
  });
  it("interleaves questions in round-robin order and deduplicates collisions across batches in mergeAndDeduplicateBatches", () => {
    const makeBatch = (idPrefix: string, questions: { q: string; v: string }[]) => ({
      title: "Title",
      sourceKind: "lecture" as const,
      questions: questions.map((item, idx) => {
        const q = structuredClone(mockMicroeconomics.questions[0]);
        q.id = `${idPrefix}-q${idx + 1}`;
        q.question = item.q;
        q.conceptVariant.question = item.v;
        return q;
      }),
      annotations: questions.map((_, idx) => ({
        questionId: `${idPrefix}-q${idx + 1}`,
        sourceId: "lines-1-1",
        excerpt: "Demand is elastic when the absolute price elasticity exceeds one.",
        topic: "Elasticity",
        chapter: "Chapter 4",
        rule: "Rule",
      })),
      warnings: [],
    });

    const batch1 = makeBatch("b1", [
      { q: "Section 1 Question A?", v: "Section 1 Variant A?" },
      { q: "Section 1 Question B?", v: "Section 1 Variant B?" },
    ]);
    const batch2 = makeBatch("b2", [
      { q: "Section 2 Question C?", v: "Section 2 Variant C?" },
      { q: "Section 1 Question A?", v: "Colliding Question Stem" },
      { q: "Section 2 Question D?", v: "Section 1 Question B?" },
      { q: "Section 2 Question E?", v: "Section 2 Variant E?" },
    ]);

    const merged = mergeAndDeduplicateBatches([batch1, batch2], 10);
    expect(merged.questions.map((q) => q.question)).toEqual([
      "Section 1 Question A?",
      "Section 2 Question C?",
      "Section 1 Question B?",
      "Section 2 Question E?",
    ]);
    expect(merged.questions[0].id).toBe("b1_b1-q1");
    expect(merged.questions[1].id).toBe("b2_b2-q1");
    expect(merged.annotations[0].questionId).toBe("b1_b1-q1");
  });
  it("tolerates partial batch failure when at least one batch succeeds", async () => {
    let callCount = 0;
    const partialFailModel: TestModel = {
      specificationVersion: "v2" as const,
      provider: "test",
      modelId: "fixture",
      supportedUrls: {},
      doGenerate: vi.fn<TestModel["doGenerate"]>(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Temporary network timeout on batch 1");
        }
        return {
          content: [{ type: "text", text: JSON.stringify(output()) }],
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          warnings: [],
        };
      }),
      doStream: async () => {
        throw new Error("Streaming is not used by ingestion");
      },
    };

    // 10 questions splits into [5, 5] (2 batches)
    const result = await generateQuestions(
      document,
      ingestionOptionsSchema.parse({ questionCount: 10 }),
      new AbortController().signal,
      partialFailModel,
    );

    expect(partialFailModel.doGenerate).toHaveBeenCalledTimes(2);
    expect(result.pack.questions).toHaveLength(1);
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

  it("binds non-content front-matter slides (cover, attendance, title) to the first substantive slide so batches are not starved", () => {
    const chapter9Slides: SourceBlock[] = [
      {
        id: "page-1",
        label: "Page 1",
        text: "CORPORATE\nFINANCE\nFlights of Wisdom Season 18\nSession 2\nCaptain Tấn Lộc\nCaptain",
      },
      {
        id: "page-2",
        label: "Page 2",
        text: "Attendance check\nhttps://tinyurl.com/yn8bf99x",
      },
      {
        id: "page-3",
        label: "Page 3",
        text: "REVISION CHAPTER 9\nSTOCK\nVALUATION",
      },
      {
        id: "page-4",
        label: "Page 4",
        text: "Stock value\nThe value of any asset is the present value of its expected future cash flows.",
      },
      {
        id: "page-5",
        label: "Page 5",
        text: "The dividend discount model of stock prices:\nThe price of a share of common stock is the present value of all expected future dividends.",
      },
      {
        id: "page-6",
        label: "Page 6",
        text: "Worked Example: Five Star Corporation will pay a dividend of $3.04 next year.\nCalculate stock price with R=11% and g=4%.",
      },
      {
        id: "page-7",
        label: "Page 7",
        text: "thank you!\nFOW | CF | Discord Server\tFeedback Form\nhttps://forms.gle/x9vayLdrWPy",
      },
    ];

    expect(isNonContentSlide(chapter9Slides[0])).toBe(true);
    expect(isNonContentSlide(chapter9Slides[1])).toBe(true);
    expect(isNonContentSlide(chapter9Slides[2])).toBe(true);
    expect(isSubstantiveSlide(chapter9Slides[3])).toBe(true);
    expect(isSubstantiveSlide(chapter9Slides[4])).toBe(true);
    expect(isSubstantiveSlide(chapter9Slides[5])).toBe(true);
    expect(isNonContentSlide(chapter9Slides[6])).toBe(true);

    const groups = groupSlidesByConcept(chapter9Slides, 3);
    expect(groups).toHaveLength(3);

    // Front-matter slides 1, 2, 3 must be grouped with the first content slide (page-4), never stranded alone
    expect(groups[0].map((s) => s.id)).toEqual(["page-1", "page-2", "page-3", "page-4"]);
    // Outro slide (page-7) must be attached to the final content slide, not forming its own group
    expect(groups[2].map((s) => s.id)).toContain("page-7");

    const partitions = partitionSourcesAcrossBatches(chapter9Slides, 3);
    expect(partitions).toHaveLength(3);
    for (const partition of partitions) {
      // Every partition must contain at least one substantive content slide
      const substantiveInPartition = partition.filter(isSubstantiveSlide);
      expect(substantiveInPartition.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("filters out internal model self-confirmations and prompt compliance chatter in isUserFacingWarning", () => {
    expect(
      isUserFacingWarning(
        "Requested 6 questions; all six were supported by the source blocks.",
      ),
    ).toBe(false);
    expect(
      isUserFacingWarning(
        "The financeSpec params object is constrained to empty by the schema, so solver inputs are encoded in the target string.",
      ),
    ).toBe(false);
    expect(
      isUserFacingWarning(
        "Option values are numeric text; the solver spec supplies the verified answer key for these calculations.",
      ),
    ).toBe(false);
    expect(
      isUserFacingWarning(
        "The attendance link in page-2 was not followed, as instructed.",
      ),
    ).toBe(false);
    expect(
      isUserFacingWarning(
        "Batch 1 of 3 provides no usable material. Please supply blocks with the actual stock valuation content.",
      ),
    ).toBe(false);

    // Legitimate user-facing warnings are preserved
    expect(
      isUserFacingWarning(
        "Created 5 of 15 requested questions; the source or selected focus did not support more.",
      ),
    ).toBe(true);
    expect(
      isUserFacingWarning(
        "Tài liệu không có sẵn câu hỏi trắc nghiệm nguyên văn; hệ thống đã tự động chuyển sang chế độ Biến thể khái niệm.",
      ),
    ).toBe(true);
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

  it("keeps llmStudyOutputSchema strictly under Anthropic 24-optional-param limit with zero empty-property catchall objects", () => {
    const jsonSchema = z.toJSONSchema(llmStudyOutputSchema) as Record<
      string,
      unknown
    >;

    let optionalParamCount = 0;
    const emptyPropertyPaths: string[] = [];
    const dynamicAdditionalPropsPaths: string[] = [];

    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((item, idx) => walk(item, `${path}[${idx}]`));
        return;
      }

      const obj = node as Record<string, unknown>;
      if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
        const propKeys = Object.keys(obj.properties as Record<string, unknown>);
        if (propKeys.length === 0) {
          emptyPropertyPaths.push(path);
        }
        const reqSet = new Set(
          Array.isArray(obj.required) ? (obj.required as string[]) : [],
        );
        for (const key of propKeys) {
          if (!reqSet.has(key)) {
            optionalParamCount++;
          }
          walk((obj.properties as Record<string, unknown>)[key], `${path}.${key}`);
        }
      }

      if (
        obj.additionalProperties !== undefined &&
        typeof obj.additionalProperties !== "boolean"
      ) {
        dynamicAdditionalPropsPaths.push(path);
      }

      if (obj.items) walk(obj.items, `${path}[]`);
      if (obj.$defs && typeof obj.$defs === "object") {
        for (const [defKey, defVal] of Object.entries(
          obj.$defs as Record<string, unknown>,
        )) {
          walk(defVal, `$defs.${defKey}`);
        }
      }
    };

    walk(jsonSchema, "root");

    expect(emptyPropertyPaths).toEqual([]);
    expect(dynamicAdditionalPropsPaths).toEqual([]);
    expect(optionalParamCount).toBeLessThanOrEqual(24);
  });

  it("computes portfolio_return via structured params and still runs cross-family blind verification by default", async () => {
    const portfolioDoc: ParsedDocument = {
      fileName: "Chapter 11.pdf",
      format: "pdf",
      sources: [
        {
          id: "page-22",
          label: "Page 22",
          text: "Portfolio expected return: E[Rp] = sum(Xi * E[Ri]). Example: $25,000 Intel at 18% and $35,000 ATP Oil and Gas at 25%.",
        },
      ],
      characterCount: 130,
      pageCount: 1,
      warnings: [],
    };

    const generatorModel = modelFor({
      title: "Portfolio Expected Return",
      sourceKind: "lecture",
      questions: [
        {
          id: "port-1",
          question:
            "You hold $25,000 of Intel with an expected return of 18% and $35,000 of ATP Oil and Gas with an expected return of 25%. What is the portfolio's expected return?",
          options: ["22.1%", "21.5%", "18.0%", "25.0%"],
          correctIndex: 0,
          explanation:
            "Weights are 25/60 and 35/60, so $E[R_P] = 0.4167(18\\%) + 0.5833(25\\%) \\approx 22.1\\%$.",
          financeSpec: {
            solver: "portfolio_return",
            params: {
              scalars: [],
              arrays: [
                { name: "values", values: [25000, 35000] },
                { name: "returns", values: [0.18, 0.25] },
              ],
            },
            unit: "%",
            decimals: 1,
            distractorModes: ["unweighted_average", "highest_asset_return"],
          },
          conceptVariant: {
            question:
              "You invest $40,000 in Stock A (10% expected return) and $60,000 in Stock B (20% expected return). What is the portfolio's expected return?",
            options: ["16.0%", "15.0%", "14.0%", "20.0%"],
            correctIndex: 0,
            explanation:
              "Weights are 0.4 and 0.6, so $E[R_P] = 0.4(10\\%) + 0.6(20\\%) = 16.0\\%$.",
            financeSpec: {
              solver: "portfolio_return",
              params: {
                scalars: [],
                arrays: [
                  { name: "values", values: [40000, 60000] },
                  { name: "returns", values: [0.1, 0.2] },
                ],
              },
              unit: "%",
              decimals: 1,
            },
          },
        },
      ],
      annotations: [
        {
          questionId: "port-1",
          sourceId: "page-22",
          excerpt: "Portfolio expected return: E[Rp] = sum(Xi * E[Ri]).",
          topic: "Portfolio expected return",
          chapter: "Chapter 11",
          rule: "$E[R_P] = \\sum X_i E[R_i]$",
        },
      ],
      warnings: [],
    });

    const verifierModel = modelFor({
      verdicts: [
        {
          id: "port-1",
          selectedIndex: 0,
          isAmbiguous: false,
          confidence: "high",
          reason: "Weighted return is 22.1%.",
        },
        {
          id: "port-1::conceptVariant",
          selectedIndex: 0,
          isAmbiguous: false,
          confidence: "high",
          reason: "Weighted return is 16.0%.",
        },
      ],
    });

    const result = await generateQuestions(
      portfolioDoc,
      ingestionOptionsSchema.parse({ questionCount: 1 }),
      new AbortController().signal,
      generatorModel,
      { verifierModel },
    );

    // Blind verifier MUST run even on solver-computed questions
    expect(verifierModel.doGenerate).toHaveBeenCalledTimes(1);
    const q = result.pack.questions[0];
    expect(q.options[q.correctIndex]).toBe("22.1%");
    expect(q.options).not.toContain("0.0%");
    expect(q.conceptVariant.options[q.conceptVariant.correctIndex]).toBe("16.0%");
  });

  it("rejects/drops items with empty financeSpec params instead of emitting 0.0% options", async () => {
    const portfolioDoc: ParsedDocument = {
      fileName: "Chapter 11.pdf",
      format: "pdf",
      sources: [
        {
          id: "page-22",
          label: "Page 22",
          text: "Portfolio expected return: E[Rp] = sum(Xi * E[Ri]).",
        },
      ],
      characterCount: 53,
      pageCount: 1,
      warnings: [],
    };

    const brokenGeneratorModel = modelFor({
      title: "Portfolio Expected Return",
      sourceKind: "lecture",
      questions: [
        {
          id: "bad-1",
          question: "What is the portfolio expected return?",
          options: ["22.1%", "21.5%", "18.0%", "25.0%"],
          correctIndex: 0,
          explanation: "Weighted average is 22.1%.",
          financeSpec: {
            solver: "capm",
            params: { scalars: [], arrays: [] },
            unit: "%",
            decimals: 1,
          },
          conceptVariant: {
            question: "What is the variant portfolio expected return?",
            options: ["16.0%", "15.0%", "10.0%", "20.0%"],
            correctIndex: 0,
            explanation: "Weighted average is 16.0%.",
          },
        },
      ],
      annotations: [
        {
          questionId: "bad-1",
          sourceId: "page-22",
          excerpt: "Portfolio expected return: E[Rp] = sum(Xi * E[Ri]).",
          topic: "Portfolio expected return",
          chapter: "Chapter 11",
          rule: "$E[R_P] = \\sum X_i E[R_i]$",
        },
      ],
      warnings: [],
    });

    await expect(
      generateQuestions(
        portfolioDoc,
        ingestionOptionsSchema.parse({ questionCount: 1 }),
        new AbortController().signal,
        brokenGeneratorModel,
        false,
      ),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT", status: 502 });
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

  it("enforces 5-question micro-batching partitions (splitIntoBatchCounts(15) -> [5, 5, 5], splitIntoBatchCounts(30) -> [5, 5, 5, 5, 5, 5])", () => {
    expect(splitIntoBatchCounts(15)).toEqual([5, 5, 5]);
    expect(splitIntoBatchCounts(30)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it("drops single-item bad citations or bad options and preserves valid items without failing the entire pack in validateGeneratedStudy", () => {
    const raw = output();
    // Valid item 1
    const q1 = structuredClone(mockMicroeconomics.questions[0]);
    q1.id = "valid-q1";
    q1.question = "Valid Question 1: What is price elasticity of demand?";

    // Defective item 2: bad citation (non-existent sourceId)
    const q2BadCitation = structuredClone(mockMicroeconomics.questions[0]);
    q2BadCitation.id = "bad-citation-q2";
    q2BadCitation.question = "Bad Citation Question: What is cross elasticity?";

    // Defective item 3: bad options (duplicate options)
    const q3BadOptions = structuredClone(mockMicroeconomics.questions[0]);
    q3BadOptions.id = "bad-options-q3";
    q3BadOptions.question = "Bad Options Question: What is income elasticity?";
    q3BadOptions.options[1] = q3BadOptions.options[0]; // duplicate options

    // Valid item 4
    const q4 = structuredClone(mockMicroeconomics.questions[0]);
    q4.id = "valid-q4";
    q4.question = "Valid Question 4: What is supply elasticity?";

    raw.questions = [q1, q2BadCitation, q3BadOptions, q4];
    raw.annotations = [
      {
        questionId: "valid-q1",
        sourceId: "lines-1-1",
        excerpt: "Demand is elastic when the absolute price elasticity exceeds one.",
        topic: "Elasticity",
        chapter: "Chapter 4",
        rule: "Rule 1",
      },
      {
        questionId: "bad-citation-q2",
        sourceId: "missing-source-999", // Bad citation
        excerpt: "Demand is elastic when the absolute price elasticity exceeds one.",
        topic: "Elasticity",
        chapter: "Chapter 4",
        rule: "Rule 2",
      },
      {
        questionId: "bad-options-q3",
        sourceId: "lines-1-1",
        excerpt: "Demand is elastic when the absolute price elasticity exceeds one.",
        topic: "Elasticity",
        chapter: "Chapter 4",
        rule: "Rule 3",
      },
      {
        questionId: "valid-q4",
        sourceId: "lines-1-1",
        excerpt: "Demand is elastic when the absolute price elasticity exceeds one.",
        topic: "Elasticity",
        chapter: "Chapter 4",
        rule: "Rule 4",
      },
    ];

    const result = validateGeneratedStudy(raw, document, {
      ...options,
      questionCount: 4,
    });

    // The two defective items (bad citation & bad options) are dropped, leaving 2 valid questions
    expect(result.pack.questions).toHaveLength(2);
    expect(result.pack.questions.map((q) => q.id)).toEqual(["q-1", "q-2"]);
    expect(result.pack.questions[0].question).toBe(q1.question);
    expect(result.pack.questions[1].question).toBe(q4.question);
  });

  it("drops both hallucinated items (isGrounded: false) and semantic duplicate items (duplicateOfId) in filterBlindVerifiedQuestions", () => {
    const q1 = {
      ...structuredClone(mockMicroeconomics.questions[0]),
      id: "cand-1",
      question: "What is price elasticity?",
    };
    const q2 = {
      ...structuredClone(mockMicroeconomics.questions[0]),
      id: "cand-2",
      question: "Hallucinated claim about external market?",
    };
    const q3 = {
      ...structuredClone(mockMicroeconomics.questions[0]),
      id: "cand-3",
      question: "Duplicate question on price elasticity?",
    };
    const q4 = {
      ...structuredClone(mockMicroeconomics.questions[0]),
      id: "cand-4",
      question: "What is income elasticity?",
    };

    const verdicts = [
      {
        id: "cand-1",
        selectedIndex: q1.correctIndex,
        isAmbiguous: false,
        confidence: "high" as const,
        reason: "Directly grounded.",
        isGrounded: true,
        duplicateOfId: null,
      },
      {
        id: "cand-2",
        selectedIndex: q2.correctIndex,
        isAmbiguous: false,
        confidence: "high" as const,
        reason: "Hallucinated concept not in source.",
        isGrounded: false, // Hallucinated item
        duplicateOfId: null,
      },
      {
        id: "cand-3",
        selectedIndex: q3.correctIndex,
        isAmbiguous: false,
        confidence: "high" as const,
        reason: "Semantic duplicate of cand-1.",
        isGrounded: true,
        duplicateOfId: "cand-1", // Semantic duplicate item
      },
      {
        id: "cand-4",
        selectedIndex: q4.correctIndex,
        isAmbiguous: false,
        confidence: "high" as const,
        reason: "Directly grounded.",
        isGrounded: true,
        duplicateOfId: null,
      },
    ];

    const result = filterBlindVerifiedQuestions([q1, q2, q3, q4], verdicts);

    expect(result.verifiedIds).toEqual(["cand-1", "cand-4"]);
    expect(result.droppedIds).toEqual(["cand-2", "cand-3"]);
    expect(result.duplicateIds).toEqual(["cand-3"]);
    expect(result.verifiedQuestions).toHaveLength(2);
    expect(result.verifiedQuestions[0].id).toBe("cand-1");
    expect(result.verifiedQuestions[1].id).toBe("cand-4");
  });

  it("drops both hallucinated items (isGrounded: false) and semantic duplicate items (duplicateOfId) in generateQuestions with blind verifier", async () => {
    const q1 = structuredClone(mockMicroeconomics.questions[0]);
    q1.id = "cand-1";
    q1.question = "Candidate 1: Grounded unique question on price elasticity";

    const q2 = structuredClone(mockMicroeconomics.questions[0]);
    q2.id = "cand-2";
    q2.question = "Candidate 2: Hallucinated question not in text";

    const q3 = structuredClone(mockMicroeconomics.questions[0]);
    q3.id = "cand-3";
    q3.question = "Candidate 3: Duplicate question repeating Candidate 1";

    const q4 = structuredClone(mockMicroeconomics.questions[0]);
    q4.id = "cand-4";
    q4.question = "Candidate 4: Grounded unique question on demand curves";

    const genPayload = {
      title: "Price elasticity",
      sourceKind: "lecture",
      questions: [q1, q2, q3, q4],
      annotations: ["cand-1", "cand-2", "cand-3", "cand-4"].map((id) => ({
        questionId: id,
        sourceId: "lines-1-1",
        excerpt:
          "Demand is elastic when the absolute price elasticity exceeds one.",
        topic: "Elasticity",
        chapter: "Chapter 4",
        rule: "Rule",
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
          reason: "Grounded in lecture text.",
          isGrounded: true,
          duplicateOfId: null,
        },
        {
          id: "cand-2",
          selectedIndex: q2.correctIndex,
          isAmbiguous: false,
          confidence: "high",
          reason: "Hallucinated assertion not found in sources.",
          isGrounded: false, // Hallucinated item dropped
          duplicateOfId: null,
        },
        {
          id: "cand-3",
          selectedIndex: q3.correctIndex,
          isAmbiguous: false,
          confidence: "high",
          reason: "Duplicates test point of cand-1.",
          isGrounded: true,
          duplicateOfId: "cand-1", // Semantic duplicate item dropped
        },
        {
          id: "cand-4",
          selectedIndex: q4.correctIndex,
          isAmbiguous: false,
          confidence: "high",
          reason: "Grounded in lecture text.",
          isGrounded: true,
          duplicateOfId: null,
        },
      ],
    });

    const result = await generateQuestions(
      document,
      ingestionOptionsSchema.parse({ questionCount: 2 }),
      new AbortController().signal,
      generatorModel,
      { verifierModel },
    );

    // Both cand-2 (hallucinated) and cand-3 (duplicate) were dropped by blind verifier
    expect(result.pack.questions).toHaveLength(2);
    expect(result.pack.questions[0].question).toContain("Candidate 1");
    expect(result.pack.questions[1].question).toContain("Candidate 4");
  });

  it("automatically falls back from mode=exact to mode=variants when no verbatim MCQs are found in lecture slides", async () => {
    let callCount = 0;
    const model = {
      specificationVersion: "v2" as const,
      provider: "test",
      modelId: "fixture",
      supportedUrls: {},
      doGenerate: vi.fn().mockImplementation(async (opts: any) => {
        callCount++;
        const promptStr = JSON.stringify(opts.prompt);
        if (promptStr.includes('\\"mode\\":\\"exact\\"')) {
          // Model returns empty questions array for lecture slides without pre-existing MCQs
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  title: "Lecture Slides",
                  sourceKind: "lecture",
                  questions: [],
                  annotations: [],
                  warnings: ["No multiple choice questions found in document."],
                }),
              },
            ],
            finishReason: "stop",
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
            warnings: [],
          };
        }

        // Fallback call with mode=variants returns valid questions
        return {
          content: [{ type: "text", text: JSON.stringify(output()) }],
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
          warnings: [],
        };
      }),
      doStream: async () => {
        throw new Error("Streaming is not used by ingestion");
      },
    };

    const result = await generateQuestions(
      document,
      ingestionOptionsSchema.parse({ mode: "exact", questionCount: 2 }),
      new AbortController().signal,
      model as any,
      false, // Skip blind verifier for unit test
    );

    expect(callCount).toBe(2);
    expect(result.pack.questions.length).toBeGreaterThan(0);
    expect(
      result.warnings.some(
        (w) => w.includes("Biến thể khái niệm") || w.includes("variants"),
      ),
    ).toBe(true);
  });

  // ==========================================================================
  // Task 3.2: Multi-Chapter 30-Question & Haiku -> Sonnet Cascade Regression Suite
  // ==========================================================================

  it("filters Pearson Chapter 7 & 8 non-content slides (covers, outlines, learning objectives with calculate/compute, disclaimers, captions) while retaining substantive slides in isNonContentSlide", () => {
    const ch8Cover: SourceBlock = {
      id: "doc0_page-1",
      label: "Page 1",
      text: "Corporate Finance\nSixth Edition, Global Edition\nChapter 8 Fundamentals of Capital Budgeting\n© 2024 Pearson Education, Ltd. All Rights Reserved",
    };
    const ch7Cover: SourceBlock = {
      id: "doc1_page-1",
      label: "Page 1",
      text: "Corporate Finance\nSixth Edition, Global Edition\nChapter 7 Investment Decision Rules\n© 2024 Pearson Education, Ltd. All Rights Reserved",
    };
    const ch8Outline: SourceBlock = {
      id: "doc0_page-2",
      label: "Page 2",
      text: "Chapter Outline\n8.1 Forecasting Earnings\n8.2 Determining Free Cash Flow and NPV\n8.3 Choosing Among Alternatives\n8.4 Further Adjustments to Free Cash Flow",
    };
    const ch8Objectives: SourceBlock = {
      id: "doc0_page-3",
      label: "Page 3",
      text: "Learning Objectives\n• Calculate free cash flows for a project\n• Compute the NPV of an investment\n• Understand sensitivity analysis and break-even points",
    };
    const copyrightDisclaimer: SourceBlock = {
      id: "doc0_page-4",
      label: "Page 4",
      text: "This work is provided solely for the use of instructors in teaching their courses and assessing student learning. Dissemination or sale of any part of this work is not permitted.",
    };
    const captionOnlyFigure: SourceBlock = {
      id: "doc0_page-5",
      label: "Page 5",
      text: "Figure 8.1 HomeNet's NPV Under Best-and Worst-Case Parameter Assumptions",
    };

    const substantiveHomeNet: SourceBlock = {
      id: "doc0_page-6",
      label: "Page 6",
      text: "HomeNet Incremental Earnings Forecast\nYear 0: Unlevered Net Income = $0\nYear 1: Revenues = $26,000, Cost of Goods Sold = $11,000, Gross Profit = $15,000\nCalculate the Free Cash Flow = Cash Flow from Operations - Capital Expenditures = $15,000 - $3,000 = $12,000.",
    };
    const substantiveNPV: SourceBlock = {
      id: "doc1_page-6",
      label: "Page 6",
      text: "Calculating NPV for Project Alpha:\nInitial Outlay = -$100,000\nCash flow Year 1 = $40,000, Year 2 = $50,000, Year 3 = $60,000 at r = 10%.\nNPV = -$100,000 + 40,000/1.1 + 50,000/1.1^2 + 60,000/1.1^3 = $22,877.54.",
    };

    expect(isNonContentSlide(ch8Cover)).toBe(true);
    expect(isNonContentSlide(ch7Cover)).toBe(true);
    expect(isNonContentSlide(ch8Outline)).toBe(true);
    expect(isNonContentSlide(ch8Objectives)).toBe(true);
    expect(isNonContentSlide(copyrightDisclaimer)).toBe(true);
    expect(isNonContentSlide(captionOnlyFigure)).toBe(true);

    expect(isNonContentSlide(substantiveHomeNet)).toBe(false);
    expect(isSubstantiveSlide(substantiveHomeNet)).toBe(true);
    expect(isNonContentSlide(substantiveNPV)).toBe(false);
    expect(isSubstantiveSlide(substantiveNPV)).toBe(true);
  });

  it("uniformly partitions a 170-slide multi-chapter composite upload (Ch. 8 + Ch. 7) across 6 batches with >= 15 substantive slides per batch and no stranded non-content slides", () => {
    // doc0_: Chapter 8 (100 slides: 5 front-matter non-content, 80 substantive, 15 appendix/figure non-content)
    const ch8Slides: SourceBlock[] = [];
    ch8Slides.push(
      {
        id: "doc0_page-1",
        label: "Ch 8 Page 1",
        text: "Corporate Finance\nSixth Edition, Global Edition\nChapter 8 Fundamentals of Capital Budgeting\n© 2024 Pearson Education, Ltd. All Rights Reserved",
      },
      {
        id: "doc0_page-2",
        label: "Ch 8 Page 2",
        text: "Chapter Outline\n8.1 Forecasting Earnings\n8.2 Determining Free Cash Flow and NPV",
      },
      {
        id: "doc0_page-3",
        label: "Ch 8 Page 3",
        text: "Learning Objectives\n• Calculate free cash flows for a project\n• Compute the NPV",
      },
      {
        id: "doc0_page-4",
        label: "Ch 8 Page 4",
        text: "This work is provided solely for the use of instructors in teaching their courses and assessing student learning. Dissemination or sale of any part of this work is not permitted.",
      },
      {
        id: "doc0_page-5",
        label: "Ch 8 Page 5",
        text: "Figure 8.1 HomeNet's NPV Under Best-and Worst-Case Parameter Assumptions",
      },
    );
    for (let i = 6; i <= 85; i++) {
      ch8Slides.push({
        id: `doc0_page-${i}`,
        label: `Ch 8 Page ${i}`,
        text: `HomeNet Forecasting Concept ${i}\nRevenue = $${1000 * i}, Expenses = $${400 * i}, EBITDA = $${600 * i}.\nCalculate the Free Cash Flow = Cash Flow from Operations - CapEx = $${500 * i}.`,
      });
    }
    for (let i = 86; i <= 100; i++) {
      ch8Slides.push({
        id: `doc0_page-${i}`,
        label: `Ch 8 Page ${i}`,
        text: `Figure 8.${i - 80} Sensitivity Graph and Appendix Notes ${i}`,
      });
    }

    // doc1_: Chapter 7 (70 slides: 4 front-matter non-content, 55 substantive, 11 outro/figure non-content)
    const ch7Slides: SourceBlock[] = [];
    ch7Slides.push(
      {
        id: "doc1_page-1",
        label: "Ch 7 Page 1",
        text: "Corporate Finance\nSixth Edition, Global Edition\nChapter 7 Investment Decision Rules\n© 2024 Pearson Education, Ltd. All Rights Reserved",
      },
      {
        id: "doc1_page-2",
        label: "Ch 7 Page 2",
        text: "Chapter Outline\n7.1 The NPV Decision Rule\n7.2 The Internal Rate of Return (IRR) Rule",
      },
      {
        id: "doc1_page-3",
        label: "Ch 7 Page 3",
        text: "Learning Objectives\n• Calculate NPV and IRR\n• Compare payback rule",
      },
      {
        id: "doc1_page-4",
        label: "Ch 7 Page 4",
        text: "This work is provided solely for the use of instructors in teaching their courses and assessing student learning.",
      },
    );
    for (let i = 5; i <= 59; i++) {
      ch7Slides.push({
        id: `doc1_page-${i}`,
        label: `Ch 7 Page ${i}`,
        text: `Investment Decision Rule Concept ${i}\nInitial Outlay = -$${500 * i}, Cash Flow Year 1 = $${700 * i}.\nCompute the NPV at discount rate r = 10%.`,
      });
    }
    for (let i = 60; i <= 70; i++) {
      ch7Slides.push({
        id: `doc1_page-${i}`,
        label: `Ch 7 Page ${i}`,
        text: `Figure 7.${i - 50} Investment Summary and Chapter Conclusion ${i}`,
      });
    }

    const all170Slides = [...ch8Slides, ...ch7Slides];
    expect(all170Slides).toHaveLength(170);

    const substantiveTotal = all170Slides.filter(isSubstantiveSlide);
    expect(substantiveTotal).toHaveLength(135);

    const partitions = partitionSourcesAcrossBatches(all170Slides, 6);
    expect(partitions).toHaveLength(6);

    for (const batch of partitions) {
      // Every single batch receives >= 15 substantive slides
      const substantiveInBatch = batch.filter(isSubstantiveSlide);
      expect(substantiveInBatch.length).toBeGreaterThanOrEqual(15);
      // 0 non-content slides are stranded as standalone batch inputs
      expect(batch.every(isNonContentSlide)).toBe(false);
      expect(batch.some(isSubstantiveSlide)).toBe(true);
    }

    // Both chapters are evenly represented across the 6 batches
    const batch0HasDoc0 = partitions[0].some((s) => s.id.startsWith("doc0_"));
    const batch5HasDoc1 = partitions[5].some((s) => s.id.startsWith("doc1_"));
    expect(batch0HasDoc0).toBe(true);
    expect(batch5HasDoc1).toBe(true);

    const totalDoc0 = partitions.flat().filter((s) => s.id.startsWith("doc0_")).length;
    const totalDoc1 = partitions.flat().filter((s) => s.id.startsWith("doc1_")).length;
    expect(totalDoc0).toBe(80);
    expect(totalDoc1).toBe(55);
  });

  it("executes 2-stage Haiku 5.5 -> Sonnet 5.5 compression cascade on large batch slide chunks (> 3,200 chars) and enforces SONNET_MAX_INPUT_TOKENS guard", async () => {
    const distillSlideChunkForSonnet = compressSourcesForSonnetCascade;

    const largeSlideChunk: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text:
          "Free cash flow to firm represents the operating cash flow available to all capital providers after meeting capital expenditure requirements.\n" +
          "FCFF = EBIT * (1 - T) + D&A - CapEx - Delta NWC = $18,500,000 in Year 1.\n" +
          "When calculating unlevered net income, interest expenses are excluded because financing choices should be evaluated separately.\n" +
          "Detailed background: " +
          "Capital budgeting decisions require estimating incremental cash flows rather than accounting profits. ".repeat(
            15,
          ),
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text:
          "Net Working Capital requirements directly impact free cash flows through investments in inventory and receivables.\n" +
          "Delta NWC = (Cash + Inventory + Receivables) - (Payables) = $2,400,000.\n" +
          "An increase in net working capital represents a cash outflow because additional funds are tied up in operations.\n" +
          "Detailed background: " +
          "Working capital management ensures that the firm maintains sufficient liquidity to satisfy short-term obligations. ".repeat(
            15,
          ),
      },
      {
        id: "slide-3",
        label: "Slide 3",
        text:
          "Depreciation tax shield provides a valuable non-cash tax deduction that increases incremental project cash flows.\n" +
          "Depreciation Tax Shield = Depreciation * Tax Rate = $5,000,000 * 0.21 = $1,050,000.\n" +
          "Even though depreciation is a non-cash expense, its tax deductibility saves actual cash taxes paid.\n" +
          "Detailed background: " +
          "MACRS depreciation allows accelerated write-offs compared to straight-line depreciation methods. ".repeat(
            15,
          ),
      },
    ];

    const uncompressedTotalChars = largeSlideChunk.reduce(
      (sum, s) => sum + s.text.length,
      0,
    );
    expect(uncompressedTotalChars).toBeGreaterThan(3_200);

    // Verify distillSlideChunkForSonnet compresses chunk, preserving sourceId and verbatim quote anchors
    const compressed = distillSlideChunkForSonnet(largeSlideChunk, 18_000);
    expect(compressed).toHaveLength(3);

    for (let i = 0; i < largeSlideChunk.length; i++) {
      expect(compressed[i].id).toBe(largeSlideChunk[i].id);
      expect(compressed[i].text.length).toBeLessThan(largeSlideChunk[i].text.length);
    }
    // Verbatim quote anchors (the first substantive sentences >= 12 words) must be preserved
    expect(compressed[0].text).toContain(
      "Free cash flow to firm represents the operating cash flow available to all capital providers",
    );
    expect(compressed[1].text).toContain(
      "Net Working Capital requirements directly impact free cash flows through investments",
    );
    expect(compressed[2].text).toContain(
      "Depreciation tax shield provides a valuable non-cash tax deduction",
    );
    // Key formulas and numbers must be preserved
    expect(compressed[0].text).toContain("FCFF = EBIT");
    expect(compressed[1].text).toContain("Delta NWC =");
    expect(compressed[2].text).toContain("Depreciation Tax Shield =");

    // Verify assertSonnetInputTokenGuard
    const normalPrompt = "A".repeat(12_000); // ~3,000 tokens
    const normalGuard = assertSonnetInputTokenGuard(
      normalPrompt,
      "anthropic/claude-sonnet-5.5",
      SONNET_MAX_INPUT_TOKENS,
    );
    expect(normalGuard.withinLimit).toBe(true);
    expect(normalGuard.truncatedPromptText).toBe(normalPrompt);

    const oversizedPrompt = "A".repeat(40_000); // ~10,000 tokens (> 8,000 limit)
    const oversizedGuard = assertSonnetInputTokenGuard(
      oversizedPrompt,
      "anthropic/claude-sonnet-5.5",
      SONNET_MAX_INPUT_TOKENS,
    );
    expect(oversizedGuard.withinLimit).toBe(false);
    expect(oversizedGuard.estimatedTokens).toBe(10_000);
    expect(oversizedGuard.truncatedPromptText.length).toBe(
      SONNET_MAX_INPUT_TOKENS * 4,
    );
    expect(oversizedGuard.warning).toContain(
      `SONNET_MAX_INPUT_TOKENS=${SONNET_MAX_INPUT_TOKENS}`,
    );

    // End-to-end generateQuestions call with Sonnet 5.5 mock model on paid tier
    let capturedPrompt = "";
    const sonnetModel: TestModel = {
      specificationVersion: "v2" as const,
      provider: "anthropic",
      modelId: "anthropic/claude-sonnet-5.5",
      supportedUrls: {},
      doGenerate: vi.fn<TestModel["doGenerate"]>(async (options) => {
        capturedPrompt = JSON.stringify(options.prompt);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: "Fundamentals of Capital Budgeting",
                sourceKind: "lecture",
                questions: [
                  {
                    id: "sonnet-q1",
                    question:
                      "What is the value of the depreciation tax shield with $5M depreciation and a 21% tax rate?",
                    options: [
                      "$1,050,000",
                      "$5,000,000",
                      "$3,950,000",
                      "$210,000",
                    ],
                    correctIndex: 0,
                    explanation:
                      "Depreciation tax shield equals depreciation multiplied by the corporate tax rate.",
                    conceptVariant: {
                      question:
                        "How does a 21% tax rate affect cash flow when depreciation is $5M?",
                      options: [
                        "It saves $1,050,000 in cash taxes",
                        "It saves $5,000,000 in cash taxes",
                        "It reduces cash flow by $1,050,000",
                        "It has zero cash effect",
                      ],
                      correctIndex: 0,
                      explanation:
                        "The tax deductibility of depreciation creates a cash tax savings equal to the shield.",
                    },
                  },
                ],
                annotations: [
                  {
                    questionId: "sonnet-q1",
                    sourceId: "slide-3",
                    excerpt:
                      "Depreciation tax shield provides a valuable non-cash tax deduction that increases incremental project cash flows.",
                    topic: "Tax Shield",
                    chapter: "Chapter 8",
                    rule: "Depreciation Tax Shield = Depreciation * Tax Rate",
                  },
                ],
                warnings: [],
              }),
            },
          ],
          finishReason: "stop",
          usage: { inputTokens: 400, outputTokens: 200, totalTokens: 600 },
          warnings: [],
        };
      }),
      doStream: async () => {
        throw new Error("Streaming is not used by ingestion");
      },
    };

    const docWithLargeBatch: ParsedDocument = {
      fileName: "lecture_large.txt",
      format: "txt",
      sources: largeSlideChunk,
      characterCount: uncompressedTotalChars,
      pageCount: 3,
      warnings: [],
    };

    const res = await generateQuestions(
      docWithLargeBatch,
      ingestionOptionsSchema.parse({ questionCount: 1, tier: "pro" }),
      new AbortController().signal,
      sonnetModel,
      false,
    );

    expect(sonnetModel.doGenerate).toHaveBeenCalledTimes(1);
    expect(capturedPrompt).toContain(
      "Depreciation tax shield provides a valuable non-cash tax deduction",
    );
    expect(Math.ceil(capturedPrompt.length / 4)).toBeLessThan(
      SONNET_MAX_INPUT_TOKENS,
    );
    expect(res.pack.questions).toHaveLength(1);
    expect(res.pack.questions[0].question).toContain("depreciation tax shield");
  });

  it("delivers full 30 questions via Smart Deficit Fill when 3 base questions are dropped and synthesizes multi-chapter composite title", async () => {
    // 30 slides across two chapters (15 for Ch. 8 + 15 for Ch. 7) to respect MAX_ITEMS_PER_SLIDE = 2
    const ch8Sources: SourceBlock[] = Array.from({ length: 15 }, (_, i) => ({
      id: `doc0_slide-${i + 1}`,
      label: `Ch 8 Slide ${i + 1}`,
      text: `Fundamentals of Capital Budgeting Principle ${i + 1}: Free cash flow item ${i + 1} measures operating cash after capital expenditures. Project evaluation requires discounting these flows at the appropriate cost of capital.`,
    }));

    const ch7Sources: SourceBlock[] = Array.from({ length: 15 }, (_, i) => ({
      id: `doc1_slide-${i + 1}`,
      label: `Ch 7 Slide ${i + 1}`,
      text: `Investment Decision Rules Principle ${i + 1}: The Net Present Value criterion ${i + 1} directs firms to accept all positive NPV investment opportunities to maximize firm equity value.`,
    }));

    const multiChapterDoc: ParsedDocument = {
      fileName: "Corporate_Finance_Ch8_Ch7.pdf",
      format: "pdf",
      sources: [...ch8Sources, ...ch7Sources],
      characterCount: 6000,
      pageCount: 30,
      warnings: [],
    };

    let batchExecutionCount = 0;
    const multiBatchModel: TestModel = {
      specificationVersion: "v2" as const,
      provider: "test",
      modelId: "fixture",
      supportedUrls: {},
      doGenerate: vi.fn<TestModel["doGenerate"]>(async (opts) => {
        const batchIdx = batchExecutionCount++;
        const isCh8 = batchIdx < 3;
        const title = isCh8
          ? "Fundamentals of Capital Budgeting"
          : "Investment Decision Rules";

        // Determine the 5 slides allocated to this batch
        const batchOffset = isCh8 ? batchIdx * 5 : (batchIdx - 3) * 5;
        const slidePool = isCh8 ? ch8Sources : ch7Sources;
        const currentBatchSlides = slidePool.slice(batchOffset, batchOffset + 5);

        // Return 5 questions per batch (6 batches * 5 = 30 total).
        // In batches 0, 2, and 4, the 1st question has a fabricated excerpt (so 3 base questions will be dropped by validation).
        const questions = Array.from({ length: 5 }, (_, qIdx) => {
          const isDefective = (batchIdx === 0 || batchIdx === 2 || batchIdx === 4) && qIdx === 0;
          const qId = `b${batchIdx + 1}-q${qIdx + 1}`;
          return {
            id: qId,
            question: isDefective
              ? `Defective question stem for ${qId} with fabricated quote`
              : `Batch ${batchIdx + 1} Question ${qIdx + 1}: What principle governs ${title}?`,
            options: [
              `Correct choice for ${qId}`,
              `Distractor A for ${qId}`,
              `Distractor B for ${qId}`,
              `Distractor C for ${qId}`,
            ],
            correctIndex: 0,
            explanation: `Explanation for ${qId} grounded in lecture materials.`,
            conceptVariant: {
              question: `Batch ${batchIdx + 1} Variant ${qIdx + 1}: How does the concept apply in context?`,
              options: [
                `Variant correct for ${qId}`,
                `Variant distractor A for ${qId}`,
                `Variant distractor B for ${qId}`,
                `Variant distractor C for ${qId}`,
              ],
              correctIndex: 0,
              explanation: `Variant explanation for ${qId} grounded in lecture materials.`,
            },
          };
        });

        const annotations = questions.map((q, qIdx) => {
          const isDefective = (batchIdx === 0 || batchIdx === 2 || batchIdx === 4) && qIdx === 0;
          const assignedSlide = currentBatchSlides[qIdx] || currentBatchSlides[0];
          return {
            questionId: q.id,
            sourceId: assignedSlide.id,
            excerpt: isDefective
              ? "Fabricated quote that is completely missing from uploaded slides."
              : assignedSlide.text,
            topic: isCh8 ? "Capital Budgeting" : "Decision Rules",
            chapter: isCh8 ? "Chapter 8" : "Chapter 7",
            rule: isCh8
              ? "Free cash flow measures available capital."
              : "Accept positive NPV projects.",
          };
        });

        const batchPayload = {
          title,
          sourceKind: "lecture",
          questions,
          annotations,
          warnings: [],
        };

        return {
          content: [{ type: "text", text: JSON.stringify(batchPayload) }],
          finishReason: "stop",
          usage: { inputTokens: 120, outputTokens: 300, totalTokens: 420 },
          warnings: [],
        };
      }),
      doStream: async () => {
        throw new Error("Streaming is not used by ingestion");
      },
    };

    const options30 = ingestionOptionsSchema.parse({ questionCount: 30 });
    const result = await generateQuestions(
      multiChapterDoc,
      options30,
      new AbortController().signal,
      multiBatchModel,
      false, // Skip blind verifier for deterministic unit test
    );

    // 30 questions requested -> 6 parallel batches of 5
    expect(batchExecutionCount).toBe(6);

    // The synthesized title combines Chapter 8 and Chapter 7 distinct topics
    expect(result.pack.title).toBe(
      "Fundamentals of Capital Budgeting & Investment Decision Rules",
    );

    // 3 defective base questions were dropped, and Smart Deficit Fill promoted 3 concept variants to achieve full 30
    expect(result.pack.questions).toHaveLength(30);

    // The first 27 questions are base questions, and the last 3 questions (q-28, q-29, q-30) are promoted concept variants
    expect(result.pack.questions[0].id).toBe("q-1");
    expect(result.pack.questions[26].id).toBe("q-27");
    expect(result.pack.questions[27].id).toBe("q-28");
    expect(result.pack.questions[28].id).toBe("q-29");
    expect(result.pack.questions[29].id).toBe("q-30");

    // Verify promoted questions have valid variant questions and citations
    expect(result.pack.questions[27].question).toContain("Variant");
    expect(result.pack.metadata["q-28"].citation).toBeDefined();
    expect(result.references["q-28"].excerpt).toBeDefined();
    expect(result.pack.metadata["q-30"].citation).toBeDefined();
    expect(result.references["q-30"].excerpt).toBeDefined();
  });

  it("suppresses all 6 LLM compliance warning strings from production screenshots in isUserFacingWarning", () => {
    // 6 warning strings from user's screenshot
    const complianceWarnings = [
      "The only source block is a title slide...",
      "Only the third source block contains testable concepts; pages 1 and 2 are title and outline slides...",
      "Only 6 questions from this batch",
      "Only 2 questions could be supported; the page 83 and Chapter 7 title blocks lack testable concepts",
      "The source blocks contain only a title page, a chapter outline, and learning objectives...",
      "Q6 stem wording is awkward; the arithmetic is correct",
    ];

    for (const warning of complianceWarnings) {
      expect(isUserFacingWarning(warning)).toBe(false);
    }

    // Legitimate user-facing warnings are preserved
    expect(
      isUserFacingWarning(
        "Created 27 of 30 requested questions; the source or selected focus did not support more.",
      ),
    ).toBe(true);
    expect(
      isUserFacingWarning(
        "Tài liệu không có sẵn câu hỏi trắc nghiệm nguyên văn; hệ thống đã tự động chuyển sang chế độ Biến thể khái niệm.",
      ),
    ).toBe(true);
  });
});

