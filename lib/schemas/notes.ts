import { z } from "zod";

export const noteFormulaVariableSchema = z.object({
  symbol: z
    .string()
    .describe("Mathematical variable symbol in clean LaTeX without $, e.g. P_0, R, g, D_1"),
  definition: z
    .string()
    .describe("Short, plain-English explanation of the variable, e.g. 'Price of the stock today'"),
});

export const noteFormulaSchema = z.object({
  name: z
    .string()
    .optional()
    .default("")
    .describe(
      "Optional short label if needed; leave empty string '' when leadText or the section/case heading already names the formula",
    ),
  leadText: z
    .string()
    .optional()
    .describe(
      "Optional short transition phrase right above the formula box, e.g. 'Nếu chỉ đầu tư trong 1 năm:', 'Let\\'s start with the DGM:', 'Rearranging the equation to solve for R, we get:', or 'The equation:'",
    ),
  latex: z
    .string()
    .describe(
      "Clean LaTeX math string without surrounding dollar signs, e.g. P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
    ),
  description: z
    .string()
    .optional()
    .describe("Optional 1-line note below the formula box only if strictly needed"),
  variables: z
    .array(noteFormulaVariableSchema)
    .default([])
    .describe(
      "List of variables for 'Trong đó:'. ONLY include variables when introduced for the FIRST time; pass empty array [] if variables were already defined earlier in the note",
    ),
});

export const noteSubSectionSchema = z.object({
  heading: z
    .string()
    .describe(
      "Concise bold sub-heading, e.g. 'CASE 1: Zero Growth Model (Không tăng trưởng)' or 'Finding the growth rate (g)'",
    ),
  leadIn: z
    .string()
    .optional()
    .describe("Optional short 1-line lead-in before bullet points, e.g. 'The discount rate can be broken into two parts:'"),
  bulletPoints: z
    .array(z.string())
    .default([])
    .describe("Short, plain-English bullet points (5–15 words each, easy to scan)"),
  formulas: z
    .array(noteFormulaSchema)
    .default([])
    .describe("Boxed LaTeX formulas belonging to this sub-case or sub-topic"),
});

export const keyTakeawaysItemSchema = z.object({
  point: z
    .string()
    .describe(
      "Concise 1-line numbered takeaway rule in plain English, e.g. 'Make sure $g < R$, otherwise the model breaks down'",
    ),
  subBullets: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "Optional short sub-bullets using '→' arrows, e.g. ['Zero growth → Perpetuity', 'Constant growth → Gordon model']",
    ),
});

export const keyTakeawaysSchema = z.object({
  title: z.string().default("KEY TAKEAWAYS"),
  items: z
    .array(keyTakeawaysItemSchema)
    .optional()
    .default([])
    .describe("3 to 5 ultra-concise numbered takeaway items with optional short sub-bullets"),
  modelSelectionRule: z
    .string()
    .optional()
    .describe("Optional brief criteria on how to choose between models"),
  realWorldConditions: z
    .string()
    .optional()
    .describe("Optional brief real-world condition when the model applies"),
  boundaryConditions: z
    .string()
    .optional()
    .describe("Optional brief mathematical boundary condition or pitfall, e.g. g < R"),
  summaryPoints: z
    .array(z.string())
    .default([])
    .describe("Concise numbered bullet points synthesizing the key rules"),
});

export const noteSectionSchema = z.object({
  id: z.string(),
  letter: z.string().describe("Section alphabetical identifier: A, B, C, D, E..."),
  titleVi: z
    .string()
    .describe(
      "Clean uppercase section header (Vietnamese for foundational sections like 'A. NGUYÊN LÝ CƠ BẢN', 'B. CÔNG THỨC TỔNG QUÁT', or crisp English/bilingual for specific models like 'C. DDM (DIVIDEND DISCOUNT MODEL)', 'D. PARAMETERS IN DIVIDEND DISCOUNT MODEL', 'E. VALUE OF PREFERENCE SHARE')",
    ),
  titleEn: z
    .string()
    .optional()
    .default("")
    .describe("Optional concise English subtitle if titleVi is purely in Vietnamese"),
  coreStatement: z
    .string()
    .optional()
    .describe(
      "Optional bold 1-line core principle or equation statement, e.g. 'The value of any asset = the present value (PV) of its expected future cash flows.'",
    ),
  overview: z
    .string()
    .default("")
    .describe(
      "At most ONE short, plain-English lead-in sentence (e.g. 'For stocks, future cash flows come from:'). Leave empty '' if jumping directly into formulas or subSections. NEVER write long paragraphs.",
    ),
  bulletPoints: z
    .array(z.string())
    .default([])
    .describe(
      "Short, easy-to-understand bullet points (5–15 words each), with inline Vietnamese in parentheses ONLY for key terms, e.g. 'Dividends (Cổ tức) – regular payments from the company'",
    ),
  formulas: z.array(noteFormulaSchema).default([]),
  subSections: z
    .array(noteSubSectionSchema)
    .optional()
    .default([])
    .describe(
      "Ordered sub-cases or sub-topics within this section (e.g. CASE 1, CASE 2, CASE 3, or 'Finding g', 'Finding R')",
    ),
  keyTakeaways: keyTakeawaysSchema.nullable().optional(),
  sourceSlides: z
    .array(z.number())
    .optional()
    .describe("Slide numbers from which this section was distilled"),
});

export const clutchNoteSchema = z.object({
  id: z.string(),
  title: z
    .string()
    .describe(
      "Concise uppercase chapter/topic heading, e.g. 'CHAPTER 9: STOCK VALUATION' (keep under 8 words)",
    ),
  subject: z
    .string()
    .describe("Concise course or subject name, e.g. 'Corporate Finance'"),
  createdAt: z
    .string()
    .default(() => new Date().toISOString())
    .describe("ISO timestamp when the notes were generated"),
  originalFileName: z.string(),
  originalSlideCount: z.number().int().positive(),
  estimatedDistilledPages: z.number().int().positive().default(3),
  noiseReductionRate: z
    .number()
    .describe("Percentage of noise stripped from 0 to 100, e.g. 85")
    .default(85),
  executiveSummary: z
    .string()
    .default("")
    .describe("One short 1-sentence summary of what this sheet covers (max 25 words)"),
  sections: z.array(noteSectionSchema).min(1),
  rawMarkdown: z.string().optional(),
});

export type NoteFormulaVariable = z.infer<typeof noteFormulaVariableSchema>;
export type NoteFormula = z.infer<typeof noteFormulaSchema>;
export type NoteSubSection = z.infer<typeof noteSubSectionSchema>;
export type KeyTakeawaysItem = z.infer<typeof keyTakeawaysItemSchema>;
export type KeyTakeaways = z.infer<typeof keyTakeawaysSchema>;
export type NoteSection = z.infer<typeof noteSectionSchema>;
export type ClutchNote = z.infer<typeof clutchNoteSchema>;

export interface GenerateNotesRequest {
  fileName?: string;
  slidesText?: string;
  focus?: string;
}
