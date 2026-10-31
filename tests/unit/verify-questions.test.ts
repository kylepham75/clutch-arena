import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";

vi.mock("server-only", () => ({}));

const { generateObjectMock, applyFinanceSolverSpy } = vi.hoisted(() => ({
  generateObjectMock: vi.fn(),
  applyFinanceSolverSpy: vi.fn(),
}));

vi.mock("@/lib/math/finance-solver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/math/finance-solver")>();
  return {
    ...actual,
    applyFinanceSolverToItem: vi.fn(
      (...args: Parameters<typeof actual.applyFinanceSolverToItem>) => {
        applyFinanceSolverSpy(...args);
        return actual.applyFinanceSolverToItem(...args);
      },
    ),
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: generateObjectMock,
  };
});

import {
  blindVerificationBatchSchema,
  CONCEPT_VARIANT_ID_SUFFIX,
  filterBlindVerifiedQuestions,
  getConceptVariantBlindId,
  stripAnswerKeyForBlindSolve,
  verifyQuestionsBlindly,
  type VerifiableQuestionInput,
} from "@/lib/ai/verify-questions";
import { generateQuestions } from "@/lib/ai/generate-questions";
import {
  ingestionOptionsSchema,
  type ParsedDocument,
} from "@/lib/schemas/ingestion";

const SAMPLE_QUESTIONS: VerifiableQuestionInput[] = [
  {
    id: "q-1",
    question: "What is the primary goal of corporate financial management?",
    options: [
      "Maximize current year accounting profit",
      "Maximize shareholder wealth",
      "Minimize total tax liability at all costs",
      "Maximize total headcount",
    ],
    correctIndex: 1,
    explanation:
      "Corporate finance theory states that the primary goal is maximizing shareholder wealth (firm value).",
    quote: "The goal of financial management is to maximize the current value per share.",
    excerpt: "Slide 4: Shareholder wealth maximization",
    financeSpec: { type: "conceptual", SecretAnswerHint: "Option B" },
    sourceId: "slide-4",
    conceptVariant: {
      question:
        "Which objective best aligns managers with long-term stockholders?",
      options: [
        "Increasing long-term intrinsic value per share",
        "Maximizing short-term EPS only",
        "Eliminating all R&D spending",
        "Avoiding all external financing",
      ],
      correctIndex: 0,
      explanation:
        "Intrinsic value per share reflects long-term shareholder wealth.",
      quote: "Maximize intrinsic stock value.",
      excerpt: "Slide 4 variant excerpt",
    },
  },
  {
    id: "q-2",
    question: "Which financial statement reports a firm's assets at a point in time?",
    options: [
      "Income Statement",
      "Statement of Cash Flows",
      "Balance Sheet",
      "Statement of Retained Earnings",
    ],
    correctIndex: 2,
    explanation: "The balance sheet is a snapshot of assets, liabilities, and equity.",
    quote: "Balance sheet shows financial position at a point in time.",
    conceptVariant: {
      question: "Where are total liabilities and shareholder equity reported at quarter-end?",
      options: [
        "Balance Sheet",
        "Income Statement",
        "Proxy Statement",
        "Audit Opinion",
      ],
      correctIndex: 0,
      explanation: "Assets = Liabilities + Equity on the Balance Sheet.",
    },
  },
  {
    id: "q-3",
    question: "Under ambiguous assumptions, which discount rate applies?",
    options: ["5%", "8%", "10%", "12%"],
    correctIndex: 1,
    explanation: "Secret explanation that says 8% is the answer.",
    quote: "Hidden quote revealing 8%",
    conceptVariant: {
      question: "What is the fallback rate?",
      options: ["5%", "8%", "10%", "12%"],
      correctIndex: 1,
      explanation: "8% fallback.",
    },
  },
];

