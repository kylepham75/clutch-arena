import type { SourceBlock } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";
import { MAX_EXTRACTED_CHARACTERS } from "./limits";

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Extracts human-readable text and math notations from PPTX slide XML.
 */
function extractSlideXmlText(xml: string): string {
  if (!xml) return "";

  // Split into paragraphs (<a:p>...</a:p>)
  const paragraphMatches = xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/gi) || [xml];
  const paragraphTexts: string[] = [];

  for (const para of paragraphMatches) {
    // Extract regular text (<a:t>...</a:t>) and math text (<m:t>...</m:t>)
    const textMatches = para.match(/<(?:a|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|m):t>/gi);
    if (!textMatches) continue;

    const lineText = textMatches
      .map((tag) => {
        const inner = tag.replace(/^<(?:a|m):t(?:\s[^>]*)?>/i, "").replace(/<\/(?:a|m):t>$/i, "");
        return decodeXmlEntities(inner);
      })
      .join("");

    const trimmed = lineText.trim();
    if (trimmed) {
      paragraphTexts.push(trimmed);
    }
  }

  return paragraphTexts.join("\n");
}

export async function parsePptx(
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<{
  sources: SourceBlock[];
  pageCount: number;
  warnings: string[];
}> {
  signal?.throwIfAborted();

  // Validate ZIP header (PK\x03\x04)
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new IngestionError(
      "INVALID_PPTX",
      "This file does not contain a valid PowerPoint presentation.",
      422,
    );
  }

  const JSZip = (await import("jszip")).default;
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new IngestionError(
      "INVALID_PPTX",
      "Could not open PowerPoint file. It may be corrupted or password protected.",
      422,
    );
  }

  // Find all slide XML files: ppt/slides/slide1.xml, slide2.xml...
  const slideEntries: Array<{ num: number; path: string }> = [];
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;

  zip.forEach((relativePath) => {
    const match = relativePath.match(slideRegex);
    if (match) {
      slideEntries.push({
        num: parseInt(match[1], 10),
        path: relativePath,
      });
    }
  });

  if (slideEntries.length === 0) {
    throw new IngestionError(
      "EMPTY_PRESENTATION",
      "No slides found in this PowerPoint presentation.",
      422,
    );
  }

  // Sort slides numerically
  slideEntries.sort((a, b) => a.num - b.num);

  const sources: SourceBlock[] = [];
  let characterCount = 0;
  let emptySlides = 0;

  for (let i = 0; i < slideEntries.length; i++) {
    signal?.throwIfAborted();
    const slide = slideEntries[i];
    const file = zip.file(slide.path);
    if (!file) continue;

    const xml = await file.async("text");
    let text = extractSlideXmlText(xml);

    // Also look for corresponding speaker notes if available
    const notePath = `ppt/notesSlides/notesSlide${slide.num}.xml`;
    const noteFile = zip.file(notePath);
    if (noteFile) {
      try {
        const noteXml = await noteFile.async("text");
        const noteText = extractSlideXmlText(noteXml);
        // Exclude default placeholder slide number text from notes
        const cleanNotes = noteText.replace(/^Slide\s+\d+$/m, "").trim();
        if (cleanNotes && cleanNotes.length > 5) {
          text += `\n[Notes: ${cleanNotes}]`;
        }
      } catch {
        // Speaker notes optional
      }
    }

    if (!text.trim()) {
      emptySlides++;
      continue;
    }

    characterCount += text.length;
    if (characterCount > MAX_EXTRACTED_CHARACTERS) {
      throw new IngestionError(
        "TOO_MUCH_TEXT",
        "The presentation exceeds character limits. Split the deck by chapter.",
        413,
      );
    }

    sources.push({
      id: `slide-${slide.num}`,
      label: `Slide ${slide.num}`,
      text: text.trim(),
    });
  }

  if (sources.length === 0) {
    throw new IngestionError(
      "NO_TEXT_FOUND",
      "This slide deck contains only images with no extractable text. Please upload a deck with text or run OCR.",
      422,
    );
  }

  return {
    sources,
    pageCount: slideEntries.length,
    warnings: emptySlides
      ? [`${emptySlides} slide(s) contained only images or had no extractable text.`]
      : [],
  };
}
