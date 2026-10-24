import "server-only";
import { streamText, APICallError } from "ai";
import { getGenerationModel } from "@/lib/ai/provider";
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
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

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
      if (
        targetIds.has(s.id) ||
        [...targetIds].some(
          (id) => s.id === `doc0_${id}` || s.id.endsWith(`_${id}`),
        )
      ) {
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

export function createCoachHandler(
  dependencies: {
    getModel?: typeof getGenerationModel;
    rateLimiter?: typeof checkRateLimit;
    verifyAuth?: typeof verifyAuthToken;
  } = {},
) {
  const getModel = dependencies.getModel ?? getGenerationModel;
  const rateLimiter = dependencies.rateLimiter ?? checkRateLimit;
  const verifyAuth = dependencies.verifyAuth ?? verifyAuthToken;

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

    const contentLength = Number(request.headers.get("content-length"));
    if (contentLength > MAX_COACH_BODY_BYTES) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "REQUEST_TOO_LARGE",
            message: "The coach request exceeds the 1 MB payload limit.",
          },
        },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }

    const auth = await verifyAuth(request);
    const clientIp = getClientIp(request);
    const rateLimitKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
    const isTestBypass = process.env.NODE_ENV === "test" && dependencies.rateLimiter === undefined;
    if (!isTestBypass) {
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

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Provide a valid JSON request body.",
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

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

    const { messages, document, language } = parsed.data;

    let model;
    try {
      model = getModel();
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
      });

      return result.toUIMessageStreamResponse({
        headers: {
          "Cache-Control": "no-store",
        },
        onError: (err: any) =>
          err?.data?.error?.message ||
          err?.message ||
          "AI Coach encountered an error. Please try again.",
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
