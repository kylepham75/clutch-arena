import { createHash } from "node:crypto";
import type { SourceBlock } from "@/lib/schemas/ingestion";

export interface DeduplicateAnimationSlidesResult {
  sources: SourceBlock[];
  droppedSlideIds: string[];
  droppedCount: number;
}

/**
 * Extracts note content from all `[Notes: ...]` blocks within a text.
 */
function extractNotes(text: string): string[] {
  const matches = text.matchAll(/\[Notes:\s*([\s\S]*?)\]/g);
  const notes: string[] = [];
  for (const match of matches) {
    const trimmed = match[1]?.trim();
    if (trimmed) {
      notes.push(trimmed);
    }
  }
  return notes;
}

/**
 * Strips trailing standalone page/slide counters on their own line:
 * e.g. "\nPage 4", "\nSlide 4 / 20", "\nSlide 4 of 20", "\n4", "\n4 / 20", "\nPage 4 of 20", "\nSlide 4"
 */
export function stripTrailingPageCounters(text: string): string {
  let cleaned = text.trimEnd();
  const counterRegex =
    /(?:^|\r?\n)\s*(?:(?:page|slide)\s*\d+(?:\s*(?:\/|of)\s*\d+)?|\d+(?:\s*(?:\/|of)\s*\d+)?)\s*$/i;

  while (counterRegex.test(cleaned)) {
    const next = cleaned.replace(counterRegex, "").trimEnd();
    if (next === cleaned) {
      break;
    }
    cleaned = next;
  }
  return cleaned;
}

/**
 * Normalizes slide text for prefix comparison:
 * - strips notes blocks so body text is compared cleanly
 * - strips trailing standalone page/slide counters
 * - normalizes Unicode to NFC
 * - collapses all whitespace to single spaces
 */
export function normalizeSlideTextForPrefix(text: string): string {
  if (!text) return "";
  let cleaned = text;
  // Strip [Notes: ...] blocks during prefix comparison
  cleaned = cleaned.replace(/\[Notes:\s*[\s\S]*?\]/g, "");
  // Strip trailing page/slide counters
  cleaned = stripTrailingPageCounters(cleaned);
  // Normalize Unicode to NFC and collapse whitespace
  return cleaned
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes length of the longest common prefix between two strings.
 */
export function longestCommonPrefixLength(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a.charCodeAt(i) === b.charCodeAt(i)) {
    i++;
  }
  return i;
}

/**
 * Deduplicates contiguous progressive animation slides where an earlier slide
 * is a progressive prefix (> threshold, default 85%) of the subsequent slide.
 *
 * Rules:
 * - Compares each contiguous pair `(sources[i], sources[i + 1])`.
 * - Speaker-notes guard: if `sources[i].text` contains a `[Notes: ...]` block whose
 *   content is absent from `sources[i + 1].text`, `sources[i]` is retained.
 * - Progressive builds (`Slide 1 -> Slide 2 -> Slide 3`) drop both `Slide 1` and
 *   `Slide 2` while preserving `Slide 3`'s original `id` and `label`.
 */
export function deduplicateAnimationSlides(
  sources: SourceBlock[],
  threshold = 0.85,
): DeduplicateAnimationSlidesResult {
  if (!sources || sources.length <= 1) {
    return {
      sources: sources ? [...sources] : [],
      droppedSlideIds: [],
      droppedCount: 0,
    };
  }

  const droppedSlideIds: string[] = [];
  const keptSources: SourceBlock[] = [];

  for (let i = 0; i < sources.length; i++) {
    const current = sources[i];

    if (i < sources.length - 1) {
      const next = sources[i + 1];

      // Speaker-notes guard: keep current slide if it has notes absent from next slide
      const notes = extractNotes(current.text);
      const hasMissingNotes = notes.some((note) => !next.text.includes(note));

      if (!hasMissingNotes) {
        const normCurrent = normalizeSlideTextForPrefix(current.text);
        const normNext = normalizeSlideTextForPrefix(next.text);

        if (normCurrent.length > 0 && normNext.length >= normCurrent.length) {
          const lcp = longestCommonPrefixLength(normCurrent, normNext);
          const ratio = lcp / normCurrent.length;

          if (ratio > threshold) {
            droppedSlideIds.push(current.id);
            continue;
          }
        }
      }
    }

    keptSources.push(current);
  }

  return {
    sources: keptSources,
    droppedSlideIds,
    droppedCount: droppedSlideIds.length,
  };
}

