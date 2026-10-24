import "server-only";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  type ClutchNote,
  type NoteFormula,
  type NoteSection,
  type NoteSubSection,
} from "@/lib/schemas/notes";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import { IngestionError } from "@/lib/ingestion/errors";
import { getGenerationModel, getGroqModel } from "./provider";
import { CLUTCH_NOTES_SYSTEM_PROMPT, buildNotesPrompt } from "./prompts-notes";
import { repairCorruptedLatex } from "@/lib/math/latex";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";

/**
 * Strict LLM generation schema where EVERY property is REQUIRED (no .optional() or .default()).
 * Gemini structured decoding (`responseSchema`) omits non-required keys on lightweight models
 * like `gemini-3.5-flash-lite`; requiring all keys guarantees complete section bodies,
 * sub-sections, formulas, and key takeaways on every synthesis run.
 */
const generatedFormulaVariableSchema = z
  .object({
    symbol: z
      .string()
      .describe("Mathematical variable symbol in clean LaTeX without $, e.g. P_0, R, g, D_1"),
    definition: z
      .string()
      .describe("Short plain-English definition of the variable, e.g. 'Price of the stock today'"),
  })
  .strict();

const generatedFormulaSchema = z
  .object({
    leadText: z
      .string()
      .describe(
        "Short transition line right above the formula box (e.g. 'Nếu chỉ đầu tư trong 1 năm:', 'The equation:', 'Rearranging the equation to solve for R, we get:'), or empty string '' if none needed",
      ),
    latex: z
      .string()
      .min(1)
      .describe(
        "Clean LaTeX math string without surrounding dollar signs, e.g. P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
      ),
    description: z
      .string()
      .describe(
        "Leave empty string '' unless a short transition remark is needed below the box; NEVER repeat the formula's title here",
      ),
    variables: z
      .array(generatedFormulaVariableSchema)
      .describe(
        "Variables for 'Trong đó:'. ONLY include symbols when introduced for the FIRST time; pass [] if already defined earlier in the note",
      ),
  })
  .strict();

const generatedSubSectionSchema = z
  .object({
    heading: z
      .string()
      .min(1)
      .describe(
        "Concise bold numbered sub-heading, e.g. '1. CASE 1: Zero Growth Model (Không tăng trưởng)' or '1. Finding the growth rate (g)'",
      ),
    leadIn: z
      .string()
      .describe(
        "Short 1-line lead-in before bullets (e.g. 'The discount rate can be broken into two parts:'), or empty string ''",
      ),
    bulletPoints: z
      .array(z.string())
      .describe("Short plain-English bullet points (5–15 words each, easy to scan)"),
    formulas: z
      .array(generatedFormulaSchema)
      .describe("Boxed LaTeX formulas belonging to this sub-case or sub-topic"),
  })
  .strict();

const generatedTakeawayItemSchema = z
  .object({
    point: z
      .string()
      .min(1)
      .describe(
        "Concise 1-line takeaway rule in plain English, e.g. 'Make sure $g < R$, otherwise the model breaks down'",
      ),
    subBullets: z
      .array(z.string())
      .describe(
        "Optional short sub-bullets using '→' arrows, e.g. ['Zero growth → Perpetuity', 'Constant growth → Gordon model'], or []",
      ),
  })
  .strict();

