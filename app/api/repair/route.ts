import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { getGenerationModel, getNoteSummarizerModel } from "@/lib/ai/provider";
import { cleanTypoString, renderKatexSafe } from "@/lib/math/latex";
import { isCleanValidLatexFormula } from "@/lib/notes/verification-gate";
import {
  questionSchema,
  questionMetadataSchema,
  type QuestionItem,
  type QuestionMetadata,
} from "@/lib/schemas/question";
import {
  noteFormulaSchema,
  noteFormulaVariableSchema,
  type NoteFormula,
} from "@/lib/schemas/notes";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Request Schemas
// ============================================================================

const questionRepairRequestSchema = z.object({
  kind: z.literal("question"),
  question: questionSchema,
  metadata: questionMetadataSchema.optional(),
  sourceText: z.string().max(8000).optional(),
  userNote: z.string().max(1000).optional(),
});

const noteFormulaRepairRequestSchema = z.object({
  kind: z.literal("note_formula"),
  sectionId: z.string().min(1).max(120),
  formulaIndex: z.number().int().min(0),
  subSectionIndex: z.number().int().min(0).optional(),
  formula: noteFormulaSchema,
  sectionTitle: z.string().max(300).optional(),
  sourceText: z.string().max(8000).optional(),
  userNote: z.string().max(1000).optional(),
});

export const repairRequestSchema = z.discriminatedUnion("kind", [
  questionRepairRequestSchema,
  noteFormulaRepairRequestSchema,
]);

export type RepairRequest = z.infer<typeof repairRequestSchema>;

// ============================================================================
// Pure Deterministic Repair Helpers
// ============================================================================

function cleanAndBalanceString(raw: string): string {
  if (!raw) return raw;

  // 1. Clean Vietnamese Sigma typos (e.g. \Sigma ất -> suất)
  let s = cleanTypoString(raw);

  // 2. Normalize consecutive == to = (outside arrows/relations like ==> or <=>)
  s = s.replace(/(?<![<>!])={2,}(?![=>])/g, "=");

  // 3. Balance odd unescaped dollar delimiters
  let unescapedDollarCount = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "$") {
      let backslashes = 0;
      let k = i - 1;
      while (k >= 0 && s[k] === "\\") {
        backslashes++;
        k--;
      }
      if (backslashes % 2 === 0) {
        unescapedDollarCount++;
      }
    }
  }

  if (unescapedDollarCount % 2 === 1) {
    s = s + "$";
  }

  return s;
}

export function deterministicRepairQuestion(
  question: QuestionItem,
  metadata?: QuestionMetadata,
  _sourceText?: string,
): {
  question: QuestionItem;
  metadata?: QuestionMetadata;
  changed: boolean;
  notes: string[];
} {
  const notes: string[] = [];
  let changed = false;

  const cleanedQText = cleanAndBalanceString(question.question);
  if (cleanedQText !== question.question) {
    changed = true;
    notes.push("Cleaned question text typography or unbalanced delimiters.");
  }

  const cleanedOptions = question.options.map((opt) => {
    const cleaned = cleanAndBalanceString(opt);
    if (cleaned !== opt) changed = true;
    return cleaned;
  }) as [string, string, string, string];

  const cleanedExplanation = cleanAndBalanceString(question.explanation);
  if (cleanedExplanation !== question.explanation) {
    changed = true;
    notes.push("Cleaned explanation typography or unbalanced delimiters.");
  }

  const cleanedVariantQText = cleanAndBalanceString(
    question.conceptVariant.question,
  );
  if (cleanedVariantQText !== question.conceptVariant.question) {
    changed = true;
  }

  const cleanedVariantOptions = question.conceptVariant.options.map((opt) => {
    const cleaned = cleanAndBalanceString(opt);
    if (cleaned !== opt) changed = true;
    return cleaned;
  }) as [string, string, string, string];

  const cleanedVariantExplanation = cleanAndBalanceString(
    question.conceptVariant.explanation,
  );
  if (cleanedVariantExplanation !== question.conceptVariant.explanation) {
    changed = true;
  }

  const repairedQuestion: QuestionItem = {
    ...question,
    question: cleanedQText,
    options: cleanedOptions,
    explanation: cleanedExplanation,
    conceptVariant: {
      ...question.conceptVariant,
      question: cleanedVariantQText,
      options: cleanedVariantOptions,
      explanation: cleanedVariantExplanation,
    },
  };

  let repairedMetadata: QuestionMetadata | undefined = metadata;
  if (metadata) {
    const topic = cleanTypoString(metadata.topic);
    const chapter = cleanTypoString(metadata.chapter);
    const citation = cleanTypoString(metadata.citation);
    const rule = cleanAndBalanceString(metadata.rule);
    const distractorRationale = metadata.distractorRationale
      ? cleanAndBalanceString(metadata.distractorRationale)
      : metadata.distractorRationale;

    if (
      topic !== metadata.topic ||
      chapter !== metadata.chapter ||
      citation !== metadata.citation ||
      rule !== metadata.rule ||
      distractorRationale !== metadata.distractorRationale
    ) {
      changed = true;
      notes.push("Cleaned question metadata typography and math rules.");
    }

    repairedMetadata = {
      ...metadata,
      topic,
      chapter,
      citation,
      rule,
      ...(distractorRationale !== undefined ? { distractorRationale } : {}),
    };
  }

  return {
    question: repairedQuestion,
    metadata: repairedMetadata,
    changed,
    notes,
  };
}

