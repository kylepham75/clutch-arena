import { describe, expect, it } from "vitest";
import {
  normalizeMathFormulas,
  tokenizeMath,
  renderKatexSafe,
  isLikelyInlineMath,
  splitMathBlocks,
  repairCorruptedLatex,
  ensureInlineMathDelimiters,
  cleanVietnameseSigmaTypos,
  cleanTypoString,
  formatAccountingFormula,
  wrapBareEnglishInLatex,
} from "@/lib/math/latex";
import { formatTextWithMath } from "@/lib/notes/export-pdf";

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

describe("ensureInlineMathDelimiters & raw LaTeX leakage prevention", () => {
  it("wraps un-delimited Greek variables and formula equations in $...$", () => {
    const text = "Portfolio risk is calculated as \\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B).";
    const wrapped = ensureInlineMathDelimiters(text);
    expect(wrapped).toContain("$\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B)$.");
    expect(wrapped.endsWith("$.")).toBe(true);
  });

  it("wraps single Greek letters and statistical terms in running text", () => {
    const text = "where \\beta_i represents systematic risk, \\rho_{AB} is correlation, and \\mu is expected return.";
    const wrapped = ensureInlineMathDelimiters(text);
    expect(wrapped).toContain("$\\beta_i$");
    expect(wrapped).toContain("$\\rho_{AB}$");
    expect(wrapped).toContain("$\\mu$");
    expect(wrapped).toContain("and $\\mu$ is expected return.");
  });

  it("handles fractions and square roots without delimiters", () => {
    const text = "The Sharpe ratio is \\frac{E[R_p] - R_f}{\\sigma_p} while standard deviation is \\sqrt{\\sigma^2}.";
    const wrapped = ensureInlineMathDelimiters(text);
    expect(wrapped).toContain("$\\frac{E[R_p] - R_f}{\\sigma_p}$");
    expect(wrapped).toContain("$\\sqrt{\\sigma^2}$.");
  });

  it("preserves already delimited math ($...$, $$...$$, \\[...\\])", () => {
    const text = "Here is an equation: $\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}$ and display $$E[R_p]$$.";
    const wrapped = ensureInlineMathDelimiters(text);
    expect(wrapped).toBe(text);
  });

  it("does not wrap currency symbols into math", () => {
    const text = "The investment requires $5,000 initially and returns $30 daily.";
    const wrapped = ensureInlineMathDelimiters(text);
    expect(wrapped).toBe(text);
  });
});

describe("tokenizeMath whitespace and delimiter handling", () => {
  it("normalizes whitespace inside inline math delimiters", () => {
    const input1 = "Risk is $ \\sigma_p $.";
    const tokens1 = tokenizeMath(input1);
    const mathToken1 = tokens1.find((t) => t.type === "inline-math");
    expect(mathToken1).toBeDefined();
    expect(mathToken1?.value).toBe("\\sigma_p");

    const input2 = "Risk is $\\sigma_p $.";
    const tokens2 = tokenizeMath(input2);
    const mathToken2 = tokens2.find((t) => t.type === "inline-math");
    expect(mathToken2).toBeDefined();
    expect(mathToken2?.value).toBe("\\sigma_p");

    const input3 = "Risk is $ \\sigma_p$.";
    const tokens3 = tokenizeMath(input3);
    const mathToken3 = tokens3.find((t) => t.type === "inline-math");
    expect(mathToken3).toBeDefined();
    expect(mathToken3?.value).toBe("\\sigma_p");
  });
});

describe("repairCorruptedLatex for financial statistics symbols", () => {
  it("repairs Greek symbols, operators, and functions corrupted by ASCII or escaped backslashes", () => {
    const corrupted = "\\\\sigma_p^2 + \\\\rho_{AB} + \\\\beta_i + \\\\sum P_i + \\\\text{Cov} + \\\\sqrt{\\\\sigma^2} + \\\\bar{R}";
    const repaired = repairCorruptedLatex(corrupted);
    expect(repaired).toContain("\\sigma_p^2");
    expect(repaired).toContain("\\rho_{AB}");
    expect(repaired).toContain("\\beta_i");
    expect(repaired).toContain("\\sum P_i");
    expect(repaired).toContain("\\text{Cov}");
    expect(repaired).toContain("\\sqrt{\\sigma^2}");
    expect(repaired).toContain("\\bar{R}");
    expect(repaired).not.toContain("\\\\");
  });
});

