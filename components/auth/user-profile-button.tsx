"use client";

import { User, LogIn, Sparkles, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useUserTier } from "@/hooks/use-user-tier";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";

export function UserProfileButton({
  variant = "default",
}: {
  variant?: "topbar" | "sidebar" | "default";
}) {
  const { user, guestUsageCount, guestLimit, openAuthModal } = useAuth();
  const { tier: userTier } = useUserTier();
  const { t } = useLanguage();

  const displayTier = user ? (userTier === "contender" ? t.auth.freeBadge : userTier.toUpperCase()) : t.auth.guestBadge;

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={() => openAuthModal()}
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
          <small style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span />
            {user ? `${displayTier} ${t.auth.accountSuffix}` : `${t.auth.guestBadge} (${guestUsageCount}/${guestLimit} ${t.auth.usedWord})`}
          </small>
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
              background: "rgba(184, 56, 17, 0.12)",
              color: "#8a270b",
              fontWeight: 700,
              padding: "0.1rem 0.35rem",
              borderRadius: "4px",
              textTransform: "uppercase",
            }}
          >
            {displayTier}
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
