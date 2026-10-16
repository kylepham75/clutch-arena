import "server-only";
import { streamText, APICallError } from "ai";
import { getGenerationModel } from "@/lib/ai/provider";
import {
  coachRequestSchema,
  MAX_COACH_BODY_BYTES,
} from "@/lib/schemas/coach";
import {
  buildCoachMessages,
  buildCoachSystemPrompt,
} from "@/lib/ai/coach-prompt";
import { IngestionError } from "@/lib/ingestion/errors";
import { isAllowedOrigin } from "@/lib/utils";
import { budgetSourceBlocks } from "@/lib/ai/budget-sources";

export function createCoachHandler(
  dependencies: {
    getModel?: typeof getGenerationModel;
  } = {},
) {
  const getModel = dependencies.getModel ?? getGenerationModel;

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
      const lastMessage = messages.at(-1);
      const focus = lastMessage?.metadata?.focus;
      const focusKeywords = [
        focus?.type === "explain" ? focus.sourceId : undefined,
        focus?.type === "explain" ? focus.topic : undefined,
        focus?.type === "explain" ? focus.rule : undefined,
      ]
        .filter(Boolean)
        .join(" ");

      const budgeted = budgetSourceBlocks(document.sources, 36_000, focusKeywords);
      const coachDoc = {
        ...document,
        sources: budgeted.sources,
      };

      const system = buildCoachSystemPrompt(coachDoc, language);
      const modelMessages = buildCoachMessages(messages);

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
