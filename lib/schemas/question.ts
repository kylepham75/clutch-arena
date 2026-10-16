import { z } from "zod";

const answerFields = {
  question: z.string().trim().min(1),
  options: z.tuple([
    z.string().trim().min(1),
    z.string().trim().min(1),
    z.string().trim().min(1),
    z.string().trim().min(1),
  ]),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1),
};

export const questionSchema = z
  .object({
    id: z.string().min(1),
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
});

/**
 * Runtime schema for a full study pack. Used to validate packs that arrive
 * from untrusted sources (imported JSON files, share links, API payloads).
 */
export const studyPackSchema = z.object({
  id: z.string().trim().min(1).max(120).default(() => "pack-imported"),
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
  metadata: z.record(z.string(), questionMetadataSchema).default({}),
});
