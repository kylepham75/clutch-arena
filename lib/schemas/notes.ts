import { z } from "zod";

export const noteFormulaVariableSchema = z.object({
  symbol: z
    .string()
    .describe("Mathematical variable symbol in clean LaTeX without $, e.g. P_0, R, g, D_1"),
  definition: z
    .string()
    .describe("Short, plain-English explanation of the variable, e.g. 'Price of the stock today'"),
});

export const formulaOriginSchema = z.enum(["omml", "text", "ocr", "llm"]);
export type FormulaOrigin = z.infer<typeof formulaOriginSchema>;

export const formulaLedgerEntrySchema = z.object({
  id: z.string().regex(/^F\d+$/).describe("Formula Ledger ID e.g. F1, F2"),
  slide: z.number().int().positive().describe("1-based slide number"),
  raw: z.string().describe("Verbatim extracted formula text"),
  latex: z.string().min(1).describe("Clean LaTeX equation without outer $"),
  origin: formulaOriginSchema.describe("Extraction source"),
  confidence: z.number().min(0).max(1).optional().describe("Confidence score between 0 and 1"),
  label: z.string().optional().describe("Short formula name or label"),
  variables: z.array(noteFormulaVariableSchema).default([]).describe("Variables defined with this formula"),
  evidence: z.string().optional().describe("Verbatim slide quote or context line"),
  isExerciseOnly: z.boolean().optional().describe("True if formula appeared solely within an exercise"),
});
export type FormulaLedgerEntry = z.infer<typeof formulaLedgerEntrySchema>;

export const verificationStatusSchema = z.enum([
  "verified",
  "derived",
  "needs_review",
  "unsupported",
  "contradicted",
]);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const claimVerdictValueSchema = z.enum(["SUPPORTED", "UNSUPPORTED", "CONTRADICTED"]);
export type ClaimVerdictValue = z.infer<typeof claimVerdictValueSchema>;

export const textbookDivergenceNoticeSchema = z.object({
  ruleId: z.string(),
  packId: z.string(),
  title: z.string(),
  message: z.string(),
  textbookForm: z.string().optional(),
  lecturerForm: z.string().optional(),
  slide: z.number().int().positive().optional(),
});
export type TextbookDivergenceNotice = z.infer<typeof textbookDivergenceNoticeSchema>;

export const groundedBulletSchema = z.object({
  text: z.string().describe("Bullet point text"),
  slide: z.number().int().positive().describe("1-based slide number"),
  evidence: z.string().describe("Verbatim supporting quote/phrase from slide"),
  status: verificationStatusSchema.optional().describe("Verification status of this bullet"),
  verdict: claimVerdictValueSchema.optional().describe("LLM or deterministic verifier verdict"),
  reviewReason: z.string().optional().describe("Explanation when flagged as needs_review or contradicted"),
});
export type GroundedBullet = z.infer<typeof groundedBulletSchema>;

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
  formulaRefs: z.array(z.string()).optional().describe("Formula ledger IDs referenced"),
  derivedFrom: z.array(z.string()).optional().describe("Formula ledger IDs from which this formula was derived"),
  slide: z.number().int().positive().optional().describe("Source slide number"),
  origin: z.enum(["omml", "text", "ocr", "llm", "derived"]).optional().describe("Origin of the formula"),
  confidence: z.number().min(0).max(1).optional().describe("Confidence score"),
  status: verificationStatusSchema
    .optional()
    .describe("Verification status: verified, derived, needs_review, contradicted"),
  reviewReason: z.string().optional().describe("Explanation if flagged as needs_review or contradicted"),
  divergenceNotices: z
    .array(textbookDivergenceNoticeSchema)
    .optional()
    .describe("Student-visible textbook divergence notices"),
  numericEquivalencePassed: z
    .boolean()
    .optional()
    .describe("Whether numeric equivalence check against source/parent passed"),
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
  groundedBullets: z
    .array(groundedBulletSchema)
    .optional()
    .describe("Bullets grounded with slide number and evidence quote"),
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
  slide: z.number().int().positive().optional().describe("Source slide number"),
  evidence: z.string().optional().describe("Verbatim quote grounding this takeaway"),
  status: verificationStatusSchema.optional().describe("Verification status of this takeaway"),
  verdict: claimVerdictValueSchema.optional().describe("LLM or deterministic verifier verdict"),
  reviewReason: z.string().optional().describe("Explanation when flagged as needs_review or contradicted"),
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
  groundedBullets: z
    .array(groundedBulletSchema)
    .optional()
    .describe("Bullets grounded with slide number and evidence quote"),
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

// Strict LLM Extraction Schemas (100% required properties, .strict(), zero .optional() or .default())
export const extractedFormulaVariableSchema = z
  .object({
    symbol: z.string().min(1).describe("Mathematical variable symbol in clean LaTeX without $"),
    definition: z.string().min(1).describe("Short, plain-English definition of the variable"),
  })
  .strict();

