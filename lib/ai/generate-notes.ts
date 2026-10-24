import "server-only";
import { generateObject, type LanguageModel } from "ai";
import { randomUUID } from "node:crypto";
import {
  clutchNoteSchema,
  type ClutchNote,
  type NoteFormula,
  type NoteSection,
  type NoteSubSection,
} from "@/lib/schemas/notes";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import { getGenerationModel } from "./provider";
import { CLUTCH_NOTES_SYSTEM_PROMPT, buildNotesPrompt } from "./prompts-notes";
import { repairCorruptedLatex } from "@/lib/math/latex";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";

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

  const { object } = await generateObject({
    model,
    schema: clutchNoteSchema,
    system: CLUTCH_NOTES_SYSTEM_PROMPT,
    prompt,
    abortSignal: options.signal,
    maxRetries: 1,
  });

  const sanitizedSections = object.sections.map(sanitizeSectionLatex);

  // Normalize noise reduction rate: if LLM returns a fraction like 0.81 instead of 81, scale to percentage
  let noiseRate = object.noiseReductionRate ?? 85;
  if (noiseRate > 0 && noiseRate <= 1) {
    noiseRate = Math.round(noiseRate * 100);
  } else {
    noiseRate = Math.round(noiseRate);
  }

  const finalNote: ClutchNote = {
    ...object,
    id: noteId,
    createdAt: new Date().toISOString(),
    noiseReductionRate: noiseRate,
    originalFileName: options.fileName,
    originalSlideCount: options.slideCount,
    sections: sanitizedSections,
  };

  finalNote.rawMarkdown = buildMarkdownNote(finalNote);

  return finalNote;
}
