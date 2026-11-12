"use client";

import { useState, useEffect } from "react";
import {
  Sparkles,
  Lock,
  Mail,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Zap,
  ArrowRight,
  Trash2,
  AlertTriangle,
  Loader2,
  Clock,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import {
  useUserTier,
  formatPassCountdown,
  computeProfileQuotaSummary,
  type ProfileQuotaSummary,
} from "@/hooks/use-user-tier";
import { useLanguage } from "@/lib/i18n/context";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { clearSessionLibrary } from "@/lib/game/library";
import { clearSessionHistory } from "@/lib/game/history";
import { clearSessionMastery } from "@/lib/game/concept-mastery";
import { clearStoredUserTier, type BillingRegion } from "@/lib/pricing/tiers";
import { getBillingRegionClient, getPlanRegionalPrice } from "@/lib/pricing/region";
import { PricingModal } from "@/components/pricing/pricing-modal";

function getQuotaToneStyle(tone: ProfileQuotaSummary["statusTone"]) {
  if (tone === "critical") {
    return {
      textColor: "#b91c1c",
      barGradient: "linear-gradient(90deg, #dc2626, #ef4444)",
    };
  }
  if (tone === "caution") {
    return {
      textColor: "#b45309",
      barGradient: "linear-gradient(90deg, #d97706, #f59e0b)",
    };
  }
  return {
    textColor: "#15803d",
    barGradient: "linear-gradient(90deg, #16a34a, #22c55e)",
  };
}

export function AuthDialog() {
  const {
    user,
    session,
    authModalOpen,
    authModalReason,
    closeAuthModal,
    isConfigured,
    signInWithEmail,
    signUpWithEmail,
    signInWithOAuth,
    signOut,
  } = useAuth();
  const { tier: userTier, tierExpiresAt, quotaState, refreshTier, refreshQuota } = useUserTier();
  const { t, language } = useLanguage();
  const isVi = language === "vi";

  const [region, setRegion] = useState<BillingRegion>(() => getBillingRegionClient());

  useEffect(() => {
    setRegion(getBillingRegionClient());
  }, []);

  const proPrice = getPlanRegionalPrice("pro", region);

  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pricingModalOpen, setPricingModalOpen] = useState(false);

  useEffect(() => {
    if (authModalOpen) {
      void refreshTier();
      void refreshQuota();
    }
  }, [authModalOpen, refreshTier, refreshQuota]);

  const quotaSummary = computeProfileQuotaSummary(userTier, quotaState, isVi);
  const quotaTone = getQuotaToneStyle(quotaSummary.statusTone);
  const remainingPct = Math.max(0, Math.min(100, quotaSummary.remainingPct));
  const countdownText = formatPassCountdown(tierExpiresAt, isVi);
  const formattedExpDate = tierExpiresAt
    ? new Date(tierExpiresAt).toLocaleDateString(isVi ? "vi-VN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        headers,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || (isVi ? "Xoá tài khoản thất bại." : "Failed to delete account."));
      }

      clearSessionLibrary();
      clearSessionHistory();
      clearSessionMastery();
      clearStoredUserTier();

      await signOut();
      setShowDeleteConfirm(false);
      closeAuthModal();

      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert(
          isVi
            ? "Tài khoản và toàn bộ dữ liệu học tập của bạn đã được xoá vĩnh viễn theo Nghị định 13 & GDPR."
            : "Your account and all associated study data have been permanently deleted in accordance with Vietnam Decree 13 & GDPR."
        );
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMsg(t.auth.enterBothEmailPassword);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    if (tab === "signin") {
      const { error } = await signInWithEmail(email.trim(), password);
      setLoading(false);
      if (error) {
        setErrorMsg(error.message || t.auth.signInError);
      } else {
        closeAuthModal();
      }
    } else {
      const { error } = await signUpWithEmail(email.trim(), password);
      setLoading(false);
      if (error) {
        setErrorMsg(error.message || t.auth.signUpError);
      } else {
        setSuccessMsg(t.auth.signUpSuccess);
        setTab("signin");
      }
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    setLoading(true);
    setErrorMsg(null);
    const { error } = await signInWithOAuth(provider);
    if (error) {
      setLoading(false);
      setErrorMsg(error.message || t.auth.oauthError);
    }
  };

  return (
    <>
      <Dialog
        open={authModalOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeAuthModal();
          setErrorMsg(null);
          setSuccessMsg(null);
          setShowDeleteConfirm(false);
          setDeleteError(null);
        }
      }}
      title={user ? t.auth.myAccount : tab === "signin" ? t.auth.signInTitle : t.auth.createAccountTitle}
      description={
        user
          ? t.auth.accountDesc
          : t.auth.guestDesc
      }
    >
      <div className="auth-dialog-body" style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginTop: "1rem" }}>
        {/* Guest Limit Alert Banner */}
        {!user && authModalReason === "guest_limit_reached" && (
          <div
            style={{
              padding: "0.875rem 1rem",
              borderRadius: "0.5rem",
              background: "rgba(238, 113, 76, 0.12)",
              border: "1px solid rgba(238, 113, 76, 0.35)",
              color: "#c25430",
              fontSize: "0.875rem",
              display: "flex",
              alignItems: "flex-start",
              gap: "0.625rem",
            }}
          >
            <Zap size={18} style={{ color: "var(--primary, #e96943)", flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", color: "var(--foreground, #292c28)", marginBottom: "0.15rem" }}>
                {t.auth.guestLimitTitle}
              </strong>
              <span style={{ color: "var(--foreground, #292c28)", opacity: 0.85 }}>
                {t.auth.guestLimitDesc}
              </span>
            </div>
          </div>
        )}

        {/* Not Configured Notice (Local dev) */}
        {!isConfigured && (
          <div
            style={{
              padding: "0.875rem 1rem",
              borderRadius: "0.5rem",
              background: "var(--muted, #eef0e9)",
              border: "1px solid var(--border, #e2e5dc)",
              fontSize: "0.8125rem",
              color: "var(--muted-foreground, #666)",
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: "var(--foreground, #292c28)", display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>
              {t.auth.localDevMode}
            </strong>
            {t.auth.localDevNote}
          </div>
        )}

        {/* Already Logged In View */}
        {user ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: "1rem",
                borderRadius: "0.75rem",
                background: "var(--muted, #eef0e9)",
                border: "1px solid var(--border, #e2e5dc)",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--primary, #e96943), #f3c77b)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "1.25rem",
                }}
              >
                {user.email ? user.email.charAt(0).toUpperCase() : "U"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <strong style={{ color: "var(--foreground, #292c28)", fontSize: "0.9375rem" }}>
                    {user.email}
                  </strong>
                  <span
                    style={{
                      background:
                        userTier === "tutor" || userTier === "pro" || userTier === "pro_monthly"
                          ? "rgba(233, 105, 67, 0.18)"
                          : userTier === "cram_pass"
                            ? "rgba(245, 158, 11, 0.18)"
                            : "rgba(100, 116, 139, 0.15)",
                      color:
                        userTier === "tutor" || userTier === "pro" || userTier === "pro_monthly"
                          ? "var(--primary, #e96943)"
                          : userTier === "cram_pass"
                            ? "#d97706"
                            : "#64748b",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      padding: "0.15rem 0.5rem",
                      borderRadius: "100px",
                      textTransform: "uppercase",
                    }}
                  >
                    {quotaSummary.tierLabel}
                  </span>
                </div>
                <small style={{ color: "var(--muted-foreground, #666)", fontSize: "0.75rem" }}>
                  {t.auth.userIdLabel} {user.id.slice(0, 12)}...
                </small>
              </div>
            </div>

            {/* Plan Tier & Active Expiry Banner */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.75rem",
              }}
            >
              <div
                style={{
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  background: "var(--muted, #eef0e9)",
                  border: "1px solid var(--border, #e2e5dc)",
                }}
              >
                <div style={{ color: "var(--muted-foreground, #666)", fontSize: "0.75rem" }}>{t.auth.cloudSync}</div>
                <strong style={{ color: "#2e7d32", fontSize: "0.875rem" }}>{t.auth.activeStatus}</strong>
              </div>
              <div
                style={{
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  background: "var(--muted, #eef0e9)",
                  border: "1px solid var(--border, #e2e5dc)",
                }}
              >
                <div style={{ color: "var(--muted-foreground, #666)", fontSize: "0.75rem" }}>{t.auth.planTier}</div>
                <strong style={{ color: "var(--primary, #e96943)", fontSize: "0.875rem" }}>
                  {quotaSummary.tierLabel}
                </strong>
              </div>
            </div>

            {/* Live Pass Expiry Countdown Card */}
            {tierExpiresAt && (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "0.5rem",
                  background: "rgba(233, 105, 67, 0.08)",
                  border: "1px solid rgba(233, 105, 67, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Clock size={16} style={{ color: "var(--primary, #e96943)", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground, #666)" }}>
                      {isVi ? "Hạn sử dụng gói" : "Pass Expiration"}
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "var(--foreground, #292c28)", fontWeight: 600 }}>
                      {formattedExpDate}
                    </div>
                  </div>
                </div>
                {countdownText && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      padding: "0.2rem 0.55rem",
                      borderRadius: "9999px",
                      background: "rgba(233, 105, 67, 0.15)",
                      color: "var(--primary, #e96943)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {countdownText}
                  </span>
                )}
              </div>
            )}

            {/* Antigravity-style Rolling AI Quota Meter */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.625rem",
                padding: "0.875rem 1rem",
                borderRadius: "0.75rem",
                background: "var(--muted, #eef0e9)",
                border: "1px solid var(--border, #e2e5dc)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  fontSize: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                  <span style={{ fontWeight: 700, color: "var(--foreground, #292c28)" }}>
                    {isVi ? "Hạn mức AI" : "AI Quota"}
                  </span>
                  {quotaSummary.isDegraded && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.2rem",
                        fontSize: "0.6875rem",
                        fontWeight: 600,
                        padding: "0.1rem 0.45rem",
                        borderRadius: "9999px",
                        background: "rgba(217, 119, 6, 0.14)",
                        color: "#b45309",
                      }}
                    >
                      <Zap size={11} />
                      {isVi ? "Chế độ Tiết kiệm" : "Eco Mode"}
                    </span>
                  )}
                </div>
                <span
                  style={{ fontWeight: 700, color: quotaTone.textColor }}
                  title={quotaSummary.quotaLabel}
                >
                  {isVi ? `Còn ${remainingPct}%` : `${remainingPct}% remaining`}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={quotaSummary.quotaLabel}
                aria-valuenow={remainingPct}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  width: "100%",
                  height: "8px",
                  borderRadius: "9999px",
                  background: "rgba(0, 0, 0, 0.08)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${remainingPct}%`,
                    height: "100%",
                    background: quotaTone.barGradient,
                    borderRadius: "9999px",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              {quotaSummary.resetCountdown && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    fontSize: "0.75rem",
                    color: "var(--muted-foreground, #666)",
                  }}
                >
                  <Clock size={12} style={{ flexShrink: 0 }} />
                  <span>{quotaSummary.resetCountdown}</span>
                </div>
              )}
            </div>

            {/* 1-Click Upgrade to Semester Pro CTA Button */}
            {quotaSummary.showUpgradeToSemesterPro && (
              <Button
                type="button"
                onClick={() => {
                  closeAuthModal();
                  setPricingModalOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  background: "linear-gradient(135deg, #e96943 0%, #b83811 100%)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "0.5rem",
                  boxShadow: "0 4px 14px rgba(184, 56, 17, 0.25)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <Sparkles size={16} />
                <span>
                  {isVi
                    ? `Nâng cấp lên Đấu Sĩ Pro Học Kỳ (${proPrice.formatted})`
                    : `Upgrade to Semester Pro (${proPrice.formatted})`}
                </span>
                <ArrowRight size={16} />
              </Button>
            )}

            <Button
              variant="outline"
              onClick={signOut}
              disabled={deleting}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                marginTop: "0.25rem",
                color: "#4b5563",
                borderColor: "var(--border, #e2e5dc)",
              }}
            >
              <LogOut size={16} />
              <span>{t.auth.signOut}</span>
            </Button>

            <div
              style={{
                marginTop: "0.5rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid var(--border, #e2e5dc)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {deleteError && (
                <div
                  style={{
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.375rem",
                    background: "rgba(211, 47, 47, 0.1)",
                    border: "1px solid rgba(211, 47, 47, 0.3)",
                    color: "#d32f2f",
                    fontSize: "0.8125rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{deleteError}</span>
                </div>
              )}

              {!showDeleteConfirm ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleting}
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.5rem",
                      color: "#b91c1c",
                      borderColor: "rgba(185, 28, 28, 0.35)",
                      background: "rgba(185, 28, 28, 0.04)",
                      fontSize: "0.8125rem",
                    }}
                  >
                    <Trash2 size={15} />
                    <span>
                      {isVi ? "Xoá tài khoản & Dữ liệu học tập" : "Delete Account & Study Data"}
                    </span>
                  </Button>
                  <p
                    style={{
                      fontSize: "0.6875rem",
                      color: "var(--muted-foreground, #81857b)",
                      textAlign: "center",
                      lineHeight: 1.4,
                      margin: 0,
                    }}
                  >
                    {isVi
                      ? "Tuân thủ Nghị định 13/2023/NĐ-CP & GDPR Quyền được lãng quên (Right to be Forgotten)."
                      : "Compliant with Vietnam Decree 13/2023/ND-CP & GDPR Right to be Forgotten."}
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    padding: "0.875rem 1rem",
                    borderRadius: "0.5rem",
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem" }}>
                    <AlertTriangle size={18} style={{ color: "#dc2626", flexShrink: 0, marginTop: "2px" }} />
                    <div>
                      <strong
                        style={{
                          display: "block",
                          color: "#991b1b",
                          fontSize: "0.875rem",
                          marginBottom: "0.25rem",
                        }}
                      >
                        {isVi ? "Xác nhận xoá tài khoản vĩnh viễn" : "Confirm Permanent Account Deletion"}
                      </strong>
                      <p
                        style={{
                          color: "#7f1d1d",
                          fontSize: "0.8125rem",
                          lineHeight: 1.4,
                          margin: 0,
                        }}
                      >
                        {isVi
                          ? "Xoá vĩnh viễn tài khoản, các bộ đề đã tải lên và lịch sử ôn thi của bạn? Hành động này không thể hoàn tác."
                          : "Permanently delete your account, uploaded study packs, and exam history? This action cannot be undone."}
                      </p>
                      <small
                        style={{
                          display: "block",
                          color: "#991b1b",
                          fontSize: "0.6875rem",
                          marginTop: "0.35rem",
                          opacity: 0.85,
                        }}
                      >
                        {isVi
                          ? "Tuân thủ Nghị định 13/2023/NĐ-CP & GDPR (Quyền được lãng quên)"
                          : "Compliant with Vietnam Decree 13 & GDPR Right to be Forgotten"}
                      </small>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.25rem" }}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={deleting}
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteError(null);
                      }}
                      style={{ fontSize: "0.75rem" }}
                    >
                      {isVi ? "Huỷ bỏ" : "Cancel"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={deleting}
                      onClick={handleDeleteAccount}
                      style={{
                        background: "#dc2626",
                        color: "#fff",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                      }}
                    >
                      {deleting ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          <span>{isVi ? "Đang xoá..." : "Deleting..."}</span>
                        </>
                      ) : (
                        <>
                          <Trash2 size={13} />
                          <span>{isVi ? "Xoá vĩnh viễn" : "Permanently Delete"}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Sign In / Sign Up Forms */
          <>
            {/* Tabs */}
            <div
              style={{
                display: "flex",
                background: "var(--muted, #eef0e9)",
                padding: "0.25rem",
                borderRadius: "0.5rem",
                border: "1px solid var(--border, #e2e5dc)",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setTab("signin");
                  setErrorMsg(null);
                }}
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  borderRadius: "0.375rem",
                  border: "none",
                  background: tab === "signin" ? "var(--primary, #e96943)" : "transparent",
                  color: tab === "signin" ? "#fff" : "var(--muted-foreground, #666)",
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {t.auth.signInTab}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("signup");
                  setErrorMsg(null);
                }}
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  borderRadius: "0.375rem",
                  border: "none",
                  background: tab === "signup" ? "var(--primary, #e96943)" : "transparent",
                  color: tab === "signup" ? "#fff" : "var(--muted-foreground, #666)",
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {t.auth.signUpTab}
              </button>
            </div>

            {errorMsg && (
              <div
                style={{
                  padding: "0.625rem 0.875rem",
                  borderRadius: "0.375rem",
                  background: "rgba(211, 47, 47, 0.1)",
                  border: "1px solid rgba(211, 47, 47, 0.3)",
                  color: "#d32f2f",
                  fontSize: "0.8125rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div
                style={{
                  padding: "0.625rem 0.875rem",
                  borderRadius: "0.375rem",
                  background: "rgba(46, 125, 50, 0.1)",
                  border: "1px solid rgba(46, 125, 50, 0.3)",
                  color: "#2e7d32",
                  fontSize: "0.8125rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Social Logins */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <Button
                type="button"
                variant="outline"
                disabled={loading || !isConfigured}
                onClick={() => handleOAuth("google")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.625rem",
                  width: "100%",
                  color: "var(--foreground, #292c28)",
                  borderColor: "var(--border, #e2e5dc)",
                  background: "var(--background, #fff)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.4l3.7 2.9C6.5 7.4 9 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.6 14.7c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.4C.7 9.8 0 12 0 14.7s.7 4.9 1.9 7.3l3.7-2.9z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 17C3.7 20.8 7.5 23.5 12 23.5z"
                  />
                </svg>
                <span>{t.auth.continueGoogle}</span>
              </Button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                color: "var(--muted-foreground, #81857b)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
              }}
            >
              <span style={{ flex: 1, height: "1px", background: "var(--border, #e2e5dc)" }} />
              <span>{t.auth.orEmail}</span>
              <span style={{ flex: 1, height: "1px", background: "var(--border, #e2e5dc)" }} />
            </div>

            {/* Email Form */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--foreground, #292c28)",
                    marginBottom: "0.375rem",
                  }}
                >
                  {t.auth.emailLabel}
                </label>
                <div style={{ position: "relative" }}>
                  <Mail
                    size={15}
                    style={{
                      position: "absolute",
                      left: "0.75rem",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--muted-foreground, #81857b)",
                    }}
                  />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem 0.5rem 2.25rem",
                      borderRadius: "0.375rem",
                      background: "var(--background, #fff)",
                      border: "1px solid var(--border, #e2e5dc)",
                      color: "var(--foreground, #292c28)",
                      fontSize: "0.875rem",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--foreground, #292c28)",
                    marginBottom: "0.375rem",
                  }}
                >
                  {t.auth.passwordLabel}
                </label>
                <div style={{ position: "relative" }}>
                  <Lock
                    size={15}
                    style={{
                      position: "absolute",
                      left: "0.75rem",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--muted-foreground, #81857b)",
                    }}
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem 0.5rem 2.25rem",
                      borderRadius: "0.375rem",
                      background: "var(--background, #fff)",
                      border: "1px solid var(--border, #e2e5dc)",
                      color: "var(--foreground, #292c28)",
                      fontSize: "0.875rem",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading || !isConfigured}
                style={{
                  marginTop: "0.5rem",
                  background: "var(--primary, #e96943)",
                  color: "#fff",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                {loading ? (
                  <span>{t.auth.processing}</span>
                ) : (
                  <>
                    <span>{tab === "signin" ? t.auth.signInTab : t.auth.createFreeAccountBtn}</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </Button>
            </form>

            {/* Legal Notice */}
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--muted-foreground, #81857b)",
                textAlign: "center",
                lineHeight: 1.45,
                marginTop: "0.25rem",
              }}
            >
              {isVi ? "Bằng việc tiếp tục, bạn đồng ý với " : "By continuing, you agree to our "}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--primary, #e96943)",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                {t.auth.termsOfService}
              </a>
              {isVi ? " và " : " and "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--primary, #e96943)",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                {t.auth.privacyPolicy}
              </a>
              .
            </p>
          </>
        )}
      </div>
    </Dialog>
    <PricingModal
      open={pricingModalOpen}
      onClose={() => setPricingModalOpen(false)}
    />
  </>
);
}
