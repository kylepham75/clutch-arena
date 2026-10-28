import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  type FormulaLedgerEntry,
  type NoteFormula,
  type NoteSection,
  type SynthesisOmittedFormula,
  type NoteOmittedFormula,
} from "@/lib/schemas/notes";
import {
  convertUnicodeMath,
  normalizeInventoryFormulaKey,
  parseSlideNumber,
} from "@/lib/notes/formula-inventory";

export interface FormulaCoverageResult {
  totalLedgerCount: number;
  placedIds: string[];
  uncapturedIds: string[];
  coverageRatio: number;
  duplicateOmittedIds: string[];
  omittedByRuleIds: string[];
  uncapturedErrorIds: string[];
}

export interface EvidenceQuoteMatchResult {
  matched: boolean;
  exactMatch: boolean;
  tokenOverlap: number;
  slideFound: boolean;
}

export interface FailedBulletQuote {
  sectionLetter: string;
  subHeading?: string;
  text: string;
  slide: number;
  evidence: string;
  tokenOverlap: number;
}

export interface FailedTakeawayQuote {
  sectionLetter: string;
  point: string;
  slide?: number;
  evidence?: string;
  tokenOverlap: number;
}

export interface SectionEvidenceQuotesResult {
  totalChecked: number;
  matchedCount: number;
  matchRatio: number;
  failedBullets: FailedBulletQuote[];
  failedTakeaways: FailedTakeawayQuote[];
}

export interface NumberGroundingResult {
  passed: boolean;
  ungroundedNumbers: string[];
  checkedNumbers: string[];
}

export interface FormulaSymbolSetResult {
  passed: boolean;
  extractedSymbols: string[];
  ungroundedSymbols: string[];
}

export interface DeterministicVerificationReport {
  passed: boolean;
  coverage: FormulaCoverageResult;
  evidence: SectionEvidenceQuotesResult;
  numbers: NumberGroundingResult;
  symbols: {
    passed: boolean;
    totalFormulasChecked: number;
    ungroundedSymbols: string[];
    perFormulaResults: Array<{
      latex: string;
      slide?: number;
      passed: boolean;
      extractedSymbols: string[];
      ungroundedSymbols: string[];
    }>;
  };
  summary: {
    coverageRatio: number;
    evidenceMatchRatio: number;
    numberGroundingPassed: boolean;
    symbolGroundingPassed: boolean;
    warnings: string[];
  };
}

export const DUPLICATE_REDUNDANT_REASON_REGEX =
  /\b(duplicate|redundant|same as|already (?:covered|included|placed|captured)|identical|equivalent|trùng|tương đương)\b/i;

export const OMITTED_BY_RULE_REASON_REGEX =
  /\b(duplicate|redundant|same as|already (?:covered|included|placed|captured)|identical|equivalent|trùng|tương đương|intermediate|derivation|rearrangement|rearranged|step|algebraic|simplified|expanded|derived|sub-step|biến đổi|trung gian|rút gọn|exercise|drill|example|numerical|plug-in|plugin|worked|practice|calculation|number|sample|illustration|bài tập|ví dụ|thay số)\b/i;

function hasNumericPlugIns(entry: FormulaLedgerEntry): boolean {
  const text = `${entry.raw} ${entry.latex}`;
  return /\d+\s*[\+\-\*\/]\s*\d+|\(\s*\d+/.test(text) || (text.match(/\d+(?:\.\d+)?/g) || []).length >= 2;
}

function extractLhsVariable(latexOrRaw: string): string | null {
  if (!latexOrRaw) return null;
  const match = latexOrRaw.match(/^(.*?)(?<![<>!])=(?![=>])/);
  if (!match) return null;
  const lhs = match[1].trim();
  const symbols = extractFormulaSymbols(lhs);
  if (symbols.length > 0) {
    return symbols[0].toLowerCase();
  }
  const cleaned = lhs
    .replace(/\\text\{([^}]+)\}|\\mathrm\{([^}]+)\}/g, "$1$2")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();
  return cleaned ? cleaned.toLowerCase() : null;
}

/**
 * Verifies formula coverage across note sections against the authoritative formula ledger.
 */
