import { createCoachHandler } from "@/lib/coach/handler";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createCoachHandler();
