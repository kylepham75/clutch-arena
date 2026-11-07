"use client";

import { useState, useEffect } from "react";
import { User, LogIn, Sparkles, Zap, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useUserTier, computeProfileQuotaSummary } from "@/hooks/use-user-tier";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { readLibrary, LIBRARY_UPDATED_EVENT } from "@/lib/game/library";
import type { UserTier } from "@/lib/pricing/tiers";

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
  const { user, guestUsageCount, guestLimit, openAuthModal } = useAuth();
  const { tier: userTier, tierExpiresAt, hoursRemaining } = useUserTier();
  const { t, language } = useLanguage();
  const isVi = language === "vi";

  const [libraryCount, setLibraryCount] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return readLibrary().length;
  });

  useEffect(() => {
    const update = () => {
      setLibraryCount(readLibrary().length);
    };
    update();
    window.addEventListener(LIBRARY_UPDATED_EVENT, update);
    return () => {
      window.removeEventListener(LIBRARY_UPDATED_EVENT, update);
    };
  }, []);

  const quota = computeProfileQuotaSummary(userTier, libraryCount, 0, isVi);
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
              <span
                style={{
                  fontSize: "0.6875rem",
                  color: "#5a654f",
                  fontWeight: 600,
                }}
              >
                {quota.deckCreditsRemaining}/{quota.deckCreditsTotal} {isVi ? "đề" : "decks"}
              </span>
            </div>
          ) : (
            <small style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span />
              {`${t.auth.guestBadge} (${guestUsageCount}/${guestLimit} ${t.auth.usedWord})`}
            </small>
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
          <span
            style={{
              fontSize: "0.6875rem",
              background: "rgba(90, 101, 79, 0.1)",
              color: "#3f4737",
              fontWeight: 600,
              padding: "0.1rem 0.35rem",
              borderRadius: "4px",
            }}
          >
            {quota.deckCreditsRemaining}/{quota.deckCreditsTotal} {isVi ? "đề" : "decks"}
          </span>
        </>
      ) : (
        <>
          <LogIn size={14} style={{ color: "#b83811" }} />
          <span>{t.auth.signInTab}</span>
          <span
            style={{
              fontSize: "0.75rem",
              color: guestUsageCount >= guestLimit ? "#b91c1c" : "#5a654f",
              fontWeight: 500,
            }}
          >
            ({guestUsageCount}/{guestLimit})
          </span>
        </>
      )}
    </Button>
  );
}
