import { z } from "zod";

export const noteFormulaVariableSchema = z.object({
  symbol: z.string().describe("Mathematical variable symbol, e.g. P_0, r, g, D_1"),
  definition: z.string().describe("English explanation of variable and unit"),
});

export const noteFormulaSchema = z.object({
  name: z.string().describe("Formula name with English & Vietnamese, e.g. Constant Growth Model (Tăng trưởng đều)"),
  latex: z.string().describe("Clean LaTeX math string without surrounding dollar signs"),
  description: z.string().optional().describe("Brief intuition of what the formula computes"),
  variables: z.array(noteFormulaVariableSchema).describe("List of variables for the 'Trong đó:' block"),
});

export const keyTakeawaysSchema = z.object({
  title: z.string().default("KEY TAKEAWAYS: Model Selection & Boundary Conditions"),
  modelSelectionRule: z.string().optional().describe("Criteria on how to choose between models"),
  realWorldConditions: z.string().optional().describe("Real-world conditions when each model applies"),
  boundaryConditions: z.string().optional().describe("Mathematical boundary conditions or pitfalls, e.g. g < r"),
  summaryPoints: z.array(z.string()).describe("Numbered bullet points synthesizing the key rules"),
});

export const noteSectionSchema = z.object({
  id: z.string(),
  letter: z.string().describe("Section alphabetical identifier: A, B, C, D..."),
  titleVi: z.string().describe("Vietnamese section header, e.g. 'A. NGUYÊN LÝ CƠ BẢN', 'B. CÔNG THỨC TỔNG QUÁT'"),
  titleEn: z.string().describe("Academic English section title, e.g. 'Core Principles of Stock Valuation'"),
  overview: z.string().describe("Distilled theoretical concept in academic English with inline Vietnamese parentheses for key terms"),
  bulletPoints: z.array(z.string()).describe("High-retention distilled bullet points"),
  formulas: z.array(noteFormulaSchema).default([]),
  keyTakeaways: keyTakeawaysSchema.nullable().optional(),
  sourceSlides: z.array(z.number()).optional().describe("Slide numbers from which this section was distilled"),
});

export const clutchNoteSchema = z.object({
  id: z.string(),
  title: z.string().describe("Subject/Topic title of the distilled lecture deck"),
  subject: z.string().describe("Academic field or course name, e.g. 'Corporate Finance / Tài chính doanh nghiệp'"),
  createdAt: z.string().default(() => new Date().toISOString()).describe("ISO timestamp when the notes were generated"),
  originalFileName: z.string(),
  originalSlideCount: z.number().int().positive(),
  estimatedDistilledPages: z.number().int().positive().default(3),
  noiseReductionRate: z.number().describe("Percentage of noise stripped from 0 to 100, e.g. 85").default(85),
  executiveSummary: z.string().describe("Concise executive summary of distilled concepts"),
  sections: z.array(noteSectionSchema).min(1),
  rawMarkdown: z.string().optional(),
});

export type NoteFormulaVariable = z.infer<typeof noteFormulaVariableSchema>;
export type NoteFormula = z.infer<typeof noteFormulaSchema>;
export type KeyTakeaways = z.infer<typeof keyTakeawaysSchema>;
export type NoteSection = z.infer<typeof noteSectionSchema>;
export type ClutchNote = z.infer<typeof clutchNoteSchema>;

export interface GenerateNotesRequest {
  fileName?: string;
  slidesText?: string;
  focus?: string;
}
