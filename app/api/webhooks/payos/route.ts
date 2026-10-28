import { NextResponse } from "next/server";
import {
  fulfillPayosOrder,
  verifyPayosWebhookSignature,
} from "@/lib/payments/payos";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: -1, message: "Invalid JSON body", data: null },
        { status: 400 },
      );
    }

    const { code, data, signature } = body;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !signature ||
      typeof signature !== "string"
    ) {
      return NextResponse.json(
        { error: -1, message: "Missing webhook data or signature", data: null },
        { status: 400 },
      );
    }

    const webhookData = data as Record<string, unknown>;
    const isValid = verifyPayosWebhookSignature(webhookData, signature);
    if (!isValid) {
      return NextResponse.json(
        { error: -1, message: "Invalid webhook signature", data: null },
        { status: 400 },
      );
    }

    if (
      Number(webhookData.orderCode) === 123 ||
      webhookData.description === "VQRIO123"
    ) {
      return NextResponse.json(
        { error: 0, message: "Ok", data: null },
        { status: 200 },
      );
    }

    if (code === "00" && webhookData.orderCode) {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error(
          "[PayOS Webhook] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing in environment variables! Without this key, RLS will block background webhook fulfillment.",
        );
      }
      const orderCode = Number(webhookData.orderCode);
      const amount = Number(webhookData.amount);
      const res = await fulfillPayosOrder({
        orderCode,
        amount: Number.isFinite(amount) ? amount : undefined,
      });
      console.log("[PayOS Webhook] Fulfillment result for order", orderCode, res);
    }

    return NextResponse.json({ error: 0, message: "Ok", data: null });
  } catch (err) {
    return NextResponse.json(
      {
        error: -1,
        message:
          err instanceof Error ? err.message : "Webhook processing failed",
        data: null,
      },
      { status: 500 },
    );
  }
}
