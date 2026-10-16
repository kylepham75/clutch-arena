import type { SourceBlock } from "@/lib/schemas/ingestion";

export interface BudgetResult {
  sources: SourceBlock[];
  wasBudgeted: boolean;
  originalCharacterCount: number;
  budgetedCharacterCount: number;
}

/**
 * Ensures extracted source blocks fit safely within AI provider rate limits
 * (such as Groq's 8,000 tokens-per-minute ceiling on free/on-demand tier).
 *
 * Max safe character budget:
 * - Default 16,000 characters is ~3,500 tokens of input text, leaving ample
 *   headroom for system prompt (~400 tokens), output schema (~800 tokens),
 *   and generated question outputs with variants (~1,500–2,000 tokens).
 */
export function budgetSourceBlocks(
  sources: SourceBlock[],
  maxCharacters = 16_000,
  focus?: string,
): BudgetResult {
  const originalCharacterCount = sources.reduce(
    (sum, s) => sum + s.text.length,
    0,
  );

  if (originalCharacterCount <= maxCharacters || sources.length <= 1) {
    return {
      sources,
      wasBudgeted: false,
      originalCharacterCount,
      budgetedCharacterCount: originalCharacterCount,
    };
  }

  const focusTerms = (focus || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Group sources by document (multi-doc has prefix doc0_, doc1_, etc.)
  const docGroups = new Map<string, SourceBlock[]>();
  for (const block of sources) {
    const docKey = block.id.startsWith("doc") && block.id.includes("_")
      ? block.id.split("_")[0]
      : "main";
    if (!docGroups.has(docKey)) {
      docGroups.set(docKey, []);
    }
    docGroups.get(docKey)!.push(block);
  }

  // Calculate character quota per document group
  const groupCount = docGroups.size;
  const quotaPerGroup = Math.max(1_000, Math.floor(maxCharacters / groupCount));

  const selectedBlocks: SourceBlock[] = [];

  for (const [, groupBlocks] of docGroups.entries()) {
    // Score blocks based on focus keyword matches and substantive length
    const scored = groupBlocks.map((block, index) => {
      let score = 0;
      const lowerText = block.text.toLowerCase();

      // Focus match bonus
      for (const term of focusTerms) {
        if (lowerText.includes(term)) score += 10;
      }

      // Meaningful content bonus (prefer substantial concepts over tiny fragments)
      if (block.text.trim().length >= 80) score += 2;
      if (block.text.trim().length >= 200) score += 2;

      // Position spread bonus: ensure coverage across beginning, middle, and conclusion
      const relativePos = index / Math.max(1, groupBlocks.length - 1);
      if (relativePos < 0.2 || (relativePos > 0.4 && relativePos < 0.6) || relativePos > 0.8) {
        score += 1;
      }

      return { block, score, index };
    });

    // If focus terms exist, prioritize matching blocks; otherwise maintain balanced spread
    if (focusTerms.length > 0) {
      scored.sort((a, b) => b.score - a.score || a.index - b.index);
    }

    let groupChars = 0;
    const groupSelected: { block: SourceBlock; index: number }[] = [];

    for (const item of scored) {
      if (groupChars + item.block.text.length <= quotaPerGroup || groupSelected.length === 0) {
        groupSelected.push(item);
        groupChars += item.block.text.length;
      }
    }

    // Restore original reading order for coherent generation
    groupSelected.sort((a, b) => a.index - b.index);
    selectedBlocks.push(...groupSelected.map((i) => i.block));
  }

  const budgetedCharacterCount = selectedBlocks.reduce(
    (sum, s) => sum + s.text.length,
    0,
  );

  return {
    sources: selectedBlocks,
    wasBudgeted: true,
    originalCharacterCount,
    budgetedCharacterCount,
  };
}