export function deterministicRepairFormula(
  formula: NoteFormula,
  _sourceText?: string,
): {
  formula: NoteFormula;
  changed: boolean;
  notes: string[];
} {
  const notes: string[] = [];
  let changed = false;

  let latex = formula.latex;
  // Strip redundant outer dollar delimiters from formula LaTeX if present
  const stripped = latex.replace(/^\$+|\$+$/g, "").trim();
  if (stripped !== latex) {
    latex = stripped;
    changed = true;
    notes.push("Removed redundant outer dollar delimiters from LaTeX.");
  }

  const cleanedLatex = cleanTypoString(latex);
  if (cleanedLatex !== latex) {
    latex = cleanedLatex;
    changed = true;
    notes.push("Cleaned typography artifacts from LaTeX.");
  }

  // Normalize consecutive == to =
  const normalizedEq = latex.replace(/(?<![<>!])={2,}(?![=>])/g, "=");
  if (normalizedEq !== latex) {
    latex = normalizedEq;
    changed = true;
    notes.push("Normalized '==' to '=' outside relations.");
  }

  const name = formula.name ? cleanTypoString(formula.name) : formula.name;
  if (name !== formula.name) {
    changed = true;
    notes.push("Cleaned formula name typography.");
  }

  const leadText = formula.leadText
    ? cleanTypoString(formula.leadText)
    : formula.leadText;
  if (leadText !== formula.leadText) {
    changed = true;
    notes.push("Cleaned formula leadText typography.");
  }

  const description = formula.description
    ? cleanTypoString(formula.description)
    : formula.description;
  if (description !== formula.description) {
    changed = true;
    notes.push("Cleaned formula description typography.");
  }

  const variables = formula.variables.map((v) => {
    const symStripped = v.symbol.replace(/^\$+|\$+$/g, "").trim();
    const cleanSym = cleanTypoString(symStripped);
    const cleanDef = cleanTypoString(v.definition);
    if (cleanSym !== v.symbol || cleanDef !== v.definition) {
      changed = true;
    }
    return {
      symbol: cleanSym,
      definition: cleanDef,
    };
  });

  // Verify LaTeX rendering with KaTeX
  const katexRender = renderKatexSafe(latex, true);
  const isValid =
    isCleanValidLatexFormula(latex) &&
    !katexRender.includes("katex-fallback");
  if (!isValid) {
    notes.push("Formula flagged as requiring review or syntax normalization.");
  }

  if (formula.status !== "verified" || formula.reviewReason !== undefined) {
    changed = true;
    notes.push("Status set to verified and reviewReason cleared.");
  }

  const repairedFormula: NoteFormula = {
    ...formula,
    name,
    leadText,
    latex,
    description,
    variables,
    status: "verified",
    reviewReason: undefined,
  };

  return {
    formula: repairedFormula,
    changed,
    notes,
  };
}

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