export function verifyFormulaCoverage(
  sections: NoteSection[],
  ledger: FormulaLedgerEntry[],
  omitted?: (SynthesisOmittedFormula | NoteOmittedFormula)[],
): FormulaCoverageResult {
  const placedFormulas: NoteFormula[] = [];
  for (const sec of sections) {
    if (Array.isArray(sec.formulas)) {
      placedFormulas.push(...sec.formulas);
    }
    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (Array.isArray(sub.formulas)) {
          placedFormulas.push(...sub.formulas);
        }
      }
    }
  }

  const placedRefs = new Set<string>();
  const placedDerived = new Set<string>();
  const placedLatexKeys = new Set<string>();

  for (const pf of placedFormulas) {
    if (Array.isArray(pf.formulaRefs)) {
      for (const ref of pf.formulaRefs) {
        if (ref) placedRefs.add(ref.trim());
      }
    }
    if (Array.isArray(pf.derivedFrom)) {
      for (const der of pf.derivedFrom) {
        if (der) placedDerived.add(der.trim());
      }
    }
    if (pf.latex) {
      const key = normalizeInventoryFormulaKey(pf.latex);
      if (key) placedLatexKeys.add(key);
    }
  }

  const placedIds: string[] = [];
  for (const entry of ledger) {
    const isDirectRef =
      placedRefs.has(entry.id) || placedDerived.has(entry.id);
    const entryLatexKey = normalizeInventoryFormulaKey(entry.latex);
    const entryRawKey = normalizeInventoryFormulaKey(entry.raw);
    const isFormulaKeyMatch =
      (entryLatexKey && placedLatexKeys.has(entryLatexKey)) ||
      (entryRawKey && placedLatexKeys.has(entryRawKey));

    if (isDirectRef || isFormulaKeyMatch) {
      placedIds.push(entry.id);
    }
  }

  const duplicateOmittedIds: string[] = [];
  if (Array.isArray(omitted)) {
    const ledgerIds = new Set(ledger.map((e) => e.id));
    for (const om of omitted) {
      if (
        om &&
        om.formulaId &&
        ledgerIds.has(om.formulaId) &&
        om.reason &&
        DUPLICATE_REDUNDANT_REASON_REGEX.test(om.reason)
      ) {
        if (!duplicateOmittedIds.includes(om.formulaId)) {
          duplicateOmittedIds.push(om.formulaId);
        }
      }
    }
  }

  const placedSet = new Set(placedIds);
  const uncapturedIds = ledger
    .filter((entry) => !placedSet.has(entry.id))
    .map((entry) => entry.id);

  // Track placed slide numbers
  const placedSlideNumbers = new Set<number>();
  for (const entry of ledger) {
    if (placedSet.has(entry.id)) {
      placedSlideNumbers.add(entry.slide);
    }
  }
  for (const pf of placedFormulas) {
    if (pf.slide) {
      placedSlideNumbers.add(pf.slide);
    }
  }

  // Track placed formulas per slide
  const placedFormulasBySlide = new Map<
    number,
    Array<{ latex: string; raw?: string; evidence?: string; label?: string }>
  >();
  const recordPlacedFormula = (slide: number, pf: { latex: string; raw?: string; evidence?: string; label?: string }) => {
    if (!placedFormulasBySlide.has(slide)) {
      placedFormulasBySlide.set(slide, []);
    }
    placedFormulasBySlide.get(slide)!.push(pf);
  };

  for (const entry of ledger) {
    if (placedSet.has(entry.id)) {
      recordPlacedFormula(entry.slide, entry);
    }
  }
  for (const pf of placedFormulas) {
    if (pf.slide && pf.latex) {
      recordPlacedFormula(pf.slide, pf);
    }
  }

  const isIntermediateRearrangement = (
    entry: FormulaLedgerEntry,
  ): boolean => {
    const entryText = `${entry.label || ""} ${entry.evidence || ""} ${entry.raw || ""}`;
    if (
      /\b(intermediate|derivation|rearrangement|rearranged|step|sub-step|biến đổi|trung gian|rút gọn)\b/i.test(
        entryText,
      )
    ) {
      return true;
    }

    const entryLhs = extractLhsVariable(entry.latex) || extractLhsVariable(entry.raw);
    if (!entryLhs) return false;

    const placedOnSlide = placedFormulasBySlide.get(entry.slide) || [];
    if (placedOnSlide.length === 0) return false;

    const entryRhsSymbols = extractFormulaSymbols(
      (entry.latex || entry.raw || "").replace(/^[^=]+=\s*/, ""),
    ).filter((s) => !/^\d+$/.test(s));

    for (const placed of placedOnSlide) {
      const placedLhs =
        extractLhsVariable(placed.latex) || extractLhsVariable(placed.raw || "");
      if (placedLhs !== entryLhs) continue;

      if (entryRhsSymbols.length === 0) return true;

      const placedSymbols = new Set(
        extractFormulaSymbols(placed.latex).concat(
          extractFormulaSymbols(placed.raw || ""),
        ),
      );

      const allRhsInPlaced = entryRhsSymbols.every((s) =>
        placedSymbols.has(s),
      );
      if (allRhsInPlaced) {
        return true;
      }
    }

    return false;
  };

  // Classify unplaced entries into omittedByRuleIds vs uncapturedErrorIds
  const omittedByRuleIds: string[] = [];
  const uncapturedErrorIds: string[] = [];

  for (const entry of ledger) {
    if (placedSet.has(entry.id)) continue;

    const om = Array.isArray(omitted)
      ? omitted.find((o) => o && o.formulaId === entry.id)
      : undefined;

    const isExplicitOmittedByRule =
      om &&
      ((om as any).status === "omitted_by_rule" ||
        (om.reason && OMITTED_BY_RULE_REASON_REGEX.test(om.reason)));

    const isExerciseRule =
      Boolean(entry.isExerciseOnly) &&
      (hasNumericPlugIns(entry) || placedSlideNumbers.has(entry.slide));

    const isRearrangementRule = isIntermediateRearrangement(entry);

    if (
      isExplicitOmittedByRule ||
      isExerciseRule ||
      isRearrangementRule
    ) {
      omittedByRuleIds.push(entry.id);
    } else {
      uncapturedErrorIds.push(entry.id);
    }
  }

  const coverageRatio =
    ledger.length === 0 ? 1 : placedIds.length / ledger.length;

  return {
    totalLedgerCount: ledger.length,
    placedIds,
    uncapturedIds,
    coverageRatio,
    duplicateOmittedIds,
    omittedByRuleIds,
    uncapturedErrorIds,
  };
}

/**
 * Normalizes quote or slide text for exact and fuzzy matching.
 */
