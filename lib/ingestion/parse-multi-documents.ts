import type { ParsedDocument, SourceBlock } from "@/lib/schemas/ingestion";
import { parseDocument } from "./parse-document";
import { IngestionError } from "./errors";
import { MAX_EXTRACTED_CHARACTERS } from "./limits";

export async function parseMultiDocuments(
  files: File[],
  signal: AbortSignal,
): Promise<{
  compositeDocument: ParsedDocument;
  documents: ParsedDocument[];
}> {
  if (!files || files.length === 0) {
    throw new IngestionError("MISSING_FILE", "Upload at least one file.", 400);
  }

  if (files.length > 10) {
    throw new IngestionError(
      "TOO_MANY_FILES",
      "You can upload up to 10 files at once.",
      400,
    );
  }

  const documents: ParsedDocument[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    const doc = await parseDocument(file, signal);
    documents.push(doc);
  }

  const compositeSources: SourceBlock[] = [];
  const compositeWarnings: string[] = [];
  let totalCharacterCount = 0;
  let totalPageCount: number | null = 0;

  for (let fileIndex = 0; fileIndex < documents.length; fileIndex++) {
    const doc = documents[fileIndex];
    const cleanDocName = doc.fileName.replace(/\.[^/.]+$/, "").trim();

    compositeWarnings.push(...doc.warnings);
    totalCharacterCount += doc.characterCount;

    if (doc.pageCount !== null && totalPageCount !== null) {
      totalPageCount += doc.pageCount;
    } else {
      totalPageCount = null;
    }

    for (const source of doc.sources) {
      compositeSources.push({
        id: `doc${fileIndex}_${source.id}`,
        label: documents.length > 1 ? `${cleanDocName} · ${source.label}` : source.label,
        text: source.text,
      });
    }
  }

  if (totalCharacterCount < 40) {
    throw new IngestionError(
      "INSUFFICIENT_TEXT",
      "The documents need at least 40 characters of readable study material.",
      422,
    );
  }

  if (totalCharacterCount > MAX_EXTRACTED_CHARACTERS * 1.5) {
    // If over 180k chars across multiple files, advise splitting
    throw new IngestionError(
      "TOO_MUCH_TEXT",
      `The combined documents exceed ${(MAX_EXTRACTED_CHARACTERS * 1.5).toLocaleString()} characters. Try fewer or shorter documents.`,
      413,
    );
  }

  const formats = Array.from(new Set(documents.map((d) => d.format)));
  const format =
    formats.length === 1 ? formats[0] : "mixed";

  const compositeFileName =
    documents.length === 1
      ? documents[0].fileName
      : `${documents.length} files (${documents.map((d) => d.fileName.slice(0, 20)).join(", ")})`;

  const compositeDocument: ParsedDocument = {
    fileName: compositeFileName,
    format,
    sources: compositeSources,
    characterCount: totalCharacterCount,
    pageCount: totalPageCount,
    warnings: Array.from(new Set(compositeWarnings)),
  };

  return { compositeDocument, documents };
}
