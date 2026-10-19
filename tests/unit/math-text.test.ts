import { describe, expect, it } from "vitest";
import {
  normalizeMathFormulas,
  tokenizeMath,
  renderKatexSafe,
  isLikelyInlineMath,
  splitMathBlocks,
  repairCorruptedLatex,
} from "@/lib/math/latex";

describe("currency and prose protection", () => {
  it("preserves currency dollar signs without breaking into math", () => {
    const text =
      "The $5,000 already spent is sunk. Launching adds $3,000 in revenue at $2,000 in extra cost, yielding an incremental gain of $1,000.";
    const tokens = tokenizeMath(text);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("text");
    expect(tokens[0].value).toBe(text);
  });

  it("preserves study job dollar figures", () => {
    const text =
      "Spending two hours studying instead of working a $30 tutoring job carries an opportunity cost of $30.";
    const tokens = tokenizeMath(text);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("text");
    expect(tokens[0].value).toBe(text);
  });

  it("correctly identifies genuine inline math vs currency", () => {
    expect(isLikelyInlineMath("5,000 already spent is sunk")).toBe(false);
    expect(isLikelyInlineMath("30 tutoring job")).toBe(false);
    expect(isLikelyInlineMath("|E_d| > 1")).toBe(true);
    expect(isLikelyInlineMath("E = hf")).toBe(true);
    expect(isLikelyInlineMath("Q_d > Q_s")).toBe(true);
    expect(isLikelyInlineMath("x")).toBe(true);
  });
});

describe("normalizeMathFormulas", () => {
  it("converts raw cross-price elasticity into LaTeX fraction and KaTeX format", () => {
    const raw = "Exy = %ΔQx ÷ %ΔPy. Positive = substitutes; negative = complements.";
    const normalized = normalizeMathFormulas(raw);

    expect(normalized).toContain("$$E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}$$");
    expect(normalized).toContain("Positive = substitutes; negative = complements.");
  });

  it("handles slash division and complement singular phrasing", () => {
    const raw = "Exy = %ΔQx / %ΔPy. Positive = substitutes; negative = complement";
    const normalized = normalizeMathFormulas(raw);

    expect(normalized).toContain("$$E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}$$");
    expect(normalized).toContain("Positive = substitutes; negative = complement");
  });

  it("converts price elasticity formula into absolute value fraction", () => {
    const raw = "|Ed| = |%Δ quantity demanded ÷ %Δ price|. Elastic when |Ed| > 1.";
    const normalized = normalizeMathFormulas(raw);

    expect(normalized).toContain("$$|E_d| = \\left|\\frac{\\%\\Delta Q_d}{\\%\\Delta P}\\right|$$");
    expect(normalized).toContain("$|E_d| > 1$");
  });

  it("converts ASCII bond calculation steps with exponents and fractions into LaTeX", () => {
    const raw =
      "PV of coupons = 50 * [(1-(1+0.05)^-3)/0.05] ≈ $136.16; PV of face = 1000/(1.05)^3 ≈ $863.84; total ≈ $1,000, equal to par.";
    const normalized = normalizeMathFormulas(raw);

    expect(normalized).toContain("\\frac{1-(1+0.05)^{-3}}{0.05}");
    expect(normalized).toContain("\\frac{1000}{(1.05)^{3}}");
    expect(normalized).toContain("\\approx");
    expect(normalized).toContain("\\text{\\$}136.16");
    expect(normalized).toContain("equal to par");

    const tokens = tokenizeMath(normalized);
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.some((t) => t.type === "inline-math")).toBe(true);
  });

  it("converts standalone formula rule like PB = PV(coupons) + PV(face) into display math", () => {
    const raw = "PB = PV(coupons) + PV(face)";
    const normalized = normalizeMathFormulas(raw);

    expect(normalized).toBe("$$PB = PV(\\text{coupons}) + PV(\\text{face})$$");
    const tokens = tokenizeMath(normalized);
    expect(tokens[0].type).toBe("display-math");
    expect(tokens[0].value).toBe("PB = PV(\\text{coupons}) + PV(\\text{face})");
  });

  it("preserves already formatted LaTeX formulas intact", () => {
    const latex = "$$E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}$$\nPositive = substitutes; negative = complements.";
    const normalized = normalizeMathFormulas(latex);

    expect(normalized).toBe(latex);
  });
});

describe("tokenizeMath", () => {
  it("splits text and display math accurately", () => {
    const input = "$$E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}$$\nPositive = substitutes";
    const tokens = tokenizeMath(input);

    expect(tokens).toHaveLength(2);
    expect(tokens[0].type).toBe("display-math");
    expect(tokens[0].value.trim()).toBe("E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}");
    expect(tokens[1].type).toBe("text");
    expect(tokens[1].value).toContain("Positive = substitutes");
  });

  it("safely generates valid KaTeX HTML", () => {
    const html = renderKatexSafe("E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}", true);
    expect(html).toContain("katex");
    expect(html).toContain("math");
  });
});

