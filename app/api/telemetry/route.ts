import { createTelemetryHandler } from "@/lib/telemetry/handler";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createTelemetryHandler();
