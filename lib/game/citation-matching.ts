import type { SourceBlock } from "@/lib/schemas/ingestion";

/**
 * Resolves a SourceBlock from a citation string or ID with exact label & token matching.
 * Prevents naive substring collisions where "Page 1" falsely matches "Page 18".
 */
export function findSourceBlockByCitation(
  sources: SourceBlock[] | undefined,
  citationOrId: string | undefined,
  fallbackText?: string,
): SourceBlock | undefined {
  if (!sources || sources.length === 0 || !citationOrId) {
    return sources?.[0];
  }

  const raw = citationOrId.trim();

  // 1. Direct ID match (or prefix/suffix: doc0_source-18 or source-18)
  const idMatch = sources.find(
    (b) =>
      b.id === raw ||
      b.id.endsWith(`_${raw}`) ||
      raw.endsWith(`_${b.id}`) ||
      b.id === `doc0_${raw}`,
  );
  if (idMatch) return idMatch;

  // 2. Extract label part if citation format is "FileName.pdf · Page 18"
  const labelCandidate = raw.includes("·") ? raw.split("·").pop()!.trim() : raw;

  // 2a. Exact case-insensitive label match (e.g. "Page 18" === "Page 18")
  const exactLabelMatch = sources.find(
    (b) => b.label.trim().toLowerCase() === labelCandidate.toLowerCase(),
  );
  if (exactLabelMatch) return exactLabelMatch;

  // 3. Exact numerical token match (e.g. "Trang 18", "Slide 18", "Page 18", "Paragraph 18")
  // Prevents "Page 1" from falsely matching "Page 18"
  const targetNum =
    labelCandidate.match(/\b(?:page|slide|trang|paragraph|lines?|p\.?)\s*(\d+)\b/i)?.[1] ||
    labelCandidate.match(/\b(\d+)\b/)?.[1];

  if (targetNum) {
    const numMatch = sources.find((b) => {
      const bNum =
        b.label.match(/\b(?:page|slide|trang|paragraph|lines?|p\.?)\s*(\d+)\b/i)?.[1] ||
        b.label.match(/\b(\d+)\b/)?.[1];
      return bNum === targetNum;
    });
    if (numMatch) return numMatch;
  }

  // 4. Word-boundary regex match (strictly bounded: \bPage 1\b will not match "Page 18")
  const wordBoundaryMatch = sources.find((b) => {
    const escaped = b.label.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    return pattern.test(raw);
  });
  if (wordBoundaryMatch) return wordBoundaryMatch;

  // 5. Semantic / keyword fallback against slide text if a rule or question excerpt is provided
  if (fallbackText && fallbackText.trim().length >= 10) {
    const lowerFallback = fallbackText.toLowerCase();
    const textMatch = sources.find(
      (b) =>
        b.text.toLowerCase().includes(lowerFallback.slice(0, 40)) ||
        lowerFallback.includes(b.text.toLowerCase().slice(0, 40)),
    );
    if (textMatch) return textMatch;
  }

  return sources[0];
}
