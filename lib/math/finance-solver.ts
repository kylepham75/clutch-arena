import { z } from "zod";

export const distractorModeSchema = z.enum([
  "annual_instead_of_semiannual",
  "beginning_instead_of_end_of_period",
  "end_instead_of_beginning_of_period",
  "forgot_to_discount_face",
  "used_d0_instead_of_d1",
  "used_d1_instead_of_d0",
  "forgot_tax_shield",
  "swapped_weights",
  "omitted_initial_outlay",
  "added_instead_of_subtracted_rf",
  "used_simple_interest",
  "wrong_sign_pmt_or_fv",
  "inverted_growth_and_discount",
  "off_by_one_period",
  "omitted_rf",
  "used_market_return_as_erp",
  "current_yield_only",
  "added_tax_shield",
]);

export type DistractorMode = z.infer<typeof distractorModeSchema>;

export const financeSolverTypeSchema = z.enum([
  "tvm",
  "annuity",
  "perpetuity",
  "ddm",
  "bond_price",
  "ytm",
  "npv",
  "irr",
  "wacc",
  "capm",
]);

export type FinanceSolverType = z.infer<typeof financeSolverTypeSchema>;

export const financeUnitSchema = z.union([
  z.enum(["$", "%", "x", "years", "periods", "none"]),
  z.string(),
]);

export type FinanceUnit = z.infer<typeof financeUnitSchema>;

export const financeParamsSchema = z
  .object({
    rate: z.number().optional(),
    nper: z.number().optional(),
    pmt: z.number().optional(),
    pv: z.number().optional(),
    fv: z.number().optional(),
    isDue: z.boolean().optional(),
    type: z.union([z.number(), z.enum(["ordinary", "due"]), z.string()]).optional(),
    target: z.string().optional(),
    cashFlow: z.number().optional(),
    dividend: z.number().optional(),
    d0: z.number().optional(),
    d1: z.number().optional(),
    growth: z.number().optional(),
    isD0: z.boolean().optional(),
    faceValue: z.number().optional(),
    couponRate: z.number().optional(),
    frequency: z.number().optional(),
    price: z.number().optional(),
    cashFlows: z.array(z.number()).optional(),
    initialInvestment: z.number().optional(),
    equityWeight: z.number().optional(),
    debtWeight: z.number().optional(),
    costOfEquity: z.number().optional(),
    costOfDebt: z.number().optional(),
    taxRate: z.number().optional(),
    equityValue: z.number().optional(),
    debtValue: z.number().optional(),
    riskFreeRate: z.number().optional(),
    beta: z.number().optional(),
    marketReturn: z.number().optional(),
    marketRiskPremium: z.number().optional(),
  })
  .catchall(
    z.union([
      z.number(),
      z.boolean(),
      z.string(),
      z.array(z.number()),
      z.undefined(),
    ]),
  );

export type FinanceParams = z.infer<typeof financeParamsSchema>;

export const financeCalculationSpecSchema = z.object({
  solver: financeSolverTypeSchema,
  target: z.string().optional(),
  params: financeParamsSchema,
  unit: financeUnitSchema.optional(),
  decimals: z.number().int().min(0).max(8).optional().default(2),
  distractor_modes: z.array(distractorModeSchema).optional(),
  distractorModes: z.array(distractorModeSchema).optional(),
});

export type FinanceCalculationSpec = z.input<typeof financeCalculationSpecSchema>;

export interface SolvedFinanceResult {
  correctValue: number;
  correctOption: string;
  distractorValues: [number, number, number];
  distractorOptions: [string, string, string];
  options: [string, string, string, string];
  correctIndex: 0;
  formulaLatex: string;
}

function isAnnuityDue(params: FinanceParams): boolean {
  return params.isDue === true || params.type === 1 || params.type === "due";
}

/**
 * Hybrid Newton-Raphson + bisection root finder for 1D smooth functions.
 */
function solveRoot1D(
  fn: (x: number) => number,
  dfn: (x: number) => number,
  initialGuess: number,
  minBound = -0.9999,
  maxBound = 100,
  maxIter = 200,
  tol = 1e-10,
): number {
  let x = Math.min(Math.max(initialGuess, minBound + 1e-6), maxBound - 1e-6);
  for (let i = 0; i < maxIter; i++) {
    const y = fn(x);
    if (!Number.isFinite(y)) break;
    if (Math.abs(y) < tol) return x;
    const dy = dfn(x);
    if (!Number.isFinite(dy) || Math.abs(dy) < 1e-14) break;
    const nextX = x - y / dy;
    if (nextX <= minBound || nextX >= maxBound || !Number.isFinite(nextX)) {
      break;
    }
    if (Math.abs(nextX - x) < tol) return nextX;
    x = nextX;
  }

  // Fallback bracketed search + bisection
  const gridPoints = [
    -0.95, -0.75, -0.5, -0.25, -0.1, -0.05, 0, 0.01, 0.02, 0.05, 0.08, 0.1,
    0.15, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0,
  ].filter((p) => p >= minBound && p <= maxBound);

  let a = minBound;
  let b = maxBound;
  let foundBracket = false;
  for (let i = 0; i < gridPoints.length - 1; i++) {
    const p1 = gridPoints[i];
    const p2 = gridPoints[i + 1];
    const y1 = fn(p1);
    const y2 = fn(p2);
    if (Number.isFinite(y1) && Math.abs(y1) < tol) return p1;
    if (Number.isFinite(y2) && Math.abs(y2) < tol) return p2;
    if (Number.isFinite(y1) && Number.isFinite(y2) && y1 * y2 < 0) {
      a = p1;
      b = p2;
      foundBracket = true;
      break;
    }
  }

  if (!foundBracket) {
    throw new Error("Unable to converge on a valid real root for financial calculation.");
  }

  let ya = fn(a);
  for (let i = 0; i < maxIter; i++) {
    const mid = 0.5 * (a + b);
    const yMid = fn(mid);
    if (Math.abs(yMid) < tol || Math.abs(b - a) < tol) {
      return mid;
    }
    if (ya * yMid <= 0) {
      b = mid;
    } else {
      a = mid;
      ya = yMid;
    }
  }
  return 0.5 * (a + b);
}

