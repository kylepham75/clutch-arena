import "server-only";
import { Buffer } from "node:buffer";
import { streamText, APICallError } from "ai";
import { getCoachModel } from "@/lib/ai/provider";
import {
  coachRequestSchema,
  MAX_COACH_BODY_BYTES,
  MAX_COACH_CONTEXT_CHARS,
  MAX_COACH_HISTORY,
  messageText,
  type CoachFocus,
  type CoachRequest,
} from "@/lib/schemas/coach";
import {
  buildCoachMessages,
  buildCoachSystemPrompt,
} from "@/lib/ai/coach-prompt";
import { IngestionError } from "@/lib/ingestion/errors";
import { isAllowedOrigin } from "@/lib/utils";
import { budgetSourceBlocks } from "@/lib/ai/budget-sources";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import {
  checkRateLimit,
  getClientIp,
  getUserQuotaLedger,
  recordDeckGenerationCogs,
} from "@/lib/rate-limit";

export function selectCoachContextSources(
  sources: CoachRequest["document"]["sources"],
  activeFocus: CoachFocus | undefined,
  lastUserText: string,
  maxChars = MAX_COACH_CONTEXT_CHARS,
) {
  if (sources.length === 0) return [];

  const targetIds = new Set<string>();
  if (activeFocus?.type === "explain" && activeFocus.sourceId) {
    targetIds.add(activeFocus.sourceId);
  } else if (activeFocus?.type === "debrief") {
    for (const c of activeFocus.concepts) {
      if (c.sourceId) targetIds.add(c.sourceId);
    }
  }

  if (targetIds.size > 0) {
    const selectedIndices = new Set<number>();
    sources.forEach((s, idx) => {
      const isMatch =
        targetIds.has(s.id) ||
        targetIds.has(s.label) ||
        [...targetIds].some((id) => {
          if (s.id === `doc0_${id}` || s.id.endsWith(`_${id}`) || id.endsWith(`_${s.id}`)) return true;
          const cleanId = id.includes("·") ? id.split("·").pop()!.trim() : id.trim();
          if (s.label.trim().toLowerCase() === cleanId.toLowerCase()) return true;
          const idNum =
            cleanId.match(/\b(?:page|slide|trang|paragraph|lines?|p\.?)\s*(\d+)\b/i)?.[1] ||
            cleanId.match(/\b(\d+)\b/)?.[1];
          const sNum =
            s.label.match(/\b(?:page|slide|trang|paragraph|lines?|p\.?)\s*(\d+)\b/i)?.[1] ||
            s.label.match(/\b(\d+)\b/)?.[1];
          return Boolean(idNum && sNum && idNum === sNum);
        });

      if (isMatch) {
        selectedIndices.add(idx);
        if (idx > 0) selectedIndices.add(idx - 1);
        if (idx < sources.length - 1) selectedIndices.add(idx + 1);
      }
    });

    if (selectedIndices.size > 0) {
      const ordered = [...selectedIndices]
        .sort((a, b) => a - b)
        .map((i) => sources[i]);
      return budgetSourceBlocks(
        ordered,
        maxChars,
        activeFocus?.type === "explain"
          ? [activeFocus.sourceId, activeFocus.topic, activeFocus.rule, lastUserText]
              .filter(Boolean)
              .join(" ")
          : lastUserText,
      ).sources;
    }
  }

  const focusKeywords = [
    activeFocus?.type === "explain" ? activeFocus.sourceId : undefined,
    activeFocus?.type === "explain" ? activeFocus.topic : undefined,
    activeFocus?.type === "explain" ? activeFocus.rule : undefined,
    lastUserText,
  ]
    .filter(Boolean)
    .join(" ");

  return budgetSourceBlocks(sources, maxChars, focusKeywords).sources;
}

