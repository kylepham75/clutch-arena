import { z } from "zod";

export const PROTOTYPE_POLLUTION_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
] as const;

export function isPrototypePollutionKey(key: unknown): boolean {
  if (typeof key !== "string") return false;
  const normalized = key.trim().toLowerCase();
  return (
    normalized === "__proto__" ||
    normalized === "constructor" ||
    normalized === "prototype"
  );
}

const answerFields = {
  question: z.string().trim().min(1).max(2000),
  options: z.tuple([
    z.string().trim().min(1).max(2000),
    z.string().trim().min(1).max(2000),
    z.string().trim().min(1).max(2000),
    z.string().trim().min(1).max(2000),
  ]),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1).max(2000),
};

export const questionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (val) => !isPrototypePollutionKey(val),
        "Question ID cannot be a prototype pollution key ('__proto__', 'constructor', 'prototype').",
      ),
    ...answerFields,
    conceptVariant: z.object(answerFields).strict(),
  })
  .strict();

export const questionBankSchema = z
  .array(questionSchema)
  .min(1)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "Question IDs must be unique.",
  );

export type QuestionItem = z.infer<typeof questionSchema>;
export type QuestionMetadata = {
  topic: string;
  chapter: string;
  citation: string;
  rule: string;
  distractorRationale?: string;
};
export type StudyPack = {
  id: string;
  title: string;
  subtitle: string;
  questions: QuestionItem[];
  metadata: Record<string, QuestionMetadata>;
};

export const MAX_PACK_QUESTIONS = 100;

export const questionMetadataSchema = z.object({
  topic: z.string().max(300).default(""),
  chapter: z.string().max(300).default(""),
  citation: z.string().max(5000).default(""),
  rule: z.string().max(5000).default(""),
  distractorRationale: z.string().max(5000).optional(),
});

export const studyPackMetadataSchema = z
  .any()
  .superRefine((val, ctx) => {
    if (val && typeof val === "object") {
      for (const k of Object.getOwnPropertyNames(val)) {
        if (isPrototypePollutionKey(k)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Metadata key cannot be a prototype pollution key ('${k}').`,
          });
        }
      }
    }
  })
  .pipe(
    z
      .record(
        z
          .string()
          .refine(
            (val) => !isPrototypePollutionKey(val),
            "Metadata key cannot be a prototype pollution key ('__proto__', 'constructor', 'prototype').",
          ),
        questionMetadataSchema,
      )
      .default({}),
  );

/**
 * Runtime schema for a full study pack. Used to validate packs that arrive
 * from untrusted sources (imported JSON files, share links, API payloads).
 */
export const studyPackSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(
      (val) => !isPrototypePollutionKey(val),
      "Pack ID cannot be a prototype pollution key ('__proto__', 'constructor', 'prototype').",
    )
    .default(() => "pack-imported"),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().max(300).default(""),
  questions: z
    .array(questionSchema)
    .min(1)
    .max(MAX_PACK_QUESTIONS)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "Question IDs must be unique.",
    ),
  metadata: studyPackMetadataSchema,
});