describe("Zero-leakage multi-discipline bare equation detection", () => {
  it("wraps financial valuation equations in $...$ with punctuation outside", () => {
    const text1 = "Net present value is calculated as NPV = \\sum_{t=1}^n \\frac{CF_t}{(1+r)^t} - CF_0.";
    const res1 = ensureInlineMathDelimiters(text1);
    expect(res1).toContain("$NPV = \\sum_{t=1}^n \\frac{CF_t}{(1+r)^t} - CF_0$.");
    expect(res1.endsWith("$NPV = \\sum_{t=1}^n \\frac{CF_t}{(1+r)^t} - CF_0$.")).toBe(true);

    const text2 = "Gordon growth model gives P_0 = \\frac{D_1}{r - g} where r > g.";
    const res2 = ensureInlineMathDelimiters(text2);
    expect(res2).toContain("$P_0 = \\frac{D_1}{r - g}$");

    const text3 = "Weighted cost of capital is WACC = w_D R_D (1 - T_C) + w_E R_E.";
    const res3 = ensureInlineMathDelimiters(text3);
    expect(res3).toContain("$WACC = w_D R_D (1 - T_C) + w_E R_E$.");

    const text4 = "Return on equity equals ROE = \\frac{\\text{Net Income}}{\\text{Equity}}.";
    const res4 = ensureInlineMathDelimiters(text4);
    expect(res4).toContain("$ROE = \\frac{\\text{Net Income}}{\\text{Equity}}$.");
  });

  it("wraps economics equations and equilibrium relations", () => {
    const text1 = "Asset weights must satisfy w_A + w_B = 1.";
    const res1 = ensureInlineMathDelimiters(text1);
    expect(res1).toContain("$w_A + w_B = 1$.");

    const text2 = "Linear demand is Q_d = a - b P where b is price sensitivity.";
    const res2 = ensureInlineMathDelimiters(text2);
    expect(res2).toContain("$Q_d = a - b P$");
  });

  it("wraps statistics and econometrics variance equations", () => {
    const text1 = "Sample variance formula is s^2 = \\frac{1}{T-1} \\sum_{t=1}^T (R_t - \\bar{R})^2 for returns.";
    const res1 = ensureInlineMathDelimiters(text1);
    expect(res1).toContain("$s^2 = \\frac{1}{T-1} \\sum_{t=1}^T (R_t - \\bar{R})^2$");

    const text2 = "Expected return is E[R] = \\sum_{i=1}^n P_i R_i.";
    const res2 = ensureInlineMathDelimiters(text2);
    expect(res2).toContain("$E[R] = \\sum_{i=1}^n P_i R_i$.");
  });
});

describe("Subscript variables in prose protection", () => {
  it("wraps standalone finance and economics subscript variables without swallowing punctuation", () => {
    const text = "Key parameters include P_0, D_1, R_f, R_M, R_E, R_D, R_P, and CF_t.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("$P_0$,");
    expect(res).toContain("$D_1$,");
    expect(res).toContain("$R_f$,");
    expect(res).toContain("$R_M$,");
    expect(res).toContain("$R_E$,");
    expect(res).toContain("$R_D$,");
    expect(res).toContain("$R_P$,");
    expect(res).toContain("$CF_t$.");
  });

  it("wraps complex subscripts and market variables in prose", () => {
    const text = "We track w_A, w_B, T_C, P_t, P_{t+1}, D_{t+1}, Q_d, and Q_s.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("$w_A$,");
    expect(res).toContain("$w_B$,");
    expect(res).toContain("$T_C$,");
    expect(res).toContain("$P_t$,");
    expect(res).toContain("$P_{t+1}$,");
    expect(res).toContain("$D_{t+1}$,");
    expect(res).toContain("$Q_d$,");
    expect(res).toContain("$Q_s$.");
  });
});

describe("Greek symbols and mathematical operators zero-leakage", () => {
  it("wraps Greek letters with sub/superscripts and Delta variables", () => {
    const text = "Portfolio variance \\sigma_p^2 depends on beta \\beta_i, correlation \\rho_{AB}, and change \\Delta P.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("$\\sigma_p^2$");
    expect(res).toContain("$\\beta_i$,");
    expect(res).toContain("$\\rho_{AB}$,");
    expect(res).toContain("$\\Delta P$.");
  });

  it("wraps math macros, integrals, derivatives, and accents", () => {
    const text = "Evaluating \\int_0^1 f(x) dx with \\hat{y}, \\bar{R}, \\tilde{x}, \\vec{v}, and \\mathbf{X}.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("\\int_0^1 f(x) dx");
    expect(res).toContain("$\\hat{y}$");
    expect(res).toContain("$\\bar{R}$");
    expect(res).toContain("$\\tilde{x}$");
    expect(res).toContain("$\\vec{v}$");
    expect(res).toContain("$\\mathbf{X}$");
  });

  it("wraps quantitative financial functions and exponent variables", () => {
    const text = "Comparing \\text{Cov}(R_A, R_B) with \\text{NPV}, \\text{WACC}, and \\text{ROE}. Compounded by (1+r)^t and (1+R)^T with s^2.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("$\\text{Cov}(R_A, R_B)$");
    expect(res).toContain("$\\text{NPV}$");
    expect(res).toContain("$\\text{WACC}$");
    expect(res).toContain("$\\text{ROE}$");
    expect(res).toContain("$(1+r)^t$");
    expect(res).toContain("$(1+R)^T$");
    expect(res).toContain("$s^2$.");
  });
});