/**
 * Time Value of Money (TVM) solver.
 * Solves for `pv`, `fv`, `pmt`, `nper`, or `rate`.
 */
export function solveTvm(
  params: FinanceParams & { target?: string },
): number {
  const due = isAnnuityDue(params);
  const target = (
    params.target ??
    (params.fv === undefined
      ? "fv"
      : params.pv === undefined
        ? "pv"
        : params.pmt === undefined
          ? "pmt"
          : params.nper === undefined
            ? "nper"
            : "rate")
  ).toLowerCase();

  const r = params.rate ?? 0;
  const n = params.nper ?? 0;
  const pmt = params.pmt ?? params.cashFlow ?? 0;
  const pv = params.pv ?? 0;
  const fv = params.fv ?? 0;

  if (target === "fv") {
    if (n < 0) throw new Error("nper must be non-negative.");
    const dueFactor = due ? 1 + r : 1;
    const growth = Math.pow(1 + r, n);
    const fvAnnuity =
      Math.abs(r) < 1e-12 ? pmt * n : pmt * ((growth - 1) / r) * dueFactor;

    if (pv >= 0 && pmt >= 0) {
      return pv * growth + fvAnnuity;
    }
    if (pv <= 0 && pmt <= 0) {
      return -(pv * growth + fvAnnuity);
    }
    return -(pv * growth + fvAnnuity);
  }

  if (target === "pv") {
    if (n < 0) throw new Error("nper must be non-negative.");
    const dueFactor = due ? 1 + r : 1;
    const discount = Math.pow(1 + r, -n);
    const pvAnnuity =
      Math.abs(r) < 1e-12
        ? pmt * n
        : pmt * ((1 - discount) / r) * dueFactor;

    if (fv >= 0 && pmt >= 0) {
      return fv * discount + pvAnnuity;
    }
    if (fv <= 0 && pmt <= 0) {
      return -(fv * discount + pvAnnuity);
    }
    return -(fv * discount + pvAnnuity);
  }

  if (target === "pmt") {
    if (n <= 0) throw new Error("nper must be positive to solve for pmt.");
    const dueFactor = due ? 1 + r : 1;
    const growth = Math.pow(1 + r, n);
    const fvFactor =
      Math.abs(r) < 1e-12 ? n : ((growth - 1) / r) * dueFactor;

    if (pv < 0 || fv < 0) {
      return -(pv * growth + fv) / fvFactor;
    }
    if (pv > 0 && fv === 0) {
      return (pv * growth) / fvFactor;
    }
    if (pv === 0 && fv > 0) {
      return fv / fvFactor;
    }
    return Math.abs(fv - pv * growth) / fvFactor;
  }

  if (target === "nper") {
    if (Math.abs(pmt) < 1e-12) {
      if (pv === 0 || fv === 0) {
        throw new Error("Both pv and fv must be non-zero when pmt is 0.");
      }
      if (r <= -1 || Math.abs(r) < 1e-12) {
        throw new Error("rate must be non-zero and > -1 when pmt is 0.");
      }
      const ratio = Math.abs(fv / pv);
      if (ratio <= 0) throw new Error("Invalid fv/pv ratio.");
      return Math.log(ratio) / Math.log(1 + r);
    }

    let signedPv = pv;
    let signedPmt = pmt;
    let signedFv = fv;
    if (pv >= 0 && pmt >= 0 && fv >= 0) {
      if (fv === 0 && pv > 0) {
        signedPv = -pv;
      } else if (pv === 0 && fv > 0) {
        signedFv = -fv;
      } else if (pv < fv) {
        signedFv = -fv;
      } else {
        signedPv = -pv;
      }
    }

    if (Math.abs(r) < 1e-12) {
      return -(signedPv + signedFv) / signedPmt;
    }

    const dueFactor = due ? 1 + r : 1;
    const p = (signedPmt * dueFactor) / r;
    const ratio = (p - signedFv) / (signedPv + p);
    if (ratio <= 0) {
      throw new Error("No positive nper solution for given TVM parameters.");
    }
    return Math.log(ratio) / Math.log(1 + r);
  }

  if (target === "rate") {
    if (n <= 0) throw new Error("nper must be positive to solve for rate.");
    if (Math.abs(pmt) < 1e-12) {
      if (pv === 0 || fv === 0) {
        throw new Error("Both pv and fv must be non-zero when pmt is 0.");
      }
      const ratio = pv * fv < 0 ? -fv / pv : fv / pv;
      if (ratio <= 0) throw new Error("Invalid fv/pv ratio for rate.");
      return Math.pow(ratio, 1 / n) - 1;
    }

    let signedPv = pv;
    let signedPmt = pmt;
    let signedFv = fv;
    if (pv >= 0 && pmt >= 0 && fv >= 0) {
      if (fv === 0 && pv > 0) {
        signedPv = -pv;
      } else if (pv === 0 && fv > 0) {
        signedFv = -fv;
      } else if (pv + n * pmt <= fv) {
        signedFv = -fv;
      } else {
        signedPv = -pv;
      }
    }

    const f = (rate: number): number => {
      if (Math.abs(rate) < 1e-10) {
        return signedPv + signedPmt * n + signedFv;
      }
      const g = Math.pow(1 + rate, n);
      const dueMult = due ? 1 + rate : 1;
      return signedPv * g + signedPmt * ((g - 1) / rate) * dueMult + signedFv;
    };

    const df = (rate: number): number => {
      const eps = 1e-7;
      return (f(rate + eps) - f(rate - eps)) / (2 * eps);
    };

    return solveRoot1D(f, df, 0.08, -0.95, 10);
  }

  throw new Error(`Unsupported TVM target: ${target}`);
}