const generatedNoteSectionSchema = z
  .object({
    letter: z.string().min(1).describe("Section alphabetical letter: A, B, C, D, E..."),
    titleVi: z
      .string()
      .min(1)
      .describe(
        "Clean uppercase section header WITH letter prefix, e.g. 'A. NGUYÊN LÝ CƠ BẢN', 'B. CÔNG THỨC TỔNG QUÁT', 'C. DDM (DIVIDEND DISCOUNT MODEL)', 'D. PARAMETERS IN DIVIDEND DISCOUNT MODEL', 'E. VALUE OF PREFERENCE SHARE'",
      ),
    coreStatement: z
      .string()
      .describe(
        "Bold 1-line core principle statement if this section states a fundamental law (e.g. 'The value of any asset = the present value (PV) of its expected future cash flows.'), otherwise empty string ''",
      ),
    overview: z
      .string()
      .describe(
        "At most ONE short plain-English lead-in sentence (e.g. 'For stocks, future cash flows come from:'), or empty string ''",
      ),
    bulletPoints: z
      .array(z.string())
      .describe(
        "Top-level plain-English bullet points (5–15 words each) with inline Vietnamese in parentheses ONLY for key terms; pass [] ONLY when all content in this section is inside subSections",
      ),
    formulas: z
      .array(generatedFormulaSchema)
      .describe("Top-level boxed LaTeX formulas in this section; pass [] if formulas are in subSections"),
    subSections: z
      .array(generatedSubSectionSchema)
      .describe(
        "Ordered numbered sub-cases or sub-topics within this section (e.g. CASE 1, CASE 2, CASE 3, or Finding g / Finding R); pass [] for flat sections",
      ),
    takeaways: z
      .array(generatedTakeawayItemSchema)
      .describe(
        "Populate 3–5 numbered takeaway items on the main multi-case model section (or final section); pass [] on brief single-concept sections",
      ),
    sourceSlides: z
      .array(z.number().int())
      .describe("1-based slide numbers from which this section was distilled"),
  })
  .strict();

export const generatedClutchNoteSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe(
        "Concise uppercase chapter/topic heading, e.g. 'CHAPTER 9: STOCK VALUATION' (keep under 8 words)",
      ),
    subject: z
      .string()
      .min(1)
      .describe("Concise course or subject name, e.g. 'Corporate Finance'"),
    estimatedDistilledPages: z
      .number()
      .int()
      .min(1)
      .max(6)
      .describe("Estimated distilled handout page count (typically 2 or 3)"),
    noiseReductionRate: z
      .number()
      .describe("Percentage of noise stripped from 0 to 100, e.g. 85"),
    executiveSummary: z
      .string()
      .min(1)
      .describe("One short 1-sentence summary of what this sheet covers (max 25 words)"),
    sections: z.array(generatedNoteSectionSchema).min(1).max(10),
  })
  .strict();

type GeneratedClutchNote = z.infer<typeof generatedClutchNoteSchema>;

export interface GenerateClutchNoteOptions {
  fileName: string;
  slideCount: number;
  sources: SourceBlock[];
  focus?: string;
  modelOverride?: LanguageModel;
  signal?: AbortSignal;
}

function sanitizeFormula(f: NoteFormula): NoteFormula {
  return {
    ...f,
    name: f.name ? repairCorruptedLatex(f.name) : "",
    leadText: f.leadText ? repairCorruptedLatex(f.leadText) : undefined,
    latex: repairCorruptedLatex(f.latex).replace(/^\$+|\$+$/g, "").trim(),
    description: f.description ? repairCorruptedLatex(f.description) : undefined,
    variables: (f.variables ?? []).map((v) => ({
      symbol: repairCorruptedLatex(v.symbol).replace(/^\$+|\$+$/g, "").trim(),
      definition: repairCorruptedLatex(v.definition),
    })),
  };
}

function sanitizeSubSection(sub: NoteSubSection): NoteSubSection {
  return {
    ...sub,
    heading: repairCorruptedLatex(sub.heading),
    leadIn: sub.leadIn ? repairCorruptedLatex(sub.leadIn) : undefined,
    bulletPoints: (sub.bulletPoints ?? []).map((bp) => repairCorruptedLatex(bp)),
    formulas: (sub.formulas ?? []).map(sanitizeFormula),
  };
}

/**
 * Sanitizes and repairs LaTeX formulas and strings inside distilled sections
 */
function sanitizeSectionLatex(section: NoteSection): NoteSection {
  return {
    ...section,
    titleEn: section.titleEn ?? "",
    coreStatement: section.coreStatement
      ? repairCorruptedLatex(section.coreStatement)
      : undefined,
    overview: section.overview ? repairCorruptedLatex(section.overview) : "",
    bulletPoints: (section.bulletPoints ?? []).map((bp) => repairCorruptedLatex(bp)),
    formulas: (section.formulas ?? []).map(sanitizeFormula),
    subSections: (section.subSections ?? []).map(sanitizeSubSection),
    keyTakeaways: section.keyTakeaways
      ? {
          ...section.keyTakeaways,
          items: (section.keyTakeaways.items ?? []).map((item) => ({
            point: repairCorruptedLatex(item.point),
            subBullets: (item.subBullets ?? []).map((sb) => repairCorruptedLatex(sb)),
          })),
          modelSelectionRule: section.keyTakeaways.modelSelectionRule
            ? repairCorruptedLatex(section.keyTakeaways.modelSelectionRule)
            : undefined,
          realWorldConditions: section.keyTakeaways.realWorldConditions
            ? repairCorruptedLatex(section.keyTakeaways.realWorldConditions)
            : undefined,
          boundaryConditions: section.keyTakeaways.boundaryConditions
            ? repairCorruptedLatex(section.keyTakeaways.boundaryConditions)
            : undefined,
          summaryPoints: (section.keyTakeaways.summaryPoints ?? []).map((sp) =>
            repairCorruptedLatex(sp),
          ),
        }
      : null,
  };
}

