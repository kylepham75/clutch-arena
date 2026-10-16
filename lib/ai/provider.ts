import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { IngestionError } from "@/lib/ingestion/errors";

export function getGeminiModel() {
  const googleApiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (
    googleApiKey &&
    googleApiKey !== "your-gemini-key-here" &&
    googleApiKey !== "your-api-key-here"
  ) {
    const modelId = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
    return createGoogleGenerativeAI({ apiKey: googleApiKey })(modelId);
  }
  return null;
}

export function getGroqModel() {
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  if (groqApiKey && groqApiKey !== "your-groq-key-here") {
    const modelId =
      process.env.GROQ_MODEL?.trim() || "qwen/qwen3.8-27b";
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

export function getGenerationModel() {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();

  // If explicitly specified in .env.local
  if (provider === "local" || provider === "ollama") {
    const local = getLocalModel();
    if (local) return local;
  }
  if (provider === "gemini") {
    const gemini = getGeminiModel();
    if (gemini) return gemini;
  }
  if (provider === "groq") {
    const groq = getGroqModel();
    if (groq) return groq;
  }

  // Default preference: Groq is ultra-fast (~1.5s), 100% free, and avoids Gemini 503 high-demand spikes
  const groq = getGroqModel();
  if (groq) return groq;

  const gemini = getGeminiModel();
  if (gemini) return gemini;

  throw new IngestionError(
    "AI_NOT_CONFIGURED",
    "Question generation is not configured. Add GROQ_API_KEY or GEMINI_API_KEY to .env.local and restart the server. Preview mode works without a key.",
    503,
  );
}
