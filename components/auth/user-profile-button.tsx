"use client";

import { User, LogIn, Sparkles, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { Button } from "@/components/ui/button";

export function UserProfileButton({
  variant = "default",
}: {
  variant?: "topbar" | "sidebar" | "default";
}) {
  const { user, tier, guestUsageCount, guestLimit, openAuthModal } = useAuth();

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
            background: user ? "linear-gradient(135deg, #ee714c, #f3c77b)" : undefined,
            color: user ? "#000" : undefined,
          }}
        >
          {user?.email ? user.email.charAt(0).toUpperCase() : "⚡"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: "block", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
            {user?.email ? user.email.split("@")[0] : "Guest Student"}
          </strong>
          <small style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span />
            {user ? `${tier.toUpperCase()} Account` : `Guest (${guestUsageCount}/${guestLimit} used)`}
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
        background: user ? "rgba(238, 113, 76, 0.12)" : "rgba(255, 255, 255, 0.04)",
        borderColor: user ? "rgba(238, 113, 76, 0.35)" : "rgba(255, 255, 255, 0.1)",
        color: user ? "#f3c77b" : "#e4e4e7",
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
              background: "#ee714c",
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
              fontSize: "0.625rem",
              background: "rgba(238, 113, 76, 0.25)",
              color: "#ee714c",
              fontWeight: 700,
              padding: "0.1rem 0.35rem",
              borderRadius: "4px",
              textTransform: "uppercase",
            }}
          >
            {tier}
          </span>
        </>
      ) : (
        <>
          <LogIn size={14} style={{ color: "#ee714c" }} />
          <span>Sign In</span>
          <span
            style={{
              fontSize: "0.6875rem",
              color: guestUsageCount >= guestLimit ? "#ff7b72" : "#a1a1aa",
            }}
          >
            ({guestUsageCount}/{guestLimit})
          </span>
        </>
      )}
    </Button>
  );
}
