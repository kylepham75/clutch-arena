import type { SupabaseClient } from "@supabase/supabase-js";
import * as supabaseServer from "@/lib/supabase/server";

/**
 * Resolves the privileged admin Supabase client when available (`getSupabaseAdminClient`),
 * falling back to `getSupabaseServerClient(token)` so partial test mocks of `@/lib/supabase/server`
 * remain compatible without triggering Vitest missing-export Proxy errors.
 */
export function getSupabaseAdminOrServerClient(token?: string): SupabaseClient | null {
  if (Object.keys(supabaseServer).includes("getSupabaseAdminClient")) {
    const adminFn = (
      supabaseServer as {
        getSupabaseAdminClient?: () => SupabaseClient | null;
      }
    ).getSupabaseAdminClient;
    if (typeof adminFn === "function") {
      const admin = adminFn();
      if (admin) return admin;
    }
  }
  return supabaseServer.getSupabaseServerClient(token);
}
