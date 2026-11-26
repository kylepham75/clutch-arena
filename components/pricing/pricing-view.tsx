"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Loader2,
  QrCode,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";
import {
  PRICING_PLANS,
  type PlanId,
  type PlanPricing,
  type UserTier,
} from "@/lib/pricing/tiers";
import {
  formatRegionalPrice,
  getBillingRegionClient,
  getEffectiveCurrency,
  getPlanRegionalPrice,
  setBillingRegionClient,
  type BillingRegion,
} from "@/lib/pricing/region";
import { useUserTier } from "@/hooks/use-user-tier";
import { useAuth } from "@/lib/auth/context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/* -------------------------------------------------------------------------- */
/*  Public types                                                              */
/* -------------------------------------------------------------------------- */

export interface PayosCheckoutData {
  orderCode: number;
  amount: number;
  description: string;
  bin: string;
  accountNumber: string;
  accountName: string;
  checkoutUrl: string;
  qrCode: string;
  status: string;
  vietQrImageUrl: string;
}

export type ProCycle = "monthly" | "semester";
export type PricingAudience = "personal" | "team";

export interface PricingViewProps {
  /** Optional contextual reason shown as a banner (e.g. quota exhausted). */
  initialReason?: string | null;
  /** Gates network effects (PayOS polling, squad code fetch). Defaults to true. */
  active?: boolean;
  /** Called after a purchase completes and the buyer dismisses / auto-closes. */
  onClose?: () => void;
  /** "modal" renders inside a Dialog; "page" renders the standalone /pricing layout. */
  variant?: "modal" | "page";
}

interface SquadCodeItem {
  code: string;
  status: "available" | "redeemed";
}

type RedeemFeedback = "success" | "error" | "auth" | null;
type TelemetryPlanId = "cram_pass" | "pro" | "pro_monthly" | "tutor";
type PayablePlanId = "cram_pass" | "cram_squad_3" | "pro" | "pro_monthly" | "tutor";

/* -------------------------------------------------------------------------- */
/*  Pure helpers (exported for unit tests)                                    */
/* -------------------------------------------------------------------------- */

const SEMESTER_MONTHS = 4;
const SQUAD_SEATS = 3;

/** Resolves the Clutch Pro plan id for the in-card Monthly | Semester toggle. */
export function resolveClutchProPlanId(cycle: ProCycle): "pro" | "pro_monthly" {
  return cycle === "semester" ? "pro" : "pro_monthly";
}

/** Returns the `~`-prefixed per-month equivalent of the Clutch Pro semester price. */
export function getProMonthlyEquivalent(region: BillingRegion): string {
  const semester = getPlanRegionalPrice("pro", region).amount;
  return `~${formatRegionalPrice(semester / SEMESTER_MONTHS, region)}`;
}

/** Returns the `~`-prefixed per-student price of the Exam Squad 3-Pack. */
export function getSquadPerStudentPrice(region: BillingRegion): string {
  const squad = getPlanRegionalPrice("cram_squad_3", region).amount;
  const perStudent = squad / SQUAD_SEATS;
  const rounded = region === "VN" ? Math.round(perStudent / 100) * 100 : perStudent;
  return `~${formatRegionalPrice(rounded, region)}`;
}

/** Returns the headline price (without the cycle suffix baked into some regional strings). */
export function getPlanDisplayPrice(planId: PlanId, region: BillingRegion): string {
  return getPlanRegionalPrice(planId, region).formatted.split("/")[0];
}

/** True when the viewer's current tier already covers the given plan. */
export function isPlanIncludedForTier(planId: PlanId, tier: UserTier): boolean {
  if (planId === "contender") return tier !== "contender";
  if (tier === "tutor") {
    return (
      planId === "cram_pass" ||
      planId === "cram_squad_3" ||
      planId === "pro_monthly" ||
      planId === "pro"
    );
  }
  if (tier === "pro") {
    return planId === "cram_pass" || planId === "cram_squad_3" || planId === "pro_monthly";
  }
  return false;
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

function isPayablePlan(planId: PlanId): planId is PayablePlanId {
  return (
    planId === "cram_pass" ||
    planId === "cram_squad_3" ||
    planId === "pro" ||
    planId === "pro_monthly" ||
    planId === "tutor"
  );
}

function parseSquadItems(raw: unknown): SquadCodeItem[] {
  if (!Array.isArray(raw)) return [];
  const items: SquadCodeItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { code?: unknown; status?: unknown };
    if (typeof rec.code !== "string" || !rec.code) continue;
    if (rec.status === "revoked") continue;
    items.push({
      code: rec.code,
      status: rec.status === "redeemed" ? "redeemed" : "available",
    });
  }
  return items;
}

/* -------------------------------------------------------------------------- */
/*  Style tokens                                                              */
/* -------------------------------------------------------------------------- */

