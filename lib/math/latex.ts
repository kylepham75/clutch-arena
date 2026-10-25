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
 * Sanitizes corrupted Vietnamese typography where Greek Sigma (\Sigma, $\Sigma$, Σ)
 * was erroneously inserted in place of Vietnamese words/syllables like "su", "sử", "suất", "sự".
 */
export function cleanVietnameseSigmaTypos(text: string): string {
  if (!text || typeof text !== "string") return text;
  let s = text;

  // 1. "tỷ \Sigma ất" -> "tỷ suất", "Tỷ \Sigma ất" -> "Tỷ suất"
  s = s.replace(/\b(tỷ|Tỷ|TỶ)\s*(?:\$?\\Sigma\$?|Σ)\s*([ấẤ]t)\b/g, (_m, t) => {
    return t === "TỶ" ? "TỶ SUẤT" : t === "Tỷ" ? "Tỷ suất" : "tỷ suất";
  });

  // 2. "tỷ \Sigma" -> "tỷ suất", "Tỷ \Sigma" -> "Tỷ suất" (avoid matching math expressions like tỷ \Sigma_{i=1})
  s = s.replace(/\b(tỷ|Tỷ|TỶ)\s*(?:\$?\\Sigma\$?|Σ)(?![a-zA-Z0-9_^=])/g, (_m, t) => {
    return t === "TỶ" ? "TỶ SUẤT" : t === "Tỷ" ? "Tỷ suất" : "tỷ suất";
  });

  // 3. "\Sigma ất" -> "suất", "$\Sigma$ất" -> "suất", "Σất" -> "suất"
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*([ấẤ]t)\b/g, (_m, at) => {
    return at === "ẤT" ? "suất" : "suất";
  });

  // 4. "\Sigma dụng" / "\Sigma sử dụng" / "$\Sigma$ dụng" -> "sử dụng"
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*(?:dụng|ử\s*dụng)\b/gi, "sử dụng");

  // 5. "\Sigma kiện" -> "sự kiện"
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*kiện\b/gi, "sự kiện");

  // 6. "\Sigma cố" -> "sự cố"
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*cố(?![a-zA-Z\u00C0-\u1EF9])/gi, "sự cố");

  // 7. "\Sigma biến" -> "sự biến"
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*biến\b/gi, "sự biến");

  // 8. "\Sigma thay" -> "sự thay"
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*thay\b/gi, "sự thay");

  // 9. "\Sigma khác" -> "sự khác"
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*khác\b/gi, "sự khác");

  // 10. Generic fallback: if \Sigma or $\Sigma$ or Σ is followed directly (or with whitespace)
  // by a lowercase Vietnamese accented character, e.g. "$\Sigma$ử", "\Sigmaất", "Σuất", etc.
  s = s.replace(/(?:\$?\\Sigma\$?|Σ)\s*([a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ][a-zà-ỹ]*)/gi, (_m, tail) => {
    if (/^[ửừữự]/.test(tail)) {
      return `s${tail}`;
    }
    if (/^[ấ]/.test(tail)) {
      return `su${tail}`;
    }
    if (/^u[ấ]/i.test(tail)) {
      return `s${tail}`;
    }
    if (/^dụng/i.test(tail)) {
      return `sử ${tail}`;
    }
    return `su${tail}`;
  });

  return s;
}

export function cleanTypoString(str: string): string {
  return cleanVietnameseSigmaTypos(str);
}

/**
 * Repairs LaTeX strings that were corrupted by JSON escape sequence parsing or LLM output
 * (e.g. \beta -> \b (0x08) + eta -> " eta", \times -> \t (0x09) + imes -> " imes").
 */