export const extractedFormulaItemSchema = z
  .object({
    slide: z.number().int().min(1).describe("1-based slide number"),
    raw: z.string().min(1).describe("Verbatim equation string or text from slide"),
    latex: z.string().min(1).describe("Clean LaTeX without outer $"),
    label: z.string().describe("Short formula name/label from slide, or ''"),
    variables: z.array(extractedFormulaVariableSchema).describe("Explicitly defined variables on the slide, or []"),
    evidence: z.string().min(1).describe("Verbatim supporting quote/line from the slide"),
    isExerciseOnly: z.boolean().describe("true if this formula appears ONLY inside an exercise/worked example on the slide"),
  })
  .strict();

export const extractedSlideClaimSchema = z
  .object({
    slide: z.number().int().min(1).describe("1-based slide number"),
    topic: z.string().min(1).describe("Topic or concept name"),
    claim: z.string().min(1).describe("Key factual statement or rule"),
    evidence: z.string().min(1).describe("Verbatim quote from slide"),
  })
  .strict();

export const extractionSchema = z
  .object({
    formulas: z.array(extractedFormulaItemSchema).describe("Formulas extracted from slides"),
    claims: z.array(extractedSlideClaimSchema).describe("Key claims and concepts extracted from slides"),
  })
  .strict();

export type ExtractedFormulaVariable = z.infer<typeof extractedFormulaVariableSchema>;
export type ExtractedFormulaItem = z.infer<typeof extractedFormulaItemSchema>;
export type ExtractedSlideClaim = z.infer<typeof extractedSlideClaimSchema>;
export type ExtractionResult = z.infer<typeof extractionSchema>;

// Strict LLM Synthesis Schemas (100% required properties, .strict(), zero .optional() or .default())
export const synthesisBulletSchema = z
  .object({
    text: z.string().min(1).describe("Short plain-English bullet point (5–15 words)"),
    slide: z.number().int().min(1).describe("1-based source slide number"),
    evidence: z.string().min(1).describe("Verbatim quote/phrase from the slide grounding this bullet"),
  })
  .strict();

export const synthesisFormulaVariableSchema = z
  .object({
    symbol: z.string().min(1).describe("Mathematical variable symbol in clean LaTeX without $"),
    definition: z.string().min(1).describe("Short definition of variable"),
  })
  .strict();

export const synthesisFormulaSchema = z
  .object({
    formulaRefs: z
      .array(z.string().min(1))
      .describe("Array of Formula Ledger IDs e.g. ['F1']; pass [] only if derived via derivedFrom"),
    derivedFrom: z
      .array(z.string().min(1))
      .describe(
        "Array of Formula Ledger IDs e.g. ['F1'] if equation is algebraic rearrangement/derivation; pass [] when directly placing ledger formula",
      ),
    leadText: z.string().describe("Short transition line above box, or ''"),
    latex: z
      .string()
      .min(1)
      .describe("Clean LaTeX without outer $; overwritten by authoritative ledger LaTeX when formulaRefs provided"),
    description: z.string().describe("Empty string '' unless short transition remark is needed"),
    variables: z.array(synthesisFormulaVariableSchema).describe("Variables for 'Trong đó:', or []"),
  })
  .strict();

export const synthesisSubSectionSchema = z
  .object({
    heading: z.string().min(1).describe("Concise sub-heading"),
    leadIn: z.string().describe("Lead-in string, or ''"),
    bullets: z.array(synthesisBulletSchema).describe("Source-grounded bullet points"),
    formulas: z.array(synthesisFormulaSchema).describe("Formulas placed in this sub-section"),
  })
  .strict();

export const synthesisTakeawayItemSchema = z
  .object({
    point: z.string().min(1).describe("Takeaway point"),
    subBullets: z.array(z.string()).describe("Sub-bullets or []"),
    slide: z.number().int().min(1).describe("1-based slide number"),
    evidence: z.string().min(1).describe("Verbatim quote grounding this takeaway"),
  })
  .strict();

export const synthesisSectionSchema = z
  .object({
    letter: z.string().min(1).describe("Section identifier: A, B, C..."),
    titleVi: z.string().min(1).describe("Uppercase section title"),
    coreStatement: z.string().describe("Core statement or ''"),
    overview: z.string().describe("Overview lead-in or ''"),
    bullets: z.array(synthesisBulletSchema).describe("Section-level grounded bullet points"),
    formulas: z.array(synthesisFormulaSchema).describe("Section-level formulas"),
    subSections: z.array(synthesisSubSectionSchema).describe("Sub-sections or []"),
    takeaways: z.array(synthesisTakeawayItemSchema).describe("Key takeaway items or []"),
    sourceSlides: z.array(z.number().int().min(1)).describe("Source slide numbers"),
  })
  .strict();

export const synthesisOmittedFormulaSchema = z
  .object({
    formulaId: z.string().min(1).describe("Ledger ID e.g. 'F4'"),
    reason: z.string().min(1).describe("Why it was omitted, e.g. duplicate of another ledger ID"),
  })
  .strict();

export const formulaOmissionStatusSchema = z.enum(["omitted_by_rule", "uncaptured_error"]);
export type FormulaOmissionStatus = z.infer<typeof formulaOmissionStatusSchema>;

