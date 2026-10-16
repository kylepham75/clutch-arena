import { createIngestionHandler } from "@/lib/ingestion/handler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = createIngestionHandler();
