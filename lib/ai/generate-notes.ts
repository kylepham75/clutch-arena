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
import { repairCorruptedLatex, ensureInlineMathDelimiters } from "@/lib/math/latex";
export { ensureInlineMathDelimiters } from "@/lib/math/latex";
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
}

export function sanitizeUniversalText(str: string): string {
  if (!str || typeof str !== "string") return str;
  return ensureInlineMathDelimiters(repairCorruptedLatex(cleanTypoString(str)));
}

function sanitizeFormula(f: NoteFormula): NoteFormula {
  return {
    ...f,
    name: f.name ? sanitizeUniversalText(f.name) : "",
    leadText: f.leadText ? sanitizeUniversalText(f.leadText) : undefined,
    latex: repairCorruptedLatex(cleanTypoString(f.latex)).replace(/^\$+|\$+$/g, "").trim(),
    description: f.description ? sanitizeUniversalText(f.description) : undefined,
    variables: (f.variables ?? []).map((v) => ({
      symbol: cleanTypoString(repairCorruptedLatex(v.symbol)).replace(/^\$+|\$+$/g, "").trim(),
      definition: sanitizeUniversalText(v.definition),
    })),
  };
}

const VIETNAMESE_GRAVE_MAP: Record<string, string> = {
  a: "à", A: "À", ă: "ằ", Ă: "Ằ", â: "ầ", Â: "Ầ",
  e: "è", E: "È", ê: "ề", Ê: "Ề",
  i: "ì", I: "Ì",
  o: "ò", O: "Ò", ô: "ồ", Ô: "Ồ", ơ: "ờ", Ơ: "Ờ",
  u: "ù", U: "Ù", ư: "ừ", Ư: "Ừ",
  y: "ỳ", Y: "Ỳ",
};