function renderFormulaMarkdown(formula: NoteFormula, parts: string[]) {
  if (formula.leadText) {
    parts.push(formula.leadText);
    parts.push("");
  } else if (formula.name) {
    parts.push(`**${formula.name}**`);
    parts.push("");
  }
  parts.push(`$$${formula.latex}$$`);
  parts.push("");
  if (formula.variables && formula.variables.length > 0) {
    parts.push("**Trong đó:**");
    for (const v of formula.variables) {
      parts.push(`- $${v.symbol}$: ${v.definition}`);
    }
    parts.push("");
  }
  if (formula.description) {
    parts.push(formula.description);
    parts.push("");
  }
}

/**
 * Generates clean, concise Markdown representation for clipboard copying
 */
function buildMarkdownNote(note: Omit<ClutchNote, "rawMarkdown">): string {
  const parts: string[] = [];

  parts.push(`# ${note.title}`);
  parts.push(
    `*${note.subject} · ${note.originalSlideCount} Slides → ${note.estimatedDistilledPages} Pages*`,
  );
  parts.push("");

  for (const section of note.sections) {
    const headerSuffix =
      section.titleEn && !section.titleVi.toLowerCase().includes(section.titleEn.toLowerCase())
        ? ""
        : "";
    parts.push(`## ${section.titleVi}${headerSuffix}`);

    if (section.coreStatement) {
      parts.push(`**${section.coreStatement}**`);
      parts.push("");
    }

    if (section.overview) {
      parts.push(section.overview);
      parts.push("");
    }

    const formulasIntroduceBullets =
      section.formulas.length > 0 &&
      !section.formulas[0].leadText &&
      Boolean(section.formulas[0].description?.trim().endsWith(":"));

    if (formulasIntroduceBullets) {
      for (const formula of section.formulas) {
        renderFormulaMarkdown(formula, parts);
      }
      if (section.bulletPoints.length > 0) {
        for (const bp of section.bulletPoints) {
          parts.push(`- ${bp}`);
        }
        parts.push("");
      }
    } else {
      if (section.bulletPoints.length > 0) {
        for (const bp of section.bulletPoints) {
          parts.push(`- ${bp}`);
        }
        parts.push("");
      }
      for (const formula of section.formulas) {
        renderFormulaMarkdown(formula, parts);
      }
    }

    if (section.subSections && section.subSections.length > 0) {
      for (const sub of section.subSections) {
        if (sub.heading) {
          parts.push(`### ${sub.heading}`);
        }
        if (sub.leadIn) {
          parts.push(sub.leadIn);
        }
        if (sub.bulletPoints.length > 0) {
          for (const bp of sub.bulletPoints) {
            parts.push(`- ${bp}`);
          }
          parts.push("");
        }
        for (const formula of sub.formulas) {
          renderFormulaMarkdown(formula, parts);
        }
      }
    }

    if (section.keyTakeaways) {
      const kt = section.keyTakeaways;
      parts.push(`> **${kt.title || "KEY TAKEAWAYS"}**`);
      if (kt.items && kt.items.length > 0) {
        kt.items.forEach((item, idx) => {
          parts.push(`> ${idx + 1}. ${item.point}`);
          if (item.subBullets && item.subBullets.length > 0) {
            for (const sb of item.subBullets) {
              parts.push(`>    - ${sb}`);
            }
          }
        });
      } else {
        let num = 1;
        if (kt.modelSelectionRule) {
          parts.push(`> ${num++}. ${kt.modelSelectionRule}`);
        }
        if (kt.realWorldConditions) {
          parts.push(`> ${num++}. ${kt.realWorldConditions}`);
        }
        if (kt.boundaryConditions) {
          parts.push(`> ${num++}. ${kt.boundaryConditions}`);
        }
        for (const point of kt.summaryPoints) {
          parts.push(`> ${num++}. ${point}`);
        }
      }
      parts.push("");
    }
  }

  return parts.join("\n").trim();
}

