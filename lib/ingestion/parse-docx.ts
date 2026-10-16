import type { SourceBlock } from "@/lib/schemas/ingestion";
import { validateDocxArchive } from "./validate-file";
export async function parseDocx(
  bytes: Buffer,
): Promise<{ sources: SourceBlock[]; warnings: string[] }> {
  validateDocxArchive(bytes);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  const sources = result.value
    .split(/\n\s*\n/)
    .map((text, index) => ({
      id: `paragraph-${index + 1}`,
      label: `Paragraph ${index + 1}`,
      text: text.trim(),
    }))
    .filter((source) => source.text);
  return {
    sources,
    warnings: result.messages.length
      ? [
          "Some document elements could not be converted. Review the extracted text before generating questions.",
        ]
      : [],
  };
}
