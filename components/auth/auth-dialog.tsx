"use client";

import { useState } from "react";
import {
  Sparkles,
  Lock,
  Mail,
  User,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Zap,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function AuthDialog() {
  const {
    user,
    tier,
    guestUsageCount,
    guestLimit,
    authModalOpen,
    authModalReason,
    closeAuthModal,
    isConfigured,
    signInWithEmail,
    signUpWithEmail,
    signInWithOAuth,
    signOut,
  } = useAuth();

  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    if (tab === "signin") {
      const { error } = await signInWithEmail(email.trim(), password);
      setLoading(false);
      if (error) {
        setErrorMsg(error.message || "Failed to sign in. Please verify your credentials.");
      } else {
        closeAuthModal();
      }
    } else {
      const { error } = await signUpWithEmail(email.trim(), password);
      setLoading(false);
      if (error) {
        setErrorMsg(error.message || "Failed to create account.");
      } else {
        setSuccessMsg(
          "Account created! Please check your email to verify your account, or sign in now.",
        );
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
      setErrorMsg(error.message || `Failed to sign in with ${provider}.`);
    }
  };

  return (
    <Dialog
      open={authModalOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeAuthModal();
          setErrorMsg(null);
          setSuccessMsg(null);
        }
      }}
      title={user ? "My Account" : tab === "signin" ? "Sign In to ClutchArena" : "Create a Free Account"}
      description={
        user
          ? "Manage your ClutchArena study account, quotas, and preferences."
          : "Sign in to save study packs across devices, track active recall progress, and compete in the arena."
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
              color: "#f3c77b",
              fontSize: "0.875rem",
              display: "flex",
              alignItems: "flex-start",
              gap: "0.625rem",
            }}
          >
            <Zap size={18} style={{ color: "#ee714c", flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", color: "#fff", marginBottom: "0.15rem" }}>
                Free Guest Quota Reached ({guestUsageCount}/{guestLimit})
              </strong>
              <span>
                You have used your 2 free anonymous generations. Create a free account to unlock continuous uploads, cloud deck saves, and multiplayer battles!
              </span>
            </div>
          </div>
        )}

        {/* Not Configured Notice (Local dev) */}
        {!isConfigured && (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              fontSize: "0.8125rem",
              color: "#a1a1aa",
            }}
          >
            <strong style={{ color: "#fff", display: "block", marginBottom: "0.25rem" }}>
              🛠️ Local Development Mode
            </strong>
            Supabase Auth credentials are not yet configured in <code>.env.local</code>. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable live cloud authentication.
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
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #ee714c, #f3c77b)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#000",
                  fontWeight: 700,
                  fontSize: "1.25rem",
                }}
              >
                {user.email ? user.email.charAt(0).toUpperCase() : "U"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <strong style={{ color: "#fff", fontSize: "0.9375rem" }}>
                    {user.email}
                  </strong>
                  <span
                    style={{
                      background: "rgba(238, 113, 76, 0.2)",
                      color: "#ee714c",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      padding: "0.15rem 0.5rem",
                      borderRadius: "100px",
                      textTransform: "uppercase",
                    }}
                  >
                    {tier}
                  </span>
                </div>
                <small style={{ color: "#a1a1aa", fontSize: "0.75rem" }}>
                  User ID: {user.id.slice(0, 12)}...
                </small>
              </div>
            </div>

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
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <div style={{ color: "#a1a1aa", fontSize: "0.75rem" }}>Cloud Sync</div>
                <strong style={{ color: "#66876a", fontSize: "0.875rem" }}>Active ✓</strong>
              </div>
              <div
                style={{
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <div style={{ color: "#a1a1aa", fontSize: "0.75rem" }}>Plan Tier</div>
                <strong style={{ color: "#f3c77b", fontSize: "0.875rem" }}>Clutch Free</strong>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={signOut}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                marginTop: "0.5rem",
                color: "#ff7b72",
                borderColor: "rgba(255, 123, 114, 0.3)",
              }}
            >
              <LogOut size={16} />
              <span>Sign Out</span>
            </Button>
          </div>
        ) : (
          /* Sign In / Sign Up Forms */
          <>
            {/* Tabs */}
            <div
              style={{
                display: "flex",
                background: "rgba(255, 255, 255, 0.04)",
                padding: "0.25rem",
                borderRadius: "0.5rem",
                border: "1px solid rgba(255, 255, 255, 0.08)",
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
                  background: tab === "signin" ? "#ee714c" : "transparent",
                  color: tab === "signin" ? "#fff" : "#a1a1aa",
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Sign In
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
                  background: tab === "signup" ? "#ee714c" : "transparent",
                  color: tab === "signup" ? "#fff" : "#a1a1aa",
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Create Account
              </button>
            </div>

            {errorMsg && (
              <div
                style={{
                  padding: "0.625rem 0.875rem",
                  borderRadius: "0.375rem",
                  background: "rgba(255, 100, 100, 0.12)",
                  border: "1px solid rgba(255, 100, 100, 0.3)",
                  color: "#ff7b72",
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
                  background: "rgba(102, 135, 106, 0.15)",
                  border: "1px solid rgba(102, 135, 106, 0.4)",
                  color: "#66876a",
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
                <span>Continue with Google</span>
              </Button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                color: "#71717a",
                fontSize: "0.75rem",
                textTransform: "uppercase",
              }}
            >
              <span style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.08)" }} />
              <span>Or with email</span>
              <span style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.08)" }} />
            </div>

            {/* Email Form */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#a1a1aa",
                    marginBottom: "0.375rem",
                  }}
                >
                  Email Address
                </label>
                <div style={{ position: "relative" }}>
                  <Mail
                    size={15}
                    style={{
                      position: "absolute",
                      left: "0.75rem",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#71717a",
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
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      color: "#fff",
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
                    color: "#a1a1aa",
                    marginBottom: "0.375rem",
                  }}
                >
                  Password
                </label>
                <div style={{ position: "relative" }}>
                  <Lock
                    size={15}
                    style={{
                      position: "absolute",
                      left: "0.75rem",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#71717a",
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
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      color: "#fff",
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
                  background: "#ee714c",
                  color: "#fff",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                {loading ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    <span>{tab === "signin" ? "Sign In" : "Create Free Account"}</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </Dialog>
  );
}