function cleanTypoString(str: string): string {
  if (!str || typeof str !== "string") return str;
  let s = str.normalize("NFC");

  // Re-attach isolated or spaced combining diacritical marks to preceding letters and compose to NFC
  s = s.replace(/([\p{L}\p{M}]+)\s+([\u0300-\u036f]+)/gu, "$1$2").normalize("NFC");

  // Repair known Windows DirectWrite/Georgia detached backticks and floating accents
  s = s
    .replace(/đề[\x60'\u00B4]\s*u/gi, "đều")
    .replace(/nhiê[\x60'\u00B4]\s*u/gi, "nhiều")
    .replace(/suấ[\x60'\u00B4]\s*t/gi, "suất")
    .replace(/vố[\x60'\u00B4]\s*n/gi, "vốn")
    .replace(/phiế[\x60'\u00B4]\s*u/gi, "phiếu");

  // Compose floating backtick after unaccented/circumflex vowel inside words to grave accent (e.g. nhiê` u -> nhiều)
  s = s.replace(/([aăâeêioôơuưyAĂÂEÊIOÔƠUƯY])[\x60'\u00B4]\s*([a-zA-Z\u00C0-\u1EF9])/gu, (_match, v, next) => {
    return (VIETNAMESE_GRAVE_MAP[v] || v) + next;
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

  s = s.normalize("NFC");

  return s
    .replace(/\b([gG])\s*=\s*[oO]\b/g, "$1 = 0")
    .replace(/\(([gG])\s*=\s*[oO]\)/g, "($1 = 0)")
    .replace(/\\text\{[gG]\s*=\s*[oO]\}/g, "\\text{$1 = 0}")
    .replace(/\bP_o\b/g, "P_0")
    .replace(/\bD_o\b/g, "D_0")
    .replace(/\bR_o\b/g, "R_0")
    .replace(/\bP_\{o\}\b/g, "P_{0}")
    .replace(/\bD_\{o\}\b/g, "D_{0}")
    .replace(/\bR_\{o\}\b/g, "R_{0}")
    // One-year holding period exponent: (1+R)^T or (1+R)^t -> 1+R
    .replace(/\\frac\{\s*D_?1\s*\}\{\s*\(1\s*\+\s*R\)\s*\^\s*\{?[Tt1]\}?\s*\}/g, "\\frac{D_1}{1 + R}")
    .replace(/\\frac\{\s*P_?1\s*\}\{\s*\(1\s*\+\s*R\)\s*\^\s*\{?[Tt1]\}?\s*\}/g, "\\frac{P_1}{1 + R}")
    .replace(/\\frac\{\s*D_?1\s*\}\{\s*\(1\s*\+\s*R_?p\)\s*\^\s*\{?[Tt1]\}?\s*\}/g, "\\frac{D_1}{1 + R_p}")
    .replace(/\\frac\{\s*P_?1\s*\}\{\s*\(1\s*\+\s*R_?p\)\s*\^\s*\{?[Tt1]\}?\s*\}/g, "\\frac{P_1}{1 + R_p}");
}


export function sanitizeAcademicHeader(
  rawTitle: string,
  letter: string,
  isStockValuation: boolean = true,
): string {
  let title = rawTitle.trim();

  // Strip leading prefixes like "Header B: ", "B. ", "1. ", "Section B: "
  title = title
    .replace(/^(header\s+[a-z0-9]+[:\s\-]+|section\s+[a-z0-9]+[:\s\-]+|[a-z0-9]+[\.\:\-]\s*)/i, "")
    .trim();

  // 1. Purge absurd machine translations
  title = title
    .replace(/giáo dục/gi, "ĐỊNH GIÁ")
    .replace(/cứu trợ chứng khoán/gi, "CỔ PHIẾU")
    .replace(/cứu trợ/gi, "CỔ PHIẾU ƯU ĐÃI")
    .replace(/hạnh hạnh/gi, "TĂNG TRƯỞNG ĐỀU")
    .replace(/ritm không đổi/gi, "MÔ HÌNH KHÔNG TĂNG TRƯỞNG")
    .replace(/ritm/gi, "DDM")
    .replace(/bổ trợ hợp tác/gi, "CỔ PHIẾU ƯU ĐÃI HOÃN TRẢ")
    .replace(/bổ trợ/gi, "HOÃN TRẢ");

  const lower = title.toLowerCase();

  // 2. If the topic is Cost of Capital / WACC, Cost of Debt, Cost of Equity, Flotation Costs, etc.,
  // or if explicitly not Stock Valuation, preserve the clean uppercase topic title with letter prefix!
  const isNonStockTopic =
    !isStockValuation ||
    /wacc|cost of capital|chi phí (sử dụng )?vốn|chi phí vốn|cost of debt|chi phí nợ|cost of equity|chi phí.*cổ phần|chi phí.*chủ sở hữu|cost of preferred|chi phí.*(cổ phiếu )?ưu đãi|flotation|chi phí phát hành|divisional risk|rủi ro bộ phận|capital structure|cơ cấu vốn|pure play|subjective approach|capital budgeting|ngân sách vốn|sml|capm|risk|return|rủi ro|tỷ suất sinh lời|lợi suất|portfolio|danh mục|beta|covariance|hiệp phương sai|correlation|tương quan|variance|phương sai|độ lệch chuẩn|historical|thống kê|kinh tế|economics|accounting|kế toán|tài chính|statistics|probability|xác suất|toán|math|stem|operations|vận hành|physics|chemistry|cung|cầu|supply|demand|gdp|lạm phát|inflation/i.test(
      lower,
    );

  if (isNonStockTopic) {
    const cleanStripped = title.replace(/^[A-Z0-9]+\.\s*/i, "").trim();
    return `${letter}. ${cleanStripped.toUpperCase()}`;
  }

  // 3. Map directly to canonical academic headers for Corporate Finance (Stock Valuation / DDM)
  if (/nguyên lý|fundamental.*principle/i.test(lower) || (/cơ bản/i.test(lower) && !/vốn|nợ|wacc/i.test(lower))) {
    return `${letter}. NGUYÊN LÝ CƠ BẢN`;
  }
  if (/preference|preferred|ưu đãi|ưu tiên|cứu trợ|bổ trợ/i.test(lower) && !/cost|chi phí|nợ|debt|wacc|vốn/i.test(lower)) {
    return `${letter}. VALUE OF PREFERENCE SHARE`;
  }
  if (/parameter|tham số|finding g|finding r/i.test(lower) || (/growth rate|discount rate|lợi suất/i.test(lower) && !/debt|equity|wacc|vốn/i.test(lower))) {
    return `${letter}. PARAMETERS IN DIVIDEND DISCOUNT MODEL`;
  }
  if (/ddm|dividend discount|gordon|ritm|hạnh hạnh/i.test(lower) || (/tăng trưởng đều|không tăng trưởng|differential/i.test(lower) && !/wacc|vốn/i.test(lower))) {
    return `${letter}. DDM (DIVIDEND DISCOUNT MODEL)`;
  }
  if (/công thức tổng quát|one-period|định giá|chọn mô hình/i.test(lower) && !/wacc|chi phí/i.test(lower)) {
    return `${letter}. CÔNG THỨC TỔNG QUÁT`;
  }

  const cleanStripped = title.replace(/^[A-Z0-9]+\.\s*/i, "").trim();
  return `${letter}. ${cleanStripped.toUpperCase()}`;
}

export function sanitizeSubSectionHeading(heading: string): string {
  let h = heading.trim();
  h = h
    .replace(/giáo dục/gi, "Định giá")
    .replace(/cứu trợ chứng khoán/gi, "Cổ phiếu")
    .replace(/cứu trợ/gi, "Cổ phiếu ưu đãi")
    .replace(/hạnh hạnh/gi, "Tăng trưởng đều")
    .replace(/ritm không đổi/gi, "Không tăng trưởng")
    .replace(/ritm/gi, "DDM")
    .replace(/bổ trợ hợp tác/gi, "Cổ phiếu ưu đãi hoãn trả")
    .replace(/bổ trợ/gi, "Hoãn trả");
  return cleanTypoString(h);
}

function shieldFormula(
  f: NoteFormula,
  contextHint: string,
  isStockValuation: boolean = true,
  isChapter10: boolean = false,
  isChapter11: boolean = false,
): NoteFormula {
  let latex = cleanTypoString(f.latex).replace(/^\$+|\$+$/g, "").trim();
  let leadText = f.leadText ? sanitizeUniversalText(f.leadText) : undefined;
  let description = f.description ? sanitizeUniversalText(f.description) : undefined;
  let variables = (f.variables ?? []).map((v) => ({
    symbol: cleanTypoString(repairCorruptedLatex(v.symbol)).replace(/^\$+|\$+$/g, "").trim(),
    definition: sanitizeUniversalText(v.definition),
  }));

  // 1. One-period valuation formula exponent error:
  // e.g. P_0 = D_1 / (1+R)^T + P_1 / (1+R)^T -> P_0 = D_1 / (1+R) + P_1 / (1+R)
  const isOnePeriodFormula =
    /D_?1/i.test(latex) &&
    /P_?1/i.test(latex) &&
    !/\\sum/i.test(latex);

  if (isOnePeriodFormula) {
    latex = latex
      .replace(/\\frac\{\s*D_?1\s*\}\{\s*\(1\s*\+\s*([RrKk]|R_[epdEPD])\)\s*\^\s*\{?[Tt1]\}?\s*\}/gi, "\\frac{D_1}{1 + $1}")
      .replace(/\\frac\{\s*P_?1\s*\}\{\s*\(1\s*\+\s*([RrKk]|R_[epdEPD])\)\s*\^\s*\{?[Tt1]\}?\s*\}/gi, "\\frac{P_1}{1 + $1}")
      .replace(/\\frac\{\s*D_?1\s*\}\{\s*\(1\s*\+\s*R\)\s*\^\s*\{?[Tt1]\}?\s*\}/gi, "\\frac{D_1}{1 + R}")
      .replace(/\\frac\{\s*P_?1\s*\}\{\s*\(1\s*\+\s*R\)\s*\^\s*\{?[Tt1]\}?\s*\}/gi, "\\frac{P_1}{1 + R}");
    if (/\(1\s*\+\s*R\)\s*\^\s*\{?[Tt]\}?/i.test(latex)) {
      latex = "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}";
    }
  }

  // 2. Intercept circular/hallucinated growth rate substitution (e.g. g = (P1 - P0)/P0):
  // g must be retention ratio * ROE, never circular price change (P1 - P0)/P0
  const isSolvingForGrowthRate =
    /finding.*growth|growth.*rate|\(g\)/i.test(contextHint) ||
    /^\s*g\s*=/i.test(latex);
  const isPriceAppreciationFormula =
    /(\\frac\{\s*P_?1\s*-\s*P_?0\s*\}\{\s*P_?0\s*\}|\(P_?1\s*-\s*P_?0\)\s*\/\s*P_?0|\\Delta P)/i.test(
      latex,
    );

  if (isSolvingForGrowthRate && isPriceAppreciationFormula) {
    latex = "g = \\text{Retention ratio} \\times \\text{Return on retained earnings (ROE)}";
    leadText = "Fundamental accounting formula for sustainable dividend growth:";
    description = "Growth rate is driven by reinvestment policy and ROE, NOT circular price changes.";
    variables = [
      {
        symbol: "\\text{Retention ratio}",
        definition: "Proportion of net earnings retained in the business = 1 - Dividend Payout Ratio",
      },
      {
        symbol: "\\text{ROE}",
        definition: "Return on equity earned on retained earnings",
      },
    ];
  }

  // 3. Growing Perpetuity Denominator: Ensure denominator is r - g or R - g, never r + g or R + g
  latex = latex
    .replace(/\\frac\{((?:[^{}]|\{[^{}]*\})+)\}\{\s*([RrKk]|R_[Ee])\s*\+\s*g\s*\}/g, "\\frac{$1}{$2 - g}")
    .replace(/\/\s*\(\s*([RrKk]|R_[Ee])\s*\+\s*g\s*\)/g, "/ ($1 - g)");

  // 4. WACC Tax Shield: Ensure (1 - T_C) applies STRICTLY to Debt R_D, NEVER to Equity R_E or Preferred R_P
  if (/WACC/i.test(latex) || /chi phí (sử dụng )?vốn bình quân/i.test(contextHint)) {
    latex = latex
      .replace(/\\left\(\\frac\{E\}\{V\}\\right\)\s*R_E\s*\(1\s*-\s*T_C\)/g, "\\left(\\frac{E}{V}\\right) R_E")
      .replace(/\(\\frac\{E\}\{V\}\)\s*R_E\s*\(1\s*-\s*T_C\)/g, "\\left(\\frac{E}{V}\\right) R_E")
      .replace(/w_E\s*R_E\s*\(1\s*-\s*T_C\)/g, "w_E R_E")
      .replace(/\\left\(\\frac\{P\}\{V\}\\right\)\s*R_P\s*\(1\s*-\s*T_C\)/g, "\\left(\\frac{P}{V}\\right) R_P")
      .replace(/\(\\frac\{P\}\{V\}\)\s*R_P\s*\(1\s*-\s*T_C\)/g, "\\left(\\frac{P}{V}\\right) R_P")
      .replace(/w_P\s*R_P\s*\(1\s*-\s*T_C\)/g, "w_P R_P");
  }
  if (/R_E\s*=/i.test(latex) && !/WACC/i.test(latex)) {
    latex = latex.replace(/\(1\s*-\s*T_C\)/g, "").trim();
  }
  if (/R_P\s*=/i.test(latex) && !/WACC/i.test(latex)) {
    latex = latex.replace(/\(1\s*-\s*T_C\)/g, "").trim();
  }

  // 5. Underbraced decomposition for Required Return R (Stock Valuation only, don't overwrite R_E or other returns)
  if (isStockValuation) {
    if (
      /R\s*=\s*(\\frac\{D_?1\}\{P_?0\}|\(D_?1\/P_?0\))\s*\+\s*g/i.test(latex) &&
      !latex.includes("underbrace") &&
      !/R_?[EePpDd]/i.test(latex)
    ) {
      latex =
        "R = \\underbrace{\\frac{D_1}{P_0}}_{\\text{Dividend Yield}} + \\underbrace{g}_{\\text{Capital Gains Yield}}";
    }
  }

  // 6. Chapter 10 Historical Risk & Return Variance Shield:
  // Historical sample variance uses denominator strictly T - 1 (or n - 1). NEVER divide by T, NEVER use scenario probabilities P_i.
  const isHistoricalVariance =
    isChapter10 ||
    /historical|mẫu lịch sử|sample variance|phương sai lịch sử/i.test(contextHint) ||
    /s\^2\s*=|s\s*=\s*\\sqrt/i.test(latex);

  if (
    isHistoricalVariance &&
    (/variance|phương sai|độ lệch chuẩn|s\^2/i.test(contextHint) || /s\^2|\\bar\{R\}|R_t/i.test(latex))
  ) {
    // Intercept if probability P_i was hallucinated into historical sample variance
    if (/P_i|p_i|\\sum\s*P/i.test(latex)) {
      latex = "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2, \\quad s = \\sqrt{s^2}";
      leadText = "Phương sai và độ lệch chuẩn mẫu lịch sử (mẫu số strictly T - 1, không dùng xác suất P_i):";
      description = "Mẫu số là T - 1 để ước lượng không chệch cho phương sai tổng thể.";
      variables = [
        { symbol: "s^2, s", definition: "Phương sai mẫu và độ lệch chuẩn mẫu lịch sử" },
        { symbol: "T", definition: "Số thời kỳ quan sát trong chuỗi dữ liệu lịch sử" },
        { symbol: "\\bar{R}", definition: "Tỷ suất sinh lời trung bình số học của mẫu" },
        { symbol: "R_t", definition: "Tỷ suất sinh lời thực tế tại thời kỳ t" },
      ];
    } else {
      // Fix denominator T to T - 1 if divided by T without - 1
      latex = latex.replace(/\\frac\{1\}\{T\}(?!\s*-\s*1)/g, "\\frac{1}{T - 1}");
      latex = latex.replace(/\{\s*T\s*\}(?!\s*-\s*1)/g, "{T - 1}");
      latex = latex.replace(/\\frac\{1\}\{n\}(?!\s*-\s*1)/g, "\\frac{1}{n - 1}");
      latex = latex.replace(/\{\s*n\s*\}(?!\s*-\s*1)/g, "{n - 1}");
    }
  }

  // 7. Chapter 11 Scenario Probability Variance Shield:
  // Expected return & portfolio scenario variance uses \sum P_i (R_i - E[R])^2. NO T - 1 denominator!
  const isScenarioVariance =
    isChapter11 ||
    /scenario|kịch bản|xác suất|probability/i.test(contextHint) ||
    /\\sigma\^2\s*=|\\sigma\s*=\s*\\sqrt/i.test(latex);

  if (
    isScenarioVariance &&
    (/variance|phương sai|độ lệch chuẩn|\\sigma/i.test(contextHint) || /\\sigma\^2|P_i/i.test(latex))
  ) {
    // Intercept if divided by T - 1 or n - 1 or T in scenario variance
    const isDividedBySample =
      /\\frac\{1\}\{[TnN]\s*-\s*1\}|\/\s*\(?[TnN]\s*-\s*1\)?|\\frac\{1\}\{[TnN]\}|\/\s*\(?[TnN]\)?/i.test(
        latex,
      );

    if (isDividedBySample) {
      latex = "\\sigma^2 = \\sum_{i=1}^n P_i (R_i - E[R])^2, \\quad \\sigma = \\sqrt{\\sigma^2}";
      leadText = "Phương sai và độ lệch chuẩn theo kịch bản xác suất (trọng số P_i, không chia cho T - 1):";
      description = "Phương sai kịch bản được tính bằng tổng gia quyền theo xác suất P_i.";
      variables = [
        { symbol: "\\sigma^2, \\sigma", definition: "Phương sai và độ lệch chuẩn theo kịch bản xác suất" },
        { symbol: "P_i", definition: "Xác suất xảy ra kịch bản kinh tế i" },
        { symbol: "R_i", definition: "Tỷ suất sinh lời trong kịch bản i" },
        { symbol: "E[R]", definition: "Tỷ suất sinh lời kỳ vọng" },
      ];
    }
  }

  return {
    ...f,
    latex,
    leadText,
    description,
    variables,
  };
}

/**
 * Prunes specific Case 1 & Case 2 formulas from Section C top-level
 * so that equations are not rendered twice (once at top-level and again in subSections).
 */
function deduplicateSectionC(sec: NoteSection): NoteSection {
  const isSectionC = /DDM|DIVIDEND DISCOUNT|CỔ TỨC/i.test(sec.titleVi);
  if (!isSectionC || !sec.subSections || sec.subSections.length === 0) {
    return sec;
  }

  const filteredFormulas = sec.formulas.filter((f) => {
    const isPerpetuityOnly =
      /\\frac\{\s*D\s*\}\{\s*R\s*\}$/.test(f.latex.trim()) && !f.latex.includes("\\sum");
    const isGordonOnly =
      /\\frac\{\s*D_?1\s*\}\{\s*R\s*-\s*g\s*\}$/.test(f.latex.trim()) && !f.latex.includes("\\sum");
    const isTerminalValue = /P_?N\s*=/i.test(f.latex);
    return !isPerpetuityOnly && !isGordonOnly && !isTerminalValue;
  });

  return {
    ...sec,
    formulas: filteredFormulas,
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

/**
 * Consolidates fragmented sections (e.g. when an LLM outputs 8–10 sections by splitting
 * every case and parameter into separate top-level sections) into the canonical 5 sections.
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

  for (const sec of sections) {
    const title = sec.titleVi.toLowerCase();

    // Section A: Fundamental Principle
    if (/nguyên lý|cơ bản|fundamental.*principle/i.test(title)) {
      if (!sectionA) sectionA = { ...sec };
      continue;
    }

    // Section B: One-Period Formula
    if (/công thức tổng quát|tổng quát|one-period|đầu tư trong 1 năm|giáo dục/i.test(title)) {
      if (!sectionB) sectionB = { ...sec };
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
          formulas: [],
          subSections:
            sec.subSections && sec.subSections.length > 0
              ? [...sec.subSections]
              : [
                  {
                    heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
                    bulletPoints: [...sec.bulletPoints],
                    formulas: [...sec.formulas],
                  },
                ],
        };
      } else {
        if (sec.subSections && sec.subSections.length > 0) {
          sectionD.subSections = [...(sectionD.subSections || []), ...sec.subSections];
        } else {
          sectionD.subSections = [
            ...(sectionD.subSections || []),
            {
              heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
              bulletPoints: [...sec.bulletPoints],
              formulas: [...sec.formulas],
            },
          ];
        }
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
      const isDeferredSection = /deferred|hoãn trả|bổ trợ/i.test(title);

      if (!sectionE) {
        sectionE = {
          ...sec,
          titleVi: "E. VALUE OF PREFERENCE SHARE",
          formulas: isDeferredSection ? [] : sec.formulas,
          subSections:
            sec.subSections && sec.subSections.length > 0
              ? [...sec.subSections]
              : isDeferredSection
                ? [
                    {
                      heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
                      bulletPoints: [...sec.bulletPoints],
                      formulas: [...sec.formulas],
                    },
                  ]
                : [],
        };
      } else {
        if (sec.subSections && sec.subSections.length > 0) {
          sectionE.subSections = [...(sectionE.subSections || []), ...sec.subSections];
        } else {
          sectionE.subSections = [
            ...(sectionE.subSections || []),
            {
              heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
              bulletPoints: [...sec.bulletPoints],
              formulas: [...sec.formulas],
            },
          ];
        }
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
      const isStandaloneCase =
        /case\s*[123]|zero growth|constant growth|không tăng trưởng|ritm|hạnh hạnh/i.test(title);

      if (!sectionC) {
        sectionC = {
          ...sec,
          titleVi: "C. DDM (DIVIDEND DISCOUNT MODEL)",
          formulas: isStandaloneCase
            ? [
                {
                  name: "",
                  latex: "P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}",
                  variables: [],
                },
              ]
            : sec.formulas,
          subSections:
            sec.subSections && sec.subSections.length > 0
              ? [...sec.subSections]
              : isStandaloneCase
                ? [
                    {
                      heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
                      bulletPoints: [...sec.bulletPoints],
                      formulas: [...sec.formulas],
                    },
                  ]
                : [],
        };
      } else {
        if (sec.subSections && sec.subSections.length > 0) {
          sectionC.subSections = [...(sectionC.subSections || []), ...sec.subSections];
        } else {
          sectionC.subSections = [
            ...(sectionC.subSections || []),
            {
              heading: sec.titleVi.replace(/^[A-Z0-9]+\.\s*/i, ""),
              bulletPoints: [...sec.bulletPoints],
              formulas: [...sec.formulas],
            },
          ];
        }
        if (sec.keyTakeaways && !sectionC.keyTakeaways) {
          sectionC.keyTakeaways = sec.keyTakeaways;
        }
      }
      continue;
    }
  }

  const result: NoteSection[] = [];
  if (sectionA) result.push(sectionA);
  if (sectionB) result.push(sectionB);
  if (sectionC) result.push(sectionC);
  if (sectionD) result.push(sectionD);
  if (sectionE) result.push(sectionE);

  return result.length >= 3 ? result : sections;
}

/**
 * Universally consolidates sections into strictly 3–5 canonical sections (A through E)
 * across any course or academic discipline (Finance, Economics, Accounting, Statistics, STEM).
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
        formulas: [...extraSec.formulas],
      });
      if (extraSec.subSections && extraSec.subSections.length > 0) {
        mergedSubSections.push(...extraSec.subSections);
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
 * when an LLM relegated an equation to text and left the formulas array empty.
 */
function harvestEquationFromText(line: string): NoteFormula | null {
  if (!line || typeof line !== "string" || !line.includes("=")) return null;

  // Indicators that text contains a quantitative or valuation formula
  const hasMathIndicators =
    /\\frac|\\sum|\\sqrt|\\prod|\\beta|\\sigma|\\rho|\\times|\\cdot|\\Delta|\^|\/|\+|-|\b(NPV|IRR|WACC|ROE|ROA|EAR|APR|YTM|CAPM|E\[R\]|Cov|Corr|Beta|DuPont|COGS|EBIT|EBITDA|EVA|FCF|PV|FV|PMT|P_0|P_1|P_t|D_1|D_0|EPS|DPS|PE|P\/E|Retention|Payout|Variance|StdDev)\b/i.test(
      line,
    );

  if (!hasMathIndicators) return null;

  // Avoid trivial assignments without calculation (e.g. "let t = 1", "g = 0", "N = 5")
  if (/^\s*[a-zA-Z_]\s*=\s*[0-9a-zA-Z_]\s*$/i.test(line.trim())) return null;

  // 1. Check for inline math delimiters: $...=...$ or $$...=...$$
  const mathDelimMatch = line.match(/\${1,2}([^$]+=[^$]+)\${1,2}/);
  if (mathDelimMatch) {
    const rawEquation = mathDelimMatch[1].trim();
    const prefix = line.slice(0, mathDelimMatch.index).trim().replace(/[:\-–—]+$/, "").trim();
    return {
      name: "",
      leadText: prefix.length > 0 ? sanitizeUniversalText(`${prefix}:`) : undefined,
      latex: repairCorruptedLatex(cleanTypoString(rawEquation)).replace(/^\$+|\$+$/g, "").trim(),
      description: undefined,
      variables: [],
    };
  }

  // 2. Prose equation pattern e.g. "DuPont Identity: ROE = Net Profit Margin * Asset Turnover * Equity Multiplier"
  const colonIndex = line.indexOf(":");
  let leadText: string | undefined = undefined;
  let eqText = line;

  if (colonIndex > 0) {
    const beforeColon = line.slice(0, colonIndex).trim();
    const afterColon = line.slice(colonIndex + 1).trim();
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

  if (cleanedEq.length < 3 || !cleanedEq.includes("=")) return null;

  return {
    name: "",
    leadText: leadText ? sanitizeUniversalText(`${leadText}:`) : undefined,
    latex: repairCorruptedLatex(cleanTypoString(cleanedEq)).replace(/^\$+|\$+$/g, "").trim(),
    description: undefined,
    variables: [],
  };
}

export function applyHallucinationShield(
  sections: NoteSection[],
  rawSlideText: string = "",
): NoteSection[] {
  const normSlideText = rawSlideText.toLowerCase();
  const allTitlesText = sections.map((s) => s.titleVi).join(" ").toLowerCase();
  const combinedContext = `${normSlideText} ${allTitlesText}`;

  const isWaccOrCostOfCapital =
    /wacc|cost of capital|chi phí (sử dụng )?vốn|chi phí vốn/i.test(combinedContext);

  const isChapter10Historical =
    !isWaccOrCostOfCapital &&
    /chapter\s*10|historical.*(risk|return)|lợi suất lịch sử|phương sai lịch sử|sample variance|geometric average|arithmetic average|blume|holding period/i.test(
      combinedContext,
    );

  const isChapter11Portfolio =
    !isWaccOrCostOfCapital &&
    /chapter\s*11|portfolio|danh mục|capm|sml|expected return|kịch bản|xác suất|covariance|hiệp phương sai|correlation|hệ số tương quan|beta\b|rủi ro hệ thống|systematic risk/i.test(
      combinedContext,
    );

  const isChapter9StockValuation =
    !isWaccOrCostOfCapital &&
    !isChapter10Historical &&
    !isChapter11Portfolio &&
    (/stock valuation|định giá cổ phiếu|dividend discount|gordon growth/i.test(rawSlideText) ||
      /stock valuation|định giá cổ phiếu/i.test(allTitlesText) ||
      /ddm|ritm|hạnh hạnh/i.test(combinedContext));

  // Step 1: Consolidate fragmented sections universally into 3–5 canonical sections
  const consolidated = consolidateSectionsUniversally(
    sections,
    rawSlideText,
    isChapter9StockValuation,
  );

  // Step 2: Apply fine-grained formula, header, and content shields
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
    sec.bulletPoints = sec.bulletPoints.map(sanitizeUniversalText);

    if (sec.keyTakeaways) {
      if (sec.keyTakeaways.title) {
        sec.keyTakeaways.title = cleanTypoString(sec.keyTakeaways.title);
      }
      if (sec.keyTakeaways.items) {
        sec.keyTakeaways.items = sec.keyTakeaways.items.map((item) => ({
          point: sanitizeUniversalText(item.point),
          subBullets: (item.subBullets ?? []).map(sanitizeUniversalText),
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

    // 2b. Shield formulas at section top-level
    sec.formulas = sec.formulas.map((f) =>
      shieldFormula(f, sec.titleVi, isChapter9StockValuation, isChapter10Historical, isChapter11Portfolio),
    );

    // Universal Formula Harvester:
    // If a section contains descriptive text or bullets with mathematical equations but formulas is empty,
    // harvest equations and create boxed NoteFormula so formulas are NEVER omitted!
    if (sec.formulas.length === 0) {
      const candidates = [sec.coreStatement, sec.overview, ...sec.bulletPoints].filter(
        (t): t is string => Boolean(t && t.includes("=")),
      );
      for (const cand of candidates) {
        const harvested = harvestEquationFromText(cand);
        if (harvested && !sec.formulas.some((f) => f.latex === harvested.latex)) {
          sec.formulas.push(
            shieldFormula(
              harvested,
              sec.titleVi,
              isChapter9StockValuation,
              isChapter10Historical,
              isChapter11Portfolio,
            ),
          );
        }
      }
    }

    // 2c. Shield sub-sections
    if (sec.subSections) {
      sec.subSections = deduplicateSubSections(sec.subSections);
      sec.subSections = sec.subSections.map((sub) => {
        sub.heading = sanitizeSubSectionHeading(sub.heading);
        if (sub.leadIn)
          sub.leadIn = sanitizeUniversalText(sub.leadIn);
        sub.bulletPoints = sub.bulletPoints.map(sanitizeUniversalText);
        sub.formulas = sub.formulas.map((f) =>
          shieldFormula(
            f,
            `${sec.titleVi} ${sub.heading}`,
            isChapter9StockValuation,
            isChapter10Historical,
            isChapter11Portfolio,
          ),
        );

        // Sub-section Formula Harvester:
        if (sub.formulas.length === 0) {
          const subCandidates = [sub.leadIn, ...sub.bulletPoints].filter(
            (t): t is string => Boolean(t && t.includes("=")),
          );
          for (const cand of subCandidates) {
            const harvested = harvestEquationFromText(cand);
            if (harvested && !sub.formulas.some((f) => f.latex === harvested.latex)) {
              sub.formulas.push(
                shieldFormula(
                  harvested,
                  `${sec.titleVi} ${sub.heading}`,
                  isChapter9StockValuation,
                  isChapter10Historical,
                  isChapter11Portfolio,
                ),
              );
            }
          }
        }

        if (isChapter9StockValuation) {
          // Case 3 (Differential Growth) Terminal Value PN injection
          const isDifferentialGrowth =
            /case\s*3|differential|non-?constant|tăng trưởng (không đều|khác biệt|nhiều giai đoạn)/i.test(
              sub.heading,
            );
          if (isDifferentialGrowth) {
            const hasTerminalFormula = sub.formulas.some((f) =>
              /P_?N\s*=|\\frac\{\s*D_?\{?N\+1\}?|\(1\s*\+\s*g\)\}/i.test(f.latex),
            );
            if (!hasTerminalFormula) {
              sub.formulas.push({
                name: "",
                leadText: "Terminal Value calculation at Year N:",
                latex: "P_N = \\frac{D_{N+1}}{R - g} = \\frac{D_N \\cdot (1 + g)}{R - g}",
                description:
                  "$P_N$ represents the present value of the constant growth perpetuity at the end of Year $N$.",
                variables: [
                  {
                    symbol: "P_N",
                    definition: "Terminal price of the stock at Year N",
                  },
                  {
                    symbol: "D_{N+1}",
                    definition: "First dividend in the constant growth stage ($D_N \\times (1 + g)$)",
                  },
                ],
              });
            }
          }

          // Finding R decomposition injection
          const isFindingR = /finding.*(discount rate|required return|\(R\))/i.test(sub.heading);
          if (isFindingR) {
            const hasYieldDefinitions = sub.bulletPoints.some((bp) =>
              /dividend yield/i.test(bp),
            );
            if (!hasYieldDefinitions) {
              sub.bulletPoints.unshift(
                "Dividend Yield (Lợi suất cổ tức) $= \\frac{D_1}{P_0}$: Expected annual dividend divided by current stock price (tested independently).",
                "Capital Gains Yield (Lợi suất tăng vốn) $= g$: The rate at which the stock price increases over time.",
              );
            }
          }
        }

        return sub;
      });
    }

    // 2d. Section C top-level deduplication (no double-pasting with subSections)
    if (isChapter9StockValuation) {
      sec = deduplicateSectionC(sec);
    }

    // 2e. Section E (Preference Share / Deferred Preferred Stock)
    if (isChapter9StockValuation) {
      const isPreferredStock = /preference|preferred|ưu đãi/i.test(sec.titleVi);
      const mentionsDeferredPerpetuity =
        /novaco|beginning \d+ years|deferred|hoãn trả|year 11|year 12|delay/i.test(
          normSlideText,
        );

      if (isPreferredStock && mentionsDeferredPerpetuity && sec.subSections) {
        const hasDeferred = sec.subSections.some((sub) =>
          /deferred|hoãn trả|delayed/i.test(sub.heading),
        );
        if (!hasDeferred) {
          sec.subSections.push({
            heading: "Deferred Preferred Stock (Cổ phiếu ưu đãi hoãn trả)",
            leadIn: "When dividends begin at Year t (delayed perpetuity):",
            bulletPoints: [
              "Step 1: Calculate the price at Year $t-1$ (one year before first dividend): $P_{t-1} = \\frac{D_t}{R_p}$",
              "Step 2: Discount $P_{t-1}$ back to Year 0: $P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}$",
            ],
            formulas: [
              {
                name: "",
                leadText: "Two-step deferred perpetuity valuation:",
                latex: "P_{t-1} = \\frac{D_t}{R_p} \\implies P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}",
                description:
                  "Find the price one period before the first dividend payment, then discount back to today.",
                variables: [],
              },
            ],
          });
        }
      }
    }

    return sec;
  });

  // Step 2f. Chapter 10 & 11 Core Formula Safeguards:
  // If the slides cover Risk & Return (Chapters 10 & 11) and the AI omitted boxed formulas
  // for Portfolio Return/Risk, Covariance/Correlation, CAPM, or Historical Variance,
  // populate them into the appropriate section.
  if (isChapter11Portfolio) {
    // 1. Portfolio Expected Return & Portfolio Risk (2 assets)
    const hasPortfolioRiskFormula = processed.some(
      (sec) =>
        sec.formulas.some((f) => /\\sigma_p\^?2|w_A\^2/i.test(f.latex)) ||
        (sec.subSections &&
          sec.subSections.some((sub) =>
            sub.formulas.some((f) => /\\sigma_p\^?2|w_A\^2/i.test(f.latex)),
          )),
    );

    if (!hasPortfolioRiskFormula) {
      let targetSec = processed.find((sec) => /portfolio|danh mục/i.test(sec.titleVi));
      if (!targetSec && processed.length > 1) {
        targetSec = processed[1]; // Typically Section B
      }
      if (targetSec) {
        targetSec.formulas.push(
          sanitizeFormula({
            name: "",
            leadText: "Tỷ suất sinh lời kỳ vọng của danh mục 2 tài sản:",
            latex: "E[R_p] = w_A E[R_A] + w_B E[R_B]",
            description: "Tỷ suất sinh lời kỳ vọng của danh mục là bình quân gia quyền theo tỷ trọng đầu tư.",
            variables: [
              { symbol: "E[R_p]", definition: "Tỷ suất sinh lời kỳ vọng của danh mục (Portfolio expected return)" },
              { symbol: "w_A, w_B", definition: "Tỷ trọng vốn đầu tư vào tài sản A và B ($w_A + w_B = 1$)" },
              { symbol: "E[R_A], E[R_B]", definition: "Tỷ suất sinh lời kỳ vọng của tài sản A và B" },
            ],
          }),
          sanitizeFormula({
            name: "",
            leadText: "Phương sai và độ lệch chuẩn của danh mục 2 tài sản:",
            latex: "\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B) = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\sigma_A \\sigma_B \\rho_{AB}",
            description: "\\sigma_p = \\sqrt{\\sigma_p^2} đo lường tổng rủi ro của danh mục.",
            variables: [
              { symbol: "\\sigma_p^2, \\sigma_p", definition: "Phương sai và độ lệch chuẩn của danh mục" },
              { symbol: "\\sigma_A, \\sigma_B", definition: "Độ lệch chuẩn riêng của tài sản A và B" },
              { symbol: "\\text{Cov}(R_A, R_B)", definition: "Hiệp phương sai giữa hai tài sản" },
              { symbol: "\\rho_{AB}", definition: "Hệ số tương quan giữa hai tài sản ($-1 \\le \\rho_{AB} \\le 1$)" },
            ],
          }),
          sanitizeFormula({
            name: "",
            leadText: "Độ lệch chuẩn danh mục:",
            latex: "\\sigma_p = \\sqrt{\\sigma_p^2}",
            description: "Căn bậc hai của phương sai danh mục đầu tư.",
            variables: [],
          }),
        );
      }
    }

    // 2. Covariance & Correlation Coefficient
    const hasCovarianceFormula = processed.some(
      (sec) =>
        sec.formulas.some((f) =>
          /\\sum.*P_i.*R_\{?A\}?|\\text\{Corr\}\(R_A,\s*R_B\)/i.test(f.latex),
        ) ||
        (sec.subSections &&
          sec.subSections.some((sub) =>
            sub.formulas.some((f) =>
              /\\sum.*P_i.*R_\{?A\}?|\\text\{Corr\}\(R_A,\s*R_B\)/i.test(f.latex),
            ),
          )),
    );

    if (!hasCovarianceFormula) {
      let targetSec = processed.find((sec) =>
        /hiệp phương sai|covariance|tương quan|correlation/i.test(sec.titleVi),
      );
      if (!targetSec && processed.length > 2) {
        targetSec = processed[2]; // Typically Section C
      }
      if (!targetSec) {
        targetSec = processed.find((sec) => /portfolio|danh mục/i.test(sec.titleVi)) ?? processed[0];
      }
      if (targetSec) {
        targetSec.formulas.push(
          sanitizeFormula({
            name: "",
            leadText: "Hiệp phương sai theo các kịch bản xác suất:",
            latex: "\\text{Cov}(R_A, R_B) = \\sum_{i=1}^n P_i (R_{A,i} - E[R_A])(R_{B,i} - E[R_B])",
            description: "Đo lường mức độ đồng biến thiên giữa lợi suất của hai tài sản.",
            variables: [
              { symbol: "\\text{Cov}(R_A, R_B)", definition: "Hiệp phương sai giữa tài sản A và B" },
              { symbol: "P_i", definition: "Xác suất kịch bản i" },
              { symbol: "R_{A,i}, R_{B,i}", definition: "Lợi suất của A và B trong kịch bản i" },
            ],
          }),
          sanitizeFormula({
            name: "",
            leadText: "Hệ số tương quan và mối quan hệ với hiệp phương sai:",
            latex: "\\rho_{AB} = \\text{Corr}(R_A, R_B) = \\frac{\\text{Cov}(R_A, R_B)}{\\sigma_A \\sigma_B} \\quad \\implies \\quad \\text{Cov}(R_A, R_B) = \\rho_{AB} \\sigma_A \\sigma_B",
            description: "Hệ số tương quan chuẩn hóa hiệp phương sai về đoạn [-1, 1].",
            variables: [
              { symbol: "\\rho_{AB}", definition: "Hệ số tương quan (Correlation coefficient)" },
            ],
          }),
        );
      }
    }

    // 3. CAPM / SML & Beta
    const hasCapmFormula = processed.some(
      (sec) =>
        sec.formulas.some((f) => /R_f\s*\+\s*\\beta|\\beta_p\s*=/i.test(f.latex)) ||
        (sec.subSections &&
          sec.subSections.some((sub) =>
            sub.formulas.some((f) => /R_f\s*\+\s*\\beta|\\beta_p\s*=/i.test(f.latex)),
          )),
    );

    if (!hasCapmFormula) {
      let targetSec = processed.find((sec) =>
        /capm|sml|thị trường chứng khoán|beta/i.test(sec.titleVi),
      );
      if (!targetSec && processed.length > 3) {
        targetSec = processed[processed.length - 1]; // Typically Section E
      }
      if (targetSec) {
        targetSec.formulas.push(
          sanitizeFormula({
            name: "",
            leadText: "Mô hình định giá tài sản vốn (CAPM / SML):",
            latex: "E[R_i] = R_f + \\beta_i (E[R_M] - R_f)",
            description: "Tỷ suất sinh lời đòi hỏi của tài sản i dựa trên rủi ro hệ thống beta.",
            variables: [
              { symbol: "E[R_i]", definition: "Tỷ suất sinh lời đòi hỏi của tài sản i" },
              { symbol: "R_f", definition: "Lãi suất phi rủi ro (Risk-free rate)" },
              { symbol: "\\beta_i", definition: "Hệ số beta đo lường rủi ro hệ thống của tài sản i" },
              { symbol: "E[R_M] - R_f", definition: "Phần bù rủi ro thị trường (Market risk premium)" },
            ],
          }),
          sanitizeFormula({
            name: "",
            leadText: "Hệ số Beta danh mục và công thức xác định Beta:",
            latex: "\\beta_p = \\sum_{j=1}^m w_j \\beta_j = w_A \\beta_A + w_B \\beta_B, \\quad \\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2} = \\frac{\\rho_{i,M}\\sigma_i}{\\sigma_M}",
            description: "Beta danh mục là bình quân gia quyền các beta thành phần.",
            variables: [
              { symbol: "\\beta_p", definition: "Hệ số beta của danh mục đầu tư" },
              { symbol: "\\sigma_M^2", definition: "Phương sai của danh mục thị trường" },
            ],
          }),
        );
      }
    }
  }

  if (isChapter10Historical) {
    // Historical Sample Variance
    const hasHistoricalVariance = processed.some(
      (sec) =>
        sec.formulas.some((f) => /s\^2|T\s*-\s*1/i.test(f.latex)) ||
        (sec.subSections &&
          sec.subSections.some((sub) =>
            sub.formulas.some((f) => /s\^2|T\s*-\s*1/i.test(f.latex)),
          )),
    );

    if (!hasHistoricalVariance) {
      let targetSec = processed.find((sec) =>
        /phương sai|độ lệch chuẩn|variance|standard deviation/i.test(sec.titleVi),
      );
      if (!targetSec && processed.length > 2) {
        targetSec = processed[2]; // Typically Section C
      }
      if (!targetSec) targetSec = processed[0];
      if (targetSec) {
        targetSec.formulas.push(
          sanitizeFormula({
            name: "",
            leadText: "Phương sai và độ lệch chuẩn mẫu lịch sử (mẫu số strictly T - 1):",
            latex: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2, \\quad s = \\sqrt{s^2}",
            description: "Khi ước lượng phương sai mẫu từ chuỗi dữ liệu lịch sử, bắt buộc chia cho T - 1.",
            variables: [
              { symbol: "s^2, s", definition: "Phương sai mẫu và độ lệch chuẩn mẫu lịch sử" },
              { symbol: "T", definition: "Số thời kỳ quan sát trong mẫu" },
              { symbol: "\\bar{R}", definition: "Trung bình số học của các tỷ suất sinh lời lịch sử" },
              { symbol: "R_t", definition: "Tỷ suất sinh lời thực tế tại thời kỳ t" },
            ],
          }),
        );
      }
    }

    // Historical Total Return
    const hasTotalReturn = processed.some(
      (sec) =>
        sec.formulas.some((f) => /D_?\{?t\+1\}?|P_?\{?t\+1\}?|Dividend Yield/i.test(f.latex)) ||
        (sec.subSections &&
          sec.subSections.some((sub) =>
            sub.formulas.some((f) => /D_?\{?t\+1\}?|P_?\{?t\+1\}?|Dividend Yield/i.test(f.latex)),
          )),
    );

    if (!hasTotalReturn) {
      let targetSec = processed.find((sec) =>
        /tổng quan|lợi suất|return/i.test(sec.titleVi),
      );
      if (!targetSec) targetSec = processed[0];
      if (targetSec) {
        targetSec.formulas.push(
          sanitizeFormula({
            name: "",
            leadText: "Tổng tỷ suất sinh lời lịch sử:",
            latex: "R_{t+1} = \\frac{D_{t+1} + P_{t+1} - P_t}{P_t} = \\text{Dividend Yield} + \\text{Capital Gains Yield}",
            description: "Tổng lợi suất bao gồm lợi suất cổ tức và lợi suất tăng vốn.",
            variables: [
              { symbol: "R_{t+1}", definition: "Tổng tỷ suất sinh lời ở thời kỳ t+1" },
              { symbol: "D_{t+1}", definition: "Cổ tức nhận được ở thời kỳ t+1" },
              { symbol: "P_t, P_{t+1}", definition: "Giá cổ phiếu tại đầu kỳ và cuối kỳ" },
            ],
          }),
        );
      }
    }

    // Geometric vs Arithmetic Average
    const hasAverages = processed.some(
      (sec) =>
        sec.formulas.some((f) => /\\prod|\\bar\{R\}_\{?\\text\{(geom|arith)\}\}?/i.test(f.latex)) ||
        (sec.subSections &&
          sec.subSections.some((sub) =>
            sub.formulas.some((f) => /\\prod|\\bar\{R\}_\{?\\text\{(geom|arith)\}\}?/i.test(f.latex)),
          )),
    );

    if (!hasAverages) {
      let targetSec = processed.find((sec) =>
        /trung bình|average|hình học|số học/i.test(sec.titleVi),
      );
      if (!targetSec && processed.length > 1) {
        targetSec = processed[1]; // Typically Section B
      }
      if (!targetSec) targetSec = processed[0];
      if (targetSec) {
        targetSec.formulas.push(
          sanitizeFormula({
            name: "",
            leadText: "Trung bình hình học và trung bình số học:",
            latex: "\\bar{R}_{\\text{geom}} = \\left[\\prod_{t=1}^T (1 + R_t)\\right]^{1/T} - 1, \\quad \\bar{R}_{\\text{arith}} = \\frac{1}{T} \\sum_{t=1}^T R_t",
            description: "Trung bình hình học đo lường tăng trưởng kép thực tế qua các năm; luôn nhỏ hơn hoặc bằng trung bình số học.",
            variables: [
              { symbol: "\\bar{R}_{\\text{geom}}", definition: "Tỷ suất sinh lời trung bình hình học (Geometric average return)" },
              { symbol: "\\bar{R}_{\\text{arith}}", definition: "Tỷ suất sinh lời trung bình số học (Arithmetic average return)" },
            ],
          }),
        );
      }
    }
  }

  return processed;
}

function sanitizeSubSection(sub: NoteSubSection): NoteSubSection {
  return {
    ...sub,
    heading: sanitizeSubSectionHeading(sub.heading),
    leadIn: sub.leadIn ? sanitizeUniversalText(sub.leadIn) : undefined,
    bulletPoints: (sub.bulletPoints ?? []).map(sanitizeUniversalText),
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
    formulas: (section.formulas ?? []).map(sanitizeFormula),
    subSections: (section.subSections ?? []).map(sanitizeSubSection),
    keyTakeaways: section.keyTakeaways
      ? {
          ...section.keyTakeaways,
          title: cleanTypoString(section.keyTakeaways.title || "KEY TAKEAWAYS"),
          items: (section.keyTakeaways.items ?? []).map((item) => ({
            point: sanitizeUniversalText(item.point),
            subBullets: (item.subBullets ?? []).map(sanitizeUniversalText),
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
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
        },
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

  // Normalize noise reduction rate: if LLM returns a fraction like 0.81 instead of 81, scale to percentage
  let noiseRate = meta.noiseReductionRate ?? 85;
  if (noiseRate > 0 && noiseRate <= 1) {
    noiseRate = Math.round(noiseRate * 100);
  } else {
    noiseRate = Math.min(98, Math.max(20, Math.round(noiseRate)));
  }

  const rawSlideText = options.sources.map((s) => s.text).join("\n");
  const shieldedSections = applyHallucinationShield(populatedSections, rawSlideText);

  const finalNote: ClutchNote = {
    id: noteId,
    title: sanitizeUniversalText(meta.title.trim()),
    subject: sanitizeUniversalText(meta.subject.trim()),
    createdAt: new Date().toISOString(),
    originalFileName: options.fileName,
    originalSlideCount: options.slideCount,
    estimatedDistilledPages: meta.estimatedDistilledPages || 3,
    noiseReductionRate: noiseRate,
    executiveSummary: sanitizeUniversalText(meta.executiveSummary.trim()),
    sections: shieldedSections,
  };

  finalNote.rawMarkdown = buildMarkdownNote(finalNote);

  return finalNote;
}
