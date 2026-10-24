import { NextResponse } from "next/server";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: SAMPLE_CLUTCH_NOTE,
  });
}
