"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X,
  Check,
  Zap,
  Sparkles,
  Flame,
  Users,
  QrCode,
  CreditCard,
  Copy,
  ExternalLink,
  ShieldCheck,
  Gift,
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers3,
  Loader2,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";
import {
  PRICING_PLANS,
  type UserTier,
  type PlanPricing,
} from "@/lib/pricing/tiers";
import {
  getBillingRegionClient,
  setBillingRegionClient,
  getEffectiveCurrency,
  getPlanRegionalPrice,
  type BillingRegion,
} from "@/lib/pricing/region";
import { useUserTier } from "@/hooks/use-user-tier";
import { useAuth } from "@/lib/auth/context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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

export function PricingModal({
  open,
  onClose,
  initialReason,
}: {
  open: boolean;
  onClose: () => void;
  initialReason?: string | null;
}) {
  const { t, language } = useLanguage();
  const { tier, setTier, referrals, daysRemaining, refreshTier } = useUserTier();
  const { user, session, openAuthModal } = useAuth();
  const openAuthDialog = openAuthModal;

  const [billingRegion, setBillingRegion] = useState<BillingRegion>(() =>
    getBillingRegionClient(),
  );
  const [currency, setCurrency] = useState<"vnd" | "usd">(() =>
    getEffectiveCurrency(getBillingRegionClient()).toLowerCase() as "vnd" | "usd",
  );
  const [selectedPlan, setSelectedPlan] = useState<PlanPricing | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [earlyContact, setEarlyContact] = useState(() => user?.email || "");
  const [intentSubmitted, setIntentSubmitted] = useState(false);

  const [payosOrder, setPayosOrder] = useState<PayosCheckoutData | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [authRequiredForPayment, setAuthRequiredForPayment] = useState(false);
  const [usdCheckingOut, setUsdCheckingOut] = useState(false);
  const [usdCheckoutError, setUsdCheckoutError] = useState<string | null>(null);
  const isCreatingRef = useRef(false);

  const isVi = language === "vi";
  const isVnCheckout = billingRegion === "VN" || currency === "vnd";

  // When modal opens, sync state from client billing region cookie
  useEffect(() => {
    if (open) {
      const currentRegion = getBillingRegionClient();
      setBillingRegion(currentRegion);
      setCurrency(getEffectiveCurrency(currentRegion).toLowerCase() as "vnd" | "usd");
      if (user?.email && !earlyContact) {
        setEarlyContact(user.email);
      }
    }
  }, [open, user?.email]);

  const handleSelectVnd = () => {
    setBillingRegion("VN");
    setCurrency("vnd");
    setBillingRegionClient("VN");
    setVerificationError(null);
  };

  const handleSelectUsd = () => {
    setBillingRegion("ROW");
    setCurrency("usd");
    setBillingRegionClient("ROW");
    setVerificationError(null);
  };

  const sendSmokeTestTelemetry = (
    planId: "cram_pass" | "pro" | "pro_monthly" | "tutor",
    action: "plan_selected" | "verify_clicked" | "early_access_requested",
    contact?: string,
  ) => {
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "smoke_test_intent",
        planId,
        currency,
        action,
        ...(contact && contact.trim() ? { contact: contact.trim().slice(0, 160) } : {}),
        language,
      }),
    }).catch(() => {});
  };

  const createPayosOrder = useCallback(
    async (plan: PlanPricing) => {
      if (
        plan.id !== "cram_pass" &&
        plan.id !== "pro" &&
        plan.id !== "pro_monthly" &&
        plan.id !== "tutor" &&
        plan.id !== "tutor_guild"
      )
        return;
      if (isCreatingRef.current) return;
      isCreatingRef.current = true;
      setCreatingOrder(true);
      setVerificationError(null);
      setAuthRequiredForPayment(false);

      try {
        let token = session?.access_token;
        if (!token) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            token = data.session?.access_token;
          }
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

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
          setPayosOrder(data.payment);
          setAuthRequiredForPayment(false);
        } else {
          setVerificationError(
            data?.message ||
              (isVi
                ? "Không thể khởi tạo thanh toán PayOS. Vui lòng thử lại sau."
                : "Failed to initialize PayOS payment. Please try again later."),
          );
        }
      } catch (err) {
        console.error("PayOS create error:", err);
        setVerificationError(
          isVi
            ? "Lỗi kết nối khi khởi tạo thanh toán. Vui lòng thử lại."
            : "Network error when creating payment. Please try again.",
        );
      } finally {
        setCreatingOrder(false);
        isCreatingRef.current = false;
      }
    },
    [session?.access_token, user?.id, isVi],
  );

  useEffect(() => {
    if (!open) {
      setPayosOrder(null);
      setCreatingOrder(false);
      setAuthRequiredForPayment(false);
      return;
    }

    const isPayosPlan =
      selectedPlan &&
      (selectedPlan.id === "cram_pass" ||
        selectedPlan.id === "pro" ||
        selectedPlan.id === "pro_monthly" ||
        selectedPlan.id === "tutor" ||
        selectedPlan.id === "tutor_guild");

    if (isVnCheckout && isPayosPlan) {
      if (payosOrder && payosOrder.orderCode) {
        return;
      }
      void createPayosOrder(selectedPlan);
    } else {
      setPayosOrder(null);
      setCreatingOrder(false);
      setAuthRequiredForPayment(false);
    }
  }, [open, isVnCheckout, selectedPlan?.id, user?.id, payosOrder, createPayosOrder]);

  // Automatic 4-second Polling for PayOS transaction confirmation
  useEffect(() => {
    if (!open || !payosOrder?.orderCode || paymentSuccess) {
      return;
    }

    let isMounted = true;

    const verifyOrder = async () => {
      try {
        let token = session?.access_token;
        if (!token) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            token = data.session?.access_token;
          }
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch("/api/payments/payos/verify", {
          method: "POST",
          headers,
          body: JSON.stringify({ orderCode: payosOrder.orderCode, userId: user?.id }),
        });

        if (!res.ok) return;

        const data = await res.json().catch(() => null);

        if (data?.paid === true && isMounted) {
          await refreshTier();
          setPaymentSuccess(true);
          setTimeout(() => {
            if (isMounted) {
              onClose();
              setSelectedPlan(null);
              setPayosOrder(null);
              setPaymentSuccess(false);
            }
          }, 2000);
        }
      } catch {
        // Ignore background polling network hiccups
      }
    };

    const interval = setInterval(() => {
      void verifyOrder();
    }, 4000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [open, payosOrder?.orderCode, paymentSuccess, session?.access_token, user?.id, refreshTier, onClose]);

  const handleSelectPlan = (plan: PlanPricing) => {
    if (plan.comingSoon) return;
    if (plan.id === "contender") {
      onClose();
      return;
    }
    if (
      (plan.id === "cram_pass" || plan.id === "pro_monthly") &&
      (tier === "pro" || tier === "tutor")
    ) {
      return;
    }
    if (plan.id === "pro" && tier === "tutor") {
      return;
    }
    if (
      plan.id === "cram_pass" ||
      plan.id === "pro" ||
      plan.id === "pro_monthly" ||
      plan.id === "tutor"
    ) {
      sendSmokeTestTelemetry(plan.id, "plan_selected");
    }
    setSelectedPlan(plan);
    setPayosOrder(null);
    setCreatingOrder(false);
    setAuthRequiredForPayment(false);
    setUsdCheckingOut(false);
    setUsdCheckoutError(null);
    setPaymentSuccess(false);
    setVerificationError(null);
    setEarlyContact(user?.email || "");
    setIntentSubmitted(false);
  };

  const handleCopy = (text: string, field: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleVerifyPayment = async () => {
    if (!selectedPlan) return;
    if (
      selectedPlan.id === "cram_pass" ||
      selectedPlan.id === "pro" ||
      selectedPlan.id === "pro_monthly" ||
      selectedPlan.id === "tutor"
    ) {
      sendSmokeTestTelemetry(selectedPlan.id, "verify_clicked");
    }
    setSimulating(true);
    setVerificationError(null);

    try {
      let isPaid = false;

      if (payosOrder?.orderCode) {
        let token = session?.access_token;
        if (!token) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            token = data.session?.access_token;
          }
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        try {
          const res = await fetch("/api/payments/payos/verify", {
            method: "POST",
            headers,
            body: JSON.stringify({ orderCode: payosOrder.orderCode, userId: user?.id }),
          });
          const data = await res.json().catch(() => null);
          if (data?.paid === true) {
            isPaid = true;
          }
        } catch {
          // Fall through to refreshTier
        }
      }

      if (isPaid) {
        await refreshTier();
        setPaymentSuccess(true);
        setTimeout(() => {
          onClose();
          setSelectedPlan(null);
          setPayosOrder(null);
          setPaymentSuccess(false);
        }, 2000);
        return;
      }

      const updated = await refreshTier();
      if (
        updated === selectedPlan.id ||
        updated === "pro" ||
        updated === "cram_pass"
      ) {
        setPaymentSuccess(true);
        setTimeout(() => {
          onClose();
          setSelectedPlan(null);
          setPayosOrder(null);
          setPaymentSuccess(false);
        }, 2000);
      } else {
        setVerificationError(
          isVi
            ? "Hệ thống chưa ghi nhận giao dịch của bạn. Vui lòng hoàn tất chuyển khoản đúng nội dung, hoặc liên hệ hỗ trợ."
            : "Payment not yet confirmed by the server. Please ensure you are signed in and have completed checkout.",
        );
      }
    } finally {
      setSimulating(false);
    }
  };

  const handleUsdCheckout = async () => {
    if (!selectedPlan) return;
    setUsdCheckingOut(true);
    setUsdCheckoutError(null);

    try {
      let token = session?.access_token;
      if (!token) {
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token;
        }
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/payments/usd/create", {
        method: "POST",
        headers,
        body: JSON.stringify({
          planId: selectedPlan.id,
          userId: user?.id,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 401 || data?.error === "AUTH_REQUIRED") {
        setAuthRequiredForPayment(true);
        return;
      }

      if (res.status === 503) {
        setUsdCheckoutError(
          isVi
            ? "Cổng thanh toán thẻ quốc tế USD đang hoàn tất cấu hình. Bạn có thể để lại email bên dưới để nhận thông báo ngay khi mở cổng."
            : "Global USD card checkout is finalizing setup. Please leave your email below to receive priority access.",
        );
        return;
      }

      if (res.ok && data?.ok && data.checkout?.checkoutUrl) {
        window.location.assign(data.checkout.checkoutUrl);
        return;
      }

      setUsdCheckoutError(
        data?.message ||
          data?.error ||
          (isVi
            ? "Không thể khởi tạo cổng thanh toán USD. Vui lòng thử lại sau."
            : "Failed to initialize USD checkout session. Please try again later."),
      );
    } catch (err) {
      console.error("USD checkout error:", err);
      setUsdCheckoutError(
        isVi
          ? "Lỗi kết nối khi khởi tạo thanh toán USD. Vui lòng thử lại."
          : "Network error when creating USD checkout session. Please try again.",
      );
    } finally {
      setUsdCheckingOut(false);
    }
  };

  const displayBankName = payosOrder ? "MBBank (Napas 24/7)" : t.pricing.payosLinkedBank;
  const displayAccountNumber = payosOrder?.accountNumber || "";
  const displayAccountName = payosOrder?.accountName || "PayOS VietQR";
  const displayTransferNote = payosOrder?.description || "";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      className="pricing-dialog-content"
      hideHeader={true}
      hideCloseButton={true}
      title={isVi ? "Mở khóa toàn quyền Clutch Arena" : "Unlock Clutch Arena"}
      description={
        initialReason ||
        (isVi
          ? "Không lo gia hạn thẻ tín dụng."
          : "Instant scan-to-pay & one-time passes.")
      }
    >
      <div className="pricing-modal-container w-full text-stone-900 dark:text-stone-100">
        {/* Single Unified Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-4 mb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-2.5 py-0.5 rounded-full">
                <Flame size={13} />
                {isVi ? "Bảng Giá Sinh Viên" : "Student Pricing"}
              </span>
              {tier !== "contender" && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  {isVi
                    ? `Gói hiện tại: ${tier.toUpperCase()}${daysRemaining !== null ? ` (Còn ${daysRemaining} ngày)` : ""}`
                    : `Active: ${tier.toUpperCase()}${daysRemaining !== null ? ` (${daysRemaining}d left)` : ""}`}
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-stone-900 dark:text-stone-50">
              {isVi
                ? "Mở khóa toàn bộ sức mạnh Clutch Arena"
                : "Unlock Peak Academic Performance"}
            </h2>
            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400">
              {initialReason ||
                (isVi
                  ? "Không lo gia hạn thẻ tín dụng."
                  : "Instant scan-to-pay & one-time passes.")}
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
            {/* Currency selector */}
            <div className="flex items-center bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold">
              <button
                type="button"
                onClick={handleSelectVnd}
                className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                  currency === "vnd"
                    ? "bg-white dark:bg-stone-900 text-amber-700 dark:text-amber-400 shadow-xs font-bold"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                🇻🇳 VND (đ)
              </button>
              <button
                type="button"
                onClick={handleSelectUsd}
                className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                  currency === "usd"
                    ? "bg-white dark:bg-stone-900 text-amber-700 dark:text-amber-400 shadow-xs font-bold"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                🌐 USD ($)
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body: Checkout View OR Tier Comparison View */}
        {selectedPlan ? (
          <div className="checkout-view bg-stone-50 dark:bg-stone-900/60 p-5 rounded-2xl border border-stone-200 dark:border-stone-800">
            <button
              type="button"
              onClick={() => {
                setSelectedPlan(null);
                setPayosOrder(null);
                setCreatingOrder(false);
                setAuthRequiredForPayment(false);
                setUsdCheckingOut(false);
                setUsdCheckoutError(null);
                setVerificationError(null);
              }}
              className="text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 mb-3 flex items-center gap-1"
            >
              ← {t.pricing.backToPlans}
            </button>

            {/* Authentication Callout Banner */}
            {authRequiredForPayment && (
              <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-xs font-semibold">
                  <Users size={18} className="text-amber-600 shrink-0" />
                  <span>
                    {isVi
                      ? "Vui lòng đăng nhập hoặc tạo tài khoản để kích hoạt gói học tự động vào tài khoản của bạn."
                      : "Please sign in or create an account to automatically link this purchase to your profile."}
                  </span>
                </div>
                <Button
                  type="button"
                  onClick={() =>
                    openAuthDialog(
                      isVi
                        ? "Đăng nhập để tiến hành thanh toán và kích hoạt gói học"
                        : "Sign in to complete checkout and activate pass",
                    )
                  }
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3.5 py-2 rounded-lg shrink-0 cursor-pointer shadow-xs whitespace-nowrap"
                >
                  {isVi ? "Đăng nhập / Tạo tài khoản ngay" : "Sign in / Create Account"}
                </Button>
              </div>
            )}

            {paymentSuccess ? (
              <div className="text-center py-8">
                <CheckCircle2 size={54} className="text-emerald-500 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-stone-900 dark:text-stone-100">
                  {isVi ? "Thanh toán thành công!" : "Pass Activated Successfully!"}
                </h3>
                <p className="text-sm text-stone-600 dark:text-stone-400 mt-1">
                  {isVi
                    ? `Bạn đã mở khóa toàn quyền ${selectedPlan.nameVi}. Đang tải lại...`
                    : `Your ${selectedPlan.nameEn} is now active across all devices.`}
                </p>
              </div>
            ) : isVnCheckout ? (
              /* Vietnam VietQR Checkout */
              <div className="vietqr-checkout grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="flex flex-col items-center justify-center p-4 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800 shadow-sm text-center">
                  <div className="flex items-center gap-2 mb-2">
                    <QrCode size={18} className="text-amber-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                      {t.pricing.vietQrHeader}
                    </span>
                  </div>

                  {creatingOrder ? (
                    <div className="w-56 h-56 flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/40 p-4 text-center">
                      <Loader2 size={32} className="text-amber-600 animate-spin mb-3" />
                      <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                        {isVi
                          ? "Đang khởi tạo mã VietQR định danh từ PayOS..."
                          : "Creating identified PayOS VietQR..."}
                      </span>
                      <span className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">
                        {isVi ? "Vui lòng đợi giây lát" : "Please wait a moment"}
                      </span>
                    </div>
                  ) : payosOrder ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={payosOrder.vietQrImageUrl}
                      alt="VietQR Payment Code"
                      className="w-56 h-auto rounded-lg border border-stone-100 dark:border-stone-800"
                      loading="lazy"
                    />
                  ) : authRequiredForPayment ? (
                    <div className="w-56 h-56 flex flex-col items-center justify-center rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4 text-center">
                      <Users size={32} className="text-amber-600 mb-2" />
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        {isVi ? "Yêu cầu đăng nhập" : "Sign in required"}
                      </span>
                      <span className="text-[11px] text-stone-500 mt-1 mb-3">
                        {isVi ? "Đăng nhập để tạo mã QR gắn liền tài khoản của bạn" : "Sign in to generate your personal payment QR"}
                      </span>
                      <Button
                        onClick={() => openAuthDialog(isVi ? "Đăng nhập để thanh toán gói học" : "Sign in to complete checkout")}
                        className="text-xs py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg cursor-pointer"
                      >
                        {isVi ? "Đăng nhập ngay" : "Sign in now"}
                      </Button>
                    </div>
                  ) : (
                    <div className="w-56 h-56 flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/20 p-4 text-center">
                      <span className="text-xs font-semibold text-stone-700 dark:text-stone-300 mb-2">
                        {verificationError || (isVi ? "Chưa tải được mã VietQR" : "Could not load VietQR")}
                      </span>
                      <Button
                        onClick={() => selectedPlan && createPayosOrder(selectedPlan)}
                        className="text-xs py-1.5 px-3 bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 rounded-lg cursor-pointer"
                      >
                        {isVi ? "Tải lại mã" : "Retry"}
                      </Button>
                    </div>
                  )}

                  <span className="text-[11px] text-stone-500 mt-2 flex items-center gap-1">
                    <Clock size={12} />
                    {t.pricing.autoVerifiedIn3s}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="p-3 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800">
                    <div className="text-xs text-stone-500 font-medium">{t.pricing.selectedPlanLabel}</div>
                    <div className="text-base font-bold text-amber-700 dark:text-amber-400">
                      {isVi ? selectedPlan.nameVi : selectedPlan.nameEn} ·{" "}
                      {payosOrder
                        ? `${payosOrder.amount.toLocaleString(isVi ? "vi-VN" : "en-US")}đ`
                        : getPlanRegionalPrice(selectedPlan.id, "VN").formatted.split("/")[0]}
                      {selectedPlan.cycle === "semester"
                        ? isVi
                          ? " / 4 tháng"
                          : " / 4 months"
                        : selectedPlan.cycle === "monthly"
                          ? isVi
                            ? " / tháng"
                            : " / mo"
                          : selectedPlan.cycle === "one_time"
                            ? isVi
                              ? " / 7 ngày"
                              : " / 7 days"
                            : ""}
                    </div>
                  </div>

                  <div className="p-3 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-stone-500">{t.pricing.bankLabel}</span>
                      <span className="font-semibold">{displayBankName}</span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-stone-500">{t.pricing.accountNumberLabel}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-stone-900 dark:text-stone-100">
                          {displayAccountNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(displayAccountNumber, "acc")}
                          className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded text-stone-500 cursor-pointer"
                          title={t.pricing.copyAccountTitle}
                        >
                          {copiedField === "acc" ? (
                            <Check size={12} className="text-emerald-600" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-stone-500">{t.pricing.accountNameLabel}</span>
                      <span className="font-semibold">{displayAccountName}</span>
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-stone-100 dark:border-stone-800">
                      <span className="text-stone-500">{t.pricing.transferNoteLabel}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                          {displayTransferNote}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(displayTransferNote, "note")}
                          className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded text-stone-500 cursor-pointer"
                          title={t.pricing.copyNoteTitle}
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

                  {verificationError && (
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                      {verificationError}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={handleVerifyPayment}
                      disabled={simulating}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-sm cursor-pointer"
                    >
                      {simulating
                        ? t.pricing.checkingPaymentBtn
                        : t.pricing.verifyPaymentBtn}
                    </Button>

                    {payosOrder?.checkoutUrl && (
                      <a
                        href={payosOrder.checkoutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200 transition-colors shadow-xs"
                      >
                        <span>{t.pricing.openPayosPortal}</span>
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>

                  <p className="text-[11px] text-center text-stone-500">
                    {t.pricing.securityNote}
                  </p>
                </div>
              </div>
            ) : (
              /* Global USD Checkout — Dedicated Early Access Waitlist */
              <div className="global-usd-checkout max-w-md mx-auto space-y-4 py-3">
                {/* Selected Plan Summary Card */}
                <div className="p-4 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800 text-center shadow-xs">
                  <span className="text-xs text-stone-500 font-medium">{t.pricing.selectedPlanLabel}</span>
                  <div className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">
                    {isVi ? selectedPlan.nameVi : selectedPlan.nameEn}
                  </div>
                  <div className="text-2xl font-bold text-stone-900 dark:text-stone-100 mt-0.5">
                    {getPlanRegionalPrice(selectedPlan.id, "ROW").formatted.split("/")[0]}
                    <span className="text-sm font-semibold text-stone-500 ml-1">
                      {selectedPlan.cycle === "semester"
                        ? isVi
                          ? " / 4 tháng"
                          : " / 4 months"
                        : selectedPlan.cycle === "monthly"
                          ? isVi
                            ? " / tháng"
                            : " / mo"
                          : selectedPlan.cycle === "one_time"
                            ? isVi
                              ? " / 7 ngày"
                              : " / 7 days"
                            : ""}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500 mt-1">
                    {selectedPlan.cycle === "one_time"
                      ? isVi
                        ? "Mua 1 lần · Không gia hạn"
                        : "One-time purchase · No subscription"
                      : isVi
                        ? "Gia hạn tự động định kỳ"
                        : "Billed automatically"}
                  </div>
                </div>

                {/* Primary USD Checkout Card */}
                <div className="p-4 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800 space-y-3 shadow-xs">
                  <Button
                    onClick={handleUsdCheckout}
                    disabled={usdCheckingOut}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm cursor-pointer flex items-center justify-center gap-2"
                  >
                    {usdCheckingOut ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>
                          {isVi
                            ? "Đang chuyển tiếp cổng thanh toán USD..."
                            : "Connecting to Secure USD Checkout..."}
                        </span>
                      </>
                    ) : (
                      <>
                        <CreditCard size={16} />
                        <span>
                          {isVi
                            ? "Thanh toán Thẻ Quốc tế USD (Visa / Mastercard / Apple Pay)"
                            : "Proceed to Secure USD Card Checkout (Polar.sh)"}
                        </span>
                      </>
                    )}
                  </Button>

                  {usdCheckoutError && (
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                      {usdCheckoutError}
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-2 text-[11px] text-stone-500 pt-1">
                    <ShieldCheck size={13} className="text-emerald-600 shrink-0" />
                    <span>
                      {isVi
                        ? "Bảo mật chuẩn PCI-DSS · Polar.sh Merchant of Record"
                        : "Powered by Polar.sh · PCI-DSS Compliant Merchant of Record"}
                    </span>
                  </div>
                </div>

                {/* Dedicated Early Access Waitlist Card */}
                <div className="p-5 bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent dark:from-amber-950/30 dark:via-stone-900/40 dark:to-stone-950 rounded-2xl border border-amber-300/70 dark:border-amber-700/50 shadow-xs space-y-3.5">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100/90 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 text-xs font-bold border border-amber-300 dark:border-amber-700/70 shadow-2xs">
                      <Sparkles size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>
                        {isVi
                          ? "Hiện đã mở qua VietQR tại Việt Nam — Đăng ký danh sách chờ Thẻ Quốc tế (USD)"
                          : "Early Access Live in Vietnam (VietQR) — Join the Global USD Card Waitlist"}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed text-left">
                    {isVi
                      ? "Tính năng thanh toán tức thì hiện đã hoạt động trên toàn Việt Nam thông qua VietQR (MBBank / Napas 24/7). Cổng thanh toán thẻ quốc tế (Visa, Mastercard, Apple Pay) đang được hoàn tất kiểm thử và sẽ chính thức mở cổng trong đợt phát hành tới. Đăng ký thông tin dưới đây để nhận thông báo ưu tiên ngay khi thẻ USD sẵn sàng."
                      : "Instant checkout is currently live across Vietnam via VietQR. Global card processing (Visa, Mastercard, Apple Pay) is launching shortly. Leave your email below to receive priority access and exclusive early-bird benefits the moment international checkout opens."}
                  </p>

                  {intentSubmitted ? (
                    <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-start gap-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <div className="text-left space-y-0.5">
                        <div className="font-bold">
                          {isVi ? "Đã ghi nhận đăng ký thành công!" : "You're on the global waitlist!"}
                        </div>
                        <p className="text-[11px] font-normal text-emerald-700 dark:text-emerald-400">
                          {isVi
                            ? "Đội ngũ Clutch Arena sẽ gửi thông báo kích hoạt ưu tiên đến bạn ngay khi cổng thẻ USD được mở."
                            : "The Clutch Arena team will notify you immediately once global card checkout is live."}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const contact = earlyContact.trim() || user?.email || "";
                        if (
                          selectedPlan.id === "cram_pass" ||
                          selectedPlan.id === "pro" ||
                          selectedPlan.id === "pro_monthly" ||
                          selectedPlan.id === "tutor"
                        ) {
                          sendSmokeTestTelemetry(
                            selectedPlan.id,
                            "early_access_requested",
                            contact,
                          );
                        }
                        setIntentSubmitted(true);
                      }}
                      className="space-y-3 pt-1 text-left"
                    >
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={earlyContact}
                          onChange={(e) => setEarlyContact(e.target.value)}
                          placeholder={
                            user?.email || (isVi ? "Zalo / Số ĐT / Email của bạn" : "Your email address or contact")
                          }
                          maxLength={160}
                          className="flex-1 px-3.5 py-2 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-2xs"
                        />
                        <Button
                          type="submit"
                          className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 px-4 rounded-xl cursor-pointer shadow-xs whitespace-nowrap"
                        >
                          {isVi ? "Tham gia danh sách chờ thẻ USD" : "Join Global USD Card Waitlist"}
                        </Button>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-stone-500">
                        <CreditCard size={13} className="text-stone-400 shrink-0" />
                        <span>
                          {isVi
                            ? "Sắp hỗ trợ: Visa, Mastercard, Apple Pay & Google Pay"
                            : "Upcoming: Visa, Mastercard, Apple Pay & Google Pay"}
                        </span>
                      </div>
                    </form>
                  )}
                </div>

                <p className="text-[11px] text-stone-500 flex items-center justify-center gap-1.5 pt-1">
                  <ShieldCheck size={13} className="text-emerald-600 shrink-0" />
                  <span>
                    {isVi
                      ? "Bảo mật chuẩn mã hóa quốc tế · Đảm bảo quyền lợi học viên Clutch Arena"
                      : "Enterprise-grade encryption · Student priority protection"}
                  </span>
                </p>
              </div>
            )}

            {!paymentSuccess && isVnCheckout && (
              <div className="mt-5 pt-4 border-t border-stone-200 dark:border-stone-800">
                <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40">
                  {intentSubmitted ? (
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 size={16} className="shrink-0" />
                      <span>
                        {isVi
                          ? "Đã ghi nhận đăng ký! Đội ngũ Clutch Arena sẽ liên hệ kích hoạt quyền ưu tiên thử nghiệm cho bạn trong 24h."
                          : "Request received! The Clutch Arena team will prioritize early-access activation for you within 24h."}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                          <Sparkles size={13} className="text-amber-600" />
                          {isVi
                            ? "Đăng ký mở khóa thử nghiệm kỳ thi giữa kỳ"
                            : "Early-Access Pilot Request"}
                        </span>
                        <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wider">
                          {isVi ? "Thử nghiệm 48h" : "48h Pilot"}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-snug">
                        {isVi
                          ? "Cần mở khóa gấp cho đợt ôn thi tuần này? Để lại Zalo hoặc Email để nhận slot hỗ trợ trực tiếp từ ban phát triển."
                          : "Need immediate unlock for midterms this week? Leave your Zalo or Email for direct pilot access."}
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={earlyContact}
                          onChange={(e) => setEarlyContact(e.target.value)}
                          placeholder={
                            isVi ? "Zalo / Số ĐT / Email của bạn" : "Your Zalo / Phone / Email"
                          }
                          maxLength={160}
                          className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (
                              selectedPlan.id === "cram_pass" ||
                              selectedPlan.id === "pro" ||
                              selectedPlan.id === "pro_monthly"
                            ) {
                              sendSmokeTestTelemetry(
                                selectedPlan.id,
                                "early_access_requested",
                                earlyContact,
                              );
                              setIntentSubmitted(true);
                            }
                          }}
                          className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shrink-0 cursor-pointer"
                        >
                          {isVi ? "Đăng ký thử nghiệm" : "Request Access"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* 5-Plan Comparison Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 xl:gap-3.5 2xl:gap-4">
            {PRICING_PLANS.map((plan) => {
              const isCurrent = tier === plan.id;
              const isRecommended = plan.id === "pro";
              const isIncluded =
                (plan.id === "contender" && tier !== "contender") ||
                (tier === "tutor" &&
                  (plan.id === "cram_pass" || plan.id === "pro_monthly" || plan.id === "pro")) ||
                (tier === "pro" &&
                  (plan.id === "cram_pass" || plan.id === "pro_monthly"));
              const isButtonDisabled = isCurrent || Boolean(plan.comingSoon) || isIncluded;

              const buttonLabel = plan.comingSoon
                ? isVi
                  ? "Sắp ra mắt"
                  : "Coming Soon"
                : isCurrent
                  ? isVi
                    ? "Đang sử dụng"
                    : "Current Tier"
                  : plan.id === "contender"
                    ? isVi
                      ? "Gói cơ bản"
                      : "Included"
                    : tier === "tutor" &&
                        (plan.id === "cram_pass" || plan.id === "pro_monthly" || plan.id === "pro")
                      ? isVi
                        ? "Đã có trong gói Giảng Viên"
                        : "Included in Tutor"
                      : tier === "pro" &&
                          (plan.id === "cram_pass" || plan.id === "pro_monthly")
                        ? isVi
                          ? "Đã có trong gói Pro"
                          : "Included in Pro"
                        : isVi
                          ? "Mở khóa ngay"
                          : "Unlock Now";

              let badgeLabel: string | null = null;
              if (plan.id === "cram_pass") {
                badgeLabel = isVi ? "Nước rút 48h" : "48h Exam Sprint";
              } else if (plan.id === "pro") {
                badgeLabel = "Best Value";
              } else if (plan.comingSoon) {
                badgeLabel = isVi ? plan.badgeVi ?? "Sắp ra mắt" : plan.badgeEn ?? "Coming Soon";
              } else if (plan.badgeEn) {
                badgeLabel = isVi ? plan.badgeVi ?? plan.badgeEn : plan.badgeEn;
              }

              const regionalPrice = getPlanRegionalPrice(plan.id, billingRegion);
              const priceRaw = regionalPrice.formatted;
              const displayPrice = priceRaw.includes("/")
                ? priceRaw.split("/")[0]
                : priceRaw;
              const displayUnit =
                plan.cycle === "free"
                  ? isVi
                    ? "/ Vĩnh viễn"
                    : "/ Forever"
                  : plan.cycle === "one_time"
                    ? isVi
                      ? "/ 7 ngày"
                      : "/ 7 days"
                    : plan.cycle === "semester"
                      ? isVi
                        ? "/ Kỳ"
                        : "/ Sem"
                      : isVi
                        ? "/ Tháng"
                        : "/ Mo";

              return (
                <div
                  key={plan.id}
                  className={`tier-card relative flex flex-col justify-between p-3.5 sm:p-4 2xl:p-5 rounded-2xl border transition-all min-w-0 overflow-hidden ${
                    isRecommended
                      ? "border-amber-400 dark:border-amber-500/70 bg-gradient-to-b from-amber-50/70 to-white dark:from-amber-950/20 dark:to-stone-900 shadow-md ring-1 ring-amber-300 dark:ring-amber-500/30"
                      : "border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 shadow-xs"
                  }`}
                >
                  <div>
                    {/* Top row: badge & icon */}
                    <div className="flex items-center justify-between h-6 mb-2">
                      {badgeLabel ? (
                        <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500 text-stone-950 shadow-xs whitespace-nowrap">
                          {badgeLabel}
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="text-stone-400 dark:text-stone-500 shrink-0">
                        {plan.id === "tutor" ? (
                          <Users size={17} />
                        ) : plan.id === "pro" ? (
                          <Zap size={17} className="text-amber-500 fill-amber-500/20" />
                        ) : plan.id === "pro_monthly" ? (
                          <Sparkles size={17} className="text-amber-500" />
                        ) : plan.id === "cram_pass" ? (
                          <Flame size={17} className="text-amber-600 fill-amber-600/20" />
                        ) : (
                          <Layers3 size={17} />
                        )}
                      </div>
                    </div>

                    <h3 className="font-extrabold text-base sm:text-[17px] 2xl:text-lg text-stone-900 dark:text-stone-100 tracking-tight leading-snug">
                      {isVi ? plan.nameVi : plan.nameEn}
                    </h3>

                    <p className="text-xs text-stone-500 dark:text-stone-400 min-h-[36px] line-clamp-2 leading-relaxed mt-1">
                      {isVi ? plan.taglineVi : plan.taglineEn}
                    </p>

                    {/* Price Tag Box */}
                    <div className="my-3 py-2 px-2.5 rounded-xl bg-stone-50 dark:bg-stone-800/40 border border-stone-200/70 dark:border-stone-800">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-xl sm:text-2xl font-black text-stone-900 dark:text-stone-50 tracking-tight whitespace-nowrap">
                          {displayPrice}
                        </span>
                        <span className="text-[10px] sm:text-[11px] font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wide whitespace-nowrap">
                          {displayUnit}
                        </span>
                      </div>

                      {plan.id === "pro" && (
                        <div className="mt-1">
                          <span className="inline-flex items-center text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                            {billingRegion === "VN"
                              ? isVi
                                ? "Tiết kiệm 31%"
                                : "Save 31%"
                              : isVi
                                ? "Tiết kiệm 27%"
                                : "Save 27%"}
                          </span>
                        </div>
                      )}

                      <div className="text-[10px] text-stone-500 dark:text-stone-400 font-medium mt-0.5">
                        {plan.id === "pro"
                          ? isVi
                            ? "Trọn kỳ học 4 tháng"
                            : "Full 4-month semester"
                          : plan.cycle === "free"
                            ? isVi
                              ? "Không cần tài khoản thẻ"
                              : "No credit card required"
                            : plan.cycle === "one_time"
                              ? isVi
                                ? "Mua 1 lần · Không gia hạn"
                                : "One-time pass · No renew"
                              : plan.id === "pro_monthly"
                                ? isVi
                                  ? "Hủy đăng ký bất cứ lúc nào"
                                  : "Cancel anytime"
                                : isVi
                                  ? "Hủy đăng ký bất cứ lúc nào"
                                  : "Cancel anytime"}
                      </div>
                    </div>

                    {/* Features list */}
                    <ul className="space-y-2 text-xs text-stone-600 dark:text-stone-300 mb-4">
                      {(isVi ? plan.featuresVi : plan.featuresEn).map((feat, i) => (
                        <li key={i} className="flex items-start gap-1.5 leading-snug">
                          <Check
                            size={14}
                            className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                          />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    onClick={() => handleSelectPlan(plan)}
                    disabled={isButtonDisabled}
                    variant={isRecommended && !isButtonDisabled ? "dark" : "outline"}
                    className={`w-full text-xs font-bold py-2.5 rounded-xl mt-2 transition-all shadow-xs ${
                      isButtonDisabled
                        ? "opacity-60 cursor-not-allowed bg-stone-100 dark:bg-stone-800 text-stone-500 border-stone-200 dark:border-stone-700"
                        : "cursor-pointer"
                    } ${
                      isRecommended && !isButtonDisabled
                        ? "bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                        : ""
                    }`}
                  >
                    {buttonLabel}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Earn-Your-Pass Viral Section */}
        <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 shrink-0">
              <Gift size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <strong className="text-sm font-bold text-stone-900 dark:text-stone-100">
                  {isVi ? "Kiếm lượt Remix miễn phí với 0đ" : "Earn Free Concept Remix Runs ($0 CAC)"}
                </strong>
                {referrals.unlockedRemixRuns > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {referrals.unlockedRemixRuns} {isVi ? "lượt khả dụng" : "runs unlocked"}
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-600 dark:text-stone-400 mt-0.5">
                {isVi
                  ? "Mở phòng đấu 4 người hoặc mời 3 bạn cùng lớp nhập mã bộ đề của bạn để nhận ngay 3 lượt Biến thể Concept Remix!"
                  : "Host a 4-player /arena match or have 3 classmates import your shared pack to unlock 3 free Concept Remix runs instantly."}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Guarantee */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 text-[11px] text-stone-500 flex flex-col gap-2">
          <div className="flex items-start gap-1.5 bg-emerald-50/70 dark:bg-emerald-950/20 p-2.5 rounded-lg border border-emerald-200/60 dark:border-emerald-800/40 text-stone-700 dark:text-stone-300">
            <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold text-emerald-900 dark:text-emerald-200 block mb-0.5">
                {isVi
                  ? "Cam kết trích dẫn nguyên văn 100% từ tài liệu của bạn — Hoàn tiền ngay nếu AI tự bịa kiến thức ngoài giáo trình."
                  : "100% Verbatim Citation Guarantee — Every question & formula links to your exact slide/page, or get a full refund."}
              </strong>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span>
                {isVi
                  ? "Không tự động trừ tiền kỳ tiếp theo khi mua Vé Ôn Thi Cấp Tốc."
                  : "No surprise subscription renewals on Cram Passes. Cancel anytime on recurring."}
              </span>
            </div>
            <div>
              Clutch Arena · {isVi ? "Ôn thi chủ động" : "Active Recall & Grounded Learning"}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-100 dark:border-stone-800 text-[10px] text-stone-400 dark:text-stone-500">
            <div className="flex items-center gap-2.5">
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              >
                {t.pricing.termsOfService}
              </a>
              <span>•</span>
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              >
                {t.pricing.privacyPolicy}
              </a>
            </div>
            <span>
              {isVi
                ? "Tuân thủ NĐ 13/2023/NĐ-CP & Quy định NHNN"
                : "Decree 13/2023/ND-CP & SBV Compliant"}
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
