import type { SourceBlock } from "@/lib/schemas/ingestion";
import type {
  ClutchNote,
  FormulaLedgerEntry,
  GroundedBullet,
  KeyTakeaways,
  KeyTakeawaysItem,
  NoteFormula,
  NoteFormulaVariable,
  NoteSection,
  NoteSubSection,
  SynthesisOmittedFormula,
} from "@/lib/schemas/notes";

export interface GoldenDeckDefinition {
  id: string;
  title: string;
  subject: string;
  slideCount: number;
  sources: SourceBlock[];
  expectedLedger: FormulaLedgerEntry[];
  expectedPlacedFormulaIds: string[];
  validOmittedFormulaIds?: string[];
  forbiddenInjectedFormulas?: string[];
  goldNote: ClutchNote;
}

function createGoldNote(params: {
  id: string;
  title: string;
  subject: string;
  originalFileName: string;
  originalSlideCount: number;
  executiveSummary: string;
  sections: NoteSection[];
  formulaLedger: FormulaLedgerEntry[];
  omitted?: SynthesisOmittedFormula[];
}): ClutchNote {
  return {
    id: params.id,
    title: params.title,
    subject: params.subject,
    createdAt: "2026-10-26T00:00:00.000Z",
    originalFileName: params.originalFileName,
    originalSlideCount: params.originalSlideCount,
    estimatedDistilledPages: 3,
    noiseReductionRate: 85,
    executiveSummary: params.executiveSummary,
    sections: params.sections,
    formulaLedger: params.formulaLedger,
    omitted: params.omitted ?? [],
  };
}

function createSection(
  partial: Partial<NoteSection> & Pick<NoteSection, "id" | "letter" | "titleVi">,
): NoteSection {
  return {
    titleEn: "",
    overview: "",
    bulletPoints: [],
    groundedBullets: [],
    formulas: [],
    subSections: [],
    keyTakeaways: null,
    sourceSlides: [1],
    ...partial,
  };
}

function createFormula(
  partial: Partial<NoteFormula> & Pick<NoteFormula, "latex">,
): NoteFormula {
  return {
    name: "",
    variables: [],
    status: "verified",
    numericEquivalencePassed: true,
    ...partial,
  };
}

function createGroundedBullet(
  text: string,
  slide: number,
  evidence: string,
): GroundedBullet {
  return {
    text,
    slide,
    evidence,
    status: "verified",
    verdict: "SUPPORTED",
  };
}

function createTakeawayItem(
  point: string,
  slide: number,
  evidence: string,
  subBullets: string[] = [],
): KeyTakeawaysItem {
  return {
    point,
    slide,
    evidence,
    subBullets,
    status: "verified",
    verdict: "SUPPORTED",
  };
}

// ============================================================================
// DECK 1 — Corporate Finance: Stock Valuation & DDM (Ch. 9)
// ============================================================================

const DECK_1_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Corporate Finance: Chapter 9 Stock Valuation. Stock valuation is based on the principle that the value of any financial asset equals the present value of all its expected future cash flows. For common stock, cash flows consist of dividends and the future sale price.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "One-Period Valuation Model. If an investor plans to hold a share of stock for one year, the current price P_0 is the discounted value of the expected dividend D_1 and expected stock price P_1 at the end of year 1: P_0 = (D_1 + P_1) / (1 + R), where R is the required rate of return.",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "Multi-Period Dividend Discount Model (DDM). Extending to an infinite holding period, the current stock price equals the sum of all discounted future dividends: P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}. The value of the firm depends purely on the stream of future dividends.",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "Case 1: Zero Growth Dividend Model. When dividends are constant forever (zero growth, g = 0), the stock behaves as a perpetuity: P_0 = D / R. This model commonly applies to mature utilities and preference shares with fixed dividend payments.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Case 2: Constant Growth (Gordon Growth Model). When dividends grow at a constant rate g indefinitely: D_1 = D_0 \\times (1 + g). The Gordon growth formula states: P_0 = D_1 / (R - g). Crucial boundary condition: the required return R must be strictly greater than the growth rate g (R > g), otherwise the formula produces nonsense.",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Case 3: Non-Constant (Supernormal) Growth. For companies experiencing rapid initial growth g_1 for T periods followed by constant growth g_2: P_0 = \\sum_{t=1}^T \\frac{D_t}{(1 + R)^t} + \\frac{P_T}{(1 + R)^T}, where the terminal price is P_T = D_{T+1} / (R - g_2).",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "Estimating Growth Rate (g). The sustainable growth rate depends on firm profitability and retention: g = b \\times ROE, where b is the retention ratio (plowback ratio = 1 - payout ratio) and ROE is return on equity.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "Required Return Decomposition. Solving the Gordon growth model for R yields the total expected return: R = D_1 / P_0 + g. The return consists of two distinct components: the dividend yield (D_1 / P_0) and the capital gains yield (g).",
  },
  {
    id: "slide-9",
    label: "Slide 9",
    text: "Valuation of Preference Shares. Preference shares pay a fixed dividend D with no maturity date: P_0 = D / R. Preferred stock is valued as a zero-growth perpetuity with priority over common equity in liquidation.",
  },
  {
    id: "slide-10",
    label: "Slide 10",
    text: "Practice Problem: Company XYZ pays a next dividend of $2.50. The required return is 10% and growth is 5%. P_0 = 2.50 / (0.10 - 0.05) = $50. Calculate the stock price.",
  },
];

