import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { APICallError, type LanguageModel } from "ai";
import {
  generateQuestions,
  validateGeneratedStudy,
  splitIntoBatchCounts,
  partitionSourcesAcrossBatches,
} from "@/lib/ai/generate-questions";
import { getGenerationModel } from "@/lib/ai/provider";
import {
  ingestionOptionsSchema,
  type ParsedDocument,
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
});
