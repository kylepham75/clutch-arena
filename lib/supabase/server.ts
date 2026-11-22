import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function isSupabaseServerConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

/**
 * Returns a strictly user-scoped Supabase server client initialized with the
 * public anon key and optional user JWT (`Authorization: Bearer <token>`),
 * guaranteeing PostgreSQL RLS policies are enforced.
 */
export function getSupabaseUserServerClient(token?: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers,
    },
  });
}

/**
 * Returns an explicit service-role Supabase admin client for privileged
 * server-only operations (payment webhooks, quota ledger writes, account
 * deletion, and telemetry persistence). Returns null when SUPABASE_SERVICE_ROLE_KEY
 * is not configured.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    if (!serviceRoleKey && process.env.NODE_ENV === "production") {
      console.warn(
        "[Supabase] Production Warning: SUPABASE_SERVICE_ROLE_KEY is missing. Privileged server operations will be unavailable.",
      );
    }
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Returns a user-scoped client whenever `token` is provided (enforcing RLS)
 * and falls back to the service-role admin client only when `token` is omitted.
 */
export function getSupabaseServerClient(token?: string): SupabaseClient | null {
  if (!isSupabaseServerConfigured()) {
    return null;
  }

  if (token) {
    return getSupabaseUserServerClient(token);
  }

  return getSupabaseAdminClient() ?? getSupabaseUserServerClient();
}