function normalizeEvidenceText(text: string): string {
  if (!text) return "";
  let s = text.trim();
  s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  s = convertUnicodeMath(s);
  s = s.replace(/\$/g, "");
  s = s.toLowerCase();
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Tokenizes evidence and slide text into content words, numbers, and math tokens.
 */
function tokenizeEvidence(text: string): string[] {
  const tokens = text.match(/[a-z0-9_]+%?|[+\-*/=^\\<>~]/g) || [];
  return tokens.filter((t) => t.trim().length > 0);
}

/**
 * Verifies whether an evidence quote matches the content of the target slide.
 */
export function verifyEvidenceQuoteMatch(
  evidence: string,
  slideNumber: number,
  sources: SourceBlock[],
): EvidenceQuoteMatchResult {
  const targetSources = sources.filter(
    (src, idx) => parseSlideNumber(src, idx) === slideNumber,
  );
  const slideFound = targetSources.length > 0;

  let slideText = "";
  if (slideFound) {
    slideText = targetSources.map((s) => s.text || "").join("\n");
  } else {
    slideText = sources.map((s) => s.text || "").join("\n");
  }

  const normEvidence = normalizeEvidenceText(evidence);
  const normSlide = normalizeEvidenceText(slideText);

  if (!normEvidence) {
    return {
      matched: false,
      exactMatch: false,
      tokenOverlap: 0,
      slideFound,
    };
  }

  const exactMatch = normSlide.includes(normEvidence);
  if (exactMatch) {
    return {
      matched: slideFound,
      exactMatch: true,
      tokenOverlap: 1,
      slideFound,
    };
  }

  const evTokens = tokenizeEvidence(normEvidence);
  const slTokens = tokenizeEvidence(normSlide);

  if (evTokens.length === 0 || slTokens.length === 0) {
    return {
      matched: false,
      exactMatch: false,
      tokenOverlap: 0,
      slideFound,
    };
  }

  const windowSize = Math.max(
    evTokens.length,
    Math.min(slTokens.length, evTokens.length * 2 + 4),
  );
  let maxWindowMatches = 0;

  for (
    let i = 0;
    i <= slTokens.length - Math.min(slTokens.length, evTokens.length);
    i++
  ) {
    const windowSlice = slTokens.slice(i, i + windowSize);
    const windowMap = new Map<string, number>();
    for (const t of windowSlice) {
      windowMap.set(t, (windowMap.get(t) || 0) + 1);
    }

    let matchCount = 0;
    for (const et of evTokens) {
      const count = windowMap.get(et) || 0;
      if (count > 0) {
        matchCount++;
        windowMap.set(et, count - 1);
      }
    }

    if (matchCount > maxWindowMatches) {
      maxWindowMatches = matchCount;
      if (maxWindowMatches === evTokens.length) break;
    }
  }

  const allSlideTokensSet = new Set(slTokens);
  const overallMatches = evTokens.filter((t) => allSlideTokensSet.has(t)).length;
  const bestMatchCount = Math.max(maxWindowMatches, overallMatches);
  const tokenOverlap = Number((bestMatchCount / evTokens.length).toFixed(4));

  const passesTokenThreshold =
    evTokens.length >= 3 ? tokenOverlap >= 0.75 : tokenOverlap === 1;
  const matched = slideFound && (exactMatch || passesTokenThreshold);

  return {
    matched,
    exactMatch,
    tokenOverlap,
    slideFound,
  };
}

/**
 * Checks all grounded bullets and key takeaways across sections against source slides.
 */
export function verifySectionEvidenceQuotes(
  sections: NoteSection[],
  sources: SourceBlock[],
): SectionEvidenceQuotesResult {
  let totalChecked = 0;
  let matchedCount = 0;
  const failedBullets: FailedBulletQuote[] = [];
  const failedTakeaways: FailedTakeawayQuote[] = [];

  const allSlideNumbers: number[] = sources.map((src, idx) =>
    parseSlideNumber(src, idx),
  );

  for (const sec of sections) {
    if (Array.isArray(sec.groundedBullets)) {
      for (const bullet of sec.groundedBullets) {
        totalChecked++;
        const matchRes = verifyEvidenceQuoteMatch(
          bullet.evidence,
          bullet.slide,
          sources,
        );
        if (matchRes.matched) {
          matchedCount++;
        } else {
          failedBullets.push({
            sectionLetter: sec.letter,
            text: bullet.text,
            slide: bullet.slide,
            evidence: bullet.evidence,
            tokenOverlap: matchRes.tokenOverlap,
          });
        }
      }
    }

    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (Array.isArray(sub.groundedBullets)) {
          for (const bullet of sub.groundedBullets) {
            totalChecked++;
            const matchRes = verifyEvidenceQuoteMatch(
              bullet.evidence,
              bullet.slide,
              sources,
            );
            if (matchRes.matched) {
              matchedCount++;
            } else {
              failedBullets.push({
                sectionLetter: sec.letter,
                subHeading: sub.heading,
                text: bullet.text,
                slide: bullet.slide,
                evidence: bullet.evidence,
                tokenOverlap: matchRes.tokenOverlap,
              });
            }
          }
        }
      }
    }

    if (sec.keyTakeaways && Array.isArray(sec.keyTakeaways.items)) {
      for (const item of sec.keyTakeaways.items) {
        totalChecked++;
        if (item.evidence && item.slide) {
          const matchRes = verifyEvidenceQuoteMatch(
            item.evidence,
            item.slide,
            sources,
          );
          if (matchRes.matched) {
            matchedCount++;
          } else {
            failedTakeaways.push({
              sectionLetter: sec.letter,
              point: item.point,
              slide: item.slide,
              evidence: item.evidence,
              tokenOverlap: matchRes.tokenOverlap,
            });
          }
        } else {
          const candidateSlides =
            sec.sourceSlides && sec.sourceSlides.length > 0
              ? sec.sourceSlides
              : allSlideNumbers;

          let bestOverlap = 0;
          let anyMatched = false;

          for (const cSlide of candidateSlides) {
            const matchRes = verifyEvidenceQuoteMatch(
              item.point,
              cSlide,
              sources,
            );
            if (matchRes.tokenOverlap > bestOverlap) {
              bestOverlap = matchRes.tokenOverlap;
            }
            if (matchRes.matched) {
              anyMatched = true;
              break;
            }
          }

          if (anyMatched) {
            matchedCount++;
          } else {
            failedTakeaways.push({
              sectionLetter: sec.letter,
              point: item.point,
              slide: item.slide,
              evidence: item.evidence,
              tokenOverlap: bestOverlap,
            });
          }
        }
      }
    }
  }

  const matchRatio =
    totalChecked === 0 ? 1 : Number((matchedCount / totalChecked).toFixed(4));

  return {
    totalChecked,
    matchedCount,
    matchRatio,
    failedBullets,
    failedTakeaways,
  };
}

