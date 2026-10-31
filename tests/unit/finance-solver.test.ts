import { describe, expect, it } from "vitest";
import {
  applyFinanceSolverToItem,
  financeCalculationSpecSchema,
  formatFinanceValue,
  solveAnnuity,
  solveBondPrice,
  solveCapm,
  solveDdm,
  solveFinanceSpec,
  solveIrr,
  solveNpv,
  solvePerpetuity,
  solveTvm,
  solveWacc,
  solveYtm,
  type FinanceCalculationSpec,
} from "@/lib/math/finance-solver";

describe("Quantitative Finance Solver Engine", () => {
  describe("1. TVM Solver (solveTvm)", () => {
    it("computes Future Value (FV) of a lump sum and ordinary annuity", () => {
      const fvLump = solveTvm({
        target: "fv",
        pv: 1000,
        rate: 0.08,
        nper: 5,
        pmt: 0,
      });
      expect(fvLump).toBeCloseTo(1469.3281, 4);

      const fvWithPmt = solveTvm({
        target: "fv",
        pv: 1000,
        pmt: 200,
        rate: 0.06,
        nper: 10,
      });
      // 1000*(1.06)^10 + 200*(((1.06)^10 - 1)/0.06) = 1790.8477 + 2636.1590 = 4427.0067
      expect(fvWithPmt).toBeCloseTo(4427.0067, 3);
    });

    it("computes Present Value (PV) for ordinary and annuity due", () => {
      const pvOrd = solveTvm({
        target: "pv",
        fv: 5000,
        rate: 0.05,
        nper: 8,
        pmt: 0,
      });
      expect(pvOrd).toBeCloseTo(3384.1968, 4);

      const pvDue = solveTvm({
        target: "pv",
        fv: 0,
        pmt: 500,
        rate: 0.07,
        nper: 6,
        isDue: true,
      });
      // 500 * ((1 - 1.07^-6)/0.07) * 1.07 = 2550.0987
      expect(pvDue).toBeCloseTo(2550.0987, 3);
    });

    it("computes periodic payment (PMT) for loan amortization and sinking fund", () => {
      const loanPmt = solveTvm({
        target: "pmt",
        pv: 25000,
        fv: 0,
        rate: 0.06,
        nper: 5,
      });
      expect(loanPmt).toBeCloseTo(5934.91, 2);

      const sinkingPmt = solveTvm({
        target: "pmt",
        pv: 0,
        fv: 10000,
        rate: 0.05,
        nper: 10,
      });
      expect(sinkingPmt).toBeCloseTo(795.0457, 3);
    });

    it("solves for number of periods (NPER) and interest rate (RATE)", () => {
      const nper = solveTvm({
        target: "nper",
        pv: 1000,
        fv: 2000,
        rate: 0.072,
        pmt: 0,
      });
      expect(nper).toBeCloseTo(Math.log(2) / Math.log(1.072), 6);

      const rate = solveTvm({
        target: "rate",
        pv: -1000,
        fv: 0,
        pmt: 250.4565,
        nper: 5,
      });
      expect(rate).toBeCloseTo(0.08, 4);
    });
  });

  describe("2. Annuity Solver (solveAnnuity)", () => {
    it("computes PV and FV for ordinary annuities and annuities due", () => {
      const pvOrd = solveAnnuity({
        target: "pv",
        pmt: 1000,
        rate: 0.08,
        nper: 10,
        isDue: false,
      });
      expect(pvOrd).toBeCloseTo(6710.0814, 4);

      const pvDue = solveAnnuity({
        target: "pv",
        pmt: 1000,
        rate: 0.08,
        nper: 10,
        isDue: true,
      });
      expect(pvDue).toBeCloseTo(6710.0814 * 1.08, 4);

      const fvOrd = solveAnnuity({
        target: "fv",
        pmt: 1000,
        rate: 0.08,
        nper: 10,
        isDue: false,
      });
      expect(fvOrd).toBeCloseTo(14486.5625, 4);

      const fvDue = solveAnnuity({
        target: "fv",
        pmt: 1000,
        rate: 0.08,
        nper: 10,
        isDue: true,
      });
      expect(fvDue).toBeCloseTo(14486.5625 * 1.08, 4);
    });
  });

  describe("3. Perpetuity & Dividend Discount Model (solvePerpetuity & solveDdm)", () => {
    it("computes level and growing perpetuities", () => {
      expect(solvePerpetuity({ pmt: 120, rate: 0.06 })).toBeCloseTo(2000, 6);
      expect(
        solvePerpetuity({ pmt: 120, rate: 0.08, growth: 0.03 }),
      ).toBeCloseTo(2400, 6);
    });

    it("computes Gordon Growth DDM for both D1 and D0 inputs", () => {
      // Given D1 = 2.50, r = 10%, g = 5% -> P0 = 2.50 / 0.05 = 50
      expect(
        solveDdm({ dividend: 2.5, rate: 0.1, growth: 0.05, isD0: false }),
      ).toBeCloseTo(50, 6);

      // Given D0 = 2.00, r = 10%, g = 5% -> D1 = 2.10 -> P0 = 2.10 / 0.05 = 42
      expect(
        solveDdm({ dividend: 2.0, rate: 0.1, growth: 0.05, isD0: true }),
      ).toBeCloseTo(42, 6);

      expect(solveDdm({ d0: 2.0, rate: 0.1, growth: 0.05 })).toBeCloseTo(42, 6);
      expect(solveDdm({ d1: 2.1, rate: 0.1, growth: 0.05 })).toBeCloseTo(42, 6);
    });

    it("throws when r <= g", () => {
      expect(() =>
        solveDdm({ dividend: 2, rate: 0.05, growth: 0.05 }),
      ).toThrow();
      expect(() =>
        solvePerpetuity({ pmt: 100, rate: 0.04, growth: 0.06 }),
      ).toThrow();
    });
  });

  describe("4. Bond Price & YTM Solvers (solveBondPrice & solveYtm)", () => {
    it("prices annual and semiannual coupon bonds and solves YTM accurately", () => {
      // 10-year 6% semiannual coupon bond at 8% YTM, $1,000 par
      const priceSemi = solveBondPrice({
        faceValue: 1000,
        couponRate: 0.06,
        rate: 0.08,
        nper: 10,
        frequency: 2,
      });
      expect(priceSemi).toBeCloseTo(864.0967, 3);

      // Recover YTM from price
      const ytmRecovered = solveYtm({
        price: priceSemi,
        faceValue: 1000,
        couponRate: 0.06,
        nper: 10,
        frequency: 2,
      });
      expect(ytmRecovered).toBeCloseTo(0.08, 6);
    });
  });

  describe("5. NPV & IRR Solvers (solveNpv & solveIrr)", () => {
    it("computes NPV and IRR from cashFlows array or initialInvestment", () => {
      const npv1 = solveNpv({
        rate: 0.1,
        cashFlows: [-1000, 400, 400, 400],
      });
      expect(npv1).toBeCloseTo(-5.2592, 4);

      const npv2 = solveNpv({
        rate: 0.1,
        initialInvestment: 1000,
        cashFlows: [400, 400, 400],
      });
      expect(npv2).toBeCloseTo(npv1, 6);

      const irr = solveIrr({
        initialInvestment: 1000,
        cashFlows: [400, 400, 400],
      });
      expect(irr).toBeCloseTo(0.09701, 4);
      // Verify NPV at IRR is 0
      expect(
        solveNpv({
          rate: irr,
          initialInvestment: 1000,
          cashFlows: [400, 400, 400],
        }),
      ).toBeCloseTo(0, 7);
    });
  });

  describe("6. WACC Solver (solveWacc)", () => {
    it("computes WACC from explicit weights or market values", () => {
      const waccWeights = solveWacc({
        equityWeight: 0.6,
        debtWeight: 0.4,
        costOfEquity: 0.12,
        costOfDebt: 0.07,
        taxRate: 0.25,
      });
      // 0.6*0.12 + 0.4*0.07*0.75 = 0.072 + 0.021 = 0.093
      expect(waccWeights).toBeCloseTo(0.093, 6);

      const waccValues = solveWacc({
        equityValue: 600,
        debtValue: 400,
        costOfEquity: 0.12,
        costOfDebt: 0.07,
        taxRate: 0.25,
      });
      expect(waccValues).toBeCloseTo(0.093, 6);
    });
  });

  describe("7. CAPM Solver (solveCapm)", () => {
    it("computes expected return using marketReturn or marketRiskPremium", () => {
      const er1 = solveCapm({
        riskFreeRate: 0.03,
        beta: 1.25,
        marketReturn: 0.09,
      });
      // 0.03 + 1.25 * (0.09 - 0.03) = 0.105
      expect(er1).toBeCloseTo(0.105, 6);

      const er2 = solveCapm({
        riskFreeRate: 0.03,
        beta: 1.25,
        marketRiskPremium: 0.06,
      });
      expect(er2).toBeCloseTo(0.105, 6);
    });
  });

  describe("8. Named Distractor Modes & Rounding Tolerance Invariant (solveFinanceSpec)", () => {
    const assertRoundingInvariant = (spec: FinanceCalculationSpec) => {
      const parsed = financeCalculationSpecSchema.parse(spec);
      const res = solveFinanceSpec(parsed);
      const decimals = parsed.decimals ?? 2;
      const tolerance = Math.max(Math.pow(10, -decimals), 1e-4);
      const allValues = [res.correctValue, ...res.distractorValues];

      expect(allValues).toHaveLength(4);
      for (let i = 0; i < allValues.length; i++) {
        for (let j = i + 1; j < allValues.length; j++) {
          expect(Math.abs(allValues[i] - allValues[j])).toBeGreaterThan(
            tolerance,
          );
        }
      }

      const uniqueOptions = new Set(res.options);
      expect(uniqueOptions.size).toBe(4);
      expect(res.correctIndex).toBe(0);
      expect(res.options[0]).toBe(res.correctOption);
      expect(res.formulaLatex.length).toBeGreaterThan(3);
      return res;
    };

    it("generates exact named distractors for bond_price (annual_instead_of_semiannual, forgot_to_discount_face)", () => {
      const res = assertRoundingInvariant({
        solver: "bond_price",
        params: {
          faceValue: 1000,
          couponRate: 0.06,
          rate: 0.08,
          nper: 10,
          frequency: 2,
        },
        unit: "$",
        decimals: 2,
        distractor_modes: [
          "annual_instead_of_semiannual",
          "forgot_to_discount_face",
          "off_by_one_period",
        ],
      });

      expect(res.correctOption).toBe("$864.10");
      // Annual instead of semiannual: $865.80
      expect(res.distractorOptions).toContain("$865.80");
      // Forgot to discount face: PV(coupons) + 1000 = 407.71 + 1000 = $1,407.71
      expect(res.distractorOptions).toContain("$1,407.71");
    });

    it("generates exact named distractors for ddm (used_d0_instead_of_d1, inverted_growth_and_discount)", () => {
      const res = assertRoundingInvariant({
        solver: "ddm",
        params: {
          dividend: 2.0,
          rate: 0.1,
          growth: 0.04,
          isD0: true,
        },
        unit: "$",
        decimals: 2,
        distractor_modes: [
          "used_d0_instead_of_d1",
          "used_d1_instead_of_d0",
          "inverted_growth_and_discount",
        ],
      });

      // Correct: 2.0 * 1.04 / (0.10 - 0.04) = 34.67
      expect(res.correctOption).toBe("$34.67");
      // Used D0 instead of D1: 2.0 / 0.06 = 33.33
      expect(res.distractorOptions).toContain("$33.33");
      // Inverted growth and discount: 2.08 / (0.10 + 0.04) = 14.86
      expect(res.distractorOptions).toContain("$14.86");
    });

    it("generates exact named distractors for wacc (forgot_tax_shield, swapped_weights)", () => {
      const res = assertRoundingInvariant({
        solver: "wacc",
        params: {
          equityWeight: 0.6,
          debtWeight: 0.4,
          costOfEquity: 0.14,
          costOfDebt: 0.09,
          taxRate: 0.35,
        },
        unit: "%",
        decimals: 2,
        distractor_modes: ["forgot_tax_shield", "swapped_weights"],
      });

      // Correct: 0.6*0.14 + 0.4*0.09*(1-0.35) = 0.084 + 0.0234 = 10.74%
      expect(res.correctOption).toBe("10.74%");
      // Forgot tax shield: 0.6*0.14 + 0.4*0.09 = 12.00%
      expect(res.distractorOptions).toContain("12.00%");
    });

    it("generates exact named distractors for capm (added_instead_of_subtracted_rf)", () => {
      const res = assertRoundingInvariant({
        solver: "capm",
        params: {
          riskFreeRate: 0.04,
          beta: 1.5,
          marketReturn: 0.1,
        },
        unit: "%",
        decimals: 2,
        distractor_modes: ["added_instead_of_subtracted_rf"],
      });

      // Correct: 0.04 + 1.5*(0.10 - 0.04) = 13.00%
      expect(res.correctOption).toBe("13.00%");
      // Added instead of subtracted Rf: 0.04 + 1.5*(0.10 + 0.04) = 25.00%
      expect(res.distractorOptions).toContain("25.00%");
    });

    it("generates exact named distractors for npv (omitted_initial_outlay, off_by_one_period)", () => {
      const res = assertRoundingInvariant({
        solver: "npv",
        params: {
          rate: 0.1,
          initialInvestment: 1000,
          cashFlows: [500, 500, 500],
        },
        unit: "$",
        decimals: 2,
        distractor_modes: ["omitted_initial_outlay", "off_by_one_period"],
      });

      // Correct: -1000 + 500 * ((1 - 1.1^-3)/0.1) = 243.43
      expect(res.correctOption).toBe("$243.43");
      // Omitted initial outlay: $1,243.43
      expect(res.distractorOptions).toContain("$1,243.43");
    });

    it("generates exact named distractors for annuity (beginning_instead_of_end_of_period, end_instead_of_beginning_of_period)", () => {
      const resOrd = assertRoundingInvariant({
        solver: "annuity",
        target: "pv",
        params: {
          pmt: 1000,
          rate: 0.06,
          nper: 5,
          isDue: false,
        },
        unit: "$",
        decimals: 2,
        distractor_modes: [
          "beginning_instead_of_end_of_period",
          "used_simple_interest",
          "off_by_one_period",
        ],
      });

      expect(resOrd.correctOption).toBe("$4,212.36");
      expect(resOrd.distractorOptions).toContain("$4,465.11");

      const resDue = assertRoundingInvariant({
        solver: "annuity",
        target: "pv",
        params: {
          pmt: 1000,
          rate: 0.06,
          nper: 5,
          isDue: true,
        },
        unit: "$",
        decimals: 2,
        distractor_modes: ["end_instead_of_beginning_of_period"],
      });

      expect(resDue.correctOption).toBe("$4,465.11");
      expect(resDue.distractorOptions).toContain("$4,212.36");
    });

    it("guarantees uniqueness even when duplicate or colliding distractor modes are passed", () => {
      const res = assertRoundingInvariant({
        solver: "perpetuity",
        params: {
          pmt: 100,
          rate: 0.05,
        },
        unit: "$",
        decimals: 2,
        distractor_modes: [
          "used_d0_instead_of_d1",
          "used_d0_instead_of_d1",
          "forgot_tax_shield",
        ],
      });

      expect(res.correctOption).toBe("$2,000.00");
    });
  });

  describe("9. applyFinanceSolverToItem & formatFinanceValue", () => {
    it("replaces LLM-guessed options and correctIndex with exact solver outputs", () => {
      const rawQuestion = {
        id: "q-1",
        question: "What is the PV of receiving $1,000 per year forever at 5%?",
        options: ["$1,500.00", "$2,500.00", "$1,900.00", "$2,100.00"] as [
          string,
          string,
          string,
          string,
        ],
        correctIndex: 2,
        explanation: "PV = C / r = 1000 / 0.05 = 2000",
      };

      const updated = applyFinanceSolverToItem(rawQuestion, {
        solver: "perpetuity",
        params: { pmt: 1000, rate: 0.05 },
        unit: "$",
        decimals: 2,
      });

      expect(updated.correctIndex).toBe(0);
      expect(updated.options[0]).toBe("$20,000.00");
      expect(new Set(updated.options).size).toBe(4);
    });

    it("formats negative dollars, percentages, multiples, and years cleanly", () => {
      expect(formatFinanceValue(-1234.5, "$", 2)).toBe("-$1,234.50");
      expect(formatFinanceValue(0.0875, "%", 2)).toBe("8.75%");
      expect(formatFinanceValue(4.5, "x", 1)).toBe("4.5x");
      expect(formatFinanceValue(7.25, "years", 2)).toBe("7.25 years");
    });
  });
});
