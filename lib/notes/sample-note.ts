import type { ClutchNote } from "@/lib/schemas/notes";

export const SAMPLE_CLUTCH_NOTE: ClutchNote = {
  id: "clutch-note-corp-fin-equity-valuation",
  title: "Corporate Finance: Equity Valuation & Dividend Discount Models",
  subject: "Corporate Finance / Tài chính doanh nghiệp (FIN301)",
  createdAt: new Date().toISOString(),
  originalFileName: "FIN301_Lecture05_EquityValuation_Slides.pptx",
  originalSlideCount: 27,
  estimatedDistilledPages: 3,
  noiseReductionRate: 89,
  executiveSummary:
    "Distilled from 27 raw lecture slides down to 3 exam-ready pages. Removes administrative announcements, introductory agendas, and numerical arithmetic drills. Synthesizes core discounted cash flow valuation principles, zero-growth, Gordon constant-growth, and two-stage non-constant dividend models with standardized LaTeX equations and model selection boundary conditions.",
  sections: [
    {
      id: "section-a",
      letter: "A",
      titleVi: "A. NGUYÊN LÝ CƠ BẢN & ĐỊNH GIÁ DÒNG TIỀN CỔ PHIẾU",
      titleEn: "Fundamental Principles of Stock Valuation",
      overview:
        "The intrinsic value ($P_0$) of a share of stock is the present value (Giá trị hiện tại) of all expected future cash flows that the stock provides to its investor. Unlike bonds which pay fixed coupons, equity cash flows consist of uncertain Dividends (Cổ tức) and Capital Gains (Lãi vốn) realized at the horizon selling price ($P_n$).",
      bulletPoints: [
        "One-period investor horizon: Value equals expected dividend $D_1$ plus expected terminal selling price $P_1$, discounted at required rate of return $r$.",
        "Infinite holding period: Terminal price discounts to zero asymptotically. Stock value equals the infinite sum of discounted dividends.",
        "Required rate of return ($r$ - Tỷ suất sinh lời đòi hỏi): Derived from CAPM or investor opportunity cost of capital.",
      ],
      formulas: [
        {
          name: "General Dividend Discount Model (Mô hình chiết khấu cổ tức tổng quát)",
          latex: "P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + r)^t}",
          description: "Theoretical foundation of equity valuation across an infinite holding period",
          variables: [
            { symbol: "P_0", definition: "Current intrinsic value of stock ($/share)" },
            { symbol: "D_t", definition: "Expected cash dividend paid at end of period t ($/share)" },
            { symbol: "r", definition: "Required rate of equity return / cost of equity (decimal or %)" },
            { symbol: "t", definition: "Time period (years: 1, 2, ..., ∞)" },
          ],
        },
      ],
      keyTakeaways: null,
      sourceSlides: [1, 2, 3, 4, 5],
    },
    {
      id: "section-b",
      letter: "B",
      titleVi: "B. CÔNG THỨC TỔNG QUÁT: CÁC MÔ HÌNH CHIẾT KHẤU CỔ TỨC THEO GIAI ĐOẠN",
      titleEn: "Dividend Growth Models & Closed-Form Formulations",
      overview:
        "Because forecasting infinite individual dividends is practically impossible, corporate finance groups dividend behavior into three canonical operational cases based on corporate lifecycle stage (Chu kỳ sống doanh nghiệp).",
      bulletPoints: [
        "CASE 1: Zero Growth Model (Không tăng trưởng) – Dividends remain perpetual fixed payments ($D_1 = D_2 = D$), mathematically identical to a preferred stock perpetuity.",
        "CASE 2: Constant Growth Model (Tăng trưởng đều / Gordon Growth Model) – Dividends grow at a constant annual rate ($g$) perpetually into the future.",
        "CASE 3: Non-Constant / Multi-Stage Growth Model (Tăng trưởng đa giai đoạn) – Supernormal short-term growth followed by steady-state constant growth.",
      ],
      formulas: [
        {
          name: "CASE 1: Zero Growth / Preferred Stock (Cổ phiếu ưu đãi / Không tăng trưởng)",
          latex: "P_0 = \\frac{D}{r}",
          description: "Perpetuity valuation formula when growth rate g = 0",
          variables: [
            { symbol: "P_0", definition: "Stock price ($/share)" },
            { symbol: "D", definition: "Constant annual dividend payment ($)" },
            { symbol: "r", definition: "Required rate of return" },
          ],
        },
        {
          name: "CASE 2: Constant Growth Model (Mô hình tăng trưởng đều - Gordon)",
          latex: "P_0 = \\frac{D_1}{r - g} = \\frac{D_0(1 + g)}{r - g}",
          description: "Closed-form solution for perpetual constant geometric dividend expansion",
          variables: [
            { symbol: "P_0", definition: "Current stock price at time t = 0" },
            { symbol: "D_0", definition: "Most recent dividend ALREADY PAID by company" },
            { symbol: "D_1", definition: "Next expected dividend to be paid at end of year 1 ($D_1 = D_0 \\times (1 + g)$)" },
            { symbol: "r", definition: "Required return on equity capital" },
            { symbol: "g", definition: "Constant annual dividend growth rate" },
          ],
        },
      ],
      keyTakeaways: null,
      sourceSlides: [6, 7, 8, 9, 10, 11, 12],
    },
    {
      id: "section-c",
      letter: "C",
      titleVi: "C. MÔ HÌNH TĂNG TRƯỞNG PHI LIÊN TỤC & ĐA GIAI ĐOẠN",
      titleEn: "Non-Constant & Supernormal Growth Valuation",
      overview:
        "Emerging technology and high-growth corporations typically experience an initial phase of Supernormal Growth ($g_s$ - Tăng trưởng vượt trội) for $N$ years due to patent protection or rapid market expansion, before maturing into steady sustainable long-run growth ($g_n$).",
      bulletPoints: [
        "Phase 1 (Explicit Forecast): Calculate individual expected dividends $D_1, D_2, ..., D_N$ and discount each to present value at rate $r$.",
        "Phase 2 (Terminal Horizon Value - $P_N$): Apply Gordon Growth formula at horizon year $N$ using steady-state rate $g_n$.",
        "Total Valuation: Intrinsic value equals the sum of discounted explicit dividends plus the discounted horizon value $P_N / (1 + r)^N$.",
      ],
      formulas: [
        {
          name: "Two-Stage Valuation Model (Mô hình định giá hai giai đoạn)",
          latex: "P_0 = \\sum_{t=1}^{N} \\frac{D_t}{(1 + r)^t} + \\frac{P_N}{(1 + r)^N}",
          description: "Combined multi-period explicit DCF and terminal value",
          variables: [
            { symbol: "P_0", definition: "Current intrinsic equity value" },
            { symbol: "N", definition: "Number of years of supernormal/unstable growth" },
            { symbol: "D_t", definition: "Forecasted explicit dividend at year t" },
            { symbol: "P_N", definition: "Terminal / Horizon price calculated at year N ($P_N = \\frac{D_{N+1}}{r - g_n}$)" },
            { symbol: "g_n", definition: "Long-run steady growth rate of mature economy" },
          ],
        },
      ],
      keyTakeaways: {
        title: "KEY TAKEAWAYS: MODEL SELECTION, REAL-WORLD APPLICABILITY & BOUNDARY CONDITIONS",
        modelSelectionRule:
          "1. Use Zero Growth ($P_0 = D/r$) solely for Preferred Stocks or utility companies with guaranteed fixed payouts. 2. Use Constant Growth ($P_0 = D_1 / (r - g)$) for mature blue-chip conglomerates (e.g., consumer staples). 3. Use Multi-Stage Growth when the firm is expanding aggressively or reinvesting all initial earnings.",
        realWorldConditions:
          "Gordon model assumes the dividend payout ratio and return on equity (ROE) remain permanently constant ($g = ROE \\times b$, where $b$ is retention ratio).",
        boundaryConditions:
          "CRITICAL MATHEMATICAL PITFALL: Make sure $g < r$. If $g \\ge r$, the denominator $(r - g) \\le 0$, resulting in an infinite or negative stock price, which causes the mathematical model to completely break down. In reality, a company's sustainable long-run growth rate ($g$) cannot exceed the overall GDP growth rate of the macro economy.",
        summaryPoints: [
          "Differentiate D_0 vs D_1 in exam problems: 'just paid' or 'current dividend' is D_0; 'will pay', 'next year dividend', or 'expected' is D_1.",
          "Gordon Growth Model strictly requires required return to exceed growth rate (r > g).",
          "Long-term growth rate g cannot exceed macro GDP growth (~3-5% annually).",
          "Terminal value P_N must be discounted back to t = 0 by multiplying by 1/(1 + r)^N.",
        ],
      },
      sourceSlides: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    },
  ],
  rawMarkdown: `# Corporate Finance: Equity Valuation & Dividend Discount Models
*FIN301 / Quản trị tài chính · 27 Slides Distilled to 3 Pages · Noise Stripped: 89%*

## A. NGUYÊN LÝ CƠ BẢN & ĐỊNH GIÁ DÒNG TIỀN CỔ PHIẾU
The intrinsic value ($P_0$) of a share of stock is the present value (Giá trị hiện tại) of all expected future cash flows that the stock provides to its investor.

$$P_0 = \\sum_{t=1}^{\\infty} \\frac{D_t}{(1 + r)^t}$$

**Trong đó:**
- $P_0$: Current intrinsic value of stock ($/share)
- $D_t$: Expected cash dividend paid at end of period t ($/share)
- $r$: Required rate of equity return / cost of equity (decimal or %)
- $t$: Time period (years: 1, 2, ..., ∞)

## B. CÔNG THỨC TỔNG QUÁT: CÁC MÔ HÌNH CHIẾT KHẤU CỔ TỨC
- **CASE 1: Zero Growth Model (Không tăng trưởng)**
$$P_0 = \\frac{D}{r}$$

- **CASE 2: Constant Growth Model (Mô hình tăng trưởng đều - Gordon)**
$$P_0 = \\frac{D_1}{r - g} = \\frac{D_0(1 + g)}{r - g}$$

**Trong đó:**
- $P_0$: Current stock price at time t = 0
- $D_0$: Most recent dividend ALREADY PAID by company
- $D_1$: Next expected dividend to be paid at end of year 1 ($D_1 = D_0 \\times (1 + g)$)
- $r$: Required return on equity capital
- $g$: Constant annual dividend growth rate

## C. MÔ HÌNH TĂNG TRƯỞNG PHI LIÊN TỤC & ĐA GIAI ĐOẠN
$$P_0 = \\sum_{t=1}^{N} \\frac{D_t}{(1 + r)^t} + \\frac{P_N}{(1 + r)^N}$$

**Trong đó:**
- $P_N = \\frac{D_{N+1}}{r - g_n}$ (Horizon terminal value at year N)
- $g_n$: Long-run steady growth rate

### 🌟 KEY TAKEAWAYS
1. **Model Selection**: Zero growth for preferred stock; Constant growth for mature firms; Multi-stage for tech/rapid growth firms.
2. **Crucial Exam Distinction**: Pay close attention to $D_0$ ('just paid') vs $D_1$ ('next year will pay').
3. **Boundary Condition & Pitfall**: Must verify $g < r$. If $g \\ge r$, the model breaks down with non-sensical negative or infinite values.
`,
};
