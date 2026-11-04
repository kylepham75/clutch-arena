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
  const normalized = text.replace(/\r\n?/g, "\n");

  // Check if text has slide delimiters (e.g. === Slide 1 === or --- Slide 1 --- or === Page 1 ===)
  const slideHeaderPattern = /(?:^|\n)(?:===|---|###)\s*(?:Slide|Page)\s+(\d+)\s*(?:===|---|###)?\s*\n/i;
  if (slideHeaderPattern.test(normalized)) {
    const parts = normalized.split(/(?:^|\n)(?:===|---|###)\s*(?:Slide|Page)\s+(\d+)\s*(?:===|---|###)?\s*\n/i);
    const sources: SourceBlock[] = [];
    for (let i = 1; i < parts.length; i += 2) {
      const num = parseInt(parts[i], 10);
      const content = (parts[i + 1] || "").trim();
      if (content) {
        sources.push({
          id: `slide-${num}`,
          label: `Slide ${num}`,
          text: content,
        });
      }
    }
    if (sources.length > 0) {
      return sources;
    }
  }

  const lines = normalized.split("\n");
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
