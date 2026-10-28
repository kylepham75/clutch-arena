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
} from "@/lib/math/latex";
import {
  extractionSchema,
  type ExtractedFormulaItem,
  type ExtractedSlideClaim,
  type ExtractionResult,
  type FormulaLedgerEntry,
  type FormulaOrigin,
} from "@/lib/schemas/notes";

export type { FormulaOrigin };

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
  let s = text;

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
 * Formats and repairs raw mathematical / financial strings into clean LaTeX without surrounding $.
 */
export function cleanLatexEquation(rawEq: string): string {
  if (!rawEq) return "";
  let s = convertUnicodeMath(rawEq);
  s = repairCorruptedLatex(s);
  s = formatAccountingFormula(s);
  s = wrapBareEnglishInLatex(s);

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

  // 1. Starts with '=' (e.g. "= 2.50 / (0.10 - 0.05) = $50" or "= 100 / 0.10 = 1000")
  if (s.startsWith("=")) return true;

  const parts = s.split("=");
  if (parts.length < 2) return false;

  const lhs = parts[0].trim();
  const rhs = parts.slice(1).join("=").trim();

  // 2. LHS has no letters/variables at all (e.g. "100 / 0.10 = 1000")
  const lhsStripped = lhs.replace(
    /\\(?:text|mathrm|mathbf|boldsymbol|textbf|mathit)\b/g,
    "",
  );
  if (!/[a-zA-Z\u0370-\u03FF]/.test(lhsStripped)) {
    return true;
  }

  // 3. Trivial scalar assignment:
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

  // Contains relation operator: =, \approx, \le, \ge, \ne, \neq, \sim
  if (/=|\\approx|≈|\\le|\\ge|\\leq|\\geq|\\ne|\\neq|\\sim/.test(s)) {
    if (isNumericPluginOrScalarAssignment(s)) {
      return false;
    }
    return true;
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

  const results: Array<{ raw: string; latex: string }> = [];
  const seenKeys = new Set<string>();

  // 1. Explicit display math blocks: $$...$$
  const displayRegex = /\$\$([\s\S]+?)\$\$/g;
  let dMatch: RegExpExecArray | null;
  while ((dMatch = displayRegex.exec(text)) !== null) {
    const rawContent = dMatch[1].trim();
    const cleanLatex = rawContent.replace(/^\s*\$+|\$+\s*$/g, "").trim();
    if (isNontrivialFormula(cleanLatex)) {
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
  while ((iMatch = inlineRegex.exec(text)) !== null) {
    const candidate = iMatch[1].trim();
    if (isLikelyInlineMath(candidate)) {
      const cleanLatex = candidate.replace(/^\s*\$+|\$+\s*$/g, "").trim();
      if (isNontrivialFormula(cleanLatex)) {
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
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

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
      if (!clause) continue;

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
        if (
          /[a-zA-Z\u0370-\u03FF]/.test(p1) &&
          !/^[0-9.\s+\-*/()$]+$/.test(p1) &&
          /^[0-9.\s+\-*/()$]+$/.test(p2)
        ) {
          rawRhs = p1;
        } else {
          rawRhs = eqParts.slice(1).join("=").trim();
        }
      } else {
        rawRhs = eqParts[1].trim();
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

      const candidateRaw = `${rawLhs} = ${rawRhs}`;

      if (!isNontrivialFormula(candidateRaw)) {
        continue;
      }

      const cleanLatex = cleanLatexEquation(candidateRaw);
      if (!cleanLatex) continue;

      const normKey = normalizeInventoryFormulaKey(cleanLatex);
      if (!seenKeys.has(normKey)) {
        seenKeys.add(normKey);
        // Original raw before Unicode conversion if present in clause
        const originalLhs = clause.split("=")[0].trim().replace(PROSE_PREFIX_REGEX, "").trim();
        const originalRhs = clause.split("=").slice(1).join("=").trim().replace(TRAILING_PROSE_REGEX, "").replace(/[.,;:]+$/, "").trim();
        const displayRaw = originalLhs && originalRhs ? `${originalLhs} = ${originalRhs}` : candidateRaw;

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
      const cleanLatex = (omml.latex || "")
        .replace(/^\s*\$+|\$+\s*$/g, "")
        .trim();
      if (!cleanLatex || !isNontrivialFormula(cleanLatex)) continue;

      const normKey = normalizeInventoryFormulaKey(cleanLatex);
      if (slideSeenKeys.has(normKey)) continue;
      slideSeenKeys.add(normKey);

      inventory.push({
        slide,
        raw: (omml.raw || cleanLatex).trim(),
        latex: cleanLatex,
        origin: "omml",
      });
    }

    // 2. OCR equations for this slide
    const slideOcrs = ocrEquations.filter((eq) => eq.slide === slide);
    for (const ocr of slideOcrs) {
      const cleanLatex = (ocr.latex || "")
        .replace(/^\s*\$+|\$+\s*$/g, "")
        .trim();
      if (!cleanLatex) continue;

      const normKey = normalizeInventoryFormulaKey(cleanLatex);
      if (slideSeenKeys.has(normKey)) continue;
      slideSeenKeys.add(normKey);

      inventory.push({
        slide,
        raw: (ocr.raw || cleanLatex).trim(),
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
   - 'raw': Verbatim formula string or line as it appears on the slide.
   - 'label': Short name or title of the formula if mentioned on the slide (e.g. "Gordon Growth Model", "Net Working Capital"), or "" if unnamed.
   - 'variables': Array of variables defined on the slide ({ symbol, definition }), or [] if none explicitly defined.
   - 'isExerciseOnly': Set to true IF AND ONLY IF the formula appears exclusively inside an exercise, practice problem, numerical example, or worked solution on the slide. Otherwise false.
   - DO NOT extract trivial numeric calculation steps or plug-in lines (e.g., "= 2.50 / (0.10 - 0.05) = $50", "P = 50", "r = 10%", "n = 5"). Only extract general, symbolic, or definitional equations.

3. CLAIMS SPECIFICATIONS:
   - Extract key rules, takeaways, core assumptions, model boundaries, and definitions as claims.
   - 'topic': Concise concept or model name.
   - 'claim': Factual assertion or rule directly stated on the slide.
   - 'evidence': Verbatim supporting quote from the slide.`;

/**
 * Builds the user prompt for extracting formulas and claims from an 8-slide chunk.
 */
export function buildChunkExtractionPrompt(chunk: SlideWithNumber[]): string {
  const slideNumbers = chunk.map((c) => c.slide).join(", ");
  const slideBlocks = chunk
    .map(({ slide, source }) => {
      const label = source.label ? ` [${source.label}]` : "";
      const text = (source.text || "").trim();
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
5. DO NOT extract numeric calculation steps or plug-in lines (e.g. "= 2.50 / (0.10 - 0.05) = 50", "P = 50", "r = 10%", "n = 5"). Only extract general, symbolic, or definitional equations.
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

  const convertedSlide = convertUnicodeMath(slideText);
  const normSlide = convertedSlide.toLowerCase().replace(/\s+/g, " ");

  // 1. Evidence quote check (case-insensitive substring)
  if (item.evidence && item.evidence.trim()) {
    const normEv = item.evidence
      .toLowerCase()
      .replace(/^["'“‘]+|["'”’.,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normEv && normSlide.includes(normEv)) return true;
  }

  // 2. Raw formula string check (case-insensitive substring)
  if (item.raw && item.raw.trim()) {
    const normRaw = convertUnicodeMath(item.raw)
      .toLowerCase()
      .replace(/^["'“‘]+|["'”’.,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normRaw && normSlide.includes(normRaw)) return true;
  }

  // 3. Clean LaTeX check (case-insensitive substring)
  if (item.latex && item.latex.trim()) {
    const cleanLatex = (item.latex || "")
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
 */
export async function extractChunkedSlideInventory(options: {
  sources: SourceBlock[];
  model: LanguageModel;
  chunkSize?: number;
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

  const allFormulas: ExtractedFormulaItem[] = [];
  const allClaims: ExtractedSlideClaim[] = [];

  for (const chunk of chunks) {
    const chunkSlideSet = new Set(chunk.map((item) => item.slide));

    const response = await generateObject({
      model: options.model,
      schema: extractionSchema,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: buildChunkExtractionPrompt(chunk),
      temperature: 0,
      abortSignal: options.signal,
    });

    const result = response.object as ExtractionResult;

    if (result.formulas && Array.isArray(result.formulas)) {
      for (const item of result.formulas) {
        if (!chunkSlideSet.has(item.slide)) continue;

        const cleanLatex = (item.latex || "")
          .replace(/^\s*\$+|\$+\s*$/g, "")
          .trim();
        if (!cleanLatex) continue;

        if (
          !isNontrivialFormula(cleanLatex) ||
          isNumericPluginOrScalarAssignment(cleanLatex)
        ) {
          continue;
        }

        allFormulas.push({
          ...item,
          latex: cleanLatex,
          raw: item.raw || cleanLatex,
          label: item.label ?? "",
          variables: item.variables ?? [],
          evidence: item.evidence ?? "",
          isExerciseOnly: Boolean(item.isExerciseOnly),
        });
      }
    }

    if (result.claims && Array.isArray(result.claims)) {
      for (const claim of result.claims) {
        if (!chunkSlideSet.has(claim.slide)) continue;
        allClaims.push(claim);
      }
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

  // Working entries initialized with deterministic inventory
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
  }> = deterministicInventory.map((item) => ({
    slide: item.slide,
    raw: item.raw,
    latex: item.latex,
    origin: item.origin,
    confidence: item.confidence,
    variables: [],
  }));

  // Match or add LLM extracted formulas
  for (const item of extractedFormulas) {
    const cleanLatex = (item.latex || "")
      .replace(/^\s*\$+|\$+\s*$/g, "")
      .trim();
    if (!cleanLatex) continue;

    const extLatexKey = normalizeInventoryFormulaKey(cleanLatex);
    const extRawKey = normalizeInventoryFormulaKey(item.raw);

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
        existing.evidence = item.evidence.trim();
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
      if (
        !isNontrivialFormula(cleanLatex) ||
        isNumericPluginOrScalarAssignment(cleanLatex)
      ) {
        continue;
      }

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
        raw: item.raw || cleanLatex,
        latex: cleanLatex,
        origin: "llm",
        label: item.label && item.label.trim() ? item.label.trim() : undefined,
        variables: (item.variables ?? []).map((v) => ({
          symbol: v.symbol,
          definition: v.definition,
        })),
        evidence:
          item.evidence && item.evidence.trim()
            ? item.evidence.trim()
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
