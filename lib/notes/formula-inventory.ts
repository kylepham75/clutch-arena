import { generateObject, type LanguageModel } from "ai";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import type {
  OcrTranscribedEquation,
  OmmlTranscribedEquation,
} from "@/lib/ingestion/parse-pptx";
import {
  formatAccountingFormula,
  repairCorruptedLatex,
  isLikelyInlineMath,
  wrapBareEnglishInLatex,
  renderKatexSafe,
} from "@/lib/math/latex";
import { normalizePdfMathSymbols } from "@/lib/notes/pdf-symbol-normalizer";
import {
  extractionSchema,
  type ExtractedFormulaItem,
  type ExtractedSlideClaim,
  type ExtractionResult,
  type FormulaLedgerEntry,
  type FormulaOrigin,
  type FormulaCandidateKind,
  type FormulaLifecycleState,
  type FormulaCandidate,
  type AcceptedFormulaKind,
  type AcceptedFormula,
  type SymbolBinding,
  formulaCandidateSchema,
  acceptedFormulaSchema,
  symbolBindingSchema,
} from "@/lib/schemas/notes";

export type {
  FormulaOrigin,
  FormulaCandidateKind,
  FormulaLifecycleState,
  FormulaCandidate,
  AcceptedFormulaKind,
  AcceptedFormula,
  SymbolBinding,
};
export { formulaCandidateSchema, acceptedFormulaSchema, symbolBindingSchema };

export interface FormulaInventoryItem {
  id: string; // Deterministic sequential ID: "F1", "F2", "F3", ...
  slide: number; // 1-based slide number
  raw: string; // Original raw equation string from the slide
  latex: string; // Clean LaTeX string (without surrounding $...$)
  origin: FormulaOrigin;
  confidence?: number; // Present when origin === "ocr"
}

export interface BuildFormulaInventoryInput {
  sources: SourceBlock[];
  ommlEquations?: OmmlTranscribedEquation[];
  ocrEquations?: OcrTranscribedEquation[];
}

const UNICODE_SUBSCRIPTS: Record<string, string> = {
  "₀": "_0",
  "₁": "_1",
  "₂": "_2",
  "₃": "_3",
  "₄": "_4",
  "₅": "_5",
  "₆": "_6",
  "₇": "_7",
  "₈": "_8",
  "₉": "_9",
  "ᵢ": "_i",
  "ₜ": "_t",
  "ₙ": "_n",
  "ₐ": "_a",
  "ₑ": "_e",
  "ₒ": "_o",
  "ₓ": "_x",
  "ⱼ": "_j",
  "ₖ": "_k",
  "ₘ": "_m",
  "ₚ": "_p",
  "ₛ": "_s",
};

const UNICODE_SUPERSCRIPTS: Record<string, string> = {
  "⁰": "^0",
  "¹": "^1",
  "²": "^2",
  "³": "^3",
  "⁴": "^4",
  "⁵": "^5",
  "⁶": "^6",
  "⁷": "^7",
  "⁸": "^8",
  "⁹": "^9",
  "ⁿ": "^n",
  "ᵗ": "^t",
  "ⁱ": "^i",
};

const UNICODE_GREEK: Record<string, string> = {
  "α": "\\alpha",
  "β": "\\beta",
  "γ": "\\gamma",
  "δ": "\\delta",
  "ε": "\\epsilon",
  "ϵ": "\\epsilon",
  "ζ": "\\zeta",
  "η": "\\eta",
  "θ": "\\theta",
  "ϑ": "\\vartheta",
  "ι": "\\iota",
  "κ": "\\kappa",
  "λ": "\\lambda",
  "μ": "\\mu",
  "ν": "\\nu",
  "ξ": "\\xi",
  "π": "\\pi",
  "ϖ": "\\varpi",
  "ρ": "\\rho",
  "ϱ": "\\varrho",
  "σ": "\\sigma",
  "ς": "\\varsigma",
  "τ": "\\tau",
  "υ": "\\upsilon",
  "φ": "\\phi",
  "ϕ": "\\varphi",
  "χ": "\\chi",
  "ψ": "\\psi",
  "ω": "\\omega",
  "Γ": "\\Gamma",
  "Δ": "\\Delta",
  "Θ": "\\Theta",
  "Λ": "\\Lambda",
  "Ξ": "\\Xi",
  "Π": "\\Pi",
  "Σ": "\\Sigma",
  "Υ": "\\Upsilon",
  "Φ": "\\Phi",
  "Ψ": "\\Psi",
  "Ω": "\\Omega",
};

const UNICODE_MATH_SYMBOLS: Record<string, string> = {
  "×": " \\times ",
  "÷": " \\div ",
  "−": "-",
  "–": "-",
  "—": "-",
  "∑": "\\sum ",
  "∏": "\\prod ",
  "√": "\\sqrt ",
  "±": "\\pm ",
  "∓": "\\mp ",
  "≤": "\\le ",
  "≥": "\\ge ",
  "≠": "\\ne ",
  "≈": "\\approx ",
  "≡": "\\equiv ",
  "·": "\\cdot ",
  "⋅": "\\cdot ",
  "∫": "\\int ",
  "∂": "\\partial ",
  "∞": "\\infty ",
  "↑": " \\uparrow ",
  "↓": " \\downarrow ",
  "→": " \\rightarrow ",
  "←": " \\leftarrow ",
  "⇒": " \\implies ",
  "⇐": " \\impliedby ",
  "⇔": " \\iff ",
  "⇑": " \\Uparrow ",
  "⇓": " \\Downarrow ",
};

/**
 * Converts Unicode math symbols, Greek letters, subscripts, and superscripts into standard LaTeX.
 */
export function convertUnicodeMath(text: string): string {
  if (!text) return "";
  let s = normalizePdfMathSymbols(text);

  for (const [sub, repl] of Object.entries(UNICODE_SUBSCRIPTS)) {
    s = s.replaceAll(sub, repl);
  }
  for (const [sup, repl] of Object.entries(UNICODE_SUPERSCRIPTS)) {
    s = s.replaceAll(sup, repl);
  }
  for (const [greek, repl] of Object.entries(UNICODE_GREEK)) {
    s = s.replace(new RegExp(greek + "(?=[a-zA-Z0-9])", "g"), `${repl} `);
    s = s.replaceAll(greek, repl);
  }
  for (const [sym, repl] of Object.entries(UNICODE_MATH_SYMBOLS)) {
    s = s.replaceAll(sym, repl);
  }

  // Convert ASCII implication and arrow tokens
  s = s.replace(/(?<![<>])=>/g, " \\implies ");
  s = s.replace(/(?<!<)->/g, " \\rightarrow ");
  s = s.replace(/<-(?!>)/g, " \\leftarrow ");

  return s;
}

/**
 * Strips outer enclosing matching parentheses, e.g. "(A + B)" -> "A + B",
 * while preserving internal or unmatching expressions like "(A + B) / (C + D)".
 */
function stripOuterParens(str: string): string {
  let s = str.trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let matchedEnd = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") {
        depth++;
      } else if (s[i] === ")") {
        depth--;
        if (depth === 0) {
          if (i === s.length - 1) {
            matchedEnd = true;
          }
          break;
        }
      }
    }
    if (matchedEnd) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}

/**
 * Structure-preserving key normalizer that strips whitespace, $, \text{...}, \mathrm{...},
 * \mathbf{...}, \left, \right, outer parens on LHS/RHS, and single-char braces {x} -> x,
 * while preserving ^, _, /, +, -, \frac, \sum, \sqrt, \prod.
 */
export function normalizeInventoryFormulaKey(latex: string): string {
  if (!latex || typeof latex !== "string") return "";

  let s = latex.trim();

  // Strip dollar signs
  s = s.replace(/\$/g, "");

  // Normalize Unicode dashes and math operators
  s = s.replace(/[\u2212\u2013\u2014]/g, "-");
  s = s.replace(/×/g, "\\times");
  s = s.replace(/÷/g, "\\div");

  // Strip \left and \right
  s = s.replace(/\\(?:left|right)\./g, "");
  s = s.replace(/\\(?:left|right)(?=[()[\]{}|]|\b)/g, "");

  // Strip font/text wrappers: \text, \mathrm, \mathbf, \boldsymbol, \textbf, \mathit, \operatorname
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(
      /\\(?:text|mathrm|mathbf|boldsymbol|textbf|mathit|operatorname)\{([^{}]*)\}/g,
      "$1",
    );
  }

  // Strip single-char braces: {x} -> x (where x is a single non-brace character)
  prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/(?<!\\)\{([^{}\\])\}/g, "$1");
  }

  // Strip all whitespace
  s = s.replace(/\s+/g, "");

  // Strip outer parens on LHS and RHS around '='
  if (s.includes("=")) {
    const parts = s.split("=");
    s = parts.map((part) => stripOuterParens(part)).join("=");
  } else {
    s = stripOuterParens(s);
  }

  return s;
}

/**
 * Checks if a string has a dangling relation operator or an empty side (LHS or RHS)
 * around '=', '\approx', '≈', '\equiv', '≡', '\sim', '\le', '\ge', '\leq', '\geq', '\ne', '\neq'.
 */
