import "server-only";
import { generateObject, type LanguageModel } from "ai";
import { randomUUID } from "node:crypto";
import { clutchNoteSchema, type ClutchNote, type NoteSection } from "@/lib/schemas/notes";
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

/**
 * Sanitizes and repairs LaTeX formulas and strings inside distilled sections
 */
function sanitizeSectionLatex(section: NoteSection): NoteSection {
  return {
    ...section,
    overview: repairCorruptedLatex(section.overview),
    bulletPoints: section.bulletPoints.map((bp) => repairCorruptedLatex(bp)),
    formulas: section.formulas.map((f) => ({
      ...f,
      latex: repairCorruptedLatex(f.latex).replace(/^\$+|\$+$/g, "").trim(),
      description: f.description ? repairCorruptedLatex(f.description) : undefined,
      variables: f.variables.map((v) => ({
        symbol: repairCorruptedLatex(v.symbol).replace(/^\$+|\$+$/g, "").trim(),
        definition: repairCorruptedLatex(v.definition),
      })),
    })),
    keyTakeaways: section.keyTakeaways
      ? {
          ...section.keyTakeaways,
          modelSelectionRule: section.keyTakeaways.modelSelectionRule
            ? repairCorruptedLatex(section.keyTakeaways.modelSelectionRule)
            : undefined,
          realWorldConditions: section.keyTakeaways.realWorldConditions
            ? repairCorruptedLatex(section.keyTakeaways.realWorldConditions)
            : undefined,
          boundaryConditions: section.keyTakeaways.boundaryConditions
            ? repairCorruptedLatex(section.keyTakeaways.boundaryConditions)
            : undefined,
          summaryPoints: section.keyTakeaways.summaryPoints.map((sp) => repairCorruptedLatex(sp)),
        }
      : null,
  };
}

/**
 * Generates unified Markdown representation for easy clipboard copying & rendering
 */
function buildMarkdownNote(note: Omit<ClutchNote, "rawMarkdown">): string {
  const parts: string[] = [];

  parts.push(`# ${note.title}`);
  parts.push(`*${note.subject} · ${note.originalSlideCount} Slides Distilled into ${note.estimatedDistilledPages} Pages · Noise Stripped: ${note.noiseReductionRate}%*`);
  parts.push("");
  parts.push(`> **Executive Summary:** ${note.executiveSummary}`);
  parts.push("");

  for (const section of note.sections) {
    parts.push(`## ${section.titleVi} (${section.titleEn})`);
    parts.push(section.overview);
    parts.push("");

    if (section.bulletPoints.length > 0) {
      for (const bp of section.bulletPoints) {
        parts.push(`- ${bp}`);
      }
      parts.push("");
    }

    if (section.formulas.length > 0) {
      for (const formula of section.formulas) {
        parts.push(`### 📐 ${formula.name}`);
        parts.push(`$$${formula.latex}$$`);
        if (formula.description) {
          parts.push(`*${formula.description}*`);
        }
        parts.push("");
        if (formula.variables.length > 0) {
          parts.push("**Trong đó:**");
          for (const v of formula.variables) {
            parts.push(`- $${v.symbol}$: ${v.definition}`);
          }
          parts.push("");
        }
      }
    }

    if (section.keyTakeaways) {
      parts.push(`### 🌟 ${section.keyTakeaways.title}`);
      if (section.keyTakeaways.modelSelectionRule) {
        parts.push(`- **Model Selection (Cách chọn mô hình):** ${section.keyTakeaways.modelSelectionRule}`);
      }
      if (section.keyTakeaways.realWorldConditions) {
        parts.push(`- **Real-World Conditions (Điều kiện áp dụng thực tế):** ${section.keyTakeaways.realWorldConditions}`);
      }
      if (section.keyTakeaways.boundaryConditions) {
        parts.push(`- **Boundary Conditions & Pitfalls (Giới hạn toán học & Bẫy thi cử):** ${section.keyTakeaways.boundaryConditions}`);
      }
      for (const point of section.keyTakeaways.summaryPoints) {
        parts.push(`- ${point}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n");
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
