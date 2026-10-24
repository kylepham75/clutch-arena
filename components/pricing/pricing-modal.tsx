"use client";

import { useState } from "react";
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
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";
import {
  PRICING_PLANS,
  type UserTier,
  type PlanPricing,
} from "@/lib/pricing/tiers";
import { useUserTier } from "@/hooks/use-user-tier";

export function PricingModal({
  open,
  onClose,
  initialReason,
}: {
  open: boolean;
  onClose: () => void;
  initialReason?: string | null;
}) {
  const { language } = useLanguage();
  const { tier, setTier, referrals, daysRemaining, refreshTier } = useUserTier();

  const [currency, setCurrency] = useState<"vnd" | "usd">(() =>
    language === "vi" ? "vnd" : "usd",
  );
  const [selectedPlan, setSelectedPlan] = useState<PlanPricing | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [earlyContact, setEarlyContact] = useState("");
  const [intentSubmitted, setIntentSubmitted] = useState(false);

  const isVi = language === "vi" || currency === "vnd";

  const sendSmokeTestTelemetry = (
    planId: "cram_pass" | "pro" | "tutor",
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

  const handleSelectPlan = (plan: PlanPricing) => {
    if (plan.comingSoon || plan.id === "tutor") return;
    if (plan.id === "contender") {
      setTier("contender");
      onClose();
      return;
    }
    if (plan.id === "cram_pass" || plan.id === "pro") {
      sendSmokeTestTelemetry(plan.id, "plan_selected");
    }
    setSelectedPlan(plan);
    setPaymentSuccess(false);
    setVerificationError(null);
    setEarlyContact("");
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
      selectedPlan.id === "tutor"
    ) {
      sendSmokeTestTelemetry(selectedPlan.id, "verify_clicked");
    }
    setSimulating(true);
    setVerificationError(null);
    try {
      const updated = await refreshTier();
      if (updated === selectedPlan.id || updated === "pro" || updated === "cram_pass") {
        setPaymentSuccess(true);
        setTimeout(() => {
          onClose();
          setSelectedPlan(null);
          setPaymentSuccess(false);
        }, 2000);
      } else {
        setVerificationError(
          isVi
            ? "Hệ thống chưa ghi nhận giao dịch của bạn. Vui lòng đăng nhập và hoàn tất chuyển khoản đúng nội dung, hoặc liên hệ hỗ trợ."
            : "Payment not yet confirmed by the server. Please ensure you are signed in and have completed checkout.",
        );
      }
    } finally {
      setSimulating(false);
    }
  };

  const transferNote = selectedPlan
    ? `CLUTCH ${selectedPlan.id.toUpperCase()} ${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    : "CLUTCH CRAM 8888";
  const bankAccount = "0388291888";
  const bankName = "MBBank (Ngân hàng Quân Đội)";
  const accountHolder = "CLUTCH ARENA VN";

  const vietQrUrl = selectedPlan
    ? `https://img.vietqr.io/image/MB-${bankAccount}-compact2.png?amount=${selectedPlan.priceVnd}&addInfo=${encodeURIComponent(
        transferNote,
      )}&accountName=${encodeURIComponent(accountHolder)}`
    : "";

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
          ? "Giá địa phương hóa theo sức mua (PPP) - Không lo gia hạn thẻ tín dụng."
          : "Localized student pricing with instant scan-to-pay & one-time passes.")
      }
    >
      <div className="pricing-modal-container w-full text-stone-900 dark:text-stone-100">
        {/* Single Unified Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-4 mb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-2.5 py-0.5 rounded-full">
                <Flame size={13} />
                {isVi ? "Bảng Giá Chuẩn PPP Sinh Viên" : "PPP-Adjusted Student Pricing"}
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
                  ? "Giá địa phương hóa theo sức mua (PPP) - Không lo gia hạn thẻ tín dụng."
                  : "Localized student pricing with instant scan-to-pay & one-time passes.")}
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
            {/* Currency selector */}
            <div className="flex items-center bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCurrency("vnd")}
                className={`px-2.5 py-1 rounded transition-all ${
                  currency === "vnd"
                    ? "bg-white dark:bg-stone-900 text-amber-700 dark:text-amber-400 shadow-xs font-bold"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                🇻🇳 VND (đ)
              </button>
              <button
                type="button"
                onClick={() => setCurrency("usd")}
                className={`px-2.5 py-1 rounded transition-all ${
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
              onClick={() => setSelectedPlan(null)}
              className="text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 mb-3 flex items-center gap-1"
            >
              ← {isVi ? "Quay lại danh sách gói" : "Back to all plans"}
            </button>

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
            ) : currency === "vnd" ? (
              /* Vietnam VietQR Checkout */
              <div className="vietqr-checkout grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="flex flex-col items-center justify-center p-4 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800 shadow-sm text-center">
                  <div className="flex items-center gap-2 mb-2">
                    <QrCode size={18} className="text-amber-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                      Quét mã VietQR (MoMo, ZaloPay, Mọi Ngân Hàng)
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={vietQrUrl}
                    alt="VietQR Payment Code"
                    className="w-56 h-auto rounded-lg border border-stone-100 dark:border-stone-800"
                    loading="lazy"
                  />
                  <span className="text-[11px] text-stone-500 mt-2 flex items-center gap-1">
                    <Clock size={12} />
                    Xác nhận tự động trong 3 giây
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="p-3 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800">
                    <div className="text-xs text-stone-500 font-medium">Gói đăng ký</div>
                    <div className="text-base font-bold text-amber-700 dark:text-amber-400">
                      {selectedPlan.nameVi} · {selectedPlan.priceVndFormatted}
                      {selectedPlan.cycle === "semester"
                        ? " / 4 tháng"
                        : selectedPlan.cycle === "monthly"
                          ? " / tháng"
                          : ""}
                    </div>
                  </div>

                  <div className="p-3 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-stone-500">Ngân hàng:</span>
                      <span className="font-semibold">{bankName}</span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-stone-500">Số tài khoản:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-stone-900 dark:text-stone-100">
                          {bankAccount}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(bankAccount, "acc")}
                          className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded text-stone-500"
                          title="Sao chép số tài khoản"
                        >
                          {copiedField === "acc" ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-stone-500">Chủ tài khoản:</span>
                      <span className="font-semibold">{accountHolder}</span>
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-stone-100 dark:border-stone-800">
                      <span className="text-stone-500">Nội dung chuyển khoản:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                          {transferNote}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(transferNote, "note")}
                          className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded text-stone-500"
                          title="Sao chép nội dung"
                        >
                          {copiedField === "note" ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {verificationError && (
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                      {verificationError}
                    </div>
                  )}

                  <Button
                    onClick={handleVerifyPayment}
                    disabled={simulating}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-sm"
                  >
                    {simulating ? "Đang kiểm tra xác thực giao dịch..." : "Kiểm tra trạng thái thanh toán"}
                  </Button>
                  <p className="text-[11px] text-center text-stone-500">
                    Bảo mật 100% · Hệ thống tự động kích hoạt sau khi ngân hàng xác nhận giao dịch.
                  </p>
                </div>
              </div>
            ) : (
              /* Global USD Checkout */
              <div className="global-usd-checkout max-w-md mx-auto text-center space-y-4 py-4">
                <div className="p-4 bg-white dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800">
                  <span className="text-xs text-stone-500 font-medium">Selected Plan</span>
                  <div className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">
                    {selectedPlan.nameEn}
                  </div>
                  <div className="text-2xl font-bold text-stone-900 dark:text-stone-100 mt-0.5">
                    {selectedPlan.priceUsdFormatted}
                    <span className="text-sm font-semibold text-stone-500 ml-1">
                      {selectedPlan.cycle === "semester"
                        ? "/ 4 months"
                        : selectedPlan.cycle === "monthly"
                          ? "/ mo"
                          : ""}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500 mt-1">
                    {selectedPlan.cycle === "one_time" ? "One-time purchase · No subscription" : "Billed automatically"}
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2 text-stone-500 text-xs font-medium">
                  <CreditCard size={15} />
                  <span>Apple Pay · Google Pay · Credit & Debit Cards</span>
                </div>

                {verificationError && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                    {verificationError}
                  </div>
                )}

                <Button
                  onClick={handleVerifyPayment}
                  disabled={simulating}
                  className="w-full bg-stone-900 dark:bg-amber-500 dark:text-stone-950 text-white hover:bg-stone-800 font-bold py-3 rounded-xl shadow-sm flex items-center justify-center gap-2"
                >
                  {simulating ? "Verifying payment status..." : "Verify Payment / Check Status"}
                  <ExternalLink size={15} />
                </Button>

                <p className="text-[11px] text-stone-500 flex items-center justify-center gap-1">
                  <ShieldCheck size={13} className="text-emerald-600" />
                  Processed securely by LemonSqueezy Merchant of Record. Tax compliant.
                </p>
              </div>
            )}

            {!paymentSuccess && (
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
                          placeholder={isVi ? "Zalo / Số ĐT / Email của bạn" : "Your Zalo / Phone / Email"}
                          maxLength={160}
                          className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (selectedPlan.id === "cram_pass" || selectedPlan.id === "pro") {
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
          /* 4-Tier Grid Comparison */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PRICING_PLANS.map((plan) => {
              const isCurrent = tier === plan.id;
              const isRecommended = plan.recommended;

              return (
                <div
                  key={plan.id}
                  className={`tier-card relative flex flex-col justify-between p-4 sm:p-5 rounded-2xl border transition-all ${
                    isRecommended
                      ? "border-amber-400 dark:border-amber-500/70 bg-gradient-to-b from-amber-50/70 to-white dark:from-amber-950/20 dark:to-stone-900 shadow-md ring-1 ring-amber-300 dark:ring-amber-500/30"
                      : "border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 shadow-xs"
                  }`}
                >
                  <div>
                    {/* Top row: badge & icon */}
                    <div className="flex items-center justify-between h-6 mb-2">
                      {plan.badgeEn ? (
                        <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500 text-stone-950 shadow-xs whitespace-nowrap">
                          {isVi ? plan.badgeVi : plan.badgeEn}
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="text-stone-400 dark:text-stone-500 shrink-0">
                        {plan.id === "tutor" ? (
                          <Users size={17} />
                        ) : plan.id === "pro" ? (
                          <Zap size={17} className="text-amber-500 fill-amber-500/20" />
                        ) : plan.id === "cram_pass" ? (
                          <Flame size={17} className="text-amber-600 fill-amber-600/20" />
                        ) : (
                          <Layers3 size={17} />
                        )}
                      </div>
                    </div>

                    <h3 className="font-extrabold text-base sm:text-lg text-stone-900 dark:text-stone-100 tracking-tight">
                      {isVi ? plan.nameVi : plan.nameEn}
                    </h3>

                    <p className="text-xs text-stone-500 dark:text-stone-400 min-h-[34px] line-clamp-2 leading-relaxed mt-1">
                      {isVi ? plan.taglineVi : plan.taglineEn}
                    </p>

                    {/* Price Tag Box */}
                    <div className="my-3 py-2 px-2.5 rounded-xl bg-stone-50 dark:bg-stone-800/40 border border-stone-200/70 dark:border-stone-800">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-xl sm:text-2xl font-black text-stone-900 dark:text-stone-50 tracking-tight whitespace-nowrap">
                          {currency === "vnd" ? plan.priceVndFormatted : plan.priceUsdFormatted}
                        </span>
                        <span className="text-[10px] font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
                          {plan.cycle === "free"
                            ? isVi ? "/ Vĩnh viễn" : "/ Forever"
                            : plan.cycle === "one_time"
                              ? isVi ? "/ 7 ngày" : "/ 7 days"
                              : plan.cycle === "semester"
                                ? isVi ? "/ 4 tháng" : "/ 4 months"
                                : isVi ? "/ Tháng" : "/ Month"}
                        </span>
                      </div>
                      <div className="text-[10px] text-stone-500 dark:text-stone-400 font-medium mt-0.5">
                        {plan.cycle === "free"
                          ? isVi ? "Không cần tài khoản thẻ" : "No credit card required"
                          : plan.cycle === "one_time"
                            ? isVi ? "Mua 1 lần · Không gia hạn" : "One-time pass · No renew"
                            : plan.cycle === "semester"
                              ? isVi ? "Trọn kỳ học (tiết kiệm 25%)" : "Full semester pass (save 25%)"
                              : isVi ? "Hủy đăng ký bất cứ lúc nào" : "Cancel anytime"}
                      </div>
                    </div>

                    {/* Features list */}
                    <ul className="space-y-2 text-xs text-stone-600 dark:text-stone-300 mb-4">
                      {(isVi ? plan.featuresVi : plan.featuresEn).map((feat, i) => (
                        <li key={i} className="flex items-start gap-1.5 leading-snug">
                          <Check size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    onClick={() => handleSelectPlan(plan)}
                    disabled={isCurrent || Boolean(plan.comingSoon)}
                    variant={isRecommended ? "dark" : "outline"}
                    className={`w-full text-xs font-bold py-2.5 rounded-xl mt-2 transition-all shadow-xs ${
                      isRecommended
                        ? "bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                        : ""
                    }`}
                  >
                    {plan.comingSoon
                      ? isVi ? "Sắp ra mắt" : "Coming Soon"
                      : isCurrent
                        ? isVi ? "Đang sử dụng" : "Current Tier"
                        : plan.id === "contender"
                          ? isVi ? "Sử dụng miễn phí" : "Start Free"
                          : isVi ? "Mở khóa ngay" : "Unlock Now"}
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
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 text-[11px] text-stone-500 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span>
              {isVi
                ? "Không tự động trừ tiền kỳ tiếp theo khi mua Vé Ôn Thi Cấp Tốc."
                : "No surprise subscription renewals on Cram Passes. Cancel anytime on recurring."}
            </span>
          </div>
          <div>
            Clutch Arena · {isVi ? "Ôn thi chủ động chuẩn PPP" : "Active Recall & Grounded Learning"}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
