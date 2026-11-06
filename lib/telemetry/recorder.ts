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
export const MAX_RATE_LIMIT_IPS = 5000;

interface TelemetryRateRecord {
  timestamps: number[];
}
const rateLimitStore = new Map<string, TelemetryRateRecord>();

export function getTelemetryRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

export function checkTelemetryRateLimit(
  ip: string,
  limit = 20,
  windowMs = 10 * 60 * 1000,
  maxIps = MAX_RATE_LIMIT_IPS,
): { allowed: boolean; retryAfter: number } {
  const normalizedIp = ip || "unknown";
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitStore.get(normalizedIp);
  if (!record) {
    if (rateLimitStore.size >= maxIps) {
      // First sweep/evict expired entries across the store
      for (const [key, existing] of rateLimitStore.entries()) {
        existing.timestamps = existing.timestamps.filter((ts) => ts > windowStart);
        if (existing.timestamps.length === 0) {
          rateLimitStore.delete(key);
        }
      }

      // If still at capacity, evict the oldest entry via Map insertion order (FIFO)
      while (rateLimitStore.size >= maxIps) {
        const oldestKey = rateLimitStore.keys().next().value;
        if (oldestKey !== undefined) {
          rateLimitStore.delete(oldestKey);
        } else {
          break;
        }
      }
    }

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

/**
 * Sanitizes @everyone, @here, and Discord/Slack role/user mention tokens
 * so untrusted client telemetry fields cannot trigger mass pings.
 */
export function sanitizeWebhookMentions(text: string): string {
  if (!text) return "";
  return text
    .replace(/@(?!\u200b)(everyone|here)/gi, (_, mention) => `@\u200b${mention}`)
    .replace(/<@(?![\u200b])([^>]+)>/g, (_, target) => `<@\u200b${target}>`)
    .replace(/<!(?!\u200b)(channel|here|everyone)>/gi, (_, target) => `<!\u200b${target}>`);
}

/**
 * Strips/sanitizes newlines ([\r\n]+) in single-line header fields to prevent webhook header injection
 * and multi-line markdown abuse.
 */
export function sanitizeSingleLine(text: string): string {
  if (!text) return "";
  return text.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Escapes markdown link syntax (escape [ and ] to \[ and \]) so untrusted client telemetry
 * cannot inject deceptive markdown hyperlinks ([click here](phishing-url)) into webhook alerts.
 */
export function escapeMarkdownLinks(text: string): string {
  if (!text) return "";
  return text.replace(/\\?\[/g, "\\[").replace(/\\?\]/g, "\\]");
}

/**
 * Combined sanitizer for single-line header fields that flattens newlines and escapes markdown links.
 */
export function sanitizeHeaderField(text: string): string {
  if (!text) return "";
  return escapeMarkdownLinks(sanitizeSingleLine(text));
}

/**
 * Redacts contact PII (masks email as t***@example.com, and phone/identifiers as [REDACTED])
 * so personal user data is not dumped to server stdout logs.
 */
export function redactContact(contact: string): string {
  if (!contact) return "";
  const trimmed = contact.trim();
  if (!trimmed) return "";

  const emailMatch = trimmed.match(/^([^@]+)@(.+)$/);
  if (emailMatch) {
    const [_, user, domain] = emailMatch;
    return `${user.slice(0, 1)}***@${domain}`;
  }

  return "[REDACTED]";
}

/**
 * Produces a copy of a telemetry event with contact PII redacted for stdout logging.
 */
export function redactTelemetryPayload<T extends TelemetryEvent>(event: T): T {
  if ("contact" in event && typeof event.contact === "string" && event.contact.trim().length > 0) {
    return {
      ...event,
      contact: redactContact(event.contact),
    };
  }
  return event;
}

export function formatTelemetryWebhookSummary(
  event: TelemetryEvent,
  meta?: { userId?: string | null; ip?: string },
): string {
  const parts: string[] = [];
  const userTag = meta?.userId ? `User: \`${meta.userId}\`` : "User: `anonymous`";
  const ipTag = meta?.ip ? ` | IP: \`${meta.ip}\`` : "";

  if (event.kind === "feedback") {
    const safeCategory = sanitizeSingleLine(event.category);
    parts.push(`📢 **[Clutch Telemetry - Feedback]** (${safeCategory})`);
    parts.push(`${userTag}${ipTag}`);
    if (event.rating) {
      parts.push(`Rating: ${"⭐".repeat(event.rating)} (${event.rating}/5)`);
    }
    if (event.contact) {
      parts.push(`Contact: ${sanitizeHeaderField(event.contact)}`);
    }
    parts.push(`Message:\n> ${escapeMarkdownLinks(event.message).replace(/\n/g, "\n> ")}`);
    if (event.context) {
      const ctx = event.context;
      const ctxItems: string[] = [];
      if (ctx.packTitle) ctxItems.push(`Pack: ${sanitizeHeaderField(ctx.packTitle)}`);
      if (ctx.questionId) ctxItems.push(`Q: ${sanitizeHeaderField(ctx.questionId)}`);
      if (ctx.planId) ctxItems.push(`Plan: ${sanitizeHeaderField(ctx.planId)}`);
      if (ctx.tier) ctxItems.push(`Tier: ${sanitizeHeaderField(ctx.tier)}`);
      if (ctx.language) ctxItems.push(`Lang: ${sanitizeHeaderField(ctx.language)}`);
      if (ctxItems.length) parts.push(`Context: ${ctxItems.join(" | ")}`);
    }
  } else if (event.kind === "smoke_test_intent") {
    parts.push(`🎯 **[Clutch Telemetry - Smoke Test Intent]**`);
    parts.push(`${userTag}${ipTag}`);
    parts.push(
      `Plan: **${sanitizeHeaderField(event.planId)}** (${sanitizeHeaderField(event.currency).toUpperCase()}) | Action: \`${sanitizeHeaderField(event.action)}\``,
    );
    if (event.contact) {
      parts.push(`Contact: ${sanitizeHeaderField(event.contact)}`);
    }
    if (event.language) {
      parts.push(`Language: ${sanitizeHeaderField(event.language)}`);
    }
  } else if (event.kind === "citation_rejection") {
    parts.push(`⚠️ **[Clutch Telemetry - Citation Rejection]**`);
    parts.push(`Reason: \`${sanitizeSingleLine(event.reason)}\``);
    if (event.documentTitle) parts.push(`Document: ${sanitizeHeaderField(event.documentTitle)}`);
    if (event.sourceKind) parts.push(`Source Kind: ${sanitizeHeaderField(event.sourceKind)}`);
    if (event.sourceId) parts.push(`Source ID: ${sanitizeHeaderField(event.sourceId)}`);
    if (event.questionId) parts.push(`Question ID: ${sanitizeHeaderField(event.questionId)}`);
    if (event.excerptPreview) parts.push(`Excerpt: "${sanitizeHeaderField(event.excerptPreview)}"`);
    if (typeof event.totalSources === "number") {
      parts.push(`Total Sources: ${event.totalSources}`);
    }
  }

  return sanitizeWebhookMentions(parts.join("\n"));
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
      const loggedPayload = redactTelemetryPayload(timestamped);
      console.info("[pilot-telemetry]", JSON.stringify(loggedPayload));
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
        body: JSON.stringify({
          content,
          text: content,
          allowed_mentions: { parse: [] },
        }),
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
