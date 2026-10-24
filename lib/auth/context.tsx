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
import {
  fetchCloudLibrary,
  migrateGuestLibraryToUser,
  clearSessionLibrary,
} from "@/lib/game/library";
import {
  fetchCloudHistory,
  migrateGuestRunsToUser,
  clearSessionHistory,
} from "@/lib/game/history";
import {
  fetchCloudMastery,
  migrateGuestMasteryToUser,
  clearSessionMastery,
} from "@/lib/game/concept-mastery";
import {
  fetchCloudUserTier,
  clearStoredUserTier,
  getStoredUserTier,
  type UserTier,
} from "@/lib/pricing/tiers";

export type AccountTier = "guest" | "free" | "pro" | UserTier;

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
  const [syncedTier, setSyncedTier] = useState<UserTier>(() => getStoredUserTier());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState<string | null>(null);

  useEffect(() => {
    const handleTierUpdated = (e: Event) => {
      const custom = e as CustomEvent<{ tier: UserTier }>;
      if (custom.detail?.tier) {
        setSyncedTier(custom.detail.tier);
      }
    };
    window.addEventListener("clutch:tier_updated", handleTierUpdated);
    return () => window.removeEventListener("clutch:tier_updated", handleTierUpdated);
  }, []);

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

  // Listen to Supabase Auth State and sync user library
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

    // Handles smart deck migration vs existing account cloud sync
    const handleAuthLibrarySync = async (currentUser: User | null) => {
      if (!currentUser) {
        clearSessionLibrary();
        return;
      }

      // Check if this is a newly created account vs an existing account
      let isNewAccount = false;
      try {
        const flag = sessionStorage.getItem("clutch:just_signed_up");
        if (flag === "true") {
          isNewAccount = true;
          sessionStorage.removeItem("clutch:just_signed_up");
        }
      } catch {
        // sessionStorage unavailable
      }

      // If user was created within the last 60 seconds (e.g. fresh OAuth or Email sign up)
      if (!isNewAccount && currentUser.created_at) {
        const createdAtMs = new Date(currentUser.created_at).getTime();
        if (!isNaN(createdAtMs) && Date.now() - createdAtMs < 60_000) {
          isNewAccount = true;
        }
      }

      if (isNewAccount) {
        // Integrate guest decks, run history, and mastery created during anonymous trial into their new account
        await Promise.allSettled([
          migrateGuestLibraryToUser(currentUser.id),
          migrateGuestRunsToUser(currentUser.id),
          migrateGuestMasteryToUser(currentUser.id),
          fetchCloudUserTier(),
        ]);
      } else {
        // Existing account: Load ONLY this account's cloud decks, run history, mastery, and user tier.
        // Overwrites local storage so anonymous/guest decks do NOT pollute this account.
        await Promise.allSettled([
          fetchCloudLibrary(),
          fetchCloudHistory(),
          fetchCloudMastery(),
          fetchCloudUserTier(),
        ]);
      }
    };

    // Get initial session
    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        setSession(session);
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        setLoading(false);
        if (currentUser) {
          await handleAuthLibrarySync(currentUser);
        }
      })
      .catch(() => {
        setLoading(false);
      });

    // Listen to changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setLoading(false);

      if (event === "SIGNED_IN" && currentUser) {
        await handleAuthLibrarySync(currentUser);
      } else if (event === "SIGNED_OUT") {
        clearSessionLibrary();
        clearSessionHistory();
        clearSessionMastery();
        clearStoredUserTier();
      }
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
      try {
        sessionStorage.setItem("clutch:just_signed_up", "true");
      } catch {
        // sessionStorage unavailable
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
    clearSessionLibrary();
    clearSessionHistory();
    clearSessionMastery();
    setUser(null);
    setSession(null);
  }, []);

  // Determine user tier
  const tier: AccountTier = user ? (syncedTier === "contender" ? "free" : syncedTier) : "guest";

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
