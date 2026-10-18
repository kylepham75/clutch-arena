import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { IngestionError } from "@/lib/ingestion/errors";

export function getGeminiModel(modelOverride?: string) {
  const googleApiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (
    googleApiKey &&
    googleApiKey !== "your-gemini-key-here" &&
    googleApiKey !== "your-api-key-here"
  ) {
    const defaultModel = "gemini-2.5-flash-lite";
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

export function getGenerationModel(tier: string = "contender") {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const isPriority = tier === "cram_pass" || tier === "pro" || tier === "tutor";

  // If explicitly specified in .env.local
  if (provider === "local" || provider === "ollama") {
    const local = getLocalModel();
    if (local) return local;
  }
  if (provider === "gemini") {
    const gemini = getGeminiModel(isPriority ? "gemini-2.5-flash" : "gemini-2.5-flash-lite");
    if (gemini) return gemini;
  }
  if (provider === "groq") {
    const groq = getGroqModel();
    if (groq) return groq;
  }

  // Smart Model Routing:
  // For Cram Pass and Pro/Tutor users, route to priority high-context models
  if (isPriority) {
    const geminiPro = getGeminiModel("gemini-2.5-flash");
    if (geminiPro) return geminiPro;
  }

  // Lowest-cost default: Groq (ultra-fast, zero-cost) or Gemini 2.5 Flash-Lite
  const groq = getGroqModel();
  if (groq) return groq;

  const gemini = getGeminiModel("gemini-2.5-flash-lite");
  if (gemini) return gemini;

  throw new IngestionError(
    "AI_NOT_CONFIGURED",
    "Question generation is not configured. Add GROQ_API_KEY or GEMINI_API_KEY to .env.local and restart the server. Preview mode works without a key.",
    503,
  );
}