/**
 * Extracts domain-significant numbers from note prose and formulas while ignoring
 * pedagogical numbering and benign mathematical identities.
 */
export function extractDomainNumbers(text: string): string[] {
  if (!text || !text.trim()) return [];

  let s = text;

  // 1. Strip LaTeX subscripts and superscripts
  s = s.replace(/_(?:\{[^{}]+\}|[0-9a-zA-Z])/g, " ");
  s = s.replace(/\^(?:\{[^{}]+\}|[0-9a-zA-Z])/g, " ");

  // 2. Strip benign mathematical identity expressions: 1 + R, 1 - T_C, g = 0, 100%, 0%
  s = s.replace(/(?<!\d)\b1\s*[+\-*/]\s*[a-zA-Z]/g, " ");
  s = s.replace(/[a-zA-Z]\s*[+\-*/]\s*1\b(?!\.\d)/g, " ");
  s = s.replace(/[a-zA-Z]\s*=\s*0\b(?!\.\d)/g, " ");
  s = s.replace(/\b100\s*%/g, " ");
  s = s.replace(/\b0\s*%/g, " ");

  // 3. Strip structural and pedagogical numbering
  s = s.replace(
    /\b(?:case|step|slide|page|chương|bước|phần|trang)\s+\d+\b/gi,
    " ",
  );
  s = s.replace(/(?:^|[\r\n])\s*\d+[\.\)]\s+/g, " ");
  s = s.replace(/\(\d+\)/g, " ");
  s = s.replace(/\b\d+-(?:period|stage|year|giai đoạn|năm)\b/gi, " ");
  s = s.replace(
    /\b(?:1|2|3)\s+(?:period|stage|year|giai đoạn|năm|parts|phần)\b/gi,
    " ",
  );

  const found: string[] = [];

  // Match currency values: $4.50, $50, 4.50$, 1,000 VND
  const currencyRegex =
    /(?:[\$€£₫]|USD|VND)\s*(\d+(?:,\d{3})*(?:\.\d+)?)|(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:[\$€£₫]|USD|VND)/gi;
  let curMatch: RegExpExecArray | null;
  while ((curMatch = currencyRegex.exec(s)) !== null) {
    const rawVal = curMatch[1] || curMatch[2];
    if (rawVal) {
      const cleanVal = rawVal.replace(/,/g, "");
      found.push(cleanVal);
    }
  }
  s = s.replace(currencyRegex, " ");

  // Match percentage figures: 25%, 15%, 0.25%
  const percentRegex = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*%/g;
  let pctMatch: RegExpExecArray | null;
  while ((pctMatch = percentRegex.exec(s)) !== null) {
    const rawVal = pctMatch[1];
    if (rawVal) {
      const cleanVal = rawVal.replace(/,/g, "") + "%";
      found.push(cleanVal);
    }
  }
  s = s.replace(percentRegex, " ");

  // Match multipliers: 2.5x, 3x
  const multRegex = /\b(\d+(?:\.\d+)?)\s*x\b/gi;
  let multMatch: RegExpExecArray | null;
  while ((multMatch = multRegex.exec(s)) !== null) {
    const rawVal = multMatch[1];
    if (rawVal) {
      found.push(rawVal);
    }
  }
  s = s.replace(multRegex, " ");

  // Match decimals: 0.25, 12.5, 360.5
  const decimalRegex = /\b(\d+\.\d+)\b/g;
  let decMatch: RegExpExecArray | null;
  while ((decMatch = decimalRegex.exec(s)) !== null) {
    found.push(decMatch[1]);
  }
  s = s.replace(decimalRegex, " ");

  // Match multi-digit integers: 360, 365, 2025, 1,000, 50
  const intRegex = /\b(\d{1,3}(?:,\d{3})+|\d{2,})\b/g;
  let intMatch: RegExpExecArray | null;
  while ((intMatch = intRegex.exec(s)) !== null) {
    const rawVal = intMatch[1];
    found.push(rawVal.replace(/,/g, ""));
  }

  const results: string[] = [];
  const seen = new Set<string>();

  for (const item of found) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed === "0" || trimmed === "1") continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    results.push(trimmed);
  }

  return results;
}

