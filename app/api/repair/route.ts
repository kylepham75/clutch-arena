import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import {
  extractOpenRouterProvenance,
  getGenerationModel,
  getNoteSummarizerModel,
} from "@/lib/ai/provider";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getAuthoritativeBillingRegion } from "@/lib/pricing/region";
import { isPaidTier } from "@/lib/pricing/tiers";
import {
  checkAndReserveDeckQuota,
  checkRateLimit,
  computeContentHash,
  getClientIp,
  recordDeckGenerationCogs,
  rollbackDeckQuotaReservation,
  toClientQuota,
} from "@/lib/rate-limit";
import { isAllowedOrigin } from "@/lib/utils";
import {
  questionMetadataSchema,
  type QuestionItem,
  type QuestionMetadata,
} from "@/lib/schemas/question";
import {
  noteFormulaVariableSchema,
  type NoteFormula,
} from "@/lib/schemas/notes";
import {
  deterministicRepairFormula,
  deterministicRepairQuestion,
  repairRequestSchema,
} from "./helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_REPAIR_BODY_BYTES = 65_536;
const ESTIMATED_REPAIR_COST_USD = 0.004;

// ============================================================================
// POST Route Handler
// ============================================================================

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, req)) {
    return NextResponse.json(
      { ok: false, error: "ORIGIN_NOT_ALLOWED" },
      { status: 403 },
    );
  }

  const auth = await verifyAuthToken(req);
  const enforceAuth =
    process.env.NODE_ENV === "production" ||
    req.headers.get("x-enforce-auth") === "true" ||
    Boolean(req.headers.get("authorization")) ||
    (process.env.NODE_ENV !== "test" && !auth.authenticated && !auth.devMode);

  if (enforceAuth && !auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const clientIp = getClientIp(req);
  const rateLimitKey = auth.authenticated ? `user:${auth.user.id}` : `ip:${clientIp}`;
  const effectiveTier = auth.authenticated ? auth.tier : "contender";
  const billingRegion = getAuthoritativeBillingRegion(req);

  const enforceRateLimit =
    process.env.NODE_ENV !== "test" ||
    req.headers.get("x-enforce-rate-limit") === "true";

  if (enforceRateLimit) {
    const rateResult = await checkRateLimit(
      rateLimitKey,
      isPaidTier(effectiveTier) ? "coach" : "ingest",
      effectiveTier,
    );
    if (!rateResult.allowed) {
      return NextResponse.json(
        { ok: false, error: "RATE_LIMIT_EXCEEDED" },
        {
          status: 429,
          headers: {
            "Retry-After": rateResult.retryAfter.toString(),
          },
        },
      );
    }
  }

  const rawContentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(rawContentLength) && rawContentLength > MAX_REPAIR_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "REQUEST_TOO_LARGE" },
      { status: 413 },
    );
  }

  let bodyJson: unknown;
  try {
    const rawText = await req.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_REPAIR_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: "REQUEST_TOO_LARGE" },
        { status: 413 },
      );
    }
    bodyJson = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed JSON request body." },
      { status: 400 },
    );
  }

  const parsed = repairRequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message || "Invalid request payload.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const enforceQuota =
    process.env.NODE_ENV !== "test" ||
    req.headers.get("x-enforce-quota") === "true";
  const repairHash = `repair:${data.kind}:${computeContentHash({ normalizedText: JSON.stringify(data) })}`;

  let quotaReserved = false;
  let quotaSettled = false;
  let reservedCostUsd = ESTIMATED_REPAIR_COST_USD;

  const reserveQuotaOrRespond = async () => {
    if (!enforceQuota) return null;
    const quotaResult = await checkAndReserveDeckQuota(
      rateLimitKey,
      effectiveTier,
      repairHash,
      {
        actionKind: "coach",
        estimatedCostUsd: ESTIMATED_REPAIR_COST_USD,
        region: billingRegion,
      },
    );
    if (!quotaResult.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: quotaResult.reason ?? "QUOTA_EXCEEDED",
          ...(quotaResult.quota ? { quota: toClientQuota(quotaResult.quota) } : {}),
        },
        { status: 429 },
      );
    }
    quotaReserved = Boolean(quotaResult.reserved ?? true);
    if (typeof quotaResult.reservedCostUsd === "number") {
      reservedCostUsd = quotaResult.reservedCostUsd;
    }
    return null;
  };

  const settleQuota = async (resMetadata: unknown) => {
    if (!enforceQuota || !quotaReserved || quotaSettled) return;
    quotaSettled = true;
    const provenance = extractOpenRouterProvenance(resMetadata);
    const actualCost = provenance.costUsd > 0 ? provenance.costUsd : 0.002;
    try {
      await recordDeckGenerationCogs(
        rateLimitKey,
        effectiveTier,
        actualCost,
        reservedCostUsd,
        billingRegion,
      );
    } catch (cogsErr) {
      console.error("[app/api/repair] Failed to record COGS:", cogsErr);
    }
  };

  const rollbackQuota = async () => {
    if (!enforceQuota || !quotaReserved || quotaSettled) return;
    quotaSettled = true;
    try {
      await rollbackDeckQuotaReservation({
        userId: auth.authenticated ? auth.user.id : null,
        ip: auth.authenticated ? null : clientIp,
        tier: effectiveTier,
        actionKind: "coach",
        reservedCostUsd,
        region: billingRegion,
      });
    } catch (rollbackErr) {
      console.error("[app/api/repair] Failed to rollback quota reservation:", rollbackErr);
    }
  };

  if (data.kind === "question") {
    const detResult = deterministicRepairQuestion(
      data.question,
      data.metadata,
      data.sourceText,
    );

    let hallucinationDetected = detResult.changed;
    let summary = detResult.changed
      ? "Applied deterministic corrections to typography and LaTeX formatting."
      : "Question verified with no math or hallucination defects.";
    let fixedQuestion: QuestionItem = detResult.question;
    let fixedMetadata: QuestionMetadata | undefined = detResult.metadata;

    let model: ReturnType<typeof getGenerationModel> | null = null;
    try {
      model = getGenerationModel("contender", { reasoningEffort: "low" });
    } catch (configErr) {
      console.warn(
        "[app/api/repair] Question LLM model unavailable, using deterministic fallback:",
        configErr instanceof Error ? configErr.message : configErr,
      );
    }

    if (model) {
      const quotaErrorResponse = await reserveQuotaOrRespond();
      if (quotaErrorResponse) {
        return quotaErrorResponse;
      }

      try {
        const systemPrompt = `You are a rigorous academic fact-checker and mathematical verification engine for university economics and finance multiple-choice questions.
Your mission is to verify the arithmetic, algebra, answer options, correct answer index, explanation, and concept variant against the source slide text and student note.
If you detect an incorrect answer index, erroneous calculation, wrong sign, mislabelled distractors, or hallucinated claims:
1. Fix the question, options, correctIndex, and explanation so that the math is 100% mathematically correct and strictly consistent with the provided source text.
2. Fix the conceptVariant with matching precision.
3. Keep the original question ID strictly unchanged.
4. Set hallucinationDetected to true and summarize what was repaired. If the question was already mathematically correct, set hallucinationDetected to false.`;

        const prompt = `Verify and repair this question item against the authoritative source text and user report:

[QUESTION ITEM]
${JSON.stringify(detResult.question, null, 2)}

${detResult.metadata ? `[METADATA]\n${JSON.stringify(detResult.metadata, null, 2)}\n` : ""}
${data.sourceText ? `[AUTHORITATIVE SOURCE TEXT]\n${data.sourceText}\n` : ""}
${data.userNote ? `[STUDENT REPORT / NOTE]\n${data.userNote}\n` : ""}`;

        const questionOutputSchema = z.object({
          hallucinationDetected: z.boolean(),
          summary: z.string(),
          question: z.object({
            question: z.string(),
            options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
            correctIndex: z.number().int().min(0).max(3),
            explanation: z.string(),
            conceptVariant: z.object({
              question: z.string(),
              options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
              correctIndex: z.number().int().min(0).max(3),
              explanation: z.string(),
            }),
          }),
          metadata: questionMetadataSchema.optional(),
        });

        const res = await generateObject({
          model,
          schema: questionOutputSchema,
          system: systemPrompt,
          prompt,
          abortSignal: req.signal,
        });

        await settleQuota(res);

        if (res.object) {
          hallucinationDetected = res.object.hallucinationDetected;
          summary = res.object.summary;
          fixedQuestion = {
            ...res.object.question,
            id: data.question.id,
          };
          if (res.object.metadata) {
            fixedMetadata = res.object.metadata;
          }
        }
      } catch (err) {
        await rollbackQuota();
        console.warn(
          "[app/api/repair] Question LLM verification failed or unconfigured, using deterministic fallback:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      kind: "question",
      hallucinationDetected,
      summary,
      question: fixedQuestion,
      metadata: fixedMetadata,
    });
  }

  // data.kind === "note_formula"
  const detResult = deterministicRepairFormula(
    data.formula,
    data.sourceText,
  );

  let hallucinationDetected = detResult.changed;
  let summary = detResult.changed
    ? "Applied deterministic corrections to formula LaTeX and variables."
    : "Formula verified with no defects; status set to verified.";
  let fixedFormula: NoteFormula = detResult.formula;

  let model: ReturnType<typeof getGenerationModel> | null = null;
  try {
    try {
      model = getNoteSummarizerModel("contender");
    } catch {
      model = getGenerationModel("contender", { reasoningEffort: "low" });
    }
  } catch (configErr) {
    console.warn(
      "[app/api/repair] Note formula LLM model unavailable, using deterministic fallback:",
      configErr instanceof Error ? configErr.message : configErr,
    );
  }

  if (model) {
    const quotaErrorResponse = await reserveQuotaOrRespond();
    if (quotaErrorResponse) {
      return quotaErrorResponse;
    }

    try {
      const systemPrompt = `You are an expert mathematical and financial formula verification engine.
Verify the LaTeX equation, variable definitions, leadText, and description against the authoritative source text and student note.
If you detect an incorrect sign, mis-transcribed exponent or subscript, inverted fraction, or hallucinated variable:
1. Fix the LaTeX equation, variable definitions, and transition text so that it matches authoritative mathematical truth and source slides.
2. Ensure status is "verified" and reviewReason is undefined.
3. Set hallucinationDetected to true and summarize the repair. If the formula is already correct, set hallucinationDetected to false.`;

      const prompt = `Verify and repair this study note formula against the authoritative source text and user report:

[FORMULA]
${JSON.stringify(detResult.formula, null, 2)}

${data.sectionTitle ? `[SECTION TITLE]\n${data.sectionTitle}\n` : ""}
${data.sourceText ? `[AUTHORITATIVE SOURCE TEXT]\n${data.sourceText}\n` : ""}
${data.userNote ? `[STUDENT REPORT / NOTE]\n${data.userNote}\n` : ""}`;

      const formulaOutputSchema = z.object({
        hallucinationDetected: z.boolean(),
        summary: z.string(),
        formula: z.object({
          name: z.string().optional().default(""),
          leadText: z.string().optional().default(""),
          latex: z.string(),
          description: z.string().optional().default(""),
          variables: z.array(noteFormulaVariableSchema).default([]),
        }),
      });

      const res = await generateObject({
        model,
        schema: formulaOutputSchema,
        system: systemPrompt,
        prompt,
        abortSignal: req.signal,
      });

      await settleQuota(res);

      if (res.object) {
        hallucinationDetected = res.object.hallucinationDetected;
        summary = res.object.summary;
        fixedFormula = {
          ...detResult.formula,
          name: res.object.formula.name ?? detResult.formula.name,
          leadText: res.object.formula.leadText ?? detResult.formula.leadText,
          latex: res.object.formula.latex,
          description:
            res.object.formula.description ?? detResult.formula.description,
          variables: res.object.formula.variables ?? detResult.formula.variables,
          status: "verified",
          reviewReason: undefined,
        };
      }
    } catch (err) {
      await rollbackQuota();
      console.warn(
        "[app/api/repair] Note formula LLM verification failed or unconfigured, using deterministic fallback:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    kind: "note_formula",
    hallucinationDetected,
    summary,
    formula: fixedFormula,
  });
}
