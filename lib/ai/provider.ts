import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { IngestionError } from "@/lib/ingestion/errors";

// ============================================================================
// Pinned OpenRouter Slugs & Privacy Config
// ============================================================================

export const DEFAULT_GENERATOR_SLUG = "google/gemini-3.6-flash";
export const PRIORITY_GENERATOR_SLUG = "google/gemini-4-argon";

export const DEFAULT_VERIFIER_SLUG = "anthropic/claude-sonnet-5.5";
export const FALLBACK_VERIFIER_SLUG = "openai/gpt-6.1-terra";

export const OPENROUTER_PRIVACY_PROVIDER_CONFIG = {
  require_parameters: true,
  data_collection: "deny" as const,
  zdr: true,
};

export const OPENROUTER_PROVIDER_OPTIONS = {
  provider: OPENROUTER_PRIVACY_PROVIDER_CONFIG,
};

export function getOpenRouterRequestConfig() {
  return {
    provider: { ...OPENROUTER_PRIVACY_PROVIDER_CONFIG },
  };
}

export function assertPinnedOpenRouterSlug(slug: string): void {
  if (!slug || typeof slug !== "string" || !slug.trim()) {
    throw new IngestionError(
      "INVALID_MODEL_SLUG",
      "Model slug must be a non-empty string.",
      400,
    );
  }
  const normalized = slug.trim().toLowerCase();
  if (
    normalized === "openrouter/auto" ||
    normalized.startsWith("openrouter/auto") ||
    normalized.includes(":free") ||
    normalized.includes(":online")
  ) {
    throw new IngestionError(
      "INVALID_MODEL_SLUG",
      `Dynamic, free, or web-augmented OpenRouter slug "${slug}" is not permitted. Pinned slugs only.`,
      400,
    );
  }
}