describe("splitMathBlocks & multiline LaTeX handling", () => {
  it("extracts multiline display math surrounded by \\[ and \\]", () => {
    const input = `The price elasticity formula is:

\\[
|E_d|=\\left|\\frac{\\%\\Delta Q_d}{\\%\\Delta P}\\right|
\\]

Where:
- %ΔQ_d is percentage change in quantity demanded.`;

    const blocks = splitMathBlocks(input);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("text");
    if (blocks[0].type === "text") {
      expect(blocks[0].text).toContain("The price elasticity formula is:");
    }

    expect(blocks[1].type).toBe("math-display");
    if (blocks[1].type === "math-display") {
      expect(blocks[1].math).toBe("|E_d|=\\left|\\frac{\\%\\Delta Q_d}{\\%\\Delta P}\\right|");
    }

    expect(blocks[2].type).toBe("text");
    if (blocks[2].type === "text") {
      expect(blocks[2].text).toContain("Where:");
    }
  });

  it("handles $$ ... $$ blocks across multiple newlines", () => {
    const input = `Formula:\n\n$$\nE = mc^2\n$$\n\nEnd.`;
    const blocks = splitMathBlocks(input);

    expect(blocks).toHaveLength(3);
    expect(blocks[1].type).toBe("math-display");
    if (blocks[1].type === "math-display") {
      expect(blocks[1].math).toBe("E = mc^2");
    }
  });

  it("safely renders KaTeX for elasticity formula with escaped percent and Delta", () => {
    const tex = "|E_d|=\\left|\\frac{\\%\\Delta Q_d}{\\%\\Delta P}\\right|";
    const html = renderKatexSafe(tex, true);

    expect(html).toContain("katex-display");
    expect(html).not.toContain("katex-fallback");
  });

  it("sanitizes unescaped percent signs and unicode delta", () => {
    const rawTex = "|E_d|=\\left|\\frac{%ΔQ_d}{%ΔP}\\right|";
    const html = renderKatexSafe(rawTex, true);

    expect(html).toContain("katex-display");
    expect(html).not.toContain("katex-fallback");
  });
});

describe("LaTeX escape repair and CAPM formula rendering", () => {
  it("repairs corrupted beta and times from ASCII control characters", () => {
    const corruptedWithControlChars = "r = r_f + \x08eta \x09imes (E[R_{Mkt}] - r_f)";
    const repaired = repairCorruptedLatex(corruptedWithControlChars);

    expect(repaired).toContain("\\beta");
    expect(repaired).toContain("\\times");
    expect(repaired).not.toContain("\x08");
    expect(repaired).not.toContain("\x09");
  });

  it("repairs corrupted beta and times with whitespace collapse (as seen in LLM JSON output)", () => {
    const corruptedRule = "$r = r_f +  eta imes (E[R_{Mkt}] - r_f)$";
    const repaired = repairCorruptedLatex(corruptedRule);

    expect(repaired).toBe("$r = r_f + \\beta \\times (E[R_{Mkt}] - r_f)$");
  });

  it("moves trailing sentence punctuation outside inline math delimiters", () => {
    const textWithTrailingPeriod =
      "Calculated as $r = r_f +  eta imes (E[R_{Mkt}] - r_f) = 3% + 1.29 imes (8% - 3%) = 9.45%.$";
    const repaired = repairCorruptedLatex(textWithTrailingPeriod);

    expect(repaired).toContain("= 9.45%$.");
    expect(repaired).toContain("\\beta");
    expect(repaired).toContain("\\times");
  });

  it("tokenizes and renders the exact user formula into KaTeX inline math", () => {
    const rawRule = "$r = r_f +  eta imes (E[R_{Mkt}] - r_f)$";
    const tokens = tokenizeMath(rawRule);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("inline-math");
    expect(tokens[0].value).toContain("\\beta");
    expect(tokens[0].value).toContain("\\times");

    const html = renderKatexSafe(tokens[0].value, false);
    expect(html).toContain("katex");
    expect(html).not.toContain("katex-fallback");
    expect(html).toContain("β"); // Greek beta
  });

  it("tokenizes and renders the exact user explanation into text and KaTeX math", () => {
    const rawExplanation =
      "Calculated as $r = r_f +  eta imes (E[R_{Mkt}] - r_f) = 3% + 1.29 imes (8% - 3%) = 9.45%.$";
    const normalized = normalizeMathFormulas(rawExplanation);
    const tokens = tokenizeMath(normalized);

    expect(tokens.length).toBeGreaterThanOrEqual(2);
    const mathToken = tokens.find((t) => t.type === "inline-math");
    expect(mathToken).toBeDefined();
    expect(mathToken?.value).toContain("\\beta");
    expect(mathToken?.value).toContain("\\times");

    const html = renderKatexSafe(mathToken!.value, false);
    expect(html).toContain("katex");
    expect(html).not.toContain("katex-fallback");
  });

  it("recognizes long equations without backslashes as valid inline math", () => {
    const formula = "r = r_f + beta * (Rm - r_f) = 3% + 1.29 * (8% - 3%) = 9.45%";
    expect(isLikelyInlineMath(formula)).toBe(true);
  });
});

