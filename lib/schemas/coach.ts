import { z } from "zod";
import { MAX_EXTRACTED_CHARACTERS } from "@/lib/ingestion/limits";

export const MAX_COACH_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_COACH_HISTORY = 6;
export const MAX_COACH_CONTEXT_CHARS = 6_000; // ~1,500 tokens max for citation block + surrounding context
export const MAX_COACH_MESSAGE_CHARACTERS = 12_000;
export const MAX_COACH_INPUT_CHARACTERS = 2_000;
export const MAX_COACH_EXTRACTED_CHARACTERS = 600_000;

const sourceIdSchema = z.string().min(1).max(100);
const citationFields = {
  sourceId: sourceIdSchema.optional(),
  excerpt: z.string().max(1000).optional(),
};

/** "Explain my miss": the question the student just got wrong. */
export const explainFocusSchema = z.strictObject({
  type: z.literal("explain"),
  question: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(500)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  selected: z.number().int().min(0).max(3).nullable(),
  explanation: z.string().max(2000),
  topic: z.string().max(120),
  rule: z.string().max(500),
  ...citationFields,
});

/** Post-run debrief: summary of a finished run and its weak concepts. */
export const debriefFocusSchema = z.strictObject({
  type: z.literal("debrief"),
  packTitle: z.string().max(200),
  score: z.number().int().min(0).max(1_000_000),
  correct: z.number().int().min(0).max(1000),
  total: z.number().int().min(0).max(1000),
  bestStreak: z.number().int().min(0).max(1000),
  livesLeft: z.number().int().min(0).max(3),
  concepts: z
    .array(
      z.strictObject({
        topic: z.string().max(120),
        rule: z.string().max(500),
        status: z.enum(["needs-review", "reinforced", "correct"]),
        ...citationFields,
      }),
    )
    .max(30),
});

export const coachFocusSchema = z.discriminatedUnion("type", [
  explainFocusSchema,
  debriefFocusSchema,
]);
export type CoachFocus = z.infer<typeof coachFocusSchema>;
export type CoachMessageMetadata = { focus?: CoachFocus };

// UI messages from the AI SDK carry extra part types (step-start, reasoning…).
// Only text parts are used; everything else is ignored rather than trusted.
const coachMessageSchema = z.object({
  id: z.string().max(200),
  role: z.enum(["user", "assistant"]),
  metadata: z.object({ focus: coachFocusSchema.optional() }).optional(),
  parts: z
    .array(
      z.looseObject({
        type: z.string().max(60),
        text: z.string().max(MAX_COACH_MESSAGE_CHARACTERS).optional(),
      }),
    )
    .max(60),
});

export const coachSourceSchema = z.strictObject({
  id: sourceIdSchema,
  label: z.string().min(1).max(200),
  text: z.string().max(MAX_EXTRACTED_CHARACTERS),
});

export const coachRequestSchema = z
  .strictObject({
    messages: z.array(coachMessageSchema).min(1).max(200),
    document: z.object({
      fileName: z.string().min(1).max(260),
      sources: z.array(coachSourceSchema).min(1).max(20_000),
    }),
    language: z.enum(["en", "vi"]).default("en"),
  })
  .refine(
    (body) =>
      body.document.sources.reduce((sum, s) => sum + s.text.length, 0) <=
      MAX_COACH_EXTRACTED_CHARACTERS,
    "Document sources exceed the multi-document text limit.",
  )
  .refine(
    (body) => body.messages.at(-1)?.role === "user",
    "The last message must come from the student.",
  )
  .refine((body) => {
    const last = body.messages.at(-1);
    const text = last ? messageText(last) : "";
    return text.trim().length > 0 && text.length <= MAX_COACH_INPUT_CHARACTERS;
  }, "Ask a question of up to 2,000 characters.");

export type CoachRequest = z.infer<typeof coachRequestSchema>;
export type CoachRequestMessage = CoachRequest["messages"][number];

export function messageText(message: { parts: { type: string; text?: string }[] }) {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}
