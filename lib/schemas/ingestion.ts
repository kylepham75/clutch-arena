import { z } from "zod";
import type { StudyPack } from "./question";

export const ingestionOptionsSchema = z
  .object({
    operation: z.enum(["preview", "generate"]).default("generate"),
    mode: z.enum(["exact", "variants"]).default("variants"),
    questionCount: z.number().int().min(1).max(30).default(10),
    language: z.enum(["en", "vi"]).default("en"),
    focus: z.string().trim().max(1000).default(""),
    multiFile: z.boolean().optional(),
  })
  .strict();
export type IngestionOptions = z.infer<typeof ingestionOptionsSchema>;
export type SourceBlock = { id: string; label: string; text: string };
export type ParsedDocument = {
  fileName: string;
  format: "pdf" | "docx" | "txt" | "mixed";
  sources: SourceBlock[];
  characterCount: number;
  pageCount: number | null;
  warnings: string[];
};
export type SourceReference = {
  sourceId: string;
  label: string;
  excerpt: string;
};
export type GenerationResult = {
  pack: StudyPack;
  sourceKind: "testbank" | "lecture" | "mixed";
  references: Record<string, SourceReference>;
  warnings: string[];
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};