describe("English and Vietnamese bilingual lead-in text formulas", () => {
  it("correctly delimits CAPM formula with English prose lead-in and where clause", () => {
    const text =
      "According to the Capital Asset Pricing Model, E[R_i] = R_f + \\beta_i (E[R_M] - R_f) where \\beta_i measures systematic risk.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("$E[R_i] = R_f + \\beta_i (E[R_M] - R_f)$");
    expect(res).toContain("where $\\beta_i$ measures systematic risk.");
  });

  it("correctly delimits formulas with Vietnamese prose lead-in and 'trong đó' clause", () => {
    const text =
      "Công thức tính phương sai danh mục: \\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B) trong đó \\sigma_p là độ lệch chuẩn.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("$\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B)$");
    expect(res).toContain("trong đó $\\sigma_p$ là độ lệch chuẩn.");
  });

  it("correctly delimits Gordon model with Vietnamese prose lead-in and 'với' clause", () => {
    const text =
      "Trong mô hình định giá cổ tức Gordon, P_0 = \\frac{D_1}{r - g} với P_0 là thị giá cổ phiếu và D_1 là cổ tức năm tới.";
    const res = ensureInlineMathDelimiters(text);
    expect(res).toContain("$P_0 = \\frac{D_1}{r - g}$");
    expect(res).toContain("với $P_0$ là thị giá cổ phiếu và $D_1$ là cổ tức năm tới.");
  });
});