export type NoteOmittedFormula = {
  formulaId: string;
  reason: string;
  status?: FormulaOmissionStatus;
};

export const noteOmittedFormulaSchema: z.ZodType<NoteOmittedFormula> = z.object({
  formulaId: z.string().min(1),
  reason: z.string().min(1),
  status: formulaOmissionStatusSchema.optional().default("omitted_by_rule"),
});

export const synthesisSchema = z
  .object({
    title: z.string().min(1).describe("Concise uppercase chapter/topic heading"),
    subject: z.string().min(1).describe("Concise course or subject name"),
    estimatedDistilledPages: z.number().int().min(1).max(6).describe("Estimated distilled page count (1-6)"),
    noiseReductionRate: z.number().describe("Percentage of noise stripped (0-100)"),
    executiveSummary: z.string().min(1).describe("Executive summary sentence"),
    sections: z.array(synthesisSectionSchema).min(1).max(6).describe("1 to 6 distilled sections"),
    omitted: z.array(synthesisOmittedFormulaSchema).describe("Formulas omitted with justification"),
  })
  .strict();

export type SynthesisBullet = z.infer<typeof synthesisBulletSchema>;
export type SynthesisFormulaVariable = z.infer<typeof synthesisFormulaVariableSchema>;
export type SynthesisFormula = z.infer<typeof synthesisFormulaSchema>;
export type SynthesisSubSection = z.infer<typeof synthesisSubSectionSchema>;
export type SynthesisTakeawayItem = z.infer<typeof synthesisTakeawayItemSchema>;
export type SynthesisSection = z.infer<typeof synthesisSectionSchema>;
export type SynthesisOmittedFormula = z.infer<typeof synthesisOmittedFormulaSchema>;
export type SynthesisResult = z.infer<typeof synthesisSchema>;

export const claimVerificationItemSchema = z
  .object({
    claimId: z.string().min(1).describe("Identifier of the claim e.g. C1, C2"),
    slide: z.number().int().min(1).describe("1-based slide number"),
    verdict: claimVerdictValueSchema.describe("SUPPORTED, UNSUPPORTED, or CONTRADICTED"),
    reason: z.string().min(1).describe("Concise explanation for the verdict based strictly on slide text"),
  })
  .strict();
export type ClaimVerificationItem = z.infer<typeof claimVerificationItemSchema>;

export const verifierOutputSchema = z
  .object({
    verdicts: z.array(claimVerificationItemSchema).describe("Per-claim verification verdicts"),
  })
  .strict();
export type VerifierOutput = z.infer<typeof verifierOutputSchema>;

export const formulaVerificationResultSchema = z.object({
  latex: z.string(),
  slide: z.number().int().positive().optional(),
  formulaRefs: z.array(z.string()).optional(),
  derivedFrom: z.array(z.string()).optional(),
  status: verificationStatusSchema,
  symbolSetGrounded: z.boolean(),
  ungroundedSymbols: z.array(z.string()).default([]),
  numericEquivalencePassed: z.boolean().optional(),
  contradictsSource: z.boolean().default(false),
  reason: z.string().optional(),
  divergenceNotices: z.array(textbookDivergenceNoticeSchema).default([]),
});
export type FormulaVerificationResult = z.infer<typeof formulaVerificationResultSchema>;

export const noteVerificationRecordSchema = z.object({
  status: z.enum(["passed", "marked", "repaired", "failed"]).describe("Overall verification gate status"),
  repairAttempted: z.boolean().default(false),
  coverageRatio: z.number().min(0).max(1).describe("Fraction of ledger formulas placed or validly accounted for"),
  totalLedgerFormulas: z.number().int().min(0),
  placedFormulaIds: z.array(z.string()).default([]),
  uncapturedFormulaIds: z.array(z.string()).default([]),
  omittedByRuleFormulaIds: z.array(z.string()).default([]).optional(),
  unsupportedClaimsRemoved: z.number().int().min(0).default(0),
  needsReviewCount: z.number().int().min(0).default(0),
  contradictedFormulaCount: z.number().int().min(0).default(0),
  evidenceMatchRatio: z.number().min(0).max(1).default(1),
  numberGroundingPassed: z.boolean().default(true),
  ungroundedNumbers: z.array(z.string()).default([]),
  symbolGroundingPassed: z.boolean().default(true),
  ungroundedSymbols: z.array(z.string()).default([]),
  claimVerdicts: z.array(claimVerificationItemSchema).default([]),
  formulaResults: z.array(formulaVerificationResultSchema).default([]),
  divergenceNotices: z.array(textbookDivergenceNoticeSchema).default([]),
  warnings: z.array(z.string()).default([]),
});
export type NoteVerificationRecord = z.infer<typeof noteVerificationRecordSchema>;

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
  formulaLedger: z.array(formulaLedgerEntrySchema).optional().describe("Formula ledger entries across all slides"),
  omitted: z.array(noteOmittedFormulaSchema).optional().describe("Omitted formula entries with justification"),
  verification: noteVerificationRecordSchema.optional().describe("Stage 4 verification and gate record"),
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