/**
 * Computes SHA-256 hex digest of a byte buffer.
 */
export function computeFileSha256(
  buffer: ArrayBuffer | Uint8Array | Buffer,
): string {
  let nodeBuf: Buffer;
  if (Buffer.isBuffer(buffer)) {
    nodeBuf = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    nodeBuf = Buffer.from(buffer);
  } else if (ArrayBuffer.isView(buffer)) {
    nodeBuf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    nodeBuf = Buffer.from(buffer as unknown as ArrayBuffer);
  }
  return createHash("sha256").update(nodeBuf).digest("hex");
}

/**
 * Computes SHA-256 hex digest of image bytes.
 */
export function computeImageSha256(
  buffer: ArrayBuffer | Uint8Array | Buffer,
): string {
  return computeFileSha256(buffer);
}

/**
 * Deterministic 64-bit (16-hex-char) structural/perceptual difference-hash
 * across 64 sampled byte-block averages. Skips standard PNG/JPEG header magic
 * bytes on payloads > 128 bytes so metadata tweaks do not alter the structural hash,
 * while distinct images produce distinct hashes.
 */
export function computePerceptualImageHash(
  imageBytes: ArrayBuffer | Uint8Array | Buffer,
): string {
  let buf: Buffer;
  if (Buffer.isBuffer(imageBytes)) {
    buf = imageBytes;
  } else if (imageBytes instanceof ArrayBuffer) {
    buf = Buffer.from(imageBytes);
  } else if (ArrayBuffer.isView(imageBytes)) {
    buf = Buffer.from(imageBytes.buffer, imageBytes.byteOffset, imageBytes.byteLength);
  } else {
    buf = Buffer.from(imageBytes as unknown as ArrayBuffer);
  }

  if (buf.length === 0) {
    return "0000000000000000";
  }

  let offset = 0;
  if (buf.length > 128) {
    const isPng =
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47;
    const isJpeg =
      buf.length >= 3 &&
      buf[0] === 0xff &&
      buf[1] === 0xd8 &&
      buf[2] === 0xff;

    if (isPng || isJpeg) {
      offset = Math.min(64, Math.floor(buf.length / 2));
    }
  }

  const slice = buf.subarray(offset);
  const sampleCount = 64;
  const averages: number[] = new Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor((i * slice.length) / sampleCount);
    const end = Math.max(
      start + 1,
      Math.floor(((i + 1) * slice.length) / sampleCount),
    );
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += slice[j];
    }
    averages[i] = sum / (end - start);
  }

  let hex = "";
  for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
    let byteVal = 0;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const i = byteIdx * 8 + bitIdx;
      const nextIdx = (i + 1) % sampleCount;
      if (averages[i] >= averages[nextIdx]) {
        byteVal |= 1 << (7 - bitIdx);
      }
    }
    hex += byteVal.toString(16).padStart(2, "0");
  }

  return hex;
}

/**
 * Joins `sources.map((s) => s.text)` normalized (NFC, \r\n -> \n, collapsed whitespace, trimmed).
 */
export function normalizeExtractedTextForHash(sources: SourceBlock[]): string {
  if (!sources || sources.length === 0) return "";
  return sources
    .map((s) => s.text)
    .join("\n")
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/**
 * Computes deterministic SHA-256 document content hash.
 * Produces the exact SHA-256 hex digest of `JSON.stringify({ text: normText, pages: input.pageCount ?? null, images: sortedImages })`
 * matching `computeContentHash` in `lib/rate-limit.ts`.
 */
export function computeDocumentContentHash(input: {
  sources?: SourceBlock[];
  normalizedText?: string;
  pageCount?: number | null;
  imageHashes?: string[];
}): string {
  let normText: string;
  if (input.normalizedText !== undefined) {
    normText = input.normalizedText.replace(/\r\n/g, "\n").trim();
  } else if (input.sources !== undefined) {
    normText = normalizeExtractedTextForHash(input.sources);
  } else {
    normText = "";
  }

  const sortedImages = input.imageHashes ? [...input.imageHashes].sort() : [];
  const payload = JSON.stringify({
    text: normText,
    pages: input.pageCount ?? null,
    images: sortedImages,
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}