/**
 * Computes Present Value (PV) or Future Value (FV) of an ordinary annuity or annuity due.
 */
export function solveAnnuity(
  params: FinanceParams & { target?: string },
): number {
  const target = (params.target ?? "pv").toLowerCase();
  const pmt = params.pmt ?? params.cashFlow ?? params.dividend ?? 0;
  const r = params.rate ?? 0;
  const n = params.nper ?? 0;
  const due = isAnnuityDue(params);

  if (n < 0) throw new Error("nper must be non-negative.");
  if (Math.abs(r) < 1e-12) {
    return pmt * n;
  }

  const dueFactor = due ? 1 + r : 1;
  if (target === "fv") {
    return pmt * ((Math.pow(1 + r, n) - 1) / r) * dueFactor;
  }
  return pmt * ((1 - Math.pow(1 + r, -n)) / r) * dueFactor;
}

/**
 * Computes Present Value of a level or growing perpetuity: PV = C / (r - g).
 */
export function solvePerpetuity(params: FinanceParams): number {
  const c = params.pmt ?? params.cashFlow ?? params.dividend ?? params.d1 ?? params.d0 ?? 0;
  const r = params.rate ?? params.costOfEquity ?? 0;
  const g = params.growth ?? 0;
  const due = isAnnuityDue(params);

  if (r <= g) {
    throw new Error("Discount rate must be strictly greater than growth rate (r > g).");
  }

  const numerator = params.isD0 === true ? c * (1 + g) : c;
  const pv = numerator / (r - g);
  return due ? pv * (1 + r) : pv;
}

/**
 * Dividend Discount Model (Gordon Growth Model): P0 = D1 / (r - g).
 * Handles both D0 (where D1 = D0 * (1 + g)) and D1 directly.
 */
export function solveDdm(
  params: FinanceParams & { target?: string },
): number {
  const r = params.rate ?? params.costOfEquity ?? 0;
  const g = params.growth ?? 0;
  const target = (params.target ?? "price").toLowerCase();

  let d1: number;
  if (params.d1 !== undefined && params.isD0 !== true) {
    d1 = params.d1;
  } else if (params.d0 !== undefined) {
    d1 = params.isD0 === false ? params.d0 : params.d0 * (1 + g);
  } else {
    const div = params.dividend ?? params.pmt ?? params.cashFlow ?? 0;
    d1 = params.isD0 === true ? div * (1 + g) : div;
  }

  if (target === "rate" || target === "costofequity") {
    const price = params.price ?? params.pv ?? 0;
    if (price <= 0) throw new Error("Price must be positive to solve for DDM rate.");
    return d1 / price + g;
  }

  if (target === "growth") {
    const price = params.price ?? params.pv ?? 0;
    if (price <= 0) throw new Error("Price must be positive to solve for DDM growth.");
    const rawDiv = params.d0 ?? (params.isD0 ? (params.dividend ?? 0) : undefined);
    if (rawDiv !== undefined && params.isD0 !== false) {
      return (price * r - rawDiv) / (price + rawDiv);
    }
    return r - d1 / price;
  }

  if (r <= g) {
    throw new Error("Required return must be strictly greater than dividend growth rate (r > g).");
  }

  return d1 / (r - g);
}

/**
 * Computes the price of a fixed-coupon bond.
 */
export function solveBondPrice(params: FinanceParams): number {
  const faceValue = params.faceValue ?? 1000;
  const couponRate = params.couponRate ?? 0;
  const ytm = params.rate ?? 0;
  const years = params.nper ?? 0;
  const freq = params.frequency ?? 1;

  if (freq <= 0) throw new Error("Bond compounding frequency must be positive.");
  if (years < 0) throw new Error("Years to maturity must be non-negative.");

  const totalPeriods = years * freq;
  const periodicRate = ytm / freq;
  const periodicCoupon = (faceValue * couponRate) / freq;

  if (Math.abs(periodicRate) < 1e-12) {
    return periodicCoupon * totalPeriods + faceValue;
  }

  const discount = Math.pow(1 + periodicRate, -totalPeriods);
  const pvCoupons = periodicCoupon * ((1 - discount) / periodicRate);
  const pvFace = faceValue * discount;
  return pvCoupons + pvFace;
}

/**
 * Solves for annualized Yield to Maturity (YTM) of a bond given its market price.
 */