/**
 * Checks whether an extracted domain number is grounded in the source corpus.
 */
function isNumberGrounded(numStr: string, sourceCorpus: string): boolean {
  if (!numStr || !sourceCorpus) return false;

  // Direct substring match
  if (sourceCorpus.includes(numStr)) {
    return true;
  }

  // Percentage <-> Decimal equivalence
  if (numStr.endsWith("%")) {
    const pctVal = parseFloat(numStr.slice(0, -1));
    if (!isNaN(pctVal)) {
      const decVal = Number((pctVal / 100).toFixed(6));
      const decStr = decVal.toString();
      if (sourceCorpus.includes(decStr)) {
        return true;
      }
      // Alternative formats: e.g. .25 for 0.25
      if (decStr.startsWith("0.")) {
        const altDec = decStr.slice(1);
        if (sourceCorpus.includes(altDec)) return true;
      }
      // Check spaced percentage e.g. "25 %"
      if (sourceCorpus.includes(`${pctVal} %`)) {
        return true;
      }
    }
  } else if (numStr.includes(".")) {
    const decVal = parseFloat(numStr);
    if (!isNaN(decVal) && decVal > 0 && decVal < 1) {
      const pctVal = Number((decVal * 100).toFixed(4));
      const pctStr = `${pctVal}%`;
      if (
        sourceCorpus.includes(pctStr) ||
        sourceCorpus.includes(`${pctVal} %`)
      ) {
        return true;
      }
    }
  }

  // Currency decimal formatting: e.g. 4.5 vs 4.50
  const floatVal = parseFloat(numStr);
  if (!isNaN(floatVal)) {
    const altFloatStr = floatVal.toString();
    if (altFloatStr !== numStr && sourceCorpus.includes(altFloatStr)) {
      return true;
    }
  }

  // Word boundary check for integers
  if (/^\d+$/.test(numStr)) {
    const intRegex = new RegExp(`\\b${numStr}\\b`);
    if (intRegex.test(sourceCorpus)) {
      return true;
    }
  }

  return false;
}

/**
 * Verifies domain-significant numbers in note prose and formulas against source slides and formula ledger.
 */
export function verifyNumberGrounding(
  sections: NoteSection[],
  sources: SourceBlock[],
  ledger?: FormulaLedgerEntry[],
): NumberGroundingResult {
  const noteTextParts: string[] = [];

  for (const sec of sections) {
    if (sec.titleVi) noteTextParts.push(sec.titleVi);
    if (sec.titleEn) noteTextParts.push(sec.titleEn);
    if (sec.coreStatement) noteTextParts.push(sec.coreStatement);
    if (sec.overview) noteTextParts.push(sec.overview);
    if (Array.isArray(sec.bulletPoints)) {
      noteTextParts.push(...sec.bulletPoints);
    }
    if (Array.isArray(sec.groundedBullets)) {
      noteTextParts.push(...sec.groundedBullets.map((b) => b.text));
    }
    if (Array.isArray(sec.formulas)) {
      for (const f of sec.formulas) {
        if (f.latex) noteTextParts.push(f.latex);
        if (f.leadText) noteTextParts.push(f.leadText);
        if (f.description) noteTextParts.push(f.description);
      }
    }
    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (sub.heading) noteTextParts.push(sub.heading);
        if (sub.leadIn) noteTextParts.push(sub.leadIn);
        if (Array.isArray(sub.bulletPoints)) {
          noteTextParts.push(...sub.bulletPoints);
        }
        if (Array.isArray(sub.groundedBullets)) {
          noteTextParts.push(...sub.groundedBullets.map((b) => b.text));
        }
        if (Array.isArray(sub.formulas)) {
          for (const f of sub.formulas) {
            if (f.latex) noteTextParts.push(f.latex);
            if (f.leadText) noteTextParts.push(f.leadText);
            if (f.description) noteTextParts.push(f.description);
          }
        }
      }
    }
    if (sec.keyTakeaways) {
      if (Array.isArray(sec.keyTakeaways.items)) {
        for (const item of sec.keyTakeaways.items) {
          if (item.point) noteTextParts.push(item.point);
          if (Array.isArray(item.subBullets)) {
            noteTextParts.push(...item.subBullets);
          }
        }
      }
      if (Array.isArray(sec.keyTakeaways.summaryPoints)) {
        noteTextParts.push(...sec.keyTakeaways.summaryPoints);
      }
    }
  }

  const combinedNoteText = noteTextParts.join("\n");
  const checkedNumbers = extractDomainNumbers(combinedNoteText);

  const sourceParts: string[] = sources.map((s) => s.text || "");
  if (Array.isArray(ledger)) {
    for (const entry of ledger) {
      if (entry.raw) sourceParts.push(entry.raw);
      if (entry.latex) sourceParts.push(entry.latex);
      if (entry.label) sourceParts.push(entry.label);
      if (entry.evidence) sourceParts.push(entry.evidence);
    }
  }

  // Normalize source corpus numbers (strip thousand commas)
  const sourceCorpus = sourceParts
    .join("\n")
    .replace(/(\d+),(\d{3})/g, "$1$2");

  const ungroundedNumbers: string[] = [];
  for (const num of checkedNumbers) {
    if (!isNumberGrounded(num, sourceCorpus)) {
      ungroundedNumbers.push(num);
    }
  }

  return {
    passed: ungroundedNumbers.length === 0,
    ungroundedNumbers,
    checkedNumbers,
  };
}