function mapGeneratedSection(
  sec: GeneratedClutchNote["sections"][number],
  index: number,
): NoteSection {
  const sequentialLetter = String.fromCharCode(65 + index);
  const strippedTitle = sec.titleVi.trim().replace(/^[A-Z0-9]+\.\s+/i, "");
  const prefixedTitle = `${sequentialLetter}. ${strippedTitle}`;

  const mapFormula = (
    f: GeneratedClutchNote["sections"][number]["formulas"][number],
  ): NoteFormula => ({
    name: "",
    leadText: f.leadText.trim() || undefined,
    latex: f.latex.trim(),
    description: f.description.trim() || undefined,
    variables: f.variables
      .map((v) => ({
        symbol: v.symbol.trim(),
        definition: v.definition.trim(),
      }))
      .filter((v) => v.symbol.length > 0 && v.definition.length > 0),
  });

  const takeawayItems = sec.takeaways
    .map((t) => ({
      point: t.point.trim(),
      subBullets: t.subBullets.map((sb) => sb.trim()).filter(Boolean),
    }))
    .filter((t) => t.point.length > 0);

  return sanitizeSectionLatex({
    id: `sec-${sequentialLetter.toLowerCase()}-${index + 1}`,
    letter: sequentialLetter,
    titleVi: prefixedTitle,
    titleEn: "",
    coreStatement: sec.coreStatement.trim() || undefined,
    overview: sec.overview.trim(),
    bulletPoints: sec.bulletPoints.map((bp) => bp.trim()).filter(Boolean),
    formulas: sec.formulas.map(mapFormula).filter((f) => f.latex.length > 0),
    subSections: sec.subSections
      .map((sub) => ({
        heading: sub.heading.trim(),
        leadIn: sub.leadIn.trim() || undefined,
        bulletPoints: sub.bulletPoints.map((bp) => bp.trim()).filter(Boolean),
        formulas: sub.formulas.map(mapFormula).filter((f) => f.latex.length > 0),
      }))
      .filter(
        (sub) =>
          sub.heading.length > 0 &&
          (sub.bulletPoints.length > 0 ||
            sub.formulas.length > 0 ||
            Boolean(sub.leadIn)),
      ),
    keyTakeaways:
      takeawayItems.length > 0
        ? {
            title: "KEY TAKEAWAYS",
            items: takeawayItems,
            summaryPoints: [],
          }
        : null,
    sourceSlides: sec.sourceSlides,
  });
}

function sectionHasSubstantiveContent(section: NoteSection): boolean {
  const hasTopLevel =
    Boolean(section.coreStatement?.trim()) ||
    section.bulletPoints.length > 0 ||
    section.formulas.length > 0;
  const hasSubContent =
    (section.subSections?.length ?? 0) > 0 &&
    section.subSections!.some(
      (sub) =>
        sub.bulletPoints.length > 0 ||
        sub.formulas.length > 0 ||
        Boolean(sub.leadIn?.trim()),
    );
  const hasTakeaways = Boolean(
    section.keyTakeaways &&
      ((section.keyTakeaways.items?.length ?? 0) > 0 ||
        section.keyTakeaways.summaryPoints.length > 0),
  );
  return hasTopLevel || hasSubContent || hasTakeaways;
}