export function solveYtm(params: FinanceParams): number {
  const price = params.price ?? params.pv ?? 0;
  const faceValue = params.faceValue ?? 1000;
  const couponRate = params.couponRate ?? 0;
  const years = params.nper ?? 0;
  const freq = params.frequency ?? 1;

  if (price <= 0) throw new Error("Bond price must be positive.");
  if (years <= 0) throw new Error("Years to maturity must be positive.");
  if (freq <= 0) throw new Error("Frequency must be positive.");

  const f = (annualYtm: number): number =>
    solveBondPrice({
      faceValue,
      couponRate,
      rate: annualYtm,
      nper: years,
      frequency: freq,
    }) - price;

  const df = (annualYtm: number): number => {
    const eps = 1e-7;
    return (f(annualYtm + eps) - f(annualYtm - eps)) / (2 * eps);
  };

  const approxYtm =
    (faceValue * couponRate + (faceValue - price) / years) /
    ((faceValue + price) / 2);

  return solveRoot1D(f, df, approxYtm, -0.95, 5.0);
}

function normalizeCashFlowStream(params: FinanceParams): number[] {
  const raw = params.cashFlows ? [...params.cashFlows] : [];
  if (params.initialInvestment !== undefined) {
    const cf0 =
      params.initialInvestment > 0 && raw.every((c) => c >= 0)
        ? -params.initialInvestment
        : params.initialInvestment;
    if (raw.length === 0 || raw[0] !== cf0) {
      return [cf0, ...raw];
    }
  }
  return raw;
}

/**
 * Computes Net Present Value (NPV) of a cash flow stream.
 */
export function solveNpv(params: FinanceParams): number {
  const r = params.rate ?? params.costOfEquity ?? 0;
  const cfs = normalizeCashFlowStream(params);
  if (cfs.length === 0) {
    throw new Error("cashFlows cannot be empty for NPV calculation.");
  }

  let npv = 0;
  for (let t = 0; t < cfs.length; t++) {
    npv += cfs[t] / Math.pow(1 + r, t);
  }
  return npv;
}

/**
 * Computes Internal Rate of Return (IRR) of a cash flow stream.
 */
export function solveIrr(params: FinanceParams): number {
  const cfs = normalizeCashFlowStream(params);
  if (cfs.length < 2) {
    throw new Error("At least two cash flows are required for IRR.");
  }
  const hasPositive = cfs.some((c) => c > 0);
  const hasNegative = cfs.some((c) => c < 0);
  if (!hasPositive || !hasNegative) {
    throw new Error("Cash flows must contain at least one positive and one negative value for IRR.");
  }

  const f = (r: number): number => {
    let sum = 0;
    for (let t = 0; t < cfs.length; t++) {
      sum += cfs[t] / Math.pow(1 + r, t);
    }
    return sum;
  };

  const df = (r: number): number => {
    let dsum = 0;
    for (let t = 1; t < cfs.length; t++) {
      dsum -= (t * cfs[t]) / Math.pow(1 + r, t + 1);
    }
    return dsum;
  };

  return solveRoot1D(f, df, 0.1, -0.95, 10.0);
}

function resolveWeights(params: FinanceParams): { we: number; wd: number } {
  if (params.equityValue !== undefined && params.debtValue !== undefined) {
    const total = params.equityValue + params.debtValue;
    if (total <= 0) throw new Error("Total firm value (E + D) must be positive.");
    return {
      we: params.equityValue / total,
      wd: params.debtValue / total,
    };
  }
  const we =
    params.equityWeight ??
    (params.debtWeight !== undefined ? 1 - params.debtWeight : 0.5);
  const wd =
    params.debtWeight ??
    (params.equityWeight !== undefined ? 1 - params.equityWeight : 1 - we);
  return { we, wd };
}

/**
 * Computes Weighted Average Cost of Capital: WACC = (E/V)*Re + (D/V)*Rd*(1 - T).
 */
export function solveWacc(params: FinanceParams): number {
  const { we, wd } = resolveWeights(params);
  const re = params.costOfEquity ?? 0;
  const rd = params.costOfDebt ?? 0;
  const tax = params.taxRate ?? 0;
  return we * re + wd * rd * (1 - tax);
}

/**
 * Computes Capital Asset Pricing Model expected return: E[Ri] = Rf + beta * (E[Rm] - Rf).
 */
export function solveCapm(params: FinanceParams & { target?: string }): number {
  const rf = params.riskFreeRate ?? 0;
  const beta = params.beta ?? 1;
  const mrp =
    params.marketRiskPremium !== undefined
      ? params.marketRiskPremium
      : (params.marketReturn ?? 0) - rf;

  return rf + beta * mrp;
}

/**
 * Evaluates the exact numeric value for a FinanceCalculationSpec.
 */
export function evaluateFinanceSpecValue(spec: FinanceCalculationSpec): number {
  const p = { ...spec.params, target: spec.target };
  switch (spec.solver) {
    case "tvm":
      return solveTvm(p);
    case "annuity":
      return solveAnnuity(p);
    case "perpetuity":
      return solvePerpetuity(p);
    case "ddm":
      return solveDdm(p);
    case "bond_price":
      return solveBondPrice(p);
    case "ytm":
      return solveYtm(p);
    case "npv":
      return solveNpv(p);
    case "irr":
      return solveIrr(p);
    case "wacc":
      return solveWacc(p);
    case "capm":
      return solveCapm(p);
  }
}

function inferDefaultUnit(spec: FinanceCalculationSpec): FinanceUnit {
  if (spec.unit !== undefined) return spec.unit;
  const target = (spec.target ?? "").toLowerCase();
  if (
    spec.solver === "wacc" ||
    spec.solver === "capm" ||
    spec.solver === "ytm" ||
    spec.solver === "irr" ||
    target === "rate" ||
    target === "growth" ||
    target === "costofequity"
  ) {
    return "%";
  }
  if (target === "nper") {
    return "years";
  }
  return "$";
}