export function isDanglingOrEmptySideEquation(str: string): boolean {
  if (!str) return true;
  const s = str.replace(/^\s*\$+|\$+\s*$/g, "").trim();
  if (!s) return true;

  // Single stray '=' or '==' or relation operator
  if (
    /^(?:={1,3}|\\approx|≈|\\equiv|≡|\\sim|\\le|\\ge|\\leq|\\geq|\\ne|\\neq|≤|≥|≠)$/.test(
      s,
    )
  ) {
    return true;
  }

  // Starts or ends with '='
  if (s.startsWith("=") || s.endsWith("=")) return true;

  // Consecutive '=' like '==' or '===' not part of <=> or <= / >=
  if (/(?<![<>!])={2,}(?![=>])/.test(s)) return true;

  // If contains relation operator, split and check LHS and RHS
  const relationRegex =
    /(?<![<>!])=(?![=>])|\\(?:approx|equiv|sim|le|ge|leq|geq|ne|neq)\b|[≈≡≤≥≠]/;
  if (relationRegex.test(s)) {
    const parts = s.split(relationRegex);
    const lhs = parts[0].trim();
    const rhs = parts.slice(1).join("=").trim();

    if (!lhs || !rhs) return true;

    // Reject if either side only has parentheses, brackets, or punctuation (e.g. "() =")
    const lhsContent = lhs
      .replace(/[()[\]{}\s.,;:!?"'“”‘’\-+*/=~^]/g, "")
      .trim();
    const rhsContent = rhs
      .replace(/[()[\]{}\s.,;:!?"'“”‘’\-+*/=~^]/g, "")
      .trim();
    if (!lhsContent || !rhsContent) return true;
  }

  return false;
}

const NON_VARIABLE_TOKENS_REGEX =
  /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|iint|iiint|oint|partial|times|div|cdot|pm|mp|ast|star|approx|equiv|sim|simeq|cong|le|ge|leq|geq|ne|neq|left|right|middle|big|Big|bigg|Bigg|ln|log|exp|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|min|max|inf|sup|lim|det|dim|deg|gcd|mod|text|mathrm|mathbf|boldsymbol|textbf|mathit|operatorname|mathbb|mathcal|quad|qquad|enspace|space|bar|hat|tilde|vec|dot|ddot|overline|underline)\b/g;

const CURRENCY_AND_UNIT_WORDS_REGEX =
  /\b(?:USD|VND|EUR|GBP|JPY|AUD|CAD|CHF|CNY|cents?|dollars?|percent|bps)\b/gi;

/**
 * Checks whether an expression contains mathematical variables (Latin letters, Greek letters, or subscripted tokens).
 */
export function hasSymbolicVariables(str: string): boolean {
  if (!str) return false;
  let s = str;

  // Strip known non-variable LaTeX command names
  s = s.replace(NON_VARIABLE_TOKENS_REGEX, " ");

  // Strip currency and unit words
  s = s.replace(CURRENCY_AND_UNIT_WORDS_REGEX, " ");

  // Check if any Latin letters [a-zA-Z] or Greek letters [\u0370-\u03FF] remain
  return /[a-zA-Z\u0370-\u03FF]/.test(s);
}

const PROSE_STOP_WORDS_REGEX =
  /\b(?:the|is|are|was|were|of|in|that|this|these|those|our|we|you|they|it|its|can|be|been|have|has|had|with|and|by|from|which|when|where|for|as|an|a|to|given|such|than|more|less|only|all|each|every|some|between|among|about|into|through|after|before|independent|identical|risks?|summary|relationship|holds|model|callout|table|note|definition|explanation|average|những|các|trong|khi|cho|với|được|bởi|từ|về|để|thì|mà|này|đó)\b/i;

const RECOGNIZED_ACCOUNTING_TERMS = new Set([
  "net working capital",
  "current assets",
  "current liabilities",
  "fixed assets",
  "operating cycle",
  "cash cycle",
  "inventory turnover",
  "receivables turnover",
  "payables turnover",
  "inventory period",
  "receivables period",
  "payables period",
  "ending cash",
  "beginning cash",
  "cash collections",
  "cash disbursements",
  "net cash flow",
  "cumulative surplus",
  "retention ratio",
  "total debt",
  "total assets",
  "total equity",
  "shareholders equity",
  "net income",
  "shares outstanding",
  "operating income",
  "cost of goods sold",
  "market value",
  "book value",
  "sustainable growth rate",
  "internal growth rate",
  "capital spending",
  "operating cash flow",
  "free cash flow",
]);

function isRecognizedAccountingTerm(str: string): boolean {
  const norm = str
    .trim()
    .toLowerCase()
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
  return RECOGNIZED_ACCOUNTING_TERMS.has(norm);
}

/**
 * Checks whether a side of an equation is purely a multi-word natural language prose phrase
 * (3+ words of prose without mathematical variables, subscripts, fractions, summations, or symbolic operators).
 */
export function isPureProsePhrase(side: string): boolean {
  if (!side) return false;
  const s = side.trim();
  if (!s) return false;

  // If it's a recognized accounting metric name (e.g. "Net Working Capital"), it's not prose
  if (isRecognizedAccountingTerm(s)) return false;

  // Has symbolic math operators or structural commands: +, -, *, /, ^, ×, ÷, −, –, —, ·, ⋅, ±, ∓, √, \times, \div, \cdot, \pm, \sqrt, \frac, \sum, \prod, \int
  if (
    /[+\-*/^×÷−–—·⋅±∓√]/.test(s) ||
    /\\(?:times|div|cdot|pm|mp|sqrt|frac|sum|prod|int)\b/.test(s)
  ) {
    return false;
  }

  // Has subscripts or superscripts
  if (/[_^]/.test(s)) return false;

  // Strip LaTeX formatting and wrappers
  const unwrapped = s
    .replace(
      /\\(?:text|mathrm|mathbf|boldsymbol|textbf|mathit|operatorname)\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\(?:left|right)\b[()[\]{}|.]?/g, "");

  // Strip parens, brackets, punctuation
  const clean = unwrapped.replace(/[()[\]{}.,;:!?"'“”‘’]/g, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);

  // If 3 or more words
  if (words.length >= 3) {
    // If it contains prose stop words / narrative indicators
    if (PROSE_STOP_WORDS_REGEX.test(clean)) {
      return true;
    }

    // Or if none of the words look like single-letter math variables or Greek letters
    const hasSingleLetterVariable = words.some(
      (w) => w.length === 1 && /[a-zA-Z]/.test(w),
    );
    if (!hasSingleLetterVariable && !/[\\_^{}]/.test(s)) {
      return true;
    }
  }

  return false;
}

/**
 * Formats and repairs raw mathematical / financial strings into clean LaTeX without surrounding $.
 */
export function cleanLatexEquation(rawEq: string): string {
  if (!rawEq) return "";
  let s = normalizePdfMathSymbols(rawEq);

  // Reject dangling = or empty-side equations right away
  if (isDanglingOrEmptySideEquation(s)) {
    return "";
  }

  s = convertUnicodeMath(s);
  s = repairCorruptedLatex(s);
  s = formatAccountingFormula(s);
  s = wrapBareEnglishInLatex(s);

  // Check again after conversions
  if (isDanglingOrEmptySideEquation(s)) {
    return "";
  }

  // Wrap common multi-word finance & accounting phrases in \text{...} if not already wrapped
  s = s.replace(
    /(?<!\\text\{)\b(Retention\s+ratio|Total\s+Debt|Total\s+Assets|Total\s+Equity|Shareholders['’]?\s+Equity|Net\s+Income|Shares\s+Outstanding|Operating\s+Income|Cost\s+of\s+Goods\s+Sold|Market\s+Value|Book\s+Value)\b(?!\})/gi,
    "\\text{$1}",
  );

  // Wrap known financial standalone acronyms in \text{...}
  s = s.replace(
    /(?<!\\text\{)\b(ROE|ROA|WACC|COGS|NWC|NPV|IRR|CAPM|EBIT|EBITDA|EPS|DPS|DSO)\b(?!\})/g,
    "\\text{$1}",
  );

  // Normalize duplicate whitespace
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\\sum\s+/g, "\\sum ");

  // Clean surrounding dollar signs
  s = s.replace(/^\s*\$+|\$+\s*$/g, "").trim();
  return s;
}

/**
 * Checks if a string is a trivial numeric calculation / plug-in line or a trivial scalar assignment.
 */
export function isNumericPluginOrScalarAssignment(eqStr: string): boolean {
  const s = eqStr.trim();
  if (!s) return true;

  // 1. Dangling = or empty sides (e.g. "T =", "S ==", "= 0.12", "= 0.15")
  if (isDanglingOrEmptySideEquation(s)) {
    return true;
  }

  const parts = s.split(/(?<![<>!])=(?![=>])/);
  if (parts.length < 2) return false;

  const lhs = parts[0].trim();
  const rhs = parts.slice(1).join("=").trim();

  if (!lhs || !rhs) return true;

  // 2. LHS has no variables at all
  // e.g. "100 / 0.10 = 1000", "0.26 = 0.04 + 1.1 \times (0.24 - 0.04)", "\sqrt{(0.12 - 0.08)^2 + (0.05 - 0.08)^2} = 0.05"
  if (!hasSymbolicVariables(lhs)) {
    return true;
  }

  // 3. RHS has no variables at all AND contains numbers
  // e.g. "R = (0.21 - 0.05 + 0.14) / 3 = 0.10", "Var = (0.2056)^2 = 0.04227", "\bar{R} = (0.10 + 0.12 - 0.04) / 3 = 0.06"
  if (!hasSymbolicVariables(rhs) && /\d/.test(rhs)) {
    return true;
  }

  // 4. Trivial scalar assignment:
  // LHS is a short variable (e.g. "t", "n", "r", "g", "k", "x", "y", "P", "P_0", "D_1", "t_0")
  // AND RHS is purely a scalar number, percentage, or currency (e.g. "1", "0.05", "10%", "$50", "$2.50", "-3")
  const isShortLhs = /^[a-zA-Z]{1,3}(?:_[a-zA-Z0-9]+)?$/.test(lhs);
  const isScalarRhs = /^[\$€£]?\s*[-+]?\d+(?:\.\d+)?\s*%?[\$€£]?$/.test(rhs);
  if (isShortLhs && isScalarRhs) {
    return true;
  }

  return false;
}

/**
 * Validates whether an equation/expression is a nontrivial, meaningful formula.
 */
export function isNontrivialFormula(latex: string): boolean {
  const s = latex.replace(/^\s*\$+|\$+\s*$/g, "").trim();
  if (!s) return false;

  // 1. Dangling relation operators or empty sides
  if (isDanglingOrEmptySideEquation(s)) {
    return false;
  }

  // 2. Contains relation operator: =, \approx, \le, \ge, \ne, \neq, \sim
  if (
    /=|\\approx|≈|\\equiv|≡|\\le|\\ge|\\leq|\\geq|\\ne|\\neq|\\sim/.test(s)
  ) {
    if (isNumericPluginOrScalarAssignment(s)) {
      return false;
    }

    // Check if either side is pure prose
    const parts = s.split(
      /(?<![<>!])=(?![=>])|\\(?:approx|equiv|sim|le|ge|leq|geq|ne|neq)\b|[≈≡≤≥≠]/,
    );
    if (parts.length >= 2) {
      const lhs = parts[0].trim();
      const rhs = parts.slice(1).join("=").trim();
      if (isPureProsePhrase(lhs) || isPureProsePhrase(rhs)) {
        return false;
      }
    }

    return true;
  }

  // 3. For expressions without relation operators:
  // Reject pure numeric arithmetic without variables (e.g. "(0.21 - 0.05 + 0.14) / 3", "\sqrt{(0.12 - 0.08)^2}")
  if (!hasSymbolicVariables(s)) {
    return false;
  }

  // Check for pure prose fragment without relation operator
  if (isPureProsePhrase(s)) {
    return false;
  }

  // Contains major structural operator: \frac, \sum, \sqrt, \prod, \int, \partial
  if (/\\(?:frac|sum|sqrt|prod|int|partial)\b/.test(s)) {
    return true;
  }

  // Check for lone single variable / token without operators: e.g. "R", "g", "\sigma", "r_f"
  const hasBinaryOperator =
    /[+\-*/^]/.test(s) || /\\(?:times|div|cdot)\b/.test(s);
  if (!hasBinaryOperator) {
    return false;
  }

  // If it only has a single leading minus on a lone token, e.g. "-5" or "-x"
  if (/^[-+]\s*[a-zA-Z0-9_\\]+$/.test(s)) {
    return false;
  }

  return true;
}

/**
 * Deterministically parses the 1-based slide number from source.id or source.label,
 * falling back to index + 1.
 */
export function parseSlideNumber(
  source: SourceBlock,
  fallbackIndex: number,
): number {
  if (source.id) {
    const idMatch =
      source.id.match(/(?:slide|page)[-_](\d+)/i) || source.id.match(/(\d+)/);
    if (idMatch) {
      const num = parseInt(idMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  if (source.label) {
    const labelMatch =
      source.label.match(/(?:slide|page)\s*(\d+)/i) ||
      source.label.match(/(\d+)/);
    if (labelMatch) {
      const num = parseInt(labelMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return fallbackIndex + 1;
}

/**
 * Deterministically scans slide text for explicit math blocks and prose formulas.
 */
export function extractTextFormulas(
  text: string,
): Array<{ raw: string; latex: string }> {
  if (!text || !text.trim()) return [];

  const normalizedText = normalizePdfMathSymbols(text);
  const results: Array<{ raw: string; latex: string }> = [];
  const seenKeys = new Set<string>();

  // 1. Explicit display math blocks: $$...$$
  const displayRegex = /\$\$([\s\S]+?)\$\$/g;
  let dMatch: RegExpExecArray | null;
  while ((dMatch = displayRegex.exec(normalizedText)) !== null) {
    const rawContent = dMatch[1].trim();
    const cleanLatex = rawContent.replace(/^\s*\$+|\$+\s*$/g, "").trim();
    if (
      isNontrivialFormula(cleanLatex) &&
      !isNumericPluginOrScalarAssignment(cleanLatex)
    ) {
      const normKey = normalizeInventoryFormulaKey(cleanLatex);
      if (!seenKeys.has(normKey)) {
        seenKeys.add(normKey);
        results.push({
          raw: rawContent,
          latex: cleanLatex,
        });
      }
    }
  }

  // 2. Explicit inline math blocks: $...$
  const inlineRegex = /(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g;
  let iMatch: RegExpExecArray | null;
  while ((iMatch = inlineRegex.exec(normalizedText)) !== null) {
    const candidate = iMatch[1].trim();
    if (isLikelyInlineMath(candidate)) {
      const cleanLatex = candidate.replace(/^\s*\$+|\$+\s*$/g, "").trim();
      if (
        isNontrivialFormula(cleanLatex) &&
        !isNumericPluginOrScalarAssignment(cleanLatex)
      ) {
        const normKey = normalizeInventoryFormulaKey(cleanLatex);
        if (!seenKeys.has(normKey)) {
          seenKeys.add(normKey);
          results.push({
            raw: candidate,
            latex: cleanLatex,
          });
        }
      }
    }
  }

  // 3. Plain-text lines and clauses
  const lines = normalizedText.split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.length > 1000) continue;

    // If the line already had inline/display math, strip $...$ and $$...$$ before checking if plain-text equations remain
    const textWithoutMathDelimiters = trimmedLine
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      .replace(/(?<!\$)\$(?!\$)[^\$\n]+?\$(?!\$)/g, "")
      .trim();
    if (!/(?<![<>!])=(?![=>])/.test(textWithoutMathDelimiters)) {
      continue;
    }

    // Split by semicolons for multi-clause lines
    const clauses = trimmedLine.split(";");
    for (let clause of clauses) {
      clause = clause.trim();
      if (!clause || clause.length > 1000) continue;

      // Strip leading bullet markers
      clause = clause.replace(/^[•\-\*\u2022\u25E6\u25AA\u25CF]\s*/, "");
      clause = clause.replace(/^\d+[\.\)]\s*/, "");

      // If clause contains standalone '=' (ignore =>, <=, >=, !=)
      if (!/(?<![<>!])=(?![=>])/.test(clause)) continue;

      // Check if clause has leading label before colon where '=' is after colon
      // e.g. "Constant growth model: P_0 = D_1 / (R - g)"
      // e.g. "Exercise 1: Use P_0 = D_1 / (R - g) to find price"
      const colonIdx = clause.indexOf(":");
      const eqMatch = clause.match(/(?<![<>!])=(?![=>])/);
      const eqIdx = eqMatch ? eqMatch.index! : -1;
      if (colonIdx !== -1 && eqIdx !== -1 && colonIdx < eqIdx) {
        const beforeColon = clause.slice(0, colonIdx).trim();
        if (!/(?<![<>!])=(?![=>])/.test(beforeColon)) {
          clause = clause.slice(colonIdx + 1).trim();
        }
      }

      // Convert Unicode math on clause before splitting and regex parsing
      const unicodeConvertedClause = convertUnicodeMath(clause);

      // Split around standalone '=' (ignore =>, <=, >=, !=)
      const eqParts = unicodeConvertedClause.split(/(?<![<>!])=(?![=>])/);
      if (eqParts.length < 2) continue;

      let rawLhs = eqParts[0].trim();
      let rawRhs: string;

      // Chained '=' detection: e.g. P_0 = D_1 / (R - g) = 2.50 / (0.10 - 0.05) = $50
      if (eqParts.length > 2) {
        const p1 = eqParts[1].trim();
        const p2 = eqParts[2].trim();
        if (hasSymbolicVariables(p1) && !hasSymbolicVariables(p2)) {
          rawRhs = p1;
        } else {
          rawRhs = eqParts.slice(1).join("=").trim();
        }
      } else {
        rawRhs = eqParts[1].trim();
      }

      // Early exit if either side is empty or dangling
      if (!rawLhs || !rawRhs) continue;
      if (
        rawLhs.endsWith("=") ||
        rawRhs.startsWith("=") ||
        rawRhs.endsWith("=")
      ) {
        continue;
      }

      // Strip leading prose from LHS:
      // e.g. "Use P_0" -> "P_0", "Exercise 1: Use P_0" -> "P_0"
      const PROSE_PREFIX_REGEX =
        /^(?:(?:exercise|example|problem|case|question)\s+\d+[:.]?\s*)?(?:(?:use|using|calculate|find|compute|determine|where|with|if|let|we have|recall that|recall|apply|applying|note that|sử dụng|tính|tìm|áp dụng|ta có)\s+(?:the\s+)?(?:formula\s+(?:for\s+|is\s+)?|equation\s+(?:for\s+|is\s+)?)?|(?:formula|equation)\s+(?:for|is)\s+)/i;
      rawLhs = rawLhs.replace(PROSE_PREFIX_REGEX, "").trim();

      // Strip trailing parenthetical prose remarks from RHS:
      const parenMatch = rawRhs.match(/\s+\(([^()]+)\)[.,;]?$/);
      if (parenMatch) {
        const inner = parenMatch[1].trim();
        const isMathParen =
          /[+\-*/^=×÷\u2212\u2013\u2014]/.test(inner) ||
          /\\(?:times|div|frac|sum|sqrt)\b/.test(inner) ||
          /^[a-zA-Z0-9_]+$/.test(inner);
        if (!isMathParen) {
          rawRhs = rawRhs.slice(0, parenMatch.index).trim();
        }
      }

      // Strip trailing prose phrases from RHS
      const TRAILING_PROSE_REGEX =
        /\s+(?:to\s+(?:find|calculate|determine|solve|get|estimate|compute)|where\b|for\b|when\b|with\b|assuming\b|such that\b|để\s+(?:tính|tìm)|với\b|khi\b).*$/i;
      rawRhs = rawRhs.replace(TRAILING_PROSE_REGEX, "").trim();

      // Strip trailing punctuation
      rawRhs = rawRhs.replace(/[.,;:]+$/, "").trim();

      if (!rawLhs || !rawRhs) continue;

      const candidateRaw = `${rawLhs} = ${rawRhs}`;

      if (
        isDanglingOrEmptySideEquation(candidateRaw) ||
        !isNontrivialFormula(candidateRaw) ||
        isNumericPluginOrScalarAssignment(candidateRaw)
      ) {
        continue;
      }

      const cleanLatex = cleanLatexEquation(candidateRaw);
      if (!cleanLatex) continue;
      if (
        !isNontrivialFormula(cleanLatex) ||
        isNumericPluginOrScalarAssignment(cleanLatex)
      ) {
        continue;
      }

      const normKey = normalizeInventoryFormulaKey(cleanLatex);
      if (!seenKeys.has(normKey)) {
        seenKeys.add(normKey);
        // Original raw before Unicode conversion if present in clause
        const originalLhs = clause
          .split("=")[0]
          .trim()
          .replace(PROSE_PREFIX_REGEX, "")
          .trim();
        const originalRhs = clause
          .split("=")
          .slice(1)
          .join("=")
          .trim()
          .replace(TRAILING_PROSE_REGEX, "")
          .replace(/[.,;:]+$/, "")
          .trim();
        const displayRaw =
          originalLhs && originalRhs
            ? `${originalLhs} = ${originalRhs}`
            : candidateRaw;

        results.push({
          raw: displayRaw,
          latex: cleanLatex,
        });
      }
    }
  }

  return results;
}

/**
 * Builds a deterministic formula inventory from presentation sources, OMML equations, and OCR equations.
 */
export function buildFormulaInventory(
  input: SourceBlock[] | BuildFormulaInventoryInput,
): FormulaInventoryItem[] {
  let sources: SourceBlock[] = [];
  let ommlEquations: OmmlTranscribedEquation[] = [];
  let ocrEquations: OcrTranscribedEquation[] = [];

  if (Array.isArray(input)) {
    sources = input;
  } else if (input && typeof input === "object") {
    sources = input.sources ?? [];
    ommlEquations = input.ommlEquations ?? [];
    ocrEquations = input.ocrEquations ?? [];
  }

  const slideSourcesMap = new Map<number, SourceBlock>();
  sources.forEach((src, idx) => {
    const slideNum = parseSlideNumber(src, idx);
    slideSourcesMap.set(slideNum, src);
  });

  const allSlideNumbers = new Set<number>();
  slideSourcesMap.forEach((_, num) => allSlideNumbers.add(num));
  ommlEquations.forEach((eq) => allSlideNumbers.add(eq.slide));
  ocrEquations.forEach((eq) => allSlideNumbers.add(eq.slide));

  const sortedSlides = Array.from(allSlideNumbers).sort((a, b) => a - b);
  const inventory: Omit<FormulaInventoryItem, "id">[] = [];

  for (const slide of sortedSlides) {
    const slideSeenKeys = new Set<string>();

    // 1. OMML equations for this slide (highest origin priority for pptx math)
    const slideOmmls = ommlEquations.filter((eq) => eq.slide === slide);
    for (const omml of slideOmmls) {
      const cleanLatex = normalizePdfMathSymbols(omml.latex || "")
        .replace(/^\s*\$+|\$+\s*$/g, "")
        .trim();
      if (
        !cleanLatex ||
        !isNontrivialFormula(cleanLatex) ||
        isNumericPluginOrScalarAssignment(cleanLatex)
      ) {
        continue;
      }

      const normKey = normalizeInventoryFormulaKey(cleanLatex);
      if (slideSeenKeys.has(normKey)) continue;
      slideSeenKeys.add(normKey);

      inventory.push({
        slide,
        raw: normalizePdfMathSymbols((omml.raw || cleanLatex).trim()),
        latex: cleanLatex,
        origin: "omml",
      });
    }

    // 2. OCR equations for this slide
    const slideOcrs = ocrEquations.filter((eq) => eq.slide === slide);
    for (const ocr of slideOcrs) {
      const cleanLatex = normalizePdfMathSymbols(ocr.latex || "")
        .replace(/^\s*\$+|\$+\s*$/g, "")
        .trim();
      if (
        !cleanLatex ||
        !isNontrivialFormula(cleanLatex) ||
        isNumericPluginOrScalarAssignment(cleanLatex)
      ) {
        continue;
      }

      const normKey = normalizeInventoryFormulaKey(cleanLatex);
      if (slideSeenKeys.has(normKey)) continue;
      slideSeenKeys.add(normKey);

      inventory.push({
        slide,
        raw: normalizePdfMathSymbols((ocr.raw || cleanLatex).trim()),
        latex: cleanLatex,
        origin: "ocr",
        confidence:
          typeof ocr.confidence === "number" ? ocr.confidence : undefined,
      });
    }

    // 3. Text equations scanned from source.text for this slide
    const source = slideSourcesMap.get(slide);
    if (source && source.text) {
      const textCandidates = extractTextFormulas(source.text);
      for (const cand of textCandidates) {
        const normKey = normalizeInventoryFormulaKey(cand.latex);
        if (slideSeenKeys.has(normKey)) continue;
        slideSeenKeys.add(normKey);

        inventory.push({
          slide,
          raw: cand.raw,
          latex: cand.latex,
          origin: "text",
        });
      }
    }
  }

  // Assign sequential deterministic IDs: F1, F2, F3, ...
  return inventory.map((item, idx) => ({
    ...item,
    id: `F${idx + 1}`,
  }));
}

export const DEFAULT_EXTRACTION_CHUNK_SIZE = 8;

/**
 * Returns the lowest valid OpenRouter reasoning effort for a model.
 * Mandatory-reasoning models (e.g. `anthropic/claude-sonnet-5.5`, `claude-opus`, `o1`/`o3`/`o4`)
 * reject `"none"` with HTTP 400 and require `"low"`, while other models support `"none"`.
 */
export function getSafeOpenRouterReasoningEffort(model: unknown): "low" | "none" {
  const modelId = String(
    (model as any)?.modelId ?? (model as any)?.id ?? "",
  ).toLowerCase();
  if (/claude-sonnet|claude-opus|\bo[134](?:-|$)/.test(modelId)) {
    return "low";
  }
  return "none";
}

export interface SlideWithNumber {
  slide: number;
  source: SourceBlock;
}

/**
 * Partitions slide sources into chunks of size chunkSize (default 8) sorted by slide number.
 */
export function chunkSlideSources(
  sources: SourceBlock[],
  chunkSize: number = DEFAULT_EXTRACTION_CHUNK_SIZE,
): SlideWithNumber[][] {
  if (!sources || sources.length === 0) return [];
  const effectiveChunkSize =
    chunkSize > 0 ? Math.floor(chunkSize) : DEFAULT_EXTRACTION_CHUNK_SIZE;

  const slidesWithNumbers: SlideWithNumber[] = sources.map((src, idx) => ({
    slide: parseSlideNumber(src, idx),
    source: src,
  }));

  slidesWithNumbers.sort((a, b) => a.slide - b.slide);

  const chunks: SlideWithNumber[][] = [];
  for (let i = 0; i < slidesWithNumbers.length; i += effectiveChunkSize) {
    chunks.push(slidesWithNumbers.slice(i, i + effectiveChunkSize));
  }
  return chunks;
}

export const EXTRACTION_SYSTEM_PROMPT = `You are an expert mathematical, financial, and scientific document analyst.
Your task is to extract all formulas and key conceptual claims from the provided lecture slide chunk with 100% precision and strict source grounding.

CRITICAL EXTRACTION RULES:
1. STRICT SOURCE GROUNDING:
   - Extract ONLY formulas and claims explicitly present in the provided slides.
   - Do NOT introduce outside textbook knowledge, unmentioned formulas, or assumed variations.
   - Every formula and claim MUST include a verbatim quote in 'evidence' taken directly from the source slide.
   - Every item's 'slide' MUST match the exact 1-based slide number where it appears.

2. FORMULA SPECIFICATIONS:
   - 'latex': Clean LaTeX representation WITHOUT surrounding dollar signs ($ or $$).
   - 'raw': Verbatim formula string or line as it appears on the slide. Never include literal unescaped tab characters or raw control characters.
   - 'label': Short name or title of the formula if mentioned on the slide (e.g. "Gordon Growth Model", "Net Working Capital"), or "" if unnamed.
   - 'variables': Array of variables defined on the slide ({ symbol, definition }), or [] if none explicitly defined.
   - 'isExerciseOnly': Set to true IF AND ONLY IF the formula appears exclusively inside an exercise, practice problem, numerical example, or worked solution on the slide. Otherwise false.
   - Incomplete or dangling '=' fragments are STRICTLY FORBIDDEN (e.g., 'T =', 'S ==', '= 0.12', '(Average of Independent, Identical Risks) ='). NEVER extract equations missing a left-hand or right-hand side.
   - DO NOT extract trivial numeric calculation steps or plug-in lines (e.g., "= 2.50 / (0.10 - 0.05) = $50", "0.26 = 0.04 + 1.1 \\times (0.24 - 0.04)", "R = (0.21 - 0.05 + 0.14) / 3 = 0.10", "\\sqrt{(0.12 - 0.08)^2 + (0.05 - 0.08)^2} = 0.05", "Var = (0.2056)^2 = 0.04227", "P = 50", "r = 10%", "n = 5"). Only extract general, symbolic, or definitional equations.
   - DO NOT extract pure prose definitions, slide callout text, or descriptive natural-language clauses with '=' lacking symbolic mathematical operators or variables.

3. CLAIMS SPECIFICATIONS:
   - Extract key rules, takeaways, core assumptions, model boundaries, and definitions as claims.
   - 'topic': Concise concept or model name.
   - 'claim': Factual assertion or rule directly stated on the slide.
   - 'evidence': Verbatim supporting quote from the slide.

4. JSON COMPLIANCE:
   - Always return strictly valid RFC 8259 JSON. Never place raw unescaped tabs or control characters inside JSON strings.`;

/**
 * Builds the user prompt for extracting formulas and claims from an 8-slide chunk.
 */
export function buildChunkExtractionPrompt(chunk: SlideWithNumber[]): string {
  const slideNumbers = chunk.map((c) => c.slide).join(", ");
  const slideBlocks = chunk
    .map(({ slide, source }) => {
      const label = source.label ? ` [${source.label}]` : "";
      const text = normalizePdfMathSymbols(source.text || "")
        .replace(/[\t\v\f\r]+/g, " ")
        .replace(/[\x00-\x08\x0E-\x1F]/g, "")
        .trim();
      return `=== SLIDE ${slide}${label} ===\n${text || "(No text content)"}`;
    })
    .join("\n\n");

  return `Extract all formulas and conceptual claims from the following slide chunk.

CHUNK SLIDES: ${slideNumbers}

GROUNDING & EXTRACTION CONSTRAINTS:
1. ONLY extract formulas and claims appearing on the slides above. Do NOT use outside textbook knowledge.
2. The 'slide' field MUST be one of the chunk slide numbers: [${slideNumbers}].
3. For every formula and claim, provide the verbatim text segment in 'evidence'.
4. 'latex' must be clean LaTeX math without outer dollar signs ($).
5. DO NOT extract incomplete/dangling '=' fragments (e.g. 'T =', 'S ==', '= 0.15'), pure prose definitions, or worked-example numeric plug-in calculations (e.g. '= 2.50 / (0.10 - 0.05) = 50', '0.26 = 0.04 + 1.1 \\times (0.24 - 0.04)', 'R = (0.21 - 0.05 + 0.14) / 3 = 0.10', 'Var = (0.2056)^2 = 0.04227', 'P = 50', 'r = 10%'). Only extract general, symbolic, or definitional equations.
6. Set 'isExerciseOnly: true' if and only if the formula appears solely inside an exercise, numerical example, or practice problem on the slide.
7. Extract explicit variable definitions into 'variables' if defined on the slide, or [] if none.
8. Extract formula name/label into 'label' if named on the slide, or "" if unnamed.

SLIDES CONTENT:
${slideBlocks}`;
}

/**
 * Verifies whether an extracted formula is grounded in the source slide text.
 */
export function isFormulaGroundedOnSlide(
  item: ExtractedFormulaItem,
  slideText: string,
): boolean {
  if (!slideText || !slideText.trim()) return false;

  const convertedSlide = convertUnicodeMath(normalizePdfMathSymbols(slideText));
  const normSlide = convertedSlide.toLowerCase().replace(/\s+/g, " ");

  // 1. Evidence quote check (case-insensitive substring)
  if (item.evidence && item.evidence.trim()) {
    const normEv = normalizePdfMathSymbols(item.evidence)
      .toLowerCase()
      .replace(/^["'“‘]+|["'”’.,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normEv && normSlide.includes(normEv)) return true;
  }

  // 2. Raw formula string check (case-insensitive substring)
  if (item.raw && item.raw.trim()) {
    const normRaw = convertUnicodeMath(normalizePdfMathSymbols(item.raw))
      .toLowerCase()
      .replace(/^["'“‘]+|["'”’.,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normRaw && normSlide.includes(normRaw)) return true;
  }

  // 3. Clean LaTeX check (case-insensitive substring)
  if (item.latex && item.latex.trim()) {
    const cleanLatex = normalizePdfMathSymbols(item.latex || "")
      .replace(/^\s*\$+|\$+\s*$/g, "")
      .trim();
    const normLatex = convertUnicodeMath(cleanLatex)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (normLatex && normSlide.includes(normLatex)) return true;
  }

  // 4. Key variable tokens check
  if (item.variables && item.variables.length > 0) {
    const matchingVars = item.variables.filter((v) => {
      const sym = (v.symbol || "").trim();
      if (!sym) return false;

      const alphaOnly = sym.replace(/[^a-zA-Z0-9]/g, "");
      // Known multi-character financial acronyms / words (>= 3 alpha chars, e.g. ROE, WACC, EPS)
      if (alphaOnly.length >= 3) {
        return normSlide.includes(alphaOnly.toLowerCase());
      }

      // Exact case-sensitive token match on slide (e.g. P_0, D_1)
      const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const exactRegex = new RegExp(
        `(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`,
      );
      return exactRegex.test(convertedSlide);
    });

    const hasLongKeyVar = matchingVars.some(
      (v) => (v.symbol || "").replace(/[^a-zA-Z0-9]/g, "").length >= 3,
    );
    if (hasLongKeyVar || matchingVars.length >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts formulas and claims from slide sources in chunked batches (default 8 slides/chunk).
 * Chunks are executed concurrently (up to 4 in parallel) to dramatically reduce latency on large decks.
 */
export async function extractChunkedSlideInventory(options: {
  sources: SourceBlock[];
  model: LanguageModel;
  chunkSize?: number;
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<{
  formulas: ExtractedFormulaItem[];
  claims: ExtractedSlideClaim[];
  chunkCount: number;
}> {
  const chunks = chunkSlideSources(
    options.sources,
    options.chunkSize ?? DEFAULT_EXTRACTION_CHUNK_SIZE,
  );

  if (chunks.length === 0) {
    return {
      formulas: [],
      claims: [],
      chunkCount: 0,
    };
  }

  const concurrency = Math.max(1, options.concurrency ?? 4);
  const chunkResults: Array<{
    formulas: ExtractedFormulaItem[];
    claims: ExtractedSlideClaim[];
  }> = new Array(chunks.length);

  let nextIdx = 0;
  const workerCount = Math.min(concurrency, chunks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIdx < chunks.length) {
      const idx = nextIdx++;
      const chunk = chunks[idx];
      const chunkSlideSet = new Set(chunk.map((item) => item.slide));

      const response = await generateObject({
        model: options.model,
        schema: extractionSchema,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: buildChunkExtractionPrompt(chunk),
        temperature: 0,
        abortSignal: options.signal,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
          openrouter: {
            reasoning: {
              effort: getSafeOpenRouterReasoningEffort(options.model),
            },
          },
        },
      });

      const result = response.object as ExtractionResult;
      const formulas: ExtractedFormulaItem[] = [];
      const claims: ExtractedSlideClaim[] = [];

      if (result.formulas && Array.isArray(result.formulas)) {
        for (const item of result.formulas) {
          if (!chunkSlideSet.has(item.slide)) continue;

          const normLatex = normalizePdfMathSymbols(item.latex || "");
          const cleanLatex = normLatex
            .replace(/^\s*\$+|\$+\s*$/g, "")
            .trim();
          if (!cleanLatex) continue;

          if (
            !isNontrivialFormula(cleanLatex) ||
            isNumericPluginOrScalarAssignment(cleanLatex)
          ) {
            continue;
          }

          formulas.push({
            ...item,
            latex: cleanLatex,
            raw: normalizePdfMathSymbols(item.raw || cleanLatex),
            label: item.label ?? "",
            variables: item.variables ?? [],
            evidence: item.evidence ? normalizePdfMathSymbols(item.evidence) : "",
            isExerciseOnly: Boolean(item.isExerciseOnly),
          });
        }
      }

      if (result.claims && Array.isArray(result.claims)) {
        for (const claim of result.claims) {
          if (!chunkSlideSet.has(claim.slide)) continue;
          claims.push(claim);
        }
      }

      chunkResults[idx] = { formulas, claims };
    }
  });

  await Promise.all(workers);

  const allFormulas: ExtractedFormulaItem[] = [];
  const allClaims: ExtractedSlideClaim[] = [];

  for (const cr of chunkResults) {
    if (cr) {
      allFormulas.push(...cr.formulas);
      allClaims.push(...cr.claims);
    }
  }

  allFormulas.sort((a, b) => a.slide - b.slide);
  allClaims.sort((a, b) => a.slide - b.slide);

  return {
    formulas: allFormulas,
    claims: allClaims,
    chunkCount: chunks.length,
  };
}

export interface MergeFormulaLedgerInput {
  deterministicInventory: FormulaInventoryItem[];
  extractedFormulas?: ExtractedFormulaItem[];
  sources?: SourceBlock[];
}

/**
 * Merges deterministic inventory with LLM extractions into a deduplicated FormulaLedgerEntry array.
 */
export function mergeFormulaLedger(
  input: MergeFormulaLedgerInput,
): FormulaLedgerEntry[] {
  const deterministicInventory = input.deterministicInventory ?? [];
  const extractedFormulas = input.extractedFormulas ?? [];

  const slideSourcesMap = new Map<number, SourceBlock>();
  if (input.sources) {
    input.sources.forEach((src, idx) => {
      const slideNum = parseSlideNumber(src, idx);
      slideSourcesMap.set(slideNum, src);
    });
  }

  // Working entries initialized with deterministic inventory (filtered for validity and normalized)
  const workingEntries: Array<{
    slide: number;
    raw: string;
    latex: string;
    origin: FormulaOrigin;
    confidence?: number;
    label?: string;
    variables: Array<{ symbol: string; definition: string }>;
    evidence?: string;
    isExerciseOnly?: boolean;
  }> = [];

  for (const item of deterministicInventory) {
    const normLatex = convertUnicodeMath(
      normalizePdfMathSymbols(item.latex || ""),
    );
    const cleanLatex = normLatex.replace(/^\s*\$+|\$+\s*$/g, "").trim();
    if (
      !cleanLatex ||
      !isNontrivialFormula(cleanLatex) ||
      isNumericPluginOrScalarAssignment(cleanLatex)
    ) {
      continue;
    }
    workingEntries.push({
      slide: item.slide,
      raw: normalizePdfMathSymbols(item.raw || cleanLatex).trim(),
      latex: cleanLatex,
      origin: item.origin,
      confidence: item.confidence,
      variables: [],
    });
  }

  // Match or add LLM extracted formulas
  for (const item of extractedFormulas) {
    const normLatex = convertUnicodeMath(
      normalizePdfMathSymbols(item.latex || ""),
    );
    const normRaw = normalizePdfMathSymbols(item.raw || "");
    const cleanLatex = normLatex
      .replace(/^\s*\$+|\$+\s*$/g, "")
      .trim();
    if (
      !cleanLatex ||
      !isNontrivialFormula(cleanLatex) ||
      isNumericPluginOrScalarAssignment(cleanLatex)
    ) {
      continue;
    }

    const extLatexKey = normalizeInventoryFormulaKey(cleanLatex);
    const extRawKey = normalizeInventoryFormulaKey(normRaw);

    // Look for existing deterministic entry matching by normalized latex or raw
    const existing = workingEntries.find((entry) => {
      const entryLatexKey = normalizeInventoryFormulaKey(entry.latex);
      const entryRawKey = normalizeInventoryFormulaKey(entry.raw);
      return (
        (extLatexKey &&
          (entryLatexKey === extLatexKey || entryRawKey === extLatexKey)) ||
        (extRawKey &&
          (entryLatexKey === extRawKey || entryRawKey === extRawKey))
      );
    });

    if (existing) {
      // Enrich existing deterministic entry without altering origin, latex, raw, or confidence
      if (item.label && item.label.trim() && !existing.label) {
        existing.label = item.label.trim();
      }
      if (item.evidence && item.evidence.trim() && !existing.evidence) {
        existing.evidence = normalizePdfMathSymbols(item.evidence.trim());
      }
      if (
        existing.isExerciseOnly === undefined &&
        item.isExerciseOnly !== undefined
      ) {
        existing.isExerciseOnly = item.isExerciseOnly;
      }
      if (item.variables && item.variables.length > 0) {
        if (!existing.variables || existing.variables.length === 0) {
          existing.variables = item.variables.map((v) => ({
            symbol: v.symbol,
            definition: v.definition,
          }));
        } else {
          for (const v of item.variables) {
            if (!existing.variables.some((ev) => ev.symbol === v.symbol)) {
              existing.variables.push({
                symbol: v.symbol,
                definition: v.definition,
              });
            }
          }
        }
      }
    } else {
      // Novel LLM formula
      // If input.sources is provided and has a matching slide, verify source grounding
      if (input.sources && slideSourcesMap.has(item.slide)) {
        const slideSource = slideSourcesMap.get(item.slide);
        const slideText = slideSource?.text || "";
        if (!isFormulaGroundedOnSlide(item, slideText)) {
          // Reject ungrounded LLM formula
          continue;
        }
      }

      workingEntries.push({
        slide: item.slide,
        raw: normRaw || cleanLatex,
        latex: cleanLatex,
        origin: "llm",
        label: item.label && item.label.trim() ? item.label.trim() : undefined,
        variables: (item.variables ?? []).map((v) => ({
          symbol: v.symbol,
          definition: v.definition,
        })),
        evidence:
          item.evidence && item.evidence.trim()
            ? normalizePdfMathSymbols(item.evidence.trim())
            : undefined,
        isExerciseOnly: item.isExerciseOnly,
      });
    }
  }

  // Sort by slide ascending (stable)
  workingEntries.sort((a, b) => a.slide - b.slide);

  // Deduplicate across the entire ledger by normalizeInventoryFormulaKey(entry.latex)
  const ORIGIN_PRIORITY: Record<FormulaOrigin, number> = {
    omml: 4,
    ocr: 3,
    text: 2,
    llm: 1,
  };

  const deduplicatedEntries: typeof workingEntries = [];
  const seenLedgerKeys = new Map<string, (typeof workingEntries)[0]>();

  for (const entry of workingEntries) {
    const key = normalizeInventoryFormulaKey(entry.latex);
    if (!key) continue;

    const existing = seenLedgerKeys.get(key);
    if (!existing) {
      seenLedgerKeys.set(key, entry);
      deduplicatedEntries.push(entry);
    } else {
      // Deterministic items take strict priority for origin, latex, raw, confidence
      if (ORIGIN_PRIORITY[entry.origin] > ORIGIN_PRIORITY[existing.origin]) {
        existing.origin = entry.origin;
        existing.latex = entry.latex;
        existing.raw = entry.raw;
        existing.confidence = entry.confidence;
        existing.slide = entry.slide;
      }

      if (entry.label && !existing.label) {
        existing.label = entry.label;
      }
      if (entry.evidence && !existing.evidence) {
        existing.evidence = entry.evidence;
      }
      if (
        existing.isExerciseOnly === undefined &&
        entry.isExerciseOnly !== undefined
      ) {
        existing.isExerciseOnly = entry.isExerciseOnly;
      } else if (
        existing.isExerciseOnly === true &&
        entry.isExerciseOnly === false
      ) {
        existing.isExerciseOnly = false;
      }

      if (entry.variables && entry.variables.length > 0) {
        if (!existing.variables || existing.variables.length === 0) {
          existing.variables = [...entry.variables];
        } else {
          for (const v of entry.variables) {
            if (!existing.variables.some((ev) => ev.symbol === v.symbol)) {
              existing.variables.push(v);
            }
          }
        }
      }
    }
  }

  // Final sort by slide ascending (stable)
  deduplicatedEntries.sort((a, b) => a.slide - b.slide);

  // Assign sequential deterministic IDs: "F1", "F2", "F3", ...
  return deduplicatedEntries.map((entry, idx) => ({
    id: `F${idx + 1}`,
    slide: entry.slide,
    raw: entry.raw,
    latex: entry.latex,
    origin: entry.origin,
    confidence: entry.confidence,
    label: entry.label || undefined,
    variables: entry.variables ?? [],
    evidence: entry.evidence || undefined,
    isExerciseOnly: entry.isExerciseOnly,
  }));
}

export interface BuildMergedFormulaLedgerInput
  extends BuildFormulaInventoryInput {
  model?: LanguageModel;
  chunkSize?: number;
  signal?: AbortSignal;
}

/**
 * Orchestrates deterministic formula inventory extraction, optional chunked LLM extraction,
 * and ledger merging into a unified FormulaLedgerEntry array.
 */
export async function buildMergedFormulaLedger(
  input: BuildMergedFormulaLedgerInput,
): Promise<{
  ledger: FormulaLedgerEntry[];
  claims: ExtractedSlideClaim[];
  chunkCount: number;
}> {
  const deterministicInventory = buildFormulaInventory(input);

  if (input.model) {
    const extracted = await extractChunkedSlideInventory({
      sources: input.sources ?? [],
      model: input.model,
      chunkSize: input.chunkSize,
      signal: input.signal,
    });

    const ledger = mergeFormulaLedger({
      deterministicInventory,
      extractedFormulas: extracted.formulas,
      sources: input.sources,
    });

    return {
      ledger,
      claims: extracted.claims,
      chunkCount: extracted.chunkCount,
    };
  }

  const ledger = mergeFormulaLedger({
    deterministicInventory,
    extractedFormulas: [],
    sources: input.sources,
  });

  return {
    ledger,
    claims: [],
    chunkCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Clutch Note AI v2: Formula Candidate Adjudication & Scoped Symbol Bindings
// ---------------------------------------------------------------------------

/**
 * Normalizes symbol keys for robust symbol matching across LaTeX formulations.
 */
function normalizeSymbolKey(sym: string): string {
  if (!sym) return "";
  return sym
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .replace(/\\(?:mathrm|mathbf|boldsymbol|text)\{([^{}]*)\}/g, "$1")
    .replace(/_\{([^{}]+)\}/g, "_$1")
    .replace(/\^\{([^{}]+)\}/g, "^$1");
}

/**
 * Evaluates whether two variable definitions share the same semantic meaning.
 */
export function areMeaningsEquivalent(
  m1: string | null,
  m2: string | null,
): boolean {
  if (m1 === null && m2 === null) return true;
  if (m1 === null || m2 === null) return false;
  const n1 = m1
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ");
  const n2 = m2
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ");
  if (n1 === n2) return true;

  const w1 = new Set(n1.split(" ").filter((w) => w.length > 2));
  const w2 = new Set(n2.split(" ").filter((w) => w.length > 2));
  if (w1.size === 0 || w2.size === 0) return false;

  let intersection = 0;
  for (const w of w1) {
    if (w2.has(w)) intersection++;
  }
  const minLen = Math.min(w1.size, w2.size);
  return minLen > 0 && intersection / minLen >= 0.75;
}

/**
 * Extracts symbolic variable tokens from LaTeX strings and explicit variable lists.
 */
export function extractSymbolsFromLatex(
  latex: string,
  definedVars?: Array<{ symbol: string; definition?: string }>,
): string[] {
  const symbols = new Set<string>();

  // 1. Add any explicitly defined variables from input
  if (definedVars && definedVars.length > 0) {
    for (const v of definedVars) {
      const s = (v.symbol || "").trim().replace(/^\$+|\$+$/g, "");
      if (s) symbols.add(s);
    }
  }

  // 2. Tokenize the LaTeX string
  let s = (latex || "").replace(/^\$+|\$+$/g, "").trim();

  // Strip text blocks: \text{...}
  s = s.replace(/\\text\{[^{}]*\}/g, " ");

  // Strip common structural LaTeX command names
  const LATEX_STRUCTURAL_COMMANDS =
    /\\(?:frac|dfrac|tfrac|sum|prod|int|sqrt|partial|left|right|times|div|cdot|pm|mp|approx|equiv|le|ge|leq|geq|ne|neq|in|notin|implies|rightarrow|leftarrow|iff|to|quad|qquad|enspace|space|begin|end|matrix|pmatrix|bmatrix)\b/g;
  s = s.replace(LATEX_STRUCTURAL_COMMANDS, " ");

  // Match subscripted/superscripted variables e.g. P_0, D_1, r_f, \beta_i, CF_t, R_M
  // or Greek letters: \alpha, \beta, \sigma, etc.
  // or standalone Latin variables / acronyms: R, g, NPV, IRR
  const TOKEN_REGEX =
    /\\?[a-zA-Z]+(?:_\{?[a-zA-Z0-9+\-]+\}?|\^\{?[a-zA-Z0-9+\-]+\}?)*(?:_\{?[a-zA-Z0-9+\-]+\}?|\^\{?[a-zA-Z0-9+\-]+\}?)*/g;

  let match: RegExpExecArray | null;
  while ((match = TOKEN_REGEX.exec(s)) !== null) {
    let token = match[0].trim();
    if (!token) continue;

    // Filter out common math functions
    if (
      /^(?:sin|cos|tan|cot|sec|csc|ln|log|exp|min|max|lim|det|dim)$/i.test(token)
    ) {
      continue;
    }

    // Filter out pure numbers
    if (/^\d+$/.test(token)) continue;

    // Normalize single-character braces in subscripts: P_{0} -> P_0
    token = token
      .replace(/_\{([^{}]+)\}/g, "_$1")
      .replace(/\^\{([^{}]+)\}/g, "^$1");

    symbols.add(token);
  }

  return Array.from(symbols);
}

/**
 * Determines whether two LaTeX formulas represent variants of the same mathematical equation
 * (e.g. structured \frac vs flattened ASCII division slash, or missing LHS on a text scrape).
 */
export function areFormulasEquivalentVariants(
  tex1: string,
  tex2: string,
): boolean {
  if (!tex1 || !tex2) return false;
  if (tex1 === tex2) return true;

  const k1 = normalizeInventoryFormulaKey(tex1);
  const k2 = normalizeInventoryFormulaKey(tex2);
  if (k1 && k2 && k1 === k2) return true;

  const toSlash = (t: string) => {
    let s = t.replace(
      /\\(?:frac|dfrac|tfrac)\{([^{}]+)\}\{([^{}]+)\}/g,
      "($1)/($2)",
    );
    s = s.replace(
      /\\(?:frac|dfrac|tfrac)\{([^{}]+)\}\{([^{}]+)\}/g,
      "($1)/($2)",
    );
    return s;
  };

  const simplify = (t: string) => {
    let s = toSlash(t);
    s = s.replace(
      /\\(?:text|mathrm|mathbf|boldsymbol|textbf|mathit|operatorname)\{([^{}]*)\}/g,
      "$1",
    );
    s = s.replace(/\\(?:left|right)[.()[\]|]/g, "");
    s = s.replace(/[_^{}()\[\]\s$]/g, "").toLowerCase();
    return s;
  };

  const s1 = simplify(tex1);
  const s2 = simplify(tex2);
  if (s1 === s2) return true;

  // Check if one has LHS and the other only captured RHS
  if (s1.includes("=") && !s2.includes("=")) {
    const rhs1 = s1.split("=")[1];
    if (rhs1 && rhs1 === s2) return true;
  }
  if (s2.includes("=") && !s1.includes("=")) {
    const rhs2 = s2.split("=")[1];
    if (rhs2 && rhs2 === s1) return true;
  }

  return false;
}

/**
 * Scores the structural quality and representation fidelity of a formula candidate
 * to prefer clean structured LaTeX (\frac, subscripts) over flattened text scrapes.
 */
export function getFormulaQualityScore(cand: FormulaCandidate): number {
  let score = 0;
  const tex = cand.proposedLatex || "";

  // Origin preference: omml (40) > llm (30) > ocr (20) > text (10)
  if (cand.origin === "omml") score += 40;
  else if (cand.origin === "llm") score += 30;
  else if (cand.origin === "ocr") score += 20;
  else if (cand.origin === "text") score += 10;

  if (typeof cand.confidence === "number") {
    score += Math.round(cand.confidence * 20);
  }

  // Structural LaTeX commands
  if (/\\frac\b/.test(tex)) score += 25;
  if (/\\sum\b/.test(tex)) score += 25;
  if (/\\sqrt\b/.test(tex)) score += 25;
  if (/\\prod\b/.test(tex)) score += 25;
  if (/\\int\b/.test(tex)) score += 25;

  // Subscripts and superscripts
  if (/_[a-zA-Z0-9{]/.test(tex)) score += 15;
  if (/\^[a-zA-Z0-9{]/.test(tex)) score += 15;

  // Equality or relation
  if (tex.includes("=")) score += 20;

  // Proper \text{...} formatting
  if (/\\text\{[^{}]+\}/.test(tex)) score += 10;

  // Penalties
  // Flattened division slash
  if (
    /\b[a-zA-Z0-9_]+\s*\/\s*[a-zA-Z0-9_]+/.test(tex) &&
    !/\\frac/.test(tex)
  ) {
    score -= 15;
  }
  // Flattened subscript like D1 or P0 instead of D_1 or P_0
  if (/\b[A-Za-z]\d\b/.test(tex) && !/_[0-9]/.test(tex)) {
    score -= 15;
  }
  // Missing LHS
  if (
    !tex.includes("=") &&
    !tex.includes("\\implies") &&
    !tex.includes("<") &&
    !tex.includes(">")
  ) {
    score -= 20;
  }

  return score;
}

/**
 * Classifies a detected formula candidate into one of FormulaCandidateKind
 * and determines its lifecycle state (ACCEPTED, NEEDS_ADJUDICATION, or EXCLUDED_WITH_REASON).
 */
export function classifyFormulaCandidate(
  raw: string,
  proposedLatex: string,
  options?: {
    isExerciseOnly?: boolean;
    origin?: FormulaOrigin;
    confidence?: number;
  },
): {
  kind: FormulaCandidateKind;
  state: FormulaLifecycleState;
  exclusionReason?: string;
  warnings: string[];
} {
  const cleanProposed = (proposedLatex || "").trim();
  const cleanRaw = (raw || "").trim();
  const warnings: string[] = [];

  if (options?.isExerciseOnly) {
    warnings.push(
      "Formula appeared within an exercise or worked example context",
    );
  }

  // 1. Incomplete fragment check: dangling relation operator or empty side
  if (!cleanProposed && !cleanRaw) {
    return {
      kind: "incomplete_fragment",
      state: "EXCLUDED_WITH_REASON",
      exclusionReason: "Incomplete or dangling equation fragment",
      warnings,
    };
  }

  if (
    isDanglingOrEmptySideEquation(cleanProposed) ||
    isDanglingOrEmptySideEquation(cleanRaw)
  ) {
    return {
      kind: "incomplete_fragment",
      state: "EXCLUDED_WITH_REASON",
      exclusionReason: "Incomplete or dangling equation fragment",
      warnings,
    };
  }

  // Check for dangling inequality operators at start/end
  if (
    /^[<>]|[<>]$|\\(?:le|ge|leq|geq|ne|neq|in|notin)\s*$/.test(cleanProposed) ||
    /^\s*\\(?:le|ge|leq|geq|ne|neq|in|notin)/.test(cleanProposed)
  ) {
    return {
      kind: "incomplete_fragment",
      state: "EXCLUDED_WITH_REASON",
      exclusionReason: "Incomplete or dangling equation fragment",
      warnings,
    };
  }

  // 2. KaTeX validity check on proposed LaTeX
  const katexRender = renderKatexSafe(cleanProposed, true);
  const isBrokenKatex =
    katexRender.includes("katex-error") ||
    katexRender.includes("katex-fallback");

  if (isBrokenKatex) {
    // Attempt repair
    const repaired = cleanLatexEquation(cleanProposed);
    const repairedKatex = renderKatexSafe(repaired, true);
    const stillBroken =
      !repaired ||
      repairedKatex.includes("katex-error") ||
      repairedKatex.includes("katex-fallback");

    if (stillBroken) {
      return {
        kind: "incomplete_fragment",
        state: "EXCLUDED_WITH_REASON",
        exclusionReason: "Invalid KaTeX math syntax: failed rendering",
        warnings: [...warnings, "Unrepairable KaTeX syntax error"],
      };
    }
  }

  // 3. Decision rule check: arrow / implication / if-when decision logic with symbolic variables
  const hasDecisionArrow =
    /\\(?:implies|rightarrow|impliedby|iff|to)\b|[⇒→⇐⇔]|(?<![<>])=>|(?<!<)->/.test(
      cleanProposed,
    );
  const hasDecisionWords =
    /\\text\{\s*(?:if|when|then|accept|reject|invest|hold|buy|sell)\b/i.test(
      cleanProposed,
    ) || /\b(?:if|when|then|accept|reject|invest)\b/i.test(cleanProposed);

  if (
    (hasDecisionArrow || hasDecisionWords) &&
    hasSymbolicVariables(cleanProposed)
  ) {
    let state: FormulaLifecycleState = "ACCEPTED";
    if (
      options?.origin === "ocr" &&
      typeof options.confidence === "number" &&
      options.confidence < 0.70
    ) {
      state = "NEEDS_ADJUDICATION";
      warnings.push("Low-confidence OCR transcription requires adjudication");
    } else if (isBrokenKatex) {
      state = "NEEDS_ADJUDICATION";
      warnings.push("KaTeX syntax error required automatic repair");
    }
    return {
      kind: "decision_rule",
      state,
      warnings,
    };
  }

  // 4. Boundary condition check: inequalities and domain restrictions (<, >, \le, \ge, \neq, \in, etc.)
  const hasBoundaryOperator =
    /(?<!\\(?:le|ge|ne|leq|geq|neq))[<>](?![=<>])|\\(?:le|ge|leq|geq|ne|neq|in|notin)\b|[≤≥≠∈∉]/.test(
      cleanProposed,
    );

  if (hasBoundaryOperator && hasSymbolicVariables(cleanProposed)) {
    let state: FormulaLifecycleState = "ACCEPTED";
    if (
      options?.origin === "ocr" &&
      typeof options.confidence === "number" &&
      options.confidence < 0.70
    ) {
      state = "NEEDS_ADJUDICATION";
      warnings.push("Low-confidence OCR transcription requires adjudication");
    } else if (isBrokenKatex) {
      state = "NEEDS_ADJUDICATION";
      warnings.push("KaTeX syntax error required automatic repair");
    }
    return {
      kind: "boundary_condition",
      state,
      warnings,
    };
  }

  // 5. Identity check: accounting and financial identities with \text{...} multi-word terms
  const hasMultiWordText =
    /\\text\{[^{}]*\s+[^{}]*\}/i.test(cleanProposed) ||
    isRecognizedAccountingTerm(cleanProposed);

  if (
    cleanProposed.includes("=") &&
    hasMultiWordText &&
    !isNumericPluginOrScalarAssignment(cleanProposed)
  ) {
    let state: FormulaLifecycleState = "ACCEPTED";
    if (
      options?.origin === "ocr" &&
      typeof options.confidence === "number" &&
      options.confidence < 0.70
    ) {
      state = "NEEDS_ADJUDICATION";
      warnings.push("Low-confidence OCR transcription requires adjudication");
    } else if (isBrokenKatex) {
      state = "NEEDS_ADJUDICATION";
      warnings.push("KaTeX syntax error required automatic repair");
    }
    return {
      kind: "identity",
      state,
      warnings,
    };
  }

  // 6. Numeric instantiation or intermediate arithmetic exclusion
  const isNumeric = isNumericPluginOrScalarAssignment(cleanProposed);
  const isProse = isPureProsePhrase(cleanProposed);
  const isNontrivial = isNontrivialFormula(cleanProposed);

  if (isNumeric || isProse || !isNontrivial) {
    const isArith = !cleanProposed.includes("=");
    return {
      kind: isArith ? "intermediate_arithmetic" : "numeric_instantiation",
      state: "EXCLUDED_WITH_REASON",
      exclusionReason:
        "Numeric substitution drill or non-symbolic prose fragment",
      warnings,
    };
  }

  // 7. General formula: standard symbolic equation
  let state: FormulaLifecycleState = "ACCEPTED";
  if (
    options?.origin === "ocr" &&
    typeof options.confidence === "number" &&
    options.confidence < 0.70
  ) {
    state = "NEEDS_ADJUDICATION";
    warnings.push("Low-confidence OCR transcription requires adjudication");
  } else if (isBrokenKatex) {
    state = "NEEDS_ADJUDICATION";
    warnings.push("KaTeX syntax error required automatic repair");
  }

  return {
    kind: "general_formula",
    state,
    warnings,
  };
}

export interface AdjudicateFormulaCandidatesInput {
  ledger?: FormulaLedgerEntry[];
  deterministicInventory?: FormulaInventoryItem[];
  extractedFormulas?: ExtractedFormulaItem[];
  sources?: SourceBlock[];
  scopeResolver?: (slide: number) => string;
}

/**
 * Adjudicates raw inventory / ledger / extracted formulas into FormulaCandidate[],
 * promotes only ACCEPTED candidates into AcceptedFormula[], merges variants favoring structured LaTeX,
 * extracts scoped deduplicated SymbolBindings, and isolates excluded candidates.
 */
export function adjudicateFormulaCandidates(
  input: AdjudicateFormulaCandidatesInput,
): {
  candidates: FormulaCandidate[];
  acceptedFormulas: AcceptedFormula[];
  symbolBindings: SymbolBinding[];
  excludedCandidates: FormulaCandidate[];
  needsAdjudication: FormulaCandidate[];
} {
  // 1. Gather raw candidate items from inputs
  type RawItem = {
    slide: number;
    raw: string;
    proposedLatex: string;
    origin: FormulaOrigin;
    confidence?: number;
    label?: string;
    variables?: Array<{ symbol: string; definition: string }>;
    evidence?: string;
    isExerciseOnly?: boolean;
  };

  const rawItems: RawItem[] = [];

  if (input.ledger && input.ledger.length > 0) {
    for (const entry of input.ledger) {
      rawItems.push({
        slide: Math.max(1, entry.slide || 1),
        raw: entry.raw || entry.latex,
        proposedLatex: entry.latex,
        origin: entry.origin,
        confidence: entry.confidence,
        label: entry.label,
        variables: entry.variables,
        evidence: entry.evidence,
        isExerciseOnly: entry.isExerciseOnly,
      });
    }
  } else {
    if (
      input.deterministicInventory &&
      input.deterministicInventory.length > 0
    ) {
      for (const item of input.deterministicInventory) {
        rawItems.push({
          slide: Math.max(1, item.slide || 1),
          raw: item.raw || item.latex,
          proposedLatex: item.latex,
          origin: item.origin,
          confidence: item.confidence,
        });
      }
    } else if (input.sources && input.sources.length > 0) {
      const inv = buildFormulaInventory(input.sources);
      for (const item of inv) {
        rawItems.push({
          slide: Math.max(1, item.slide || 1),
          raw: item.raw || item.latex,
          proposedLatex: item.latex,
          origin: item.origin,
          confidence: item.confidence,
        });
      }
    }

    if (input.extractedFormulas && input.extractedFormulas.length > 0) {
      for (const item of input.extractedFormulas) {
        rawItems.push({
          slide: Math.max(1, item.slide || 1),
          raw: item.raw || item.latex,
          proposedLatex: item.latex,
          origin: "llm",
          label: item.label || undefined,
          variables: item.variables,
          evidence: item.evidence,
          isExerciseOnly: item.isExerciseOnly,
        });
      }
    }
  }

  // Sort raw items by slide ascending
  rawItems.sort((a, b) => a.slide - b.slide);

  // 2. Classify each candidate into FormulaCandidate
  const candidates: FormulaCandidate[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const candidateId = `C_F${i + 1}`;
    const classification = classifyFormulaCandidate(
      item.raw,
      item.proposedLatex,
      {
        isExerciseOnly: item.isExerciseOnly,
        origin: item.origin,
        confidence: item.confidence,
      },
    );

    const candidate = formulaCandidateSchema.parse({
      id: candidateId,
      slide: item.slide,
      raw: item.raw,
      proposedLatex: item.proposedLatex,
      origin: item.origin,
      kind: classification.kind,
      state: classification.state,
      confidence: item.confidence,
      exclusionReason: classification.exclusionReason,
      warnings: classification.warnings,
      evidence: item.evidence,
    });

    candidates.push(candidate);
  }

  const excludedCandidates = candidates.filter(
    (c) => c.state === "EXCLUDED_WITH_REASON",
  );
  const needsAdjudication = candidates.filter(
    (c) => c.state === "NEEDS_ADJUDICATION",
  );
  const acceptedCandidates = candidates.filter((c) => c.state === "ACCEPTED");

  // 3. Cluster accepted candidates that are variants of the same formula
  type Cluster = {
    candidates: FormulaCandidate[];
    rawItems: RawItem[];
  };

  const clusters: Cluster[] = [];

  for (let i = 0; i < acceptedCandidates.length; i++) {
    const cand = acceptedCandidates[i];
    const rawItem =
      rawItems.find(
        (r) => r.raw === cand.raw && r.slide === cand.slide,
      ) || {
        slide: cand.slide,
        raw: cand.raw,
        proposedLatex: cand.proposedLatex,
        origin: cand.origin,
      };

    let matchedCluster: Cluster | null = null;
    for (const cluster of clusters) {
      const leader = cluster.candidates[0];
      if (
        Math.abs(leader.slide - cand.slide) <= 1 &&
        areFormulasEquivalentVariants(
          leader.proposedLatex,
          cand.proposedLatex,
        )
      ) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.candidates.push(cand);
      matchedCluster.rawItems.push(rawItem);
    } else {
      clusters.push({
        candidates: [cand],
        rawItems: [rawItem],
      });
    }
  }

  // 4. Form AcceptedFormula for each cluster
  const acceptedFormulas: AcceptedFormula[] = [];
  const symbolBindings: SymbolBinding[] = [];

  let formulaCounter = 1;

  for (const cluster of clusters) {
    // Pick the winner with highest quality score
    cluster.candidates.sort(
      (a, b) => getFormulaQualityScore(b) - getFormulaQualityScore(a),
    );
    const winner = cluster.candidates[0];
    const sourceVariantIds = cluster.candidates.map((c) => c.id);

    // Merge labels and evidence
    const label =
      cluster.rawItems.map((r) => r.label).find(Boolean) || undefined;

    const evidenceList = cluster.candidates
      .map((c) => c.evidence)
      .filter((e): e is string => Boolean(e && e.trim()));

    // Verify KaTeX rendering on displayLatex
    let displayLatex = winner.proposedLatex;
    const katexHtml = renderKatexSafe(displayLatex, true);
    if (
      katexHtml.includes("katex-error") ||
      katexHtml.includes("katex-fallback")
    ) {
      const cleaned = cleanLatexEquation(displayLatex);
      const cleanedHtml = renderKatexSafe(cleaned, true);
      if (
        !cleanedHtml.includes("katex-error") &&
        !cleanedHtml.includes("katex-fallback")
      ) {
        displayLatex = cleaned;
      } else {
        // Find if any variant has valid KaTeX
        const validVariant = cluster.candidates.find((c) => {
          const vHtml = renderKatexSafe(c.proposedLatex, true);
          return (
            !vHtml.includes("katex-error") &&
            !vHtml.includes("katex-fallback")
          );
        });
        if (validVariant) {
          displayLatex = validVariant.proposedLatex;
        } else {
          // Cannot admit broken KaTeX formula into acceptedFormulas
          for (const c of cluster.candidates) {
            c.state = "EXCLUDED_WITH_REASON";
            c.exclusionReason = "Invalid KaTeX math syntax: failed rendering";
            excludedCandidates.push(c);
          }
          continue;
        }
      }
    }

    // Map candidate kind to accepted formula kind
    let acceptedKind: AcceptedFormulaKind = "formula";
    if (winner.kind === "identity") acceptedKind = "identity";
    else if (winner.kind === "decision_rule") acceptedKind = "symbolic_rule";
    else if (winner.kind === "boundary_condition") acceptedKind = "boundary";

    // 5. Scoped Symbol Binding Extraction
    const scopeId = input.scopeResolver
      ? input.scopeResolver(winner.slide)
      : "global";

    const clusterVars: Array<{ symbol: string; definition: string }> = [];
    for (const r of cluster.rawItems) {
      if (r.variables && r.variables.length > 0) {
        for (const v of r.variables) {
          if (!clusterVars.some((cv) => cv.symbol === v.symbol)) {
            clusterVars.push(v);
          }
        }
      }
    }

    const symbolsInFormula = extractSymbolsFromLatex(
      displayLatex,
      clusterVars,
    );
    const formulaSymbolBindingIds: string[] = [];

    for (const sym of symbolsInFormula) {
      const cleanSym = sym.trim();
      if (!cleanSym) continue;

      // Check if defined in variables
      const matchedVar = clusterVars.find(
        (v) =>
          normalizeSymbolKey(v.symbol) === normalizeSymbolKey(cleanSym),
      );
      const meaning = matchedVar ? matchedVar.definition.trim() : null;

      // Scoping and reuse logic:
      const existingBindingsForGlyph = symbolBindings.filter(
        (b) =>
          normalizeSymbolKey(b.symbolLatex) ===
          normalizeSymbolKey(cleanSym),
      );

      let targetBinding: SymbolBinding | null = null;

      if (meaning !== null) {
        // Check if there is an existing binding with the same meaning anywhere in the deck
        const sameMeaningBinding = existingBindingsForGlyph.find(
          (b) => b.meaning !== null && areMeaningsEquivalent(b.meaning, meaning),
        );

        if (sameMeaningBinding) {
          targetBinding = sameMeaningBinding;
        } else {
          // Check if an earlier binding in the same scope had meaning: null
          const nullInSameScope = existingBindingsForGlyph.find(
            (b) => b.scopeId === scopeId && b.meaning === null,
          );
          if (nullInSameScope) {
            nullInSameScope.meaning = meaning;
            targetBinding = nullInSameScope;
          } else {
            // New meaning in new/current scope: create distinct scoped binding
            const newId = `SYM_${symbolBindings.length + 1}`;
            targetBinding = symbolBindingSchema.parse({
              id: newId,
              scopeId,
              symbolLatex: cleanSym,
              meaning,
              slide: winner.slide,
              evidenceIds: evidenceList,
            });
            symbolBindings.push(targetBinding);
          }
        }
      } else {
        // Meaning is null: check if binding exists in current scope or globally
        const existingInScope = existingBindingsForGlyph.find(
          (b) => b.scopeId === scopeId,
        );
        if (existingInScope) {
          targetBinding = existingInScope;
        } else if (existingBindingsForGlyph.length > 0) {
          // Reuse first binding if no conflict
          targetBinding = existingBindingsForGlyph[0];
        } else {
          // New symbol with meaning: null
          const newId = `SYM_${symbolBindings.length + 1}`;
          targetBinding = symbolBindingSchema.parse({
            id: newId,
            scopeId,
            symbolLatex: cleanSym,
            meaning: null,
            slide: winner.slide,
            evidenceIds: evidenceList,
          });
          symbolBindings.push(targetBinding);
        }
      }

      if (
        targetBinding &&
        !formulaSymbolBindingIds.includes(targetBinding.id)
      ) {
        formulaSymbolBindingIds.push(targetBinding.id);
      }
    }

    const formulaId = `F${formulaCounter++}`;
    const accepted = acceptedFormulaSchema.parse({
      id: formulaId,
      slide: winner.slide,
      kind: acceptedKind,
      displayLatex,
      raw: winner.raw,
      label,
      origin: winner.origin,
      evidenceIds: evidenceList,
      symbolBindingIds: formulaSymbolBindingIds,
      conditionAtomIds: [],
      sourceVariantIds,
      revision: 1,
    });

    acceptedFormulas.push(accepted);
  }

  // Sort acceptedFormulas by slide ascending, then ID
  acceptedFormulas.sort((a, b) => {
    if (a.slide !== b.slide) return a.slide - b.slide;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });

  return {
    candidates,
    acceptedFormulas,
    symbolBindings,
    excludedCandidates,
    needsAdjudication,
  };
}

/**
 * Returns all AcceptedFormulas belonging to the given slide numbers,
 * sorted by slide number and formula ID.
 */
export function getAcceptedFormulasForSlides(
  acceptedFormulas: AcceptedFormula[],
  slides: number[],
): AcceptedFormula[] {
  if (
    !acceptedFormulas ||
    acceptedFormulas.length === 0 ||
    !slides ||
    slides.length === 0
  ) {
    return [];
  }
  const slideSet = new Set(slides);
  return acceptedFormulas
    .filter((f) => slideSet.has(f.slide))
    .sort((a, b) => {
      if (a.slide !== b.slide) {
        return a.slide - b.slide;
      }
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
}
