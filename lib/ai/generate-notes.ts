import "server-only";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  type ClutchNote,
  type NoteFormula,
  type NoteSection,
  type NoteSubSection,
  type KeyTakeawaysItem,
  type FormulaLedgerEntry,
  type GroundedBullet,
  type SynthesisResult,
  type SynthesisSection,
  type SynthesisFormula,
  type SynthesisSubSection,
  type SynthesisTakeawayItem,
  type SynthesisOmittedFormula,
  type ExtractedSlideClaim,
  type ExtractionResult,
  synthesisSchema,
  extractionSchema,
} from "@/lib/schemas/notes";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import type {
  OcrTranscribedEquation,
  OmmlTranscribedEquation,
} from "@/lib/ingestion/parse-pptx";
import {
  buildFormulaInventory,
  buildMergedFormulaLedger,
  mergeFormulaLedger,
  type FormulaInventoryItem,
} from "@/lib/notes/formula-inventory";
import { IngestionError } from "@/lib/ingestion/errors";
import { getGenerationModel, getGroqModel } from "./provider";
import { CLUTCH_NOTES_SYSTEM_PROMPT, buildNotesPrompt } from "./prompts-notes";
import {
  repairCorruptedLatex,
  ensureInlineMathDelimiters,
  cleanVietnameseSigmaTypos,
  formatAccountingFormula,
} from "@/lib/math/latex";
import {
  runVerificationGate,
  applyMarkPolicyAndGate,
  buildTargetedRepairPrompt,
  executeVerificationPipeline,
  type VerificationGateOptions,
  type VerificationGateResult,
  type VerificationPipelineReport,
  type TargetedRepairPromptInput,
} from "@/lib/notes/verification-gate";
export { ensureInlineMathDelimiters } from "@/lib/math/latex";

export {
  runVerificationGate,
  applyMarkPolicyAndGate,
  buildTargetedRepairPrompt,
  executeVerificationPipeline,
  type VerificationGateOptions,
  type VerificationGateResult,
  type VerificationPipelineReport,
  type TargetedRepairPromptInput,
};

export {
  extractionSchema,
  synthesisSchema,
  type FormulaLedgerEntry,
  type SynthesisResult,
  type SynthesisSection,
  type SynthesisFormula,
  type ExtractionResult,
} from "@/lib/schemas/notes";

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
        "Clean uppercase section header WITH letter prefix. Derive titles directly from the slide topic (e.g. for Cost of Capital/WACC: 'A. TỔNG QUAN CHI PHÍ VỐN', 'B. CHI PHÍ VỐN CỔ PHẦN (COST OF EQUITY)', 'C. CHI PHÍ NỢ VAY VÀ CỔ PHIẾU ƯU ĐÃI', 'D. CHI PHÍ SỬ DỤNG VỐN BÌNH QUÂN (WACC)', 'E. RỦI RO BỘ PHẬN VÀ CHI PHÍ PHÁT HÀNH'; for Stock Valuation: 'A. NGUYÊN LÝ CƠ BẢN', 'B. CÔNG THỨC TỔNG QUÁT', 'C. DDM (DIVIDEND DISCOUNT MODEL)', 'D. PARAMETERS IN DIVIDEND DISCOUNT MODEL', 'E. VALUE OF PREFERENCE SHARE'). NEVER invent machine translations.",
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
        "Concise uppercase chapter/topic heading, e.g. 'CHAPTER 13: COST OF CAPITAL & WACC' or 'CHAPTER 9: STOCK VALUATION' (keep under 8 words)",
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
    sections: z.array(generatedNoteSectionSchema).min(3).max(6),
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
  ommlEquations?: OmmlTranscribedEquation[];
  ocrEquations?: OcrTranscribedEquation[];
  formulaInventory?: FormulaInventoryItem[];
  formulaLedger?: FormulaLedgerEntry[];
  skipChunkExtraction?: boolean;
  enableVerifierLlm?: boolean;
  verifierModel?: LanguageModel;
  repairModel?: LanguageModel;
  repairFn?: (
    repairPrompt: string,
    signal?: AbortSignal,
  ) => Promise<SynthesisSection[] | NoteSection[]>;
  skipVerifierLlm?: boolean;
  maxRepairAttempts?: number;
  throwOnContradictedFormula?: boolean;
}

export function sanitizeUniversalText(str: string): string {
  if (!str || typeof str !== "string") return str;
  return ensureInlineMathDelimiters(repairCorruptedLatex(cleanTypoString(str)));
}

export function sanitizeFormula(f: NoteFormula): NoteFormula {
  const isDirectLedgerInjected =
    f.formulaRefs &&
    f.formulaRefs.length === 1 &&
    (!f.derivedFrom || f.derivedFrom.length === 0);

  return {
    ...f,
    name: f.name ? sanitizeUniversalText(f.name) : "",
    leadText: f.leadText ? sanitizeUniversalText(f.leadText) : undefined,
    latex: isDirectLedgerInjected
      ? f.latex.replace(/^\$+|\$+$/g, "").trim()
      : repairCorruptedLatex(cleanTypoString(f.latex)).replace(/^\$+|\$+$/g, "").trim(),
    description: f.description ? sanitizeUniversalText(f.description) : undefined,
    variables: (f.variables ?? []).map((v) => ({
      symbol: cleanTypoString(repairCorruptedLatex(v.symbol)).replace(/^\$+|\$+$/g, "").trim(),
      definition: sanitizeUniversalText(v.definition),
    })),
    formulaRefs: f.formulaRefs ? [...f.formulaRefs] : undefined,
    derivedFrom: f.derivedFrom ? [...f.derivedFrom] : undefined,
    slide: f.slide,
    origin: f.origin,
    confidence: f.confidence,
  };
}

/**
 * Backward-compatible alias for sanitizeFormula. Purely typographical/delimiter sanitization.
 * Never rewrites math tokens, denominators, exponents, or tax shields.
 */
export function shieldFormula(
  f: NoteFormula,
  _contextHint?: string,
  _isStockValuation: boolean = true,
  _isChapter10: boolean = false,
  _isChapter11: boolean = false,
  _isChapter26: boolean = false,
): NoteFormula {
  return sanitizeFormula(f);
}

const VIETNAMESE_GRAVE_MAP: Record<string, string> = {
  a: "à", A: "À", ă: "ằ", Ă: "Ằ", â: "ầ", Â: "Ầ",
  e: "è", E: "È", ê: "ề", Ê: "Ề",
  i: "ì", I: "Ì",
  o: "ò", O: "Ò", ô: "ồ", Ô: "Ồ", ơ: "ờ", Ơ: "Ờ",
  u: "ù", U: "Ù", ư: "ừ", Ư: "Ừ",
  y: "ỳ", Y: "Ỳ",
};