describe("PDF Export formatTextWithMath zero-leakage protection", () => {
  it("converts un-delimited equations into KaTeX spans without raw LaTeX leakage", () => {
    const text = "Calculated as \\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(R_A, R_B).";
    const html = formatTextWithMath(text);

    expect(html).toContain("pdf-inline-math");
    expect(html).toContain("katex");
    expect(html).not.toContain("Calculated as \\sigma");
    expect(html).toContain("Calculated as <span class=\"pdf-inline-math\">");
  });

  it("converts un-delimited subscript variables into KaTeX inline math spans", () => {
    const text = "We compute P_0 and D_1 at rate R_f.";
    const html = formatTextWithMath(text);

    expect(html).toContain("pdf-inline-math");
    expect(html).toContain("katex");
    expect(html).not.toContain("compute P_0");
    expect(html).toContain("compute <span class=\"pdf-inline-math\">");
    expect(html).toContain("at rate <span class=\"pdf-inline-math\">");
  });

  it("preserves display math blocks and escapes plain text to prevent XSS", () => {
    const text = "Formula: $$\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}$$ with <script>alert(1)</script>";
    const html = formatTextWithMath(text);

    expect(html).toContain("pdf-display-math");
    expect(html).toContain("katex-display");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("strictly preserves currency dollar amounts in PDF exports", () => {
    const text = "Project budget requires $5,000 upfront and returns $30 daily.";
    const html = formatTextWithMath(text);

    expect(html).not.toContain("pdf-inline-math");
    expect(html).toContain("$5,000 upfront and returns $30 daily.");
  });
});

describe("Double-wrapping prevention & mixed display/prose normalization", () => {
  it("never double-wraps already delimited math in inline math or display math", () => {
    const text = "Already delimited: $\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}$ and display $$E[R_p]$$.";
    const res = ensureInlineMathDelimiters(text);

    expect(res).toBe(text);
    expect(res).not.toContain("$$$");
    expect(res).not.toContain("$$E[R_p]$$$$");
  });

  it("normalizes un-delimited math in prose surrounding existing display math blocks", () => {
    const raw = "CAPM representation:\n$$E[R_i] = R_f + \\beta_i (E[R_M] - R_f)$$\nwhere \\beta_i measures systematic risk and R_f is the benchmark.";
    const normalized = normalizeMathFormulas(raw);

    expect(normalized).toContain("$$E[R_i] = R_f + \\beta_i (E[R_M] - R_f)$$");
    expect(normalized).toContain("where $\\beta_i$ measures systematic risk and $R_f$ is the benchmark.");
  });

  it("handles left/right bracketed expressions and operators", () => {
    const text = "Discount factor is \\left[\\frac{1-(1+r)^{-t}}{r}\\right] with margin \\pm 5%.";
    const res = ensureInlineMathDelimiters(text);

    expect(res).toContain("$\\left[\\frac{1-(1+r)^{-t}}{r}\\right]$");
    expect(res).toContain("$\\pm 5%$");
  });

  it("handles whitespace inside LLM generated dollar delimiters cleanly", () => {
    const text = "Variables are $  P_0  $ and $  \\sigma_p  $.";
    const tokens = tokenizeMath(text);

    const mathTokens = tokens.filter((t) => t.type === "inline-math");
    expect(mathTokens).toHaveLength(2);
    expect(mathTokens[0].value).toBe("P_0");
    expect(mathTokens[1].value).toBe("\\sigma_p");
  });
});

describe("Universal Multi-Discipline LaTeX Sanitization & KaTeX Rendering", () => {
  it("delimits and safely renders Physics equations via KaTeX without fallback or leakage", () => {
    const physicsProse = [
      "Gravitational force between two masses is F = G \\frac{m_1 m_2}{r^2} where G is constant.",
      "Einstein mass-energy equivalence is E = m c^2.",
      "Kinetic energy formula is E_k = \\frac{1}{2} m v^2.",
      "Photon energy is E = h \\nu.",
    ];

    for (const text of physicsProse) {
      const delimited = ensureInlineMathDelimiters(text);
      expect(delimited).toContain("$");
      const tokens = tokenizeMath(delimited);
      const mathTokens = tokens.filter((t) => t.type === "inline-math" || t.type === "display-math");
      expect(mathTokens.length).toBeGreaterThan(0);

      for (const mt of mathTokens) {
        const html = renderKatexSafe(mt.value, false);
        expect(html).toContain("katex");
        expect(html).not.toContain("katex-fallback");
      }

      const pdfHtml = formatTextWithMath(delimited);
      expect(pdfHtml).toContain("pdf-inline-math");
      expect(pdfHtml).toContain("katex");
    }
  });

  it("delimits and safely renders Machine Learning & Deep Learning equations via KaTeX", () => {
    const mlProse = [
      "Cross-entropy loss function is L = -\\sum_{i=1}^C y_i \\log(\\hat{y}_i).",
      "Softmax activation layer is \\sigma(z)_i = \\frac{e^{z_i}}{\\sum_{j=1}^K e^{z_j}}.",
      "Mean Squared Error loss is \\text{MSE} = \\frac{1}{n} \\sum_{i=1}^n (y_i - \\hat{y}_i)^2.",
      "Gradient descent weight update is \\theta_{t+1} = \\theta_t - \\alpha \\nabla L(\\theta_t).",
    ];

    for (const text of mlProse) {
      const delimited = ensureInlineMathDelimiters(text);
      expect(delimited).toContain("$");
      const tokens = tokenizeMath(delimited);
      const mathTokens = tokens.filter((t) => t.type === "inline-math" || t.type === "display-math");
      expect(mathTokens.length).toBeGreaterThan(0);

      for (const mt of mathTokens) {
        const html = renderKatexSafe(mt.value, false);
        expect(html).toContain("katex");
        expect(html).not.toContain("katex-fallback");
      }

      const pdfHtml = formatTextWithMath(delimited);
      expect(pdfHtml).toContain("pdf-inline-math");
      expect(pdfHtml).toContain("katex");
    }
  });

  it("delimits and safely renders Calculus & Linear Algebra equations via KaTeX", () => {
    const mathProse = [
      "The characteristic polynomial is \\det(\\mathbf{A} - \\lambda \\mathbf{I}) = 0.",
      "The directional gradient is \\nabla f(x, y) = \\left[ \\frac{\\partial f}{\\partial x}, \\frac{\\partial f}{\\partial y} \\right].",
      "Gaussian integral evaluates to \\int_{-\\infty}^\\infty e^{-x^2} dx = \\sqrt{\\pi}.",
    ];

    for (const text of mathProse) {
      const delimited = ensureInlineMathDelimiters(text);
      expect(delimited).toContain("$");
      const tokens = tokenizeMath(delimited);
      const mathTokens = tokens.filter((t) => t.type === "inline-math" || t.type === "display-math");
      expect(mathTokens.length).toBeGreaterThan(0);

      for (const mt of mathTokens) {
        const html = renderKatexSafe(mt.value, false);
        expect(html).toContain("katex");
        expect(html).not.toContain("katex-fallback");
      }

      const pdfHtml = formatTextWithMath(delimited);
      expect(pdfHtml).toContain("pdf-inline-math");
      expect(pdfHtml).toContain("katex");
    }
  });

  it("delimits and safely renders Macroeconomics & Microeconomics equations via KaTeX", () => {
    const econProse = [
      "Cobb-Douglas production function is Y = A K^\\alpha L^{1-\\alpha}.",
      "Goods market equilibrium in open economy is Y = C + I + G + NX.",
      "Fisher interest rate relation is 1 + i = (1 + r)(1 + \\pi).",
      "Marginal rate of substitution is \\text{MRS} = -\\frac{\\text{MU}_x}{\\text{MU}_y}.",
    ];

    for (const text of econProse) {
      const delimited = ensureInlineMathDelimiters(text);
      expect(delimited).toContain("$");
      const tokens = tokenizeMath(delimited);
      const mathTokens = tokens.filter((t) => t.type === "inline-math" || t.type === "display-math");
      expect(mathTokens.length).toBeGreaterThan(0);

      for (const mt of mathTokens) {
        const html = renderKatexSafe(mt.value, false);
        expect(html).toContain("katex");
        expect(html).not.toContain("katex-fallback");
      }

      const pdfHtml = formatTextWithMath(delimited);
      expect(pdfHtml).toContain("pdf-inline-math");
      expect(pdfHtml).toContain("katex");
    }
  });

  it("delimits and safely renders Statistics & Probability equations via KaTeX", () => {
    const statsProse = [
      "Bayes Theorem is P(A|B) = \\frac{P(B|A) P(A)}{P(B)}.",
      "Hypothesis testing t-statistic is t = \\frac{\\bar{x} - \\mu_0}{s / \\sqrt{n}}.",
      "OLS regression slope coefficient is \\hat{\\beta}_1 = \\frac{\\text{Cov}(X, Y)}{\\text{Var}(X)}.",
    ];

    for (const text of statsProse) {
      const delimited = ensureInlineMathDelimiters(text);
      expect(delimited).toContain("$");
      const tokens = tokenizeMath(delimited);
      const mathTokens = tokens.filter((t) => t.type === "inline-math" || t.type === "display-math");
      expect(mathTokens.length).toBeGreaterThan(0);

      for (const mt of mathTokens) {
        const html = renderKatexSafe(mt.value, false);
        expect(html).toContain("katex");
        expect(html).not.toContain("katex-fallback");
      }

      const pdfHtml = formatTextWithMath(delimited);
      expect(pdfHtml).toContain("pdf-inline-math");
      expect(pdfHtml).toContain("katex");
    }
  });

  it("delimits and safely renders Capital Budgeting, TVM, and Bond equations via KaTeX", () => {
    const financeProse = [
      "Net present value is NPV = -I_0 + \\sum_{t=1}^n \\frac{CF_t}{(1 + r)^t}.",
      "Bond pricing formula is P_B = C \\left[ \\frac{1 - (1 + y)^{-t}}{y} \\right] + \\frac{F}{(1 + y)^t}.",
      "DuPont return on equity is ROE = \\text{Profit Margin} \\times \\text{Total Asset Turnover} \\times \\text{Equity Multiplier}.",
      "Effective annual rate is EAR = \\left(1 + \\frac{\\text{APR}}{m}\\right)^m - 1.",
    ];

    for (const text of financeProse) {
      const delimited = ensureInlineMathDelimiters(text);
      expect(delimited).toContain("$");
      const tokens = tokenizeMath(delimited);
      const mathTokens = tokens.filter((t) => t.type === "inline-math" || t.type === "display-math");
      expect(mathTokens.length).toBeGreaterThan(0);

      for (const mt of mathTokens) {
        const html = renderKatexSafe(mt.value, false);
        expect(html).toContain("katex");
        expect(html).not.toContain("katex-fallback");
      }

      const pdfHtml = formatTextWithMath(delimited);
      expect(pdfHtml).toContain("pdf-inline-math");
      expect(pdfHtml).toContain("katex");
    }
  });
});

describe("Vietnamese typography and Greek Sigma sanitization", () => {
  it("restores corrupted Sigma in place of Vietnamese words/syllables: 'suất sinh lời', 'sử dụng vốn', and 'tỷ suất'", () => {
    // 1. "$\Sigma$ất sinh lời" -> "suất sinh lời"
    expect(cleanVietnameseSigmaTypos("$\\Sigma$ất sinh lời")).toBe("suất sinh lời");
    expect(repairCorruptedLatex("$\\Sigma$ất sinh lời")).toBe("suất sinh lời");

    // 2. "\Sigma ất sinh lời" & "Σất sinh lời" -> "suất sinh lời"
    expect(cleanVietnameseSigmaTypos("\\Sigma ất sinh lời")).toBe("suất sinh lời");
    expect(cleanVietnameseSigmaTypos("Σất sinh lời")).toBe("suất sinh lời");

    // 3. "chi phí $\Sigma$ dụng vốn" -> "chi phí sử dụng vốn"
    expect(cleanVietnameseSigmaTypos("chi phí $\\Sigma$ dụng vốn")).toBe("chi phí sử dụng vốn");
    expect(repairCorruptedLatex("chi phí $\\Sigma$ dụng vốn")).toBe("chi phí sử dụng vốn");
    expect(cleanVietnameseSigmaTypos("chi phí Σ dụng vốn")).toBe("chi phí sử dụng vốn");
    expect(cleanVietnameseSigmaTypos("chi phí \\Sigma dụng vốn")).toBe("chi phí sử dụng vốn");
    expect(cleanVietnameseSigmaTypos("chi phí $\\Sigma$ử dụng vốn")).toBe("chi phí sử dụng vốn");

    // 4. "tỷ $\Sigma$ất" & "tỷ $\Sigma$" -> "tỷ suất"
    expect(cleanVietnameseSigmaTypos("tỷ $\\Sigma$ất")).toBe("tỷ suất");
    expect(cleanVietnameseSigmaTypos("tỷ $\\Sigma$")).toBe("tỷ suất");
    expect(cleanVietnameseSigmaTypos("tỷ \\Sigma ất")).toBe("tỷ suất");
    expect(cleanVietnameseSigmaTypos("tỷ Σ")).toBe("tỷ suất");
    expect(cleanVietnameseSigmaTypos("Tỷ $\\Sigma$ất")).toBe("Tỷ suất");

    // 5. Common Vietnamese noun phrases: "sự kiện", "sự cố", "sự biến", "sự thay", "sự khác"
    expect(cleanVietnameseSigmaTypos("$\\Sigma$ kiện")).toBe("sự kiện");
    expect(cleanVietnameseSigmaTypos("\\Sigma kiện")).toBe("sự kiện");
    expect(cleanVietnameseSigmaTypos("$\\Sigma$ cố")).toBe("sự cố");
    expect(cleanVietnameseSigmaTypos("$\\Sigma$ biến")).toBe("sự biến");
    expect(cleanVietnameseSigmaTypos("$\\Sigma$ thay")).toBe("sự thay");
    expect(cleanVietnameseSigmaTypos("$\\Sigma$ khác")).toBe("sự khác");

    // 6. Generic cleanTypoString alias matches
    expect(cleanTypoString("$\\Sigma$ất sinh lời")).toBe("suất sinh lời");
    expect(cleanTypoString("chi phí $\\Sigma$ dụng vốn")).toBe("chi phí sử dụng vốn");
  });

  it("preserves genuine mathematical Sigma summation notation without corrupting math equations", () => {
    const mathFormula = "\\sum_{i=1}^n P_i (R_i - E[R])^2";
    expect(repairCorruptedLatex(mathFormula)).toBe(mathFormula);

    const sigmaMath = "\\Sigma_{i=1}^n P_i";
    expect(repairCorruptedLatex(sigmaMath)).toBe(sigmaMath);
  });
});

describe("formatAccountingFormula & Cash Identity KaTeX formatting (Chapter 26)", () => {
  it("formats Cash Identity cleanly wrapping Long-Term Debt, NWC, Equity, and Fixed Assets", () => {
    const rawEquation = "Cash = Long-Term Debt + Equity - NWC - Fixed Assets";
    const formatted = formatAccountingFormula(rawEquation);
    expect(formatted).toBe(
      "\\text{Cash} = \\text{Long-Term Debt} + \\text{Equity} - \\text{NWC} - \\text{Fixed Assets}",
    );

    // Verify repairCorruptedLatex automatically cleans it up
    const repaired = repairCorruptedLatex(rawEquation);
    expect(repaired).toBe(
      "\\text{Cash} = \\text{Long-Term Debt} + \\text{Equity} - \\text{NWC} - \\text{Fixed Assets}",
    );

    // Verify KaTeX renders without fallback and contains valid katex classes
    const html = renderKatexSafe(formatted, true);
    expect(html).toContain("katex");
    expect(html).not.toContain("katex-fallback");
  });

  it("handles corrupted hyphen variations in Long - Term Debt without minus sign glitches", () => {
    const variants = [
      "Cash = Long - Term Debt + Equity - Net Working Capital - Fixed Assets",
      "Cash = \\text{Long} - \\text{Term Debt} + Equity - NWC - Fixed Assets",
      "Cash = \\text{Long - Term Debt} + Equity - Net Working Capital (other than Cash) - Fixed Assets",
    ];

    for (const v of variants) {
      const formatted = formatAccountingFormula(v);
      expect(formatted).toContain("\\text{Long-Term Debt}");
      expect(formatted).not.toContain("\\text{Long} - \\text{Term");
      const html = renderKatexSafe(formatted, false);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-fallback");
    }
  });

  it("formats Net Working Capital and parenthetical other/excluding cash variants", () => {
    const raw1 = "Cash = Long-Term Debt + Equity - Net Working Capital (other than Cash) - Fixed Assets";
    expect(formatAccountingFormula(raw1)).toBe(
      "\\text{Cash} = \\text{Long-Term Debt} + \\text{Equity} - \\text{Net Working Capital (other than Cash)} - \\text{Fixed Assets}",
    );

    const raw2 = "NWC = Current Assets - Current Liabilities";
    expect(formatAccountingFormula(raw2)).toBe(
      "\\text{NWC} = \\text{Current Assets} - \\text{Current Liabilities}",
    );
  });

  it("formats Turnover & Period System equations (Inventory, Receivables, Payables, Cycles)", () => {
    const invTurnover = "Inventory Turnover = COGS / Average Inventory";
    expect(formatAccountingFormula(invTurnover)).toBe(
      "\\text{Inventory Turnover} = \\frac{\\text{COGS}}{\\text{Average Inventory}}",
    );

    const invPeriod = "Inventory Period = 365 / Inventory Turnover";
    expect(formatAccountingFormula(invPeriod)).toBe(
      "\\text{Inventory Period} = \\frac{365}{\\text{Inventory Turnover}}",
    );

    const recTurnover = "Receivables Turnover = Credit Sales / Average Accounts Receivable";
    expect(formatAccountingFormula(recTurnover)).toBe(
      "\\text{Receivables Turnover} = \\frac{\\text{Credit Sales}}{\\text{Average Accounts Receivable}}",
    );

    const payTurnover = "Payables Turnover = COGS / Average Accounts Payable";
    expect(formatAccountingFormula(payTurnover)).toBe(
      "\\text{Payables Turnover} = \\frac{\\text{COGS}}{\\text{Average Accounts Payable}}",
    );

    const opCycle = "Operating Cycle = Inventory Period + Receivables Period";
    expect(formatAccountingFormula(opCycle)).toBe(
      "\\text{Operating Cycle} = \\text{Inventory Period} + \\text{Receivables Period}",
    );

    const cashCycle = "Cash Cycle = Operating Cycle - Payables Period";
    expect(formatAccountingFormula(cashCycle)).toBe(
      "\\text{Cash Cycle} = \\text{Operating Cycle} - \\text{Payables Period}",
    );
  });

  it("formats Cash Budget calculation equations (Collections, Net Cash Flow, Ending Cash, Cumulative Surplus)", () => {
    const collections = "Collections_t = Cash Sales_t + sum(% collected * Sales_{t-k})";
    expect(formatAccountingFormula(collections)).toContain("\\text{Collections}_t = \\text{Cash Sales}_t");

    const netCashFlow = "Net Cash Flow_t = Cash Collections_t - Cash Disbursements_t";
    expect(formatAccountingFormula(netCashFlow)).toBe(
      "\\text{Net Cash Flow}_t = \\text{Cash Collections}_t - \\text{Cash Disbursements}_t",
    );

    const endingCash = "Ending Cash_t = Beginning Cash_t + Net Cash Flow_t";
    expect(formatAccountingFormula(endingCash)).toBe(
      "\\text{Ending Cash}_t = \\text{Beginning Cash}_t + \\text{Net Cash Flow}_t",
    );

    const cumulative = "Cumulative Surplus / (Deficit)_t = Ending Cash_t - Target Minimum Cash Balance";
    expect(formatAccountingFormula(cumulative)).toBe(
      "\\text{Cumulative Surplus / (Deficit)}_t = \\text{Ending Cash}_t - \\text{Target Minimum Cash Balance}",
    );
  });
});

describe("Regression Tests: Bug 2 & Bug 3 (Multi-word English phrases, Currency dollar escaping, Unicode arrows)", () => {
  describe("Multi-word English phrases wrapping in \\text{...}", () => {
    it("preserves spaces and wraps multi-word English phrases with => converted to \\implies", () => {
      const phrase = "Increase Current Assets => Decrease Use of Cash";
      const wrapped = wrapBareEnglishInLatex(phrase);
      expect(wrapped).toContain("\\text{Increase Current Assets}");
      expect(wrapped).toContain("\\implies");
      expect(wrapped).toContain("\\text{Decrease Use of Cash}");
      expect(wrapped).not.toContain("IncreaseCurrent Assets");
      expect(wrapped).not.toContain("IncreaseCurrent");
      expect(wrapped).not.toContain("DecreaseUse");

      // Verify KaTeX rendering produces valid html and no error
      const html = renderKatexSafe(wrapped, true);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });

    it("wraps arrow implication formula 'Activities ↑ cash => ↑ Cash inflow'", () => {
      const phrase = "Activities ↑ cash => ↑ Cash inflow";
      const wrapped = wrapBareEnglishInLatex(phrase);
      expect(wrapped).toContain("\\text{Activities}");
      expect(wrapped).toContain("\\uparrow");
      expect(wrapped).toContain("\\text{cash}");
      expect(wrapped).toContain("\\implies");
      expect(wrapped).toContain("\\text{Cash inflow}");

      // Verify KaTeX rendering
      const html = renderKatexSafe(wrapped, true);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });

    it("wraps 'Accounts Receivable period' without mashing words", () => {
      const phrase = "Accounts Receivable period";
      const wrapped = wrapBareEnglishInLatex(phrase);
      expect(wrapped).toBe("\\text{Accounts Receivable period}");
      expect(wrapped).not.toContain("AccountsReceivable");
      expect(wrapped).not.toContain("Receivableperiod");

      const html = renderKatexSafe(wrapped, false);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });

    it("wraps \"Last quarter's sales\" without mashing words", () => {
      const phrase = "Last quarter's sales";
      const wrapped = wrapBareEnglishInLatex(phrase);
      expect(wrapped).toBe("\\text{Last quarter's sales}");
      expect(wrapped).not.toContain("Lastquarter'ssales");
      expect(wrapped).not.toContain("Lastquarter");

      const html = renderKatexSafe(wrapped, false);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });

    it("wraps parenthetical 'Other (non-cash) Current Assets' cleanly", () => {
      const phrase = "Other (non-cash) Current Assets";
      const wrapped = wrapBareEnglishInLatex(phrase);
      expect(wrapped).toBe("\\text{Other (non-cash) Current Assets}");

      const fullFormula =
        "Cash = Long-Term Debt + Equity + Current Liabilities - Other (non-cash) Current Assets - Fixed Assets";
      const formatted = formatAccountingFormula(fullFormula);
      expect(formatted).toContain("\\text{Other (non-cash) Current Assets}");
      expect(formatted).toContain("\\text{Fixed Assets}");

      const html = renderKatexSafe(formatted, true);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });
  });

  describe("Literal currency dollar signs inside math strings", () => {
    it("escapes literal dollar signs inside math mode without KaTeX error", () => {
      const mathWithDollar = "\\text{Accounts Receivable} = $100 \\text{ million}";
      const html = renderKatexSafe(mathWithDollar, false);

      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
      expect(html).toContain("100");
      expect(html).toContain("$");
    });

    it("tokenizes math string with embedded currency dollar without premature closure and renders cleanly", () => {
      const text = "$\\text{Accounts Receivable} = $100 \\text{ million}$";
      const tokens = tokenizeMath(text);

      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe("inline-math");
      expect(tokens[0].value).toContain("\\text{Accounts Receivable}");
      expect(tokens[0].value).toContain("100 \\text{ million}");

      const html = renderKatexSafe(tokens[0].value, false);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });

    it("escapes multiple currency dollar amounts in math expressions", () => {
      const expr = "\\text{Cash} = $500 + $200 = $700";
      const html = renderKatexSafe(expr, true);

      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });
  });

  describe("Unicode arrows conversion and rendering", () => {
    it("converts Unicode arrows (↑, ↓, →, ←, ⇒) to LaTeX commands", () => {
      const input = "A ↑ B ↓ C → D ← E ⇒ F";
      const wrapped = wrapBareEnglishInLatex(input);

      expect(wrapped).toContain("\\uparrow");
      expect(wrapped).toContain("\\downarrow");
      expect(wrapped).toContain("\\rightarrow");
      expect(wrapped).toContain("\\leftarrow");
      expect(wrapped).toContain("\\implies");

      const html = renderKatexSafe(wrapped, false);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });

    it("converts ASCII => to \\implies and renders in KaTeX", () => {
      const input = "X => Y";
      const wrapped = wrapBareEnglishInLatex(input);

      expect(wrapped).toContain("\\implies");
      const html = renderKatexSafe(wrapped, false);
      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
      expect(html).not.toContain("katex-fallback");
    });
  });
});



