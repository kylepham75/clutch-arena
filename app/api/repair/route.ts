import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { getGenerationModel, getNoteSummarizerModel } from "@/lib/ai/provider";
import {
  questionMetadataSchema,
  type QuestionItem,
  type QuestionMetadata,
} from "@/lib/schemas/question";
import {
  noteFormulaVariableSchema,
  type NoteFormula,
} from "@/lib/schemas/notes";
import {
  deterministicRepairFormula,
  deterministicRepairQuestion,
  repairRequestSchema,
} from "./helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// POST Route Handler
// ============================================================================

export async function POST(req: Request) {
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed JSON request body." },
      { status: 400 },
    );
  }

  const parsed = repairRequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message || "Invalid request payload.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;

  if (data.kind === "question") {
    const detResult = deterministicRepairQuestion(
      data.question,
      data.metadata,
      data.sourceText,
    );

    let hallucinationDetected = detResult.changed;
    let summary = detResult.changed
      ? "Applied deterministic corrections to typography and LaTeX formatting."
      : "Question verified with no math or hallucination defects.";
    let fixedQuestion: QuestionItem = detResult.question;
    let fixedMetadata: QuestionMetadata | undefined = detResult.metadata;

    try {
      const model = getGenerationModel("contender", { reasoningEffort: "low" });
      const systemPrompt = `You are a rigorous academic fact-checker and mathematical verification engine for university economics and finance multiple-choice questions.
Your mission is to verify the arithmetic, algebra, answer options, correct answer index, explanation, and concept variant against the source slide text and student note.
If you detect an incorrect answer index, erroneous calculation, wrong sign, mislabelled distractors, or hallucinated claims:
1. Fix the question, options, correctIndex, and explanation so that the math is 100% mathematically correct and strictly consistent with the provided source text.
2. Fix the conceptVariant with matching precision.
3. Keep the original question ID strictly unchanged.
4. Set hallucinationDetected to true and summarize what was repaired. If the question was already mathematically correct, set hallucinationDetected to false.`;

      const prompt = `Verify and repair this question item against the authoritative source text and user report:

[QUESTION ITEM]
${JSON.stringify(detResult.question, null, 2)}

${detResult.metadata ? `[METADATA]\n${JSON.stringify(detResult.metadata, null, 2)}\n` : ""}
${data.sourceText ? `[AUTHORITATIVE SOURCE TEXT]\n${data.sourceText}\n` : ""}
${data.userNote ? `[STUDENT REPORT / NOTE]\n${data.userNote}\n` : ""}`;

      const questionOutputSchema = z.object({
        hallucinationDetected: z.boolean(),
        summary: z.string(),
        question: z.object({
          question: z.string(),
          options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
          correctIndex: z.number().int().min(0).max(3),
          explanation: z.string(),
          conceptVariant: z.object({
            question: z.string(),
            options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
            correctIndex: z.number().int().min(0).max(3),
            explanation: z.string(),
          }),
        }),
        metadata: questionMetadataSchema.optional(),
      });

      const res = await generateObject({
        model,
        schema: questionOutputSchema,
        system: systemPrompt,
        prompt,
      });

      if (res.object) {
        hallucinationDetected = res.object.hallucinationDetected;
        summary = res.object.summary;
        fixedQuestion = {
          ...res.object.question,
          id: data.question.id,
        };
        if (res.object.metadata) {
          fixedMetadata = res.object.metadata;
        }
      }
    } catch (err) {
      console.warn(
        "[app/api/repair] Question LLM verification failed or unconfigured, using deterministic fallback:",
        err,
      );
    }

    return NextResponse.json({
      ok: true,
      kind: "question",
      hallucinationDetected,
      summary,
      question: fixedQuestion,
      metadata: fixedMetadata,
    });
  }

  // data.kind === "note_formula"
  const detResult = deterministicRepairFormula(
    data.formula,
    data.sourceText,
  );

  let hallucinationDetected = detResult.changed;
  let summary = detResult.changed
    ? "Applied deterministic corrections to formula LaTeX and variables."
    : "Formula verified with no defects; status set to verified.";
  let fixedFormula: NoteFormula = detResult.formula;

  try {
    let model;
    try {
      model = getNoteSummarizerModel("contender");
    } catch {
      model = getGenerationModel("contender", { reasoningEffort: "low" });
    }

    const systemPrompt = `You are an expert mathematical and financial formula verification engine.
Verify the LaTeX equation, variable definitions, leadText, and description against the authoritative source text and student note.
If you detect an incorrect sign, mis-transcribed exponent or subscript, inverted fraction, or hallucinated variable:
1. Fix the LaTeX equation, variable definitions, and transition text so that it matches authoritative mathematical truth and source slides.
2. Ensure status is "verified" and reviewReason is undefined.
3. Set hallucinationDetected to true and summarize the repair. If the formula is already correct, set hallucinationDetected to false.`;

    const prompt = `Verify and repair this study note formula against the authoritative source text and user report:

[FORMULA]
${JSON.stringify(detResult.formula, null, 2)}

${data.sectionTitle ? `[SECTION TITLE]\n${data.sectionTitle}\n` : ""}
${data.sourceText ? `[AUTHORITATIVE SOURCE TEXT]\n${data.sourceText}\n` : ""}
${data.userNote ? `[STUDENT REPORT / NOTE]\n${data.userNote}\n` : ""}`;

    const formulaOutputSchema = z.object({
      hallucinationDetected: z.boolean(),
      summary: z.string(),
      formula: z.object({
        name: z.string().optional().default(""),
        leadText: z.string().optional().default(""),
        latex: z.string(),
        description: z.string().optional().default(""),
        variables: z.array(noteFormulaVariableSchema).default([]),
      }),
    });

    const res = await generateObject({
      model,
      schema: formulaOutputSchema,
      system: systemPrompt,
      prompt,
    });

    if (res.object) {
      hallucinationDetected = res.object.hallucinationDetected;
      summary = res.object.summary;
      fixedFormula = {
        ...detResult.formula,
        name: res.object.formula.name ?? detResult.formula.name,
        leadText: res.object.formula.leadText ?? detResult.formula.leadText,
        latex: res.object.formula.latex,
        description:
          res.object.formula.description ?? detResult.formula.description,
        variables: res.object.formula.variables ?? detResult.formula.variables,
        status: "verified",
        reviewReason: undefined,
      };
    }
  } catch (err) {
    console.warn(
      "[app/api/repair] Note formula LLM verification failed or unconfigured, using deterministic fallback:",
      err,
    );
  }

  return NextResponse.json({
    ok: true,
    kind: "note_formula",
    hallucinationDetected,
    summary,
    formula: fixedFormula,
  });
}