export function cleanTypoString(str: string): string {
  if (!str || typeof str !== "string") return str;

  // Protect math spans ($...$, $$...$$, \[...\], \(...\)) from Vietnamese accent composition
  const mathPlaceholders: string[] = [];
  let s = str.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\(.*?\\\)|\$[^$\n]+?\$)/g, (match) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(match);
    return `___MATH_SPAN_${idx}___`;
  });

  // Protect backslash commands (\command) from accent composition
  const cmdPlaceholders: string[] = [];
  s = s.replace(/\\([a-zA-Z]+)/g, (match) => {
    const idx = cmdPlaceholders.length;
    cmdPlaceholders.push(match);
    return `___CMD_SPAN_${idx}___`;
  });

  s = cleanVietnameseSigmaTypos(s.normalize("NFC"));

  // Re-attach isolated or spaced combining diacritical marks to preceding letters and compose to NFC
  s = s.replace(/([\p{L}\p{M}]+)\s+([\u0300-\u036f]+)/gu, "$1$2").normalize("NFC");

  // Repair known Windows DirectWrite/Georgia detached backticks and floating accents
  s = s
    .replace(/đề[\x60'\u00B4]\s*u/gi, "đều")
    .replace(/nhiê[\x60'\u00B4]\s*u/gi, "nhiều")
    .replace(/suấ[\x60'\u00B4]\s*t/gi, "suất")
    .replace(/vố[\x60'\u00B4]\s*n/gi, "vốn")
    .replace(/phiế[\x60'\u00B4]\s*u/gi, "phiếu");

  // Protect English possessives and contractions (e.g. share's, company's, firm's, don't, it's, we'll, etc.)
  const engPlaceholders: string[] = [];
  s = s.replace(/\b([a-zA-Z]+)'(s|t|d|ll|ve|re|m)\b/gi, (match) => {
    const idx = engPlaceholders.length;
    engPlaceholders.push(match);
    return `___ENG_POSS_${idx}___`;
  });

  // Strip stray floating backticks or acute accents right after already toned vowels inside words (e.g. đề`u -> đều)
  s = s.replace(
    /([àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ])[\x60'\u00B4]\s*([a-zA-Z\u00C0-\u1EF9])/gu,
    "$1$2",
  );

  // Strip stray floating backticks before vowels inside words
  s = s.replace(
    /([a-zA-Z\u00C0-\u1EF9])\s*[\x60'\u00B4]([aăâeêioôơuưyAĂÂEÊIOÔƠUƯYàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ])/gu,
    "$1$2",
  );

  // Compose floating backtick/acute ONLY on words that contain genuine Vietnamese diacritics / circumflex / horn / breve (ăâêôơưđ)
  const VIETNAMESE_DIACRITICS_REGEX =
    /[ăâêôơưđĂÂÊÔƠƯĐàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ]/u;

  s = s.replace(/[\p{L}\p{M}]+[\x60'\u00B4][\p{L}\p{M}]+/gu, (word) => {
    if (!VIETNAMESE_DIACRITICS_REGEX.test(word)) {
      return word;
    }
    return word.replace(
      /([aăâeêioôơuưyAĂÂEÊIOÔƠUƯY])[\x60'\u00B4]\s*([a-zA-Z\u00C0-\u1EF9])/gu,
      (_match, v, next) => (VIETNAMESE_GRAVE_MAP[v] || v) + next,
    );
  });

  s = s.normalize("NFC");

  // Restore English possessives
  s = s.replace(/___ENG_POSS_(\d+)___/g, (_m, idx) => engPlaceholders[Number(idx)] ?? _m);

  // Restore backslash commands
  s = s.replace(/___CMD_SPAN_(\d+)___/g, (_m, idx) => cmdPlaceholders[Number(idx)] ?? _m);

  // Restore math spans
  s = s.replace(/___MATH_SPAN_(\d+)___/g, (_m, idx) => mathPlaceholders[Number(idx)] ?? _m);

  return s
    .replace(/\b([gG])\s*=\s*[oO]\b/g, "$1 = 0")
    .replace(/\(([gG])\s*=\s*[oO]\)/g, "($1 = 0)")
    .replace(/\\text\{[gG]\s*=\s*[oO]\}/g, "\\text{$1 = 0}")
    .replace(/\bP_o\b/g, "P_0")
    .replace(/\bD_o\b/g, "D_0")
    .replace(/\bR_o\b/g, "R_0")
    .replace(/\bP_\{o\}\b/g, "P_{0}")
    .replace(/\bD_\{o\}\b/g, "D_{0}")
    .replace(/\bR_\{o\}\b/g, "R_{0}");
}

export function sanitizeAcademicHeader(
  rawTitle: string,
  letter: string,
  _isStockValuation: boolean = false,
): string {
  let title = rawTitle.trim();

  // Strip leading prefixes like "Header B: ", "B. ", "1. ", "Section B: "
  title = title
    .replace(/^(header\s+[a-z0-9]+[:\s\-]+|section\s+[a-z0-9]+[:\s\-]+|[a-z0-9]+[\.\:\-]\s*)/i, "")
    .trim();

  // Purge absurd machine translations (keep only multi-word gibberish phrases)
  title = title
    .replace(/cứu trợ chứng khoán/gi, "CỔ PHIẾU")
    .replace(/hạnh hạnh/gi, "TĂNG TRƯỞNG ĐỀU")
    .replace(/ritm không đổi/gi, "MÔ HÌNH KHÔNG TĂNG TRƯỞNG")
    .replace(/ritm/gi, "DDM")
    .replace(/bổ trợ hợp tác/gi, "CỔ PHIẾU ƯU ĐÃI HOÃN TRẢ");

  const cleanStripped = title.replace(/^[A-Z0-9]+\.\s*/i, "").trim();
  return `${letter}. ${cleanStripped.toUpperCase()}`;
}

export function sanitizeSubSectionHeading(heading: string): string {
  let h = heading.trim();
  h = h
    .replace(/cứu trợ chứng khoán/gi, "Cổ phiếu")
    .replace(/hạnh hạnh/gi, "Tăng trưởng đều")
    .replace(/ritm không đổi/gi, "Không tăng trưởng")
    .replace(/ritm/gi, "DDM")
    .replace(/bổ trợ hợp tác/gi, "Cổ phiếu ưu đãi hoãn trả");
  return cleanTypoString(h);
}

/**
 * Non-mutating formula linter that returns warning strings when suspicious mathematical
 * or financial formula patterns are detected.
 */
export function lintFormula(f: NoteFormula, contextHint?: string): string[] {
  const warnings: string[] = [];
  const latex = f.latex ?? "";
  const hint = contextHint ?? "";

  // 1. Growing perpetuity with R + g or r + g in denominator
  const growingPerpetuityAddition =
    /\\frac\{[^{}]+\}\{\s*(?:[RrKk]|R_[Ee])\s*\+\s*g\s*\}|\/\s*\(\s*(?:[RrKk]|R_[Ee])\s*\+\s*g\s*\)/i.test(
      latex,
    );
  if (growingPerpetuityAddition) {
    warnings.push(
      "Growing perpetuity formula has addition (R + g) in denominator instead of subtraction (R - g).",
    );
  }

  // 2. (1 - T_C) attached to R_E or R_P inside a WACC equation
  // (do NOT flag M&M Proposition II R_E = R_A + (R_A - R_D)(D/E)(1 - T_C))
  const isWaccContext =
    /wacc|chi phí (sử dụng )?vốn bình quân/i.test(latex) ||
    /wacc|chi phí (sử dụng )?vốn bình quân/i.test(hint);
  const isMMProposition =
    /R_A|R_U|R_0|proposition|m&m/i.test(latex) ||
    /proposition|m&m/i.test(hint);

  if (isWaccContext && !isMMProposition) {
    const hasEquityTaxShield =
      /(?:R_[Ee]|R_[Pp])\s*\(1\s*-\s*T_C\)/.test(latex) ||
      /\(1\s*-\s*T_C\)\s*(?:R_[Ee]|R_[Pp])/.test(latex) ||
      /w_[Ee]\s*R_[Ee]\s*\(1\s*-\s*T_C\)/.test(latex) ||
      /w_[Pp]\s*R_[Pp]\s*\(1\s*-\s*T_C\)/.test(latex) ||
      /\\left\(\\frac\{[EP]\}\{V\}\\right\)\s*R_[EP]\s*\(1\s*-\s*T_C\)/.test(latex) ||
      /\(\\frac\{[EP]\}\{V\}\)\s*R_[EP]\s*\(1\s*-\s*T_C\)/.test(latex);

    if (hasEquityTaxShield) {
      warnings.push(
        "Tax shield (1 - T_C) incorrectly attached to cost of equity (R_E) or preferred stock (R_P) in WACC equation.",
      );
    }
  }

  // 3. 1-period holding formula (D_1 and P_1 without \sum) using exponent ^T or ^t
  const isOnePeriod =
    /D_?1/i.test(latex) &&
    /P_?1/i.test(latex) &&
    !/\\sum/i.test(latex);
  const hasOnePeriodExponent =
    /\(1\s*\+\s*[^)]+\)\s*\^\s*\{?[Tt]\}?/.test(latex);

  if (isOnePeriod && hasOnePeriodExponent) {
    warnings.push(
      "1-period holding formula contains multi-period exponent (^T or ^t).",
    );
  }

  // 4. Growth rate g = defined via circular price change (P_1 - P_0)/P_0 or \Delta P / P_0
  const isSolvingForGrowth =
    /^\s*g\s*=/i.test(latex) ||
    (/finding.*growth|growth.*rate|\(g\)/i.test(hint) && /\bg\s*=/.test(latex));
  const isCircularPriceAppreciation =
    /\\frac\{\s*P_?1\s*-\s*P_?0\s*\}\{\s*P_?0\s*\}|\(?\s*P_?1\s*-\s*P_?0\s*\)?\s*\/\s*P_?0|\\Delta\s*P\s*\/\s*P_?0|\\frac\{\s*\\Delta\s*P\s*\}\{\s*P_?0\s*\}/i.test(
      latex,
    );

  if (isSolvingForGrowth && isCircularPriceAppreciation) {
    warnings.push(
      "Growth rate g is defined via circular price change ((P_1 - P_0)/P_0) instead of sustainable reinvestment policy.",
    );
  }

  // 5. Arithmetic mean \bar{R} divided by T - 1 or n - 1
  const isArithmeticMean =
    (/\\bar\{R\}|arithmetic|số học/i.test(latex) ||
      (/arithmetic|số học|trung bình cộng/i.test(hint) &&
        !/variance|phương sai|độ lệch chuẩn|s\^2/i.test(hint))) &&
    !/\(R_t\s*-\s*\\bar\{R\}\)\^2|s\^2/i.test(latex);

  const dividesBySampleMinusOne =
    /\\frac\{1\}\{\s*[Tn]\s*-\s*1\s*\}|\/\s*\(?\s*[Tn]\s*-\s*1\s*\)?/.test(latex);

  if (isArithmeticMean && dividesBySampleMinusOne) {
    warnings.push(
      "Arithmetic mean is divided by T - 1 or n - 1 instead of total periods T or n.",
    );
  }

  // 6. Sample variance s^2 (squared deviations without P_i) divided by T instead of T - 1, or mixed with P_i
  const isHistoricalSampleVar =
    /s\^2/i.test(latex) ||
    (/\(R_t\s*-\s*\\bar\{R\}\)\^2/i.test(latex) && !/P_i|p_i/i.test(latex));

  if (isHistoricalSampleVar) {
    const dividesByTOnly =
      /\\frac\{1\}\{\s*[Tn]\s*\}(?!\s*-\s*1)|\/\s*[Tn](?![A-Za-z0-9_\-\s]*-\s*1)/.test(latex);
    if (dividesByTOnly) {
      warnings.push(
        "Sample variance s^2 is divided by T or n instead of Bessel-corrected T - 1 or n - 1.",
      );
    }
    if (/P_i|p_i/i.test(latex)) {
      warnings.push(
        "Sample variance s^2 erroneously includes scenario probability P_i.",
      );
    }
  }

  // 7. Scenario variance \sigma^2 with P_i also divided by T or T - 1
  const isScenarioVariance =
    (/\\sigma\^2|\\sigma\b/i.test(latex) || /scenario|kịch bản/i.test(hint)) &&
    /P_i|p_i/i.test(latex);
  const dividesBySample =
    /\\frac\{1\}\{\s*[Tn]\s*(?:-\s*1)?\s*\}|\/\s*\(?\s*[Tn]\s*(?:-\s*1)?\s*\)?/.test(latex);

  if (isScenarioVariance && dividesBySample) {
    warnings.push(
      "Scenario variance sigma^2 with probability weights P_i is also divided by sample size T or T - 1.",
    );
  }

  return warnings;
}

/**
 * Removes a top-level formula if an equivalent formula already exists inside sec.subSections.
 */
function deduplicateSectionC(sec: NoteSection): NoteSection {
  if (!sec.subSections || sec.subSections.length === 0) {
    return sec;
  }
  const subKeys = new Set<string>();
  for (const sub of sec.subSections) {
    for (const f of sub.formulas) {
      const k = normalizeFormulaKey(f.latex);
      if (k) subKeys.add(k);
    }
  }
  return {
    ...sec,
    formulas: sec.formulas.filter((f) => !subKeys.has(normalizeFormulaKey(f.latex))),
  };
}

/**
 * Deduplicates multiple subSections in the same section that cover the exact same case or topic.
 */
function deduplicateSubSections(subSections: NoteSubSection[]): NoteSubSection[] {
  const seenCategories = new Set<string>();
  const deduplicated: NoteSubSection[] = [];

  for (const sub of subSections) {
    let cat = "";
    if (/case\s*1|zero\s*growth|không\s*tăng\s*trưởng/i.test(sub.heading)) cat = "case1";
    else if (/case\s*2|constant\s*growth|tăng\s*trưởng\s*đều|gordon/i.test(sub.heading)) cat = "case2";
    else if (/case\s*3|differential|non-?constant|nhiều\s*giai\s*đoạn/i.test(sub.heading)) cat = "case3";
    else if (/finding.*growth|\(g\)/i.test(sub.heading)) cat = "finding-g";
    else if (/finding.*(discount|return)|\(r\)/i.test(sub.heading)) cat = "finding-r";
    else if (/deferred|hoãn\s*trả|delayed/i.test(sub.heading)) cat = "deferred";

    if (cat && seenCategories.has(cat)) {
      const existing = deduplicated.find((item) => {
        if (cat === "case1") return /case\s*1|zero\s*growth|không\s*tăng\s*trưởng/i.test(item.heading);
        if (cat === "case2") return /case\s*2|constant\s*growth|tăng\s*trưởng\s*đều|gordon/i.test(item.heading);
        if (cat === "case3") return /case\s*3|differential|non-?constant|nhiều\s*giai\s*đoạn/i.test(item.heading);
        if (cat === "finding-g") return /finding.*growth|\(g\)/i.test(item.heading);
        if (cat === "finding-r") return /finding.*(discount|return)|\(r\)/i.test(item.heading);
        if (cat === "deferred") return /deferred|hoãn\s*trả|delayed/i.test(item.heading);
        return false;
      });

      if (existing) {
        for (const bp of sub.bulletPoints) {
          if (!existing.bulletPoints.includes(bp)) {
            existing.bulletPoints.push(bp);
          }
        }
        if (sub.groundedBullets && sub.groundedBullets.length > 0) {
          if (!existing.groundedBullets) existing.groundedBullets = [];
          for (const gb of sub.groundedBullets) {
            if (
              !existing.groundedBullets.some(
                (egb) => egb.text === gb.text && egb.slide === gb.slide,
              )
            ) {
              existing.groundedBullets.push(gb);
            }
          }
        }
        for (const f of sub.formulas) {
          if (!existing.formulas.some((ef) => ef.latex === f.latex)) {
            existing.formulas.push(f);
          }
        }
        continue;
      }
    }

    if (cat) seenCategories.add(cat);
    deduplicated.push(sub);
  }

  return deduplicated;
}

function stripOuterParens(expr: string): string {
  let s = expr;
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let matchedEnd = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") {
        depth--;
        if (depth === 0) {
          matchedEnd = (i === s.length - 1);
          break;
        }
      }
    }
    if (matchedEnd) {
      s = s.slice(1, -1);
    } else {
      break;
    }
  }
  return s;
}

/**
 * Structure-preserving formula key normalizer for equivalence and deduplication checking.
 * Strips display/spacing commands (\left, \right, \quad, \qquad, \displaystyle, \mathbf, \mathrm, \text)
 * and whitespace, normalizes {x} single-token braces to x, and lowercases.
 * PRESERVES structural operators: ^, _, /, +, -, (, ), \frac, \sum, \sqrt, \prod.
 */
export function normalizeFormulaKey(latex: string): string {
  if (!latex || typeof latex !== "string") return "";

  let s = latex.trim().replace(/^\$+|\$+$/g, "").trim();

  // Strip font/text wrappers: \text{foo} -> foo, \mathrm{foo} -> foo, \mathbf{foo} -> foo
  s = s.replace(/\\(?:text|mathrm|mathbf)\{([^{}]+)\}/g, "$1");

  // Strip standalone display/spacing commands
  s = s.replace(/\\(left|right)\./g, "");
  s = s.replace(/\\(left|right|quad|qquad|displaystyle|mathbf|mathrm|text)\b/g, "");

  // Strip whitespace
  s = s.replace(/\s+/g, "");

  // Strip outer enclosing parentheses from entire formula or on either side of '='
  if (s.includes("=")) {
    const parts = s.split("=");
    s = parts.map((part) => stripOuterParens(part)).join("=");
  } else {
    s = stripOuterParens(s);
  }

  // Normalize single-token braces: {x} -> x (e.g. P_{0} -> P_0, (1+R)^{t} -> (1+R)^t, {1} -> 1)
  while (/\{([a-zA-Z0-9])\}/.test(s)) {
    s = s.replace(/\{([a-zA-Z0-9])\}/g, "$1");
  }

  return s.toLowerCase();
}

/**
 * Deduplicates a list of formula cards:
 * 1. Removes identical or equivalent formulas based on normalized LaTeX.
 * 2. Prunes standalone redundant standard deviation formulas (\sigma_p = \sqrt{\sigma_p^2}, s = \sqrt{s^2})
 *    if an earlier formula card in the list already defined variance and standard deviation.
 */
export function deduplicateFormulaList(formulas: NoteFormula[]): NoteFormula[] {
  if (!formulas || formulas.length === 0) return [];
  const result: NoteFormula[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < formulas.length; i++) {
    const f = formulas[i];
    const key = normalizeFormulaKey(f.latex);

    // 1. Exact or normalized duplicate check
    if (key && seenKeys.has(key)) {
      continue;
    }

    // 2. Check if this is a standalone standard deviation formula that was already defined
    // in an earlier formula card in the same list
    const cleanLatex = f.latex.trim().replace(/\\(left|right)/g, "");
    const isStandaloneStdDev =
      /^\\sigma_p\s*=\s*\\sqrt\{\\sigma_p\^?2\}$/i.test(cleanLatex) ||
      /^\\sigma\s*=\s*\\sqrt\{\\sigma\^?2\}$/i.test(cleanLatex) ||
      /^s\s*=\s*\\sqrt\{s\^?2\}$/i.test(cleanLatex);

    if (isStandaloneStdDev) {
      const prevDefinesStdDev = result.some((prev) => {
        const prevClean = prev.latex.replace(/\\(left|right)/g, "");
        if (/\\sigma_p/i.test(f.latex)) {
          return /\\sigma_p\^?2.*\\sqrt\{\\sigma_p\^?2\}|\\sigma_p\s*=\s*\\sqrt\{\\sigma_p\^?2\}/i.test(
            prevClean,
          );
        }
        if (/s\s*=\s*\\sqrt\{s\^?2\}/i.test(f.latex)) {
          return /s\^?2.*\\sqrt\{s\^?2\}|s\s*=\s*\\sqrt\{s\^?2\}/i.test(prevClean);
        }
        if (/\\sigma\s*=\s*\\sqrt\{\\sigma\^?2\}/i.test(f.latex)) {
          return /\\sigma\^?2.*\\sqrt\{\\sigma\^?2\}|\\sigma\s*=\s*\\sqrt\{\\sigma\^?2\}/i.test(
            prevClean,
          );
        }
        return false;
      });

      if (prevDefinesStdDev) {
        continue;
      }
    }

    seenKeys.add(key);
    result.push(f);
  }

  return result;
}

/**
 * Universal intra-section formula deduplicator:
 * Normalizes formula latex and removes identical or equivalent formulas,
 * pruning top-level formulas that already exist in subSections.
 */
export function deduplicateSectionFormulas(sec: NoteSection): NoteSection {
  const dedupedSubSections = (sec.subSections || []).map((sub) => ({
    ...sub,
    formulas: deduplicateFormulaList(sub.formulas || []),
  }));

  const subFormulaKeys = new Set<string>();
  for (const sub of dedupedSubSections) {
    for (const f of sub.formulas) {
      const key = normalizeFormulaKey(f.latex);
      if (key) subFormulaKeys.add(key);
    }
  }

  const dedupedTopFormulas = deduplicateFormulaList(sec.formulas || []).filter(
    (f) => !subFormulaKeys.has(normalizeFormulaKey(f.latex)),
  );

  return {
    ...sec,
    formulas: dedupedTopFormulas,
    subSections: dedupedSubSections.length > 0 ? dedupedSubSections : sec.subSections,
  };
}

/**
 * Consolidates fragmented sections (e.g. when an LLM outputs 8–10 sections by splitting
 * every case and parameter into separate top-level sections) into the canonical 5 sections.
 * Never drops sections or formulas!
 */
function consolidateFragmentedSections(
  sections: NoteSection[],
  rawSlideText: string,
): NoteSection[] {
  const isWaccOrCostOfCapital =
    /wacc|cost of capital|chi phí (sử dụng )?vốn|chi phí vốn/i.test(
      `${rawSlideText} ${sections.map((s) => s.titleVi).join(" ")}`,
    );

  const isChapter9StockValuation =
    !isWaccOrCostOfCapital &&
    (/stock valuation|định giá cổ phiếu|dividend discount|gordon growth/i.test(rawSlideText) ||
      /stock valuation|định giá cổ phiếu/i.test(sections.map((s) => s.titleVi).join(" ")) ||
      /ddm|ritm|hạnh hạnh/i.test(
        `${rawSlideText} ${sections.map((s) => s.titleVi).join(" ")}`,
      ));

  if (!isChapter9StockValuation) {
    return sections;
  }

  const isFragmented =
    sections.length > 5 ||
    sections.some((s) =>
      /case\s*[123]|ritm|hạnh hạnh|zero growth|tăng trưởng đều|không tăng trưởng|differential|finding.*growth|finding.*discount|cứu trợ|bổ trợ/i.test(
        s.titleVi,
      ),
    );

  if (!isFragmented) {
    return sections;
  }

  let sectionA: NoteSection | null = null;
  let sectionB: NoteSection | null = null;
  let sectionC: NoteSection | null = null;
  let sectionD: NoteSection | null = null;
  let sectionE: NoteSection | null = null;
  const unmatchedSections: NoteSection[] = [];

  function mergeIntoSection(target: NoteSection, sec: NoteSection) {
    if (sec.bulletPoints && sec.bulletPoints.length > 0) {
      target.bulletPoints.push(...sec.bulletPoints);
    }
    if (sec.groundedBullets && sec.groundedBullets.length > 0) {
      target.groundedBullets = [
        ...(target.groundedBullets || []),
        ...sec.groundedBullets,
      ];
    }
    if (sec.formulas && sec.formulas.length > 0) {
      target.formulas.push(...sec.formulas);
    }
    if (sec.subSections && sec.subSections.length > 0) {
      target.subSections = [...(target.subSections || []), ...sec.subSections];
    }
    if (sec.sourceSlides && sec.sourceSlides.length > 0) {
      const combined = new Set([...(target.sourceSlides || []), ...sec.sourceSlides]);
      target.sourceSlides = Array.from(combined).sort((a, b) => a - b);
    }
    if (sec.keyTakeaways) {
      if (!target.keyTakeaways) {
        target.keyTakeaways = { ...sec.keyTakeaways };
      } else {
        target.keyTakeaways = {
          ...target.keyTakeaways,
          items: [
            ...(target.keyTakeaways.items || []),
            ...(sec.keyTakeaways.items || []),
          ],
          summaryPoints: [
            ...(target.keyTakeaways.summaryPoints || []),
            ...(sec.keyTakeaways.summaryPoints || []),
          ],
        };
      }
    }
  }

  for (const sec of sections) {
    const title = sec.titleVi.toLowerCase();

    // Section A: Fundamental Principle
    if (/nguyên lý|cơ bản|fundamental.*principle/i.test(title)) {
      if (!sectionA) sectionA = { ...sec };
      else mergeIntoSection(sectionA, sec);
      continue;
    }

    // Section B: One-Period Formula
    if (/công thức tổng quát|tổng quát|one-period|đầu tư trong 1 năm/i.test(title)) {
      if (!sectionB) sectionB = { ...sec };
      else mergeIntoSection(sectionB, sec);
      continue;
    }

    // Section D: Parameters (Finding g / Finding R)
    if (
      /parameters|tham số|finding.*(growth|discount|r|g)|growth rate|discount rate|tốc độ tăng trưởng/i.test(
        title,
      ) ||
      (sec.subSections &&
        sec.subSections.some((sub) => /finding.*(growth|discount|r|g)/i.test(sub.heading)))
    ) {
      if (!sectionD) {
        sectionD = {
          ...sec,
          titleVi: "D. PARAMETERS IN DIVIDEND DISCOUNT MODEL",
          formulas: [...sec.formulas],
          subSections:
            sec.subSections && sec.subSections.length > 0
              ? [...sec.subSections]
              : [
                  {
                    heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
                    bulletPoints: [...sec.bulletPoints],
                    groundedBullets: sec.groundedBullets
                      ? [...sec.groundedBullets]
                      : undefined,
                    formulas: [...sec.formulas],
                  },
                ],
        };
      } else {
        mergeIntoSection(sectionD, sec);
      }
      continue;
    }

    // Section E: Preference Shares / Deferred Preferred
    if (
      /preference|preferred|ưu đãi|ưu tiên|cứu trợ|bổ trợ/i.test(title) ||
      (sec.subSections &&
        sec.subSections.some((sub) =>
          /preference|preferred|ưu đãi|ưu tiên|cứu trợ|bổ trợ/i.test(sub.heading),
        ))
    ) {
      if (!sectionE) {
        sectionE = {
          ...sec,
          titleVi: "E. VALUE OF PREFERENCE SHARE",
          formulas: [...sec.formulas],
          subSections:
            sec.subSections && sec.subSections.length > 0
              ? [...sec.subSections]
              : [
                  {
                    heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
                    bulletPoints: [...sec.bulletPoints],
                    groundedBullets: sec.groundedBullets
                      ? [...sec.groundedBullets]
                      : undefined,
                    formulas: [...sec.formulas],
                  },
                ],
        };
      } else {
        mergeIntoSection(sectionE, sec);
      }
      continue;
    }

    // Section C: DDM & Cases (Zero Growth, Constant Growth, Differential Growth, ritm, hạnh hạnh)
    if (
      /ddm|dividend discount|case\s*[123]|zero growth|constant growth|tăng trưởng|ritm|hạnh hạnh/i.test(
        title,
      ) ||
      sec.formulas.some((f) =>
        /\\sum|D_?1\s*\/\s*\(R\s*-\s*g\)|D\s*\/\s*R/i.test(f.latex),
      )
    ) {
      if (!sectionC) {
        sectionC = {
          ...sec,
          titleVi: "C. DDM (DIVIDEND DISCOUNT MODEL)",
          formulas: [...sec.formulas],
          subSections:
            sec.subSections && sec.subSections.length > 0
              ? [...sec.subSections]
              : [
                  {
                    heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
                    bulletPoints: [...sec.bulletPoints],
                    groundedBullets: sec.groundedBullets
                      ? [...sec.groundedBullets]
                      : undefined,
                    formulas: [...sec.formulas],
                  },
                ],
        };
      } else {
        mergeIntoSection(sectionC, sec);
      }
      continue;
    }

    unmatchedSections.push(sec);
  }

  const result: NoteSection[] = [];
  if (sectionA) result.push(sectionA);
  if (sectionB) result.push(sectionB);
  if (sectionC) result.push(sectionC);
  if (sectionD) result.push(sectionD);
  if (sectionE) result.push(sectionE);

  for (const unmatched of unmatchedSections) {
    if (result.length < 5) {
      result.push(unmatched);
    } else {
      const lastSection = result[result.length - 1];
      const extraSubHeading = unmatched.titleVi.replace(/^[A-Z0-9]+\.\s*/i, "").trim();
      const newSub: NoteSubSection = {
        heading: extraSubHeading,
        leadIn: unmatched.overview || undefined,
        bulletPoints: [...unmatched.bulletPoints],
        groundedBullets: unmatched.groundedBullets
          ? [...unmatched.groundedBullets]
          : undefined,
        formulas: [...unmatched.formulas],
      };
      if (unmatched.subSections && unmatched.subSections.length > 0) {
        lastSection.subSections = [
          ...(lastSection.subSections || []),
          newSub,
          ...unmatched.subSections,
        ];
      } else {
        lastSection.subSections = [...(lastSection.subSections || []), newSub];
      }
      if (unmatched.keyTakeaways) {
        if (!lastSection.keyTakeaways) {
          lastSection.keyTakeaways = { ...unmatched.keyTakeaways };
        } else {
          lastSection.keyTakeaways = {
            ...lastSection.keyTakeaways,
            items: [
              ...(lastSection.keyTakeaways.items || []),
              ...(unmatched.keyTakeaways.items || []),
            ],
            summaryPoints: [
              ...(lastSection.keyTakeaways.summaryPoints || []),
              ...(unmatched.keyTakeaways.summaryPoints || []),
            ],
          };
        }
      }
      if (unmatched.sourceSlides && unmatched.sourceSlides.length > 0) {
        const combined = new Set([...(lastSection.sourceSlides || []), ...unmatched.sourceSlides]);
        lastSection.sourceSlides = Array.from(combined).sort((a, b) => a - b);
      }
    }
  }

  return result.length >= 3 ? result : sections;
}

/**
 * Universally consolidates sections into strictly 3–5 canonical sections (A through E)
 * across any course or academic discipline (Finance, Economics, Accounting, Statistics, STEM).
 * Preserves keyTakeaways items, summaryPoints, and sourceSlides from merged extra sections.
 */
function consolidateSectionsUniversally(
  sections: NoteSection[],
  rawSlideText: string,
  isChapter9StockValuation: boolean,
): NoteSection[] {
  if (isChapter9StockValuation) {
    return consolidateFragmentedSections(sections, rawSlideText);
  }

  // If sections are already between 3 and 5, keep them as is
  if (sections.length <= 5 && sections.length >= 3) {
    return sections;
  }

  // If sections > 5, consolidate into exactly 5 canonical sections (A through E)
  if (sections.length > 5) {
    const headSections = sections.slice(0, 4);
    const baseSectionE = { ...sections[4] };
    const mergedSubSections: NoteSubSection[] = baseSectionE.subSections
      ? [...baseSectionE.subSections]
      : [];

    for (let i = 5; i < sections.length; i++) {
      const extraSec = sections[i];
      const extraSubHeading = extraSec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, "").trim();
      mergedSubSections.push({
        heading: extraSubHeading,
        leadIn: extraSec.overview || undefined,
        bulletPoints: [...extraSec.bulletPoints],
        groundedBullets: extraSec.groundedBullets
          ? [...extraSec.groundedBullets]
          : undefined,
        formulas: [...extraSec.formulas],
      });
      if (extraSec.subSections && extraSec.subSections.length > 0) {
        mergedSubSections.push(...extraSec.subSections);
      }
      if (extraSec.keyTakeaways) {
        if (!baseSectionE.keyTakeaways) {
          baseSectionE.keyTakeaways = { ...extraSec.keyTakeaways };
        } else {
          baseSectionE.keyTakeaways = {
            ...baseSectionE.keyTakeaways,
            items: [
              ...(baseSectionE.keyTakeaways.items || []),
              ...(extraSec.keyTakeaways.items || []),
            ],
            summaryPoints: [
              ...(baseSectionE.keyTakeaways.summaryPoints || []),
              ...(extraSec.keyTakeaways.summaryPoints || []),
            ],
          };
        }
      }
      if (extraSec.sourceSlides && extraSec.sourceSlides.length > 0) {
        const combined = new Set([...(baseSectionE.sourceSlides || []), ...extraSec.sourceSlides]);
        baseSectionE.sourceSlides = Array.from(combined).sort((a, b) => a - b);
      }
    }

    baseSectionE.subSections = mergedSubSections;
    return [...headSections, baseSectionE];
  }

  return sections;
}

/**
 * Universal Formula Harvester:
 * Extracts distinct mathematical/valuation formulas from prose bullet points or text
 * when an LLM relegated an equation to text.
 */
export function harvestEquationsFromText(line: string): NoteFormula[] {
  if (!line || typeof line !== "string" || !line.includes("=")) return [];

  // Indicators that text contains a quantitative, financial, or valuation formula
  const hasMathIndicators =
    /\\frac|\\sum|\\sqrt|\\prod|\\beta|\\sigma|\\rho|\\times|\\cdot|\\Delta|\^|\/|\+|-|\b(NPV|IRR|WACC|ROE|ROA|EAR|APR|YTM|CAPM|E\[R\]|Cov|Corr|Beta|DuPont|COGS|EBIT|EBITDA|EVA|FCF|PV|FV|PMT|P_0|P_1|P_t|D_1|D_0|EPS|DPS|PE|P\/E|Retention|Payout|Variance|StdDev|NWC|Cash|Debt|Equity|Turnover|Period|Cycle|Collections|Disbursements|Inventory|Receivables|Payables|DSO|Working Capital|Sales)\b/i.test(
      line,
    );

  if (!hasMathIndicators) return [];

  // Avoid trivial assignments without calculation (e.g. "let t = 1", "g = 0", "N = 5")
  if (/^\s*[a-zA-Z_]\s*=\s*[0-9a-zA-Z_]\s*$/i.test(line.trim())) return [];

  const results: NoteFormula[] = [];

  // 1. Check for inline math delimiters: $...=...$ or $$...=...$$
  const mathDelimMatches = [...line.matchAll(/\${1,2}([^$]+=[^$]+)\${1,2}/g)];
  if (mathDelimMatches.length > 0) {
    for (const match of mathDelimMatches) {
      const rawEquation = match[1].trim();
      const prefix = line.slice(0, match.index).trim().replace(/[:\-–—]+$/, "").trim();
      const cleaned = repairCorruptedLatex(cleanTypoString(rawEquation)).replace(/^\$+|\$+$/g, "").trim();
      if (cleaned.length >= 3 && cleaned.includes("=")) {
        results.push({
          name: "",
          leadText: prefix.length > 0 && prefix.length < 60 ? sanitizeUniversalText(`${prefix}:`) : undefined,
          latex: formatAccountingFormula(cleaned),
          description: undefined,
          variables: [],
        });
      }
    }
    if (results.length > 0) return results;
  }

  // 2. Prose equation patterns: split by semicolon or newline if multiple equations exist
  const subClauses = line.split(/[;\n]+/);
  for (const clause of subClauses) {
    if (!clause.includes("=")) continue;

    const colonIndex = clause.indexOf(":");
    let leadText: string | undefined = undefined;
    let eqText = clause;

    if (colonIndex > 0) {
      const beforeColon = clause.slice(0, colonIndex).trim();
      const afterColon = clause.slice(colonIndex + 1).trim();
      if (afterColon.includes("=")) {
        leadText = beforeColon;
        eqText = afterColon;
      } else if (beforeColon.includes("=")) {
        eqText = beforeColon;
        leadText = undefined;
      }
    }

    const cleanedEq = eqText
      .replace(/^[-*•\d\.\s]+/, "") // remove leading bullet marks
      .replace(/\s*\([^)]*\)\s*$/, "") // remove trailing parenthetical explanations
      .replace(/[.;,]+$/, "") // remove trailing punctuation
      .trim();

    if (cleanedEq.length < 3 || !cleanedEq.includes("=")) continue;

    const formatted = formatAccountingFormula(
      repairCorruptedLatex(cleanTypoString(cleanedEq)).replace(/^\$+|\$+$/g, "").trim(),
    );

    if (formatted.length >= 3 && formatted.includes("=")) {
      results.push({
        name: "",
        leadText: leadText ? sanitizeUniversalText(`${leadText}:`) : undefined,
        latex: formatted,
        description: undefined,
        variables: [],
      });
    }
  }

  return results;
}

export function harvestEquationFromText(line: string): NoteFormula | null {
  const formulas = harvestEquationsFromText(line);
  return formulas.length > 0 ? formulas[0] : null;
}

/**
 * Universal Post-Processing Shield:
 * Ensures clean typography, KaTeX delimiters, and structure consolidation.
 * Never authors academic content, never rewrites formula semantics, and never drops sections.
 */
export function applyHallucinationShield(
  sections: NoteSection[],
  rawSlideText: string = "",
): NoteSection[] {
  const normSlideText = rawSlideText.toLowerCase();
  const allTitlesText = sections.map((s) => s.titleVi).join(" ").toLowerCase();
  const combinedContext = `${normSlideText} ${allTitlesText}`;

  const isWaccOrCostOfCapital =
    /wacc|cost of capital|chi phí (sử dụng )?vốn|chi phí vốn/i.test(combinedContext);

  const isChapter9StockValuation =
    !isWaccOrCostOfCapital &&
    (/stock valuation|định giá cổ phiếu|dividend discount|gordon growth/i.test(rawSlideText) ||
      /stock valuation|định giá cổ phiếu/i.test(allTitlesText) ||
      /ddm|ritm|hạnh hạnh/i.test(combinedContext));

  // Step 1: Consolidate fragmented sections universally into 3–5 canonical sections
  const consolidated = consolidateSectionsUniversally(
    sections,
    rawSlideText,
    isChapter9StockValuation,
  );

  // Step 2: Apply fine-grained formula and header sanitization
  const processed = consolidated.map((sec, idx) => {
    const sequentialLetter = String.fromCharCode(65 + idx);

    // 2a. Sanitize headers and purge machine-translation hallucinations
    sec.titleVi = sanitizeAcademicHeader(sec.titleVi, sequentialLetter, isChapter9StockValuation);
    sec.letter = sequentialLetter;
    sec.id = `sec-${sequentialLetter.toLowerCase()}-${idx + 1}`;

    if (sec.coreStatement)
      sec.coreStatement = sanitizeUniversalText(sec.coreStatement);
    if (sec.overview)
      sec.overview = sanitizeUniversalText(sec.overview);
    sec.bulletPoints = Array.isArray(sec.bulletPoints)
      ? sec.bulletPoints.map(sanitizeUniversalText)
      : [];
    if (sec.groundedBullets) {
      sec.groundedBullets = sec.groundedBullets.map((gb) => ({
        text: sanitizeUniversalText(gb.text),
        slide: gb.slide,
        evidence: gb.evidence,
      }));
    }

    if (sec.keyTakeaways) {
      if (sec.keyTakeaways.title) {
        sec.keyTakeaways.title = cleanTypoString(sec.keyTakeaways.title);
      }
      if (sec.keyTakeaways.items) {
        sec.keyTakeaways.items = sec.keyTakeaways.items.map((item) => ({
          point: sanitizeUniversalText(item.point),
          subBullets: (item.subBullets ?? []).map(sanitizeUniversalText),
          slide: item.slide,
          evidence: item.evidence,
        }));
      }
      if (sec.keyTakeaways.boundaryConditions) {
        sec.keyTakeaways.boundaryConditions = sanitizeUniversalText(
          sec.keyTakeaways.boundaryConditions,
        );
      }
      if (sec.keyTakeaways.modelSelectionRule) {
        sec.keyTakeaways.modelSelectionRule = sanitizeUniversalText(
          sec.keyTakeaways.modelSelectionRule,
        );
      }
      if (sec.keyTakeaways.realWorldConditions) {
        sec.keyTakeaways.realWorldConditions = sanitizeUniversalText(
          sec.keyTakeaways.realWorldConditions,
        );
      }
      sec.keyTakeaways.summaryPoints = (sec.keyTakeaways.summaryPoints ?? []).map(
        sanitizeUniversalText,
      );
    }

    // 2b. Sanitize formulas at section top-level (purely typographical / delimiter)
    sec.formulas = sec.formulas.map(sanitizeFormula);

    // 2c. Sanitize sub-sections
    if (sec.subSections) {
      sec.subSections = deduplicateSubSections(sec.subSections);
      sec.subSections = sec.subSections.map((sub) => {
        sub.heading = sanitizeSubSectionHeading(sub.heading);
        if (sub.leadIn)
          sub.leadIn = sanitizeUniversalText(sub.leadIn);
        sub.bulletPoints = sub.bulletPoints.map(sanitizeUniversalText);
        if (sub.groundedBullets) {
          sub.groundedBullets = sub.groundedBullets.map((gb) => ({
            text: sanitizeUniversalText(gb.text),
            slide: gb.slide,
            evidence: gb.evidence,
          }));
        }
        sub.formulas = sub.formulas.map(sanitizeFormula);
        return sub;
      });
    }

    // 2d. Section C top-level deduplication against subSections (structure-preserving)
    if (isChapter9StockValuation) {
      sec = deduplicateSectionC(sec);
    }

    return sec;
  });

  // Step 3: Collect non-mutating lint warnings across all sections and subSections
  const warnings: string[] = [];
  for (const sec of processed) {
    for (const f of sec.formulas) {
      warnings.push(...lintFormula(f, sec.titleVi));
    }
    if (sec.subSections) {
      for (const sub of sec.subSections) {
        for (const f of sub.formulas) {
          warnings.push(...lintFormula(f, `${sec.titleVi} ${sub.heading}`));
        }
      }
    }
  }
  if (warnings.length > 0) {
    console.warn("[ClutchNotes][lint]", warnings);
  }

  return processed.map(deduplicateSectionFormulas);
}

function sanitizeSubSection(sub: NoteSubSection): NoteSubSection {
  return {
    ...sub,
    heading: sanitizeSubSectionHeading(sub.heading),
    leadIn: sub.leadIn ? sanitizeUniversalText(sub.leadIn) : undefined,
    bulletPoints: (sub.bulletPoints ?? []).map(sanitizeUniversalText),
    groundedBullets: sub.groundedBullets
      ? sub.groundedBullets.map((gb) => ({
          text: sanitizeUniversalText(gb.text),
          slide: gb.slide,
          evidence: gb.evidence,
        }))
      : undefined,
    formulas: (sub.formulas ?? []).map(sanitizeFormula),
  };
}

/**
 * Sanitizes and repairs LaTeX formulas and strings inside distilled sections
 */
function sanitizeSectionLatex(section: NoteSection): NoteSection {
  return {
    ...section,
    titleEn: section.titleEn ? sanitizeUniversalText(section.titleEn) : "",
    coreStatement: section.coreStatement
      ? sanitizeUniversalText(section.coreStatement)
      : undefined,
    overview: section.overview
      ? sanitizeUniversalText(section.overview)
      : "",
    bulletPoints: (section.bulletPoints ?? []).map(sanitizeUniversalText),
    groundedBullets: section.groundedBullets
      ? section.groundedBullets.map((gb) => ({
          text: sanitizeUniversalText(gb.text),
          slide: gb.slide,
          evidence: gb.evidence,
        }))
      : undefined,
    formulas: (section.formulas ?? []).map(sanitizeFormula),
    subSections: (section.subSections ?? []).map(sanitizeSubSection),
    keyTakeaways: section.keyTakeaways
      ? {
          ...section.keyTakeaways,
          title: cleanTypoString(section.keyTakeaways.title || "KEY TAKEAWAYS"),
          items: (section.keyTakeaways.items ?? []).map((item) => ({
            point: sanitizeUniversalText(item.point),
            subBullets: (item.subBullets ?? []).map(sanitizeUniversalText),
            slide: item.slide,
            evidence: item.evidence,
          })),
          modelSelectionRule: section.keyTakeaways.modelSelectionRule
            ? sanitizeUniversalText(section.keyTakeaways.modelSelectionRule)
            : undefined,
          realWorldConditions: section.keyTakeaways.realWorldConditions
            ? sanitizeUniversalText(section.keyTakeaways.realWorldConditions)
            : undefined,
          boundaryConditions: section.keyTakeaways.boundaryConditions
            ? sanitizeUniversalText(section.keyTakeaways.boundaryConditions)
            : undefined,
          summaryPoints: (section.keyTakeaways.summaryPoints ?? []).map(
            sanitizeUniversalText,
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

export function injectLedgerFormulasById(
  sections: NoteSection[],
  ledger: FormulaLedgerEntry[],
): { sections: NoteSection[]; placedIds: Set<string> } {
  const placedIds = new Set<string>();
  if (!ledger || ledger.length === 0) {
    return { sections, placedIds };
  }

  const ledgerMap = new Map<string, FormulaLedgerEntry>();
  const ledgerKeyMap = new Map<string, FormulaLedgerEntry>();

  for (const entry of ledger) {
    const normId = entry.id.trim().toUpperCase();
    ledgerMap.set(normId, entry);

    const latexKey = normalizeFormulaKey(entry.latex);
    if (latexKey && !ledgerKeyMap.has(latexKey)) {
      ledgerKeyMap.set(latexKey, entry);
    }
    const rawKey = normalizeFormulaKey(entry.raw);
    if (rawKey && !ledgerKeyMap.has(rawKey)) {
      ledgerKeyMap.set(rawKey, entry);
    }
  }

  const definedSymbols = new Set<string>();

  function processFormula(formula: NoteFormula): NoteFormula {
    const f: NoteFormula = {
      ...formula,
      variables: formula.variables ? [...formula.variables] : [],
    };

    const refs = (f.formulaRefs || [])
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    const derived = (f.derivedFrom || [])
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);

    const validRefs = refs
      .map((id) => ledgerMap.get(id))
      .filter((e): e is FormulaLedgerEntry => Boolean(e));

    const validDerived = derived
      .map((id) => ledgerMap.get(id)?.id)
      .filter((id): id is string => Boolean(id));

    // Case 1: Direct Ledger Injection (formulaRefs non-empty and derivedFrom empty)
    if (validRefs.length > 0 && validDerived.length === 0) {
      if (validRefs.length === 1) {
        const entry = validRefs[0];
        placedIds.add(entry.id);
        f.latex = entry.latex;
        f.formulaRefs = [entry.id];
        f.derivedFrom = [];
        f.slide = f.slide ?? entry.slide;
        f.origin = entry.origin;
        f.confidence = entry.confidence;

        if (
          (!f.variables || f.variables.length === 0) &&
          entry.variables &&
          entry.variables.length > 0
        ) {
          const newVars = entry.variables.filter(
            (v) => !definedSymbols.has(v.symbol.trim()),
          );
          f.variables = newVars.map((v) => ({ ...v }));
        }
      } else {
        // 2+ valid ledger entries referenced in formulaRefs
        for (const e of validRefs) {
          placedIds.add(e.id);
        }
        f.formulaRefs = validRefs.map((e) => e.id);
        f.derivedFrom = [];
        f.slide = f.slide ?? validRefs[0].slide;
        f.origin = validRefs[0].origin;
        f.latex = validRefs.map((e) => e.latex).join(", \\quad ");
      }
    } else if (validDerived.length > 0) {
      // Case 2: Derived Formula (derivedFrom non-empty)
      for (const id of validDerived) {
        placedIds.add(id);
      }
      f.derivedFrom = validDerived;
      f.formulaRefs = [];
      f.origin = "derived";
      const parentSlide = ledgerMap.get(validDerived[0])?.slide;
      f.slide = f.slide ?? parentSlide;
    } else {
      // Case 3: Fallback Normalized Key Match
      const normKey = normalizeFormulaKey(f.latex);
      const matchedEntry = normKey ? ledgerKeyMap.get(normKey) : undefined;
      if (matchedEntry) {
        placedIds.add(matchedEntry.id);
        f.formulaRefs = [matchedEntry.id];
        f.derivedFrom = [];
        f.latex = matchedEntry.latex;
        f.slide = f.slide ?? matchedEntry.slide;
        f.origin = matchedEntry.origin;
        f.confidence = matchedEntry.confidence;

        if (
          (!f.variables || f.variables.length === 0) &&
          matchedEntry.variables &&
          matchedEntry.variables.length > 0
        ) {
          const newVars = matchedEntry.variables.filter(
            (v) => !definedSymbols.has(v.symbol.trim()),
          );
          f.variables = newVars.map((v) => ({ ...v }));
        }
      }
    }

    if (f.variables) {
      for (const v of f.variables) {
        if (v.symbol.trim()) {
          definedSymbols.add(v.symbol.trim());
        }
      }
    }

    return f;
  }

  const processedSections = sections.map((sec) => ({
    ...sec,
    formulas: (sec.formulas || []).map(processFormula),
    subSections: (sec.subSections || []).map((sub) => ({
      ...sub,
      formulas: (sub.formulas || []).map(processFormula),
    })),
  }));

  return { sections: processedSections, placedIds };
}

export function mapSynthesisSection(
  sec: SynthesisSection,
  index: number,
  ledger?: FormulaLedgerEntry[],
): NoteSection {
  const sequentialLetter = String.fromCharCode(65 + index);
  const strippedTitle = sec.titleVi.trim().replace(/^[A-Z0-9]+\.\s+/i, "");
  const prefixedTitle = `${sequentialLetter}. ${strippedTitle}`;

  const mapFormula = (f: SynthesisFormula): NoteFormula => ({
    name: "",
    leadText: f.leadText.trim() || undefined,
    latex: f.latex.trim(),
    description: f.description.trim() || undefined,
    variables: (f.variables ?? [])
      .map((v) => ({
        symbol: v.symbol.trim(),
        definition: v.definition.trim(),
      }))
      .filter((v) => v.symbol.length > 0 && v.definition.length > 0),
    formulaRefs: f.formulaRefs ? f.formulaRefs.map((r) => r.trim()).filter(Boolean) : [],
    derivedFrom: f.derivedFrom ? f.derivedFrom.map((r) => r.trim()).filter(Boolean) : [],
  });

  const takeawayItems: KeyTakeawaysItem[] = (sec.takeaways ?? [])
    .map((t) => ({
      point: t.point.trim(),
      subBullets: (t.subBullets ?? []).map((sb) => sb.trim()).filter(Boolean),
      slide: t.slide,
      evidence: t.evidence.trim() || undefined,
    }))
    .filter((t) => t.point.length > 0);

  const groundedBullets: GroundedBullet[] = (sec.bullets ?? [])
    .map((b) => ({
      text: b.text.trim(),
      slide: b.slide,
      evidence: b.evidence.trim(),
    }))
    .filter((b) => b.text.length > 0);

  const bulletPoints = groundedBullets.map((b) => b.text);

  const mappedSubSections: NoteSubSection[] = (sec.subSections ?? [])
    .map((sub) => {
      const subGroundedBullets: GroundedBullet[] = (sub.bullets ?? [])
        .map((b) => ({
          text: b.text.trim(),
          slide: b.slide,
          evidence: b.evidence.trim(),
        }))
        .filter((b) => b.text.length > 0);

      return {
        heading: sub.heading.trim(),
        leadIn: sub.leadIn.trim() || undefined,
        bulletPoints: subGroundedBullets.map((b) => b.text),
        groundedBullets:
          subGroundedBullets.length > 0 ? subGroundedBullets : undefined,
        formulas: (sub.formulas ?? []).map(mapFormula).filter((f) => f.latex.length > 0),
      };
    })
    .filter(
      (sub) =>
        sub.heading.length > 0 &&
        (sub.bulletPoints.length > 0 ||
          sub.formulas.length > 0 ||
          Boolean(sub.leadIn)),
    );

  let noteSection: NoteSection = {
    id: `sec-${sequentialLetter.toLowerCase()}-${index + 1}`,
    letter: sequentialLetter,
    titleVi: prefixedTitle,
    titleEn: "",
    coreStatement: sec.coreStatement.trim() || undefined,
    overview: sec.overview.trim(),
    bulletPoints,
    groundedBullets: groundedBullets.length > 0 ? groundedBullets : undefined,
    formulas: (sec.formulas ?? []).map(mapFormula).filter((f) => f.latex.length > 0),
    subSections: mappedSubSections,
    keyTakeaways:
      takeawayItems.length > 0
        ? {
            title: "KEY TAKEAWAYS",
            items: takeawayItems,
            summaryPoints: [],
          }
        : null,
    sourceSlides: sec.sourceSlides,
  };

  if (ledger && ledger.length > 0) {
    const res = injectLedgerFormulasById([noteSection], ledger);
    noteSection = res.sections[0];
  }

  return sanitizeSectionLatex(noteSection);
}

function normalizeToSynthesisSection(sec: any): SynthesisSection {
  const bullets = Array.isArray(sec.bullets)
    ? sec.bullets.map((b: any) =>
        typeof b === "string"
          ? { text: b, slide: sec.sourceSlides?.[0] ?? 1, evidence: b }
          : {
              text: b.text || "",
              slide: b.slide ?? (sec.sourceSlides?.[0] ?? 1),
              evidence: b.evidence || "",
            },
      )
    : Array.isArray(sec.bulletPoints)
      ? sec.bulletPoints.map((bp: string) => ({
          text: bp,
          slide: sec.sourceSlides?.[0] ?? 1,
          evidence: bp,
        }))
      : [];

  const subSections: SynthesisSubSection[] = Array.isArray(sec.subSections)
    ? sec.subSections.map((sub: any) => ({
        heading: sub.heading || "",
        leadIn: sub.leadIn || "",
        bullets: Array.isArray(sub.bullets)
          ? sub.bullets.map((b: any) =>
              typeof b === "string"
                ? { text: b, slide: sec.sourceSlides?.[0] ?? 1, evidence: b }
                : {
                    text: b.text || "",
                    slide: b.slide ?? (sec.sourceSlides?.[0] ?? 1),
                    evidence: b.evidence || "",
                  },
            )
          : Array.isArray(sub.bulletPoints)
            ? sub.bulletPoints.map((bp: string) => ({
                text: bp,
                slide: sec.sourceSlides?.[0] ?? 1,
                evidence: bp,
              }))
            : [],
        formulas: (sub.formulas || []).map((f: any) => ({
          formulaRefs: Array.isArray(f.formulaRefs) ? f.formulaRefs : [],
          derivedFrom: Array.isArray(f.derivedFrom) ? f.derivedFrom : [],
          leadText: f.leadText || "",
          latex: f.latex || "",
          description: f.description || "",
          variables: Array.isArray(f.variables) ? f.variables : [],
        })),
      }))
    : [];

  const formulas: SynthesisFormula[] = (sec.formulas || []).map((f: any) => ({
    formulaRefs: Array.isArray(f.formulaRefs) ? f.formulaRefs : [],
    derivedFrom: Array.isArray(f.derivedFrom) ? f.derivedFrom : [],
    leadText: f.leadText || "",
    latex: f.latex || "",
    description: f.description || "",
    variables: Array.isArray(f.variables) ? f.variables : [],
  }));

  const takeaways: SynthesisTakeawayItem[] = Array.isArray(sec.takeaways)
    ? sec.takeaways.map((t: any) => ({
        point: t.point || "",
        subBullets: Array.isArray(t.subBullets) ? t.subBullets : [],
        slide: t.slide ?? (sec.sourceSlides?.[0] ?? 1),
        evidence: t.evidence || t.point || "",
      }))
    : [];

  return {
    letter: sec.letter || "A",
    titleVi: sec.titleVi || "",
    coreStatement: sec.coreStatement || "",
    overview: sec.overview || "",
    bullets,
    formulas,
    subSections,
    takeaways,
    sourceSlides:
      Array.isArray(sec.sourceSlides) && sec.sourceSlides.length > 0
        ? sec.sourceSlides
        : [1],
  };
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
    model = options.modelOverride ?? getGenerationModel("notes");
    if (!model) {
      throw new IngestionError(
        "AI_NOT_CONFIGURED",
        "Clutch Notes AI is temporarily unavailable (AI provider not configured).",
        503,
      );
    }
  } catch (err) {
    if (err instanceof IngestionError) {
      throw err;
    }
    throw new IngestionError(
      "AI_NOT_CONFIGURED",
      "Clutch Notes AI is temporarily unavailable (AI provider not configured).",
      503,
    );
  }

  // Step 1: Obtain ledger and extractedClaims
  let ledger: FormulaLedgerEntry[] = [];
  let extractedClaims: ExtractedSlideClaim[] = [];

  if (options.formulaLedger) {
    ledger = options.formulaLedger;
    extractedClaims = [];
  } else {
    try {
      const mergedResult = await buildMergedFormulaLedger({
        sources: options.sources,
        ommlEquations: options.ommlEquations,
        ocrEquations: options.ocrEquations,
        model: options.skipChunkExtraction ? undefined : model,
        signal: options.signal,
      });
      ledger = mergedResult.ledger;
      extractedClaims = mergedResult.claims;
    } catch (err) {
      console.warn(
        "[generateClutchNote] buildMergedFormulaLedger failed, falling back to deterministic inventory:",
        err,
      );
      const deterministicInventory =
        options.formulaInventory ??
        buildFormulaInventory({
          sources: options.sources,
          ommlEquations: options.ommlEquations,
          ocrEquations: options.ocrEquations,
        });
      ledger = mergeFormulaLedger({
        deterministicInventory,
        sources: options.sources,
      });
      extractedClaims = [];
    }
  }

  // Step 2: Build the prompt
  const prompt = buildNotesPrompt({
    fileName: options.fileName,
    slides: options.sources.map((s) => ({ label: s.label, text: s.text })),
    focus: options.focus,
    formulaLedger: ledger,
    extractedClaims,
  });

  const isGroqPrimary = Boolean(
    process.env.GROQ_API_KEY && process.env.AI_PROVIDER?.trim().toLowerCase() === "groq",
  );
  const primaryMaxTokens = isGroqPrimary ? 4_096 : 8_192;

  let lastMeta: any = null;

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

    let resObject: any;
    try {
      const res = await generateObject({
        model: targetModel,
        schema: synthesisSchema,
        system: CLUTCH_NOTES_SYSTEM_PROMPT,
        prompt,
        abortSignal: combinedSignal,
        maxRetries: timeoutMs ? 0 : 1,
        maxOutputTokens,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
        },
      });
      resObject = res.object;
    } finally {
      if (timer) clearTimeout(timer);
    }

    const rawSections = Array.isArray(resObject?.sections) ? resObject.sections : [];
    const normalizedSections: SynthesisSection[] = rawSections.map(
      normalizeToSynthesisSection,
    );

    const mapped = normalizedSections
      .map((sec, idx) => mapSynthesisSection(sec, idx, ledger))
      .filter(sectionHasSubstantiveContent)
      .map((sec, idx) => {
        const seqLetter = String.fromCharCode(65 + idx);
        const stripped = sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, "");
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

    lastMeta = resObject;
    return mapped;
  };

  let populatedSections: NoteSection[];
  const fallback = !options.modelOverride ? getGroqModel() : null;
  const hasDistinctFallback = Boolean(fallback && fallback !== model);

  try {
    populatedSections = await synthesizeWithModel(
      model,
      primaryMaxTokens,
      hasDistinctFallback ? 55_000 : 80_000,
    );
  } catch (primaryErr) {
    if (hasDistinctFallback && fallback) {
      console.warn(
        "[generateClutchNote] Primary model failed or returned empty sections; failing over to Groq...",
        primaryErr,
      );
      populatedSections = await synthesizeWithModel(fallback, 4_096, 30_000);
    } else {
      throw primaryErr;
    }
  }

  const meta = lastMeta!;

  // Normalize noise reduction rate
  let noiseRate = meta.noiseReductionRate ?? 85;
  if (noiseRate > 0 && noiseRate <= 1) {
    noiseRate = Math.round(noiseRate * 100);
  } else {
    noiseRate = Math.min(98, Math.max(20, Math.round(noiseRate)));
  }

  // Step 4: Run injectLedgerFormulasById, applyHallucinationShield, and re-verify injectLedgerFormulasById
  const { sections: initialInjected } = injectLedgerFormulasById(
    populatedSections,
    ledger,
  );
  const rawSlideText = options.sources.map((s) => s.text).join("\n");
  const shieldedSections = applyHallucinationShield(initialInjected, rawSlideText);
  const { sections: preGateSections } = injectLedgerFormulasById(
    shieldedSections,
    ledger,
  );

  const rawOmitted: SynthesisOmittedFormula[] = Array.isArray(meta?.omitted)
    ? meta.omitted
    : [];

  // Step 4.4: Verification Gate, Targeted Repair Loop (max 1), and MARK Policy
  const gateResult = await runVerificationGate({
    sections: preGateSections,
    sources: options.sources,
    ledger,
    omitted: rawOmitted,
    options: {
      enableVerifierLlm: options.enableVerifierLlm,
      verifierModel: options.verifierModel,
      repairModel: options.repairModel,
      repairFn: options.repairFn,
      skipVerifierLlm: options.skipVerifierLlm,
      maxRepairAttempts: options.maxRepairAttempts ?? 1,
      throwOnContradictedFormula: options.throwOnContradictedFormula ?? true,
      signal: options.signal,
    },
  });

  const finalSections = gateResult.sections;
  const finalPlacedIds = new Set(gateResult.verification.placedFormulaIds);

  // Step 5: Compute omitted: merge valid LLM omitted entries with any remaining unplaced ledger entries
  const ledgerIdSet = new Set(ledger.map((e) => e.id));
  const omittedResult: SynthesisOmittedFormula[] = [];
  const omittedSeen = new Set<string>();

  for (const item of rawOmitted) {
    if (
      item &&
      typeof item.formulaId === "string" &&
      ledgerIdSet.has(item.formulaId) &&
      !finalPlacedIds.has(item.formulaId) &&
      !omittedSeen.has(item.formulaId)
    ) {
      omittedResult.push({
        formulaId: item.formulaId,
        reason:
          typeof item.reason === "string" && item.reason.trim()
            ? item.reason.trim()
            : "Omitted by synthesis",
      });
      omittedSeen.add(item.formulaId);
    }
  }

  for (const entry of ledger) {
    if (!finalPlacedIds.has(entry.id) && !omittedSeen.has(entry.id)) {
      omittedResult.push({
        formulaId: entry.id,
        reason: "Uncaptured source formula",
      });
      omittedSeen.add(entry.id);
    }
  }

  const finalNote: ClutchNote = {
    id: noteId,
    title: sanitizeUniversalText((meta.title || "").trim()),
    subject: sanitizeUniversalText((meta.subject || "").trim()),
    createdAt: new Date().toISOString(),
    originalFileName: options.fileName,
    originalSlideCount: options.slideCount,
    estimatedDistilledPages: meta.estimatedDistilledPages || 3,
    noiseReductionRate: noiseRate,
    executiveSummary: sanitizeUniversalText((meta.executiveSummary || "").trim()),
    sections: finalSections,
    formulaLedger: ledger.length > 0 ? ledger : undefined,
    omitted: omittedResult.length > 0 ? omittedResult : undefined,
    verification: gateResult.verification,
  };

  finalNote.rawMarkdown = buildMarkdownNote(finalNote);

  return finalNote;
}
