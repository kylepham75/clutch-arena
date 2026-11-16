"use client";

import { LogIn, Zap, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import {
  useUserTier,
  computeProfileQuotaSummary,
  type ProfileQuotaSummary,
} from "@/hooks/use-user-tier";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { TIER_LIMITS, type UserTier } from "@/lib/pricing/tiers";

function getQuotaToneStyle(tone: ProfileQuotaSummary["statusTone"]) {
  if (tone === "critical") {
    return {
      color: "#b91c1c",
      barColor: "#dc2626",
      background: "rgba(220, 38, 38, 0.12)",
      border: "1px solid rgba(220, 38, 38, 0.25)",
    };
  }
  if (tone === "caution") {
    return {
      color: "#b45309",
      barColor: "#d97706",
      background: "rgba(217, 119, 6, 0.14)",
      border: "1px solid rgba(217, 119, 6, 0.28)",
    };
  }
  return {
    color: "#15803d",
    barColor: "#16a34a",
    background: "rgba(22, 163, 74, 0.12)",
    border: "1px solid rgba(22, 163, 74, 0.25)",
  };
}

function QuotaStatusBadges({
  quota,
  isVi,
  windowHours,
}: {
  quota: ProfileQuotaSummary;
  isVi: boolean;
  windowHours: number;
}) {
  const toneStyle = getQuotaToneStyle(quota.statusTone);
  const pct = Math.max(0, Math.min(100, quota.remainingPct));
  const tooltip = [`${quota.quotaLabel} (${windowHours}h)`, quota.resetCountdown]
    .filter(Boolean)
    .join(" • ");

  return (
    <>
      <span
        style={{
          fontSize: "0.6875rem",
          background: toneStyle.background,
          color: toneStyle.color,
          border: toneStyle.border,
          fontWeight: 700,
          padding: "0.1rem 0.4rem",
          borderRadius: "4px",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
        }}
        title={tooltip}
      >
        <span
          aria-hidden="true"
          style={{
            width: "24px",
            height: "5px",
            borderRadius: "9999px",
            background: "rgba(0, 0, 0, 0.1)",
            overflow: "hidden",
            display: "inline-block",
          }}
        >
          <span
            style={{
              display: "block",
              width: `${pct}%`,
              height: "100%",
              background: toneStyle.barColor,
              borderRadius: "9999px",
            }}
          />
        </span>
        <span>{pct}% ({windowHours}h)</span>
      </span>
      {quota.isDegraded && (
        <span
          style={{
            fontSize: "0.6875rem",
            background: "rgba(217, 119, 6, 0.14)",
            color: "#b45309",
            fontWeight: 600,
            padding: "0.1rem 0.35rem",
            borderRadius: "4px",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.15rem",
          }}
          title={isVi ? "Chế độ Tiết kiệm" : "Eco Mode"}
        >
          <Zap size={10} />
          {isVi ? "Tiết kiệm" : "Eco"}
        </span>
      )}
    </>
  );
}

function getTierBadgeText(tier: UserTier, isVi: boolean): string {
  if (tier === "cram_pass") return isVi ? "Vé Cấp Tốc" : "7-Day Cram Pass";
  if (tier === "pro_monthly") return isVi ? "Pro Tháng" : "Clutch Pro";
  if (tier === "pro") return isVi ? "Pro Học Kỳ" : "Clutch Pro";
  if (tier === "tutor") return "Tutor & Guild";
  return isVi ? "Thách Đấu" : "Contender";
}

function getCompactCountdown(hours: number | null, isVi: boolean): string | null {
  if (hours === null) return null;
  if (hours <= 0) return isVi ? "Hết hạn" : "Expired";
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function UserProfileButton({
  variant = "default",
}: {
  variant?: "topbar" | "sidebar" | "default";
}) {
  const { user, openAuthModal } = useAuth();
  const { tier: userTier, tierExpiresAt, hoursRemaining, quotaState } = useUserTier();
  const { t, language } = useLanguage();
  const isVi = language === "vi";

  const quotaSummary = computeProfileQuotaSummary(userTier, quotaState, isVi);
  const quota = quotaSummary;
  const primaryWindowHours =
    TIER_LIMITS[userTier]?.rollingQuota.primaryWindowHours ?? 24;
  const tierBadgeLabel = getTierBadgeText(userTier, isVi);
  const compactCountdown = getCompactCountdown(hoursRemaining, isVi);

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={() => openAuthModal()}
        aria-haspopup="dialog"
        aria-label={user ? (t.auth.myAccount || "Manage Account") : t.auth.signInTab}
        title={user ? (t.auth.myAccount || "Account settings") : t.auth.signInTab}
        className="local-profile"
        style={{
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <div
          className="profile-avatar"
          style={{
            background: user ? "#b83811" : undefined,
            color: user ? "#fff" : undefined,
          }}
        >
          {user?.email ? user.email.charAt(0).toUpperCase() : "⚡"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: "block", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
            {user?.email ? user.email.split("@")[0] : t.auth.guestStudent}
          </strong>
          {user ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.2rem" }}>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    background:
                      userTier === "tutor" || userTier === "pro" || userTier === "pro_monthly"
                        ? "rgba(184, 56, 17, 0.12)"
                        : userTier === "cram_pass"
                          ? "rgba(217, 119, 6, 0.14)"
                          : "rgba(100, 116, 139, 0.12)",
                    color:
                      userTier === "tutor" || userTier === "pro" || userTier === "pro_monthly"
                        ? "#8a270b"
                        : userTier === "cram_pass"
                          ? "#b45309"
                          : "#475569",
                    fontWeight: 700,
                    padding: "0.1rem 0.35rem",
                    borderRadius: "4px",
                    textTransform: "uppercase",
                  }}
                >
                  {tierBadgeLabel}
                </span>
                {compactCountdown && (
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      background: "rgba(234, 88, 12, 0.12)",
                      color: "#c2410c",
                      fontWeight: 600,
                      padding: "0.1rem 0.35rem",
                      borderRadius: "4px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.2rem",
                    }}
                    title={tierExpiresAt ? new Date(tierExpiresAt).toLocaleString() : undefined}
                  >
                    <Clock size={10} />
                    {compactCountdown}
                  </span>
                )}
                <QuotaStatusBadges quota={quota} isVi={isVi} windowHours={primaryWindowHours} />
              </div>
              {quota.resetCountdown && (
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "#5a654f",
                    marginTop: "0.15rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.2rem",
                  }}
                >
                  <Clock size={10} />
                  <span>{quota.resetCountdown}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.2rem" }}>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    background: "rgba(100, 116, 139, 0.12)",
                    color: "#475569",
                    fontWeight: 700,
                    padding: "0.1rem 0.35rem",
                    borderRadius: "4px",
                    textTransform: "uppercase",
                  }}
                >
                  {t.auth.guestBadge}
                </span>
                <QuotaStatusBadges quota={quotaSummary} isVi={isVi} windowHours={primaryWindowHours} />
              </div>
              {quotaSummary.resetCountdown && (
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "#5a654f",
                    marginTop: "0.15rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.2rem",
                  }}
                >
                  <Clock size={10} />
                  <span>{quotaSummary.resetCountdown}</span>
                </div>
              )}
            </>
          )}
        </div>
      </button>
    );
  }

  // Topbar variant
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => openAuthModal()}
      aria-haspopup="dialog"
      aria-label={user ? (t.auth.myAccount || "Manage Account") : t.auth.signInTab}
      title={user ? (t.auth.myAccount || "Account settings") : t.auth.signInTab}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        height: "2.125rem",
        padding: "0 0.75rem",
        borderRadius: "0.5rem",
        fontSize: "0.8125rem",
        background: user ? "rgba(184, 56, 17, 0.08)" : "#ffffff",
        borderColor: user ? "rgba(184, 56, 17, 0.28)" : "#d8dfd0",
        color: user ? "#8a270b" : "#242e1d",
        cursor: "pointer",
      }}
    >
      {user ? (
        <>
          <div
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#b83811",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.6875rem",
              fontWeight: 700,
            }}
          >
            {user.email ? user.email.charAt(0).toUpperCase() : "U"}
          </div>
          <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.email?.split("@")[0]}
          </span>
          <span
            style={{
              fontSize: "0.6875rem",
              background:
                userTier === "tutor" || userTier === "pro" || userTier === "pro_monthly"
                  ? "rgba(184, 56, 17, 0.12)"
                  : userTier === "cram_pass"
                    ? "rgba(217, 119, 6, 0.14)"
                    : "rgba(100, 116, 139, 0.12)",
              color:
                userTier === "tutor" || userTier === "pro" || userTier === "pro_monthly"
                  ? "#8a270b"
                  : userTier === "cram_pass"
                    ? "#b45309"
                    : "#475569",
              fontWeight: 700,
              padding: "0.1rem 0.35rem",
              borderRadius: "4px",
              textTransform: "uppercase",
            }}
          >
            {tierBadgeLabel}
          </span>
          {compactCountdown && (
            <span
              style={{
                fontSize: "0.6875rem",
                background: "rgba(234, 88, 12, 0.12)",
                color: "#c2410c",
                fontWeight: 600,
                padding: "0.1rem 0.35rem",
                borderRadius: "4px",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.2rem",
              }}
              title={tierExpiresAt ? new Date(tierExpiresAt).toLocaleString() : undefined}
            >
              <Clock size={10} />
              {compactCountdown}
            </span>
          )}
          <QuotaStatusBadges quota={quota} isVi={isVi} windowHours={primaryWindowHours} />
        </>
      ) : (
        <>
          <LogIn size={14} style={{ color: "#b83811" }} />
          <span>{t.auth.signInTab}</span>
          <QuotaStatusBadges quota={quotaSummary} isVi={isVi} windowHours={primaryWindowHours} />
        </>
      )}
    </Button>
  );
}
