import type {
  FormulaLedgerEntry,
  NoteFormula,
  NoteSection,
  NoteSubSection,
  TextbookDivergenceNotice,
} from "@/lib/schemas/notes";

export interface DomainRuleMatchContext {
  formula: NoteFormula;
  sectionTitle: string;
  subHeading?: string;
  slideText?: string;
  ledgerEntry?: FormulaLedgerEntry;
}

export interface DomainRule {
  ruleId: string;
  packId: string;
  title: string;
  textbookForm: string;
  check: (ctx: DomainRuleMatchContext) => {
    matched: boolean;
    message?: string;
    lecturerForm?: string;
  };
}

export interface DomainRulePack {
  packId: string;
  name: string;
  rules: DomainRule[];
}

interface FractionPart {
  numerator: string;
  denominator: string;
}

/**
 * Normalizes LaTeX for consistent AST-like string inspection without modifying source text.
 */
function normalizeLatex(latex: string): string {
  if (!latex) return "";
  return latex
    .replace(/\\dfrac/g, "\\frac")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts balanced LaTeX fractions \frac{num}{den} handling arbitrary nested braces.
 */
function extractFractions(latex: string): FractionPart[] {
  const fractions: FractionPart[] = [];
  let i = 0;
  while (i < latex.length) {
    const fracIdx = latex.indexOf("\\frac", i);
    if (fracIdx === -1) break;

    const numStart = latex.indexOf("{", fracIdx + 5);
    if (numStart === -1) {
      i = fracIdx + 5;
      continue;
    }

    let depth = 1;
    let j = numStart + 1;
    while (j < latex.length && depth > 0) {
      if (latex[j] === "{") depth++;
      else if (latex[j] === "}") depth--;
      j++;
    }
    if (depth !== 0) {
      i = numStart + 1;
      continue;
    }
    const num = latex.slice(numStart + 1, j - 1);

    while (j < latex.length && /\s/.test(latex[j])) j++;
    if (j >= latex.length || latex[j] !== "{") {
      i = j;
      continue;
    }
    const denStart = j;
    depth = 1;
    j = denStart + 1;
    while (j < latex.length && depth > 0) {
      if (latex[j] === "{") depth++;
      else if (latex[j] === "}") depth--;
      j++;
    }
    if (depth !== 0) {
      i = denStart + 1;
      continue;
    }
    const den = latex.slice(denStart + 1, j - 1);

    fractions.push({ numerator: num.trim(), denominator: den.trim() });
    i = j;
  }
  return fractions;
}

/**
 * Aggregates all contextual text sources available for a formula match.
 */
function getCombinedContextText(ctx: DomainRuleMatchContext): string {
  return [
    ctx.sectionTitle,
    ctx.subHeading ?? "",
    ctx.slideText ?? "",
    ctx.formula.name ?? "",
    ctx.formula.leadText ?? "",
    ctx.formula.description ?? "",
    ctx.ledgerEntry?.evidence ?? "",
    ctx.ledgerEntry?.label ?? "",
    ctx.ledgerEntry?.raw ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/* =========================================================================================
   PACK 1: corporate-finance-valuation (Stock Valuation & Cost of Capital)
   ========================================================================================= */

const ruleCfGrowingPerpetuitySign: DomainRule = {
  ruleId: "cf-growing-perpetuity-sign",
  packId: "corporate-finance-valuation",
  title: "Gordon Growth / Growing Perpetuity Sign Divergence",
  textbookForm: "P_0 = \\frac{D_1}{R - g}",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);
    const context = getCombinedContextText(ctx);

    // Look for denominator with R + g or r + g or k + g
    const fractions = extractFractions(norm);
    const hasPlusGDenominator = fractions.some((f) => {
      const denHasPlusG =
        /(?:^|[^a-zA-Z0-9])(?:R|r|k|K)(?:_[a-zA-Z0-9]+)?\s*\+\s*g\b/.test(
          f.denominator,
        ) || /\(\s*(?:R|r|k|K)(?:_[a-zA-Z0-9]+)?\s*\+\s*g\s*\)/.test(f.denominator);
      const numHasDividend =
        /(?:^|[^a-zA-Z])(?:D|CF|Div|div)\b/i.test(f.numerator) ||
        /D_\{?[0-9a-zA-Z+]+\}?/i.test(f.numerator);
      return denHasPlusG && numHasDividend;
    });

    // Also detect inline slash notation: D_1 / (R + g) or D_0(1+g) / (R + g)
    const hasInlinePlusG =
      /(?:D_\{?[0-9a-zA-Z+]+\}?|CF_\{?[0-9a-zA-Z+]+\}?|Div)\s*(?:\([^)]+\))?\s*\/\s*\(?\s*(?:R|r|k|K)(?:_[a-zA-Z0-9]+)?\s*\+\s*g\s*\)?/i.test(
        norm,
      );

    // Context check: Gordon Growth, Dividend Discount, DDM, Perpetuity, or LHS P_0 / P_t
    const isPerpetuityContext =
      hasPlusGDenominator ||
      hasInlinePlusG ||
      ((/gordon|growing perpetuity|dividend discount|ddm/i.test(context) ||
        /^\s*P_\{?0\}?\s*=/i.test(norm)) &&
        fractions.some((f) =>
          /(?:^|[^a-zA-Z0-9])(?:R|r|k|K)\s*\+\s*g\b/.test(f.denominator),
        ));

    if (hasPlusGDenominator || hasInlinePlusG || isPerpetuityContext) {
      return {
        matched: true,
        message:
          "Your lecturer's formula uses (R + g) in the denominator; the standard textbook Gordon Growth Model uses (R - g).",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

const ruleCfOnePeriodExponent: DomainRule = {
  ruleId: "cf-one-period-exponent",
  packId: "corporate-finance-valuation",
  title: "1-Period Valuation Multi-Period Exponent Divergence",
  textbookForm: "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);

    // 1-period holding equation has D_1 and P_1, without a summation symbol (\sum or \Sigma)
    const hasD1 = /D_\{?1\}?/.test(norm);
    const hasP1 = /P_\{?1\}?/.test(norm);
    const hasSum = /\\sum|\\Sigma/.test(norm);

    // Multi-period exponent ^T or ^t or ^{T} or ^{t}
    const hasMultiPeriodExponent =
      /\^\s*\{?\s*[Tt]\s*\}?|\^\s*[Tt]\b/.test(norm);

    if (hasD1 && hasP1 && !hasSum && hasMultiPeriodExponent) {
      return {
        matched: true,
        message:
          "Your lecturer's 1-period valuation formula includes a multi-period exponent (^T or ^t); standard textbook 1-period form discounts by (1 + R)^1.",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

const ruleCfGrowthCircularPrice: DomainRule = {
  ruleId: "cf-growth-circular-price",
  packId: "corporate-finance-valuation",
  title: "Dividend Growth Rate Definition Divergence",
  textbookForm: "g = \\text{Retention ratio} \\times \\text{ROE}",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);

    // LHS defines growth rate g = ...
    const isGLhs =
      /^\s*g\s*=/i.test(norm) ||
      /^\s*\\text\{g\}\s*=/i.test(norm) ||
      /\bg\s*=\s*\\frac/.test(norm);

    if (!isGLhs) {
      return { matched: false };
    }

    const fractions = extractFractions(norm);
    const hasPriceAppreciationFrac = fractions.some((f) => {
      const numHasPriceDelta =
        /(?:P_\{?1\}?\s*-\s*P_\{?0\}?|P_\{?t\}?\s*-\s*P_\{?t-1\}?|\\Delta\s*P_?0?)/i.test(
          f.numerator,
        );
      const denHasBasePrice =
        /(?:P_\{?0\}?|P_\{?t-1\}?|\bP\b)/i.test(f.denominator);
      return numHasPriceDelta && denHasBasePrice;
    });

    const hasPriceAppreciationSlash =
      /\(?\s*(?:P_\{?1\}?\s*-\s*P_\{?0\}?|P_\{?t\}?\s*-\s*P_\{?t-1\}?|\\Delta\s*P)\s*\)?\s*\/\s*P_\{?0\}?/i.test(
        norm,
      );

    if (hasPriceAppreciationFrac || hasPriceAppreciationSlash) {
      return {
        matched: true,
        message:
          "Your lecturer's slide defines g via price appreciation ((P_1 - P_0)/P_0); standard textbook DDM defines sustainable growth as Retention Ratio × ROE.",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

const ruleCfWaccEquityTaxShield: DomainRule = {
  ruleId: "cf-wacc-equity-tax-shield",
  packId: "corporate-finance-valuation",
  title: "WACC Equity Tax Shield Divergence",
  textbookForm:
    "\\text{WACC} = \\left(\\frac{E}{V}\\right) R_E + \\left(\\frac{P}{V}\\right) R_P + \\left(\\frac{D}{V}\\right) R_D (1 - T_C)",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);
    const context = getCombinedContextText(ctx);

    // Check if this is a WACC equation
    const isWaccFormula =
      /\bWACC\b|\\text\{WACC\}|wacc/i.test(norm) ||
      ((/(?:E|S)\/V|\\frac\{(?:E|S)\}\{V\}/.test(norm) || /w_\{?[es]\}?/i.test(norm)) &&
        (/(?:D|B)\/V|\\frac\{(?:D|B)\}\{V\}/.test(norm) || /w_\{?[db]\}?/i.test(norm)));

    const isWaccContext =
      isWaccFormula ||
      (/\bwacc\b|weighted average cost of capital/i.test(context) &&
        /(?:R_\{?E\}?|r_\{?e\}?|K_\{?e\}?)/i.test(norm));

    if (!isWaccContext) {
      return { matched: false };
    }

    // Exclude M&M Proposition II with corporate taxes: R_E = R_U + (R_U - R_D)(D/E)(1 - T_C)
    const isMmProp2 =
      /^\s*(?:R_\{?E\}?|r_\{?e\}?|K_\{?e\}?)\s*=/i.test(norm) ||
      (/\bR_\{?U\}?\b|\br_\{?0\}?\b|\\frac\{D\}\{E\}|\(D\/E\)/i.test(norm) &&
        !/\bWACC\b|\\text\{WACC\}/i.test(norm));

    if (isMmProp2) {
      return { matched: false };
    }

    // Detect (1 - T_C) attached to equity or preferred stock:
    // Direct multiplier pattern on R_E, R_P, K_e, K_p, r_e, r_p
    const hasDirectEquityTaxShield =
      /(?:R_\{?[EP]\}?|r_\{?[ep]\}?|K_\{?[ep]\}?|k_\{?[ep]\}?)\s*(?:\\times|\*)?\s*\(1\s*-\s*(?:T|t)(?:_[Cc])?\)/i.test(
        norm,
      ) ||
      /\(1\s*-\s*(?:T|t)(?:_[Cc])?\)\s*(?:\\times|\*)?\s*(?:R_\{?[EP]\}?|r_\{?[ep]\}?|K_\{?[ep]\}?|k_\{?[ep]\}?)/i.test(
        norm,
      );

    // Additive term inspection: (E/V) * R_E * (1 - T_C) or (P/V) * R_P * (1 - T_C)
    const terms = norm.split("+");
    const hasTermEquityTaxShield = terms.some((term) => {
      const hasEquityOrPreferred =
        /(?:\\frac\{[EP]\}\{V\}|[EP]\/V|w_\{?[ep]\}?|R_\{?[EP]\}?|r_\{?[ep]\}?|K_\{?[ep]\}?)/i.test(
          term,
        );
      const hasDebt =
        /(?:\\frac\{D\}\{V\}|D\/V|w_\{?[db]\}?|R_\{?D\}?|r_\{?d\}?|K_\{?d\}?)/i.test(
          term,
        );
      const hasTaxShield = /\(1\s*-\s*(?:T|t)(?:_[Cc])?\)/i.test(term);
      return hasEquityOrPreferred && !hasDebt && hasTaxShield;
    });

    if (hasDirectEquityTaxShield || hasTermEquityTaxShield) {
      return {
        matched: true,
        message:
          "Your lecturer's WACC formula applies the tax shield (1 - T_C) to equity or preferred stock; standard textbook WACC applies (1 - T_C) only to debt (R_D).",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

export const corporateFinanceValuationPack: DomainRulePack = {
  packId: "corporate-finance-valuation",
  name: "Corporate Finance Valuation & Cost of Capital",
  rules: [
    ruleCfGrowingPerpetuitySign,
    ruleCfOnePeriodExponent,
    ruleCfGrowthCircularPrice,
    ruleCfWaccEquityTaxShield,
  ],
};

/* =========================================================================================
   PACK 2: statistics-risk-return (Risk, Return & Portfolio Statistics)
   ========================================================================================= */

const ruleStatArithmeticMeanDenominator: DomainRule = {
  ruleId: "stat-arithmetic-mean-denominator",
  packId: "statistics-risk-return",
  title: "Arithmetic Mean Denominator Divergence",
  textbookForm: "\\bar{R} = \\frac{1}{T} \\sum_{t=1}^{T} R_t",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);
    const context = getCombinedContextText(ctx);

    // Must NOT be variance or squared deviations
    const hasVarianceIndicators =
      /s\^2|S\^2|\\sigma\^2|\bVar\b|\\text\{Var\}/i.test(norm) ||
      /\^2\b/.test(norm);

    if (hasVarianceIndicators) {
      return { matched: false };
    }

    // Arithmetic mean indicators: \bar{R}, \bar{r}, \bar{X}, \bar{x}, \mu, or context
    const hasMeanSymbol =
      /\\bar\{?[RrXxYy]\}?|\\hat\{?[RrXxYy]\}?|E\[R\]|E\(R\)|\b\mu\b/.test(
        norm,
      );
    const hasMeanContext =
      /arithmetic\s+mean|mean\s+return|average\s+return|trung\s+bình\s+số\s+học/i.test(
        context,
      );

    if (!hasMeanSymbol && !hasMeanContext) {
      return { matched: false };
    }

    // Check for denominator dividing by T - 1, n - 1, or N - 1
    const fractions = extractFractions(norm);
    const hasMinusOneFrac = fractions.some((f) =>
      /(?:^|[^a-zA-Z0-9])(?:T|n|N)\s*-\s*1\b/.test(f.denominator),
    );
    const hasMinusOneSlash =
      /\/\s*\(?\s*(?:T|n|N)\s*-\s*1\s*\)?/.test(norm);

    if (hasMinusOneFrac || hasMinusOneSlash) {
      return {
        matched: true,
        message:
          "Your lecturer's arithmetic mean divides by (T - 1); standard textbook arithmetic mean divides by total observations T.",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

const ruleStatSampleVarianceDenominator: DomainRule = {
  ruleId: "stat-sample-variance-denominator",
  packId: "statistics-risk-return",
  title: "Sample Variance Bessel Correction Divergence",
  textbookForm: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^{T} (R_t - \\bar{R})^2",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);
    const context = getCombinedContextText(ctx);

    // Must be sample variance: LHS has s^2 or S^2, or explicit sample variance context
    const isSampleVarLhs =
      /^\s*s\^2\b/i.test(norm) ||
      /^\s*S\^2\b/.test(norm) ||
      (/\bsample\s+variance\b|phương\s+sai\s+mẫu/i.test(context) &&
        /(?:s\^2|Var)/i.test(norm));

    if (!isSampleVarLhs) {
      return { matched: false };
    }

    // Exclude scenario variance with probability weights P_i (covered by stat-sample-variance-prob-mix)
    const hasProbWeight =
      /\b[Pp]_\{?[isjt]\b|[Pp]\s*\([a-zA-Z]\)/.test(norm);
    if (hasProbWeight) {
      return { matched: false };
    }

    // Must contain squared deviations or sum of squares
    const hasSquaredDev = /\^2|\\sum/.test(norm);
    if (!hasSquaredDev) {
      return { matched: false };
    }

    // If it already contains Bessel correction (T - 1, n - 1, N - 1), it is correct!
    const hasBesselCorrection = /(?:T|n|N)\s*-\s*1/.test(norm);
    if (hasBesselCorrection) {
      return { matched: false };
    }

    // Check if it divides by uncorrected sample size T, n, or N
    const fractions = extractFractions(norm);
    const hasPopulationDenom = fractions.some((f) =>
      /^\s*(?:T|n|N)\s*$/.test(f.denominator.trim()) ||
      /(?:^|[^a-zA-Z0-9])(?:T|n|N)(?:$|[^a-zA-Z0-9])/.test(f.denominator),
    );
    const hasPopulationSlash = /\/\s*(?:T|n|N)\b/.test(norm);

    if (hasPopulationDenom || hasPopulationSlash) {
      return {
        matched: true,
        message:
          "Your lecturer's variance formula divides by T (population form) instead of (T - 1) (Bessel's sample correction).",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

const ruleStatSampleVarianceProbMix: DomainRule = {
  ruleId: "stat-sample-variance-prob-mix",
  packId: "statistics-risk-return",
  title: "Scenario Variance Probability-Sample Mixing Divergence",
  textbookForm: "\\sigma^2 = \\sum_{i} P_i (R_i - E[R])^2",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);
    const context = getCombinedContextText(ctx);

    // Variance context: \sigma^2, s^2, S^2, Var, or variance context
    const isVarianceContext =
      /\\sigma\^2|s\^2|S\^2|\bVar\b|\\text\{Var\}/i.test(norm) ||
      /\b(?:variance|phương sai)\b/i.test(context);

    if (!isVarianceContext) {
      return { matched: false };
    }

    // Must have probability weights P_i, p_i, P_t, p(s), etc.
    const hasProbWeight =
      /\b[Pp]_\{?[isjt]\b|[Pp]\s*\([a-zA-Z]\)/.test(norm);

    if (!hasProbWeight) {
      return { matched: false };
    }

    // Divergence 1: Has sample denominator division (1/T, 1/(T-1), 1/n, 1/(n-1), 1/S, 1/(S-1))
    const fractions = extractFractions(norm);
    const hasSampleDivision = fractions.some((f) =>
      /(?:^|[^a-zA-Z0-9])(?:T|n|N|S)(?:\s*-\s*1)?(?:$|[^a-zA-Z0-9])/.test(
        f.denominator,
      ),
    );
    const hasSampleSlash =
      /\/\s*\(?\s*(?:T|n|N|S)(?:\s*-\s*1)?\s*\)?/.test(norm);

    // Divergence 2: LHS uses sample variance s^2 or S^2 for scenario variance
    const isSampleVarLhs = /^\s*s\^2\b/i.test(norm) || /^\s*S\^2\b/.test(norm);

    if (hasSampleDivision || hasSampleSlash || isSampleVarLhs) {
      return {
        matched: true,
        message:
          "Your lecturer's scenario variance mixes probability weights P_i with sample-size division (1/T or 1/(T-1)); standard textbook expected variance weights solely by P_i.",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

export const statisticsRiskReturnPack: DomainRulePack = {
  packId: "statistics-risk-return",
  name: "Risk, Return & Portfolio Statistics",
  rules: [
    ruleStatArithmeticMeanDenominator,
    ruleStatSampleVarianceDenominator,
    ruleStatSampleVarianceProbMix,
  ],
};

/* =========================================================================================
   PACK 3: working-capital-accounting (Working Capital & Financial Ratios)
   ========================================================================================= */

const ruleWcDaysInYear360: DomainRule = {
  ruleId: "wc-days-in-year-360",
  packId: "working-capital-accounting",
  title: "360-Day Banker's Year Convention Divergence",
  textbookForm: "365 \\text{ days}",
  check: (ctx) => {
    const rawLatex = ctx.formula.latex || "";
    const norm = normalizeLatex(rawLatex);
    const context = getCombinedContextText(ctx);

    // Must contain 360
    const has360 = /\b360\b/.test(norm);
    if (!has360) {
      return { matched: false };
    }

    // Must be in the context of turnover, days sales, operating/cash cycle, or EAR/APR
    const wcKeywords = [
      "dso",
      "dsi",
      "dpo",
      "ccc",
      "days sales",
      "days payable",
      "days inventory",
      "inventory period",
      "receivables period",
      "payables period",
      "cash conversion cycle",
      "operating cycle",
      "turnover",
      "kỳ thu tiền",
      "kỳ thanh toán",
      "vòng quay",
      "số ngày",
      "banker's year",
      "bankers year",
      "ear",
      "apr",
      "effective annual rate",
      "annual percentage rate",
      "working capital",
      "vốn lưu động",
    ];

    const hasWcContext =
      wcKeywords.some((kw) => context.includes(kw)) ||
      /\\text\{(?:DSO|DSI|DPO|CCC|EAR|APR|Turnover|Receivables|Inventory|Payables|Period|Days)\}/i.test(
        norm,
      ) ||
      /(?:DSO|DSI|DPO|CCC|EAR|APR)\b/.test(norm);

    if (hasWcContext) {
      return {
        matched: true,
        message:
          "Your lecturer's formula uses a 360-day banker's year convention; many standard textbooks use 365 days. Follow your lecturer's convention on exams.",
        lecturerForm: rawLatex,
      };
    }

    return { matched: false };
  },
};

export const workingCapitalAccountingPack: DomainRulePack = {
  packId: "working-capital-accounting",
  name: "Working Capital & Financial Ratios",
  rules: [ruleWcDaysInYear360],
};

/* =========================================================================================
   ALL DOMAIN RULE PACKS
   ========================================================================================= */

export const DOMAIN_RULE_PACKS: DomainRulePack[] = [
  corporateFinanceValuationPack,
  statisticsRiskReturnPack,
  workingCapitalAccountingPack,
];

/**
 * Returns a specific DomainRulePack by packId.
 */
export function getDomainRulePack(packId: string): DomainRulePack | undefined {
  return DOMAIN_RULE_PACKS.find((p) => p.packId === packId);
}

/**
 * Returns a flattened array of all registered DomainRules.
 */
export function getAllDomainRules(): DomainRule[] {
  return DOMAIN_RULE_PACKS.flatMap((p) => p.rules);
}

/**
 * Evaluates all domain rules across DOMAIN_RULE_PACKS against a single formula context.
 * Performs a strictly non-mutating check on ctx.formula.
 */
export function evaluateFormulaDivergence(
  ctx: DomainRuleMatchContext,
): TextbookDivergenceNotice[] {
  const notices: TextbookDivergenceNotice[] = [];
  const slide = ctx.formula.slide ?? ctx.ledgerEntry?.slide;

  for (const pack of DOMAIN_RULE_PACKS) {
    for (const rule of pack.rules) {
      const res = rule.check(ctx);
      if (res.matched) {
        notices.push({
          ruleId: rule.ruleId,
          packId: rule.packId,
          title: rule.title,
          message:
            res.message ??
            `Your lecturer's formula differs from the standard textbook form (${rule.textbookForm}).`,
          textbookForm: rule.textbookForm,
          lecturerForm: res.lecturerForm ?? ctx.formula.latex,
          slide: slide !== undefined && slide > 0 ? slide : undefined,
        });
      }
    }
  }

  return notices;
}

/**
 * Deep clones a formula object while strictly preserving formula.latex, variables, and metadata.
 */
function cloneFormula(formula: NoteFormula): NoteFormula {
  return {
    ...formula,
    variables: formula.variables ? formula.variables.map((v) => ({ ...v })) : [],
    formulaRefs: formula.formulaRefs ? [...formula.formulaRefs] : undefined,
    derivedFrom: formula.derivedFrom ? [...formula.derivedFrom] : undefined,
    divergenceNotices: formula.divergenceNotices
      ? formula.divergenceNotices.map((n) => ({ ...n }))
      : undefined,
  };
}

/**
 * Deep clones a sub-section object.
 */
function cloneSubSection(subSection: NoteSubSection): NoteSubSection {
  return {
    ...subSection,
    bulletPoints: [...subSection.bulletPoints],
    groundedBullets: subSection.groundedBullets
      ? subSection.groundedBullets.map((b) => ({ ...b }))
      : undefined,
    formulas: subSection.formulas.map(cloneFormula),
  };
}

/**
 * Deep clones a note section object.
 */
function cloneSection(section: NoteSection): NoteSection {
  return {
    ...section,
    bulletPoints: [...section.bulletPoints],
    groundedBullets: section.groundedBullets
      ? section.groundedBullets.map((b) => ({ ...b }))
      : undefined,
    formulas: section.formulas.map(cloneFormula),
    subSections: section.subSections
      ? section.subSections.map(cloneSubSection)
      : [],
    sourceSlides: section.sourceSlides ? [...section.sourceSlides] : undefined,
    keyTakeaways: section.keyTakeaways
      ? {
          ...section.keyTakeaways,
          items: section.keyTakeaways.items
            ? section.keyTakeaways.items.map((it) => ({
                ...it,
                subBullets: it.subBullets ? [...it.subBullets] : [],
              }))
            : [],
          summaryPoints: [...section.keyTakeaways.summaryPoints],
        }
      : section.keyTakeaways,
  };
}

/**
 * Non-mutating pass over note sections that evaluates textbook divergence notices.
 * Returns deep-cloned sections with formula.divergenceNotices populated, while formula.latex
 * remains 100% unmutated (Locked Product Decision #4).
 */
export function annotateNoteWithDivergenceNotices(
  sections: NoteSection[],
  ledger?: FormulaLedgerEntry[],
): {
  sections: NoteSection[];
  notices: TextbookDivergenceNotice[];
} {
  const ledgerMap = new Map<string, FormulaLedgerEntry>();
  if (ledger) {
    for (const entry of ledger) {
      ledgerMap.set(entry.id, entry);
    }
  }

  const allNotices: TextbookDivergenceNotice[] = [];
  const clonedSections: NoteSection[] = sections.map(cloneSection);

  for (const section of clonedSections) {
    const sectionTitle = section.titleVi || section.titleEn || "";

    // 1. Evaluate section-level formulas
    for (const formula of section.formulas) {
      let ledgerEntry: FormulaLedgerEntry | undefined;
      if (formula.formulaRefs && formula.formulaRefs.length > 0) {
        ledgerEntry = ledgerMap.get(formula.formulaRefs[0]);
      }

      const ctx: DomainRuleMatchContext = {
        formula,
        sectionTitle,
        ledgerEntry,
      };

      const formulaNotices = evaluateFormulaDivergence(ctx);
      if (formulaNotices.length > 0) {
        // Merge without duplicating ruleId
        const existing = formula.divergenceNotices ?? [];
        const existingRuleIds = new Set(existing.map((n) => n.ruleId));
        const novel = formulaNotices.filter((n) => !existingRuleIds.has(n.ruleId));
        formula.divergenceNotices = [...existing, ...novel];
        allNotices.push(...novel);
      }
    }

    // 2. Evaluate subSection formulas
    if (section.subSections) {
      for (const subSection of section.subSections) {
        for (const formula of subSection.formulas) {
          let ledgerEntry: FormulaLedgerEntry | undefined;
          if (formula.formulaRefs && formula.formulaRefs.length > 0) {
            ledgerEntry = ledgerMap.get(formula.formulaRefs[0]);
          }

          const ctx: DomainRuleMatchContext = {
            formula,
            sectionTitle,
            subHeading: subSection.heading,
            ledgerEntry,
          };

          const formulaNotices = evaluateFormulaDivergence(ctx);
          if (formulaNotices.length > 0) {
            const existing = formula.divergenceNotices ?? [];
            const existingRuleIds = new Set(existing.map((n) => n.ruleId));
            const novel = formulaNotices.filter((n) => !existingRuleIds.has(n.ruleId));
            formula.divergenceNotices = [...existing, ...novel];
            allNotices.push(...novel);
          }
        }
      }
    }
  }

  return {
    sections: clonedSections,
    notices: allNotices,
  };
}
