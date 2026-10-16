import katex from "katex";

/**
 * Escapes raw HTML characters to prevent XSS in fallback text.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Safely renders LaTeX via KaTeX without throwing exceptions.
 */
export function renderKatexSafe(tex: string, displayMode: boolean): string {
  try {
    // Sanitize unescaped % signs to \% so KaTeX doesn't treat them as comments
    const sanitized = tex
      .trim()
      .replace(/(^|[^\\])%/g, "$1\\%")
      .replace(/[\u0394Δ]/g, "\\Delta ")
      .replace(/÷/g, "\\div ")
      .replace(/×/g, "\\times ")
      .replace(/(^|[^\\])\\\$([0-9])/g, "$1\\text{\\$}$2");

    return katex.renderToString(sanitized, {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
    });
  } catch {
    return `<span class="katex-fallback">${escapeHtml(tex)}</span>`;
  }
}

export type MathContentBlock =
  | { type: "math-display"; math: string }
  | { type: "text"; text: string };

/**
 * Splits text into display math blocks (\[...\] or $$...$$) and normal prose blocks,
 * preserving multiline formulas that span across line breaks.
 */
export function splitMathBlocks(text: string): MathContentBlock[] {
  if (!text) return [];

  // Match \[ ... \] or $$ ... $$ across any newlines
  const regex = /(\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$)/g;
  const parts = text.split(regex);
  const blocks: MathContentBlock[] = [];

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith("\\[") && part.endsWith("\\]")) {
      const math = part.slice(2, -2).trim();
      if (math) {
        blocks.push({ type: "math-display", math });
      }
    } else if (part.startsWith("$$") && part.endsWith("$$")) {
      const math = part.slice(2, -2).trim();
      if (math) {
        blocks.push({ type: "math-display", math });
      }
    } else {
      blocks.push({ type: "text", text: part });
    }
  }

  return blocks;
}

/**
 * Checks whether content between single $ delimiters is genuine LaTeX inline math
 * rather than currency amounts ($5,000, $30) or ordinary prose.
 */
export function isLikelyInlineMath(content: string): boolean {
  if (!content) return false;

  // Cannot start or end with whitespace
  if (/^\s|\s$/.test(content)) return false;

  // Cannot start with a digit (e.g. currency amounts like $50 or $5,000)
  if (/^\d/.test(content)) return false;

  // Sentences with full stops and capitalized words are prose, not math
  if (/[.!?]\s+[A-Za-z]/.test(content)) return false;

  // Multi-word prose strings (> 4 words) without LaTeX commands are not math
  const words = content.split(/\s+/);
  if (words.length > 4 && !content.includes("\\")) return false;

  // Genuine inline math must contain math symbols or be a short variable name
  const hasMathSymbols = /[\\_^{}=<>|±÷×+\-*/]/.test(content);
  const isShortVariable = /^[a-zA-Z]{1,3}$/.test(content);

  return hasMathSymbols || isShortVariable;
}

/**
 * Converts a segment of ASCII math (equations, calculations, formulas) into valid LaTeX.
 */
