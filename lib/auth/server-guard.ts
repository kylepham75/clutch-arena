import "server-only";
import { getSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export type AuthVerificationResult =
  | {
      authenticated: true;
      user: User;
      tier: "free" | "pro";
    }
  | {
      authenticated: false;
      isGuest: true;
      devMode: boolean;
    };

export async function verifyAuthToken(request: Request): Promise<AuthVerificationResult> {
  const isConfigured = isSupabaseServerConfigured();
  if (!isConfigured) {
    // If Supabase is not configured, permit dev/offline guest runs seamlessly
    return {
      authenticated: false,
      isGuest: true,
      devMode: true,
    };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authenticated: false,
      isGuest: true,
      devMode: false,
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return {
      authenticated: false,
      isGuest: true,
      devMode: false,
    };
  }

  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return {
        authenticated: false,
        isGuest: true,
        devMode: true,
      };
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return {
        authenticated: false,
        isGuest: true,
        devMode: false,
      };
    }

    // Default authenticated tier is "free" (can be upgraded based on user metadata or stripe subscription)
    const tier = (user.user_metadata?.tier as "free" | "pro") || "free";

    return {
      authenticated: true,
      user,
      tier,
    };
  } catch {
    return {
      authenticated: false,
      isGuest: true,
      devMode: false,
    };
  }
}
