import type { SourceBlock } from "@/lib/schemas/ingestion";

export interface BudgetResult {
  sources: SourceBlock[];
  wasBudgeted: boolean;
  originalCharacterCount: number;
  budgetedCharacterCount: number;
}

/**
 * Strips recurring publisher copyright footers, textbook edition headers,
 * and OCR placeholder tokens so substance scoring evaluates real instructional text.
 */
export function cleanSlideBoilerplate(text: string): string {
  return text
    .replace(/(?:copyright\s*)?©\s*\d{4}[^\r\n]*all rights reserved\.?/gi, "")
    .replace(/\b(?:sixth|fifth|fourth|global)\s+edition\b[^\r\n]*/gi, "")
    .replace(/\bBlank\b/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNonSubstantiveBoilerplate(cleanedText: string): boolean {
  if (!cleanedText) return true;

  // Publisher copyright / instructor-only disclaimer slide
  if (
    /\bsolely for the use of instructors\b|\bdissemination or sale of any part\b/i.test(
      cleanedText,
    )
  ) {
    return true;
  }

  const hasFormulasOrNumbers = /[=$]/.test(cleanedText);
  const nonEmptyLines = cleanedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Caption-only figure or table slide
  if (
    cleanedText.length < 100 &&
    /(?:^|\n)\s*(?:figure|table)\s+\d+/i.test(cleanedText) &&
    !hasFormulasOrNumbers
  ) {
    return true;
  }

  // Cover / title slide
  if (
    !hasFormulasOrNumbers &&
    /\b(chapter|appendix|part|module|unit|chương|phần)\s+(\d+|[ivx]+)\b/i.test(
      cleanedText,
    ) &&
    (cleanedText.length < 100 ||
      (nonEmptyLines.length <= 5 &&
        nonEmptyLines.every((line) => line.length < 90)))
  ) {
    return true;
  }

  // Chapter outline / table of contents without explanatory sentences
  if (
    /\b(chapter outline|table of contents|course outline|agenda|nội dung chương)\b/i.test(
      cleanedText,
    ) &&
    !hasFormulasOrNumbers
  ) {
    const explanatoryLines = nonEmptyLines.filter(
      (line) => line.length > 95 && /[.!?]$/.test(line),
    );
    if (explanatoryLines.length === 0) {
      return true;
    }
  }

  // Learning objectives slide without formulas or numerical data
  if (
    /\b(learning objectives|learning goals|mục tiêu bài học)\b/i.test(
      cleanedText,
    ) &&
    !hasFormulasOrNumbers
  ) {
    return true;
  }

  return false;
}

/**
 * Ensures extracted source blocks fit safely within AI provider rate limits
 * (such as Groq's 8,000 tokens-per-minute ceiling on free/on-demand tier).
 *
 * Max safe character budget:
 * - Default 18,000 characters is ~4,000 tokens of input text, leaving ample
 *   headroom for system prompt (~400 tokens), output schema (~800 tokens),
 *   and generated question outputs with variants (~1,500–2,000 tokens).
 */
export function budgetSourceBlocks(
  sources: SourceBlock[],
  maxCharacters = 18_000,
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
    const groupTotalChars = groupBlocks.reduce(
      (sum, b) => sum + b.text.length,
      0,
    );

    if (focusTerms.length === 0 && groupTotalChars <= quotaPerGroup) {
      selectedBlocks.push(...groupBlocks);
      continue;
    }

    // Score blocks based on focus keyword matches and substantive content
    const scored = groupBlocks.map((block, index) => {
      let score = 0;
      const lowerText = block.text.toLowerCase();
      const cleanedText = cleanSlideBoilerplate(block.text);

      // Focus match bonus
      for (const term of focusTerms) {
        if (lowerText.includes(term)) score += 10;
      }

      if (isNonSubstantiveBoilerplate(cleanedText)) {
        score -= 5;
      } else {
        const hasSubstantiveSignal =
          cleanedText.length >= 80 ||
          /[=$%]/.test(cleanedText) ||
          /\b(is defined as|refers to|formula|equation)\b/i.test(cleanedText);
        if (hasSubstantiveSignal) {
          score += 4;
        }
        if (cleanedText.length >= 200) {
          score += 2;
        }
      }

      // Position spread bonus: ensure coverage across beginning, middle, and conclusion
      const relativePos = index / Math.max(1, groupBlocks.length - 1);
      if (relativePos < 0.2 || (relativePos > 0.4 && relativePos < 0.6) || relativePos > 0.8) {
        score += 1;
      }

      return { block, score, index, cleanedLength: cleanedText.length };
    });

    let groupChars = 0;
    const groupSelected: { block: SourceBlock; index: number }[] = [];

    if (focusTerms.length > 0) {
      // Prioritize focus-matching and high-substance blocks
      scored.sort((a, b) => b.score - a.score || a.index - b.index);
      for (const item of scored) {
        if (
          groupChars + item.block.text.length <= quotaPerGroup ||
          groupSelected.length === 0
        ) {
          groupSelected.push(item);
          groupChars += item.block.text.length;
        }
      }
    } else {
      // Uniform stride sampling across substantive candidates so early, middle,
      // and late pages are evenly represented instead of front-truncating.
      const substantive = scored.filter((item) => item.score > 0);
      const fallback = scored.filter((item) => item.score <= 0);

      if (substantive.length > 0) {
        const totalSubstantiveChars = substantive.reduce(
          (sum, item) => sum + item.block.text.length,
          0,
        );
        const avgChars = Math.max(
          1,
          Math.floor(totalSubstantiveChars / substantive.length),
        );
        const targetCount = Math.min(
          substantive.length,
          Math.max(1, Math.floor(quotaPerGroup / avgChars)),
        );

        const pickedSubstantiveIndices = new Set<number>();
        let hitSubstantiveQuotaCeiling = false;

        for (let i = 0; i < targetCount; i++) {
          const subIdx = Math.min(
            substantive.length - 1,
            Math.floor((i * substantive.length) / targetCount),
          );
          if (pickedSubstantiveIndices.has(subIdx)) continue;
          const candidate = substantive[subIdx];
          if (
            groupChars + candidate.block.text.length <= quotaPerGroup ||
            groupSelected.length === 0
          ) {
            pickedSubstantiveIndices.add(subIdx);
            groupSelected.push(candidate);
            groupChars += candidate.block.text.length;
          } else {
            hitSubstantiveQuotaCeiling = true;
          }
        }

        // Second evenly-spaced pass over remaining substantive candidates if budget remains
        const remainingSubstantive = substantive.filter(
          (_, idx) => !pickedSubstantiveIndices.has(idx),
        );
        if (remainingSubstantive.length > 0 && groupChars < quotaPerGroup) {
          const remTarget = Math.min(
            remainingSubstantive.length,
            Math.max(
              1,
              Math.floor((quotaPerGroup - groupChars) / avgChars),
            ),
          );
          for (let i = 0; i < remTarget; i++) {
            const remIdx = Math.min(
              remainingSubstantive.length - 1,
              Math.floor((i * remainingSubstantive.length) / remTarget),
            );
            const candidate = remainingSubstantive[remIdx];
            if (groupSelected.some((s) => s.index === candidate.index)) {
              continue;
            }
            if (candidate.cleanedLength < 100 && hitSubstantiveQuotaCeiling) {
              continue;
            }
            if (groupChars + candidate.block.text.length <= quotaPerGroup) {
              groupSelected.push(candidate);
              groupChars += candidate.block.text.length;
            } else {
              hitSubstantiveQuotaCeiling = true;
            }
          }
        }

        // Only fall back to non-substantive blocks if all substantive blocks fit and budget remains
        if (
          !hitSubstantiveQuotaCeiling &&
          groupSelected.length === substantive.length &&
          groupChars < quotaPerGroup
        ) {
          for (const item of fallback) {
            if (groupChars + item.block.text.length <= quotaPerGroup) {
              groupSelected.push(item);
              groupChars += item.block.text.length;
            }
          }
        }
      } else {
        // Fallback if every block in the group scored <= 0
        for (const item of fallback) {
          if (
            groupChars + item.block.text.length <= quotaPerGroup ||
            groupSelected.length === 0
          ) {
            groupSelected.push(item);
            groupChars += item.block.text.length;
          }
        }
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