export function sanitizeCoachStreamError(err: unknown): string {
  let message = "";
  if (typeof err === "string") {
    message = err;
  } else if (err && typeof err === "object") {
    const e = err as Record<string, any>;
    if (typeof e.data?.error?.message === "string") {
      message = e.data.error.message;
    } else if (typeof e.message === "string") {
      message = e.message;
    }
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return "AI Coach encountered an error. Please try again.";
  }

  const SENSITIVE_PATTERNS = [
    /\bat\s+(?:async\s+)?[\w$.<>]+(?:\s+\(?[^)]+\)?)?/i,
    /^\s*at\s+/m,
    /\.[tj]sx?:\d+/i,
    /[a-zA-Z]:\\[\w\s.\-\\]+/i,
    /(?:\/(?:var|home|usr|app|etc|tmp|node_modules|Users))[\/\w.\-]+/i,
    /https?:\/\/[^\s"']+/i,
    /\b(?:openrouter|anthropic|claude|openai|gemini|google(?:generativeai)?|vertex|groq|cohere|mistral|upstash|supabase)\b/i,
    /\b(?:bearer\s+[a-zA-Z0-9_.\-]+|sk-[a-zA-Z0-9_.\-]+|[a-zA-Z0-9_-]*api[_-]?key[a-zA-Z0-9_-]*)/i,
    /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b/i,
    /\b(?:SQL|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|TABLE|COLUMN)\b/i,
  ];

  const containsSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
  if (containsSensitive || trimmed.length > 200) {
    return "AI Coach encountered an error. Please try again.";
  }

  return trimmed;
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; response: Response }
> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "REQUEST_TOO_LARGE",
            message: "The coach request exceeds the payload limit.",
          },
        },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  if (!request.body) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Provide a valid JSON request body.",
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Provide a valid JSON request body.",
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener("abort", abort, { once: true });

  const chunks: Uint8Array[] = [];
  let length = 0;
  let tooLarge = false;

  try {
    while (true) {
      if (request.signal.aborted) {
        return {
          ok: false,
          response: Response.json(
            {
              ok: false,
              error: {
                code: "REQUEST_CANCELLED",
                message: "The coach request was cancelled.",
              },
            },
            { status: 499, headers: { "Cache-Control": "no-store" } },
          ),
        };
      }

      const { done, value } = await reader.read();
      if (done) break;

      length += value.byteLength;
      if (length > maxBytes) {
        tooLarge = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch {
    if (request.signal.aborted) {
      return {
        ok: false,
        response: Response.json(
          {
            ok: false,
            error: {
              code: "REQUEST_CANCELLED",
              message: "The coach request was cancelled.",
            },
          },
          { status: 499, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Provide a valid JSON request body.",
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  } finally {
    request.signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be locked/closed
    }
  }

  if (tooLarge) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "REQUEST_TOO_LARGE",
            message: "The coach request exceeds the payload limit.",
          },
        },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  const bodyBuffer = Buffer.concat(chunks);
  if (bodyBuffer.length === 0) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Provide a valid JSON request body.",
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bodyBuffer);
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Provide a valid JSON request body.",
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
}

export function createCoachHandler(
  dependencies: {
    getModel?: (tier?: string) => ReturnType<typeof getCoachModel>;
    rateLimiter?: typeof checkRateLimit;
    verifyAuth?: typeof verifyAuthToken;
    getUserLedger?: typeof getUserQuotaLedger;
    recordCogs?: typeof recordDeckGenerationCogs;
  } = {},
) {
  const getModel = dependencies.getModel ?? getCoachModel;
  const rateLimiter = dependencies.rateLimiter ?? checkRateLimit;
  const verifyAuth = dependencies.verifyAuth ?? verifyAuthToken;
  const getUserLedger = dependencies.getUserLedger ?? getUserQuotaLedger;
  const recordCogs = dependencies.recordCogs ?? recordDeckGenerationCogs;

  return async function POST(request: Request) {
    const origin = request.headers.get("origin");
    if (!isAllowedOrigin(origin, request)) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "Send coach requests from this application’s origin.",
          },
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const auth = await verifyAuth(request);
    const clientIp = getClientIp(request);
    const rateLimitKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
    const isRateLimitBypass = process.env.NODE_ENV === "test" && dependencies.rateLimiter === undefined;
    if (!isRateLimitBypass) {
      const rateResult = await rateLimiter(rateLimitKey, "coach", auth.tier);
      if (!rateResult.allowed) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: `AI Coach rate limit reached. Please wait ${rateResult.retryAfter} seconds before asking again.`,
            },
          },
          {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": rateResult.retryAfter.toString(),
            },
          },
        );
      }
    }

    const bodyResult = await readBoundedJson(request, MAX_COACH_BODY_BYTES);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }
    const raw = bodyResult.data;

    const parsed = coachRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || "Invalid coach request.";
      return Response.json(
        {
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: issue,
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const isLedgerBypass = process.env.NODE_ENV === "test" && dependencies.getUserLedger === undefined;
    if (!isLedgerBypass) {
      const ledger = await getUserLedger(rateLimitKey, auth.tier);
      if (ledger.cogsSpentUsd + ledger.cogsReservedUsd >= ledger.cogsCeilingUsd) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "COGS_CEILING_EXCEEDED",
              message:
                "Monthly AI budget reached for your plan. Please upgrade or wait for the next billing cycle.",
            },
          },
          { status: 429, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const { messages, document, language } = parsed.data;

    let model;
    try {
      model = getModel(auth.tier);
    } catch (error) {
      if (error instanceof IngestionError) {
        return Response.json(
          {
            ok: false,
            error: { code: error.code, message: error.message },
          },
          { status: error.status, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        {
          ok: false,
          error: {
            code: "AI_NOT_CONFIGURED",
            message:
              "AI Coach is not configured. Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local.",
          },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const recentMessages = messages.slice(-MAX_COACH_HISTORY);
      const lastMessage = recentMessages.at(-1);
      const lastUserText = lastMessage ? messageText(lastMessage) : "";

      let activeFocus: CoachFocus | undefined;
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        if (recentMessages[i].metadata?.focus) {
          activeFocus = recentMessages[i].metadata?.focus;
          break;
        }
      }

      const selectedSources = selectCoachContextSources(
        document.sources,
        activeFocus,
        lastUserText,
        MAX_COACH_CONTEXT_CHARS,
      );

      const coachDoc = {
        ...document,
        sources: selectedSources,
      };

      const focusOnLastTurn = Boolean(lastMessage?.metadata?.focus);
      const system = buildCoachSystemPrompt(
        coachDoc,
        language,
        focusOnLastTurn ? undefined : activeFocus,
      );
      const modelMessages = buildCoachMessages(recentMessages);

      const result = streamText({
        model,
        system,
        messages: modelMessages,
        abortSignal: request.signal,
        maxRetries: 0,
        onError: (event) => {
          console.error(
            "[Coach Stream Error]",
            event.error instanceof Error ? event.error.message : event.error,
          );
        },
        onFinish: async (event) => {
          const totalTokens =
            event.usage?.totalTokens ??
            ((event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0));
          const costUsd = Math.max(
            0.000001,
            Number(((totalTokens / 1_000_000) * 0.5).toFixed(6)),
          );
          try {
            await recordCogs(rateLimitKey, auth.tier, costUsd, 0);
          } catch (cogsErr) {
            console.error("[Coach] Failed to record COGS:", cogsErr);
          }
        },
      });

      return result.toUIMessageStreamResponse({
        headers: {
          "Cache-Control": "no-store",
        },
        onError: (err: unknown) => sanitizeCoachStreamError(err),
      });
    } catch (error) {
      if (request.signal.aborted) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "REQUEST_CANCELLED",
              message: "The coach request was cancelled.",
            },
          },
          { status: 499, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (APICallError.isInstance(error) && error.statusCode === 429) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "AI_RATE_LIMITED",
              message: "The AI provider is rate-limited. Retry in a moment.",
            },
          },
          { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "15" } },
        );
      }
      return Response.json(
        {
          ok: false,
          error: {
            code: "COACH_FAILED",
            message: "The coach could not generate a response. Please try again.",
          },
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}