const DECK_1_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "P_0 = (D_1 + P_1) / (1 + R)",
    latex: "P_0 = \\frac{D_1 + P_1}{1 + R}",
    origin: "text",
    label: "One-Period Valuation Model",
    evidence: "P_0 = (D_1 + P_1) / (1 + R)",
    variables: [
      { symbol: "P_0", definition: "Current stock price today" },
      { symbol: "D_1", definition: "Expected dividend at end of year 1" },
      { symbol: "P_1", definition: "Expected stock price at end of year 1" },
      { symbol: "R", definition: "Required rate of return" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}",
    latex: "P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}",
    origin: "text",
    label: "General Dividend Discount Model",
    evidence: "P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}",
    variables: [
      { symbol: "P_0", definition: "Current stock price today" },
      { symbol: "D_t", definition: "Expected dividend at year t" },
      { symbol: "R", definition: "Required discount rate" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "P_0 = D / R",
    latex: "P_0 = \\frac{D}{R}",
    origin: "text",
    label: "Zero Growth Model",
    evidence: "P_0 = D / R",
    variables: [
      { symbol: "P_0", definition: "Current stock price" },
      { symbol: "D", definition: "Constant annual dividend" },
      { symbol: "R", definition: "Required rate of return" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "P_0 = D_1 / (R - g)",
    latex: "P_0 = \\frac{D_1}{R - g}",
    origin: "text",
    label: "Gordon Growth Model",
    evidence: "P_0 = D_1 / (R - g)",
    variables: [
      { symbol: "P_0", definition: "Current stock price" },
      { symbol: "D_1", definition: "Next period expected dividend" },
      { symbol: "R", definition: "Required return" },
      { symbol: "g", definition: "Constant dividend growth rate" },
    ],
  },
  {
    id: "F5",
    slide: 5,
    raw: "D_1 = D_0 \\times (1 + g)",
    latex: "D_1 = D_0(1 + g)",
    origin: "text",
    label: "Dividend Growth Relation",
    evidence: "D_1 = D_0 \\times (1 + g)",
    variables: [
      { symbol: "D_1", definition: "Next period dividend" },
      { symbol: "D_0", definition: "Most recent dividend paid today" },
      { symbol: "g", definition: "Growth rate" },
    ],
  },
  {
    id: "F6",
    slide: 6,
    raw: "P_0 = \\sum_{t=1}^T \\frac{D_t}{(1 + R)^t} + \\frac{P_T}{(1 + R)^T}",
    latex: "P_0 = \\sum_{t=1}^T \\frac{D_t}{(1 + R)^t} + \\frac{P_T}{(1 + R)^T}",
    origin: "text",
    label: "Non-Constant Growth Valuation",
    evidence: "P_0 = \\sum_{t=1}^T \\frac{D_t}{(1 + R)^t} + \\frac{P_T}{(1 + R)^T}",
    variables: [
      { symbol: "P_0", definition: "Current stock price" },
      { symbol: "D_t", definition: "Dividend at year t during high growth" },
      { symbol: "P_T", definition: "Terminal stock price at horizon T" },
      { symbol: "R", definition: "Required return" },
    ],
  },
  {
    id: "F7",
    slide: 6,
    raw: "P_T = D_{T+1} / (R - g_2)",
    latex: "P_T = \\frac{D_{T+1}}{R - g_2}",
    origin: "text",
    label: "Terminal Price Formula",
    evidence: "P_T = D_{T+1} / (R - g_2)",
    variables: [
      { symbol: "P_T", definition: "Terminal price at time T" },
      { symbol: "D_{T+1}", definition: "Dividend paid at year T+1" },
      { symbol: "g_2", definition: "Perpetual long-term growth rate" },
    ],
  },
  {
    id: "F8",
    slide: 7,
    raw: "g = b \\times ROE",
    latex: "g = b \\times \\text{ROE}",
    origin: "text",
    label: "Sustainable Growth Rate",
    evidence: "g = b \\times ROE",
    variables: [
      { symbol: "g", definition: "Sustainable growth rate" },
      { symbol: "b", definition: "Retention ratio (1 - dividend payout ratio)" },
      { symbol: "ROE", definition: "Return on equity" },
    ],
  },
  {
    id: "F9",
    slide: 8,
    raw: "R = D_1 / P_0 + g",
    latex: "R = \\frac{D_1}{P_0} + g",
    origin: "text",
    label: "Required Return Decomposition",
    evidence: "R = D_1 / P_0 + g",
    variables: [
      { symbol: "R", definition: "Total required return" },
      { symbol: "D_1 / P_0", definition: "Dividend yield" },
      { symbol: "g", definition: "Capital gains yield" },
    ],
  },
  {
    id: "F10",
    slide: 9,
    raw: "P_0 = D / R",
    latex: "P_0 = \\frac{D}{R}",
    origin: "text",
    label: "Preferred Stock Valuation",
    evidence: "P_0 = D / R",
    variables: [
      { symbol: "P_0", definition: "Preference share price" },
      { symbol: "D", definition: "Fixed preferred dividend" },
      { symbol: "R", definition: "Required return on preferred stock" },
    ],
  },
  {
    id: "F11",
    slide: 10,
    raw: "P_0 = 2.50 / (0.10 - 0.05)",
    latex: "P_0 = \\frac{2.50}{0.10 - 0.05}",
    origin: "text",
    label: "Exercise Calculation",
    isExerciseOnly: true,
    evidence: "P_0 = 2.50 / (0.10 - 0.05) = $50",
    variables: [],
  },
];

export const DECK_1_STOCK_VALUATION: GoldenDeckDefinition = {
  id: "deck-1-stock-valuation",
  title: "Stock Valuation & Dividend Discount Models",
  subject: "Corporate Finance",
  slideCount: 10,
  sources: DECK_1_SOURCES,
  expectedLedger: DECK_1_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"],
  validOmittedFormulaIds: ["F10", "F11"],
  forbiddenInjectedFormulas: [
    "P_N = \\frac{D_{N+1}}{R - g}",
    "g = \\frac{P_1 - P_0}{P_0}",
    "\\text{Dividend Yield} = \\frac{D_1}{P_0}",
  ],
  goldNote: createGoldNote({
    id: "note-deck-1",
    title: "CHAPTER 9: STOCK VALUATION & DDM",
    subject: "Corporate Finance",
    originalFileName: "corporate-finance-ch09.pptx",
    originalSlideCount: 10,
    executiveSummary:
      "Comprehensive study guide covering common stock valuation, single and multi-period dividend discount models, Gordon growth model, non-constant growth, and required return decomposition.",
    formulaLedger: DECK_1_LEDGER,
    omitted: [
      {
        formulaId: "F10",
        reason: "Duplicate identical mathematical form of zero-growth perpetuity formula F3 already presented in Section C",
      },
      {
        formulaId: "F11",
        reason: "Numerical exercise plug-in formula omitted from conceptual formulas",
      },
    ],
    sections: [
      createSection({
        id: "sec-1-a",
        letter: "A",
        titleVi: "A. NGUYÊN LÝ CƠ BẢN VỀ ĐỊNH GIÁ CỔ PHIẾU",
        titleEn: "Fundamentals of Stock Valuation",
        coreStatement:
          "The value of any financial asset equals the present value of all its expected future cash flows.",
        overview: "Common stock valuation relies on discounting cash flows received by investors:",
        bulletPoints: [
          "Cash flows consist of dividends and the future sale price",
          "Discount rate reflects the risk of the cash flow stream",
        ],
        groundedBullets: [
          createGroundedBullet(
            "Value of any financial asset equals the present value of all its expected future cash flows",
            1,
            "value of any financial asset equals the present value of all its expected future cash flows",
          ),
          createGroundedBullet(
            "For common stock, cash flows consist of dividends and the future sale price",
            1,
            "For common stock, cash flows consist of dividends and the future sale price",
          ),
        ],
        sourceSlides: [1],
      }),
      createSection({
        id: "sec-1-b",
        letter: "B",
        titleVi: "B. MÔ HÌNH ĐỊNH GIÁ TỔNG QUÁT (DDM)",
        titleEn: "General Dividend Discount Models",
        overview: "Valuation models based on investment holding horizon:",
        formulas: [
          createFormula({
            leadText: "One-period holding valuation:",
            latex: "P_0 = \\frac{D_1 + P_1}{1 + R}",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [
              { symbol: "P_0", definition: "Current stock price today" },
              { symbol: "D_1", definition: "Expected dividend at end of year 1" },
              { symbol: "P_1", definition: "Expected stock price at end of year 1" },
              { symbol: "R", definition: "Required rate of return" },
            ],
          }),
          createFormula({
            leadText: "Multi-period general dividend discount model:",
            latex: "P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [
              { symbol: "D_t", definition: "Expected dividend at year t" },
            ],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Investor holding for one year discounts expected dividend D_1 and sale price P_1",
            2,
            "current price P_0 is the discounted value of the expected dividend D_1 and expected stock price P_1 at the end of year 1",
          ),
          createGroundedBullet(
            "Extending to an infinite horizon, stock price equals the sum of all discounted future dividends",
            3,
            "current stock price equals the sum of all discounted future dividends",
          ),
        ],
        sourceSlides: [2, 3],
      }),
      createSection({
        id: "sec-1-c",
        letter: "C",
        titleVi: "C. CÁC TRƯỜNG HỢP TĂNG TRƯỞNG CỔ TỨC (DDM CASES)",
        titleEn: "Dividend Growth Model Cases",
        overview: "Depending on dividend growth behavior, DDM branches into three primary cases:",
        subSections: [
          {
            heading: "Case 1: Zero Growth Dividend Model",
            leadIn: "When dividends remain constant forever:",
            bulletPoints: ["Dividends are constant forever like a perpetuity"],
            groundedBullets: [
              createGroundedBullet(
                "When dividends are constant forever (zero growth, g = 0), the stock behaves as a perpetuity",
                4,
                "When dividends are constant forever (zero growth, g = 0), the stock behaves as a perpetuity",
              ),
            ],
            formulas: [
              createFormula({
                latex: "P_0 = \\frac{D}{R}",
                formulaRefs: ["F3"],
                slide: 4,
                variables: [
                  { symbol: "D", definition: "Constant annual dividend" },
                  { symbol: "R", definition: "Required rate of return" },
                ],
              }),
            ],
          },
          {
            heading: "Case 2: Constant Growth (Gordon Growth Model)",
            leadIn: "When dividends grow at a constant rate indefinitely:",
            bulletPoints: [
              "Dividends grow at a constant rate g indefinitely",
              "Boundary condition: required return R must exceed growth rate g",
            ],
            groundedBullets: [
              createGroundedBullet(
                "When dividends grow at a constant rate g indefinitely: D_1 = D_0 * (1 + g)",
                5,
                "When dividends grow at a constant rate g indefinitely: D_1 = D_0 \\times (1 + g)",
              ),
              createGroundedBullet(
                "Crucial boundary condition: the required return R must be strictly greater than the growth rate g",
                5,
                "required return R must be strictly greater than the growth rate g (R > g)",
              ),
            ],
            formulas: [
              createFormula({
                leadText: "Next period dividend relation:",
                latex: "D_1 = D_0(1 + g)",
                formulaRefs: ["F5"],
                slide: 5,
                variables: [{ symbol: "D_0", definition: "Most recent dividend paid today" }],
              }),
              createFormula({
                leadText: "Gordon constant growth model:",
                latex: "P_0 = \\frac{D_1}{R - g}",
                formulaRefs: ["F4"],
                slide: 5,
                variables: [{ symbol: "g", definition: "Constant dividend growth rate" }],
              }),
            ],
          },
          {
            heading: "Case 3: Non-Constant (Supernormal) Growth",
            leadIn: "When a firm experiences temporary rapid growth followed by constant growth:",
            bulletPoints: [
              "Discount individual non-constant dividends during supernormal period",
              "Calculate terminal value at horizon T using constant growth formula",
            ],
            groundedBullets: [
              createGroundedBullet(
                "For companies experiencing rapid initial growth g_1 for T periods followed by constant growth g_2",
                6,
                "companies experiencing rapid initial growth g_1 for T periods followed by constant growth g_2",
              ),
            ],
            formulas: [
              createFormula({
                leadText: "Non-constant valuation equation:",
                latex: "P_0 = \\sum_{t=1}^T \\frac{D_t}{(1 + R)^t} + \\frac{P_T}{(1 + R)^T}",
                formulaRefs: ["F6"],
                slide: 6,
                variables: [
                  { symbol: "P_T", definition: "Terminal price at horizon T" },
                ],
              }),
              createFormula({
                leadText: "Terminal price formula:",
                latex: "P_T = \\frac{D_{T+1}}{R - g_2}",
                formulaRefs: ["F7"],
                slide: 6,
                variables: [
                  { symbol: "D_{T+1}", definition: "Dividend at year T+1" },
                  { symbol: "g_2", definition: "Perpetual long-term growth rate" },
                ],
              }),
            ],
          },
        ],
        sourceSlides: [4, 5, 6],
      }),
      createSection({
        id: "sec-1-d",
        letter: "D",
        titleVi: "D. ƯỚC LƯỢNG TỐC ĐỘ TĂNG TRƯỞNG VÀ LỢI SUẤT ĐÒI HỎI",
        titleEn: "Estimating Growth Rate and Required Return",
        overview: "Determining key parameters for stock valuation models:",
        formulas: [
          createFormula({
            leadText: "Sustainable growth rate formula:",
            latex: "g = b \\times \\text{ROE}",
            formulaRefs: ["F8"],
            slide: 7,
            variables: [
              { symbol: "b", definition: "Retention ratio (plowback ratio)" },
              { symbol: "ROE", definition: "Return on equity" },
            ],
          }),
          createFormula({
            leadText: "Required return decomposition:",
            latex: "R = \\frac{D_1}{P_0} + g",
            formulaRefs: ["F9"],
            slide: 8,
            variables: [
              { symbol: "D_1 / P_0", definition: "Dividend yield" },
              { symbol: "g", definition: "Capital gains yield" },
            ],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "The sustainable growth rate depends on firm profitability and retention: g = b * ROE",
            7,
            "sustainable growth rate depends on firm profitability and retention: g = b \\times ROE",
          ),
          createGroundedBullet(
            "Return consists of two distinct components: the dividend yield (D_1 / P_0) and the capital gains yield (g)",
            8,
            "return consists of two distinct components: the dividend yield (D_1 / P_0) and the capital gains yield (g)",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "Asset value equals the present value of expected future cash flows",
            "Make sure R > g in the Gordon growth model",
            "Required return decomposes into dividend yield and capital gains yield",
          ],
          items: [
            createTakeawayItem(
              "Stock valuation equals the present value of future cash flows",
              1,
              "value of any financial asset equals the present value of all its expected future cash flows",
              ["Short term → D_1 and P_1", "Infinite horizon → Sum of all dividends"],
            ),
            createTakeawayItem(
              "Make sure R > g, otherwise the constant growth model breaks down",
              5,
              "required return R must be strictly greater than the growth rate g (R > g), otherwise the formula produces nonsense",
            ),
            createTakeawayItem(
              "Total return decomposes into dividend yield and capital gains yield",
              8,
              "return consists of two distinct components: the dividend yield (D_1 / P_0) and the capital gains yield (g)",
            ),
          ],
        },
        sourceSlides: [7, 8],
      }),
    ],
  }),
};

// ============================================================================
// DECK 2 — Corporate Finance: Risk, Return & CAPM (Ch. 10-11)
// ============================================================================

const DECK_2_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Corporate Finance: Risk, Return and the Capital Asset Pricing Model. In financial markets, there is a fundamental trade-off between risk and return: higher expected returns require taking on greater risk. Risk is measured by the dispersion of possible returns around the mean.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "Expected Return. The expected return on an investment is the weighted average of possible returns in different states of the economy: E(R) = \\sum P_i R_i, where P_i is the probability of scenario i and R_i is the return in scenario i.",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "Historical Sample Variance and Standard Deviation. For historical time series data, sample variance uses the Bessel correction dividing by T - 1: s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2. Standard deviation s is the square root of sample variance.",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "Scenario Variance. When analyzing future probability distributions, scenario variance measures dispersion: \\sigma^2 = \\sum P_i (R_i - E(R))^2. The scenario standard deviation \\sigma is the square root of \\sigma^2.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Portfolio Expected Return. The expected return of a portfolio is the weighted average of the expected returns of the individual assets: E(R_p) = w_A E(R_A) + w_B E(R_B), where portfolio weights sum to 1: w_A + w_B = 1.",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Diversification and Portfolio Variance. Covariance measures how two asset returns move together: Cov(A,B) = \\rho_{AB} \\sigma_A \\sigma_B. The portfolio variance for a two-asset portfolio is: \\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B Cov(A,B). When correlation \\rho < 1, diversification reduces portfolio risk.",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "Systematic Risk and Beta. Systematic risk cannot be diversified away. The beta coefficient measures the sensitivity of an asset's returns to market movements: \\beta_i = \\frac{Cov(R_i, R_M)}{\\sigma_M^2}. The market portfolio has a beta of 1.0.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "Capital Asset Pricing Model (CAPM). The Security Market Line (SML) defines the relationship between expected return and systematic risk: E(R_i) = R_f + \\beta_i (E(R_M) - R_f). Expected return equals the risk-free rate R_f plus a risk premium proportional to beta.",
  },
  {
    id: "slide-9",
    label: "Slide 9",
    text: "Portfolio Beta. The beta of a portfolio is simply the weighted average of the betas of the individual securities: \\beta_p = w_A \\beta_A + w_B \\beta_B.",
  },
  {
    id: "slide-10",
    label: "Slide 10",
    text: "Practice Problem: Risk-free rate is 4%, market risk premium is 6%, stock beta is 1.2. E(R) = 0.04 + 1.2 \\times (0.10 - 0.04) = 11.2%. Calculate expected return.",
  },
];

const DECK_2_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "E(R) = \\sum P_i R_i",
    latex: "E(R) = \\sum P_i R_i",
    origin: "text",
    label: "Expected Return",
    evidence: "E(R) = \\sum P_i R_i",
    variables: [
      { symbol: "E(R)", definition: "Expected return" },
      { symbol: "P_i", definition: "Probability of scenario i" },
      { symbol: "R_i", definition: "Return in scenario i" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2",
    latex: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2",
    origin: "text",
    label: "Sample Variance (Bessel Corrected)",
    evidence: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2",
    variables: [
      { symbol: "s^2", definition: "Sample variance" },
      { symbol: "T", definition: "Number of historical periods" },
      { symbol: "R_t", definition: "Return in period t" },
      { symbol: "\\bar{R}", definition: "Sample average mean return" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "\\sigma^2 = \\sum P_i (R_i - E(R))^2",
    latex: "\\sigma^2 = \\sum P_i (R_i - E(R))^2",
    origin: "text",
    label: "Scenario Variance",
    evidence: "\\sigma^2 = \\sum P_i (R_i - E(R))^2",
    variables: [
      { symbol: "\\sigma^2", definition: "Population scenario variance" },
      { symbol: "P_i", definition: "Probability of state i" },
      { symbol: "E(R)", definition: "Expected return" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "E(R_p) = w_A E(R_A) + w_B E(R_B)",
    latex: "E(R_p) = w_A E(R_A) + w_B E(R_B)",
    origin: "text",
    label: "Portfolio Expected Return",
    evidence: "E(R_p) = w_A E(R_A) + w_B E(R_B)",
    variables: [
      { symbol: "E(R_p)", definition: "Portfolio expected return" },
      { symbol: "w_A", definition: "Portfolio weight of asset A" },
      { symbol: "w_B", definition: "Portfolio weight of asset B" },
    ],
  },
  {
    id: "F5",
    slide: 6,
    raw: "Cov(A,B) = \\rho_{AB} \\sigma_A \\sigma_B",
    latex: "\\text{Cov}(A,B) = \\rho_{AB} \\sigma_A \\sigma_B",
    origin: "text",
    label: "Covariance Relation",
    evidence: "Cov(A,B) = \\rho_{AB} \\sigma_A \\sigma_B",
    variables: [
      { symbol: "\\text{Cov}(A,B)", definition: "Covariance between assets A and B" },
      { symbol: "\\rho_{AB}", definition: "Correlation coefficient" },
      { symbol: "\\sigma_A", definition: "Standard deviation of asset A" },
      { symbol: "\\sigma_B", definition: "Standard deviation of asset B" },
    ],
  },
  {
    id: "F6",
    slide: 6,
    raw: "\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B Cov(A,B)",
    latex: "\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(A,B)",
    origin: "text",
    label: "Two-Asset Portfolio Variance",
    evidence: "\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B Cov(A,B)",
    variables: [
      { symbol: "\\sigma_p^2", definition: "Portfolio variance" },
      { symbol: "w_A", definition: "Weight of asset A" },
      { symbol: "w_B", definition: "Weight of asset B" },
    ],
  },
  {
    id: "F7",
    slide: 7,
    raw: "\\beta_i = \\frac{Cov(R_i, R_M)}{\\sigma_M^2}",
    latex: "\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}",
    origin: "text",
    label: "Beta Coefficient",
    evidence: "\\beta_i = \\frac{Cov(R_i, R_M)}{\\sigma_M^2}",
    variables: [
      { symbol: "\\beta_i", definition: "Beta of asset i" },
      { symbol: "\\text{Cov}(R_i, R_M)", definition: "Covariance between asset i and market" },
      { symbol: "\\sigma_M^2", definition: "Variance of the market portfolio" },
    ],
  },
  {
    id: "F8",
    slide: 8,
    raw: "E(R_i) = R_f + \\beta_i (E(R_M) - R_f)",
    latex: "E(R_i) = R_f + \\beta_i (E(R_M) - R_f)",
    origin: "text",
    label: "CAPM Security Market Line",
    evidence: "E(R_i) = R_f + \\beta_i (E(R_M) - R_f)",
    variables: [
      { symbol: "E(R_i)", definition: "Expected return on asset i" },
      { symbol: "R_f", definition: "Risk-free rate" },
      { symbol: "\\beta_i", definition: "Beta coefficient" },
      { symbol: "E(R_M) - R_f", definition: "Market risk premium" },
    ],
  },
  {
    id: "F9",
    slide: 9,
    raw: "\\beta_p = w_A \\beta_A + w_B \\beta_B",
    latex: "\\beta_p = w_A \\beta_A + w_B \\beta_B",
    origin: "text",
    label: "Portfolio Beta",
    evidence: "\\beta_p = w_A \\beta_A + w_B \\beta_B",
    variables: [
      { symbol: "\\beta_p", definition: "Beta of portfolio" },
      { symbol: "\\beta_A", definition: "Beta of asset A" },
      { symbol: "\\beta_B", definition: "Beta of asset B" },
    ],
  },
  {
    id: "F10",
    slide: 10,
    raw: "E(R) = 0.04 + 1.2 \\times (0.10 - 0.04)",
    latex: "E(R) = 0.04 + 1.2(0.10 - 0.04)",
    origin: "text",
    label: "CAPM Exercise Plug-in",
    isExerciseOnly: true,
    evidence: "E(R) = 0.04 + 1.2 \\times (0.10 - 0.04) = 11.2%",
    variables: [],
  },
];

export const DECK_2_RISK_AND_RETURN: GoldenDeckDefinition = {
  id: "deck-2-risk-and-return",
  title: "Risk, Return & Capital Asset Pricing Model",
  subject: "Corporate Finance",
  slideCount: 10,
  sources: DECK_2_SOURCES,
  expectedLedger: DECK_2_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"],
  validOmittedFormulaIds: ["F10"],
  forbiddenInjectedFormulas: [
    "\\text{Sharpe} = \\frac{E(R_p) - R_f}{\\sigma_p}",
    "\\text{Treynor} = \\frac{E(R_p) - R_f}{\\beta_p}",
    "E(R_i) = R_f + \\beta_1 F_1 + \\beta_2 F_2",
  ],
  goldNote: createGoldNote({
    id: "note-deck-2",
    title: "CHAPTERS 10-11: RISK, RETURN & CAPM",
    subject: "Corporate Finance",
    originalFileName: "corporate-finance-ch10-11.pptx",
    originalSlideCount: 10,
    executiveSummary:
      "Core principles of risk and return, sample vs scenario variance, portfolio diversification, beta coefficient, and the Capital Asset Pricing Model (CAPM).",
    formulaLedger: DECK_2_LEDGER,
    omitted: [
      {
        formulaId: "F10",
        reason: "Numerical plug-in exercise omitted from core summary note",
      },
    ],
    sections: [
      createSection({
        id: "sec-2-a",
        letter: "A",
        titleVi: "A. ĐO LƯỜNG TỶ SUẤT SINH LỜI VÀ RỦI RO ĐƠN LẺ",
        titleEn: "Measuring Return and Standalone Risk",
        coreStatement:
          "In financial markets, there is a fundamental trade-off between risk and return: higher expected returns require taking on greater risk.",
        overview: "Expected returns and dispersion metrics for standalone assets:",
        formulas: [
          createFormula({
            leadText: "Expected return across economic scenarios:",
            latex: "E(R) = \\sum P_i R_i",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [
              { symbol: "E(R)", definition: "Expected return" },
              { symbol: "P_i", definition: "Probability of scenario i" },
              { symbol: "R_i", definition: "Return in scenario i" },
            ],
          }),
          createFormula({
            leadText: "Historical sample variance (Bessel corrected):",
            latex: "s^2 = \\frac{1}{T - 1} \\sum_{t=1}^T (R_t - \\bar{R})^2",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [
              { symbol: "s^2", definition: "Sample variance" },
              { symbol: "T", definition: "Number of historical periods" },
              { symbol: "\\bar{R}", definition: "Sample mean return" },
            ],
          }),
          createFormula({
            leadText: "Scenario probability variance:",
            latex: "\\sigma^2 = \\sum P_i (R_i - E(R))^2",
            formulaRefs: ["F3"],
            slide: 4,
            variables: [{ symbol: "\\sigma^2", definition: "Scenario variance" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Expected return on an investment is the weighted average of possible returns in different states",
            2,
            "expected return on an investment is the weighted average of possible returns in different states of the economy",
          ),
          createGroundedBullet(
            "For historical time series data, sample variance uses the Bessel correction dividing by T - 1",
            3,
            "sample variance uses the Bessel correction dividing by T - 1",
          ),
        ],
        sourceSlides: [1, 2, 3, 4],
      }),
      createSection({
        id: "sec-2-b",
        letter: "B",
        titleVi: "B. LÝ THUYẾT DANH MỤC ĐẦU TƯ VÀ ĐA DẠNG HÓA",
        titleEn: "Portfolio Theory and Diversification",
        overview: "Risk and return dynamics when combining assets into portfolios:",
        formulas: [
          createFormula({
            leadText: "Portfolio expected return:",
            latex: "E(R_p) = w_A E(R_A) + w_B E(R_B)",
            formulaRefs: ["F4"],
            slide: 5,
            variables: [
              { symbol: "E(R_p)", definition: "Portfolio expected return" },
              { symbol: "w_A", definition: "Weight of asset A" },
            ],
          }),
          createFormula({
            leadText: "Covariance relation:",
            latex: "\\text{Cov}(A,B) = \\rho_{AB} \\sigma_A \\sigma_B",
            formulaRefs: ["F5"],
            slide: 6,
            variables: [
              { symbol: "\\text{Cov}(A,B)", definition: "Covariance between assets A and B" },
              { symbol: "\\rho_{AB}", definition: "Correlation coefficient" },
            ],
          }),
          createFormula({
            leadText: "Two-asset portfolio variance:",
            latex: "\\sigma_p^2 = w_A^2 \\sigma_A^2 + w_B^2 \\sigma_B^2 + 2 w_A w_B \\text{Cov}(A,B)",
            formulaRefs: ["F6"],
            slide: 6,
            variables: [{ symbol: "\\sigma_p^2", definition: "Portfolio variance" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Expected return of a portfolio is the weighted average of the expected returns of the individual assets",
            5,
            "expected return of a portfolio is the weighted average of the expected returns of the individual assets",
          ),
          createGroundedBullet(
            "When correlation rho < 1, diversification reduces portfolio risk",
            6,
            "When correlation \\rho < 1, diversification reduces portfolio risk",
          ),
        ],
        sourceSlides: [5, 6],
      }),
      createSection({
        id: "sec-2-c",
        letter: "C",
        titleVi: "C. HỆ SỐ BETA VÀ MÔ HÌNH ĐỊNH GIÁ TÀI SẢN VỐN (CAPM)",
        titleEn: "Beta Coefficient and the CAPM Model",
        overview: "Systematic risk pricing on the Security Market Line:",
        formulas: [
          createFormula({
            leadText: "Beta coefficient of systematic risk:",
            latex: "\\beta_i = \\frac{\\text{Cov}(R_i, R_M)}{\\sigma_M^2}",
            formulaRefs: ["F7"],
            slide: 7,
            variables: [
              { symbol: "\\beta_i", definition: "Beta of asset i" },
              { symbol: "\\sigma_M^2", definition: "Variance of the market portfolio" },
            ],
          }),
          createFormula({
            leadText: "Capital Asset Pricing Model (SML):",
            latex: "E(R_i) = R_f + \\beta_i (E(R_M) - R_f)",
            formulaRefs: ["F8"],
            slide: 8,
            variables: [
              { symbol: "R_f", definition: "Risk-free rate" },
              { symbol: "E(R_M) - R_f", definition: "Market risk premium" },
            ],
          }),
          createFormula({
            leadText: "Portfolio beta:",
            latex: "\\beta_p = w_A \\beta_A + w_B \\beta_B",
            formulaRefs: ["F9"],
            slide: 9,
            variables: [{ symbol: "\\beta_p", definition: "Portfolio beta" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Systematic risk cannot be diversified away",
            7,
            "Systematic risk cannot be diversified away",
          ),
          createGroundedBullet(
            "The Security Market Line (SML) defines the relationship between expected return and systematic risk",
            8,
            "Security Market Line (SML) defines the relationship between expected return and systematic risk",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "Diversification eliminates unsystematic risk but cannot eliminate systematic market risk",
            "Beta measures market risk; the market portfolio has beta = 1.0",
            "CAPM states expected return equals risk-free rate plus beta times market risk premium",
          ],
          items: [
            createTakeawayItem(
              "Diversification reduces portfolio risk when correlation is less than 1",
              6,
              "When correlation \\rho < 1, diversification reduces portfolio risk",
            ),
            createTakeawayItem(
              "Systematic risk is priced by the market via the beta coefficient",
              7,
              "The beta coefficient measures the sensitivity of an asset's returns to market movements",
            ),
            createTakeawayItem(
              "CAPM provides the benchmark required return for any asset based on its beta",
              8,
              "Expected return equals the risk-free rate R_f plus a risk premium proportional to beta",
            ),
          ],
        },
        sourceSlides: [7, 8, 9],
      }),
    ],
  }),
};

// ============================================================================
// DECK 3 — Corporate Finance: Cost of Capital & WACC (Ch. 14)
// ============================================================================

const DECK_3_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Corporate Finance Chapter 14: Cost of Capital and WACC. The cost of capital is the minimum required rate of return that a firm must earn on its investments to maintain its market value and satisfy investors. It represents the opportunity cost of financing projects.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "Cost of Equity via Dividend Growth Model. The cost of equity R_E can be estimated using the dividend growth model: R_E = D_1 / P_0 + g. This method is straightforward for firms paying regular, growing dividends.",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "Cost of Equity via SML / CAPM. The SML approach estimates the cost of equity from systematic risk: R_E = R_f + \\beta_E (E(R_M) - R_f). This method adjusts explicitly for systematic risk and applies to firms that do not pay dividends.",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "Cost of Preferred Stock. Preferred stock pays a fixed dividend D per share: R_P = D / P_0. Because preferred dividends are not tax deductible, there is no corporate tax adjustment for preferred equity.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Cost of Debt and After-Tax Cost of Debt. The pre-tax cost of debt R_D is the yield to maturity on new debt. Because interest expense is tax-deductible, the effective after-tax cost of debt is: \\text{After-tax } R_D = R_D (1 - T_C), where T_C is the corporate tax rate.",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Firm Total Market Value. The total market value of the firm is the sum of market values of all financing sources: V = E + P + D, where E is market value of equity, P is market value of preferred stock, and D is market value of debt.",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "Capital Structure Weights. Financing weights are calculated using market values: E/V + P/V + D/V = 1. Book values should not be used when market values are available.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "Weighted Average Cost of Capital (WACC). The overall cost of capital is the weighted average of each capital component: WACC = (E/V) R_E + (P/V) R_P + (D/V) R_D (1 - T_C). WACC is the appropriate hurdle rate for average-risk projects.",
  },
  {
    id: "slide-9",
    label: "Slide 9",
    text: "Exercise: Firm with 60% equity and 40% debt. R_E = 12%, R_D = 8%, tax rate T_C = 25%. WACC = 0.60 \\times 0.12 + 0.40 \\times 0.08 \\times (1 - 0.25) = 9.6%.",
  },
];

const DECK_3_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "R_E = D_1 / P_0 + g",
    latex: "R_E = \\frac{D_1}{P_0} + g",
    origin: "text",
    label: "Cost of Equity (DGM Approach)",
    evidence: "R_E = D_1 / P_0 + g",
    variables: [
      { symbol: "R_E", definition: "Cost of equity" },
      { symbol: "D_1", definition: "Next period dividend" },
      { symbol: "P_0", definition: "Current stock price" },
      { symbol: "g", definition: "Dividend growth rate" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "R_E = R_f + \\beta_E (E(R_M) - R_f)",
    latex: "R_E = R_f + \\beta_E (E(R_M) - R_f)",
    origin: "text",
    label: "Cost of Equity (SML Approach)",
    evidence: "R_E = R_f + \\beta_E (E(R_M) - R_f)",
    variables: [
      { symbol: "R_E", definition: "Cost of equity" },
      { symbol: "R_f", definition: "Risk-free rate" },
      { symbol: "\\beta_E", definition: "Equity beta" },
      { symbol: "E(R_M) - R_f", definition: "Market risk premium" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "R_P = D / P_0",
    latex: "R_P = \\frac{D}{P_0}",
    origin: "text",
    label: "Cost of Preferred Stock",
    evidence: "R_P = D / P_0",
    variables: [
      { symbol: "R_P", definition: "Cost of preferred stock" },
      { symbol: "D", definition: "Fixed preferred dividend" },
      { symbol: "P_0", definition: "Market price of preferred share" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "R_D (1 - T_C)",
    latex: "R_D(1 - T_C)",
    origin: "text",
    label: "After-Tax Cost of Debt",
    evidence: "R_D (1 - T_C)",
    variables: [
      { symbol: "R_D", definition: "Pre-tax cost of debt (YTM)" },
      { symbol: "T_C", definition: "Corporate tax rate" },
    ],
  },
  {
    id: "F5",
    slide: 6,
    raw: "V = E + P + D",
    latex: "V = E + P + D",
    origin: "text",
    label: "Total Market Value of Firm",
    evidence: "V = E + P + D",
    variables: [
      { symbol: "V", definition: "Total market value of firm" },
      { symbol: "E", definition: "Market value of common equity" },
      { symbol: "P", definition: "Market value of preferred stock" },
      { symbol: "D", definition: "Market value of debt" },
    ],
  },
  {
    id: "F6",
    slide: 7,
    raw: "E/V + P/V + D/V = 1",
    latex: "\\frac{E}{V} + \\frac{P}{V} + \\frac{D}{V} = 1",
    origin: "text",
    label: "Capital Structure Weights",
    evidence: "E/V + P/V + D/V = 1",
    variables: [
      { symbol: "E/V", definition: "Equity weight" },
      { symbol: "P/V", definition: "Preferred stock weight" },
      { symbol: "D/V", definition: "Debt weight" },
    ],
  },
  {
    id: "F7",
    slide: 8,
    raw: "WACC = (E/V) R_E + (P/V) R_P + (D/V) R_D (1 - T_C)",
    latex: "\\text{WACC} = \\frac{E}{V} R_E + \\frac{P}{V} R_P + \\frac{D}{V} R_D(1 - T_C)",
    origin: "text",
    label: "Weighted Average Cost of Capital",
    evidence: "WACC = (E/V) R_E + (P/V) R_P + (D/V) R_D (1 - T_C)",
    variables: [
      { symbol: "\\text{WACC}", definition: "Weighted average cost of capital" },
      { symbol: "R_E", definition: "Cost of equity" },
      { symbol: "R_P", definition: "Cost of preferred stock" },
      { symbol: "R_D", definition: "Pre-tax cost of debt" },
      { symbol: "T_C", definition: "Corporate tax rate" },
    ],
  },
  {
    id: "F8",
    slide: 9,
    raw: "WACC = 0.60 \\times 0.12 + 0.40 \\times 0.08 \\times (1 - 0.25)",
    latex: "\\text{WACC} = 0.60(0.12) + 0.40(0.08)(1 - 0.25)",
    origin: "text",
    label: "WACC Numerical Plug-in",
    isExerciseOnly: true,
    evidence: "WACC = 0.60 \\times 0.12 + 0.40 \\times 0.08 \\times (1 - 0.25) = 9.6%",
    variables: [],
  },
];

export const DECK_3_WACC: GoldenDeckDefinition = {
  id: "deck-3-cost-of-capital-wacc",
  title: "Cost of Capital & Weighted Average Cost of Capital (WACC)",
  subject: "Corporate Finance",
  slideCount: 9,
  sources: DECK_3_SOURCES,
  expectedLedger: DECK_3_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7"],
  validOmittedFormulaIds: ["F8"],
  forbiddenInjectedFormulas: [
    "\\beta_L = \\beta_U [1 + (1 - T_C)(D/E)]",
    "f_A = \\frac{E}{V} f_E + \\frac{D}{V} f_D",
    "\\text{WACC} = \\frac{E}{V} R_E(1 - T_C) + \\frac{D}{V} R_D",
  ],
  goldNote: createGoldNote({
    id: "note-deck-3",
    title: "CHAPTER 14: COST OF CAPITAL & WACC",
    subject: "Corporate Finance",
    originalFileName: "corporate-finance-ch14.pptx",
    originalSlideCount: 9,
    executiveSummary:
      "Comprehensive analysis of the cost of capital, individual component costs (equity, debt, preferred), capital structure weights, and WACC computation.",
    formulaLedger: DECK_3_LEDGER,
    omitted: [
      {
        formulaId: "F8",
        reason: "Numerical plug-in exercise omitted from core formula summary",
      },
    ],
    sections: [
      createSection({
        id: "sec-3-a",
        letter: "A",
        titleVi: "A. TỔNG QUAN CHI PHÍ VỐN VÀ CHI PHÍ VỐN CỔ PHẦN",
        titleEn: "Cost of Capital Overview & Cost of Equity",
        coreStatement:
          "The cost of capital is the minimum required rate of return that a firm must earn on its investments to maintain its market value and satisfy investors.",
        overview: "Cost of equity estimation methods:",
        formulas: [
          createFormula({
            leadText: "Dividend growth model approach for cost of equity:",
            latex: "R_E = \\frac{D_1}{P_0} + g",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [{ symbol: "R_E", definition: "Cost of equity" }],
          }),
          createFormula({
            leadText: "SML / CAPM approach for cost of equity:",
            latex: "R_E = R_f + \\beta_E (E(R_M) - R_f)",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [{ symbol: "\\beta_E", definition: "Equity beta" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "The cost of capital is the minimum required rate of return that a firm must earn on its investments",
            1,
            "cost of capital is the minimum required rate of return that a firm must earn on its investments",
          ),
          createGroundedBullet(
            "The SML approach estimates the cost of equity from systematic risk: R_E = R_f + beta_E * (E(R_M) - R_f)",
            3,
            "SML approach estimates the cost of equity from systematic risk: R_E = R_f + \\beta_E (E(R_M) - R_f)",
          ),
        ],
        sourceSlides: [1, 2, 3],
      }),
      createSection({
        id: "sec-3-b",
        letter: "B",
        titleVi: "B. CHI PHÍ NỢ VAY VÀ CỔ PHIẾU ƯU ĐÃI",
        titleEn: "Cost of Debt and Preferred Stock",
        overview: "Determining financing costs for fixed claims:",
        formulas: [
          createFormula({
            leadText: "Cost of preferred stock:",
            latex: "R_P = \\frac{D}{P_0}",
            formulaRefs: ["F3"],
            slide: 4,
            variables: [
              { symbol: "R_P", definition: "Cost of preferred stock" },
              { symbol: "D", definition: "Fixed preferred dividend" },
            ],
          }),
          createFormula({
            leadText: "After-tax cost of debt reflecting interest tax shield:",
            latex: "R_D(1 - T_C)",
            formulaRefs: ["F4"],
            slide: 5,
            variables: [
              { symbol: "R_D", definition: "Pre-tax cost of debt (YTM)" },
              { symbol: "T_C", definition: "Corporate tax rate" },
            ],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Because preferred dividends are not tax deductible, there is no corporate tax adjustment for preferred equity",
            4,
            "Because preferred dividends are not tax deductible, there is no corporate tax adjustment for preferred equity",
          ),
          createGroundedBullet(
            "Because interest expense is tax-deductible, the effective after-tax cost of debt is: R_D * (1 - T_C)",
            5,
            "effective after-tax cost of debt is: \\text{After-tax } R_D = R_D (1 - T_C)",
          ),
        ],
        sourceSlides: [4, 5],
      }),
      createSection({
        id: "sec-3-c",
        letter: "C",
        titleVi: "C. CHI PHÍ SỬ DỤNG VỐN BÌNH QUÂN (WACC)",
        titleEn: "Weighted Average Cost of Capital (WACC)",
        overview: "Combining individual component costs into the overall hurdle rate:",
        formulas: [
          createFormula({
            leadText: "Total market value of firm:",
            latex: "V = E + P + D",
            formulaRefs: ["F5"],
            slide: 6,
            variables: [{ symbol: "V", definition: "Total market value of firm" }],
          }),
          createFormula({
            leadText: "Capital structure weights summing to unity:",
            latex: "\\frac{E}{V} + \\frac{P}{V} + \\frac{D}{V} = 1",
            formulaRefs: ["F6"],
            slide: 7,
            variables: [{ symbol: "E/V", definition: "Market equity weight" }],
          }),
          createFormula({
            leadText: "Weighted Average Cost of Capital formula:",
            latex: "\\text{WACC} = \\frac{E}{V} R_E + \\frac{P}{V} R_P + \\frac{D}{V} R_D(1 - T_C)",
            formulaRefs: ["F7"],
            slide: 8,
            variables: [
              { symbol: "\\text{WACC}", definition: "Weighted average cost of capital" },
            ],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Financing weights are calculated using market values: E/V + P/V + D/V = 1",
            7,
            "Financing weights are calculated using market values: E/V + P/V + D/V = 1",
          ),
          createGroundedBullet(
            "The overall cost of capital is the weighted average of each capital component: WACC",
            8,
            "overall cost of capital is the weighted average of each capital component: WACC = (E/V) R_E + (P/V) R_P + (D/V) R_D (1 - T_C)",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "Use market value weights rather than book value weights for WACC",
            "Interest on debt is tax-deductible, providing a valuable corporate tax shield",
            "WACC represents the appropriate discount rate for projects of average firm risk",
          ],
          items: [
            createTakeawayItem(
              "Always use market values rather than book values when calculating capital structure weights",
              7,
              "Book values should not be used when market values are available",
            ),
            createTakeawayItem(
              "Tax shield (1 - T_C) applies strictly to debt, NEVER to equity or preferred stock",
              5,
              "Because interest expense is tax-deductible, the effective after-tax cost of debt is: \\text{After-tax } R_D = R_D (1 - T_C)",
            ),
            createTakeawayItem(
              "WACC serves as the benchmark hurdle rate for firm investment projects of average risk",
              8,
              "WACC is the appropriate hurdle rate for average-risk projects",
            ),
          ],
        },
        sourceSlides: [6, 7, 8],
      }),
    ],
  }),
};

// ============================================================================
// DECK 4 — Microeconomics: Price Elasticity of Demand & Supply
// ============================================================================

const DECK_4_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Microeconomics: Elasticity of Demand and Supply. Elasticity measures the responsiveness of quantity demanded or supplied to changes in price or other determinants. It provides a unit-free percentage metric.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "Price Elasticity of Demand. Price elasticity of demand measures the sensitivity of quantity demanded to price changes: \\epsilon_d = \\frac{\\% \\Delta Q}{\\% \\Delta P}. Demand is elastic if |\\epsilon_d| > 1, inelastic if |\\epsilon_d| < 1, and unit elastic if |\\epsilon_d| = 1.",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "Midpoint Method (Arc Elasticity). To avoid asymmetric results when calculating percentage changes between two price points: \\epsilon_d = \\frac{(Q_2 - Q_1) / ((Q_1 + Q_2)/2)}{(P_2 - P_1) / ((P_1 + P_2)/2)}. The midpoint formula gives the same elasticity regardless of direction.",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "Total Revenue and Elasticity. Total revenue equals price times quantity: TR = P \\times Q. When demand is inelastic, increasing price increases total revenue. When demand is elastic, increasing price decreases total revenue.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Cross-Price Elasticity of Demand. Cross-price elasticity measures how the demand for good X responds to changes in the price of good Y: \\epsilon_{xy} = \\frac{\\% \\Delta Q_x}{\\% \\Delta P_y}. Positive for substitutes (\\epsilon_{xy} > 0), negative for complements (\\epsilon_{xy} < 0).",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Income Elasticity of Demand. Income elasticity measures demand response to changes in consumer income: \\epsilon_I = \\frac{\\% \\Delta Q}{\\% \\Delta I}. Normal goods have \\epsilon_I > 0; inferior goods have \\epsilon_I < 0; luxury goods have \\epsilon_I > 1.",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "Price Elasticity of Supply. Price elasticity of supply measures how responsive quantity supplied is to price changes: \\epsilon_s = \\frac{\\% \\Delta Q_s}{\\% \\Delta P}. Supply is typically more elastic in the long run than in the short run.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "Practice Exercise: Initial price is $20, new price is $30. Initial quantity is 120, new quantity is 100. \\epsilon_d = \\frac{20 / 110}{10 / 25} = 0.45. Calculate arc elasticity.",
  },
];

const DECK_4_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "\\epsilon_d = \\frac{\\% \\Delta Q}{\\% \\Delta P}",
    latex: "\\epsilon_d = \\frac{\\% \\Delta Q}{\\% \\Delta P}",
    origin: "text",
    label: "Price Elasticity of Demand",
    evidence: "\\epsilon_d = \\frac{\\% \\Delta Q}{\\% \\Delta P}",
    variables: [
      { symbol: "\\epsilon_d", definition: "Price elasticity of demand" },
      { symbol: "\\% \\Delta Q", definition: "Percentage change in quantity demanded" },
      { symbol: "\\% \\Delta P", definition: "Percentage change in price" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "\\epsilon_d = \\frac{(Q_2 - Q_1) / ((Q_1 + Q_2)/2)}{(P_2 - P_1) / ((P_1 + P_2)/2)}",
    latex: "\\epsilon_d = \\frac{(Q_2 - Q_1) / ((Q_1 + Q_2)/2)}{(P_2 - P_1) / ((P_1 + P_2)/2)}",
    origin: "text",
    label: "Midpoint Formula for Elasticity",
    evidence: "\\epsilon_d = \\frac{(Q_2 - Q_1) / ((Q_1 + Q_2)/2)}{(P_2 - P_1) / ((P_1 + P_2)/2)}",
    variables: [
      { symbol: "Q_1, Q_2", definition: "Initial and new quantities" },
      { symbol: "P_1, P_2", definition: "Initial and new prices" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "TR = P \\times Q",
    latex: "TR = P \\times Q",
    origin: "text",
    label: "Total Revenue",
    evidence: "TR = P \\times Q",
    variables: [
      { symbol: "TR", definition: "Total revenue" },
      { symbol: "P", definition: "Price per unit" },
      { symbol: "Q", definition: "Quantity sold" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "\\epsilon_{xy} = \\frac{\\% \\Delta Q_x}{\\% \\Delta P_y}",
    latex: "\\epsilon_{xy} = \\frac{\\% \\Delta Q_x}{\\% \\Delta P_y}",
    origin: "text",
    label: "Cross-Price Elasticity of Demand",
    evidence: "\\epsilon_{xy} = \\frac{\\% \\Delta Q_x}{\\% \\Delta P_y}",
    variables: [
      { symbol: "\\epsilon_{xy}", definition: "Cross-price elasticity of demand" },
      { symbol: "\\% \\Delta Q_x", definition: "Percentage change in quantity of good X" },
      { symbol: "\\% \\Delta P_y", definition: "Percentage change in price of good Y" },
    ],
  },
  {
    id: "F5",
    slide: 6,
    raw: "\\epsilon_I = \\frac{\\% \\Delta Q}{\\% \\Delta I}",
    latex: "\\epsilon_I = \\frac{\\% \\Delta Q}{\\% \\Delta I}",
    origin: "text",
    label: "Income Elasticity of Demand",
    evidence: "\\epsilon_I = \\frac{\\% \\Delta Q}{\\% \\Delta I}",
    variables: [
      { symbol: "\\epsilon_I", definition: "Income elasticity of demand" },
      { symbol: "\\% \\Delta I", definition: "Percentage change in consumer income" },
    ],
  },
  {
    id: "F6",
    slide: 7,
    raw: "\\epsilon_s = \\frac{\\% \\Delta Q_s}{\\% \\Delta P}",
    latex: "\\epsilon_s = \\frac{\\% \\Delta Q_s}{\\% \\Delta P}",
    origin: "text",
    label: "Price Elasticity of Supply",
    evidence: "\\epsilon_s = \\frac{\\% \\Delta Q_s}{\\% \\Delta P}",
    variables: [
      { symbol: "\\epsilon_s", definition: "Price elasticity of supply" },
      { symbol: "\\% \\Delta Q_s", definition: "Percentage change in quantity supplied" },
    ],
  },
  {
    id: "F7",
    slide: 8,
    raw: "\\epsilon_d = \\frac{20 / 110}{10 / 25}",
    latex: "\\epsilon_d = \\frac{20 / 110}{10 / 25}",
    origin: "text",
    label: "Midpoint Calculation Plug-in",
    isExerciseOnly: true,
    evidence: "\\epsilon_d = \\frac{20 / 110}{10 / 25} = 0.45",
    variables: [],
  },
];

export const DECK_4_ELASTICITY: GoldenDeckDefinition = {
  id: "deck-4-price-elasticity",
  title: "Price Elasticity of Demand & Supply",
  subject: "Microeconomics",
  slideCount: 8,
  sources: DECK_4_SOURCES,
  expectedLedger: DECK_4_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6"],
  validOmittedFormulaIds: ["F7"],
  forbiddenInjectedFormulas: [
    "\\epsilon_d = \\frac{dQ}{dP} \\frac{P}{Q}",
    "Q = A P^{-\\alpha} I^{\\beta}",
  ],
  goldNote: createGoldNote({
    id: "note-deck-4",
    title: "PRICE ELASTICITY OF DEMAND & SUPPLY",
    subject: "Microeconomics",
    originalFileName: "microeconomics-elasticity.pptx",
    originalSlideCount: 8,
    executiveSummary:
      "Core definitions and formulas for price elasticity of demand, the midpoint method, total revenue relationship, cross-price elasticity, income elasticity, and elasticity of supply.",
    formulaLedger: DECK_4_LEDGER,
    omitted: [
      {
        formulaId: "F7",
        reason: "Numerical plug-in practice calculation omitted from core notes",
      },
    ],
    sections: [
      createSection({
        id: "sec-4-a",
        letter: "A",
        titleVi: "A. ĐỘ CO GIÃN CỦA CẦU THEO GIÁ (PRICE ELASTICITY OF DEMAND)",
        titleEn: "Price Elasticity of Demand",
        coreStatement:
          "Elasticity measures the responsiveness of quantity demanded or supplied to changes in price or other determinants.",
        overview: "Formulas and midpoint calculation for demand elasticity:",
        formulas: [
          createFormula({
            leadText: "Percentage definition of price elasticity of demand:",
            latex: "\\epsilon_d = \\frac{\\% \\Delta Q}{\\% \\Delta P}",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [
              { symbol: "\\epsilon_d", definition: "Price elasticity of demand" },
            ],
          }),
          createFormula({
            leadText: "Midpoint formula (arc elasticity):",
            latex: "\\epsilon_d = \\frac{(Q_2 - Q_1) / ((Q_1 + Q_2)/2)}{(P_2 - P_1) / ((P_1 + P_2)/2)}",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [
              { symbol: "Q_1, Q_2", definition: "Initial and final quantities" },
            ],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Price elasticity of demand measures the sensitivity of quantity demanded to price changes",
            2,
            "Price elasticity of demand measures the sensitivity of quantity demanded to price changes",
          ),
          createGroundedBullet(
            "The midpoint formula gives the same elasticity regardless of direction",
            3,
            "midpoint formula gives the same elasticity regardless of direction",
          ),
        ],
        sourceSlides: [1, 2, 3],
      }),
      createSection({
        id: "sec-4-b",
        letter: "B",
        titleVi: "B. TỔNG DOANH THU VÀ CÁC DẠNG CO GIÃN KHÁC",
        titleEn: "Total Revenue and Other Elasticity Types",
        overview: "Total revenue relationship and other elasticities:",
        formulas: [
          createFormula({
            leadText: "Total revenue equation:",
            latex: "TR = P \\times Q",
            formulaRefs: ["F3"],
            slide: 4,
            variables: [{ symbol: "TR", definition: "Total revenue" }],
          }),
          createFormula({
            leadText: "Cross-price elasticity of demand:",
            latex: "\\epsilon_{xy} = \\frac{\\% \\Delta Q_x}{\\% \\Delta P_y}",
            formulaRefs: ["F4"],
            slide: 5,
            variables: [
              { symbol: "\\epsilon_{xy}", definition: "Cross-price elasticity of demand" },
            ],
          }),
          createFormula({
            leadText: "Income elasticity of demand:",
            latex: "\\epsilon_I = \\frac{\\% \\Delta Q}{\\% \\Delta I}",
            formulaRefs: ["F5"],
            slide: 6,
            variables: [
              { symbol: "\\epsilon_I", definition: "Income elasticity of demand" },
            ],
          }),
          createFormula({
            leadText: "Price elasticity of supply:",
            latex: "\\epsilon_s = \\frac{\\% \\Delta Q_s}{\\% \\Delta P}",
            formulaRefs: ["F6"],
            slide: 7,
            variables: [
              { symbol: "\\epsilon_s", definition: "Price elasticity of supply" },
            ],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "When demand is inelastic, increasing price increases total revenue",
            4,
            "When demand is inelastic, increasing price increases total revenue",
          ),
          createGroundedBullet(
            "Positive for substitutes (\\epsilon_{xy} > 0), negative for complements (\\epsilon_{xy} < 0)",
            5,
            "Positive for substitutes (\\epsilon_{xy} > 0), negative for complements (\\epsilon_{xy} < 0)",
          ),
          createGroundedBullet(
            "Supply is typically more elastic in the long run than in the short run",
            7,
            "Supply is typically more elastic in the long run than in the short run",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "Use the midpoint formula to avoid directional asymmetry in elasticity calculations",
            "Inelastic demand allows price increases to raise total revenue",
            "Cross-price elasticity identifies substitutes (positive) and complements (negative)",
          ],
          items: [
            createTakeawayItem(
              "Midpoint method computes arc elasticity independently of calculation direction",
              3,
              "midpoint formula gives the same elasticity regardless of direction",
            ),
            createTakeawayItem(
              "Revenue increases with price when demand is inelastic",
              4,
              "When demand is inelastic, increasing price increases total revenue",
            ),
            createTakeawayItem(
              "Sign of cross-price elasticity distinguishes substitutes from complements",
              5,
              "Positive for substitutes (\\epsilon_{xy} > 0), negative for complements (\\epsilon_{xy} < 0)",
            ),
          ],
        },
        sourceSlides: [4, 5, 6, 7],
      }),
    ],
  }),
};

// ============================================================================
// DECK 5 — Microeconomics: Monopoly & Market Power
// ============================================================================

const DECK_5_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Microeconomics: Monopoly and Market Power. A monopoly is the sole seller of a product with no close substitutes. Barriers to entry prevent other firms from entering the market, giving the monopolist price-setting market power.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "Total Revenue for a Monopolist. Total revenue equals price multiplied by quantity: TR = P \\times Q. Unlike a competitive firm, a monopolist faces a downward-sloping market demand curve, so selling more units requires lowering the price.",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "Marginal Revenue. Marginal revenue is the additional revenue gained from selling one additional unit of output: MR = \\frac{\\Delta TR}{\\Delta Q}. For a single-price monopolist, marginal revenue is always strictly less than price (MR < P).",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "Marginal Cost. Marginal cost is the change in total cost resulting from producing one additional unit: MC = \\frac{\\Delta TC}{\\Delta Q}. As output increases, marginal cost typically rises due to diminishing returns.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Profit Maximization Condition. To maximize economic profit, the monopolist produces the output level where marginal revenue equals marginal cost: MR = MC. If MR > MC, increasing output increases profit; if MR < MC, reducing output increases profit.",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Monopoly Economic Profit. At the profit-maximizing quantity Q, the firm charges the price P on the demand curve. Economic profit equals: \\Pi = (P - ATC) \\times Q, where ATC is average total cost at that quantity.",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "The Lerner Index of Market Power. The Lerner Index measures the degree of monopoly market power through price markup over marginal cost: L = \\frac{P - MC}{P} = -\\frac{1}{\\epsilon_d}. Higher Lerner index indicates greater pricing power, which is inversely related to demand elasticity.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "Monopoly Numerical Example. Monopoly price is $50, average total cost is $30, output is 100 units. Profit is: \\Pi = (50 - 30) \\times 100 = $2,000.",
  },
];

const DECK_5_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "TR = P \\times Q",
    latex: "TR = P \\times Q",
    origin: "text",
    label: "Total Revenue",
    evidence: "TR = P \\times Q",
    variables: [
      { symbol: "TR", definition: "Total revenue" },
      { symbol: "P", definition: "Market price" },
      { symbol: "Q", definition: "Quantity of output" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "MR = \\frac{\\Delta TR}{\\Delta Q}",
    latex: "MR = \\frac{\\Delta TR}{\\Delta Q}",
    origin: "text",
    label: "Marginal Revenue",
    evidence: "MR = \\frac{\\Delta TR}{\\Delta Q}",
    variables: [
      { symbol: "MR", definition: "Marginal revenue" },
      { symbol: "\\Delta TR", definition: "Change in total revenue" },
      { symbol: "\\Delta Q", definition: "Change in output" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "MC = \\frac{\\Delta TC}{\\Delta Q}",
    latex: "MC = \\frac{\\Delta TC}{\\Delta Q}",
    origin: "text",
    label: "Marginal Cost",
    evidence: "MC = \\frac{\\Delta TC}{\\Delta Q}",
    variables: [
      { symbol: "MC", definition: "Marginal cost" },
      { symbol: "\\Delta TC", definition: "Change in total cost" },
      { symbol: "\\Delta Q", definition: "Change in output" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "MR = MC",
    latex: "MR = MC",
    origin: "text",
    label: "Profit Maximization Condition",
    evidence: "MR = MC",
    variables: [
      { symbol: "MR", definition: "Marginal revenue" },
      { symbol: "MC", definition: "Marginal cost" },
    ],
  },
  {
    id: "F5",
    slide: 6,
    raw: "\\Pi = (P - ATC) \\times Q",
    latex: "\\Pi = (P - ATC) \\times Q",
    origin: "text",
    label: "Monopoly Economic Profit",
    evidence: "\\Pi = (P - ATC) \\times Q",
    variables: [
      { symbol: "\\Pi", definition: "Economic profit" },
      { symbol: "P", definition: "Market price" },
      { symbol: "ATC", definition: "Average total cost" },
      { symbol: "Q", definition: "Quantity produced" },
    ],
  },
  {
    id: "F6",
    slide: 7,
    raw: "L = \\frac{P - MC}{P} = -\\frac{1}{\\epsilon_d}",
    latex: "L = \\frac{P - MC}{P} = -\\frac{1}{\\epsilon_d}",
    origin: "text",
    label: "Lerner Index of Market Power",
    evidence: "L = \\frac{P - MC}{P} = -\\frac{1}{\\epsilon_d}",
    variables: [
      { symbol: "L", definition: "Lerner index of market power" },
      { symbol: "\\epsilon_d", definition: "Price elasticity of demand" },
    ],
  },
  {
    id: "F7",
    slide: 8,
    raw: "\\Pi = (50 - 30) \\times 100",
    latex: "\\Pi = (50 - 30) \\times 100",
    origin: "text",
    label: "Monopoly Profit Plug-in",
    isExerciseOnly: true,
    evidence: "\\Pi = (50 - 30) \\times 100 = $2,000",
    variables: [],
  },
];

export const DECK_5_MONOPOLY: GoldenDeckDefinition = {
  id: "deck-5-monopoly-market-power",
  title: "Monopoly, Market Power & Profit Maximization",
  subject: "Microeconomics",
  slideCount: 8,
  sources: DECK_5_SOURCES,
  expectedLedger: DECK_5_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6"],
  validOmittedFormulaIds: ["F7"],
  forbiddenInjectedFormulas: [
    "q_1 = \\frac{a - c - b q_2}{2b}",
    "HHI = \\sum s_i^2",
    "P = MC",
  ],
  goldNote: createGoldNote({
    id: "note-deck-5",
    title: "MONOPOLY & MARKET POWER",
    subject: "Microeconomics",
    originalFileName: "microeconomics-monopoly.pptx",
    originalSlideCount: 8,
    executiveSummary:
      "Monopoly market structure, revenue and cost dynamics, the MR = MC profit maximization rule, economic profit calculation, and the Lerner Index of market power.",
    formulaLedger: DECK_5_LEDGER,
    omitted: [
      {
        formulaId: "F7",
        reason: "Numerical plug-in exercise omitted from core formula summary",
      },
    ],
    sections: [
      createSection({
        id: "sec-5-a",
        letter: "A",
        titleVi: "A. DOANH THU VÀ CHI PHÍ CỦA DOANH NGHIỆP ĐỘC QUYỀN",
        titleEn: "Monopoly Revenue and Cost Structure",
        coreStatement:
          "A monopoly is the sole seller of a product with no close substitutes, giving the monopolist price-setting market power.",
        overview: "Total and marginal relationships for a monopoly firm:",
        formulas: [
          createFormula({
            leadText: "Total revenue equation:",
            latex: "TR = P \\times Q",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [{ symbol: "TR", definition: "Total revenue" }],
          }),
          createFormula({
            leadText: "Marginal revenue equation:",
            latex: "MR = \\frac{\\Delta TR}{\\Delta Q}",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [{ symbol: "MR", definition: "Marginal revenue" }],
          }),
          createFormula({
            leadText: "Marginal cost equation:",
            latex: "MC = \\frac{\\Delta TC}{\\Delta Q}",
            formulaRefs: ["F3"],
            slide: 4,
            variables: [{ symbol: "MC", definition: "Marginal cost" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Total revenue equals price multiplied by quantity: TR = P * Q",
            2,
            "Total revenue equals price multiplied by quantity: TR = P \\times Q",
          ),
          createGroundedBullet(
            "For a single-price monopolist, marginal revenue is always strictly less than price (MR < P)",
            3,
            "For a single-price monopolist, marginal revenue is always strictly less than price (MR < P)",
          ),
        ],
        sourceSlides: [1, 2, 3, 4],
      }),
      createSection({
        id: "sec-5-b",
        letter: "B",
        titleVi: "B. TỐI ĐA HÓA LỢI NHUẬN VÀ CHỈ SỐ LERNER",
        titleEn: "Profit Maximization & The Lerner Index",
        overview: "The profit-maximizing rule and market power measurement:",
        formulas: [
          createFormula({
            leadText: "Profit maximization rule:",
            latex: "MR = MC",
            formulaRefs: ["F4"],
            slide: 5,
            variables: [{ symbol: "MR", definition: "Marginal revenue" }],
          }),
          createFormula({
            leadText: "Monopoly economic profit:",
            latex: "\\Pi = (P - ATC) \\times Q",
            formulaRefs: ["F5"],
            slide: 6,
            variables: [{ symbol: "\\Pi", definition: "Economic profit" }],
          }),
          createFormula({
            leadText: "Lerner Index of market power:",
            latex: "L = \\frac{P - MC}{P} = -\\frac{1}{\\epsilon_d}",
            formulaRefs: ["F6"],
            slide: 7,
            variables: [{ symbol: "L", definition: "Lerner index" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "To maximize economic profit, the monopolist produces the output level where marginal revenue equals marginal cost: MR = MC",
            5,
            "To maximize economic profit, the monopolist produces the output level where marginal revenue equals marginal cost: MR = MC",
          ),
          createGroundedBullet(
            "The Lerner Index measures the degree of monopoly market power through price markup over marginal cost",
            7,
            "The Lerner Index measures the degree of monopoly market power through price markup over marginal cost",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "A monopolist always sets output where MR = MC to maximize profit",
            "Marginal revenue is strictly below price (MR < P) for a downward-sloping demand curve",
            "The Lerner Index reflects pricing power inversely proportional to demand elasticity",
          ],
          items: [
            createTakeawayItem(
              "Monopolist maximizes profit by producing output where MR = MC",
              5,
              "To maximize economic profit, the monopolist produces the output level where marginal revenue equals marginal cost: MR = MC",
            ),
            createTakeawayItem(
              "Marginal revenue lies below price because price must be reduced on all units to sell more",
              3,
              "marginal revenue is always strictly less than price (MR < P)",
            ),
            createTakeawayItem(
              "Lerner index measures monopoly markup and relates inversely to demand elasticity",
              7,
              "Higher Lerner index indicates greater pricing power, which is inversely related to demand elasticity",
            ),
          ],
        },
        sourceSlides: [5, 6, 7],
      }),
    ],
  }),
};

// ============================================================================
// DECK 6 — Macroeconomics: Goods Market & Money Market (IS-LM)
// ============================================================================

const DECK_6_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Macroeconomics: The Goods Market, Money Market and IS-LM Model. The IS-LM model describes the simultaneous equilibrium in two markets: the goods market (IS relation) and the financial money market (LM relation), determining output Y and interest rate i.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "Consumption Function. Private consumption depends positively on disposable income (Y - T): C = c_0 + c_1(Y - T), where c_0 is autonomous consumption and c_1 is the marginal propensity to consume (0 < c_1 < 1).",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "Investment Function. Investment spending depends positively on economic output Y and negatively on the nominal interest rate i: I = \\bar{I} + d_1 Y - d_2 i. Higher interest rates increase borrowing costs and reduce investment.",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "Goods Market Equilibrium (The IS Relation). In a closed economy, goods market equilibrium requires aggregate output Y to equal aggregate demand Z: Y = C + I + G. Substituting consumption and investment gives the downward-sloping IS curve.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Autonomous Expenditure Multiplier. Solving the linear goods market equilibrium for output Y yields: Y = \\frac{1}{1 - c_1} (c_0 + \\bar{I} + G - c_1 T). The autonomous spending multiplier 1 / (1 - c_1) amplifies shocks to spending.",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Money Demand Relation. Money demand M^d is proportional to nominal income $Y and decreases with the interest rate i: M^d = \\$Y L(i). Holding money yields liquidity, but the interest rate represents the opportunity cost of holding cash.",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "Financial Market Equilibrium (The LM Relation). Equilibrium in financial markets requires real money supply M/P to equal real money demand: M / P = Y L(i). For a given real money stock, higher income increases transaction demand and raises interest rates.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "Multiplier Practice Problem. With marginal propensity to consume c_1 = 0.8 and autonomous spending of 500: Y = \\frac{1}{1 - 0.8} \\times 500 = 2500. Calculate equilibrium output.",
  },
];

const DECK_6_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "C = c_0 + c_1(Y - T)",
    latex: "C = c_0 + c_1(Y - T)",
    origin: "text",
    label: "Consumption Function",
    evidence: "C = c_0 + c_1(Y - T)",
    variables: [
      { symbol: "C", definition: "Total consumption spending" },
      { symbol: "c_0", definition: "Autonomous consumption" },
      { symbol: "c_1", definition: "Marginal propensity to consume" },
      { symbol: "Y - T", definition: "Disposable income" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "I = \\bar{I} + d_1 Y - d_2 i",
    latex: "I = \\bar{I} + d_1 Y - d_2 i",
    origin: "text",
    label: "Investment Function",
    evidence: "I = \\bar{I} + d_1 Y - d_2 i",
    variables: [
      { symbol: "I", definition: "Investment expenditure" },
      { symbol: "Y", definition: "National income output" },
      { symbol: "i", definition: "Nominal interest rate" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "Y = C + I + G",
    latex: "Y = C + I + G",
    origin: "text",
    label: "IS Relation (Goods Market Equilibrium)",
    evidence: "Y = C + I + G",
    variables: [
      { symbol: "Y", definition: "Aggregate output" },
      { symbol: "C", definition: "Consumption" },
      { symbol: "I", definition: "Investment" },
      { symbol: "G", definition: "Government spending" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "Y = \\frac{1}{1 - c_1} (c_0 + \\bar{I} + G - c_1 T)",
    latex: "Y = \\frac{1}{1 - c_1} (c_0 + \\bar{I} + G - c_1 T)",
    origin: "text",
    label: "Autonomous Expenditure Multiplier Equilibrium",
    evidence: "Y = \\frac{1}{1 - c_1} (c_0 + \\bar{I} + G - c_1 T)",
    variables: [
      { symbol: "1 / (1 - c_1)", definition: "Autonomous spending multiplier" },
    ],
  },
  {
    id: "F5",
    slide: 6,
    raw: "M^d = \\$Y L(i)",
    latex: "M^d = \\$Y L(i)",
    origin: "text",
    label: "Money Demand Relation",
    evidence: "M^d = \\$Y L(i)",
    variables: [
      { symbol: "M^d", definition: "Money demand" },
      { symbol: "\\$Y", definition: "Nominal income" },
      { symbol: "L(i)", definition: "Liquidity preference function of interest rate" },
    ],
  },
  {
    id: "F6",
    slide: 7,
    raw: "M / P = Y L(i)",
    latex: "\\frac{M}{P} = Y L(i)",
    origin: "text",
    label: "LM Relation (Money Market Equilibrium)",
    evidence: "M / P = Y L(i)",
    variables: [
      { symbol: "M/P", definition: "Real money supply" },
      { symbol: "Y", definition: "Real output income" },
      { symbol: "i", definition: "Interest rate" },
    ],
  },
  {
    id: "F7",
    slide: 8,
    raw: "Y = \\frac{1}{1 - 0.8} \\times 500",
    latex: "Y = \\frac{1}{1 - 0.8}(500)",
    origin: "text",
    label: "Multiplier Numerical Plug-in",
    isExerciseOnly: true,
    evidence: "Y = \\frac{1}{1 - 0.8} \\times 500 = 2500",
    variables: [],
  },
];

export const DECK_6_IS_LM: GoldenDeckDefinition = {
  id: "deck-6-is-lm-macroeconomics",
  title: "Goods Market, Money Market & IS-LM Model",
  subject: "Macroeconomics",
  slideCount: 8,
  sources: DECK_6_SOURCES,
  expectedLedger: DECK_6_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6"],
  validOmittedFormulaIds: ["F7"],
  forbiddenInjectedFormulas: [
    "\\pi_t - \\pi_{t-1} = -\\alpha (u_t - u_n)",
    "i_t = r^* + \\pi_t + 0.5(\\pi_t - \\pi^*) + 0.5(y_t - \\bar{y})",
    "Y = A K^\\alpha L^{1-\\alpha}",
  ],
  goldNote: createGoldNote({
    id: "note-deck-6",
    title: "GOODS & MONEY MARKET (IS-LM MODEL)",
    subject: "Macroeconomics",
    originalFileName: "macroeconomics-is-lm.pptx",
    originalSlideCount: 8,
    executiveSummary:
      "Core macroeconomic equilibrium equations covering the goods market (consumption, investment, autonomous multiplier, IS curve) and the financial money market (money demand and LM curve).",
    formulaLedger: DECK_6_LEDGER,
    omitted: [
      {
        formulaId: "F7",
        reason: "Numerical multiplier calculation plug-in omitted from general notes",
      },
    ],
    sections: [
      createSection({
        id: "sec-6-a",
        letter: "A",
        titleVi: "A. THỊ TRƯỜNG HÀNG HÓA VÀ ĐƯỜNG IS (THE GOODS MARKET)",
        titleEn: "The Goods Market & IS Curve",
        coreStatement:
          "In a closed economy, goods market equilibrium requires aggregate output Y to equal aggregate demand Z: Y = C + I + G.",
        overview: "Behavioral equations and equilibrium for the goods market:",
        formulas: [
          createFormula({
            leadText: "Consumption function:",
            latex: "C = c_0 + c_1(Y - T)",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [{ symbol: "c_1", definition: "Marginal propensity to consume" }],
          }),
          createFormula({
            leadText: "Investment function:",
            latex: "I = \\bar{I} + d_1 Y - d_2 i",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [{ symbol: "i", definition: "Interest rate" }],
          }),
          createFormula({
            leadText: "Goods market equilibrium (IS relation):",
            latex: "Y = C + I + G",
            formulaRefs: ["F3"],
            slide: 4,
            variables: [{ symbol: "Y", definition: "Aggregate output" }],
          }),
          createFormula({
            leadText: "Autonomous spending multiplier solution:",
            latex: "Y = \\frac{1}{1 - c_1} (c_0 + \\bar{I} + G - c_1 T)",
            formulaRefs: ["F4"],
            slide: 5,
            variables: [{ symbol: "1 / (1 - c_1)", definition: "Multiplier" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Private consumption depends positively on disposable income (Y - T): C = c_0 + c_1(Y - T)",
            2,
            "Private consumption depends positively on disposable income (Y - T): C = c_0 + c_1(Y - T)",
          ),
          createGroundedBullet(
            "Investment spending depends positively on economic output Y and negatively on the nominal interest rate i",
            3,
            "Investment spending depends positively on economic output Y and negatively on the nominal interest rate i",
          ),
          createGroundedBullet(
            "The autonomous spending multiplier 1 / (1 - c_1) amplifies shocks to spending",
            5,
            "autonomous spending multiplier 1 / (1 - c_1) amplifies shocks to spending",
          ),
        ],
        sourceSlides: [1, 2, 3, 4, 5],
      }),
      createSection({
        id: "sec-6-b",
        letter: "B",
        titleVi: "B. THỊ TRƯỜNG TIỀN TỆ VÀ ĐƯỜNG LM (THE MONEY MARKET)",
        titleEn: "The Money Market & LM Curve",
        overview: "Liquidity preference and money market equilibrium:",
        formulas: [
          createFormula({
            leadText: "Money demand relation:",
            latex: "M^d = \\$Y L(i)",
            formulaRefs: ["F5"],
            slide: 6,
            variables: [{ symbol: "M^d", definition: "Money demand" }],
          }),
          createFormula({
            leadText: "Financial market equilibrium (LM relation):",
            latex: "\\frac{M}{P} = Y L(i)",
            formulaRefs: ["F6"],
            slide: 7,
            variables: [{ symbol: "M/P", definition: "Real money supply" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Money demand M^d is proportional to nominal income $Y and decreases with the interest rate i",
            6,
            "Money demand M^d is proportional to nominal income $Y and decreases with the interest rate i",
          ),
          createGroundedBullet(
            "Equilibrium in financial markets requires real money supply M/P to equal real money demand: M / P = Y L(i)",
            7,
            "Equilibrium in financial markets requires real money supply M/P to equal real money demand: M / P = Y L(i)",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "Goods market equilibrium yields the downward-sloping IS curve",
            "Money market equilibrium yields the upward-sloping LM curve",
            "Intersection of IS and LM curves determines simultaneous equilibrium income and interest rate",
          ],
          items: [
            createTakeawayItem(
              "IS relation equates aggregate output to total demand",
              4,
              "goods market equilibrium requires aggregate output Y to equal aggregate demand Z: Y = C + I + G",
            ),
            createTakeawayItem(
              "LM curve equates real money supply to money demand",
              7,
              "Equilibrium in financial markets requires real money supply M/P to equal real money demand: M / P = Y L(i)",
            ),
          ],
        },
        sourceSlides: [6, 7],
      }),
    ],
  }),
};

// ============================================================================
// DECK 7 — Fixed Income: Bond Valuation & Duration
// ============================================================================

const DECK_7_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Fixed Income Analysis: Bond Valuation and Duration. A coupon bond is a fixed-income debt instrument where an issuer pays periodic coupon payments C and returns the par value M at maturity. Valuation relies on discounting these fixed future cash flows.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "Bond Pricing Formula. The price P of a coupon bond is the present value of coupon annuity payments plus the present value of the face value: P = C \\times [ (1 - (1 + y)^{-n}) / y ] + M / (1 + y)^n, where y is yield to maturity and n is periods to maturity.",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "Current Yield. Current yield measures the annual coupon income relative to the bond's current market price: CY = C / P. Current yield reflects income return but ignores capital gain or loss at maturity.",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "Capital Gains Yield. Capital gains yield measures the rate of price appreciation or depreciation over a period: CGY = (P_1 - P_0) / P_0. Total bond return equals current yield plus capital gains yield.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Macaulay Duration. Macaulay duration measures the weighted-average time until bond cash flows are received: D = \\frac{\\sum_{t=1}^n t \\times \\frac{CF_t}{(1 + y)^t}}{P}. It serves as the primary metric for interest rate risk.",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Modified Duration. Modified duration directly relates duration to percentage price changes: D^* = D / (1 + y). For a semi-annual bond with k compounding periods per year, D^* = D / (1 + y/k).",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "Percentage Price Change Approximation. Using modified duration, the approximate percentage change in bond price resulting from a small change in yield is: \\Delta P / P = -D^* \\times \\Delta y. Bond price changes are inversely related to changes in yield.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "Practice Exercise: A 10-year bond with 8% annual coupon, $1,000 par value, and 10% YTM: P = 80 \\times [ (1 - (1.10)^{-10}) / 0.10 ] + 1000 / (1.10)^{10} = $877.11.",
  },
];

const DECK_7_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "P = C \\left[ \\frac{1 - (1 + y)^{-n}}{y} \\right] + \\frac{M}{(1 + y)^n}",
    latex: "P = C \\left[ \\frac{1 - (1 + y)^{-n}}{y} \\right] + \\frac{M}{(1 + y)^n}",
    origin: "text",
    label: "Bond Pricing Formula",
    evidence: "P = C \\times [ (1 - (1 + y)^{-n}) / y ] + M / (1 + y)^n",
    variables: [
      { symbol: "P", definition: "Bond market price" },
      { symbol: "C", definition: "Periodic coupon payment" },
      { symbol: "y", definition: "Yield to maturity per period" },
      { symbol: "n", definition: "Number of periods to maturity" },
      { symbol: "M", definition: "Par or face value at maturity" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "CY = C / P",
    latex: "CY = \\frac{C}{P}",
    origin: "text",
    label: "Current Yield",
    evidence: "CY = C / P",
    variables: [
      { symbol: "CY", definition: "Current yield" },
      { symbol: "C", definition: "Annual coupon payment" },
      { symbol: "P", definition: "Current bond price" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "CGY = (P_1 - P_0) / P_0",
    latex: "CGY = \\frac{P_1 - P_0}{P_0}",
    origin: "text",
    label: "Capital Gains Yield",
    evidence: "CGY = (P_1 - P_0) / P_0",
    variables: [
      { symbol: "CGY", definition: "Capital gains yield" },
      { symbol: "P_0", definition: "Initial price" },
      { symbol: "P_1", definition: "Ending price" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "D = \\frac{\\sum_{t=1}^n t \\times \\frac{CF_t}{(1 + y)^t}}{P}",
    latex: "D = \\frac{\\sum_{t=1}^n t \\times \\frac{CF_t}{(1 + y)^t}}{P}",
    origin: "text",
    label: "Macaulay Duration",
    evidence: "D = \\frac{\\sum_{t=1}^n t \\times \\frac{CF_t}{(1 + y)^t}}{P}",
    variables: [
      { symbol: "D", definition: "Macaulay duration in periods" },
      { symbol: "CF_t", definition: "Cash flow received at period t" },
      { symbol: "y", definition: "Yield to maturity" },
      { symbol: "P", definition: "Current bond price" },
    ],
  },
  {
    id: "F5",
    slide: 6,
    raw: "D^* = D / (1 + y)",
    latex: "D^* = \\frac{D}{1 + y}",
    origin: "text",
    label: "Modified Duration",
    evidence: "D^* = D / (1 + y)",
    variables: [
      { symbol: "D^*", definition: "Modified duration" },
      { symbol: "D", definition: "Macaulay duration" },
      { symbol: "y", definition: "Yield to maturity" },
    ],
  },
  {
    id: "F6",
    slide: 7,
    raw: "\\Delta P / P = -D^* \\times \\Delta y",
    latex: "\\frac{\\Delta P}{P} = -D^* \\times \\Delta y",
    origin: "text",
    label: "Duration Price Sensitivity Approximation",
    evidence: "\\Delta P / P = -D^* \\times \\Delta y",
    variables: [
      { symbol: "\\Delta P / P", definition: "Percentage price change" },
      { symbol: "D^*", definition: "Modified duration" },
      { symbol: "\\Delta y", definition: "Change in yield to maturity" },
    ],
  },
  {
    id: "F7",
    slide: 8,
    raw: "P = 80 \\times [ (1 - (1.10)^{-10}) / 0.10 ] + 1000 / (1.10)^{10}",
    latex: "P = 80 \\left[ \\frac{1 - (1.10)^{-10}}{0.10} \\right] + \\frac{1000}{(1.10)^{10}}",
    origin: "text",
    label: "Bond Valuation Numerical Plug-in",
    isExerciseOnly: true,
    evidence: "P = 80 \\times [ (1 - (1.10)^{-10}) / 0.10 ] + 1000 / (1.10)^{10} = $877.11",
    variables: [],
  },
];

export const DECK_7_BOND_VALUATION: GoldenDeckDefinition = {
  id: "deck-7-bond-valuation-duration",
  title: "Bond Valuation, Yields & Interest Rate Risk (Duration)",
  subject: "Fixed Income",
  slideCount: 8,
  sources: DECK_7_SOURCES,
  expectedLedger: DECK_7_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6"],
  validOmittedFormulaIds: ["F7"],
  forbiddenInjectedFormulas: [
    "\\frac{\\Delta P}{P} = -D^* \\Delta y + \\frac{1}{2} C (\\Delta y)^2",
    "dr_t = a(b - r_t)dt + \\sigma dW_t",
  ],
  goldNote: createGoldNote({
    id: "note-deck-7",
    title: "BOND VALUATION & DURATION",
    subject: "Fixed Income",
    originalFileName: "fixed-income-bonds.pptx",
    originalSlideCount: 8,
    executiveSummary:
      "Essential fixed income valuation principles, coupon bond pricing formulas, current yield, Macaulay and Modified duration, and duration-based price risk approximations.",
    formulaLedger: DECK_7_LEDGER,
    omitted: [
      {
        formulaId: "F7",
        reason: "Numerical bond valuation calculation plug-in omitted from general notes",
      },
    ],
    sections: [
      createSection({
        id: "sec-7-a",
        letter: "A",
        titleVi: "A. ĐỊNH GIÁ TRÁI PHIẾU VÀ LỢI SUẤT HIỆN HÀNH",
        titleEn: "Bond Pricing and Yields",
        coreStatement:
          "The price P of a coupon bond is the present value of coupon annuity payments plus the present value of the face value.",
        overview: "Formulas for pricing bonds and decomposing returns:",
        formulas: [
          createFormula({
            leadText: "Bond pricing formula (Annuity + Par value PV):",
            latex: "P = C \\left[ \\frac{1 - (1 + y)^{-n}}{y} \\right] + \\frac{M}{(1 + y)^n}",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [
              { symbol: "P", definition: "Bond price" },
              { symbol: "C", definition: "Coupon payment" },
              { symbol: "y", definition: "Yield to maturity" },
              { symbol: "M", definition: "Face value" },
            ],
          }),
          createFormula({
            leadText: "Current yield:",
            latex: "CY = \\frac{C}{P}",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [{ symbol: "CY", definition: "Current yield" }],
          }),
          createFormula({
            leadText: "Capital gains yield:",
            latex: "CGY = \\frac{P_1 - P_0}{P_0}",
            formulaRefs: ["F3"],
            slide: 4,
            variables: [{ symbol: "CGY", definition: "Capital gains yield" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Current yield measures the annual coupon income relative to the bond's current market price: CY = C / P",
            3,
            "Current yield measures the annual coupon income relative to the bond's current market price: CY = C / P",
          ),
          createGroundedBullet(
            "Total bond return equals current yield plus capital gains yield",
            4,
            "Total bond return equals current yield plus capital gains yield",
          ),
        ],
        sourceSlides: [1, 2, 3, 4],
      }),
      createSection({
        id: "sec-7-b",
        letter: "B",
        titleVi: "B. ĐỘ NHẠY LÃI SUẤT VÀ THỜI LƯỢNG (DURATION)",
        titleEn: "Duration and Interest Rate Risk",
        overview: "Duration metrics and percentage price sensitivity:",
        formulas: [
          createFormula({
            leadText: "Macaulay Duration:",
            latex: "D = \\frac{\\sum_{t=1}^n t \\times \\frac{CF_t}{(1 + y)^t}}{P}",
            formulaRefs: ["F4"],
            slide: 5,
            variables: [{ symbol: "D", definition: "Macaulay duration" }],
          }),
          createFormula({
            leadText: "Modified Duration:",
            latex: "D^* = \\frac{D}{1 + y}",
            formulaRefs: ["F5"],
            slide: 6,
            variables: [{ symbol: "D^*", definition: "Modified duration" }],
          }),
          createFormula({
            leadText: "Percentage price change approximation:",
            latex: "\\frac{\\Delta P}{P} = -D^* \\times \\Delta y",
            formulaRefs: ["F6"],
            slide: 7,
            variables: [{ symbol: "\\Delta P / P", definition: "Percentage price change" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "Macaulay duration measures the weighted-average time until bond cash flows are received",
            5,
            "Macaulay duration measures the weighted-average time until bond cash flows are received",
          ),
          createGroundedBullet(
            "Using modified duration, the approximate percentage change in bond price resulting from a small change in yield is: Delta P / P = -D^* * Delta y",
            7,
            "approximate percentage change in bond price resulting from a small change in yield is: \\Delta P / P = -D^* \\times \\Delta y",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "Bond price is the discounted sum of coupon annuity and principal repayment",
            "Macaulay duration measures effective maturity; modified duration measures price sensitivity",
            "Bond prices move inversely to changes in market yield to maturity",
          ],
          items: [
            createTakeawayItem(
              "Bond valuation sums the present value of coupon annuity and par value",
              2,
              "price P of a coupon bond is the present value of coupon annuity payments plus the present value of the face value",
            ),
            createTakeawayItem(
              "Modified duration relates directly to percentage price change",
              7,
              "approximate percentage change in bond price resulting from a small change in yield is: \\Delta P / P = -D^* \\times \\Delta y",
            ),
          ],
        },
        sourceSlides: [5, 6, 7],
      }),
    ],
  }),
};

// ============================================================================
// DECK 8 — Statistics & Financial Econometrics: OLS Regression
// ============================================================================

const DECK_8_SOURCES: SourceBlock[] = [
  {
    id: "slide-1",
    label: "Slide 1",
    text: "Statistics & Econometrics: Simple Linear Regression and OLS. Simple linear regression models the linear relationship between a dependent response variable Y and an independent explanatory variable X: Y_i = \\beta_0 + \\beta_1 X_i + u_i, where u_i is the disturbance error term.",
  },
  {
    id: "slide-2",
    label: "Slide 2",
    text: "Sample Means. The sample mean represents the central tendency of observations: \\bar{X} = \\frac{1}{n} \\sum_{i=1}^n X_i, and similarly \\bar{Y} = \\frac{1}{n} \\sum_{i=1}^n Y_i. Deviation scores are defined as (X_i - \\bar{X}) and (Y_i - \\bar{Y}).",
  },
  {
    id: "slide-3",
    label: "Slide 3",
    text: "OLS Slope Estimator. The Ordinary Least Squares (OLS) estimator minimizes the sum of squared residuals. The OLS slope estimator is: \\hat{\\beta}_1 = \\frac{\\sum (X_i - \\bar{X})(Y_i - \\bar{Y})}{\\sum (X_i - \\bar{X})^2}. It equals the sample covariance of X and Y divided by sample variance of X.",
  },
  {
    id: "slide-4",
    label: "Slide 4",
    text: "OLS Intercept Estimator. Because the OLS regression line always passes through the point of sample means (\\bar{X}, \\bar{Y}), the intercept estimator is: \\hat{\\beta}_0 = \\bar{Y} - \\hat{\\beta}_1 \\bar{X}.",
  },
  {
    id: "slide-5",
    label: "Slide 5",
    text: "Decomposition of Sum of Squares. The total variation in Y decomposes into explained and unexplained components: TSS = ESS + SSE, where Total Sum of Squares TSS = \\sum (Y_i - \\bar{Y})^2, Explained Sum of Squares ESS = \\sum (\\hat{Y}_i - \\bar{Y})^2, and Sum of Squared Errors SSE = \\sum e_i^2.",
  },
  {
    id: "slide-6",
    label: "Slide 6",
    text: "Coefficient of Determination (R-squared). R-squared measures the proportion of total variation in Y explained by the independent variable X: R^2 = 1 - \\frac{SSE}{TSS}. It ranges between 0 and 1, with higher values indicating better in-sample fit.",
  },
  {
    id: "slide-7",
    label: "Slide 7",
    text: "Standard Error and Hypothesis Testing. The standard error of regression estimates disturbance variance: s_e = \\sqrt{\\frac{SSE}{n - 2}}. To test the null hypothesis H_0: \\beta_1 = \\beta_0, the t-statistic is: t = \\frac{\\hat{\\beta}_1 - \\beta_0}{SE(\\hat{\\beta}_1)}, distributed as t with n - 2 degrees of freedom.",
  },
  {
    id: "slide-8",
    label: "Slide 8",
    text: "OLS Slope Practice Exercise. Given sum of cross products 120 and sum of squared X deviations 80: \\hat{\\beta}_1 = 120 / 80 = 1.5. Calculate slope.",
  },
];

const DECK_8_LEDGER: FormulaLedgerEntry[] = [
  {
    id: "F1",
    slide: 2,
    raw: "\\bar{X} = \\frac{1}{n} \\sum_{i=1}^n X_i",
    latex: "\\bar{X} = \\frac{1}{n} \\sum_{i=1}^n X_i",
    origin: "text",
    label: "Sample Mean",
    evidence: "\\bar{X} = \\frac{1}{n} \\sum_{i=1}^n X_i",
    variables: [
      { symbol: "\\bar{X}", definition: "Sample mean" },
      { symbol: "n", definition: "Sample size" },
      { symbol: "X_i", definition: "Individual observation" },
    ],
  },
  {
    id: "F2",
    slide: 3,
    raw: "\\hat{\\beta}_1 = \\frac{\\sum (X_i - \\bar{X})(Y_i - \\bar{Y})}{\\sum (X_i - \\bar{X})^2}",
    latex: "\\hat{\\beta}_1 = \\frac{\\sum (X_i - \\bar{X})(Y_i - \\bar{Y})}{\\sum (X_i - \\bar{X})^2}",
    origin: "text",
    label: "OLS Slope Estimator",
    evidence: "\\hat{\\beta}_1 = \\frac{\\sum (X_i - \\bar{X})(Y_i - \\bar{Y})}{\\sum (X_i - \\bar{X})^2}",
    variables: [
      { symbol: "\\hat{\\beta}_1", definition: "OLS slope estimator" },
    ],
  },
  {
    id: "F3",
    slide: 4,
    raw: "\\hat{\\beta}_0 = \\bar{Y} - \\hat{\\beta}_1 \\bar{X}",
    latex: "\\hat{\\beta}_0 = \\bar{Y} - \\hat{\\beta}_1 \\bar{X}",
    origin: "text",
    label: "OLS Intercept Estimator",
    evidence: "\\hat{\\beta}_0 = \\bar{Y} - \\hat{\\beta}_1 \\bar{X}",
    variables: [
      { symbol: "\\hat{\\beta}_0", definition: "OLS intercept estimator" },
      { symbol: "\\bar{Y}", definition: "Sample mean of Y" },
      { symbol: "\\bar{X}", definition: "Sample mean of X" },
    ],
  },
  {
    id: "F4",
    slide: 5,
    raw: "TSS = ESS + SSE",
    latex: "TSS = ESS + SSE",
    origin: "text",
    label: "Sum of Squares Decomposition",
    evidence: "TSS = ESS + SSE",
    variables: [
      { symbol: "TSS", definition: "Total sum of squares" },
      { symbol: "ESS", definition: "Explained sum of squares" },
      { symbol: "SSE", definition: "Sum of squared errors" },
    ],
  },
  {
    id: "F5",
    slide: 6,
    raw: "R^2 = 1 - \\frac{SSE}{TSS}",
    latex: "R^2 = 1 - \\frac{SSE}{TSS}",
    origin: "text",
    label: "Coefficient of Determination (R^2)",
    evidence: "R^2 = 1 - \\frac{SSE}{TSS}",
    variables: [
      { symbol: "R^2", definition: "Coefficient of determination" },
    ],
  },
  {
    id: "F6",
    slide: 7,
    raw: "s_e = \\sqrt{\\frac{SSE}{n - 2}}",
    latex: "s_e = \\sqrt{\\frac{SSE}{n - 2}}",
    origin: "text",
    label: "Standard Error of Regression",
    evidence: "s_e = \\sqrt{\\frac{SSE}{n - 2}}",
    variables: [
      { symbol: "s_e", definition: "Standard error of regression" },
      { symbol: "n - 2", definition: "Degrees of freedom" },
    ],
  },
  {
    id: "F7",
    slide: 7,
    raw: "t = \\frac{\\hat{\\beta}_1 - \\beta_0}{SE(\\hat{\\beta}_1)}",
    latex: "t = \\frac{\\hat{\\beta}_1 - \\beta_0}{SE(\\hat{\\beta}_1)}",
    origin: "text",
    label: "t-Statistic for OLS Coefficient",
    evidence: "t = \\frac{\\hat{\\beta}_1 - \\beta_0}{SE(\\hat{\\beta}_1)}",
    variables: [
      { symbol: "t", definition: "Hypothesis test t-statistic" },
      { symbol: "SE(\\hat{\\beta}_1)", definition: "Standard error of slope estimator" },
    ],
  },
  {
    id: "F8",
    slide: 8,
    raw: "\\hat{\\beta}_1 = 120 / 80",
    latex: "\\hat{\\beta}_1 = \\frac{120}{80}",
    origin: "text",
    label: "OLS Slope Calculation Plug-in",
    isExerciseOnly: true,
    evidence: "\\hat{\\beta}_1 = 120 / 80 = 1.5",
    variables: [],
  },
];

export const DECK_8_OLS_REGRESSION: GoldenDeckDefinition = {
  id: "deck-8-ols-econometrics",
  title: "Simple Linear Regression & Ordinary Least Squares (OLS)",
  subject: "Econometrics",
  slideCount: 8,
  sources: DECK_8_SOURCES,
  expectedLedger: DECK_8_LEDGER,
  expectedPlacedFormulaIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7"],
  validOmittedFormulaIds: ["F8"],
  forbiddenInjectedFormulas: [
    "DW = \\frac{\\sum (e_t - e_{t-1})^2}{\\sum e_t^2}",
    "\\hat{\\beta}_{IV} = (Z'X)^{-1} Z' Y",
    "\\text{Var}_{HC}(\\hat{\\beta}) = (X'X)^{-1}(X'\\hat{\\Omega}X)(X'X)^{-1}",
  ],
  goldNote: createGoldNote({
    id: "note-deck-8",
    title: "OLS SIMPLE LINEAR REGRESSION",
    subject: "Econometrics",
    originalFileName: "econometrics-ols.pptx",
    originalSlideCount: 8,
    executiveSummary:
      "Comprehensive statistical guide on simple linear regression, OLS slope and intercept derivation, ANOVA sum of squares decomposition, R-squared goodness of fit, and coefficient t-tests.",
    formulaLedger: DECK_8_LEDGER,
    omitted: [
      {
        formulaId: "F8",
        reason: "Numerical slope calculation plug-in omitted from general notes",
      },
    ],
    sections: [
      createSection({
        id: "sec-8-a",
        letter: "A",
        titleVi: "A. ƯỚC LƯỢNG HỒI QUY TUYẾN TÍNH OLS",
        titleEn: "OLS Regression Estimation",
        coreStatement:
          "The Ordinary Least Squares (OLS) estimator minimizes the sum of squared residuals.",
        overview: "Sample means and coefficient formulas:",
        formulas: [
          createFormula({
            leadText: "Sample mean formula:",
            latex: "\\bar{X} = \\frac{1}{n} \\sum_{i=1}^n X_i",
            formulaRefs: ["F1"],
            slide: 2,
            variables: [{ symbol: "\\bar{X}", definition: "Sample mean" }],
          }),
          createFormula({
            leadText: "OLS slope estimator:",
            latex: "\\hat{\\beta}_1 = \\frac{\\sum (X_i - \\bar{X})(Y_i - \\bar{Y})}{\\sum (X_i - \\bar{X})^2}",
            formulaRefs: ["F2"],
            slide: 3,
            variables: [{ symbol: "\\hat{\\beta}_1", definition: "OLS slope estimator" }],
          }),
          createFormula({
            leadText: "OLS intercept estimator:",
            latex: "\\hat{\\beta}_0 = \\bar{Y} - \\hat{\\beta}_1 \\bar{X}",
            formulaRefs: ["F3"],
            slide: 4,
            variables: [{ symbol: "\\hat{\\beta}_0", definition: "OLS intercept estimator" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "The sample mean represents the central tendency of observations",
            2,
            "sample mean represents the central tendency of observations: \\bar{X} = \\frac{1}{n} \\sum_{i=1}^n X_i",
          ),
          createGroundedBullet(
            "The Ordinary Least Squares (OLS) estimator minimizes the sum of squared residuals",
            3,
            "Ordinary Least Squares (OLS) estimator minimizes the sum of squared residuals",
          ),
          createGroundedBullet(
            "Because the OLS regression line always passes through the point of sample means (X_bar, Y_bar)",
            4,
            "OLS regression line always passes through the point of sample means (\\bar{X}, \\bar{Y})",
          ),
        ],
        sourceSlides: [1, 2, 3, 4],
      }),
      createSection({
        id: "sec-8-b",
        letter: "B",
        titleVi: "B. PHÂN TÍCH ĐỘ PHÙ HỢP VÀ KIỂM ĐỊNH GIẢ THUYẾT",
        titleEn: "Goodness of Fit & Hypothesis Testing",
        overview: "Decomposition of variation and statistical tests:",
        formulas: [
          createFormula({
            leadText: "Sum of squares decomposition:",
            latex: "TSS = ESS + SSE",
            formulaRefs: ["F4"],
            slide: 5,
            variables: [{ symbol: "TSS", definition: "Total sum of squares" }],
          }),
          createFormula({
            leadText: "Coefficient of determination (R-squared):",
            latex: "R^2 = 1 - \\frac{SSE}{TSS}",
            formulaRefs: ["F5"],
            slide: 6,
            variables: [{ symbol: "R^2", definition: "Coefficient of determination" }],
          }),
          createFormula({
            leadText: "Standard error of regression:",
            latex: "s_e = \\sqrt{\\frac{SSE}{n - 2}}",
            formulaRefs: ["F6"],
            slide: 7,
            variables: [{ symbol: "s_e", definition: "Standard error of regression" }],
          }),
          createFormula({
            leadText: "t-statistic for hypothesis testing on beta:",
            latex: "t = \\frac{\\hat{\\beta}_1 - \\beta_0}{SE(\\hat{\\beta}_1)}",
            formulaRefs: ["F7"],
            slide: 7,
            variables: [{ symbol: "t", definition: "Hypothesis testing t-statistic" }],
          }),
        ],
        groundedBullets: [
          createGroundedBullet(
            "The total variation in Y decomposes into explained and unexplained components: TSS = ESS + SSE",
            5,
            "total variation in Y decomposes into explained and unexplained components: TSS = ESS + SSE",
          ),
          createGroundedBullet(
            "R-squared measures the proportion of total variation in Y explained by the independent variable X: R^2 = 1 - SSE / TSS",
            6,
            "R-squared measures the proportion of total variation in Y explained by the independent variable X: R^2 = 1 - \\frac{SSE}{TSS}",
          ),
          createGroundedBullet(
            "The standard error of regression estimates disturbance variance: s_e = sqrt(SSE / (n - 2))",
            7,
            "standard error of regression estimates disturbance variance: s_e = \\sqrt{\\frac{SSE}{n - 2}}",
          ),
        ],
        keyTakeaways: {
          title: "KEY TAKEAWAYS",
          summaryPoints: [
            "OLS slope is ratio of covariance(X,Y) to variance(X)",
            "Regression line always passes through point of sample means",
            "R-squared equals 1 - SSE/TSS and measures explanatory power",
          ],
          items: [
            createTakeawayItem(
              "OLS minimizes sum of squared residuals to estimate slope and intercept",
              3,
              "Ordinary Least Squares (OLS) estimator minimizes the sum of squared residuals",
            ),
            createTakeawayItem(
              "Total sum of squares decomposes strictly into ESS and SSE",
              5,
              "total variation in Y decomposes into explained and unexplained components: TSS = ESS + SSE",
            ),
            createTakeawayItem(
              "t-statistic tests coefficient significance with n - 2 degrees of freedom",
              7,
              "t-statistic is: t = \\frac{\\hat{\\beta}_1 - \\beta_0}{SE(\\hat{\\beta}_1)}, distributed as t with n - 2 degrees of freedom",
            ),
          ],
        },
        sourceSlides: [5, 6, 7],
      }),
    ],
  }),
};

// ============================================================================
// AGGREGATED GOLDEN DECK SUITE
// ============================================================================

export const GOLDEN_DECKS: GoldenDeckDefinition[] = [
  DECK_1_STOCK_VALUATION,
  DECK_2_RISK_AND_RETURN,
  DECK_3_WACC,
  DECK_4_ELASTICITY,
  DECK_5_MONOPOLY,
  DECK_6_IS_LM,
  DECK_7_BOND_VALUATION,
  DECK_8_OLS_REGRESSION,
];
