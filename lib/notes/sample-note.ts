import type { ClutchNote } from "@/lib/schemas/notes";

export const SAMPLE_CLUTCH_NOTE: ClutchNote = {
  id: "clutch-note-ch9-stock-valuation",
  title: "CHAPTER 9: STOCK VALUATION",
  subject: "Corporate Finance",
  createdAt: new Date().toISOString(),
  originalFileName: "Corporate_Finance_Session2_Chapter9_Stock_Valuation.pdf",
  originalSlideCount: 27,
  estimatedDistilledPages: 3,
  noiseReductionRate: 89,
  executiveSummary:
    "Distilled from 27 lecture slides into a single 3-page study sheet covering DDM models, growth & discount parameters, and preference share valuation.",
  sections: [
    {
      id: "section-a",
      letter: "A",
      titleVi: "A. NGUYÊN LÝ CƠ BẢN",
      titleEn: "Fundamental Principle",
      coreStatement:
        "The value of any asset = the present value (PV) of its expected future cash flows.",
      overview: "For stocks, future cash flows come from:",
      bulletPoints: [
        "Dividends (Cổ tức) – regular payments from the company",
        "Capital gains (Lợi nhuận vốn) – the price you get when you sell the stock",
      ],
      formulas: [],
      subSections: [],
      keyTakeaways: null,
      sourceSlides: [4],
    },
    {
      id: "section-b",
      letter: "B",
      titleVi: "B. CÔNG THỨC TỔNG QUÁT",
      titleEn: "General One-Period Formula",
      overview: "",
      bulletPoints: [],
      formulas: [
        {
          name: "",
          leadText: "Nếu chỉ đầu tư trong 1 năm:",
          latex: "P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}",
          variables: [
            { symbol: "P_0", definition: "Price of the stock today" },
            { symbol: "D_1", definition: "Expected dividend at the end of the year" },
            { symbol: "P_1", definition: "Expected price at the end of the year" },
            { symbol: "R", definition: "Required rate of return" },
          ],
        },
      ],
      subSections: [],
      keyTakeaways: null,
      sourceSlides: [4],
    },
    {
      id: "section-c",
      letter: "C",
      titleVi: "C. DDM (DIVIDEND DISCOUNT MODEL)",
      titleEn: "",
      overview: "The DDM calculates stock value as the present value of all expected future dividends:",
      bulletPoints: ["Zero Growth.", "Constant Growth.", "Differential Growth."],
      formulas: [
        {
          name: "",
          latex:
            "P_0 = \\frac{D_1}{(1 + R)} + \\frac{D_2}{(1 + R)^2} + \\frac{D_3}{(1 + R)^3} + \\dots = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}",
          description: "We classify stock valuation models based on how dividends grow:",
          variables: [],
        },
      ],
      subSections: [
        {
          heading: "CASE 1: Zero Growth Model (Không tăng trưởng, g = 0)",
          bulletPoints: [
            "Dividends remain the same forever (g = 0)",
            "This is a perpetuity model",
          ],
          formulas: [
            {
              name: "",
              latex:
                "P_0 = \\frac{D}{(1 + R)} + \\frac{D}{(1 + R)^2} + \\frac{D}{(1 + R)^3} + \\frac{D}{(1 + R)^4} + \\dots = \\frac{D}{R}",
              variables: [],
            },
          ],
        },
        {
          heading: "CASE 2: Constant Growth Model (Tăng trưởng đều)",
          bulletPoints: [
            "Dividends grow at a constant rate g forever",
            "Requires R > g (otherwise the model is invalid)",
            "Used when the company is stable and mature",
          ],
          formulas: [
            {
              name: "",
              latex:
                "P_0 = \\frac{D_1}{(1 + R)} + \\frac{D_1 \\cdot (1 + g)}{(1 + R)^2} + \\dots = \\frac{D_1}{R - g}",
              variables: [],
            },
          ],
        },
        {
          heading: "CASE 3: Differential Growth Model (Tăng trưởng nhiều giai đoạn)",
          bulletPoints: [
            "Used when dividends grow at non-constant rates initially before settling into constant growth",
            "Calculate early dividends year-by-year during the non-constant period",
            "Find the Terminal Value (P_N) at the start of constant growth, then discount everything to Year 0",
          ],
          formulas: [
            {
              name: "",
              leadText: "General multi-stage valuation equation:",
              latex:
                "P_0 = \\sum_{t=1}^{N} \\frac{D_t}{(1 + R)^t} + \\frac{P_N}{(1 + R)^N}",
              variables: [
                {
                  symbol: "P_N",
                  definition: "Terminal Value (stock price at the end of the non-constant period Year N)",
                },
              ],
            },
            {
              name: "",
              leadText: "Terminal Value calculation at Year N:",
              latex:
                "P_N = \\frac{D_{N+1}}{R - g} = \\frac{D_N \\cdot (1 + g)}{R - g}",
              description: "P_N values the infinite constant-growth perpetuity starting after Year N.",
              variables: [
                {
                  symbol: "D_{N+1}",
                  definition: "First dividend in the constant growth stage",
                },
              ],
            },
          ],
        },
      ],
      keyTakeaways: {
        title: "KEY TAKEAWAYS",
        items: [
          {
            point: "Stock value = present value of expected future dividends",
            subBullets: [],
          },
          {
            point: "Use different models depending on dividend behavior:",
            subBullets: [
              "Zero growth (g = 0) → Perpetuity formula",
              "Constant growth → Gordon model",
              "Differential growth → Multi-stage valuation with Terminal Value (P_N)",
            ],
          },
          {
            point: "Only use DDM if company pays dividends regularly",
            subBullets: [],
          },
          {
            point: "Make sure g < R in constant growth, otherwise the model breaks down",
            subBullets: [],
          },
        ],
        boundaryConditions: "Make sure g < R, otherwise the model breaks down",
        summaryPoints: [
          "Stock value = present value of expected future dividends",
          "Use different models depending on dividend behavior: Zero growth (g = 0) → Perpetuity, Constant growth → Gordon model, Differential growth → Multi-stage valuation",
          "Only use DDM if company pays dividends regularly",
          "Make sure g < R, otherwise the model breaks down",
        ],
      },
      sourceSlides: [5, 6, 7, 8, 9, 23, 24, 25, 26],
    },
    {
      id: "section-d",
      letter: "D",
      titleVi: "D. PARAMETERS IN DIVIDEND DISCOUNT MODEL",
      titleEn: "",
      overview: "",
      bulletPoints: [],
      formulas: [],
      subSections: [
        {
          heading: "1. Finding the growth rate (g)",
          leadIn: "Fundamental accounting formula for sustainable dividend growth:",
          bulletPoints: [
            "g is determined by the firm's reinvestment policy and return on equity, NOT circular price changes.",
          ],
          formulas: [
            {
              name: "",
              latex: "g = \\text{Retention ratio} \\times \\text{Return on retained earnings (ROE)}",
              variables: [
                {
                  symbol: "\\text{Retention ratio}",
                  definition: "Proportion of net earnings retained in the business = 1 - Dividend Payout Ratio",
                },
                {
                  symbol: "\\text{ROE}",
                  definition: "Return on equity earned on retained earnings",
                },
              ],
            },
          ],
        },
        {
          heading: "2. Finding the discount rate (R) with DGM",
          leadIn: "The required return is decomposed into two distinct economic components:",
          bulletPoints: [
            "Dividend Yield = \\frac{D_1}{P_0}: Expected annual cash dividend as a percentage of current stock price (frequently tested independently).",
            "Capital Gains Yield = g: The rate at which the stock price increases over time.",
          ],
          formulas: [
            {
              name: "",
              leadText: "Decomposition of required return R:",
              latex:
                "R = \\underbrace{\\frac{D_1}{P_0}}_{\\text{Dividend Yield}} + \\underbrace{g}_{\\text{Capital Gains Yield}}",
              variables: [],
            },
          ],
        },
      ],
      keyTakeaways: null,
      sourceSlides: [14, 15, 16, 17],
    },
    {
      id: "section-e",
      letter: "E",
      titleVi: "E. VALUE OF PREFERENCE SHARE",
      titleEn: "",
      overview: "Key characteristics of preferred stock:",
      bulletPoints: [
        "Pays fixed dividends (like bonds) but has no maturity date.",
        "Dividends paid before common stockholders.",
        "Usually no voting rights.",
        "Valued as perpetuity.",
      ],
      formulas: [
        {
          name: "",
          leadText: "Standard preferred stock (immediate perpetuity):",
          latex: "P_p = \\frac{D_p}{R_p}",
          variables: [
            { symbol: "P_p", definition: "Price of the preferred stock" },
            { symbol: "D_p", definition: "Annual dividend of the preferred stock" },
            { symbol: "R_p", definition: "Required rate of return" },
          ],
        },
      ],
      subSections: [
        {
          heading: "Deferred Preferred Stock (Cổ phiếu ưu đãi hoãn trả)",
          leadIn: "When dividends begin at Year t (delayed perpetuity):",
          bulletPoints: [
            "Step 1: Calculate the price at Year t-1 (one year before first dividend): P_{t-1} = \\frac{D_t}{R_p}",
            "Step 2: Discount P_{t-1} back to Year 0: P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}",
          ],
          formulas: [
            {
              name: "",
              leadText: "Two-step deferred perpetuity valuation:",
              latex: "P_{t-1} = \\frac{D_t}{R_p} \\implies P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}",
              description: "Find the price one period before the first dividend payment, then discount back to today.",
              variables: [],
            },
          ],
        },
      ],
      keyTakeaways: null,
      sourceSlides: [18, 19, 20, 21, 22],
    },
  ],
  rawMarkdown: `# CHAPTER 9: STOCK VALUATION
*Corporate Finance · 27 Slides → 3 Pages*

## A. NGUYÊN LÝ CƠ BẢN
**The value of any asset = the present value (PV) of its expected future cash flows.**

For stocks, future cash flows come from:
- Dividends (Cổ tức) – regular payments from the company
- Capital gains (Lợi nhuận vốn) – the price you get when you sell the stock

## B. CÔNG THỨC TỔNG QUÁT
Nếu chỉ đầu tư trong 1 năm:

$$P_0 = \\frac{D_1}{1 + R} + \\frac{P_1}{1 + R}$$

**Trong đó:**
- $P_0$: Price of the stock today
- $D_1$: Expected dividend at the end of the year
- $P_1$: Expected price at the end of the year
- $R$: Required rate of return

## C. DDM (DIVIDEND DISCOUNT MODEL)
The DDM calculates stock value as the present value of all expected future dividends:

$$P_0 = \\frac{D_1}{(1 + R)} + \\frac{D_2}{(1 + R)^2} + \\frac{D_3}{(1 + R)^3} + \\dots = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + R)^t}$$

We classify stock valuation models based on how dividends grow:
- Zero Growth.
- Constant Growth.
- Differential Growth.

### CASE 1: Zero Growth Model (Không tăng trưởng, g = 0)
- Dividends remain the same forever (g = 0)
- This is a perpetuity model

$$P_0 = \\frac{D}{(1 + R)} + \\frac{D}{(1 + R)^2} + \\frac{D}{(1 + R)^3} + \\frac{D}{(1 + R)^4} + \\dots = \\frac{D}{R}$$

### CASE 2: Constant Growth Model (Tăng trưởng đều)
- Dividends grow at a constant rate g forever
- Requires R > g (otherwise the model is invalid)
- Used when the company is stable and mature

$$P_0 = \\frac{D_1}{(1 + R)} + \\frac{D_1 \\cdot (1 + g)}{(1 + R)^2} + \\dots = \\frac{D_1}{R - g}$$

### CASE 3: Differential Growth Model (Tăng trưởng nhiều giai đoạn)
- Used when dividends grow at non-constant rates initially before settling into constant growth
- Calculate early dividends year-by-year during the non-constant period
- Find the Terminal Value (P_N) at the start of constant growth, then discount everything to Year 0

General multi-stage valuation equation:
$$P_0 = \\sum_{t=1}^{N} \\frac{D_t}{(1 + R)^t} + \\frac{P_N}{(1 + R)^N}$$

Terminal Value calculation at Year N:
$$P_N = \\frac{D_{N+1}}{R - g} = \\frac{D_N \\cdot (1 + g)}{R - g}$$

> **KEY TAKEAWAYS**
> 1. Stock value = present value of expected future dividends
> 2. Use different models depending on dividend behavior:
>    - Zero growth (g = 0) → Perpetuity formula
>    - Constant growth → Gordon model
>    - Differential growth → Multi-stage valuation with Terminal Value (P_N)
> 3. Only use DDM if company pays dividends regularly
> 4. Make sure g < R in constant growth, otherwise the model breaks down

## D. PARAMETERS IN DIVIDEND DISCOUNT MODEL
### 1. Finding the growth rate (g)
Fundamental accounting formula for sustainable dividend growth:
- g is determined by the firm's reinvestment policy and return on equity, NOT circular price changes.

$$g = \\text{Retention ratio} \\times \\text{Return on retained earnings (ROE)}$$

**Trong đó:**
- $\\text{Retention ratio}$: Proportion of net earnings retained in the business = 1 - Dividend Payout Ratio
- $\\text{ROE}$: Return on equity earned on retained earnings

### 2. Finding the discount rate (R) with DGM
The required return is decomposed into two distinct economic components:
- Dividend Yield = \\frac{D_1}{P_0}: Expected annual cash dividend as a percentage of current stock price (frequently tested independently).
- Capital Gains Yield = g: The rate at which the stock price increases over time.

Decomposition of required return R:
$$R = \\underbrace{\\frac{D_1}{P_0}}_{\\text{Dividend Yield}} + \\underbrace{g}_{\\text{Capital Gains Yield}}$$

## E. VALUE OF PREFERENCE SHARE
Key characteristics of preferred stock:
- Pays fixed dividends (like bonds) but has no maturity date.
- Dividends paid before common stockholders.
- Usually no voting rights.
- Valued as perpetuity.

Standard preferred stock (immediate perpetuity):
$$P_p = \\frac{D_p}{R_p}$$

**Trong đó:**
- $P_p$: Price of the preferred stock
- $D_p$: Annual dividend of the preferred stock
- $R_p$: Required rate of return

### Deferred Preferred Stock (Cổ phiếu ưu đãi hoãn trả)
When dividends begin at Year t (delayed perpetuity):
- Step 1: Calculate the price at Year t-1 (one year before first dividend): P_{t-1} = \\frac{D_t}{R_p}
- Step 2: Discount P_{t-1} back to Year 0: P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}

Two-step deferred perpetuity valuation:
$$P_{t-1} = \\frac{D_t}{R_p} \\implies P_0 = \\frac{P_{t-1}}{(1 + R_p)^{t-1}}$$`,
};