export function convertAsciiMathSegment(segment: string): string {
  let s = segment.trim();
  if (!s) return "";

  // Check if segment has trailing prose after a comma, e.g. ", equal to par."
  let trailingText = "";
  const commaProseMatch = s.match(/(.*?)(,\s+[a-zA-Z].*)$/);
  if (commaProseMatch && commaProseMatch[1] && !commaProseMatch[2].includes("=")) {
    s = commaProseMatch[1].trim();
    trailingText = commaProseMatch[2];
  }

  // Normalize Unicode approx and divide/multiply
  s = s.replace(/≈/g, " \\approx ");
  s = s.replace(/÷/g, " \\div ");
  s = s.replace(/×/g, " \\times ");

  // Normalize currency inside math: $136.16 -> \text{\$}136.16
  s = s.replace(/\$([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/g, "\\text{\\$}$1");

  // Exponents: ^-3 -> ^{-3}, ^3 -> ^{3}, ^(x) -> ^{x}
  s = s.replace(/\^([+-]?\d+)/g, "^{$1}");
  s = s.replace(/\^\(([+-]?[a-zA-Z0-9.]+)\)/g, "^{$1}");

  // Multiplication: * with numbers, parens, brackets
  s = s.replace(/(\d+|\))\s*\*\s*([\[\(\d])/g, "$1 \\times $2");

  // Fractions of the form [(...)/denom] -> \left[\frac{...}{denom}\right]
  let hasBracketFrac = false;
  if (/\[\((.*?)\)\/([0-9.]+)\]/.test(s)) {
    hasBracketFrac = true;
    s = s.replace(/\[\((.*?)\)\/([0-9.]+)\]/g, "\\left[\\frac{$1}{$2}\\right]");
  }

  // Fractions of the form num/(denom^exp) or num/(denom) or num/denom
  s = s.replace(/([0-9.]+)\/(\(?[0-9.]+\)?\^\{[+-]?\d+\})/g, "\\frac{$1}{$2}");
  s = s.replace(/([0-9.]+)\/\(([^)]+)\)/g, "\\frac{$1}{$2}");
  s = s.replace(/([0-9.]+)\/([0-9.]+)/g, "\\frac{$1}{$2}");

  // General bracket matching [ ... ] -> \left[ ... \right]
  if (!hasBracketFrac && s.includes("[") && s.includes("]")) {
    s = s.replace(/\[(.*?)\]/g, "\\left[$1\\right]");
  }

  // Common financial/math terms on LHS
  s = s.replace(/\bPV of coupons\b/gi, "PV_{\\text{coupons}}");
  s = s.replace(/\bPV of face\b/gi, "PV_{\\text{face}}");
  s = s.replace(/\btotal\b/gi, "\\text{total}");

  // Function calls like PV(coupons) -> PV(\text{coupons})
  s = s.replace(/\b([A-Z]{1,4})\(([a-zA-Z]+)\)/g, "$1(\\text{$2})");

  return `$${s}$${trailingText}`;
}

/**
 * Normalizes plain ASCII or Unicode economics/math expressions into beautiful LaTeX.
 * If the input already contains LaTeX markers ($ or $$ or \[ or \(), it leaves them intact.
 */
export function normalizeMathFormulas(raw: string): string {
  if (!raw) return "";

  // If already formatted with LaTeX display markers, preserve it
  if (raw.includes("$$") || raw.includes("\\[") || raw.includes("\\(")) {
    return raw;
  }

  let text = raw;

  // Pattern 1: Cross-price elasticity: Exy = %ΔQx ÷ %ΔPy. Positive = substitutes; negative = complements
  if (/E(xy)?\s*=\s*%\s*[Δ\u0394]Qx\s*[÷\/]\s*%\s*[Δ\u0394]Py/i.test(text)) {
    text = text.replace(
      /E(xy)?\s*=\s*%\s*[Δ\u0394]Qx\s*[÷\/]\s*%\s*[Δ\u0394]Py\.?\s*/i,
      () => "$$E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}$$\n",
    );
  }

  // Pattern 2: Price elasticity: |Ed| = |%Δ quantity demanded ÷ %Δ price|
  if (/\|?E(d)?\|?\s*=\s*\|?%\s*[Δ\u0394]\s*(quantity demanded|Q(d)?)\s*[÷\/]\s*%\s*[Δ\u0394]\s*(price|P)\|?/i.test(text)) {
    text = text.replace(
      /\|?E(d)?\|?\s*=\s*\|?%\s*[Δ\u0394]\s*(?:quantity demanded|Q(?:d)?)\s*[÷\/]\s*%\s*[Δ\u0394]\s*(?:price|P)\|?\.?\s*/i,
      () => "$$|E_d| = \\left|\\frac{\\%\\Delta Q_d}{\\%\\Delta P}\\right|$$\n",
    );
  }

  // Pattern 3: Standalone formula equation (e.g. in metadata.rule or explanation)
  // Example: "PB = PV(coupons) + PV(face)" or "FV = PV * (1 + r)^n"
  if (/^[A-Za-z0-9_().\s]+\s*=\s*[A-Za-z0-9_().\s+\-*\/^$≈]+$/.test(text.trim()) && /[+\-*\/^()]/.test(text)) {
    let formula = text.trim();
    formula = formula.replace(/\b([A-Z]{1,4})\(([a-zA-Z]+)\)/g, "$1(\\text{$2})");
    formula = formula.replace(/(\d+|\))\s*\*\s*([\[\(\d])/g, "$1 \\times $2");
    formula = formula.replace(/\^([+-]?\d+)/g, "^{$1}");
    return `$$${formula}$$`;
  }

  // Pattern 4: Calculation steps separated by semicolons (e.g. bond PV calculation in explanations)
  // Example: "PV of coupons = 50 * [(1-(1+0.05)^-3)/0.05] ≈ $136.16; PV of face = 1000/(1.05)^3 ≈ $863.84; total ≈ $1,000, equal to par."
  if (text.includes(";") && (text.includes("=") || text.includes("≈")) && (text.includes("^") || text.includes("*") || text.includes("/"))) {
    const segments = text.split(";");
    const converted = segments.map((seg) => {
      const trimmed = seg.trim();
      if ((trimmed.includes("=") || trimmed.includes("≈")) && /[0-9*\/^$]/.test(trimmed)) {
        return convertAsciiMathSegment(trimmed);
      }
      return trimmed;
    });
    return converted.join("; ");
  }

  // Pattern 5: Single calculation expression with exponents or calculations
  if (!text.includes("$") && (text.includes("=") || text.includes("≈")) && (text.includes("^") || /\d+\s*\*\s*[\d(\[]/.test(text) || /\d+\s*\/\s*[\d(\[]/.test(text))) {
    if (/^[A-Za-z0-9_().\s]+\s*[=≈]\s*.*$/.test(text.trim())) {
      return convertAsciiMathSegment(text);
    }
  }

  // Subscript/inequality replacements in remaining text
  text = text.replace(/\bQd\s*>\s*Qs\b/g, () => "$Q_d > Q_s$");
  text = text.replace(/\bQd\s*<\s*Qs\b/g, () => "$Q_d < Q_s$");
  text = text.replace(/\|Ed\|\s*>\s*1/g, () => "$|E_d| > 1$");
  text = text.replace(/\|Ed\|\s*<\s*1/g, () => "$|E_d| < 1$");
  text = text.replace(/\bE\s*=\s*hf\b/g, () => "$E = hf$");

  return text;
}

/**
 * Cleans up common AI output artifacts where models accidentally wrap plain numbers,
 * currency, or percentages in LaTeX dollar signs (e.g. $1.29$, $1\%$$ -> 1.29, 1%).
 */
export function cleanCoachMathArtifacts(raw: string): string {
  if (!raw) return "";
  let res = raw;
  // Fix percentages with escaped % and trailing dollar signs (e.g. $1.29\%$ or $1\%$$ or $1.29\%\$$) -> 1.29% or 1%
  res = res.replace(/\$(\d+(?:\.\d+)?)\s*\\?%\s*\\?\$+/g, "$1%");
  // Fix $1.29\%$ or $1.29% -> 1.29%
  res = res.replace(/\$(\d+(?:\.\d+)?)\s*\\?%/g, "$1%");
  // Fix numbers wrapped in single dollar signs: $1.29$ -> 1.29
  res = res.replace(/\$(\d+(?:\.\d+)?)\$/g, "$1");
  // Fix $1%$ -> 1%
  res = res.replace(/\$(\d+(?:\.\d+)?)\s*%\s*\$/g, "$1%");
  // Fix trailing escaped dollars attached to percent: %\$ -> %
  res = res.replace(/%\s*\\?\$+/g, "%");
  // Fix currency wrapped in double dollars: $$40$$ -> $40
  res = res.replace(/\$\$(\d+(?:\.\d+)?)\$\$/g, "$$$1");
  // Fix raw escaped percent: \% -> %
  res = res.replace(/\\%/g, "%");
  return res;
}

export type MathToken =
  | { type: "text"; value: string }
  | { type: "inline-math"; value: string }
  | { type: "display-math"; value: string };

/**
 * Splits string by LaTeX delimiters while strictly protecting currency amounts ($5,000, $30)
 * and normal prose from accidental inline math parsing:
 * $$...$$ or \[...\] -> display math
 * $...$ or \(...\)   -> inline math
 */
export function tokenizeMath(input: string): MathToken[] {
  if (!input) return [];
  const tokens: MathToken[] = [];
  let i = 0;
  let textBuffer = "";

  function flushText() {
    if (textBuffer.length > 0) {
      tokens.push({ type: "text", value: textBuffer });
      textBuffer = "";
    }
  }

  while (i < input.length) {
    // 1. Display math: $$...$$
    if (input.startsWith("$$", i)) {
      const closeIdx = input.indexOf("$$", i + 2);
      if (closeIdx !== -1) {
        flushText();
        tokens.push({
          type: "display-math",
          value: input.slice(i + 2, closeIdx),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // 2. LaTeX display math: \[...\]
    if (input.startsWith("\\[", i)) {
      const closeIdx = input.indexOf("\\]", i + 2);
      if (closeIdx !== -1) {
        flushText();
        tokens.push({
          type: "display-math",
          value: input.slice(i + 2, closeIdx),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // 3. LaTeX inline math: \(...\)
    if (input.startsWith("\\(", i)) {
      const closeIdx = input.indexOf("\\)", i + 2);
      if (closeIdx !== -1) {
        flushText();
        tokens.push({
          type: "inline-math",
          value: input.slice(i + 2, closeIdx),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // 4. Inline math: $...$
    if (input[i] === "$") {
      const nextChar = input[i + 1];
      // If $ is followed by a digit or space or end of string, it is currency or punctuation (e.g. $5,000)
      if (!nextChar || /\d|\s/.test(nextChar)) {
        textBuffer += "$";
        i++;
        continue;
      }

      // Look for closing $ on the same line
      let closeIdx = -1;
      for (let j = i + 1; j < input.length; j++) {
        if (input[j] === "\n") break; // inline math cannot span multiple lines
        if (input[j] === "$") {
          // Check if escaped with odd number of backslashes (e.g. \$)
          let backslashes = 0;
          let k = j - 1;
          while (k >= 0 && input[k] === "\\") {
            backslashes++;
            k--;
          }
          if (backslashes % 2 === 1) {
            continue; // Escaped dollar sign inside math, do not close
          }

          if (input[j + 1] === "$") {
            j++;
            continue;
          }
          if (input[j - 1] !== " ") {
            closeIdx = j;
            break;
          }
        }
      }

      if (closeIdx !== -1) {
        const candidate = input.slice(i + 1, closeIdx);
        if (isLikelyInlineMath(candidate)) {
          flushText();
          tokens.push({
            type: "inline-math",
            value: candidate,
          });
          i = closeIdx + 1;
          continue;
        }
      }
    }

    textBuffer += input[i];
    i++;
  }

  flushText();
  return tokens;
}
