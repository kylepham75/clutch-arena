import { z } from "zod";

export const MAX_TELEMETRY_BODY_BYTES = 32 * 1024;

export const feedbackCategorySchema = z.enum([
  "parser_edge_case",
  "citation_mismatch",
  "gameplay_bug",
  "smoke_test_intent",
  "general",
]);
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;

export const feedbackContextSchema = z.strictObject({
  packTitle: z.string().trim().max(200).optional(),
  questionId: z.string().trim().max(100).optional(),
  citation: z.string().trim().max(300).optional(),
  planId: z.string().trim().max(50).optional(),
  currency: z.enum(["vnd", "usd"]).optional(),
  tier: z.string().trim().max(40).optional(),
  language: z.enum(["en", "vi"]).optional(),
  userAgent: z.string().trim().max(300).optional(),
});
export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

export const feedbackSubmissionSchema = z.strictObject({
  kind: z.literal("feedback"),
  category: feedbackCategorySchema,
  message: z.string().trim().min(1).max(2000),
  contact: z.string().trim().max(160).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  context: feedbackContextSchema.optional(),
});
export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

export const smokeTestIntentSchema = z.strictObject({
  kind: z.literal("smoke_test_intent"),
  planId: z.enum(["cram_pass", "pro", "tutor"]),
  currency: z.enum(["vnd", "usd"]),
  action: z.enum(["plan_selected", "verify_clicked", "early_access_requested"]),
  contact: z.string().trim().max(160).optional(),
  language: z.enum(["en", "vi"]).optional(),
});
export type SmokeTestIntent = z.infer<typeof smokeTestIntentSchema>;

export const clientTelemetryPayloadSchema = z.discriminatedUnion("kind", [
  feedbackSubmissionSchema,
  smokeTestIntentSchema,
]);
export type ClientTelemetryPayload = z.infer<typeof clientTelemetryPayloadSchema>;

export const citationRejectionReasonSchema = z.enum([
  "missing_or_short_excerpt",
  "unknown_source_id",
  "unmatched_excerpt_in_source",
  "annotation_count_mismatch",
]);
export type CitationRejectionReason = z.infer<typeof citationRejectionReasonSchema>;

export const citationRejectionEventSchema = z.strictObject({
  kind: z.literal("citation_rejection"),
  reason: citationRejectionReasonSchema,
  requestId: z.string().trim().max(100).optional(),
  documentTitle: z.string().trim().max(200).optional(),
  sourceKind: z.enum(["testbank", "lecture", "mixed"]).optional(),
  sourceId: z.string().trim().max(100).optional(),
  excerptPreview: z.string().trim().max(240).optional(),
  questionId: z.string().trim().max(100).optional(),
  totalSources: z.number().int().min(0).max(5000).optional(),
});
export type CitationRejectionEvent = z.infer<typeof citationRejectionEventSchema>;

export type TelemetryEvent = ClientTelemetryPayload | CitationRejectionEvent;
