import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getSupabaseAdminOrServerClient } from "@/lib/supabase/server-helpers";
import { invalidateUserQuotaLedgerCache } from "@/lib/rate-limit";
import { isAllowedOrigin } from "@/lib/utils";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    if (!isAllowedOrigin(request.headers.get("origin"), request)) {
      return NextResponse.json(
        { ok: false, error: "ORIGIN_NOT_ALLOWED" },
        { status: 403 },
      );
    }

    const auth = await verifyAuthToken(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401 },
      );
    }

    if (process.env.NODE_ENV === "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Account deletion requires SUPABASE_SERVICE_ROLE_KEY in production.");
    }

    const userId = auth.user.id;
    const supabase = getSupabaseAdminOrServerClient(auth.token);
    if (!supabase) {
      throw new Error("Supabase server client unavailable.");
    }

    // Purge non-FK quota ledger & telemetry tables first
    for (const key of [`user:${userId}`, userId]) {
      const ledgerRes = await supabase
        .from("user_quota_ledgers")
        .delete()
        .eq("user_id", key);
      if (ledgerRes?.error) {
        console.warn("[api/auth/account] user_quota_ledgers cleanup warning:", ledgerRes.error);
      }
    }

    const optionalUserTables = [
      { table: "pilot_telemetry", col: "user_id" },
      { table: "user_concept_mastery", col: "user_id" },
      { table: "user_subscriptions", col: "user_id" },
      { table: "user_profiles", col: "id" },
    ];
    for (const { table, col } of optionalUserTables) {
      const res = await supabase.from(table).delete().eq(col, userId);
      if (res?.error) {
        console.warn(`[api/auth/account] Optional table ${table} cleanup warning:`, res.error);
      }
    }

    // Cascade delete core tables (throws on failure)
    const { error: packsError } = await supabase
      .from("user_study_packs")
      .delete()
      .eq("user_id", userId);
    if (packsError) throw packsError;

    const { error: runsError } = await supabase
      .from("user_runs")
      .delete()
      .eq("user_id", userId);
    if (runsError) throw runsError;

    const { error: profilesError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profilesError) throw profilesError;

    await invalidateUserQuotaLedgerCache(userId);

    if (
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      typeof supabase.auth?.admin?.deleteUser === "function"
    ) {
      const { error: adminError } = await supabase.auth.admin.deleteUser(userId);
      if (adminError) throw adminError;
    }

    return NextResponse.json({
      ok: true,
      message: "Account and associated data deleted successfully.",
    });
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { route: "api/auth/account" },
    });
    console.error(
      "[api/auth/account] Account deletion failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { ok: false, error: "Failed to delete account. Please try again later." },
      { status: 500 },
    );
  }
}