/**
 * Formats a numeric financial result with its unit and decimal precision.
 */
export function formatFinanceValue(
  value: number,
  unit: FinanceUnit = "$",
  decimals = 2,
): string {
  const cleanVal = Math.abs(value) < 1e-12 ? 0 : value;

  if (unit === "$") {
    const absFormatted = Math.abs(cleanVal).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return cleanVal < 0 ? `-$${absFormatted}` : `$${absFormatted}`;
  }

  if (unit === "%") {
    // Rate solvers return decimal values (e.g., 0.0825 for 8.25%).
    const pctVal = cleanVal * 100;
    return `${pctVal.toFixed(decimals)}%`;
  }

  if (unit === "x") {
    return `${cleanVal.toFixed(decimals)}x`;
  }

  if (unit === "years") {
    return `${cleanVal.toFixed(decimals)} years`;
  }

  if (unit === "periods") {
    return `${cleanVal.toFixed(decimals)} periods`;
  }

  if (unit === "none" || unit === "") {
    return cleanVal.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return `${cleanVal.toFixed(decimals)} ${unit}`;
}

function computeMistakeCandidate(
  spec: FinanceCalculationSpec,
  mode: DistractorMode,
  correctValue: number,
): number | null {
  const p = spec.params;
  const solver = spec.solver;
  const target = (spec.target ?? "").toLowerCase();

  try {
    switch (mode) {
      case "annual_instead_of_semiannual": {
        if (solver === "bond_price") {
          const altFreq = (p.frequency ?? 1) === 1 ? 2 : 1;
          return solveBondPrice({ ...p, frequency: altFreq });
        }
        if (solver === "ytm") {
          const freq = p.frequency ?? 2;
          return correctValue / (freq > 1 ? freq : 2);
        }
        if (solver === "tvm" || solver === "annuity") {
          const r = p.rate ?? 0.05;
          const n = p.nper ?? 10;
          return evaluateFinanceSpecValue({
            ...spec,
            params: { ...p, rate: r / 2, nper: n },
          });
        }
        return correctValue * 0.5;
      }

      case "beginning_instead_of_end_of_period": {
        if (solver === "annuity" || solver === "tvm") {
          return evaluateFinanceSpecValue({
            ...spec,
            params: { ...p, isDue: true, type: 1 },
          });
        }
        const r = p.rate ?? p.costOfEquity ?? 0.08;
        return correctValue * (1 + r);
      }

      case "end_instead_of_beginning_of_period": {
        if (solver === "annuity" || solver === "tvm") {
          return evaluateFinanceSpecValue({
            ...spec,
            params: { ...p, isDue: false, type: 0 },
          });
        }
        const r = p.rate ?? p.costOfEquity ?? 0.08;
        return correctValue / (1 + r);
      }

      case "forgot_to_discount_face": {
        if (solver === "bond_price") {
          const faceValue = p.faceValue ?? 1000;
          const couponRate = p.couponRate ?? 0;
          const ytm = p.rate ?? 0.05;
          const years = p.nper ?? 10;
          const freq = p.frequency ?? 1;
          const totalPeriods = years * freq;
          const periodicRate = ytm / freq;
          const periodicCoupon = (faceValue * couponRate) / freq;
          const pvCoupons =
            Math.abs(periodicRate) < 1e-12
              ? periodicCoupon * totalPeriods
              : periodicCoupon *
                ((1 - Math.pow(1 + periodicRate, -totalPeriods)) / periodicRate);
          return pvCoupons + faceValue;
        }
        if (solver === "tvm" && (target === "pv" || p.pv === undefined)) {
          const fv = Math.abs(p.fv ?? 1000);
          const pmt = Math.abs(p.pmt ?? p.cashFlow ?? 0);
          const r = p.rate ?? 0.05;
          const n = p.nper ?? 5;
          const pvPmt =
            pmt > 0 ? solveAnnuity({ pmt, rate: r, nper: n, isDue: isAnnuityDue(p) }) : 0;
          return pvPmt + fv;
        }
        return null;
      }

      case "used_d0_instead_of_d1": {
        const g = p.growth ?? 0.03;
        if (solver === "ddm" || solver === "perpetuity") {
          const rawDiv = p.d0 ?? p.dividend ?? p.d1 ?? p.pmt ?? p.cashFlow ?? 0;
          const r = p.rate ?? p.costOfEquity ?? 0.1;
          if (r > g && rawDiv > 0) {
            const unadjusted = rawDiv / (r - g);
            if (Math.abs(unadjusted - correctValue) > 1e-6) {
              return unadjusted;
            }
            return correctValue / (1 + g);
          }
        }
        return g !== 0 ? correctValue / (1 + g) : null;
      }

      case "used_d1_instead_of_d0": {
        const g = p.growth ?? 0.03;
        if (solver === "ddm" || solver === "perpetuity") {
          return correctValue * (1 + (g !== 0 ? g : 0.04));
        }
        return correctValue * (1 + (g !== 0 ? g : 0.04));
      }

      case "forgot_tax_shield": {
        if (solver === "wacc") {
          const { we, wd } = resolveWeights(p);
          const re = p.costOfEquity ?? 0.1;
          const rd = p.costOfDebt ?? 0.06;
          return we * re + wd * rd;
        }
        return null;
      }

      case "added_tax_shield": {
        if (solver === "wacc") {
          const { we, wd } = resolveWeights(p);
          const re = p.costOfEquity ?? 0.1;
          const rd = p.costOfDebt ?? 0.06;
          const tax = p.taxRate ?? 0.25;
          return we * re + wd * rd * (1 + tax);
        }
        return null;
      }

      case "swapped_weights": {
        if (solver === "wacc") {
          const { we, wd } = resolveWeights(p);
          const re = p.costOfEquity ?? 0.1;
          const rd = p.costOfDebt ?? 0.06;
          const tax = p.taxRate ?? 0.25;
          if (Math.abs(we - wd) > 1e-6) {
            return wd * re + we * rd * (1 - tax);
          }
          // When weights are 50/50, swapping applies the tax shield to equity instead of debt
          return we * re * (1 - tax) + wd * rd;
        }
        return null;
      }

      case "omitted_initial_outlay": {
        if (solver === "npv") {
          const cfs = normalizeCashFlowStream(p);
          if (cfs.length > 1) {
            return correctValue - cfs[0];
          }
        }
        if (solver === "irr") {
          const cfs = normalizeCashFlowStream(p);
          if (cfs.length > 1) {
            const totalInflows = cfs.slice(1).reduce((acc, v) => acc + v, 0);
            const n = cfs.length - 1;
            const cf0 = Math.abs(cfs[0]);
            return cf0 > 0 ? totalInflows / cf0 / n : null;
          }
        }
        return null;
      }

      case "added_instead_of_subtracted_rf": {
        if (solver === "capm") {
          const rf = p.riskFreeRate ?? 0.03;
          const beta = p.beta ?? 1.2;
          if (p.marketReturn !== undefined) {
            return rf + beta * (p.marketReturn + rf);
          }
          const mrp = p.marketRiskPremium ?? 0.06;
          return rf + beta * (mrp + rf);
        }
        return null;
      }

      case "omitted_rf": {
        if (solver === "capm") {
          const rf = p.riskFreeRate ?? 0.03;
          const beta = p.beta ?? 1.2;
          const mrp =
            p.marketRiskPremium !== undefined
              ? p.marketRiskPremium
              : (p.marketReturn ?? 0.09) - rf;
          return beta * mrp;
        }
        return null;
      }

      case "used_market_return_as_erp": {
        if (solver === "capm") {
          const rf = p.riskFreeRate ?? 0.03;
          const beta = p.beta ?? 1.2;
          const rm =
            p.marketReturn !== undefined
              ? p.marketReturn
              : (p.marketRiskPremium ?? 0.06) + rf;
          return rf + beta * rm;
        }
        return null;
      }

      case "used_simple_interest": {
        const r = p.rate ?? 0.06;
        const n = p.nper ?? 5;
        const pmt = p.pmt ?? p.cashFlow ?? 0;
        const pv = p.pv ?? 0;
        const fv = p.fv ?? 0;

        if (solver === "tvm") {
          const t =
            target ||
            (p.fv === undefined
              ? "fv"
              : p.pv === undefined
                ? "pv"
                : p.pmt === undefined
                  ? "pmt"
                  : p.nper === undefined
                    ? "nper"
                    : "rate");
          if (t === "fv") {
            return Math.abs(pv) * (1 + r * n) + Math.abs(pmt) * n * (1 + ( r * Math.max(0, n - 1)) / 2);
          }
          if (t === "pv") {
            return (Math.abs(fv) + Math.abs(pmt) * n) / (1 + r * n);
          }
          if (t === "rate" && pv !== 0 && fv !== 0 && n > 0) {
            return (Math.abs(fv / pv) - 1) / n;
          }
          if (t === "nper" && pv !== 0 && fv !== 0 && r > 0) {
            return (Math.abs(fv / pv) - 1) / r;
          }
        }
        if (solver === "annuity") {
          if (target === "fv") {
            return pmt * n * (1 + r);
          }
          return (pmt * n) / (1 + r * n);
        }
        if (solver === "bond_price") {
          const face = p.faceValue ?? 1000;
          const cRate = p.couponRate ?? 0.05;
          const totalCoupons = face * cRate * n;
          return (totalCoupons + face) / (1 + r * n);
        }
        return correctValue / (1 + r);
      }

      case "wrong_sign_pmt_or_fv": {
        if (solver === "bond_price") {
          const faceValue = p.faceValue ?? 1000;
          const couponRate = p.couponRate ?? 0;
          const ytm = p.rate ?? 0.05;
          const years = p.nper ?? 10;
          const freq = p.frequency ?? 1;
          const totalPeriods = years * freq;
          const periodicRate = ytm / freq;
          const periodicCoupon = (faceValue * couponRate) / freq;
          const discount = Math.pow(1 + periodicRate, -totalPeriods);
          const pvCoupons =
            Math.abs(periodicRate) < 1e-12
              ? periodicCoupon * totalPeriods
              : periodicCoupon * ((1 - discount) / periodicRate);
          const pvFace = faceValue * discount;
          return Math.abs(pvFace - pvCoupons);
        }
        if (solver === "tvm") {
          const r = p.rate ?? 0.05;
          const n = p.nper ?? 5;
          const pmt = p.pmt ?? p.cashFlow ?? 0;
          const pv = p.pv ?? 0;
          const fv = p.fv ?? 0;
          if (pmt !== 0 && (pv !== 0 || fv !== 0)) {
            return Math.abs(
              solveTvm({
                ...p,
                target: spec.target,
                pmt: -Math.abs(pmt),
                pv: pv !== 0 ? Math.abs(pv) : undefined,
                fv: fv !== 0 ? Math.abs(fv) : undefined,
              }),
            );
          }
        }
        return null;
      }

      case "inverted_growth_and_discount": {
        const r = p.rate ?? p.costOfEquity ?? 0.1;
        const g = p.growth ?? 0.03;
        if (solver === "ddm" || solver === "perpetuity") {
          const d1 =
            p.d1 !== undefined && p.isD0 !== true
              ? p.d1
              : p.d0 !== undefined
                ? p.d0 * (1 + g)
                : (p.dividend ?? p.pmt ?? p.cashFlow ?? 1) *
                  (p.isD0 === true ? 1 + g : 1);
          if (r + g > 0 && g !== 0) {
            return d1 / (r + g);
          }
          return d1 / (r * 1.25);
        }
        return null;
      }

      case "off_by_one_period": {
        if (solver === "npv") {
          const r = p.rate ?? p.costOfEquity ?? 0.1;
          return correctValue / (1 + (r !== 0 ? r : 0.1));
        }
        if (solver === "irr") {
          const cfs = normalizeCashFlowStream(p);
          if (cfs.length >= 2) {
            const extended = [cfs[0], 0, ...cfs.slice(1)];
            return solveIrr({ cashFlows: extended });
          }
        }
        const n = p.nper ?? 5;
        const altN = n > 1 ? n - 1 : n + 1;
        return evaluateFinanceSpecValue({
          ...spec,
          params: { ...p, nper: altN },
        });
      }

      case "current_yield_only": {
        if (solver === "ytm") {
          const faceValue = p.faceValue ?? 1000;
          const couponRate = p.couponRate ?? 0.05;
          const price = p.price ?? p.pv ?? 950;
          if (price > 0) {
            return (faceValue * couponRate) / price;
          }
        }
        return null;
      }
    }
  } catch {
    return null;
  }
}

function getDefaultModesForSolver(solver: FinanceSolverType): DistractorMode[] {
  switch (solver) {
    case "tvm":
      return [
        "off_by_one_period",
        "beginning_instead_of_end_of_period",
        "end_instead_of_beginning_of_period",
        "used_simple_interest",
        "wrong_sign_pmt_or_fv",
        "forgot_to_discount_face",
      ];
    case "annuity":
      return [
        "beginning_instead_of_end_of_period",
        "end_instead_of_beginning_of_period",
        "off_by_one_period",
        "used_simple_interest",
      ];
    case "perpetuity":
    case "ddm":
      return [
        "used_d0_instead_of_d1",
        "used_d1_instead_of_d0",
        "inverted_growth_and_discount",
        "beginning_instead_of_end_of_period",
      ];
    case "bond_price":
      return [
        "annual_instead_of_semiannual",
        "forgot_to_discount_face",
        "off_by_one_period",
        "wrong_sign_pmt_or_fv",
      ];
    case "ytm":
      return [
        "annual_instead_of_semiannual",
        "current_yield_only",
        "off_by_one_period",
      ];
    case "npv":
      return [
        "omitted_initial_outlay",
        "off_by_one_period",
        "beginning_instead_of_end_of_period",
      ];
    case "irr":
      return [
        "off_by_one_period",
        "omitted_initial_outlay",
        "annual_instead_of_semiannual",
      ];
    case "wacc":
      return [
        "forgot_tax_shield",
        "swapped_weights",
        "added_tax_shield",
      ];
    case "capm":
      return [
        "added_instead_of_subtracted_rf",
        "omitted_rf",
        "used_market_return_as_erp",
      ];
  }
}

export function buildFormulaLatex(spec: FinanceCalculationSpec): string {
  switch (spec.solver) {
    case "tvm": {
      const target = (spec.target ?? "fv").toLowerCase();
      if (target === "pv") {
        return "PV = \\frac{FV}{(1 + r)^n} + PMT \\times \\frac{1 - (1 + r)^{-n}}{r}";
      }
      if (target === "pmt") {
        return "PMT = \\frac{PV \\times r}{1 - (1 + r)^{-n}}";
      }
      if (target === "nper") {
        return "n = \\frac{\\ln(FV / PV)}{\\ln(1 + r)}";
      }
      if (target === "rate") {
        return "r = \\left(\\frac{FV}{PV}\\right)^{1/n} - 1";
      }
      return "FV = PV(1 + r)^n + PMT \\times \\frac{(1 + r)^n - 1}{r}";
    }
    case "annuity": {
      const due = isAnnuityDue(spec.params);
      const target = (spec.target ?? "pv").toLowerCase();
      if (target === "fv") {
        return due
          ? "FV_{\\text{due}} = PMT \\times \\frac{(1 + r)^n - 1}{r} \\times (1 + r)"
          : "FV = PMT \\times \\frac{(1 + r)^n - 1}{r}";
      }
      return due
        ? "PV_{\\text{due}} = PMT \\times \\frac{1 - (1 + r)^{-n}}{r} \\times (1 + r)"
        : "PV = PMT \\times \\frac{1 - (1 + r)^{-n}}{r}";
    }
    case "perpetuity": {
      const hasGrowth = (spec.params.growth ?? 0) !== 0;
      return hasGrowth ? "PV = \\frac{C}{r - g}" : "PV = \\frac{C}{r}";
    }
    case "ddm": {
      return spec.params.isD0 || spec.params.d0 !== undefined
        ? "P_0 = \\frac{D_0(1 + g)}{r - g}"
        : "P_0 = \\frac{D_1}{r - g}";
    }
    case "bond_price":
      return "P = C \\times \\frac{1 - (1 + y/m)^{-n \\cdot m}}{y/m} + \\frac{F}{(1 + y/m)^{n \\cdot m}}";
    case "ytm":
      return "P = \\sum_{t=1}^{N} \\frac{C}{(1 + YTM/m)^t} + \\frac{F}{(1 + YTM/m)^N}";
    case "npv":
      return "NPV = \\sum_{t=0}^{T} \\frac{CF_t}{(1 + r)^t}";
    case "irr":
      return "0 = \\sum_{t=0}^{T} \\frac{CF_t}{(1 + IRR)^t}";
    case "wacc":
      return "WACC = \\left(\\frac{E}{V}\\right) R_e + \\left(\\frac{D}{V}\\right) R_d (1 - T)";
    case "capm":
      return "E[R_i] = R_f + \\beta (E[R_m] - R_f)";
  }
}

/**
 * Computes the exact answer and 3 misconception-driven distractors for a FinanceCalculationSpec.
 * Enforces the rounding tolerance invariant: all 4 numeric values differ pairwise by strictly
 * more than max(10^-decimals, 10^-4) and all 4 formatted option strings are 100% distinct.
 */
export function solveFinanceSpec(
  rawSpec: FinanceCalculationSpec,
): SolvedFinanceResult {
  const spec = financeCalculationSpecSchema.parse(rawSpec);
  const decimals = spec.decimals ?? 2;
  const unit = inferDefaultUnit(spec);
  const tolerance = Math.max(Math.pow(10, -decimals), 1e-4);

  const correctValue = evaluateFinanceSpecValue(spec);
  if (!Number.isFinite(correctValue)) {
    throw new Error("Solver produced a non-finite correctValue.");
  }

  const correctOption = formatFinanceValue(correctValue, unit, decimals);
  const selectedValues: number[] = [correctValue];
  const selectedOptions: string[] = [correctOption];

  const isAcceptableCandidate = (val: number | null): val is number => {
    if (val === null || !Number.isFinite(val)) return false;
    if (
      correctValue > 0 &&
      val <= 0 &&
      spec.solver !== "npv" &&
      spec.solver !== "irr" &&
      spec.solver !== "tvm"
    ) {
      return false;
    }
    for (const existing of selectedValues) {
      if (Math.abs(val - existing) <= tolerance) {
        return false;
      }
    }
    const formatted = formatFinanceValue(val, unit, decimals);
    if (selectedOptions.includes(formatted)) {
      return false;
    }
    return true;
  };

  const requestedModes = [
    ...(spec.distractor_modes ?? []),
    ...(spec.distractorModes ?? []),
  ];
  const defaultModes = getDefaultModesForSolver(spec.solver);
  const allModes = Array.from(new Set([...requestedModes, ...defaultModes]));

  for (const mode of allModes) {
    if (selectedValues.length >= 4) break;
    const candidate = computeMistakeCandidate(spec, mode, correctValue);
    if (isAcceptableCandidate(candidate)) {
      selectedValues.push(candidate);
      selectedOptions.push(formatFinanceValue(candidate, unit, decimals));
    }
  }

  // Deterministic plausible perturbation fallbacks if fewer than 3 distractors were produced
  const stepBase = Math.max(
    Math.abs(correctValue) * 0.08,
    tolerance * 2.5,
    unit === "%" ? 0.015 : 1.25,
  );
  const fallbackMultipliers = [1, -1, 2, -2, 3, -3, 4.5, -4.5, 6, 8, 10, 12];

  for (const mult of fallbackMultipliers) {
    if (selectedValues.length >= 4) break;
    const candidate = correctValue + mult * stepBase;
    if (isAcceptableCandidate(candidate)) {
      selectedValues.push(candidate);
      selectedOptions.push(formatFinanceValue(candidate, unit, decimals));
    }
  }

  // Final guaranteed safety loop
  let safetyStep = 1;
  while (selectedValues.length < 4) {
    const candidate = correctValue + safetyStep * Math.max(tolerance * 5, 0.05);
    safetyStep += 1;
    if (isAcceptableCandidate(candidate)) {
      selectedValues.push(candidate);
      selectedOptions.push(formatFinanceValue(candidate, unit, decimals));
    }
  }

  const distractorValues: [number, number, number] = [
    selectedValues[1],
    selectedValues[2],
    selectedValues[3],
  ];
  const distractorOptions: [string, string, string] = [
    selectedOptions[1],
    selectedOptions[2],
    selectedOptions[3],
  ];
  const options: [string, string, string, string] = [
    correctOption,
    distractorOptions[0],
    distractorOptions[1],
    distractorOptions[2],
  ];

  return {
    correctValue,
    correctOption,
    distractorValues,
    distractorOptions,
    options,
    correctIndex: 0,
    formulaLatex: buildFormulaLatex(spec),
  };
}

export interface SolverApplicableItem {
  options: [string, string, string, string] | string[];
  correctIndex: number;
  [key: string]: unknown;
}

/**
 * Replaces `options` and `correctIndex` on a question or conceptVariant using exact solver outputs.
 */
export function applyFinanceSolverToItem<T extends SolverApplicableItem>(
  item: T,
  spec?: FinanceCalculationSpec | null,
): T {
  if (!spec) return item;
  const solved = solveFinanceSpec(spec);
  return {
    ...item,
    options: solved.options,
    correctIndex: solved.correctIndex,
  };
}