/**
 * Extracts variable symbols from a LaTeX formula string.
 */
export function extractFormulaSymbols(latex: string): string[] {
  if (!latex || !latex.trim()) return [];

  let s = latex.replace(/^\s*\$+|\$+\s*$/g, "").trim();

  // 1. Identify dummy summation indices (e.g. \sum_{t=1}^n -> t is bound dummy index)
  const boundSumIndices = new Set<string>();
  const sumRegex = /\\sum_\{([a-zA-Z])\s*=|\\sum_([a-zA-Z])=/g;
  let sumMatch: RegExpExecArray | null;
  while ((sumMatch = sumRegex.exec(s)) !== null) {
    const idx = sumMatch[1] || sumMatch[2];
    if (idx) boundSumIndices.add(idx);
  }

  // 2. Extract multi-word terms or acronyms inside \text{...}, \mathrm{...}, etc.
  const extractedTerms: string[] = [];
  const textCommandRegex =
    /\\(?:text|mathrm|mathbf|boldsymbol|textbf|operatorname)\{([^{}]+)\}/g;
  let tcMatch: RegExpExecArray | null;
  while ((tcMatch = textCommandRegex.exec(s)) !== null) {
    const inner = tcMatch[1].trim();
    if (inner && !/^[0-9.\s+\-*/()]+$/.test(inner)) {
      extractedTerms.push(inner);
    }
  }
  s = s.replace(textCommandRegex, " ");

  // 3. Extract subscripted variables: P_0, D_1, R_E, T_C, CF_t, \sigma_i, \beta_i
  const subscriptedSymbols: string[] = [];
  const subscriptRegex =
    /(\\[a-zA-Z]+|[a-zA-Z]{1,4})_(?:\{([^{}]+)\}|([a-zA-Z0-9]+))/g;
  let subMatch: RegExpExecArray | null;
  while ((subMatch = subscriptRegex.exec(s)) !== null) {
    const base = subMatch[1];
    const sub = subMatch[2] || subMatch[3];
    const cleanSub = sub ? sub.trim() : "";
    const fullSym = `${base}_${cleanSub}`;
    subscriptedSymbols.push(fullSym);
  }
  s = s.replace(subscriptRegex, " ");

  // 4. Extract superscripted variables: \sigma^2, s^2
  const superscriptSymbols: string[] = [];
  const superscriptRegex =
    /(\\[a-zA-Z]+|[a-zA-Z]{1,4})\^(?:\{([^{}]+)\}|([a-zA-Z0-9]+))/g;
  let supMatch: RegExpExecArray | null;
  while ((supMatch = superscriptRegex.exec(s)) !== null) {
    const base = supMatch[1];
    const sup = supMatch[2] || supMatch[3];
    if (sup === "2") {
      superscriptSymbols.push(`${base}^2`);
      superscriptSymbols.push(base);
    } else if (sup && /^[a-zA-Z]$/.test(sup)) {
      if (!boundSumIndices.has(sup)) {
        superscriptSymbols.push(sup);
      }
    }
  }
  s = s.replace(superscriptRegex, " ");

  // 5. Extract Greek letter symbols: \beta, \sigma, \lambda, \rho, etc.
  const greekSymbols: string[] = [];
  const greekRegex =
    /\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)\b/g;
  let grkMatch: RegExpExecArray | null;
  while ((grkMatch = greekRegex.exec(s)) !== null) {
    greekSymbols.push(`\\${grkMatch[1]}`);
  }
  s = s.replace(greekRegex, " ");

  // 6. Strip standard LaTeX structural commands and formatting
  s = s.replace(
    /\\(?:frac|sum|prod|sqrt|left|right|times|cdot|div|pm|mp|le|ge|leq|geq|neq|ne|approx|equiv|sim|quad|qquad|bar|hat|tilde|Delta|infty|int|partial|displaystyle|limits|nolimits)\b/g,
    " ",
  );

  // 7. Extract remaining standalone acronyms (2+ capital letters) and variable letters
  const standaloneSymbols: string[] = [];
  const acronymRegex = /\b[A-Z]{2,6}\b/g;
  let acMatch: RegExpExecArray | null;
  while ((acMatch = acronymRegex.exec(s)) !== null) {
    standaloneSymbols.push(acMatch[0]);
  }
  s = s.replace(acronymRegex, " ");

  const singleVarRegex = /\b([a-zA-Z])\b/g;
  let svMatch: RegExpExecArray | null;
  while ((svMatch = singleVarRegex.exec(s)) !== null) {
    const v = svMatch[1];
    if (!boundSumIndices.has(v)) {
      standaloneSymbols.push(v);
    }
  }

  const allSymbols = [
    ...extractedTerms,
    ...subscriptedSymbols,
    ...superscriptSymbols,
    ...greekSymbols,
    ...standaloneSymbols,
  ];

  const results: string[] = [];
  const seen = new Set<string>();

  for (const sym of allSymbols) {
    const trimmed = sym.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    results.push(trimmed);
  }

  return results;
}

/**
 * Standard financial and mathematical concept equivalence keywords for symbols.
 */
