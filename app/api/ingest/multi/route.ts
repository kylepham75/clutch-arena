import "@/lib/polyfills/pdf-node-polyfills";
import { createMultiIngestionHandler } from "@/lib/ingestion/multi-handler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = createMultiIngestionHandler();
