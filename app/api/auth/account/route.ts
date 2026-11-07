import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const auth = await verifyAuthToken(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const userId = auth.user.id;
    const supabase = getSupabaseServerClient(auth.token);
    if (!supabase) {
      throw new Error("Supabase server client unavailable.");
    }

    // Cascade delete records
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
    const message = err instanceof Error ? err.message : "Failed to delete account";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