const SYMBOL_EQUIVALENCE_KEYWORDS: Record<string, string[]> = {
  "\\sigma": [
    "sigma",
    "standard deviation",
    "variance",
    "độ lệch chuẩn",
    "phương sai",
  ],
  "\\sigma^2": ["variance", "phương sai", "sigma^2", "sigma"],
  "\\beta": ["beta", "hệ số beta"],
  "\\beta_i": ["beta", "hệ số beta"],
  "\\rho": ["correlation", "hệ số tương quan", "rho"],
  "s": ["sample variance", "phương sai mẫu", "standard deviation"],
  "s^2": ["sample variance", "phương sai mẫu", "variance"],
  "R": [
    "discount rate",
    "required return",
    "rate of return",
    "cost of capital",
    "tỷ suất sinh lời",
    "lãi suất",
    "lợi suất",
  ],
  "r": [
    "discount rate",
    "required return",
    "rate of return",
    "cost of capital",
    "tỷ suất sinh lời",
    "lãi suất",
    "lợi suất",
  ],
  "g": ["growth rate", "tốc độ tăng trưởng", "tăng trưởng"],
  "D": ["dividend", "cổ tức"],
  "P": ["price", "stock price", "giá", "thị giá"],
  "T_C": ["tax", "corporate tax", "thuế", "thuế suất"],
  "t": ["tax", "tax rate", "period", "thời gian", "kỳ"],
  "r_f": ["risk-free", "phi rủi ro"],
  "R_f": ["risk-free", "phi rủi ro"],
  "CF": ["cash flow", "dòng tiền"],
  "CF_t": ["cash flow", "dòng tiền"],
  "E": ["equity", "vốn chủ sở hữu"],
  "V": ["value", "firm value", "giá trị"],
  "w": ["weight", "tỷ trọng"],
  "ROE": ["roe", "return on equity"],
  "ROA": ["roa", "return on assets"],
  "NPV": ["npv", "net present value"],
  "IRR": ["irr", "internal rate of return"],
  "WACC": ["wacc", "weighted average cost of capital"],
};

/**
 * Checks whether an extracted mathematical variable symbol is grounded in ledger entries or source slides.
 */