export function isPinnedOpenRouterSlug(slug: string): boolean {
  try {
    assertPinnedOpenRouterSlug(slug);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Cross-Family Pairing & Separation
// ============================================================================

export type ModelFamily = "google" | "anthropic" | "openai" | "qwen" | "other";

export function getModelFamily(slug: string): ModelFamily {
  if (!slug || typeof slug !== "string") return "other";
  const s = slug.toLowerCase().trim();
  if (s.startsWith("google/") || s.includes("gemini")) return "google";
  if (s.startsWith("anthropic/") || s.includes("claude")) return "anthropic";
  if (
    s.startsWith("openai/") ||
    s.includes("gpt-") ||
    s.includes("chatgpt") ||
    s.startsWith("o1") ||
    s.includes("/o1") ||
    s.startsWith("o3") ||
    s.includes("/o3")
  ) {
    return "openai";
  }
  if (s.startsWith("qwen/") || s.includes("qwen")) return "qwen";
  return "other";
}

export function assertCrossFamilyVerifier(
  generatorSlug: string,
  verifierSlug: string,
): void {
  assertPinnedOpenRouterSlug(generatorSlug);
  assertPinnedOpenRouterSlug(verifierSlug);

  const genFamily = getModelFamily(generatorSlug);
  const verFamily = getModelFamily(verifierSlug);

  if (genFamily === verFamily && (genFamily !== "other" || generatorSlug === verifierSlug)) {
    throw new IngestionError(
      "CROSS_FAMILY_VIOLATION",
      `Verifier model "${verifierSlug}" (${verFamily}) cannot be in the same model family as Generator "${generatorSlug}" (${genFamily}). Cross-family pairing is required.`,
      400,
    );
  }
}

// ============================================================================
// Model Provenance & Pipeline Versioning
// ============================================================================

export const PIPELINE_BASE_VERSION = "3.0.0-final";

export function computePipelineVersion(
  servedGeneratorModel: string,
  servedVerifierModel?: string,
): string {
  const gen = (servedGeneratorModel || "").trim() || "unknown";
  const ver = (servedVerifierModel || "").trim();
  if (ver) {
    return `${PIPELINE_BASE_VERSION}+${gen}+${ver}`;
  }
  return `${PIPELINE_BASE_VERSION}+${gen}`;
}

export interface OpenRouterProvenance {
  servedModel: string | null;
  costUsd: number;
  providerName?: string;
}

export function extractOpenRouterProvenance(
  responseMetadataOrRaw: unknown,
): OpenRouterProvenance {
  if (!responseMetadataOrRaw || typeof responseMetadataOrRaw !== "object") {
    return { servedModel: null, costUsd: 0 };
  }

  const obj = responseMetadataOrRaw as Record<string, any>;

  const candidateModel =
    obj.model ||
    obj.modelId ||
    obj.servedModel ||
    obj.served_model ||
    obj.response?.modelId ||
    obj.response?.model ||
    obj.rawResponse?.model ||
    obj.providerMetadata?.openrouter?.model ||
    obj.providerMetadata?.openrouter?.modelId ||
    obj.responseMetadata?.model ||
    obj.responseMetadata?.modelId;

  const servedModel =
    typeof candidateModel === "string" && candidateModel.trim()
      ? candidateModel.trim()
      : null;

  const candidateCost =
    obj.cost ??
    obj.costUsd ??
    obj.cost_usd ??
    obj.usage?.cost ??
    obj.usage?.costUsd ??
    obj.usage?.cost_usd ??
    obj.rawResponse?.usage?.cost ??
    obj.response?.usage?.cost ??
    obj.providerMetadata?.openrouter?.usage?.cost ??
    obj.providerMetadata?.openrouter?.cost;

  let costUsd = 0;
  if (typeof candidateCost === "number" && !isNaN(candidateCost)) {
    costUsd = candidateCost;
  } else if (typeof candidateCost === "string") {
    const parsed = parseFloat(candidateCost);
    if (!isNaN(parsed)) costUsd = parsed;
  }

  const candidateProvider =
    obj.providerName ||
    obj.provider_name ||
    (typeof obj.provider === "string" ? obj.provider : undefined) ||
    obj.rawResponse?.provider ||
    obj.providerMetadata?.openrouter?.provider ||
    obj.providerMetadata?.openrouter?.providerName;

  const providerName =
    typeof candidateProvider === "string" && candidateProvider.trim()
      ? candidateProvider.trim()
      : undefined;

  return {
    servedModel,
    costUsd,
    ...(providerName ? { providerName } : {}),
  };
}

// ============================================================================
// Model Factories & Retrieval
// ============================================================================

export function getOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (
    key &&
    key !== "your-openrouter-key-here" &&
    key !== "your-api-key-here"
  ) {
    return key;
  }
  return null;
}

export function getOpenRouterModel(modelId: string) {
  assertPinnedOpenRouterSlug(modelId);
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new IngestionError(
      "AI_NOT_CONFIGURED",
      "AI service is not configured. Add OPENROUTER_API_KEY to your environment variables.",
      503,
    );
  }

  const openrouter = createOpenRouter({
    apiKey,
    extraBody: {
      provider: OPENROUTER_PRIVACY_PROVIDER_CONFIG,
    },
  });

  return openrouter(modelId, {
    extraBody: {
      provider: OPENROUTER_PRIVACY_PROVIDER_CONFIG,
    },
  });
}

export function getOpenRouterGeneratorModel(
  tier: string = "contender",
  options?: { degraded?: boolean; modelOverride?: string },
) {
  const isPriority = tier === "cram_pass" || tier === "pro" || tier === "tutor";
  let slug: string;

  if (options?.modelOverride?.trim()) {
    slug = options.modelOverride.trim();
  } else if (isPriority && !options?.degraded) {
    slug =
      process.env.OPENROUTER_PRIORITY_MODEL?.trim() || PRIORITY_GENERATOR_SLUG;
  } else {
    slug =
      process.env.OPENROUTER_GENERATOR_MODEL?.trim() || DEFAULT_GENERATOR_SLUG;
  }

  assertPinnedOpenRouterSlug(slug);
  return getOpenRouterModel(slug);
}

export function getVerifierModel(options?: {
  generatorSlug?: string;
  modelOverride?: string;
}) {
  const generatorSlug =
    options?.generatorSlug?.trim() ||
    process.env.OPENROUTER_GENERATOR_MODEL?.trim() ||
    DEFAULT_GENERATOR_SLUG;

  const verifierSlug =
    options?.modelOverride?.trim() ||
    process.env.OPENROUTER_VERIFIER_MODEL?.trim() ||
    DEFAULT_VERIFIER_SLUG;

  assertCrossFamilyVerifier(generatorSlug, verifierSlug);

  const openRouterKey = getOpenRouterApiKey();
  if (openRouterKey) {
    return getOpenRouterModel(verifierSlug);
  }

  throw new IngestionError(
    "AI_NOT_CONFIGURED",
    "Verifier AI service is not configured. Add OPENROUTER_API_KEY to your environment variables.",
    503,
  );
}

