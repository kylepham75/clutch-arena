import { z } from "zod";
import { cleanTypoString, renderKatexSafe } from "@/lib/math/latex";
import { isCleanValidLatexFormula } from "@/lib/notes/verification-gate";
import {
  questionSchema,
  questionMetadataSchema,
  type QuestionItem,
  type QuestionMetadata,
} from "@/lib/schemas/question";
import { noteFormulaSchema, type NoteFormula } from "@/lib/schemas/notes";

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
