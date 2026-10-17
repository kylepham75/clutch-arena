"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type AccountTier = "guest" | "free" | "pro";

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  tier: AccountTier;
  guestUsageCount: number;
  guestLimit: number;
  canGenerate: boolean;
  incrementGuestUsage: () => number;
  authModalOpen: boolean;
  authModalReason: string | null;
  openAuthModal: (reason?: string) => void;
  closeAuthModal: () => void;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithOAuth: (provider: "google" | "github") => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const GUEST_USAGE_KEY = "clutch:guest_usage:v1";
const GUEST_LIMIT = 2; // 2 free study pack generations for anonymous users

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestUsageCount, setGuestUsageCount] = useState<number>(0);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState<string | null>(null);

  const isConfigured = isSupabaseConfigured();

  // Load guest usage from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GUEST_USAGE_KEY);
      if (stored) {
        setGuestUsageCount(Math.max(0, parseInt(stored, 10) || 0));
      }
    } catch {
      // Storage unavailable
    }
  }, []);

  // Listen to Supabase Auth State
  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    // Listen to changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isConfigured]);

  const incrementGuestUsage = useCallback(() => {
    const next = guestUsageCount + 1;
    setGuestUsageCount(next);
    try {
      localStorage.setItem(GUEST_USAGE_KEY, next.toString());
    } catch {
      // ignore
    }
    return next;
  }, [guestUsageCount]);

  const openAuthModal = useCallback((reason?: string) => {
    setAuthModalReason(reason || null);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setAuthModalReason(null);
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        return { error: new Error("Authentication is not configured.") };
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) {
        closeAuthModal();
      }
      return { error };
    },
    [closeAuthModal],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        return { error: new Error("Authentication is not configured.") };
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      return { error };
    },
    [],
  );

  const signInWithOAuth = useCallback(async (provider: "google" | "github") => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return { error: new Error("Authentication is not configured.") };
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
  }, []);

  // Determine user tier
  const tier: AccountTier = user ? "free" : "guest";

  // Guest users can generate up to GUEST_LIMIT packs without signing in
  const canGenerate = Boolean(user) || guestUsageCount < GUEST_LIMIT;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isConfigured,
        tier,
        guestUsageCount,
        guestLimit: GUEST_LIMIT,
        canGenerate,
        incrementGuestUsage,
        authModalOpen,
        authModalReason,
        openAuthModal,
        closeAuthModal,
        signInWithEmail,
        signUpWithEmail,
        signInWithOAuth,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