export function getFallbackVerifierModel(options?: {
  generatorSlug?: string;
  modelOverride?: string;
}) {
  const generatorSlug =
    options?.generatorSlug?.trim() ||
    process.env.OPENROUTER_GENERATOR_MODEL?.trim() ||
    DEFAULT_GENERATOR_SLUG;

  const fallbackSlug =
    options?.modelOverride?.trim() ||
    process.env.OPENROUTER_FALLBACK_VERIFIER_MODEL?.trim() ||
    FALLBACK_VERIFIER_SLUG;

  assertCrossFamilyVerifier(generatorSlug, fallbackSlug);

  const openRouterKey = getOpenRouterApiKey();
  if (openRouterKey) {
    return getOpenRouterModel(fallbackSlug);
  }

  throw new IngestionError(
    "AI_NOT_CONFIGURED",
    "Fallback verifier AI service is not configured. Add OPENROUTER_API_KEY to your environment variables.",
    503,
  );
}

export function getGeminiModel(modelOverride?: string) {
  const googleApiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (
    googleApiKey &&
    googleApiKey !== "your-gemini-key-here" &&
    googleApiKey !== "your-api-key-here"
  ) {
    const defaultModel = "gemini-3.6-flash";
    const modelId = modelOverride || process.env.GEMINI_MODEL?.trim() || defaultModel;
    return createGoogleGenerativeAI({ apiKey: googleApiKey })(modelId);
  }
  return null;
}

export function getGroqModel(modelOverride?: string) {
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  if (groqApiKey && groqApiKey !== "your-groq-key-here") {
    const modelId =
      modelOverride || process.env.GROQ_MODEL?.trim() || "qwen/qwen3.8-27b";
    const groq = createOpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqApiKey,
    });
    return groq.chat(modelId);
  }
  return null;
}

export function getLocalModel() {
  const baseURL =
    process.env.LOCAL_AI_BASE_URL?.trim() || "http://127.0.0.1:11434/v1";
  const modelId = process.env.LOCAL_AI_MODEL?.trim() || "qwen2.5:7b";
  const local = createOpenAI({
    baseURL,
    apiKey: "ollama",
  });
  return local.chat(modelId);
}

export function getGenerationModel(
  tier: string = "contender",
  options?: { degraded?: boolean },
) {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const isPriority = tier === "cram_pass" || tier === "pro" || tier === "tutor";
  const openRouterKey = getOpenRouterApiKey();

  // If explicitly specified in .env.local
  if (provider === "local" || provider === "ollama") {
    const local = getLocalModel();
    if (local) return local;
  }

  // 1. Check OPENROUTER_API_KEY first (if set and valid, return pinned OpenRouter generator model)
  if (openRouterKey && provider !== "gemini" && provider !== "groq") {
    return getOpenRouterGeneratorModel(tier, options);
  }

  // 2. High-retention synthesis routing for Clutch Notes
  if (tier === "notes") {
    if (openRouterKey && provider !== "gemini" && provider !== "groq") {
      return getOpenRouterGeneratorModel("notes", options);
    }
    const noteModel = process.env.NOTES_AI_MODEL?.trim() || "gemini-3.6-flash";
    const gemini = getGeminiModel(noteModel);
    if (gemini) return gemini;
    const groq = getGroqModel();
    if (groq) return groq;
  }

  if (provider === "gemini") {
    const envModel = process.env.GEMINI_MODEL?.trim();
    const defaultGemini = "gemini-3.6-flash";
    const gemini = getGeminiModel(envModel || defaultGemini);
    if (gemini) return gemini;
  }
  if (provider === "groq") {
    const groq = getGroqModel();
    if (groq) return groq;
  }

  // 3. Fallback to OpenRouter if configured
  if (openRouterKey) {
    return getOpenRouterGeneratorModel(tier, options);
  }

  // 4. Smart Model Routing for Cram Pass and Pro/Tutor users
  if (isPriority) {
    const geminiPro = getGeminiModel(process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash");
    if (geminiPro) return geminiPro;
  }

  // 5. Lowest-cost default: Groq (ultra-fast, zero-cost) or Gemini 3.6 Flash
  const groq = getGroqModel();
  if (groq) return groq;

  const gemini = getGeminiModel(process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash");
  if (gemini) return gemini;

  throw new IngestionError(
    "AI_NOT_CONFIGURED",
    "AI service is not configured. Add OPENROUTER_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY to your environment variables.",
    503,
  );
}
