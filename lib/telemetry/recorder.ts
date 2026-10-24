import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { TelemetryEvent } from "@/lib/schemas/telemetry";

export type TimestampedTelemetryEvent = TelemetryEvent & {
  recordedAt: string;
};

const MAX_RING_BUFFER_SIZE = 100;
let ringBuffer: TimestampedTelemetryEvent[] = [];

export function getRecentTelemetryEvents(): TimestampedTelemetryEvent[] {
  return [...ringBuffer];
}

export function clearRecentTelemetryEvents(): void {
  ringBuffer = [];
}

// In-memory sliding-window rate limit store for telemetry
interface TelemetryRateRecord {
  timestamps: number[];
}
const rateLimitStore = new Map<string, TelemetryRateRecord>();

export function checkTelemetryRateLimit(
  ip: string,
  limit = 20,
  windowMs = 10 * 60 * 1000,
): { allowed: boolean; retryAfter: number } {
  const normalizedIp = ip || "unknown";
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitStore.get(normalizedIp);
  if (!record) {
    record = { timestamps: [] };
    rateLimitStore.set(normalizedIp, record);
  }

  // Filter out expired timestamps
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return {
      allowed: false,
      retryAfter,
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    retryAfter: 0,
  };
}

export function resetTelemetryRateLimits(): void {
  rateLimitStore.clear();
}

function formatTelemetryWebhookSummary(
  event: TelemetryEvent,
  meta?: { userId?: string | null; ip?: string },
): string {
  const parts: string[] = [];
  const userTag = meta?.userId ? `User: \`${meta.userId}\`` : "User: `anonymous`";
  const ipTag = meta?.ip ? ` | IP: \`${meta.ip}\`` : "";

  if (event.kind === "feedback") {
    parts.push(`📢 **[Clutch Telemetry - Feedback]** (${event.category})`);
    parts.push(`${userTag}${ipTag}`);
    if (event.rating) {
      parts.push(`Rating: ${"⭐".repeat(event.rating)} (${event.rating}/5)`);
    }
    if (event.contact) {
      parts.push(`Contact: ${event.contact}`);
    }
    parts.push(`Message:\n> ${event.message.replace(/\n/g, "\n> ")}`);
    if (event.context) {
      const ctx = event.context;
      const ctxItems: string[] = [];
      if (ctx.packTitle) ctxItems.push(`Pack: ${ctx.packTitle}`);
      if (ctx.questionId) ctxItems.push(`Q: ${ctx.questionId}`);
      if (ctx.planId) ctxItems.push(`Plan: ${ctx.planId}`);
      if (ctx.tier) ctxItems.push(`Tier: ${ctx.tier}`);
      if (ctx.language) ctxItems.push(`Lang: ${ctx.language}`);
      if (ctxItems.length) parts.push(`Context: ${ctxItems.join(" | ")}`);
    }
  } else if (event.kind === "smoke_test_intent") {
    parts.push(`🎯 **[Clutch Telemetry - Smoke Test Intent]**`);
    parts.push(`${userTag}${ipTag}`);
    parts.push(
      `Plan: **${event.planId}** (${event.currency.toUpperCase()}) | Action: \`${event.action}\``,
    );
    if (event.contact) {
      parts.push(`Contact: ${event.contact}`);
    }
    if (event.language) {
      parts.push(`Language: ${event.language}`);
    }
  } else if (event.kind === "citation_rejection") {
    parts.push(`⚠️ **[Clutch Telemetry - Citation Rejection]**`);
    parts.push(`Reason: \`${event.reason}\``);
    if (event.documentTitle) parts.push(`Document: ${event.documentTitle}`);
    if (event.sourceKind) parts.push(`Source Kind: ${event.sourceKind}`);
    if (event.sourceId) parts.push(`Source ID: ${event.sourceId}`);
    if (event.questionId) parts.push(`Question ID: ${event.questionId}`);
    if (event.excerptPreview) parts.push(`Excerpt: "${event.excerptPreview}"`);
    if (typeof event.totalSources === "number") {
      parts.push(`Total Sources: ${event.totalSources}`);
    }
  }

  return parts.join("\n");
}

export async function recordTelemetryEvent(
  event: TelemetryEvent,
  meta?: {
    userId?: string | null;
    token?: string;
    ip?: string;
    supabaseClient?: SupabaseClient | null;
    webhookUrl?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<{ recorded: boolean; persistedToSupabase: boolean; relayedToWebhook: boolean }> {
  let recorded = false;
  let persistedToSupabase = false;
  let relayedToWebhook = false;

  try {
    const timestamped: TimestampedTelemetryEvent = {
      ...event,
      recordedAt: new Date().toISOString(),
    };

    ringBuffer.push(timestamped);
    if (ringBuffer.length > MAX_RING_BUFFER_SIZE) {
      ringBuffer.shift();
    }
    recorded = true;

    if (process.env.NODE_ENV !== "test") {
      console.info("[pilot-telemetry]", JSON.stringify(timestamped));
    }
  } catch {
    // Ring buffer push failed unexpectedly
  }

  // Best-effort Supabase insert into "pilot_telemetry"
  try {
    const supabase =
      meta?.supabaseClient !== undefined
        ? meta.supabaseClient
        : getSupabaseServerClient(meta?.token);

    if (supabase) {
      const category =
        event.kind === "feedback"
          ? event.category
          : event.kind === "smoke_test_intent"
            ? event.action
            : event.reason;
      const message = event.kind === "feedback" ? event.message : null;
      const contact = "contact" in event ? (event.contact ?? null) : null;

      const { error } = await supabase.from("pilot_telemetry").insert({
        user_id: meta?.userId ?? null,
        event_kind: event.kind,
        category,
        message,
        contact,
        payload: event,
      });

      if (!error) {
        persistedToSupabase = true;
      }
    }
  } catch {
    persistedToSupabase = false;
  }

  // Best-effort webhook POST to meta?.webhookUrl ?? process.env.FEEDBACK_WEBHOOK_URL
  try {
    const webhookUrl = meta?.webhookUrl ?? process.env.FEEDBACK_WEBHOOK_URL;
    if (webhookUrl && webhookUrl.trim().length > 0) {
      const fetchImpl = meta?.fetchImpl ?? fetch;
      const content = formatTelemetryWebhookSummary(event, meta);

      const timeoutSignal =
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(3000)
          : undefined;

      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: timeoutSignal,
      });

      if (res.ok) {
        relayedToWebhook = true;
      }
    }
  } catch {
    relayedToWebhook = false;
  }

  return {
    recorded,
    persistedToSupabase,
    relayedToWebhook,
  };
}