function isSymbolGrounded(
  symbol: string,
  targetSlideText: string,
  deckText: string,
  ledgerCorpus: string,
): boolean {
  if (!symbol) return false;

  const convertedTarget = convertUnicodeMath(targetSlideText);
  const normTarget = convertedTarget.toLowerCase();
  const convertedDeck = convertUnicodeMath(deckText);
  const normDeck = convertedDeck.toLowerCase();
  const normLedger = convertUnicodeMath(ledgerCorpus).toLowerCase();
  const normSym = convertUnicodeMath(symbol).toLowerCase();

  // 1. Direct match in ledger entries (raw, latex, or variables)
  if (
    normLedger.includes(normSym) ||
    normLedger.includes(symbol.toLowerCase())
  ) {
    return true;
  }

  // 2. Direct match in target slide
  if (
    normTarget.includes(normSym) ||
    normTarget.includes(symbol.toLowerCase())
  ) {
    return true;
  }

  // 3. For subscripted variables (e.g. P_0 -> match P0, P_0, or base P and index 0)
  if (symbol.includes("_")) {
    const parts = symbol.split("_");
    const base = parts[0].replace(/\\/g, "").toLowerCase();
    const sub = parts[1].toLowerCase();
    const compact = `${base}${sub}`;
    if (
      normTarget.includes(compact) ||
      normLedger.includes(compact) ||
      normDeck.includes(symbol.toLowerCase()) ||
      normDeck.includes(compact)
    ) {
      return true;
    }
  }

  // 4. For Greek letters (\beta -> match beta or β; \lambda -> match lambda or λ)
  if (symbol.startsWith("\\")) {
    const greekName = symbol.slice(1).toLowerCase();
    if (
      normTarget.includes(greekName) ||
      normLedger.includes(greekName)
    ) {
      return true;
    }
  }

  // 5. Concept equivalence keywords (checked strictly on target slide or referenced ledger)
  const keywords =
    SYMBOL_EQUIVALENCE_KEYWORDS[symbol] ||
    SYMBOL_EQUIVALENCE_KEYWORDS[symbol.replace(/_[a-zA-Z0-9]+$/, "")];

  if (keywords) {
    for (const kw of keywords) {
      if (normTarget.includes(kw) || normLedger.includes(kw)) {
        return true;
      }
    }
  }

  // 6. Single variable letter in target slide or ledger formulas or definitions
  if (/^[a-zA-Z]$/.test(symbol)) {
    const singleTokenRegex = new RegExp(
      `(?:^|[^a-zA-Z])${symbol}(?:[^a-zA-Z]|$)`,
      "i",
    );
    if (
      singleTokenRegex.test(convertedTarget) ||
      singleTokenRegex.test(ledgerCorpus) ||
      singleTokenRegex.test(convertedDeck)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Verifies that all symbols in a formula are grounded in slides, ledger, or domain equivalences.
 */
export function verifyFormulaSymbolSet(
  formula: NoteFormula,
  sources: SourceBlock[],
  ledger?: FormulaLedgerEntry[],
): FormulaSymbolSetResult {
  const extractedSymbols = extractFormulaSymbols(formula.latex);
  if (extractedSymbols.length === 0) {
    return {
      passed: true,
      extractedSymbols: [],
      ungroundedSymbols: [],
    };
  }

  // Target slide text: if formula.slide is provided, use only that slide's text
  let slideText = "";
  if (formula.slide) {
    const matching = sources.filter(
      (src, idx) => parseSlideNumber(src, idx) === formula.slide,
    );
    if (matching.length > 0) {
      slideText = matching.map((s) => s.text || "").join("\n");
    }
  }
  const deckText = sources.map((s) => s.text || "").join("\n");
  const targetSlideText = slideText || deckText;

  // Build ledger corpus (prioritizing formulaRefs, derivedFrom, and formula.slide)
  const ledgerParts: string[] = [];
  if (Array.isArray(ledger)) {
    const refIds = new Set([
      ...(formula.formulaRefs || []),
      ...(formula.derivedFrom || []),
    ]);

    const hasSpecificContext = refIds.size > 0 || Boolean(formula.slide);

    for (const entry of ledger) {
      const isDirectRef = refIds.has(entry.id);
      const isSameSlide = formula.slide && entry.slide === formula.slide;
      if (isDirectRef || isSameSlide || !hasSpecificContext) {
        ledgerParts.push(entry.raw, entry.latex, entry.label || "");
        if (Array.isArray(entry.variables)) {
          for (const v of entry.variables) {
            ledgerParts.push(v.symbol, v.definition);
          }
        }
      }
    }
  }

  const ledgerCorpus = ledgerParts.join("\n");

  const ungroundedSymbols: string[] = [];
  for (const sym of extractedSymbols) {
    if (!isSymbolGrounded(sym, targetSlideText, deckText, ledgerCorpus)) {
      ungroundedSymbols.push(sym);
    }
  }

  return {
    passed: ungroundedSymbols.length === 0,
    extractedSymbols,
    ungroundedSymbols,
  };
}

/**
 * Runs all 4 deterministic verifiers (coverage, evidence, numbers, symbols)
 * and returns a consolidated verification report.
 */
export function runDeterministicVerifiers(input: {
  sections: NoteSection[];
  sources: SourceBlock[];
  ledger: FormulaLedgerEntry[];
  omitted?: (SynthesisOmittedFormula | NoteOmittedFormula)[];
}): DeterministicVerificationReport {
  const coverage = verifyFormulaCoverage(
    input.sections,
    input.ledger,
    input.omitted,
  );
  const evidence = verifySectionEvidenceQuotes(input.sections, input.sources);
  const numbers = verifyNumberGrounding(
    input.sections,
    input.sources,
    input.ledger,
  );

  const perFormulaResults: Array<{
    latex: string;
    slide?: number;
    passed: boolean;
    extractedSymbols: string[];
    ungroundedSymbols: string[];
  }> = [];

  const allUngroundedSymbols = new Set<string>();

  for (const sec of input.sections) {
    for (const f of sec.formulas || []) {
      const res = verifyFormulaSymbolSet(f, input.sources, input.ledger);
      perFormulaResults.push({
        latex: f.latex,
        slide: f.slide,
        passed: res.passed,
        extractedSymbols: res.extractedSymbols,
        ungroundedSymbols: res.ungroundedSymbols,
      });
      for (const s of res.ungroundedSymbols) {
        allUngroundedSymbols.add(s);
      }
    }

    for (const sub of sec.subSections || []) {
      for (const f of sub.formulas || []) {
        const res = verifyFormulaSymbolSet(f, input.sources, input.ledger);
        perFormulaResults.push({
          latex: f.latex,
          slide: f.slide,
          passed: res.passed,
          extractedSymbols: res.extractedSymbols,
          ungroundedSymbols: res.ungroundedSymbols,
        });
        for (const s of res.ungroundedSymbols) {
          allUngroundedSymbols.add(s);
        }
      }
    }
  }

  const symbolsPassed = allUngroundedSymbols.size === 0;

  const warnings: string[] = [];
  if (coverage.uncapturedErrorIds.length > 0) {
    warnings.push(
      `Uncaptured formula IDs: ${coverage.uncapturedErrorIds.join(", ")}`,
    );
  }
  if (evidence.failedBullets.length > 0) {
    warnings.push(
      `${evidence.failedBullets.length} grounded bullet(s) failed quote verification`,
    );
  }
  if (evidence.failedTakeaways.length > 0) {
    warnings.push(
      `${evidence.failedTakeaways.length} key takeaway(s) failed quote verification`,
    );
  }
  if (numbers.ungroundedNumbers.length > 0) {
    warnings.push(
      `Ungrounded numbers: ${numbers.ungroundedNumbers.join(", ")}`,
    );
  }
  if (allUngroundedSymbols.size > 0) {
    warnings.push(
      `Ungrounded formula symbols: ${Array.from(allUngroundedSymbols).join(", ")}`,
    );
  }

  const passed =
    coverage.coverageRatio >= 0.8 &&
    evidence.matchRatio >= 0.8 &&
    numbers.passed &&
    symbolsPassed;

  return {
    passed,
    coverage,
    evidence,
    numbers,
    symbols: {
      passed: symbolsPassed,
      totalFormulasChecked: perFormulaResults.length,
      ungroundedSymbols: Array.from(allUngroundedSymbols),
      perFormulaResults,
    },
    summary: {
      coverageRatio: coverage.coverageRatio,
      evidenceMatchRatio: evidence.matchRatio,
      numberGroundingPassed: numbers.passed,
      symbolGroundingPassed: symbolsPassed,
      warnings,
    },
  };
}