const FONT_HEADING = "font-[family-name:var(--font-heading)]";
const FONT_BODY = "font-[family-name:var(--font-body)]";
const FONT_MONO = "font-[family-name:var(--font-mono)]";
const FOCUS_RING =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-[#ed9a78] focus-visible:outline-offset-4";

const CARD_BASE =
  "relative flex h-full min-w-0 flex-col rounded-2xl border border-[#e2e5dc] bg-white p-6 dark:border-stone-800 dark:bg-stone-900/90";
const CARD_HERO =
  "relative flex h-full min-w-0 flex-col rounded-2xl border-[1.5px] border-[#e85d2a] p-6 shadow-[0_12px_32px_-12px_rgba(232,93,42,0.22)] bg-[linear-gradient(180deg,#fff7f3_0%,#ffffff_55%,#fff2ec_100%)] dark:bg-none dark:bg-[#e85d2a]/10";
const INNER_BOX =
  "rounded-xl bg-[#eef0e9] p-3.5 text-sm text-[#1c211a] dark:bg-stone-800/60 dark:text-stone-100";

type CtaTone = "outline" | "dark" | "hero";

function CtaButton({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone: CtaTone;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "hero"
      ? "bg-[#e85d2a] text-[#18181b] hover:bg-[#f06a38]"
      : tone === "dark"
        ? "bg-[#1c211a] text-[#fafbf9] hover:bg-[#2b3228] dark:bg-[#fafaf9] dark:text-[#18181b] dark:hover:bg-white"
        : "border border-[#e2e5dc] bg-transparent text-[#81857b] dark:border-stone-700 dark:text-stone-400";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-full px-4 py-2.5 text-sm font-bold transition-colors ${FONT_HEADING} ${toneClass} ${FOCUS_RING} ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {label}
    </button>
  );
}

function PriceLine({ price, period }: { price: string; period: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
      <span
        className={`text-4xl font-bold tracking-tight text-[#1c211a] dark:text-stone-50 ${FONT_HEADING}`}
      >
        {price}
      </span>
      <span className="text-sm text-[#81857b] dark:text-stone-400">{period}</span>
    </div>
  );
}

function BulletList({ items, accent }: { items: string[]; accent?: boolean }) {
  return (
    <ul className={`mt-6 space-y-2.5 text-sm text-[#1c211a] dark:text-stone-200 ${FONT_BODY}`}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 leading-snug">
          <Check
            size={15}
            className={`mt-0.5 shrink-0 ${
              accent ? "text-[#e85d2a]" : "text-[#81857b] dark:text-stone-400"
            }`}
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CardHeading({
  title,
  headline,
  subtitle,
}: {
  title: string;
  headline: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4">
      <h3
        className={`text-xs font-bold uppercase tracking-wider text-[#81857b] dark:text-stone-400 ${FONT_HEADING}`}
      >
        {title}
      </h3>
      <p
        className={`mt-2 text-xl font-bold leading-tight text-[#1c211a] dark:text-stone-50 ${FONT_HEADING}`}
      >
        {headline}
      </p>
      {subtitle ? (
        <p className={`mt-1.5 text-sm text-[#81857b] dark:text-stone-400 ${FONT_BODY}`}>{subtitle}</p>
      ) : null}
    </div>
  );
}

function SquadCodesPanel({
  codes,
  heading,
  subheading,
  copyLabel,
  copiedLabel,
  availableLabel,
  redeemedLabel,
  copiedField,
  onCopy,
}: {
  codes: SquadCodeItem[];
  heading: string;
  subheading: string;
  copyLabel: string;
  copiedLabel: string;
  availableLabel: string;
  redeemedLabel: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  if (codes.length === 0) return null;
  return (
    <section
      className="rounded-2xl border border-[#e2e5dc] bg-white p-5 dark:border-stone-800 dark:bg-stone-900/90"
      aria-label={heading}
    >
      <h4 className={`text-sm font-bold text-[#1c211a] dark:text-stone-50 ${FONT_HEADING}`}>
        {heading}
      </h4>
      <p className={`mt-1 text-xs text-[#81857b] dark:text-stone-400 ${FONT_BODY}`}>{subheading}</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {codes.map((item) => {
          const field = `squad:${item.code}`;
          const isCopied = copiedField === field;
          return (
            <li
              key={item.code}
              className="flex items-center justify-between gap-2 rounded-xl bg-[#eef0e9] px-3 py-2.5 dark:bg-stone-800/60"
            >
              <div className="min-w-0">
                <div
                  className={`truncate text-sm font-bold tracking-wide text-[#1c211a] dark:text-stone-50 ${FONT_MONO}`}
                >
                  {item.code}
                </div>
                <div
                  className={`text-[11px] font-semibold ${
                    item.status === "available"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-[#81857b] dark:text-stone-400"
                  }`}
                >
                  {item.status === "available" ? availableLabel : redeemedLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onCopy(item.code, field)}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-[#e2e5dc] bg-white px-2.5 py-1 text-xs font-semibold text-[#1c211a] hover:bg-[#fafbf9] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 ${FOCUS_RING}`}
              >
                {isCopied ? (
                  <Check size={12} className="text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy size={12} aria-hidden="true" />
                )}
                <span>{isCopied ? copiedLabel : copyLabel}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PillSwitch<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
  size?: "sm" | "md";
  label: string;
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-5 py-1.5 text-sm";
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-full border border-[#e2e5dc] bg-[#eef0e9] p-0.5 dark:border-stone-800 dark:bg-stone-900"
    >
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.id)}
            className={`cursor-pointer rounded-full font-bold transition-colors ${pad} ${FONT_HEADING} ${FOCUS_RING} ${
              selected
                ? "bg-white text-[#1c211a] shadow-xs dark:bg-stone-800 dark:text-[#fafaf9]"
                : "text-[#81857b] hover:text-[#1c211a] dark:text-stone-400 dark:hover:text-stone-100"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  PricingView                                                               */
/* -------------------------------------------------------------------------- */

export function PricingView({
  initialReason,
  active = true,
  onClose,
  variant = "modal",
}: PricingViewProps) {
  const { t, language, setLanguage } = useLanguage();
  const tp = t.pricingPage;
  const { tier, daysRemaining, referrals, refreshTier, refreshQuota } = useUserTier();
  const { user, session, openAuthModal } = useAuth();

  // SSR-safe default; synced from the billing-region cookie once mounted.
  const [billingRegion, setBillingRegion] = useState<BillingRegion>("ROW");
  const [audience, setAudience] = useState<PricingAudience>("personal");
  const [proCycle, setProCycle] = useState<ProCycle>("semester");
  const [selectedPlan, setSelectedPlan] = useState<PlanPricing | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [payosOrder, setPayosOrder] = useState<PayosCheckoutData | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [authRequiredForPayment, setAuthRequiredForPayment] = useState(false);
  const [usdCheckingOut, setUsdCheckingOut] = useState(false);
  const [usdCheckoutError, setUsdCheckoutError] = useState<string | null>(null);
  const [mineCodes, setMineCodes] = useState<SquadCodeItem[]>([]);
  const [freshSquadCodes, setFreshSquadCodes] = useState<string[]>([]);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemFeedback, setRedeemFeedback] = useState<RedeemFeedback>(null);

  const isCreatingRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isVnCheckout = billingRegion === "VN";
  const currency = getEffectiveCurrency(billingRegion).toLowerCase() as "vnd" | "usd";

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Sync region from the persisted billing-region cookie whenever the view activates.
  useEffect(() => {
    if (active) {
      setBillingRegion(getBillingRegionClient());
    }
  }, [active]);

  const getAccessToken = useCallback(async (): Promise<string | undefined> => {
    let token = session?.access_token;
    if (!token) {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      }
    }
    return token;
  }, [session?.access_token]);

  const buildJsonHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = await getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }, [getAccessToken]);

  const loadMyCodes = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setMineCodes([]);
      return;
    }
    try {
      const res = await fetch("/api/payments/squad/mine", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data?.ok) setMineCodes(parseSquadItems(data.purchased));
    } catch {
      // Buyer codes are a convenience view; ignore transient network failures.
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (active && user?.id) {
      void loadMyCodes();
    } else {
      setMineCodes([]);
    }
  }, [active, user?.id, loadMyCodes]);

  const resetCheckout = useCallback(() => {
    setSelectedPlan(null);
    setPayosOrder(null);
    setCreatingOrder(false);
    setAuthRequiredForPayment(false);
    setUsdCheckingOut(false);
    setUsdCheckoutError(null);
    setVerificationError(null);
    setPaymentSuccess(false);
    setFreshSquadCodes([]);
  }, []);

  const finishPurchase = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    resetCheckout();
    onClose?.();
  }, [onClose, resetCheckout]);

  const applyBillingRegion = (region: BillingRegion) => {
    setBillingRegion(region);
    setBillingRegionClient(region);
    setPayosOrder(null);
    setCreatingOrder(false);
    setVerificationError(null);
    setUsdCheckoutError(null);
  };

  const sendSmokeTestTelemetry = (
    planId: TelemetryPlanId,
    action: "plan_selected" | "verify_clicked",
  ) => {
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "smoke_test_intent", planId, currency, action, language }),
    }).catch(() => {});
  };

  const createPayosOrder = useCallback(
    async (plan: PlanPricing) => {
      if (!isPayablePlan(plan.id) && plan.id !== "tutor_guild") return;
      if (isCreatingRef.current) return;
      isCreatingRef.current = true;
      setCreatingOrder(true);
      setVerificationError(null);
      setAuthRequiredForPayment(false);

      try {
        const headers = await buildJsonHeaders();
        const res = await fetch("/api/payments/payos/create", {
          method: "POST",
          headers,
          body: JSON.stringify({ planId: plan.id, userId: user?.id }),
        });
        const data = await res.json().catch(() => null);

        if (res.status === 401 || data?.error === "AUTH_REQUIRED") {
          setAuthRequiredForPayment(true);
          return;
        }

        if (res.ok && data?.ok && data.payment) {
          setPayosOrder(data.payment as PayosCheckoutData);
          setAuthRequiredForPayment(false);
        } else {
          setVerificationError(t.pricing.payosInitError);
        }
      } catch (err) {
        console.error("PayOS create error:", err);
        setVerificationError(t.pricing.payosNetworkError);
      } finally {
        setCreatingOrder(false);
        isCreatingRef.current = false;
      }
    },
    [buildJsonHeaders, user?.id, t.pricing.payosInitError, t.pricing.payosNetworkError],
  );

  // Reset transient checkout state whenever the view deactivates.
  useEffect(() => {
    if (!active) {
      setPayosOrder(null);
      setCreatingOrder(false);
      setAuthRequiredForPayment(false);
    }
  }, [active]);

  // Auto-create a PayOS VietQR order when a VN plan is selected.
  useEffect(() => {
    if (!active) return;
    if (isVnCheckout && selectedPlan && (isPayablePlan(selectedPlan.id) || selectedPlan.id === "tutor_guild")) {
      if (payosOrder?.orderCode) return;
      void createPayosOrder(selectedPlan);
    } else {
      setPayosOrder(null);
      setCreatingOrder(false);
      setAuthRequiredForPayment(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isVnCheckout, selectedPlan?.id, user?.id, createPayosOrder]);

  const handlePaid = useCallback(
    async (codes: string[] | undefined, planId: PlanId) => {
      await refreshTier();
      void refreshQuota();
      const issued = Array.isArray(codes) ? codes.filter((c) => typeof c === "string") : [];
      setFreshSquadCodes(issued);
      if (planId === "cram_squad_3") void loadMyCodes();
      setPaymentSuccess(true);
      if (issued.length === 0 && planId !== "cram_squad_3") {
        closeTimerRef.current = setTimeout(() => finishPurchase(), 2000);
      }
    },
    [finishPurchase, loadMyCodes, refreshQuota, refreshTier],
  );

  // Automatic 3-second polling for PayOS transaction confirmation.
  useEffect(() => {
    if (!active || !payosOrder?.orderCode || paymentSuccess || !selectedPlan) return;

    let isMounted = true;
    const planId = selectedPlan.id;
    const orderCode = payosOrder.orderCode;

    const verifyOrder = async () => {
      try {
        const headers = await buildJsonHeaders();
        const res = await fetch("/api/payments/payos/verify", {
          method: "POST",
          headers,
          body: JSON.stringify({ orderCode, userId: user?.id }),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.paid === true && isMounted) {
          await handlePaid(data.squadCodes, planId);
        }
      } catch {
        // Ignore background polling network hiccups.
      }
    };

    const interval = setInterval(() => void verifyOrder(), 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [active, payosOrder?.orderCode, paymentSuccess, selectedPlan, buildJsonHeaders, user?.id, handlePaid]);

  const handleSelectPlan = (planId: PlanId) => {
    const plan = PRICING_PLANS.find((p) => p.id === planId);
    if (!plan || plan.comingSoon) return;
    if (isPlanIncludedForTier(plan.id, tier) || plan.id === "contender") return;
    if (isPayablePlan(plan.id)) {
      sendSmokeTestTelemetry(plan.id === "cram_squad_3" ? "cram_pass" : plan.id, "plan_selected");
    }
    setSelectedPlan(plan);
    setPayosOrder(null);
    setCreatingOrder(false);
    setAuthRequiredForPayment(false);
    setUsdCheckingOut(false);
    setUsdCheckoutError(null);
    setPaymentSuccess(false);
    setVerificationError(null);
    setFreshSquadCodes([]);
  };

  const handleCopy = (text: string, field: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => {});
      setCopiedField(field);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleVerifyPayment = async () => {
    if (!selectedPlan) return;
    if (isPayablePlan(selectedPlan.id)) {
      sendSmokeTestTelemetry(
        selectedPlan.id === "cram_squad_3" ? "cram_pass" : selectedPlan.id,
        "verify_clicked",
      );
    }
    setVerifying(true);
    setVerificationError(null);

    try {
      if (payosOrder?.orderCode) {
        try {
          const headers = await buildJsonHeaders();
          const res = await fetch("/api/payments/payos/verify", {
            method: "POST",
            headers,
            body: JSON.stringify({ orderCode: payosOrder.orderCode, userId: user?.id }),
          });
          const data = await res.json().catch(() => null);
          if (data?.paid === true) {
            await handlePaid(data.squadCodes, selectedPlan.id);
            return;
          }
        } catch {
          // Fall through to tier refresh.
        }
      }

      const updated = await refreshTier();
      if (
        updated === selectedPlan.id ||
        (selectedPlan.id === "cram_squad_3" && updated === "cram_pass")
      ) {
        await handlePaid(undefined, selectedPlan.id);
      } else {
        setVerificationError(t.pricing.payosVerifyNotConfirmed);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleUsdCheckout = async () => {
    if (!selectedPlan) return;
    setUsdCheckingOut(true);
    setUsdCheckoutError(null);

    try {
      const headers = await buildJsonHeaders();
      const res = await fetch("/api/payments/usd/create", {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: selectedPlan.id, userId: user?.id }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 401 || data?.error === "AUTH_REQUIRED") {
        setAuthRequiredForPayment(true);
        return;
      }

      if (res.ok && data?.ok && data.checkout?.checkoutUrl) {
        window.location.assign(data.checkout.checkoutUrl);
        return;
      }

      setUsdCheckoutError(t.pricing.usdInitError);
    } catch (err) {
      console.error("USD checkout error:", err);
      setUsdCheckoutError(t.pricing.usdNetworkError);
    } finally {
      setUsdCheckingOut(false);
    }
  };

  const handleRedeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = redeemCode.trim().toUpperCase();
    if (!code || redeeming) return;
    setRedeeming(true);
    setRedeemFeedback(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setRedeemFeedback("auth");
        openAuthModal(tp.squadRedeemSignInPrompt);
        return;
      }

      const res = await fetch("/api/payments/squad/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 401 || data?.code === "AUTH_REQUIRED") {
        setRedeemFeedback("auth");
        openAuthModal(tp.squadRedeemSignInPrompt);
        return;
      }

      if (res.ok && data?.ok) {
        setRedeemFeedback("success");
        setRedeemCode("");
        await refreshTier();
        void refreshQuota();
        void loadMyCodes();
      } else {
        setRedeemFeedback("error");
      }
    } catch {
      setRedeemFeedback("error");
    } finally {
      setRedeeming(false);
    }
  };

  /* ------------------------------ derived data ----------------------------- */

  const getPlanLabel = (planId: PlanId): string => {
    switch (planId) {
      case "contender":
        return tp.freeTitle;
      case "cram_pass":
        return tp.cramTitle;
      case "cram_squad_3":
        return tp.squadTitle;
      case "pro":
      case "pro_semester":
        return `${tp.proTitle} · ${tp.proToggleSemester}`;
      case "pro_monthly":
        return `${tp.proTitle} · ${tp.proToggleMonthly}`;
      case "tutor":
      case "tutor_guild":
        return tp.tutorTitle;
      default:
        return tp.freeTitle;
    }
  };

  const getPeriodLabel = (plan: PlanPricing): string => {
    if (plan.cycle === "free") return tp.periodForever;
    if (plan.cycle === "one_time") return tp.periodSevenDays;
    if (plan.cycle === "semester") return tp.periodSemester;
    return tp.periodMonth;
  };

  const proPlanId = resolveClutchProPlanId(proCycle);
  const isSemester = proCycle === "semester";
  const perStudent = getSquadPerStudentPrice(billingRegion);
  const monthlyEquiv = getProMonthlyEquivalent(billingRegion);
  const freePrice = getPlanDisplayPrice("contender", billingRegion);

  const visibleSquadCodes: SquadCodeItem[] =
    mineCodes.length > 0
      ? mineCodes
      : freshSquadCodes.map((code) => ({ code, status: "available" as const }));

  const squadCodesPanel = (codes: SquadCodeItem[]) => (
    <SquadCodesPanel
      codes={codes}
      heading={tp.squadCodesHeading}
      subheading={tp.squadCodesSubheading}
      copyLabel={tp.squadCodeCopy}
      copiedLabel={tp.squadCodeCopied}
      availableLabel={tp.squadCodeAvailable}
      redeemedLabel={tp.squadCodeRedeemed}
      copiedField={copiedField}
      onCopy={handleCopy}
    />
  );

  /* ----------------------------- plan card CTAs ---------------------------- */

  const proCta: { label: string; tone: CtaTone; disabled: boolean; planId: PlanId } = (() => {
    if (tier === proPlanId) {
      return { label: tp.ctaCurrentPlan, tone: "outline", disabled: true, planId: proPlanId };
    }
    if (tier === "pro_monthly" && proCycle === "semester") {
      return { label: tp.ctaUpgradeSemester, tone: "hero", disabled: false, planId: "pro" };
    }
    if (isPlanIncludedForTier(proPlanId, tier)) {
      return { label: tp.ctaIncluded, tone: "outline", disabled: true, planId: proPlanId };
    }
    return { label: tp.ctaBuyNowStar, tone: "hero", disabled: false, planId: proPlanId };
  })();

  const cramCta = (() => {
    if (tier === "cram_pass") return { label: tp.ctaCurrentPlan, tone: "outline" as const, disabled: true };
    if (isPlanIncludedForTier("cram_pass", tier)) {
      return { label: tp.ctaIncluded, tone: "outline" as const, disabled: true };
    }
    return { label: tp.ctaBuyNow, tone: "dark" as const, disabled: false };
  })();

  const squadCta = isPlanIncludedForTier("cram_squad_3", tier)
    ? { label: tp.ctaIncluded, tone: "outline" as const, disabled: true }
    : { label: tp.ctaBuyNow, tone: "dark" as const, disabled: false };

  const tutorCta =
    tier === "tutor"
      ? { label: tp.ctaCurrentPlan, tone: "outline" as const, disabled: true }
      : { label: tp.ctaBuyNowStar, tone: "hero" as const, disabled: false };

  const freeCta =
    tier === "contender"
      ? { label: tp.ctaCurrentPlan }
      : { label: tp.ctaIncluded };

  /* --------------------------------- views --------------------------------- */

  const renderPersonal = () => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      {/* Free */}
      <article className={CARD_BASE}>
        <CardHeading title={tp.freeTitle} headline={tp.freeHeadline} subtitle={tp.freeSubtitle} />
        <CtaButton label={freeCta.label} tone="outline" disabled />
        <PriceLine price={freePrice} period={tp.periodMonth} />
        <BulletList
          items={[tp.freeBullet1, tp.freeBullet2, tp.freeBullet3, tp.freeBullet4, tp.freeBullet5]}
        />
      </article>

      {/* 7-Day Cram Pass */}
      <article className={CARD_BASE}>
        <CardHeading title={tp.cramTitle} headline={tp.cramHeadline} subtitle={tp.cramSubtitle} />
        <CtaButton
          label={cramCta.label}
          tone={cramCta.tone}
          disabled={cramCta.disabled}
          onClick={() => handleSelectPlan("cram_pass")}
        />
        <PriceLine
          price={getPlanDisplayPrice("cram_pass", billingRegion)}
          period={tp.periodSevenDays}
        />
        <BulletList
          items={[
            tp.cramBullet1,
            tp.cramBullet2,
            tp.cramBullet3,
            tp.cramBullet4,
            tp.cramBullet5,
            tp.cramBullet6,
          ]}
        />
      </article>

      {/* Clutch Pro hero */}
      <article className={CARD_HERO}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3
            className={`text-xs font-bold uppercase tracking-wider text-[#b83d10] dark:text-[#fb923c] ${FONT_HEADING}`}
          >
            {tp.proTitle}
          </h3>
          <PillSwitch<ProCycle>
            value={proCycle}
            onChange={setProCycle}
            size="sm"
            label={tp.proTitle}
            options={[
              { id: "monthly", label: tp.proToggleMonthly },
              { id: "semester", label: tp.proToggleSemester },
            ]}
          />
        </div>
        <span
          className={`mb-3 inline-flex w-fit items-center rounded-full bg-[#e85d2a]/12 px-2.5 py-1 text-xs font-bold text-[#b83d10] dark:bg-[#e85d2a]/20 dark:text-[#fb923c] ${FONT_HEADING}`}
        >
          {isSemester ? tp.proSemesterBadge : tp.proBadge}
        </span>
        <p
          className={`mb-4 text-xl font-bold leading-tight text-[#1c211a] dark:text-stone-50 ${FONT_HEADING}`}
        >
          {isSemester ? tp.proSemesterHeadline : tp.proMonthlyHeadline}
        </p>
        <CtaButton
          label={proCta.label}
          tone={proCta.tone}
          disabled={proCta.disabled}
          onClick={() => handleSelectPlan(proCta.planId)}
        />
        <PriceLine
          price={getPlanDisplayPrice(proPlanId, billingRegion)}
          period={isSemester ? tp.periodSemester : tp.periodMonth}
        />
        <p className={`mt-1.5 text-sm text-[#81857b] dark:text-stone-400 ${FONT_BODY}`}>
          {isSemester ? fmt(tp.proSemesterSubtext, { monthlyEquiv }) : tp.proMonthlySubtext}
        </p>
        <BulletList
          accent
          items={[tp.proBullet1, tp.proBullet2, tp.proBullet3, tp.proBullet4, tp.proBullet5]}
        />
      </article>
    </div>
  );

  const renderTeam = () => (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-2">
      {/* Exam Squad */}
      <article className={CARD_BASE}>
        <CardHeading
          title={tp.squadTitle}
          headline={tp.squadHeadline}
          subtitle={tp.squadSubtitle}
        />
        <CtaButton
          label={squadCta.label}
          tone={squadCta.tone}
          disabled={squadCta.disabled}
          onClick={() => handleSelectPlan("cram_squad_3")}
        />
        <PriceLine
          price={getPlanDisplayPrice("cram_squad_3", billingRegion)}
          period={tp.periodSevenDays}
        />
        <div className={`mt-4 ${INNER_BOX} ${FONT_BODY} font-semibold`}>
          {fmt(tp.squadBoxedCallout, { perStudent })}
        </div>
        <BulletList items={[tp.squadBullet1, tp.squadBullet2, tp.squadBullet3, tp.squadBullet4]} />
        <button
          type="button"
          onClick={() => setRedeemOpen(true)}
          className={`mt-5 inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm font-semibold text-[#b83d10] underline-offset-4 hover:underline dark:text-[#fb923c] ${FOCUS_RING}`}
        >
          <Ticket size={14} aria-hidden="true" />
          {tp.squadRedeemTrigger}
        </button>
      </article>

      {/* Tutor & Guild hero */}
      <article className={`${CARD_HERO} overflow-hidden`}>
        <div
          className={`-mx-6 -mt-6 mb-5 bg-[#e85d2a]/12 px-6 py-2.5 text-xs font-bold text-[#b83d10] dark:bg-[#e85d2a]/20 dark:text-[#fb923c] ${FONT_HEADING}`}
        >
          {tp.tutorBanner}
        </div>
        <CardHeading
          title={tp.tutorTitle}
          headline={tp.tutorHeadline}
          subtitle={tp.tutorSubtitle}
        />
        <CtaButton
          label={tutorCta.label}
          tone={tutorCta.tone}
          disabled={tutorCta.disabled}
          onClick={() => handleSelectPlan("tutor")}
        />
        <PriceLine price={getPlanDisplayPrice("tutor", billingRegion)} period={tp.periodMonth} />
        <ul className={`mt-4 space-y-2 ${INNER_BOX} ${FONT_BODY} font-semibold`}>
          {[tp.tutorBoxedItem1, tp.tutorBoxedItem2, tp.tutorBoxedItem3].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Users size={14} className="mt-0.5 shrink-0 text-[#e85d2a]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <BulletList
          accent
          items={[tp.tutorBullet1, tp.tutorBullet2, tp.tutorBullet3, tp.tutorBullet4]}
        />
      </article>
    </div>
  );

  const renderRedeemPanel = () => (
    <div className="mx-auto mb-6 flex max-w-4xl flex-col items-center gap-3">
      {redeemOpen ? (
        <form
          onSubmit={handleRedeem}
          className="flex w-full max-w-md items-center gap-2"
          aria-label={tp.squadRedeemTrigger}
        >
          <input
            type="text"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            placeholder={tp.squadRedeemPlaceholder}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            aria-label={tp.squadRedeemTrigger}
            className={`min-w-0 flex-1 rounded-full border border-[#e2e5dc] bg-white px-4 py-2 text-sm tracking-wide text-[#1c211a] placeholder:text-[#81857b] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50 ${FONT_MONO} ${FOCUS_RING}`}
          />
          <button
            type="submit"
            disabled={redeeming || redeemCode.trim().length === 0}
            className={`shrink-0 cursor-pointer rounded-full bg-[#1c211a] px-4 py-2 text-sm font-bold text-[#fafbf9] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#fafaf9] dark:text-[#18181b] ${FONT_HEADING} ${FOCUS_RING}`}
          >
            {redeeming ? tp.squadRedeemingBtn : tp.squadRedeemBtn}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setRedeemOpen(true)}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#e2e5dc] bg-white px-4 py-1.5 text-sm font-semibold text-[#1c211a] hover:bg-[#eef0e9] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 ${FOCUS_RING}`}
        >
          <Ticket size={14} aria-hidden="true" />
          {tp.squadRedeemTrigger}
        </button>
      )}

      {redeemFeedback ? (
        <p
          role="status"
          className={`text-center text-sm font-medium ${
            redeemFeedback === "success"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-[#b83d10] dark:text-[#fb923c]"
          }`}
        >
          {redeemFeedback === "success"
            ? tp.squadRedeemSuccess
            : redeemFeedback === "auth"
              ? tp.squadRedeemSignInPrompt
              : tp.squadRedeemError}
        </p>
      ) : null}
    </div>
  );

  const renderCheckout = (plan: PlanPricing) => {
    const planLabel = getPlanLabel(plan.id);
    const planPeriod = getPeriodLabel(plan);
    const vnPrice = payosOrder
      ? formatRegionalPrice(payosOrder.amount, "VN")
      : getPlanDisplayPrice(plan.id, "VN");
    const surface =
      "rounded-xl border border-[#e2e5dc] bg-white dark:border-stone-800 dark:bg-stone-950";
    const iconBtn =
      "cursor-pointer rounded p-1 text-[#81857b] hover:bg-[#eef0e9] dark:hover:bg-stone-800";

    return (
      <div className="rounded-2xl border border-[#e2e5dc] bg-[#eef0e9]/60 p-5 dark:border-stone-800 dark:bg-stone-900/60">
        <button
          type="button"
          onClick={resetCheckout}
          className={`mb-3 inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-[#81857b] hover:text-[#1c211a] dark:hover:text-stone-100 ${FOCUS_RING}`}
        >
          <ArrowLeft size={13} aria-hidden="true" />
          {t.pricing.backToPlans}
        </button>

        {authRequiredForPayment ? (
          <div className="mb-4 flex flex-col items-center justify-between gap-3 rounded-xl border border-[#e85d2a]/30 bg-[#e85d2a]/10 p-4 sm:flex-row">
            <div className="text-left">
              <div className={`text-sm font-bold text-[#b83d10] dark:text-[#fb923c] ${FONT_HEADING}`}>
                {tp.signInPromptTitle}
              </div>
              <p className="mt-0.5 text-xs text-[#1c211a] dark:text-stone-200">{tp.signInPromptDesc}</p>
            </div>
            <button
              type="button"
              onClick={() => openAuthModal(t.pricing.authDialogPrompt)}
              className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full bg-[#e85d2a] px-4 py-2 text-xs font-bold text-[#18181b] hover:bg-[#f06a38] ${FONT_HEADING} ${FOCUS_RING}`}
            >
              {tp.signInBtn}
            </button>
          </div>
        ) : null}

        {paymentSuccess ? (
          <div className="mx-auto max-w-xl space-y-5 py-6 text-center">
            <CheckCircle2 size={52} className="mx-auto text-emerald-500" aria-hidden="true" />
            <div>
              <h3 className={`text-xl font-bold text-[#1c211a] dark:text-stone-50 ${FONT_HEADING}`}>
                {t.pricing.paymentSuccessTitle}
              </h3>
              <p className="mt-1 text-sm text-[#81857b] dark:text-stone-400">
                {fmt(t.pricing.paymentSuccessDesc, { planName: planLabel })}
              </p>
            </div>
            <div className="text-left">
              {squadCodesPanel(freshSquadCodes.map((code) => ({ code, status: "available" as const })))}
            </div>
            {freshSquadCodes.length > 0 || plan.id === "cram_squad_3" ? (
              <button
                type="button"
                onClick={finishPurchase}
                className={`cursor-pointer rounded-full bg-[#1c211a] px-6 py-2.5 text-sm font-bold text-[#fafbf9] dark:bg-[#fafaf9] dark:text-[#18181b] ${FONT_HEADING} ${FOCUS_RING}`}
              >
                {t.paymentReturn.dismissBtn}
              </button>
            ) : null}
          </div>
        ) : isVnCheckout ? (
          <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-2">
            <div className={`flex flex-col items-center justify-center p-4 text-center shadow-xs ${surface}`}>
              <div className="mb-2 flex items-center gap-2">
                <QrCode size={18} className="text-[#e85d2a]" aria-hidden="true" />
                <span
                  className={`text-xs font-bold uppercase tracking-wider text-[#1c211a] dark:text-stone-200 ${FONT_HEADING}`}
                >
                  {t.pricing.vietQrHeader}
                </span>
              </div>

              {creatingOrder ? (
                <div className="flex h-56 w-56 flex-col items-center justify-center rounded-lg border border-dashed border-[#e2e5dc] p-4 text-center dark:border-stone-800">
                  <Loader2 size={32} className="mb-3 animate-spin text-[#e85d2a]" aria-hidden="true" />
                  <span className="text-xs font-semibold">{t.pricing.creatingVietQr}</span>
                  <span className="mt-1 text-[11px] text-[#81857b]">{t.pricing.pleaseWait}</span>
                </div>
              ) : payosOrder ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={payosOrder.vietQrImageUrl}
                  alt={t.pricing.vietQrHeader}
                  className="h-auto w-56 rounded-lg border border-[#e2e5dc] dark:border-stone-800"
                  loading="lazy"
                />
              ) : authRequiredForPayment ? (
                <div className="flex h-56 w-56 flex-col items-center justify-center rounded-lg border border-dashed border-[#e85d2a]/40 bg-[#e85d2a]/5 p-4 text-center">
                  <Users size={30} className="mb-2 text-[#e85d2a]" aria-hidden="true" />
                  <span className="text-xs font-bold">{t.pricing.signInRequiredTitle}</span>
                  <span className="mb-3 mt-1 text-[11px] text-[#81857b]">
                    {t.pricing.signInRequiredQrDesc}
                  </span>
                  <button
                    type="button"
                    onClick={() => openAuthModal(t.pricing.authDialogPrompt)}
                    className={`cursor-pointer rounded-full bg-[#e85d2a] px-3 py-1.5 text-xs font-bold text-[#18181b] ${FOCUS_RING}`}
                  >
                    {t.pricing.signInNowBtn}
                  </button>
                </div>
              ) : (
                <div className="flex h-56 w-56 flex-col items-center justify-center rounded-lg border border-dashed border-[#e2e5dc] p-4 text-center dark:border-stone-800">
                  <span className="mb-2 text-xs font-semibold">
                    {verificationError || t.pricing.vietQrLoadFailed}
                  </span>
                  <button
                    type="button"
                    onClick={() => void createPayosOrder(plan)}
                    className={`cursor-pointer rounded-full bg-[#1c211a] px-3 py-1.5 text-xs font-bold text-[#fafbf9] dark:bg-[#fafaf9] dark:text-[#18181b] ${FOCUS_RING}`}
                  >
                    {t.pricing.retryBtn}
                  </button>
                </div>
              )}

              <span className="mt-2 flex items-center gap-1 text-[11px] text-[#81857b]">
                <Clock size={12} aria-hidden="true" />
                {t.pricing.autoVerifiedIn3s}
              </span>
            </div>

            <div className="space-y-3">
              <div className={`p-3 ${surface}`}>
                <div className="text-xs font-medium text-[#81857b]">{t.pricing.selectedPlanLabel}</div>
                <div className={`text-base font-bold text-[#b83d10] dark:text-[#fb923c] ${FONT_HEADING}`}>
                  {planLabel} · {vnPrice} {planPeriod}
                </div>
              </div>

              <div className={`space-y-2 p-3 text-xs ${surface}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[#81857b]">{t.pricing.bankLabel}</span>
                  <span className="font-semibold">
                    {payosOrder ? "MBBank (Napas 24/7)" : t.pricing.payosLinkedBank}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#81857b]">{t.pricing.accountNumberLabel}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold ${FONT_MONO}`}>{payosOrder?.accountNumber ?? ""}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(payosOrder?.accountNumber ?? "", "acc")}
                      className={iconBtn}
                      title={t.pricing.copyAccountTitle}
                      aria-label={t.pricing.copyAccountTitle}
                    >
                      {copiedField === "acc" ? (
                        <Check size={12} className="text-emerald-600" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#81857b]">{t.pricing.accountNameLabel}</span>
                  <span className="font-semibold">{payosOrder?.accountName ?? "PayOS VietQR"}</span>
                </div>
                <div className="flex items-center justify-between border-t border-[#e2e5dc] pt-1 dark:border-stone-800">
                  <span className="text-[#81857b]">{t.pricing.transferNoteLabel}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold text-[#b83d10] dark:text-[#fb923c] ${FONT_MONO}`}>
                      {payosOrder?.description ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(payosOrder?.description ?? "", "note")}
                      className={iconBtn}
                      title={t.pricing.copyNoteTitle}
                      aria-label={t.pricing.copyNoteTitle}
                    >
                      {copiedField === "note" ? (
                        <Check size={12} className="text-emerald-600" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {verificationError && payosOrder ? (
                <div className="rounded-lg border border-[#e85d2a]/30 bg-[#e85d2a]/10 p-2.5 text-xs text-[#b83d10] dark:text-[#fb923c]">
                  {verificationError}
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void handleVerifyPayment()}
                  disabled={verifying}
                  className={`w-full cursor-pointer rounded-full bg-[#1c211a] py-2.5 text-sm font-bold text-[#fafbf9] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#fafaf9] dark:text-[#18181b] ${FONT_HEADING} ${FOCUS_RING}`}
                >
                  {verifying ? t.pricing.checkingPaymentBtn : t.pricing.verifyPaymentBtn}
                </button>
                {payosOrder?.checkoutUrl ? (
                  <a
                    href={payosOrder.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-[#e2e5dc] bg-white px-3 py-2 text-xs font-semibold text-[#1c211a] hover:bg-[#fafbf9] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 ${FOCUS_RING}`}
                  >
                    <span>{t.pricing.openPayosPortal}</span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                ) : null}
              </div>

              <p className="text-center text-[11px] text-[#81857b]">{t.pricing.securityNote}</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-md space-y-4 py-3">
            <div className={`p-4 text-center shadow-xs ${surface}`}>
              <span className="text-xs font-medium text-[#81857b]">{t.pricing.selectedPlanLabel}</span>
              <div className={`mt-1 text-xl font-bold text-[#b83d10] dark:text-[#fb923c] ${FONT_HEADING}`}>
                {planLabel}
              </div>
              <div className={`mt-0.5 text-2xl font-bold ${FONT_HEADING}`}>
                {getPlanDisplayPrice(plan.id, "ROW")}
                <span className="ml-1 text-sm font-semibold text-[#81857b]">{planPeriod}</span>
              </div>
              <div className="mt-1 text-xs text-[#81857b]">
                {plan.cycle === "one_time" ? t.pricing.oneTimeNoSub : t.pricing.billedAutomatically}
              </div>
            </div>

            <div className={`space-y-3 p-4 shadow-xs ${surface}`}>
              <button
                type="button"
                onClick={() => void handleUsdCheckout()}
                disabled={usdCheckingOut}
                className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#e85d2a] px-4 py-3 text-sm font-bold text-[#18181b] hover:bg-[#f06a38] disabled:cursor-not-allowed disabled:opacity-60 ${FONT_HEADING} ${FOCUS_RING}`}
              >
                {usdCheckingOut ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    <span>{t.pricing.connectingUsdCheckout}</span>
                  </>
                ) : (
                  <>
                    <CreditCard size={16} aria-hidden="true" />
                    <span>{t.pricing.proceedUsdCheckout}</span>
                  </>
                )}
              </button>

              {usdCheckoutError ? (
                <div className="rounded-lg border border-[#e85d2a]/30 bg-[#e85d2a]/10 p-2.5 text-xs text-[#b83d10] dark:text-[#fb923c]">
                  {usdCheckoutError}
                </div>
              ) : null}

              <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-[#81857b]">
                <ShieldCheck size={13} className="shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{t.pricing.polarPciNote}</span>
              </div>
              <p className="text-center text-[11px] text-[#81857b]">{t.pricing.globalCardsLabel}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  /* --------------------------------- layout -------------------------------- */

  const isPage = variant === "page";
  const TitleTag = isPage ? "h1" : "h2";

  const body: ReactNode = (
    <div className={`w-full text-[#1c211a] dark:text-stone-50 ${FONT_BODY}`}>
      {/* Header */}
      <header className="mb-6 flex flex-col items-center gap-4 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span
            className={`rounded-full bg-[#eef0e9] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#1c211a] dark:bg-stone-800 dark:text-stone-100 ${FONT_HEADING}`}
          >
            {tp.headerBadge}
          </span>
          {tier !== "contender" ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {tp.statusActive}: {getPlanLabel(tier)}
              {daysRemaining !== null ? ` · ${fmt(tp.statusDaysLeft, { days: daysRemaining })}` : ""}
            </span>
          ) : null}
        </div>

        <TitleTag
          className={`text-3xl font-bold tracking-tight text-[#1c211a] sm:text-4xl dark:text-stone-50 ${FONT_HEADING}`}
        >
          {tp.title}
        </TitleTag>
        <p className="max-w-xl text-sm text-[#81857b] dark:text-stone-400">{tp.subtitle}</p>

        {initialReason ? (
          <p
            role="status"
            className="max-w-xl rounded-xl border border-[#e85d2a]/30 bg-[#e85d2a]/10 px-4 py-2.5 text-sm font-medium text-[#b83d10] dark:text-[#fb923c]"
          >
            {initialReason}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-3">
          <PillSwitch<PricingAudience>
            value={audience}
            onChange={setAudience}
            label={tp.title}
            options={[
              { id: "personal", label: tp.tabPersonal },
              { id: "team", label: tp.tabTeam },
            ]}
          />
          <PillSwitch<BillingRegion>
            value={billingRegion}
            onChange={applyBillingRegion}
            size="sm"
            label={tp.currencyVn}
            options={[
              { id: "VN", label: tp.currencyVn },
              { id: "ROW", label: tp.currencyGlobal },
            ]}
          />
        </div>
      </header>

      {selectedPlan ? (
        renderCheckout(selectedPlan)
      ) : (
        <>
          {audience === "team" ? renderRedeemPanel() : null}
          {audience === "personal" ? renderPersonal() : renderTeam()}
          {audience === "team" && visibleSquadCodes.length > 0 ? (
            <div className="mx-auto mt-6 max-w-4xl">{squadCodesPanel(visibleSquadCodes)}</div>
          ) : null}
        </>
      )}

      {/* Earn free remix runs */}
      <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[#e2e5dc] bg-white p-4 dark:border-stone-800 dark:bg-stone-900/90">
        <div className="shrink-0 rounded-xl bg-[#e85d2a]/10 p-2.5 text-[#e85d2a]">
          <Gift size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className={`text-sm font-bold ${FONT_HEADING}`}>{tp.earnRemixTitle}</strong>
            {referrals.unlockedRemixRuns > 0 ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                {fmt(tp.earnRemixUnlocked, { count: referrals.unlockedRemixRuns })}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[#81857b] dark:text-stone-400">{tp.earnRemixDesc}</p>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-6 space-y-3 border-t border-[#e2e5dc] pt-4 text-[11px] text-[#81857b] dark:border-stone-800 dark:text-stone-400">
        <div className="flex items-start gap-2">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <span className="font-semibold text-[#1c211a] dark:text-stone-200">{tp.guaranteeTitle}</span>
        </div>
        <p>{tp.noSurpriseRenewals}</p>
        {!isVnCheckout ? <p>{t.pricing.globalSecurityNote}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#1c211a] dark:hover:text-stone-100"
            >
              {t.pricing.termsOfService}
            </a>
            <span aria-hidden="true">•</span>
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#1c211a] dark:hover:text-stone-100"
            >
              {t.pricing.privacyPolicy}
            </a>
          </div>
          <span>{tp.legalCompliance}</span>
        </div>
      </footer>
    </div>
  );

  if (!isPage) {
    return <div className="w-full p-5 sm:p-8">{body}</div>;
  }

  return (
    <div className="min-h-screen bg-[#fafbf9] text-[#1c211a] transition-colors dark:bg-stone-950 dark:text-stone-50">
      <nav className="sticky top-0 z-40 w-full border-b border-[#e2e5dc] bg-[#fafbf9]/90 backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className={`inline-flex items-center gap-2 text-sm font-bold text-[#1c211a] dark:text-stone-100 ${FONT_HEADING} ${FOCUS_RING}`}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Clutch Arena</span>
          </Link>
          <div
            role="group"
            aria-label="Language"
            className="inline-flex rounded-full border border-[#e2e5dc] bg-[#eef0e9] p-0.5 dark:border-stone-800 dark:bg-stone-900"
          >
            {(["en", "vi"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                aria-pressed={language === code}
                className={`cursor-pointer rounded-full px-3 py-1 text-xs font-bold uppercase ${FONT_HEADING} ${FOCUS_RING} ${
                  language === code
                    ? "bg-white text-[#1c211a] shadow-xs dark:bg-stone-800 dark:text-[#fafaf9]"
                    : "text-[#81857b] hover:text-[#1c211a] dark:text-stone-400"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{body}</main>
    </div>
  );
}