export function repairCorruptedLatex(text: string): string {
  if (!text) return "";

  let s = cleanVietnameseSigmaTypos(text);

  // 1. Repair explicit ASCII control characters from JSON string parsing
  // \a = 0x07 (bell), \b = 0x08 (backspace), \t = 0x09 (tab), \f = 0x0c (form feed), \r = 0x0d (carriage return)
  s = s.replace(/[\x07]lpha\b/g, "\\alpha ");
  s = s.replace(/[\x08\b]eta\b/g, "\\beta ");
  s = s.replace(/[\x08\b]ar\{/g, "\\bar{");
  s = s.replace(/[\x08\b]ar(?=[{_\s]|\b)/g, "\\bar ");
  s = s.replace(/[\x08\b]egin\{/g, "\\begin{");
  s = s.replace(/[\x08\b]inom\{/g, "\\binom{");
  s = s.replace(/[\x08\b]ullet\b/g, "\\bullet ");

  s = s.replace(/[\x09\t]imes\b/g, "\\times ");
  s = s.replace(/[\x09\t]ext\{/g, "\\text{");
  s = s.replace(/[\x09\t]extbf\{/g, "\\textbf{");
  s = s.replace(/[\x09\t]extit\{/g, "\\textit{");
  s = s.replace(/[\x09\t]heta\b/g, "\\theta ");
  s = s.replace(/[\x09\t]au\b/g, "\\tau ");
  s = s.replace(/[\x09\t]o\b/g, "\\to ");

  s = s.replace(/[\x0c\f]rac\{/g, "\\frac{");
  s = s.replace(/[\x0c\f]orall\b/g, "\\forall ");

  s = s.replace(/[\x0d\r]ho\b/g, "\\rho ");
  s = s.replace(/[\x0d\r]ight([)\]}|.])/g, "\\right$1");

  // In math context, \neq and \nabla from \n
  s = s.replace(/(\$[^$\n]*?)[\x0a\n]eq\b/g, "$1\\neq ");
  s = s.replace(/(\$[^$\n]*?)[\x0a\n]abla\b/g, "$1\\nabla ");

  // 2. Repair corrupted tokens where control characters collapsed into spaces or were stripped
  // "imes" is never a standalone English word -> convert to \times
  s = s.replace(/\bimes\b/g, "\\times");

  // "rac{" -> \frac{, "qrt{" -> \sqrt{
  s = s.replace(/(?:^|\s)rac\{/g, " \\frac{");
  s = s.replace(/(?:^|\s)qrt\{/g, " \\sqrt{");

  // Repair corrupted text{Cov}, text{Corr}, text{Var}
  s = s.replace(/[\x09\t]ext\{(Cov|Corr|Var)\}/g, "\\text{$1}");
  s = s.replace(/(?:^|[\s$+\-=*/(])ext\{(Cov|Corr|Var)\}/g, (match, fn) =>
    match.replace(`ext{${fn}}`, `\\text{${fn}}`),
  );
  s = s.replace(/\\text\{\s*(?:cov|Cov)\s*\}/g, "\\text{Cov}");
  s = s.replace(/\\text\{\s*(?:corr|Corr)\s*\}/g, "\\text{Corr}");
  s = s.replace(/\\text\{\s*(?:var|Var)\s*\}/g, "\\text{Var}");
  s = s.replace(/(^|[\s$+\-=*/(])(?:Cov|cov)\s*\(/g, "$1\\text{Cov}(");
  s = s.replace(/(^|[\s$+\-=*/(])(?:Corr|corr)\s*\(/g, "$1\\text{Corr}(");
  s = s.replace(/(^|[\s$+\-=*/(])(?:Var|var)\s*\(/g, "$1\\text{Var}(");

  // "beta" corrupted to "eta" in math / operator context (e.g. "+  eta", "= eta", "eta \times", "eta imes")
  s = s.replace(/([+\-=*\/]\s*)eta\b/g, "$1\\beta");
  s = s.replace(/(^|[\s$])eta\s*(?=\\times|imes\b|[*_^(+\-=]|\b[a-zA-Z]\b)/g, "$1\\beta");

  // "rho" corrupted to "ho" after operators or in math context
  s = s.replace(/([+\-=*\/]\s*)ho\b/g, "$1\\rho");
  s = s.replace(/(^|[\s$])ho\s*(?=\\times|imes\b|[*_^(+\-=]|\b[a-zA-Z0-9]\b)/g, "$1\\rho");

  // Bare Greek / math function names in math / equation context
  s = s.replace(/(^|[\s$+\-=*/(,])sigma(?=[_^(\s+\-=*/,)]|\b)/g, "$1\\sigma");
  s = s.replace(/(^|[\s$+\-=*/(,])beta(?=[_^(\s+\-=*/,)]|\b)/g, "$1\\beta");
  s = s.replace(/(^|[\s$+\-=*/(,])rho(?=[_^(\s+\-=*/,)]|\b)/g, "$1\\rho");
  s = s.replace(/(^|[\s$+\-=*/(,])alpha(?=[_^(\s+\-=*/,)]|\b)/g, "$1\\alpha");
  s = s.replace(/(^|[\s$+\-=*/(,])mu(?=[_^(\s+\-=*/,)]|\b)/g, "$1\\mu");
  s = s.replace(/(^|[\s$+\-=*/(,])sum(?=\s*[_^({]|\s*[a-zA-Z0-9])/g, "$1\\sum");
  s = s.replace(/(^|[\s$+\-=*/(,])sqrt(?=\s*\{)/g, "$1\\sqrt");
  s = s.replace(/(^|[\s$+\-=*/(,])bar\{/g, "$1\\bar{");

  // Clean up duplicate backslashes if any: \\\sigma -> \sigma
  s = s.replace(/\\\\(sigma|beta|rho|alpha|mu|sum|sqrt|bar|text|times|frac|Delta)/g, "\\$1");

  // Clean up formatting and spacing around \times and \beta
  s = s.replace(/\s*\\times\s*/g, " \\times ");
  s = s.replace(/([+\-=*\/])\s*\\beta\b/g, "$1 \\beta");
  s = s.replace(/\\beta\s*\\times/g, "\\beta \\times");

  // Normalize whitespace right after opening $ or before closing $
  s = s.replace(/\$([ \t]+)([^$\n]+?)\$/g, (m, _sp, inner) =>
    isLikelyInlineMath(inner) ? `$${inner.trim()}$` : m,
  );
  s = s.replace(/\$([^$\n]+?)([ \t]+)\$/g, (m, inner, _sp) =>
    isLikelyInlineMath(inner) ? `$${inner.trim()}$` : m,
  );

  // 3. Move trailing sentence punctuation outside inline math delimiters:
  // e.g. "$... = 9.45%.$" -> "$... = 9.45%$."
  s = s.replace(/(\$[^$\n]+?)([.,;:])\$/g, "$1$$$2");

  return s;
}

/**
 * Safely renders LaTeX via KaTeX without throwing exceptions.
 */
export function renderKatexSafe(tex: string, displayMode: boolean): string {
  try {
    const repaired = repairCorruptedLatex(tex);
    // Sanitize unescaped % signs to \% so KaTeX doesn't treat them as comments
    const sanitized = repaired
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
export function isLikelyInlineMath(rawContent: string): boolean {
  if (!rawContent) return false;
  const content = rawContent.trim();
  if (!content) return false;

  // Cannot start with a digit (e.g. currency amounts like $50 or $5,000)
  if (/^\d/.test(content)) return false;

  // Sentences with full stops and capitalized words are prose, not math
  if (/[.!?]\s+[A-Za-z]/.test(content)) return false;

  // Check if content is an equation or calculation (contains = with math operators, variables, or brackets)
  const isEquation =
    content.includes("=") &&
    (/[+\-*/^_{}()\[\]0-9%]/.test(content) || /\\times|\\div|\\approx/.test(content));

  // Multi-word prose strings (> 4 words) without LaTeX commands or equations are not math
  const words = content.split(/\s+/);
  if (words.length > 4 && !content.includes("\\") && !isEquation) return false;

  // Genuine inline math must contain math symbols, be an equation, or be a short variable name
  const hasMathSymbols = /[\\_^{}=<>|±÷×+\-*/%]/.test(content);
  const isShortVariable = /^[a-zA-Z]{1,3}$/.test(content);

  return hasMathSymbols || isEquation || isShortVariable;
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
 * Ensures bare LaTeX expressions and math formulas in prose strings (without existing $ delimiters)
 * are wrapped in $...$ inline math delimiters so they render cleanly via KaTeX in MathText.
 * Preserves already delimited math ($...$, $$...$$, \[...\], \(...\)).
 */
export function ensureInlineMathDelimiters(text: string): string {
  if (!text || typeof text !== "string") return text;

  // Split string into segments preserving already delimited math
  const tokens = tokenizeMath(text);
  if (tokens.length === 0) return text;

  const parts: string[] = [];

  for (const token of tokens) {
    if (token.type === "display-math") {
      parts.push(`$$${token.value}$$`);
    } else if (token.type === "inline-math") {
      parts.push(`$${token.value}$`);
    } else {
      let segments: Array<{ isMath: boolean; val: string }> = [
        { isMath: false, val: token.value },
      ];

      const apply = (
        regex: RegExp,
        replacer: (match: string) => string,
      ) => {
        const next: Array<{ isMath: boolean; val: string }> = [];
        for (const seg of segments) {
          if (seg.isMath) {
            next.push(seg);
          } else {
            let lastIdx = 0;
            const re = new RegExp(regex.source, regex.flags);
            let m: RegExpExecArray | null;
            while ((m = re.exec(seg.val)) !== null) {
              if (m.index > lastIdx) {
                next.push({
                  isMath: false,
                  val: seg.val.slice(lastIdx, m.index),
                });
              }
              const matched = m[0];
              const trimmed = matched.trim();
              const leadSpace = matched.slice(0, matched.indexOf(trimmed));
              const trailSpace = matched.slice(matched.indexOf(trimmed) + trimmed.length);

              if (leadSpace) {
                next.push({ isMath: false, val: leadSpace });
              }

              const res = replacer(trimmed);
              // Check if replacer moved punctuation outside delimiter, e.g. "$x$."
              const punctMatch = res.match(/^(\$[\s\S]+?\$)([.,;:]+)$/);
              if (punctMatch) {
                next.push({ isMath: true, val: punctMatch[1] });
                next.push({ isMath: false, val: punctMatch[2] });
              } else if (res.startsWith("$") && res.endsWith("$")) {
                next.push({ isMath: true, val: res });
              } else {
                next.push({ isMath: false, val: res });
              }

              if (trailSpace) {
                next.push({ isMath: false, val: trailSpace });
              }

              lastIdx = re.lastIndex;
            }
            if (lastIdx < seg.val.length) {
              next.push({ isMath: false, val: seg.val.slice(lastIdx) });
            }
          }
        }
        segments = next;
      };

      const wrapInMath = (expr: string): string => {
        const trimmed = expr.trim();
        if (!trimmed) return expr;
        const m = trimmed.match(/^([\s\S]+?)([.,;:]+)$/);
        if (m) {
          return `$${m[1].trim()}$${m[2]}`;
        }
        return `$${trimmed}$`;
      };

      const isMathEquation = (m: string): boolean => {
        if (!/=|\\approx|≈|\\sim|\\le|\\ge|\\leq|\\geq|\\ne|\\neq/.test(m)) return false;
        if (/\\(?:sigma|beta|rho|alpha|mu|gamma|delta|epsilon|theta|lambda|pi|tau|phi|omega|Delta|Sigma|Omega|bar|hat|tilde|vec|mathbf|mathit|text|frac|sqrt|sum|prod|int|partial|left|right|times|div|approx|le|ge|leq|geq|ne|neq|cdot|pm|mp|circ|infty)\b/.test(m)) {
          return true;
        }
        if (/[_^{}]/.test(m)) return true;
        if (/[+\-*/^]/.test(m) && /[A-Za-z0-9]/.test(m)) return true;
        if (/\b(?:NPV|IRR|WACC|ROE|ROA|PV|FV|EAR|APR|EBIT|EBITDA|CAPM|EPS|DPS)\b/.test(m)) return true;
        if (/[A-Z]\[[A-Za-z0-9]|(?:Var|Cov|Corr|SD|SE)\(/.test(m)) return true;
        return false;
      };

      // 0. Wrap full un-delimited math equations containing '=' or '\approx' with math symbols/variables
      const eqRegex =
        /(?:\\(?:sigma|beta|rho|alpha|mu|gamma|delta|epsilon|theta|lambda|pi|tau|phi|omega|Delta|Sigma|Omega|bar|hat|tilde|vec|mathbf|mathit|text\{[^{}]+\}|frac\{[^{}]+\}\{[^{}]+\})(?:_\{[^{}]+\}|_[A-Za-z0-9]+)?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+)?(?![a-zA-Z0-9_])|\b(?:NPV|IRR|WACC|ROE|ROA|PV|FV|EAR|APR|EBIT|EBITDA|CAPM|EPS|DPS|PE|PB)(?:_\{[^{}]+\}|_[A-Za-z0-9]+)?(?![a-zA-Z0-9_])|(?:E\[[A-Za-z0-9_{}^]+\]|E\([A-Za-z0-9_{}^]+\)|Var\([A-Za-z0-9_{}^,\s]+\)|Cov\([A-Za-z0-9_{}^,\s]+\)|Corr\([A-Za-z0-9_{}^,\s]+\)|SD\([A-Za-z0-9_{}^,\s]+\))|\b[A-Za-z]{1,3}_(?:\{[^{}]+\}|[A-Za-z0-9]+)(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+)?(?![a-zA-Z0-9_])|\b[A-Za-z](?:\^\{[^{}]+\}|\^[A-Za-z0-9]+)(?![a-zA-Z0-9_])|\b[A-Za-z]{1,2}_[A-Za-z0-9]+\s*[\+\-\*\/]\s*[A-Za-z]{1,2}_[A-Za-z0-9]+\b|\([A-Za-z0-9\s+\-*\/^_{}]+\)|\b[A-Za-z]\b)\s*(?:=|\\approx|≈|\\sim|\\le|\\ge|\\leq|\\geq|\\ne|\\neq)\s*(?:\d+\.\d+%?|\((?:[^()]|\([^()]*\))*\)|\{(?:[^{}]|\{[^{}]*\})*\}|\[(?:[^\[\]]|\[[^\[\]]*\])*\]|,(?!\s)|[^\s.,;:\n(){}\[\]]+|\s+(?!(?:for|the|and|where|with|while|when|if|in|is|as|to|of|from|by|given|based|measured|meaning|defined|which|that|or|trong|với|khi|nếu|và|hoặc|cho|thì|là|được|theo|ở|gồm|tại|từ|do|để|như)\b))+?(?=[.,;:]?(?:\s+(?:for|the|and|where|with|while|when|if|in|is|as|to|of|from|by|given|based|measured|meaning|defined|which|that|or|trong|với|khi|nếu|và|hoặc|cho|thì|là|được|theo|ở|gồm|tại|từ|do|để|như)\b|\s*$))/g;
      apply(eqRegex, (m) => (isMathEquation(m) ? wrapInMath(m) : m));

      // 1. Wrap \left ... \right bracketed expressions
      const leftRightRegex =
        /\\left([\[\(\{|\.]).*?\\right([\]\)\}|\.])/g;
      apply(leftRightRegex, (m) => wrapInMath(m));

      // 2. Wrap fractions: \frac{...}{...} (supporting up to 2 levels of nested braces)
      const fracRegex =
        /\\frac\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g;
      apply(fracRegex, (m) => wrapInMath(m));

      // 3. Wrap square roots: \sqrt{...}
      const sqrtRegex =
        /\\sqrt(?:\[[^\]]*\])?\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g;
      apply(sqrtRegex, (m) => wrapInMath(m));

      // 4. Wrap Summation, Product, Integral expressions: \sum_{t=1}^T, \prod_{t=1}^T, \int_{a}^b, \partial
      const sumProdRegex =
        /\\(?:sum|prod|int)(?:_\{[^{}]*\}|_[a-zA-Z0-9=]+)?(?:\^\{[^{}]*\}|\^[a-zA-Z0-9]+)?(?:\s+(?:[a-zA-Z]\([a-zA-Z]\)\s*d[a-zA-Z]\b|d[a-zA-Z]\b))?|\\partial(?:_\{[^{}]*\}|_[a-zA-Z0-9]+)?(?:\^\{[^{}]*\}|\^[a-zA-Z0-9]+)?/g;
      apply(sumProdRegex, (m) => wrapInMath(m));

      // 5. Wrap Financial & Quantitative functions: \text{Cov}(...), \text{Corr}(...), \text{Var}(...), \text{SD}(...), \text{NPV}, etc.
      const covRegex =
        /\\text\{(?:Cov|Corr|Var|SD|SE|NPV|IRR|WACC|ROE|ROA|PV|FV|EAR|APR|EBIT|EBITDA)\}(?:\([A-Za-z0-9_,\s\(\)\^\{\}\+\-\*\/]+\))?/g;
      apply(covRegex, (m) => wrapInMath(m));

      // 6. Wrap math accents and fonts: \bar{...}, \hat{...}, \tilde{...}, \vec{...}, \mathbf{...}, \mathit{...}
      const accentRegex =
        /\\(?:bar|hat|tilde|vec|mathbf|mathit)\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}(?:_\{[^{}]*\}|_[a-zA-Z0-9]+)?(?:\^\{[^{}]*\}|\^[a-zA-Z0-9]+)?|\\(?:bar|hat|tilde|vec)\s+[a-zA-Z]/g;
      apply(accentRegex, (m) => wrapInMath(m));

      // 7. Wrap Greek variables with optional sub/superscripts: \sigma_p^2, \beta_i, \rho_{AB}, \Delta P, etc.
      const deltaVarRegex =
        /\\Delta\s+[A-Za-z]\b/g;
      apply(deltaVarRegex, (m) => wrapInMath(m));

      const greekRegex =
        /\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Delta|Sigma|Omega|Gamma|Theta|Lambda|Xi|Pi|Upsilon|Phi|Psi)(?:_\{[^{}]*\}|_[a-zA-Z0-9]+)?(?:\^\{[^{}]*\}|\^[a-zA-Z0-9]+)?(?![a-zA-Z0-9])/g;
      apply(greekRegex, (m) => wrapInMath(m));

      // 8. Wrap comparison / operators when adjacent to numbers or surrounded by whitespace
      const opNumRegex =
        /(\\(?:pm|mp|approx))\s*(\d+(?:\.\d+)?%?)/g;
      apply(opNumRegex, (m) => wrapInMath(m));

      const compRegex =
        /\s+(\\(?:approx|sim|le|ge|leq|geq|ne|neq|times|div|pm|mp|cdot|circ|infty|forall|exists|in|notin|subset|cup|cap))\s+/g;
      apply(compRegex, (op) => ` $${op.trim()}$ `);

      // 9. Wrap variables with subscripts: P_0, D_1, R_f, R_M, R_E, R_D, R_P, CF_t, CF_0, w_A, w_B, T_C, P_t, P_{t+1}, D_{t+1}, Q_d, Q_s
      const subscriptRegex =
        /\b(?:P_0|D_1|R_f|R_M|R_E|R_D|R_P|CF_t|CF_0|w_A|w_B|T_C|P_t|P_\{t\+1\}|D_\{t\+1\}|Q_d|Q_s|E_d|E_\{xy\}|Q_x|P_y|[A-Za-z]{1,2}_(?:\{[^{}]+\}|[A-Za-z0-9]{1,4}))(?=[.,;:]?(?:\s|$))/g;
      apply(subscriptRegex, (m) => wrapInMath(m));

      // 10. Wrap variables and base terms with exponents: s^2, \sigma^2, (1+r)^t, (1+R)^T
      const expBaseRegex =
        /\((?:1\s*[\+\-]\s*[a-zA-Z0-9.]+)\)\^\{?[+-]?[a-zA-Z0-9]+\}?(?=[.,;:]?(?:\s|$))/g;
      apply(expBaseRegex, (m) => wrapInMath(m));

      const expVarRegex =
        /\b[a-zA-Z](?:\^\{[^{}]+\}|\^[0-9a-zA-Z]+)(?=[.,;:]?(?:\s|$))/g;
      apply(expVarRegex, (m) => wrapInMath(m));

      // 11. Wrap any remaining un-delimited \text{...} macros
      const textMacroRegex =
        /\\text\{(?:[^{}]|\{[^{}]*\})*\}/g;
      apply(textMacroRegex, (m) => wrapInMath(m));

      let plain = segments.map((s) => s.val).join("");

      // Move trailing sentence punctuation outside inline math delimiters:
      plain = plain.replace(/(\$[^$\n]+?)([.,;:])\$/g, "$1$$$2");

      parts.push(plain);
    }
  }

  return parts.join("");
}

/**
 * Normalizes plain ASCII or Unicode economics/math expressions into beautiful LaTeX.
 * If the input already contains LaTeX markers ($ or $$ or \[ or \(), it leaves them intact.
 */
export function normalizeMathFormulas(raw: string): string {
  if (!raw) return "";

  // Always repair corrupted LaTeX escape sequences first
  let text = repairCorruptedLatex(raw);

  // If already formatted with LaTeX display markers, run ensureInlineMathDelimiters to protect surrounding prose and return
  if (text.includes("$$") || text.includes("\\[") || text.includes("\\(")) {
    return ensureInlineMathDelimiters(text);
  }

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

  // Pattern 2.5: Un-delimited LaTeX formula equation starting with LaTeX command or symbol
  // e.g. \sigma_p^2 = ..., \text{Cov}(R_A, R_B) = ..., \beta_i = ...
  if (
    !text.includes("$") &&
    /\\(?:sigma|beta|rho|alpha|mu|text|frac|sqrt|sum|prod|Delta|bar)\b/.test(text) &&
    /^[A-Za-z0-9_().\s\\\[\]{}]+=\s*[A-Za-z0-9_().\s+\-*\/^$≈\\\[\]{}]+$/.test(text.trim())
  ) {
    return `$${text.trim()}$`;
  }

  // Pattern 3: Standalone formula equation without math markers (e.g. in metadata.rule or explanation)
  // Example: "PB = PV(coupons) + PV(face)" or "FV = PV * (1 + r)^n" or "r = r_f + \beta \times (E[R_{Mkt}] - r_f)"
  if (!text.includes("$") && /^[A-Za-z0-9_().\s\\\[\]{}]+=\s*[A-Za-z0-9_().\s+\-*\/^$≈\\\[\]{}]+$/.test(text.trim()) && /[+\-*\/^()\\\[\]]/.test(text)) {
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

  // Wrap any un-delimited LaTeX sequences in inline math delimiters
  text = ensureInlineMathDelimiters(text);

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
  const text = repairCorruptedLatex(input);
  const tokens: MathToken[] = [];
  let i = 0;
  let textBuffer = "";

  function flushText() {
    if (textBuffer.length > 0) {
      tokens.push({ type: "text", value: textBuffer });
      textBuffer = "";
    }
  }

  while (i < text.length) {
    // 1. Display math: $$...$$
    if (text.startsWith("$$", i)) {
      const closeIdx = text.indexOf("$$", i + 2);
      if (closeIdx !== -1) {
        flushText();
        tokens.push({
          type: "display-math",
          value: text.slice(i + 2, closeIdx),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // 2. LaTeX display math: \[...\]
    if (text.startsWith("\\[", i)) {
      const closeIdx = text.indexOf("\\]", i + 2);
      if (closeIdx !== -1) {
        flushText();
        tokens.push({
          type: "display-math",
          value: text.slice(i + 2, closeIdx),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // 3. LaTeX inline math: \(...\)
    if (text.startsWith("\\(", i)) {
      const closeIdx = text.indexOf("\\)", i + 2);
      if (closeIdx !== -1) {
        flushText();
        tokens.push({
          type: "inline-math",
          value: text.slice(i + 2, closeIdx),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // 4. Inline math: $...$
    if (text[i] === "$") {
      const nextChar = text[i + 1];
      // If $ is followed by a digit or end of string, it is currency or punctuation (e.g. $5,000)
      if (!nextChar || /\d/.test(nextChar)) {
        textBuffer += "$";
        i++;
        continue;
      }

      // Look for closing $ on the same line
      let closeIdx = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === "\n") break; // inline math cannot span multiple lines
        if (text[j] === "$") {
          // Check if escaped with odd number of backslashes (e.g. \$)
          let backslashes = 0;
          let k = j - 1;
          while (k >= 0 && text[k] === "\\") {
            backslashes++;
            k--;
          }
          if (backslashes % 2 === 1) {
            continue; // Escaped dollar sign inside math, do not close
          }

          if (text[j + 1] === "$") {
            j++;
            continue;
          }
          closeIdx = j;
          break;
        }
      }

      if (closeIdx !== -1) {
        const candidate = text.slice(i + 1, closeIdx);
        const trimmed = candidate.trim();
        if (isLikelyInlineMath(trimmed)) {
          flushText();
          tokens.push({
            type: "inline-math",
            value: trimmed,
          });
          i = closeIdx + 1;
          continue;
        }
      }
    }

    textBuffer += text[i];
    i++;
  }

  flushText();
  return tokens;
}