describe("Cross-Family Blind MCQ Verification (lib/ai/verify-questions.ts)", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    applyFinanceSolverSpy.mockClear();
  });

  describe("stripAnswerKeyForBlindSolve", () => {
    it("strips correctIndex, explanation, quote, excerpt, and financeSpec from base items and conceptVariants", () => {
      const stripped = stripAnswerKeyForBlindSolve(SAMPLE_QUESTIONS, {
        sourcesById: {
          "slide-4": "Financial management focuses on shareholder value creation.",
        },
      });

      expect(stripped).toHaveLength(6); // 3 base + 3 conceptVariants

      for (const item of stripped) {
        const keys = Object.keys(item);
        expect(keys).not.toContain("correctIndex");
        expect(keys).not.toContain("explanation");
        expect(keys).not.toContain("quote");
        expect(keys).not.toContain("excerpt");
        expect(keys).not.toContain("financeSpec");
        expect(keys).not.toContain("conceptVariant");

        for (const k of keys) {
          expect(["id", "question", "options", "sourceText"]).toContain(k);
        }
      }

      expect(stripped[0]).toEqual({
        id: "q-1",
        question: "What is the primary goal of corporate financial management?",
        options: [
          "Maximize current year accounting profit",
          "Maximize shareholder wealth",
          "Minimize total tax liability at all costs",
          "Maximize total headcount",
        ],
        sourceText: "Financial management focuses on shareholder value creation.",
      });

      expect(stripped[1]).toEqual({
        id: `q-1${CONCEPT_VARIANT_ID_SUFFIX}`,
        question:
          "Which objective best aligns managers with long-term stockholders?",
        options: [
          "Increasing long-term intrinsic value per share",
          "Maximizing short-term EPS only",
          "Eliminating all R&D spending",
          "Avoiding all external financing",
        ],
        sourceText: "Financial management focuses on shareholder value creation.",
      });
    });

    it("ensures prompt sent to generateObject contains zero answer key, explanation, or quote leakage", async () => {
      const fakeVerifierModel = {
        modelId: "anthropic/claude-sonnet-5.5",
      } as unknown as LanguageModel;

      generateObjectMock.mockResolvedValueOnce({
        object: {
          verdicts: [
            {
              id: "q-1",
              selectedIndex: 1,
              isAmbiguous: false,
              confidence: "high",
              reason: "Shareholder wealth maximization is standard.",
            },
            {
              id: getConceptVariantBlindId("q-1"),
              selectedIndex: 0,
              isAmbiguous: false,
              confidence: "high",
              reason: "Intrinsic value per share aligns with long-term holders.",
            },
          ],
        },
        usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165 },
      });

      await verifyQuestionsBlindly([SAMPLE_QUESTIONS[0]], {
        generatorSlug: "google/gemini-3.6-flash",
        verifierSlug: "anthropic/claude-sonnet-5.5",
        verifierModel: fakeVerifierModel,
      });

      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      const callArgs = generateObjectMock.mock.calls[0][0];

      expect(callArgs.temperature).toBe(0.0);
      expect(callArgs.prompt).not.toContain("correctIndex");
      expect(callArgs.prompt).not.toContain("explanation");
      expect(callArgs.prompt).not.toContain(
        "Corporate finance theory states that the primary goal",
      );
      expect(callArgs.prompt).not.toContain(
        "The goal of financial management is to maximize the current value per share.",
      );
      expect(callArgs.prompt).not.toContain("Slide 4: Shareholder wealth maximization");
      expect(callArgs.prompt).not.toContain("SecretAnswerHint");
    });
  });

  describe("blindVerificationBatchSchema", () => {
    it("validates well-formed blind verification verdicts and defaults confidence to high", () => {
      const parsed = blindVerificationBatchSchema.parse({
        verdicts: [
          {
            id: "q-1",
            selectedIndex: 2,
            isAmbiguous: false,
            reason: "Option C directly matches the definition.",
          },
          {
            id: "q-2",
            selectedIndex: -1,
            isAmbiguous: true,
            confidence: "low",
            reason: "Stem omits the compounding frequency.",
          },
        ],
      });

      expect(parsed.verdicts[0].confidence).toBe("high");
      expect(parsed.verdicts[1].selectedIndex).toBe(-1);
      expect(parsed.verdicts[1].isAmbiguous).toBe(true);
    });
  });

  describe("Cross-Family Guard & Fallback Verifier", () => {
    it("rejects same-family generator and verifier slugs", async () => {
      const fakeVerifierModel = {
        modelId: "google/gemini-4-argon",
      } as unknown as LanguageModel;

      await expect(
        verifyQuestionsBlindly([SAMPLE_QUESTIONS[0]], {
          generatorSlug: "google/gemini-3.6-flash",
          verifierSlug: "google/gemini-4-argon",
          verifierModel: fakeVerifierModel,
        }),
      ).rejects.toThrow(/cannot be in the same model family/i);

      expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("falls back to non-generator family verifier with temperature 0.0 when primary verifier fails", async () => {
      const primaryModel = {
        modelId: "anthropic/claude-sonnet-5.5",
      } as unknown as LanguageModel;
      const fallbackModel = {
        modelId: "openai/gpt-6.1-terra",
      } as unknown as LanguageModel;

      generateObjectMock
        .mockRejectedValueOnce(new Error("Anthropic upstream 503 overloaded"))
        .mockResolvedValueOnce({
          object: {
            verdicts: [
              {
                id: "q-1",
                selectedIndex: 1,
                isAmbiguous: false,
                confidence: "high",
                reason: "Option B is standard.",
              },
              {
                id: getConceptVariantBlindId("q-1"),
                selectedIndex: 0,
                isAmbiguous: false,
                confidence: "high",
                reason: "Option A aligns with shareholder wealth.",
              },
            ],
          },
          providerMetadata: {
            openrouter: {
              model: "openai/gpt-6.1-terra-2026",
              cost: 0.0018,
            },
          },
          usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        });

      const result = await verifyQuestionsBlindly([SAMPLE_QUESTIONS[0]], {
        generatorSlug: "google/gemini-3.6-flash",
        verifierSlug: "anthropic/claude-sonnet-5.5",
        fallbackVerifierSlug: "openai/gpt-6.1-terra",
        verifierModel: primaryModel,
        fallbackVerifierModel: fallbackModel,
      });

      expect(generateObjectMock).toHaveBeenCalledTimes(2);
      expect(generateObjectMock.mock.calls[0][0].model).toBe(primaryModel);
      expect(generateObjectMock.mock.calls[0][0].temperature).toBe(0.0);
      expect(generateObjectMock.mock.calls[1][0].model).toBe(fallbackModel);
      expect(generateObjectMock.mock.calls[1][0].temperature).toBe(0.0);

      expect(result.verifiedIds).toEqual(["q-1"]);
      expect(result.droppedIds).toEqual([]);
      expect(result.servedVerifierModel).toBe("openai/gpt-6.1-terra-2026");
      expect(result.costUsd).toBeCloseTo(0.0018, 6);
    });

    it("rejects fallback verifier if fallback slug is in the same family as the generator", async () => {
      const primaryModel = {
        modelId: "anthropic/claude-sonnet-5.5",
      } as unknown as LanguageModel;
      const badFallbackModel = {
        modelId: "google/gemini-4-argon",
      } as unknown as LanguageModel;

      generateObjectMock.mockRejectedValueOnce(
        new Error("Primary verifier timeout"),
      );

      await expect(
        verifyQuestionsBlindly([SAMPLE_QUESTIONS[0]], {
          generatorSlug: "google/gemini-3.6-flash",
          verifierSlug: "anthropic/claude-sonnet-5.5",
          fallbackVerifierSlug: "google/gemini-4-argon",
          verifierModel: primaryModel,
          fallbackVerifierModel: badFallbackModel,
        }),
      ).rejects.toThrow(/cannot be in the same model family/i);

      expect(generateObjectMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Silent Drop Filter & End-to-End Verification", () => {
    it("silently drops questions with mismatched selectedIndex or isAmbiguous: true while keeping agreed items", async () => {
      const fakeVerifierModel = {
        modelId: "anthropic/claude-sonnet-5.5",
      } as unknown as LanguageModel;

      generateObjectMock.mockResolvedValueOnce({
        object: {
          verdicts: [
            // q-1 agrees on both base and variant -> KEEP
            {
              id: "q-1",
              selectedIndex: 1,
              isAmbiguous: false,
              confidence: "high",
              reason: "Clear match on option 1.",
            },
            {
              id: getConceptVariantBlindId("q-1"),
              selectedIndex: 0,
              isAmbiguous: false,
              confidence: "high",
              reason: "Clear match on option 0.",
            },
            // q-2 disagrees on selectedIndex (chooses 0 instead of 2) -> DROP
            {
              id: "q-2",
              selectedIndex: 0,
              isAmbiguous: false,
              confidence: "medium",
              reason: "Selected option 0.",
            },
            {
              id: getConceptVariantBlindId("q-2"),
              selectedIndex: 0,
              isAmbiguous: false,
              confidence: "high",
              reason: "Selected option 0.",
            },
            // q-3 matches selectedIndex=1 but isAmbiguous=true -> DROP
            {
              id: "q-3",
              selectedIndex: 1,
              isAmbiguous: true,
              confidence: "low",
              reason: "Multiple discount rates are defensible without WACC context.",
            },
            {
              id: getConceptVariantBlindId("q-3"),
              selectedIndex: 1,
              isAmbiguous: false,
              confidence: "high",
              reason: "Fallback rate.",
            },
          ],
        },
        usage: { inputTokens: 250, outputTokens: 90, totalTokens: 340 },
      });

      const result = await verifyQuestionsBlindly(SAMPLE_QUESTIONS, {
        generatorSlug: "google/gemini-3.6-flash",
        verifierSlug: "anthropic/claude-sonnet-5.5",
        verifierModel: fakeVerifierModel,
      });

      // Zero retries on failed items: generateObject called exactly once
      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      expect(result.verifiedIds).toEqual(["q-1"]);
      expect(result.droppedIds).toEqual(["q-2", "q-3"]);
      expect(result.verifiedQuestions).toHaveLength(1);
      expect(result.verifiedQuestions[0].id).toBe("q-1");
    });

    it("drops a question if its conceptVariant fails blind verification even when base stem passes", () => {
      const filtered = filterBlindVerifiedQuestions([SAMPLE_QUESTIONS[0]], [
        {
          id: "q-1",
          selectedIndex: 1,
          isAmbiguous: false,
          confidence: "high",
          reason: "Base stem is valid.",
        },
        {
          id: getConceptVariantBlindId("q-1"),
          selectedIndex: 2, // Mismatches conceptVariant.correctIndex (0)
          isAmbiguous: false,
          confidence: "high",
          reason: "Variant stem points to option 2.",
        },
      ]);

      expect(filtered.verifiedIds).toEqual([]);
      expect(filtered.droppedIds).toEqual(["q-1"]);
    });

    it("supports skipSolverComputed fast-path without invoking LLM when all items are solverComputed", async () => {
      const solverQuestion: VerifiableQuestionInput = {
        ...SAMPLE_QUESTIONS[0],
        id: "q-solver-1",
        solverComputed: true,
        conceptVariant: {
          ...SAMPLE_QUESTIONS[0].conceptVariant!,
          solverComputed: true,
        },
      };

      const result = await verifyQuestionsBlindly([solverQuestion], {
        generatorSlug: "google/gemini-3.6-flash",
        verifierSlug: "anthropic/claude-sonnet-5.5",
        skipSolverComputed: true,
      });

      expect(generateObjectMock).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
      expect(result.verifiedIds).toEqual(["q-solver-1"]);
      expect(result.droppedIds).toEqual([]);
    });

    it("runs applyFinanceSolverToItem exactly once per item through the blind verification pipeline", async () => {
      const document: ParsedDocument = {
        fileName: "notes.txt",
        format: "txt",
        sources: [
          {
            id: "lines-1-1",
            label: "Lines 1–1",
            text: "A 5-year bond with a 5% coupon pays annually on a $1000 face value.",
          },
        ],
        characterCount: 68,
        pageCount: null,
        warnings: [],
      };

      const options = ingestionOptionsSchema.parse({
        questionCount: 1,
      });

      const bondSpec = {
        solver: "bond_price" as const,
        params: {
          faceValue: 1000,
          couponRate: 0.05,
          rate: 0.05,
          nper: 5,
          frequency: 1,
        },
        unit: "$" as const,
        decimals: 2,
      };

      const generatorModel = {
        modelId: "google/gemini-3.6-flash",
      } as unknown as LanguageModel;

      const verifierModel = {
        modelId: "anthropic/claude-sonnet-5.5",
      } as unknown as LanguageModel;

      generateObjectMock
        .mockResolvedValueOnce({
          object: {
            title: "Bond Pricing",
            sourceKind: "lecture",
            questions: [
              {
                id: "bond-1",
                question: "What is the price of the bond?",
                options: ["$950.00", "$980.00", "$1,000.00", "$1,050.00"],
                correctIndex: 2,
                explanation: "Par bond trades at face value.",
                financeSpec: bondSpec,
                conceptVariant: {
                  question: "At par yield, what does the bond trade for?",
                  options: [
                    "$500.00",
                    "$1,000.00",
                    "$1,500.00",
                    "$2,000.00",
                  ],
                  correctIndex: 1,
                  explanation: "Trading at par value.",
                  financeSpec: bondSpec,
                },
              },
            ],
            annotations: [
              {
                questionId: "bond-1",
                sourceId: "lines-1-1",
                excerpt:
                  "A 5-year bond with a 5% coupon pays annually on a $1000 face value.",
                topic: "Bonds",
                chapter: "Chapter 7",
                rule: "Coupon = yield means price = par.",
              },
            ],
            warnings: [],
          },
          usage: { inputTokens: 60, outputTokens: 60, totalTokens: 120 },
        })
        .mockResolvedValueOnce({
          object: {
            verdicts: [
              {
                id: "bond-1",
                selectedIndex: 0,
                isAmbiguous: false,
                confidence: "high",
                reason: "Calculated par value.",
              },
              {
                id: getConceptVariantBlindId("bond-1"),
                selectedIndex: 0,
                isAmbiguous: false,
                confidence: "high",
                reason: "Variant calculated par value.",
              },
            ],
          },
          usage: { inputTokens: 40, outputTokens: 40, totalTokens: 80 },
        });

      applyFinanceSolverSpy.mockClear();

      const result = await generateQuestions(
        document,
        options,
        new AbortController().signal,
        generatorModel,
        { verifierModel, skipSolverComputed: false },
      );

      expect(result.pack.questions).toHaveLength(1);
      // Both base and conceptVariant have financeSpec: each must be solved exactly once (total 2 invocations)
      expect(applyFinanceSolverSpy).toHaveBeenCalledTimes(2);
    });
  });
});
