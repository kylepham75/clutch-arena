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
          heading: "CASE 1: Zero Growth Model (Không tăng trưởng)",
          bulletPoints: [
            "Dividends remain the same forever",
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
            "Used when the company is stable and mature",
          ],
          formulas: [
            {
              name: "",
              latex:
                "P_0 = \\frac{D_1}{(1 + R)} + \\frac{D_1 \\cdot (1 + g)}{(1 + R)^2} + \\frac{D_1 \\cdot (1 + g)^2}{(1 + R)^3} + \\frac{D_1 \\cdot (1 + g)^3}{(1 + R)^4} + \\dots = \\frac{D_1}{R - g}",
              variables: [],
            },
          ],
        },
        {
          heading: "CASE 3: Differential Growth Model (Tăng trưởng khác biệt)",
          bulletPoints: ["Used when dividends grow at different rates over time"],
          formulas: [],
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
              "Zero growth → Perpetuity",
              "Constant growth → Gordon model",
              "Differential growth → Multi-stage valuation",
            ],
          },
          {
            point: "Only use DDM if company pays dividends regularly",
            subBullets: [],
          },
          {
            point: "Make sure $g < r$, otherwise the model breaks down",
            subBullets: [],
          },
        ],
        boundaryConditions: "Make sure g < r, otherwise the model breaks down",
        summaryPoints: [
          "Stock value = present value of expected future dividends",
          "Use different models depending on dividend behavior: Zero growth → Perpetuity, Constant growth → Gordon model, Differential growth → Multi-stage valuation",
          "Only use DDM if company pays dividends regularly",
          "Make sure g < r, otherwise the model breaks down",
        ],
      },
      sourceSlides: [5, 6, 7, 8, 9],
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
          heading: "Finding the growth rate (g)",
          bulletPoints: [],
          formulas: [
            {
              name: "",
              latex: "g = \\text{Retention ratio} \\times \\text{Return on retained earnings (ROE)}",
              variables: [],
            },
          ],
        },
        {
          heading: "Finding the discount rate (R)",
          leadIn: "The discount rate can be broken into two parts:",
          bulletPoints: ["The dividend yield.", "The growth rate (in dividends)"],
          formulas: [
            {
              name: "",
              leadText:
                "In practice, there is a great deal of estimation error involved in estimating R. Let's start with the DGM:",
              latex: "P_0 = \\frac{D_0(1 + g)}{R - g} = \\frac{D_1}{R - g}",
              variables: [],
            },
            {
              name: "",
              leadText: "Rearranging the equation to solve for R, we get:",
              latex: "R = \\frac{D_0(1 + g)}{P_0} + g = \\frac{D_1}{P_0} + g",
              variables: [],
            },
          ],
        },
      ],
      keyTakeaways: null,
      sourceSlides: [14],
    },
    {
      id: "section-e",
      letter: "E",
      titleVi: "E. VALUE OF PREFERENCE SHARE",
      titleEn: "",
      overview: "Some key features:",
      bulletPoints: [
        "Pays fixed dividends (like bonds) but has no maturity date.",
        "Dividends paid before common stockholders.",
        "Usually no voting rights.",
        "Valued as perpetuity.",
      ],
      formulas: [
        {
          name: "",
          leadText: "The equation:",
          latex: "P_p = \\frac{D_p}{R_p}",
          variables: [
            { symbol: "P_p", definition: "Price of the preferred stock" },
            { symbol: "D_p", definition: "Annual dividend of the preferred stock" },
            { symbol: "R_p", definition: "Required rate of return" },
          ],
        },
      ],
      subSections: [],
      keyTakeaways: null,
      sourceSlides: [18, 19],
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

### CASE 1: Zero Growth Model (Không tăng trưởng)
- Dividends remain the same forever
- This is a perpetuity model

$$P_0 = \\frac{D}{(1 + R)} + \\frac{D}{(1 + R)^2} + \\frac{D}{(1 + R)^3} + \\frac{D}{(1 + R)^4} + \\dots = \\frac{D}{R}$$

### CASE 2: Constant Growth Model (Tăng trưởng đều)
- Dividends grow at a constant rate g forever
- Used when the company is stable and mature

$$P_0 = \\frac{D_1}{(1 + R)} + \\frac{D_1 \\cdot (1 + g)}{(1 + R)^2} + \\dots = \\frac{D_1}{R - g}$$

### CASE 3: Differential Growth Model (Tăng trưởng khác biệt)
- Used when dividends grow at different rates over time

> **KEY TAKEAWAYS**
> 1. Stock value = present value of expected future dividends
> 2. Use different models depending on dividend behavior:
>    - Zero growth → Perpetuity
>    - Constant growth → Gordon model
>    - Differential growth → Multi-stage valuation
> 3. Only use DDM if company pays dividends regularly
> 4. Make sure $g < r$, otherwise the model breaks down

## D. PARAMETERS IN DIVIDEND DISCOUNT MODEL
### Finding the growth rate (g)
$$g = \\text{Retention ratio} \\times \\text{Return on retained earnings (ROE)}$$

### Finding the discount rate (R)
The discount rate can be broken into two parts:
- The dividend yield.
- The growth rate (in dividends)

In practice, there is a great deal of estimation error involved in estimating R. Let's start with the DGM:
$$P_0 = \\frac{D_0(1 + g)}{R - g} = \\frac{D_1}{R - g}$$

Rearranging the equation to solve for R, we get:
$$R = \\frac{D_0(1 + g)}{P_0} + g = \\frac{D_1}{P_0} + g$$

## E. VALUE OF PREFERENCE SHARE
Some key features:
- Pays fixed dividends (like bonds) but has no maturity date.
- Dividends paid before common stockholders.
- Usually no voting rights.
- Valued as perpetuity.

The equation:
$$P_p = \\frac{D_p}{R_p}$$

**Trong đó:**
- $P_p$: Price of the preferred stock
- $D_p$: Annual dividend of the preferred stock
- $R_p$: Required rate of return`,
};
