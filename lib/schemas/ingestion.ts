import { z } from "zod";
import type { StudyPack } from "./question";

export const ingestionOptionsSchema = z
  .object({
    operation: z.enum(["preview", "generate"]).default("generate"),
    mode: z.enum(["exact", "variants"]).default("variants"),
    questionCount: z.number().int().min(1).max(35).default(15),
    language: z.enum(["en", "vi"]).default("en"),
    focus: z.string().trim().max(1000).default(""),
    multiFile: z.boolean().optional(),
    tier: z.string().optional(),
    rescanPages: z.array(z.number().int().min(1).max(150)).max(150).optional(),
  })
  .strict();
export type IngestionOptions = z.infer<typeof ingestionOptionsSchema>;
export type SourceBlock = { id: string; label: string; text: string };

export type PageVisionMode = "native" | "equation_crop" | "full_page";
export type PageVisionReason =
  | "low_text"
  | "single_image_area"
  | "combined_image_area"
  | "math_image_detected";
export type PageVisionInfo = {
  page: number;
  flagged: boolean;
  reasons: PageVisionReason[];
  processed: boolean;
  mode: PageVisionMode;
  cached: boolean;
  lowConfidence: boolean;
  costUsd: number;
};

export type ParsedDocument = {
  fileName: string;
  format: "pdf" | "docx" | "txt" | "pptx" | "mixed";
  sources: SourceBlock[];
  characterCount: number;
  pageCount: number | null;
  warnings: string[];
  contentHash?: string;
  fileSha256?: string;
  imageHashes?: string[];
  dedupedSlideCount?: number;
  visionBanner?: string | null;
  lowConfidenceSourceIds?: string[];
  pageVisionStatus?: Record<string, PageVisionInfo>;
  ocrEquations?: Array<{
    slide: number;
    raw: string;
    latex: string;
    origin: "ocr";
    confidence: number;
    mediaPath?: string;
  }>;
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
  pipelineVersion?: string;
  servedModel?: string | null;
  costUsd?: number;
};