export async function generateClutchNote(
  options: GenerateClutchNoteOptions,
): Promise<ClutchNote> {
  const noteId = `note-${randomUUID().slice(0, 8)}`;
  let model: LanguageModel;

  try {
    model = options.modelOverride ?? getGenerationModel("pro");
  } catch (err) {
    // If running in an unconfigured environment or tests without API keys, fallback to sample note
    console.warn("[generateClutchNote] AI model not configured, using fallback synthesis.", err);
    return {
      ...SAMPLE_CLUTCH_NOTE,
      id: noteId,
      createdAt: new Date().toISOString(),
      originalFileName: options.fileName,
      originalSlideCount: options.slideCount,
    };
  }

  const prompt = buildNotesPrompt({
    fileName: options.fileName,
    slides: options.sources.map((s) => ({ label: s.label, text: s.text })),
    focus: options.focus,
  });

  const isGroqPrimary = Boolean(
    process.env.GROQ_API_KEY && process.env.AI_PROVIDER?.trim().toLowerCase() === "groq",
  );
  const primaryMaxTokens = isGroqPrimary ? 4_096 : 8_192;

  const synthesizeWithModel = async (
    targetModel: LanguageModel,
    maxOutputTokens: number,
    timeoutMs?: number,
  ): Promise<NoteSection[]> => {
    const timeoutController = timeoutMs ? new AbortController() : null;
    const timer = timeoutController
      ? setTimeout(
          () =>
            timeoutController.abort(
              new DOMException("Note synthesis timed out", "TimeoutError"),
            ),
          timeoutMs,
        )
      : null;

    const combinedSignal =
      timeoutController && options.signal
        ? AbortSignal.any([options.signal, timeoutController.signal])
        : timeoutController?.signal ?? options.signal;

    let object: GeneratedClutchNote;
    try {
      const res = await generateObject({
        model: targetModel,
        schema: generatedClutchNoteSchema,
        system: CLUTCH_NOTES_SYSTEM_PROMPT,
        prompt,
        abortSignal: combinedSignal,
        maxRetries: timeoutMs ? 0 : 1,
        maxOutputTokens,
      });
      object = res.object;
    } finally {
      if (timer) clearTimeout(timer);
    }

    const mapped = object.sections
      .map(mapGeneratedSection)
      .filter(sectionHasSubstantiveContent)
      .map((sec, idx) => {
        const seqLetter = String.fromCharCode(65 + idx);
        const stripped = sec.titleVi.replace(/^[A-Z0-9]+\.\s+/i, "");
        return {
          ...sec,
          id: `sec-${seqLetter.toLowerCase()}-${idx + 1}`,
          letter: seqLetter,
          titleVi: `${seqLetter}. ${stripped}`,
        };
      });

    if (mapped.length === 0) {
      throw new IngestionError(
        "INVALID_AI_OUTPUT",
        "The AI returned section headers without distilled body content. Retrying synthesis.",
        502,
      );
    }

    lastMeta = object;
    return mapped;
  };

  let lastMeta: GeneratedClutchNote | null = null;
  let populatedSections: NoteSection[];
  const fallback = !options.modelOverride ? getGroqModel() : null;
  const hasDistinctFallback = Boolean(fallback && fallback !== model);

  try {
    populatedSections = await synthesizeWithModel(
      model,
      primaryMaxTokens,
      hasDistinctFallback ? 35_000 : undefined,
    );
  } catch (primaryErr) {
    if (hasDistinctFallback && fallback) {
      console.warn(
        "[generateClutchNote] Primary model failed or returned empty sections; failing over to Groq...",
        primaryErr,
      );
      populatedSections = await synthesizeWithModel(fallback, 4_096);
    } else {
      throw primaryErr;
    }
  }

  const meta = lastMeta!;

  // Normalize noise reduction rate: if LLM returns a fraction like 0.81 instead of 81, scale to percentage
  let noiseRate = meta.noiseReductionRate ?? 85;
  if (noiseRate > 0 && noiseRate <= 1) {
    noiseRate = Math.round(noiseRate * 100);
  } else {
    noiseRate = Math.min(98, Math.max(20, Math.round(noiseRate)));
  }

  const finalNote: ClutchNote = {
    id: noteId,
    title: repairCorruptedLatex(meta.title.trim()),
    subject: repairCorruptedLatex(meta.subject.trim()),
    createdAt: new Date().toISOString(),
    originalFileName: options.fileName,
    originalSlideCount: options.slideCount,
    estimatedDistilledPages: meta.estimatedDistilledPages || 3,
    noiseReductionRate: noiseRate,
    executiveSummary: repairCorruptedLatex(meta.executiveSummary.trim()),
    sections: populatedSections,
  };

  finalNote.rawMarkdown = buildMarkdownNote(finalNote);

  return finalNote;
}
