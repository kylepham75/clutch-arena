import type { SourceBlock } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";
export function parseTxt(bytes: Buffer): SourceBlock[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new IngestionError(
      "INVALID_TEXT_ENCODING",
      "Save the text file as UTF-8 and upload it again.",
      422,
    );
  }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text))
    throw new IngestionError(
      "BINARY_TEXT_FILE",
      "This file contains binary data. Upload a plain UTF-8 text file.",
      422,
    );
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sources: SourceBlock[] = [];
  for (let start = 0; start < lines.length; start += 30) {
    const end = Math.min(lines.length, start + 30);
    const content = lines.slice(start, end).join("\n").trim();
    if (content)
      sources.push({
        id: `lines-${start + 1}-${end}`,
        label: `Lines ${start + 1}–${end}`,
        text: content,
      });
  }
  return sources;
}
