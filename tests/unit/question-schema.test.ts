import { describe, expect, it } from "vitest";
import { questionBankSchema, questionSchema } from "@/lib/schemas/question";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
describe("question contract", () => {
  it("provides five valid, unique microeconomics questions and variants", () => {
    expect(questionBankSchema.parse(mockMicroeconomics.questions)).toHaveLength(
      5,
    );
  });
  it("rejects a fifth option, missing variants, snake_case fields, and invalid answer indexes", () => {
    const q = mockMicroeconomics.questions[0];
    for (const invalid of [
      { ...q, options: [...q.options, "Extra"] },
      { ...q, conceptVariant: undefined },
      { ...q, correct_index: 1 },
      { ...q, correctIndex: 4 },
    ])
      expect(questionSchema.safeParse(invalid).success).toBe(false);
  });
  it("rejects empty banks and duplicate IDs", () => {
    expect(questionBankSchema.safeParse([]).success).toBe(false);
    expect(
      questionBankSchema.safeParse([
        mockMicroeconomics.questions[0],
        mockMicroeconomics.questions[0],
      ]).success,
    ).toBe(false);
  });
});
