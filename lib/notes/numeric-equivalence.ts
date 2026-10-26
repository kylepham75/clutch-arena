import { normalizeInventoryFormulaKey } from "./formula-inventory";
import type {
  FormulaLedgerEntry,
  NoteFormula,
  NoteSection,
} from "@/lib/schemas/notes";

export type AstNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "unary"; operator: "+" | "-"; operand: AstNode }
  | {
      type: "binary";
      operator: "+" | "-" | "*" | "/" | "^";
      left: AstNode;
      right: AstNode;
    }
  | { type: "function"; name: string; args: AstNode[] }
  | { type: "equation"; lhs: AstNode; rhs: AstNode };

export interface EquivalenceCheckResult {
  equivalent: boolean;
  isRearrangement: boolean;
  contradicts: boolean;
  evaluable: boolean;
  matchedSeeds: number;
  totalSeeds: number;
  reason?: string;
}

export interface EquivalenceCheckOptions {
  tolerance?: number;
  numSeeds?: number;
}

export interface NoteFormulasEquivalenceReport {
  allPassed: boolean;
  contradictedFormulas: number;
  derivedVerifiedCount: number;
  directVerifiedCount: number;
  unverifiedFormulas: number;
  formulaResults: Array<{
    formula: NoteFormula;
    parentLedgerEntries: FormulaLedgerEntry[];
    result: EquivalenceCheckResult;
  }>;
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

const UNICODE_MATH_SYMBOLS: Record<string, string> = {
  "×": "*",
  "÷": "/",
  "−": "-",
  "–": "-",
  "—": "-",
  "·": "*",
  "⋅": "*",
  "∗": "*",
  "∑": "\\sum ",
  "∏": "\\prod ",
  "√": "\\sqrt ",
};

/**
 * Finds matching closing bracket/brace/paren from startIndex where str[startIndex] is an open delimiter.
 */
function findMatchingDelimiter(
  str: string,
  startIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === openChar) {
      depth++;
    } else if (str[i] === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Strips outer enclosing parens or brackets.
 */
function stripOuterParens(str: string): string {
  let s = str.trim();
  while (
    (s.startsWith("(") && s.endsWith(")")) ||
    (s.startsWith("[") && s.endsWith("]")) ||
    (s.startsWith("{") && s.endsWith("}"))
  ) {
    const closeIdx = findMatchingDelimiter(s, 0, s[0], s[0] === "(" ? ")" : s[0] === "[" ? "]" : "}");
    if (closeIdx === s.length - 1) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}

/**
 * Expands nested \frac{A}{B} and \dfrac{A}{B} into ((A)/(B)) from the innermost occurrences outward.
 */
function expandLatexFractions(latex: string): string {
  let s = latex;
  const fracRegex = /\\(?:frac|dfrac)\b/;

  while (fracRegex.test(s)) {
    // Find the last occurrence of \frac or \dfrac
    const matches = Array.from(s.matchAll(/\\(?:frac|dfrac)\b/g));
    if (matches.length === 0) break;
    const lastMatch = matches[matches.length - 1];
    const matchIdx = lastMatch.index ?? -1;
    if (matchIdx === -1) break;

    const afterKeyword = matchIdx + lastMatch[0].length;
    let ptr = afterKeyword;
    while (ptr < s.length && /\s/.test(s[ptr])) ptr++;

    // Read numerator
    let num = "";
    let numEnd = ptr;
    if (ptr < s.length && s[ptr] === "{") {
      const closeIdx = findMatchingDelimiter(s, ptr, "{", "}");
      if (closeIdx === -1) break;
      num = s.slice(ptr + 1, closeIdx);
      numEnd = closeIdx + 1;
    } else if (ptr < s.length) {
      num = s[ptr];
      numEnd = ptr + 1;
    } else {
      break;
    }

    // Read denominator
    ptr = numEnd;
    while (ptr < s.length && /\s/.test(s[ptr])) ptr++;
    let den = "";
    let denEnd = ptr;
    if (ptr < s.length && s[ptr] === "{") {
      const closeIdx = findMatchingDelimiter(s, ptr, "{", "}");
      if (closeIdx === -1) break;
      den = s.slice(ptr + 1, closeIdx);
      denEnd = closeIdx + 1;
    } else if (ptr < s.length) {
      den = s[ptr];
      denEnd = ptr + 1;
    } else {
      break;
    }

    const replacement = `((${num}) / (${den}))`;
    s = s.slice(0, matchIdx) + replacement + s.slice(denEnd);
  }

  return s;
}

/**
 * Expands \sqrt[n]{A} into ((A)^(1/(n))) and \sqrt{A} into sqrt(A).
 */
function expandLatexSquareRoots(latex: string): string {
  let s = latex;

  while (/\\sqrt\b/.test(s)) {
    const matches = Array.from(s.matchAll(/\\sqrt\b/g));
    if (matches.length === 0) break;
    const lastMatch = matches[matches.length - 1];
    const matchIdx = lastMatch.index ?? -1;
    if (matchIdx === -1) break;

    let ptr = matchIdx + lastMatch[0].length;
    while (ptr < s.length && /\s/.test(s[ptr])) ptr++;

    // Check for optional [n]
    let degree: string | null = null;
    if (ptr < s.length && s[ptr] === "[") {
      const closeBracket = findMatchingDelimiter(s, ptr, "[", "]");
      if (closeBracket !== -1) {
        degree = s.slice(ptr + 1, closeBracket).trim();
        ptr = closeBracket + 1;
        while (ptr < s.length && /\s/.test(s[ptr])) ptr++;
      }
    }

    // Read radicand argument
    let arg = "";
    let argEnd = ptr;
    if (ptr < s.length && s[ptr] === "{") {
      const closeIdx = findMatchingDelimiter(s, ptr, "{", "}");
      if (closeIdx === -1) break;
      arg = s.slice(ptr + 1, closeIdx);
      argEnd = closeIdx + 1;
    } else if (ptr < s.length) {
      arg = s[ptr];
      argEnd = ptr + 1;
    } else {
      break;
    }

    const replacement = degree
      ? `((${arg}) ^ (1 / (${degree})))`
      : `sqrt(${arg})`;
    s = s.slice(0, matchIdx) + replacement + s.slice(argEnd);
  }

  return s;
}

/**
 * Expands finite summations \sum and products \prod over a deterministic horizon H=3.
 */
function expandLatexSumAndProd(latex: string): string {
  let s = latex;

  while (/\\(?:sum|prod)(?![a-zA-Z])/.test(s)) {
    const match = s.match(/\\(sum|prod)(?![a-zA-Z])/);
    if (!match || match.index === undefined) break;

    const opType = match[1]; // "sum" or "prod"
    const matchIdx = match.index;
    let ptr = matchIdx + match[0].length;
    while (ptr < s.length && /\s/.test(s[ptr])) ptr++;

    let indexVar = "t";
    let startVal = 1;

    // Check subscript _
    if (ptr < s.length && s[ptr] === "_") {
      ptr++;
      while (ptr < s.length && /\s/.test(s[ptr])) ptr++;
      let subContent = "";
      if (s[ptr] === "{") {
        const closeIdx = findMatchingDelimiter(s, ptr, "{", "}");
        if (closeIdx !== -1) {
          subContent = s.slice(ptr + 1, closeIdx).trim();
          ptr = closeIdx + 1;
        }
      } else {
        subContent = s[ptr];
        ptr++;
      }

      if (subContent.includes("=")) {
        const parts = subContent.split("=");
        indexVar = parts[0].trim();
        const numStart = parseInt(parts[1].trim(), 10);
        if (!isNaN(numStart)) {
          startVal = numStart;
        }
      } else if (subContent.trim()) {
        indexVar = subContent.trim();
      }
    }

    while (ptr < s.length && /\s/.test(s[ptr])) ptr++;

    // Check superscript ^
    if (ptr < s.length && s[ptr] === "^") {
      ptr++;
      while (ptr < s.length && /\s/.test(s[ptr])) ptr++;
      if (s[ptr] === "{") {
        const closeIdx = findMatchingDelimiter(s, ptr, "{", "}");
        if (closeIdx !== -1) {
          ptr = closeIdx + 1;
        }
      } else {
        ptr++;
      }
    }

    while (ptr < s.length && /\s/.test(s[ptr])) ptr++;

    // Extract summand body
    let body = "";
    let bodyEnd = ptr;

    if (ptr < s.length && (s[ptr] === "(" || s[ptr] === "{" || s[ptr] === "[")) {
      const openChar = s[ptr];
      const closeChar = openChar === "(" ? ")" : openChar === "[" ? "]" : "}";
      const closeIdx = findMatchingDelimiter(s, ptr, openChar, closeChar);
      if (closeIdx !== -1) {
        bodyEnd = closeIdx + 1;
        // Also check if an exponent is attached to this group, e.g. (R_t - \bar{R})^2
        if (bodyEnd < s.length && s[bodyEnd] === "^") {
          bodyEnd++;
          if (bodyEnd < s.length && s[bodyEnd] === "{") {
            const expClose = findMatchingDelimiter(s, bodyEnd, "{", "}");
            if (expClose !== -1) bodyEnd = expClose + 1;
          } else if (bodyEnd < s.length) {
            bodyEnd++;
          }
        }
        body = s.slice(ptr, bodyEnd);
      }
    }

    if (!body) {
      // Read until next top-level +, -, =, ,, ;, or end of string
      let dParen = 0;
      let dBrace = 0;
      let dBracket = 0;
      let endIdx = ptr;
      while (endIdx < s.length) {
        const ch = s[endIdx];
        if (ch === "(") dParen++;
        else if (ch === ")") dParen--;
        else if (ch === "{") dBrace++;
        else if (ch === "}") dBrace--;
        else if (ch === "[") dBracket++;
        else if (ch === "]") dBracket--;
        else if (dParen === 0 && dBrace === 0 && dBracket === 0) {
          if (ch === "+" || ch === "-" || ch === "=" || ch === "," || ch === ";") {
            break;
          }
        }
        endIdx++;
      }
      body = s.slice(ptr, endIdx).trim();
      bodyEnd = endIdx;
    }

    // If index variable was not explicitly set, deduce from body (e.g. _t, _i, _j)
    if (indexVar === "t" && !/(_t|\bt\b)/.test(body)) {
      const varMatch = body.match(/_([a-zA-Z])/);
      if (varMatch) {
        indexVar = varMatch[1];
      }
    }

    // Expand body for values [startVal, startVal + 1, startVal + 2]
    const steps = [startVal, startVal + 1, startVal + 2];
    const expandedParts = steps.map((v) => {
      let b = body;
      // Substitute _{indexVar} -> _{v}
      b = b.replace(new RegExp(`_\\{${indexVar}\\}`, "g"), `_${v}`);
      // Substitute _indexVar -> _{v}
      b = b.replace(new RegExp(`_${indexVar}\\b`, "g"), `_${v}`);
      // Substitute ^{indexVar} -> ^{v}
      b = b.replace(new RegExp(`\\^\\{${indexVar}\\}`, "g"), `^${v}`);
      // Substitute ^indexVar -> ^{v}
      b = b.replace(new RegExp(`\\^${indexVar}\\b`, "g"), `^${v}`);
      // Substitute bare indexVar word boundary when not preceded by backslash or part of another word
      b = b.replace(new RegExp(`(?<!\\\\)\\b${indexVar}\\b`, "g"), String(v));
      return `(${b})`;
    });

    const joinOp = opType === "sum" ? " + " : " * ";
    const replacement = `(${expandedParts.join(joinOp)})`;

    s = s.slice(0, matchIdx) + replacement + s.slice(bodyEnd);
  }

  return s;
}

/**
 * Normalizes LaTeX math strings into a clean, canonical expression suitable for AST parsing.
 */
export function normalizeLatexExpression(latex: string): string {
  if (!latex || typeof latex !== "string") return "";

  let s = latex.trim();

  // Strip dollar signs
  s = s.replace(/\$/g, "");

  // Convert unicode subscripts and superscripts
  for (const [sub, repl] of Object.entries(UNICODE_SUBSCRIPTS)) {
    s = s.replaceAll(sub, repl);
  }
  for (const [sup, repl] of Object.entries(UNICODE_SUPERSCRIPTS)) {
    s = s.replaceAll(sup, repl);
  }
  for (const [sym, repl] of Object.entries(UNICODE_MATH_SYMBOLS)) {
    s = s.replaceAll(sym, repl);
  }

  // Strip LaTeX visual spacing and style commands
  s = s.replace(/\\(?:displaystyle|textstyle|quad|qquad|limits|nolimits)\b/g, " ");
  s = s.replace(/\\[,;:!]/g, " ");

  // Strip \left and \right delimiters
  s = s.replace(/\\(?:left|right)\./g, "");
  s = s.replace(/\\(?:left|right)(?=[()[\]{}|]|\b)/g, "");

  // Normalize LaTeX multiplication and division operators
  s = s.replace(/\\(?:times|cdot|ast)\b/g, "*");
  s = s.replace(/\\div\b/g, "/");

  // Expand fractions first, then sum/prod, then square roots
  s = expandLatexFractions(s);
  s = expandLatexSumAndProd(s);
  s = expandLatexSquareRoots(s);

  // Normalize font/text wrappers: \text{...}, \mathrm{...}, \mathbf{...}, \operatorname{...}
  s = s.replace(
    /\\(?:text|mathrm|mathbf|boldsymbol|textbf|mathit|operatorname)\{([^{}]*)\}/g,
    (_, inner) => {
      const slug = inner
        .trim()
        .toLowerCase()
        .replace(/[\s\-_]+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      return slug.length > 0 ? `var_${slug}` : "";
    }
  );

  // Normalize bar / hat decorators: \bar{R}, \bar R, \overline{R}, \hat{Y}
  s = s.replace(/\\(?:bar|overline)\{([^{}]+)\}/g, (_, inner) => {
    const slug = inner.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    return `var_bar_${slug}`;
  });
  s = s.replace(/\\(?:bar|overline)\s+([a-zA-Z])/g, (_, ch) => `var_bar_${ch.toLowerCase()}`);
  s = s.replace(/\\hat\{([^{}]+)\}/g, (_, inner) => {
    const slug = inner.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    return `var_hat_${slug}`;
  });
  s = s.replace(/\\hat\s+([a-zA-Z])/g, (_, ch) => `var_hat_${ch.toLowerCase()}`);

  // Normalize Greek commands
  const GREEK_NAMES = [
    "sigma",
    "beta",
    "rho",
    "alpha",
    "delta",
    "Delta",
    "pi",
    "mu",
    "tau",
    "lambda",
    "theta",
    "gamma",
    "epsilon",
  ];
  for (const g of GREEK_NAMES) {
    s = s.replace(new RegExp(`\\\\${g}\\b`, "g"), g.toLowerCase());
  }

  // Treat \sigma^2 and s^2 consistently as (sigma)^2 and (s)^2
  s = s.replace(/\bsigma\s*\^\s*\{?2\}?/g, "(sigma)^2");
  s = s.replace(/\bs\s*\^\s*\{?2\}?/g, "(s)^2");

  // Normalize standalone financial acronyms to var_<acronym> if not already normalized
  s = s.replace(
    /\b(ROE|ROA|WACC|COGS|NWC|NPV|IRR|CAPM|EBIT|EBITDA|EPS|DPS|DSO)\b/g,
    (_, acronym) => `var_${acronym.toLowerCase()}`
  );

  // Normalize subscripted variables: P_0, D_1, R_E, T_C, CF_t, \beta_E -> p_0, d_1, r_e, t_c, cf_t, beta_e
  // 1) Variables with braces: Name_{sub}
  s = s.replace(/(?<!\\)\b([a-zA-Z][a-zA-Z0-9]*)\s*_\s*\{([^{}]+)\}/g, (_, base, sub) => {
    const cleanSub = sub.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    return `${base.toLowerCase()}_${cleanSub}`;
  });
  // 2) Variables without braces: Name_sub
  s = s.replace(/(?<!\\)\b([a-zA-Z][a-zA-Z0-9]*)\s*_\s*([a-zA-Z0-9])/g, (_, base, sub) => {
    return `${base.toLowerCase()}_${sub.toLowerCase()}`;
  });

  // Lowercase isolated single Latin letters: R -> r, E -> e, V -> v, etc.
  s = s.replace(/(?<![\\a-zA-Z0-9_])([A-Z])(?![a-zA-Z0-9_])/g, (_, c) => c.toLowerCase());

  // Standardize brackets to parens
  s = s.replace(/[[{]/g, "(");
  s = s.replace(/[\]}]/g, ")");

  return s.trim();
}

type TokenType = "NUMBER" | "IDENT" | "FUNC" | "OP" | "LPAREN" | "RPAREN";

interface Token {
  type: TokenType;
  value: string;
}

const KNOWN_FUNCTIONS = new Set(["sqrt", "abs", "ln", "exp"]);

/**
 * Tokenizes a normalized LaTeX expression and inserts implicit multiplication where mathematically expected.
 */
function tokenizeLatex(normalizedStr: string): Token[] {
  const rawTokens: Token[] = [];
  let i = 0;
  const s = normalizedStr;

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number literal: integers, decimals
    if (/\d/.test(ch) || (ch === "." && i + 1 < s.length && /\d/.test(s[i + 1]))) {
      let numStr = "";
      while (i < s.length && (/[\d.]/.test(s[i]) || (s[i] === "%"))) {
        if (s[i] === "%") {
          // Percent literal: e.g. 10% -> 0.10
          i++;
          const val = parseFloat(numStr) / 100;
          numStr = String(val);
          break;
        }
        numStr += s[i];
        i++;
      }
      rawTokens.push({ type: "NUMBER", value: numStr });
      continue;
    }

    // Identifiers and function names
    if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        idStr += s[i];
        i++;
      }

      const lowerId = idStr.toLowerCase();
      if (KNOWN_FUNCTIONS.has(lowerId)) {
        rawTokens.push({ type: "FUNC", value: lowerId });
      } else {
        rawTokens.push({ type: "IDENT", value: lowerId });
      }
      continue;
    }

    // Operators and delimiters
    if (ch === "(") {
      rawTokens.push({ type: "LPAREN", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      rawTokens.push({ type: "RPAREN", value: ")" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^" || ch === "=") {
      rawTokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }

    // Ignore unsupported punctuation
    i++;
  }

  // Insert implicit multiplication:
  // Between:
  //   Left: NUMBER, IDENT, RPAREN
  //   Right: IDENT, FUNC, LPAREN, or (NUMBER when Left is RPAREN)
  const tokens: Token[] = [];
  for (let j = 0; j < rawTokens.length; j++) {
    tokens.push(rawTokens[j]);
    if (j + 1 < rawTokens.length) {
      const cur = rawTokens[j];
      const next = rawTokens[j + 1];

      const leftCanMultiply =
        cur.type === "NUMBER" || cur.type === "IDENT" || cur.type === "RPAREN";
      const rightCanMultiply =
        next.type === "IDENT" ||
        next.type === "FUNC" ||
        next.type === "LPAREN" ||
        (next.type === "NUMBER" && cur.type === "RPAREN");

      if (leftCanMultiply && rightCanMultiply) {
        tokens.push({ type: "OP", value: "*" });
      }
    }
  }

  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private consume(expectedValue?: string): Token {
    const t = this.peek();
    if (!t) {
      throw new Error("Unexpected end of expression");
    }
    if (expectedValue && t.value !== expectedValue) {
      throw new Error(`Expected '${expectedValue}' but found '${t.value}'`);
    }
    this.pos++;
    return t;
  }

  public parseEquationOrExpression(): AstNode {
    const left = this.parseExpression();
    const next = this.peek();
    if (next && next.type === "OP" && next.value === "=") {
      this.consume("=");
      const right = this.parseExpression();
      return { type: "equation", lhs: left, rhs: right };
    }
    return left;
  }

  public parseExpression(): AstNode {
    let node = this.parseTerm();
    while (true) {
      const next = this.peek();
      if (next && next.type === "OP" && (next.value === "+" || next.value === "-")) {
        this.consume();
        const right = this.parseTerm();
        node = {
          type: "binary",
          operator: next.value as "+" | "-",
          left: node,
          right,
        };
      } else {
        break;
      }
    }
    return node;
  }

  private parseTerm(): AstNode {
    let node = this.parseUnary();
    while (true) {
      const next = this.peek();
      if (next && next.type === "OP" && (next.value === "*" || next.value === "/")) {
        this.consume();
        const right = this.parseUnary();
        node = {
          type: "binary",
          operator: next.value as "*" | "/",
          left: node,
          right,
        };
      } else {
        break;
      }
    }
    return node;
  }

  private parseUnary(): AstNode {
    const next = this.peek();
    if (next && next.type === "OP" && (next.value === "+" || next.value === "-")) {
      this.consume();
      const operand = this.parseUnary();
      return {
        type: "unary",
        operator: next.value as "+" | "-",
        operand,
      };
    }
    return this.parsePower();
  }

  private parsePower(): AstNode {
    const node = this.parsePrimary();
    const next = this.peek();
    if (next && next.type === "OP" && next.value === "^") {
      this.consume("^");
      // Right-associative exponentiation: a^b^c = a^(b^c)
      const exp = this.parseUnary();
      return {
        type: "binary",
        operator: "^",
        left: node,
        right: exp,
      };
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const t = this.consume();

    if (t.type === "NUMBER") {
      const val = parseFloat(t.value);
      if (isNaN(val)) throw new Error(`Invalid number literal: ${t.value}`);
      return { type: "number", value: val };
    }

    if (t.type === "IDENT") {
      return { type: "variable", name: t.value };
    }

    if (t.type === "FUNC") {
      const funcName = t.value;
      this.consume("(");
      const arg = this.parseExpression();
      this.consume(")");
      return { type: "function", name: funcName, args: [arg] };
    }

    if (t.type === "LPAREN") {
      const expr = this.parseExpression();
      this.consume(")");
      return expr;
    }

    throw new Error(`Unexpected token '${t.value}' in expression`);
  }
}

/**
 * Parses a clean LaTeX formula or expression into an AST without using eval or new Function.
 */
export function parseLatexToAst(latex: string): AstNode {
  const norm = normalizeLatexExpression(latex);
  const tokens = tokenizeLatex(norm);
  if (tokens.length === 0) {
    return { type: "number", value: 0 };
  }
  const parser = new Parser(tokens);
  return parser.parseEquationOrExpression();
}

/**
 * Recursively extracts all free variable names from an AST node.
 */
export function extractVariablesFromAst(node: AstNode): string[] {
  const vars = new Set<string>();

  function walk(n: AstNode) {
    if (n.type === "variable") {
      vars.add(n.name);
    } else if (n.type === "unary") {
      walk(n.operand);
    } else if (n.type === "binary") {
      walk(n.left);
      walk(n.right);
    } else if (n.type === "function") {
      for (const a of n.args) walk(a);
    } else if (n.type === "equation") {
      walk(n.lhs);
      walk(n.rhs);
    }
  }

  walk(node);
  return Array.from(vars);
}

/**
 * Evaluates an AST node against a given variable assignment environment.
 * Returns null if evaluation encounters division by zero, invalid roots, or missing variables.
 */
export function evaluateAst(node: AstNode, env: Record<string, number>): number | null {
  switch (node.type) {
    case "number":
      return Number.isFinite(node.value) ? node.value : null;

    case "variable": {
      const val = env[node.name];
      return typeof val === "number" && Number.isFinite(val) ? val : null;
    }

    case "unary": {
      const opVal = evaluateAst(node.operand, env);
      if (opVal === null) return null;
      return node.operator === "-" ? -opVal : opVal;
    }

    case "binary": {
      const leftVal = evaluateAst(node.left, env);
      const rightVal = evaluateAst(node.right, env);
      if (leftVal === null || rightVal === null) return null;

      switch (node.operator) {
        case "+":
          return leftVal + rightVal;
        case "-":
          return leftVal - rightVal;
        case "*":
          return leftVal * rightVal;
        case "/":
          if (Math.abs(rightVal) < 1e-12) return null;
          return leftVal / rightVal;
        case "^": {
          if (leftVal < 0 && !Number.isInteger(rightVal)) {
            // Complex result from fractional power of negative base
            return null;
          }
          if (leftVal === 0 && rightVal <= 0) return null;
          const res = Math.pow(leftVal, rightVal);
          return Number.isFinite(res) ? res : null;
        }
      }
      return null;
    }

    case "function": {
      if (node.name === "sqrt") {
        const arg = evaluateAst(node.args[0], env);
        if (arg === null || arg < 0) return null;
        return Math.sqrt(arg);
      }
      if (node.name === "abs") {
        const arg = evaluateAst(node.args[0], env);
        if (arg === null) return null;
        return Math.abs(arg);
      }
      if (node.name === "ln") {
        const arg = evaluateAst(node.args[0], env);
        if (arg === null || arg <= 0) return null;
        return Math.log(arg);
      }
      if (node.name === "exp") {
        const arg = evaluateAst(node.args[0], env);
        if (arg === null) return null;
        const res = Math.exp(arg);
        return Number.isFinite(res) ? res : null;
      }
      return null;
    }

    case "equation": {
      const left = evaluateAst(node.lhs, env);
      const right = evaluateAst(node.rhs, env);
      if (left === null || right === null) return null;
      return left - right;
    }
  }
}

/**
 * Safely evaluates a LaTeX expression against a variable assignment environment.
 */
export function evaluateLatexExpression(
  exprLatex: string,
  env: Record<string, number>
): number | null {
  try {
    const ast = parseLatexToAst(exprLatex);
    return evaluateAst(ast, env);
  } catch {
    return null;
  }
}

/**
 * Checks whether an AST represents a single isolated variable (optionally raised to a power).
 */
function getIsolatedVariable(node: AstNode): { name: string; power: number } | null {
  if (node.type === "variable") {
    return { name: node.name, power: 1 };
  }
  if (
    node.type === "binary" &&
    node.operator === "^" &&
    node.left.type === "variable" &&
    node.right.type === "number"
  ) {
    return { name: node.left.name, power: node.right.value };
  }
  return null;
}

/**
 * Parses an equation string into separate LHS and RHS AST nodes.
 */
export function parseLatexEquation(
  latex: string
): { lhs: AstNode; rhs: AstNode; lhsRaw: string; rhsRaw: string } | null {
  const norm = normalizeLatexExpression(latex);
  if (!norm.includes("=")) return null;

  const parts = norm.split("=");
  const lhsRaw = stripOuterParens(parts[0].trim());
  const rhsRaw = stripOuterParens(parts.slice(1).join("=").trim());

  try {
    const lhsAst = parseLatexToAst(lhsRaw);
    const rhsAst = parseLatexToAst(rhsRaw);
    return { lhs: lhsAst, rhs: rhsAst, lhsRaw, rhsRaw };
  } catch {
    return null;
  }
}

/**
 * Splits chained equations or comma-separated equations into individual equation strings.
 */
function splitSubEquations(latex: string): string[] {
  // If comma-separated equations, e.g. "s^2 = \frac{1}{T-1}\sum ..., s = \sqrt{s^2}"
  if (latex.includes(",")) {
    const pieces = latex.split(",").map((p) => p.trim()).filter((p) => p.includes("="));
    if (pieces.length > 0) return pieces;
  }

  // If chained equalities, e.g. "A = B = C"
  const eqTokens = latex.split("=");
  if (eqTokens.length > 2) {
    const res: string[] = [];
    for (let i = 0; i < eqTokens.length - 1; i++) {
      res.push(`${eqTokens[i].trim()} = ${eqTokens[i + 1].trim()}`);
    }
    return res;
  }

  return [latex];
}

/**
 * Generates deterministic pseudo-random seeds for numerical equivalence testing.
 */
function generateDeterministicSeeds(
  variables: string[],
  numSeeds: number = 8
): Array<Record<string, number>> {
  const seeds: Array<Record<string, number>> = [];

  for (let sIdx = 0; sIdx < numSeeds; sIdx++) {
    const env: Record<string, number> = {};

    // Standard baseline values for financial variables
    const gVal = 0.04 + ((sIdx * 0.02) % 0.08); // 0.04 to 0.12
    const rVal = gVal + 0.08 + ((sIdx * 0.03) % 0.15); // r > g + 0.08

    const rfVal = 0.03 + ((sIdx * 0.01) % 0.04); // 0.03 to 0.07
    const rmVal = rfVal + 0.06 + ((sIdx * 0.02) % 0.10); // rm > rf + 0.06

    const tcVal = 0.21 + ((sIdx * 0.02) % 0.12); // 0.21 to 0.33

    const eVal = 2.0 + sIdx * 0.5;
    const dVal = 1.0 + ((sIdx * 0.8) % 2.5);
    const vVal = eVal + dVal;

    // Returns for variance / mean tests
    const r1 = 0.12 + ((sIdx * 0.04) % 0.15);
    const r2 = 0.18 + ((sIdx * 0.06) % 0.18);
    const r3 = 0.06 + ((sIdx * 0.03) % 0.12);
    const barR = (r1 + r2 + r3) / 3;

    for (let vIdx = 0; vIdx < variables.length; vIdx++) {
      const v = variables[vIdx];

      if (v === "g") {
        env[v] = gVal;
      } else if (v === "r") {
        env[v] = rVal;
      } else if (v === "r_f") {
        env[v] = rfVal;
      } else if (v === "r_m") {
        env[v] = rmVal;
      } else if (v === "t_c") {
        env[v] = tcVal;
      } else if (v === "e") {
        env[v] = eVal;
      } else if (v === "d") {
        env[v] = dVal;
      } else if (v === "v") {
        env[v] = vVal;
      } else if (v === "t" || v === "n") {
        env[v] = 3; // Deterministic finite horizon T=3, N=3
      } else if (v === "r_1") {
        env[v] = r1;
      } else if (v === "r_2") {
        env[v] = r2;
      } else if (v === "r_3") {
        env[v] = r3;
      } else if (v === "var_bar_r") {
        env[v] = barR;
      } else {
        // Deterministic positive non-degenerate value in [0.5, 4.5]
        const pseudo = 0.7 + ((vIdx * 1.37 + sIdx * 0.91) % 3.6);
        env[v] = Math.round(pseudo * 1000) / 1000;
      }
    }

    seeds.push(env);
  }

  return seeds;
}

/**
 * Checks mathematical equivalence between a source formula and candidate formula.
 */
export function checkFormulaEquivalence(
  sourceLatex: string,
  candidateLatex: string,
  options?: EquivalenceCheckOptions
): EquivalenceCheckResult {
  const tolerance = options?.tolerance ?? 1e-4;
  const numSeeds = options?.numSeeds ?? 8;

  // 1. Fast path: normalized inventory formula key exact match
  const normSourceKey = normalizeInventoryFormulaKey(sourceLatex);
  const normCandidateKey = normalizeInventoryFormulaKey(candidateLatex);
  if (normSourceKey && normCandidateKey && normSourceKey === normCandidateKey) {
    return {
      equivalent: true,
      isRearrangement: false,
      contradicts: false,
      evaluable: true,
      matchedSeeds: numSeeds,
      totalSeeds: numSeeds,
    };
  }

  // 2. Chained / comma equation handling
  const sourceSubEqs = splitSubEquations(sourceLatex);
  const candidateSubEqs = splitSubEquations(candidateLatex);

  if (sourceSubEqs.length > 1 || candidateSubEqs.length > 1) {
    let bestResult: EquivalenceCheckResult | null = null;
    for (const sEq of sourceSubEqs) {
      for (const cEq of candidateSubEqs) {
        const res = checkSingleEquationEquivalence(sEq, cEq, tolerance, numSeeds);
        if (res.equivalent) return res;
        if (res.contradicts) bestResult = res;
        else if (!bestResult) bestResult = res;
      }
    }
    return (
      bestResult || {
        equivalent: false,
        isRearrangement: false,
        contradicts: false,
        evaluable: false,
        matchedSeeds: 0,
        totalSeeds: 0,
      }
    );
  }

  return checkSingleEquationEquivalence(
    sourceLatex,
    candidateLatex,
    tolerance,
    numSeeds
  );
}

/**
 * Evaluates single equation equivalence between source and candidate equations.
 */
function checkSingleEquationEquivalence(
  sourceLatex: string,
  candidateLatex: string,
  tolerance: number,
  numSeeds: number
): EquivalenceCheckResult {
  const eq1 = parseLatexEquation(sourceLatex);
  const eq2 = parseLatexEquation(candidateLatex);

  // If either side is not an equation with '='
  if (!eq1 || !eq2) {
    try {
      const ast1 = parseLatexToAst(sourceLatex);
      const ast2 = parseLatexToAst(candidateLatex);
      const vars1 = extractVariablesFromAst(ast1);
      const vars2 = extractVariablesFromAst(ast2);
      const allVars = Array.from(new Set([...vars1, ...vars2]));
      const seeds = generateDeterministicSeeds(allVars, numSeeds);

      let matched = 0;
      let valid = 0;

      for (const s of seeds) {
        const v1 = evaluateAst(ast1, s);
        const v2 = evaluateAst(ast2, s);
        if (v1 === null || v2 === null) continue;
        valid++;
        const diff = Math.abs(v1 - v2);
        const maxVal = Math.max(1, Math.abs(v1), Math.abs(v2));
        if (diff <= tolerance * maxVal) {
          matched++;
        }
      }

      const evaluable = valid >= 3;
      const equivalent = evaluable && matched === valid;
      return {
        equivalent,
        isRearrangement: false,
        contradicts: evaluable && matched === 0 && vars1.length > 0 && vars2.length > 0,
        evaluable,
        matchedSeeds: matched,
        totalSeeds: valid,
      };
    } catch {
      return {
        equivalent: false,
        isRearrangement: false,
        contradicts: false,
        evaluable: false,
        matchedSeeds: 0,
        totalSeeds: 0,
      };
    }
  }

  const vars1 = extractVariablesFromAst({ type: "equation", lhs: eq1.lhs, rhs: eq1.rhs });
  const vars2 = extractVariablesFromAst({ type: "equation", lhs: eq2.lhs, rhs: eq2.rhs });
  const allVars = Array.from(new Set([...vars1, ...vars2]));

  // Check variable overlap
  const sharedVars = vars1.filter((v) => vars2.includes(v));
  if (sharedVars.length === 0 && (vars1.length > 0 || vars2.length > 0)) {
    return {
      equivalent: false,
      isRearrangement: false,
      contradicts: false,
      evaluable: false,
      matchedSeeds: 0,
      totalSeeds: 0,
      reason: "Formulas use disjoint or non-overlapping variable sets.",
    };
  }

  const isoLhs1 = getIsolatedVariable(eq1.lhs);
  const isoRhs1 = getIsolatedVariable(eq1.rhs);
  const isoLhs2 = getIsolatedVariable(eq2.lhs);
  const isoRhs2 = getIsolatedVariable(eq2.rhs);

  const seeds = generateDeterministicSeeds(allVars, numSeeds);

  let matchedSeeds = 0;
  let validSeeds = 0;

  // Try Forward Verification: Satisfy Equation 1, then evaluate Equation 2
  const canSolveEq1 =
    (isoLhs1 && !extractVariablesFromAst(eq1.rhs).includes(isoLhs1.name)) ||
    (isoRhs1 && !extractVariablesFromAst(eq1.lhs).includes(isoRhs1.name));

  const canSolveEq2 =
    (isoLhs2 && !extractVariablesFromAst(eq2.rhs).includes(isoLhs2.name)) ||
    (isoRhs2 && !extractVariablesFromAst(eq2.lhs).includes(isoRhs2.name));

  for (const rawSeed of seeds) {
    const seed = { ...rawSeed };

    let solved = false;

    // Satisfy Equation 1 if solvable
    if (canSolveEq1) {
      if (isoLhs1 && !extractVariablesFromAst(eq1.rhs).includes(isoLhs1.name)) {
        const rhsVal = evaluateAst(eq1.rhs, seed);
        if (rhsVal !== null && rhsVal > 0) {
          const varVal = Math.pow(rhsVal, 1 / isoLhs1.power);
          if (Number.isFinite(varVal)) {
            seed[isoLhs1.name] = varVal;
            solved = true;
          }
        }
      } else if (isoRhs1 && !extractVariablesFromAst(eq1.lhs).includes(isoRhs1.name)) {
        const lhsVal = evaluateAst(eq1.lhs, seed);
        if (lhsVal !== null && lhsVal > 0) {
          const varVal = Math.pow(lhsVal, 1 / isoRhs1.power);
          if (Number.isFinite(varVal)) {
            seed[isoRhs1.name] = varVal;
            solved = true;
          }
        }
      }
    } else if (canSolveEq2) {
      // Symmetric check: Satisfy Equation 2, then check if Equation 1 holds
      if (isoLhs2 && !extractVariablesFromAst(eq2.rhs).includes(isoLhs2.name)) {
        const rhsVal = evaluateAst(eq2.rhs, seed);
        if (rhsVal !== null && rhsVal > 0) {
          const varVal = Math.pow(rhsVal, 1 / isoLhs2.power);
          if (Number.isFinite(varVal)) {
            seed[isoLhs2.name] = varVal;
            solved = true;
          }
        }
      } else if (isoRhs2 && !extractVariablesFromAst(eq2.lhs).includes(isoRhs2.name)) {
        const lhsVal = evaluateAst(eq2.lhs, seed);
        if (lhsVal !== null && lhsVal > 0) {
          const varVal = Math.pow(lhsVal, 1 / isoRhs2.power);
          if (Number.isFinite(varVal)) {
            seed[isoRhs2.name] = varVal;
            solved = true;
          }
        }
      }
    }

    if (!solved) {
      // Neither equation has an isolated variable: check proportionality of residuals
      const res1 = evaluateAst(eq1.lhs, seed)! - evaluateAst(eq1.rhs, seed)!;
      const res2 = evaluateAst(eq2.lhs, seed)! - evaluateAst(eq2.rhs, seed)!;
      if (Number.isFinite(res1) && Number.isFinite(res2)) {
        validSeeds++;
        if (Math.abs(res1 - res2) <= tolerance * Math.max(1, Math.abs(res1), Math.abs(res2))) {
          matchedSeeds++;
        }
      }
      continue;
    }

    // When Equation 1 is satisfied under `seed`, test Equation 2
    if (canSolveEq1) {
      const lhsVal2 = evaluateAst(eq2.lhs, seed);
      const rhsVal2 = evaluateAst(eq2.rhs, seed);

      if (lhsVal2 === null || rhsVal2 === null) continue;
      validSeeds++;

      const diff = Math.abs(lhsVal2 - rhsVal2);
      const scale = Math.max(1, Math.abs(lhsVal2), Math.abs(rhsVal2));
      if (diff <= tolerance * scale) {
        matchedSeeds++;
      }
    } else {
      // Symmetric case: Equation 2 was satisfied, test Equation 1
      const lhsVal1 = evaluateAst(eq1.lhs, seed);
      const rhsVal1 = evaluateAst(eq1.rhs, seed);

      if (lhsVal1 === null || rhsVal1 === null) continue;
      validSeeds++;

      const diff = Math.abs(lhsVal1 - rhsVal1);
      const scale = Math.max(1, Math.abs(lhsVal1), Math.abs(rhsVal1));
      if (diff <= tolerance * scale) {
        matchedSeeds++;
      }
    }
  }

  const evaluable = validSeeds >= 3;
  const equivalent = evaluable && matchedSeeds === validSeeds;

  // Check if rearrangement:
  // Rearrangement occurs when equations are equivalent and LHS variables differ or powers differ
  const lhsName1 = isoLhs1 ? isoLhs1.name : "";
  const lhsName2 = isoLhs2 ? isoLhs2.name : "";
  const lhsPower1 = isoLhs1 ? isoLhs1.power : 1;
  const lhsPower2 = isoLhs2 ? isoLhs2.power : 1;
  const isRearrangement =
    equivalent && (lhsName1 !== lhsName2 || lhsPower1 !== lhsPower2);

  // Contradiction detection:
  // Both equations are evaluable on >= 3 seeds, share core variables (or identical LHS variable), and matchedSeeds === 0
  const isSameLhs = lhsName1 && lhsName2 && lhsName1 === lhsName2;
  const isCoreOverlap =
    sharedVars.length >= Math.min(vars1.length, vars2.length) * 0.75 || isSameLhs;

  let contradicts = false;
  let reason: string | undefined;

  if (evaluable && matchedSeeds === 0 && isCoreOverlap) {
    contradicts = true;
    reason =
      "Formula contradicts source equation on identical/overlapping variable set (e.g. sign flip, altered operator, or invalid term).";
  } else if (!equivalent) {
    reason = `Numeric equivalence failed: matched ${matchedSeeds} of ${validSeeds} seeds.`;
  }

  return {
    equivalent,
    isRearrangement,
    contradicts,
    evaluable,
    matchedSeeds,
    totalSeeds: validSeeds,
    reason: equivalent ? undefined : reason,
  };
}

/**
 * Extracts the single isolated LHS variable name if present.
 */
function getLhsVariableName(latex: string): string | null {
  try {
    const eq = parseLatexEquation(latex);
    if (!eq) return null;
    const isolated = getIsolatedVariable(eq.lhs);
    return isolated ? isolated.name : null;
  } catch {
    return null;
  }
}

/**
 * Iterates over every formula in sections and subSections, resolves parent ledger entries,
 * and runs numeric equivalence verification against the parent formula ledger.
 */
export function verifyNoteFormulasEquivalence(
  sections: NoteSection[],
  ledger: FormulaLedgerEntry[],
  options?: EquivalenceCheckOptions
): NoteFormulasEquivalenceReport {
  const formulaResults: Array<{
    formula: NoteFormula;
    parentLedgerEntries: FormulaLedgerEntry[];
    result: EquivalenceCheckResult;
  }> = [];

  let directVerifiedCount = 0;
  let derivedVerifiedCount = 0;
  let contradictedFormulas = 0;
  let unverifiedFormulas = 0;

  const allFormulas: NoteFormula[] = [];
  for (const sec of sections) {
    for (const f of sec.formulas || []) {
      allFormulas.push(f);
    }
    for (const sub of sec.subSections || []) {
      for (const f of sub.formulas || []) {
        allFormulas.push(f);
      }
    }
  }

  const ledgerById = new Map<string, FormulaLedgerEntry>();
  for (const entry of ledger) {
    ledgerById.set(entry.id, entry);
  }

  for (const f of allFormulas) {
    const parentEntries: FormulaLedgerEntry[] = [];

    // 1. Resolve via formulaRefs
    if (f.formulaRefs && f.formulaRefs.length > 0) {
      for (const ref of f.formulaRefs) {
        const found = ledgerById.get(ref);
        if (found && !parentEntries.includes(found)) {
          parentEntries.push(found);
        }
      }
    }

    // 2. Resolve via derivedFrom
    if (f.derivedFrom && f.derivedFrom.length > 0) {
      for (const ref of f.derivedFrom) {
        const found = ledgerById.get(ref);
        if (found && !parentEntries.includes(found)) {
          parentEntries.push(found);
        }
      }
    }

    // 3. Fallback matching if none explicitly referenced
    if (parentEntries.length === 0) {
      // 3a. Same-slide match
      if (f.slide) {
        const sameSlide = ledger.filter((e) => e.slide === f.slide);
        if (sameSlide.length > 0) {
          for (const cand of sameSlide) {
            parentEntries.push(cand);
          }
        }
      }

      // 3b. Exact normalized key match across entire ledger
      if (parentEntries.length === 0) {
        const keyMatch = ledger.filter(
          (e) => normalizeInventoryFormulaKey(e.latex) === normalizeInventoryFormulaKey(f.latex)
        );
        if (keyMatch.length > 0) {
          parentEntries.push(...keyMatch);
        }
      }

      // 3c. Same LHS variable match across ledger
      if (parentEntries.length === 0) {
        const fLhs = getLhsVariableName(f.latex);
        if (fLhs) {
          const lhsMatches = ledger.filter(
            (e) => getLhsVariableName(e.latex) === fLhs
          );
          if (lhsMatches.length > 0) {
            parentEntries.push(...lhsMatches);
          }
        }
      }
    }

    if (parentEntries.length === 0) {
      const unverifiedRes: EquivalenceCheckResult = {
        equivalent: false,
        isRearrangement: false,
        contradicts: false,
        evaluable: false,
        matchedSeeds: 0,
        totalSeeds: 0,
        reason: "No matching parent ledger entry found in formulaLedger",
      };
      f.numericEquivalencePassed = false;
      unverifiedFormulas++;
      formulaResults.push({
        formula: f,
        parentLedgerEntries: [],
        result: unverifiedRes,
      });
      continue;
    }

    // Check equivalence against all resolved parent entries
    let bestResult: EquivalenceCheckResult | null = null;

    for (const parent of parentEntries) {
      const res = checkFormulaEquivalence(parent.latex, f.latex, options);
      if (res.equivalent) {
        bestResult = res;
        break; // Match found
      }
      if (res.contradicts) {
        bestResult = res; // Flag contradiction
      } else if (!bestResult) {
        bestResult = res;
      }
    }

    const finalRes = bestResult || {
      equivalent: false,
      isRearrangement: false,
      contradicts: false,
      evaluable: false,
      matchedSeeds: 0,
      totalSeeds: 0,
      reason: "Could not evaluate equivalence against parent ledger entries",
    };

    f.numericEquivalencePassed = finalRes.equivalent;
    if (finalRes.contradicts) {
      f.status = "contradicted";
      f.reviewReason = finalRes.reason;
      contradictedFormulas++;
    } else if (finalRes.equivalent) {
      if (finalRes.isRearrangement) {
        f.status = "derived";
        derivedVerifiedCount++;
      } else {
        f.status = "verified";
        directVerifiedCount++;
      }
    } else {
      unverifiedFormulas++;
    }

    formulaResults.push({
      formula: f,
      parentLedgerEntries: parentEntries,
      result: finalRes,
    });
  }

  const allPassed = contradictedFormulas === 0 && unverifiedFormulas === 0;

  return {
    allPassed,
    contradictedFormulas,
    derivedVerifiedCount,
    directVerifiedCount,
    unverifiedFormulas,
    formulaResults,
  };
}
