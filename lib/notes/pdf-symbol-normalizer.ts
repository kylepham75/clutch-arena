/**
 * Map of Private Use Area (PUA), Symbol, Wingdings, and MT Extra codepoints
 * commonly emitted by PDF extractors (PowerPoint, Pearson textbooks, MathType)
 * to standard Unicode math operators, delimiters, arrows, and Greek letters.
 */
const PUA_MATH_AND_ARROW_MAP: Record<string, string> = {
  // Arrow codepoints
  "\uF0E1": "↑",
  "\uF0D9": "↑",
  "\uF0AD": "↑",
  "\u25B2": "↑",
  "\u2191": "↑",

  "\uF0E2": "↓",
  "\uF0DA": "↓",
  "\uF0AF": "↓",
  "\u25BC": "↓",
  "\u2193": "↓",

  "\uF0E0": "→",
  "\uF0AE": "→",
  "\uF0E8": "→",
  "\u2192": "→",

  "\uF0DF": "←",
  "\uF0AC": "←",
  "\u2190": "←",

  "\uF0DC": "⇒",
  "\u21D2": "⇒",

  // Delimiters
  "\uF028": "(",
  "\uF029": ")",
  "\uF05B": "[",
  "\uF05D": "]",
  "\uF07B": "{",
  "\uF07D": "}",

  // Math operators
  "\uF02B": "+",
  "\uF02D": "−",
  "\uF03D": "=",
  "\uF0A3": "≤",
  "\uF0A5": "∞",
  "\uF0B1": "±",
  "\uF0B3": "≥",
  "\uF0B4": "×",
  "\uF0B6": "∂",
  "\uF0B8": "÷",
  "\uF0B9": "≠",
  "\uF0BB": "≈",
  "\uF0D5": "∏",
  "\uF0D6": "√",
  "\uF0D7": "×",
  "\uF0D8": "÷",
  "\uF0E5": "∑",
  "\uF0F2": "∫",

  // Common PUA Symbol Greek letters
  "\uF044": "Δ",
  "\uF053": "Σ",
  "\uF057": "Ω",
  "\uF061": "α",
  "\uF062": "β",
  "\uF063": "χ",
  "\uF064": "δ",
  "\uF065": "ε",
  "\uF066": "φ",
  "\uF067": "γ",
  "\uF068": "η",
  "\uF06B": "κ",
  "\uF06C": "λ",
  "\uF06D": "μ",
  "\uF070": "π",
  "\uF071": "θ",
  "\uF072": "ρ",
  "\uF073": "σ",
  "\uF074": "τ",
  "\uF077": "ω",
};

/**
 * Compiled regular expression matching all recognized PUA math and arrow symbols.
 */
const SYMBOL_PATTERN = new RegExp(
  Object.keys(PUA_MATH_AND_ARROW_MAP)
    .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("|"),
  "g"
);

/**
 * Normalizes PDF text by:
 * 1. Mapping Windows Symbol / Wingdings / MT Extra PUA arrows, math operators,
 *    delimiters, and Greek characters to standard Unicode.
 * 2. Replacing unmapped PUA codepoints (U+E000..U+F8FF) and replacement glyphs (U+FFFD) with spaces.
 * 3. Sanitizing ASCII control characters (removing U+0000..U+0008, U+000E..U+001F,
 *    normalizing tabs/vertical-tabs/form-feeds/carriage-returns to spaces,
 *    preserving newlines \n).
 * 4. Collapsing redundant horizontal spaces while preserving line breaks.
 */
export function normalizePdfMathSymbols(text: string): string {
  if (!text) return "";

  // 1. Replace mapped PUA arrows, operators, delimiters, and Greek letters
  let result = text.replace(
    SYMBOL_PATTERN,
    (match) => PUA_MATH_AND_ARROW_MAP[match] ?? match
  );

  // 2. Replace unmapped Private Use Area codepoints and replacement characters with spaces
  result = result.replace(/[\uE000-\uF8FF\uFFFD]/g, " ");

  // 3. Normalize line breaks and sanitize ASCII control characters
  result = result
    .replace(/\r\n/g, "\n")
    .replace(/[\t\v\f\r]/g, " ")
    .replace(/[\x00-\x08\x0E-\x1F]/g, "");

  // 4. Collapse consecutive horizontal whitespace to a single space without collapsing newlines
  result = result.replace(/[^\S\n]{2,}/g, " ");

  return result;
}

/**
 * Backwards-compatible alias for normalizePdfMathSymbols.
 */
export const normalizePdfArrowSymbols = normalizePdfMathSymbols;
