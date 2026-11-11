import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  type FormulaLedgerEntry,
  type NoteFormula,
  type NoteSection,
  type SynthesisOmittedFormula,
  type NoteOmittedFormula,
  type GroundedBullet,
} from "@/lib/schemas/notes";
import {
  convertUnicodeMath,
  isNumericPluginOrScalarAssignment,
  normalizeInventoryFormulaKey,
  parseSlideNumber,
} from "@/lib/notes/formula-inventory";

export type NumberUnitType =
  | "percent"
  | "bps"
  | "currency_m"
  | "currency_b"
  | "currency_k"
  | "currency"
  | "multiplier"
  | "plain";

export interface NormalizedNumberToken {
  raw: string;
  value: number;
  unit: NumberUnitType;
  canonicalValue: number;
}

export type BulletNumericResolutionAction =
  | "VERIFIED"
  | "PATCH"
  | "RE_CITE"
  | "KEEP_AS_DERIVED"
  | "REPAIR"
  | "DROP";

export interface BulletNumericResolutionItem {
  sectionLetter: string;
  subHeading?: string;
  bulletIndex: number;
  action: BulletNumericResolutionAction;
  originalText: string;
  resolvedText: string;
  originalSlide: number;
  resolvedSlide: number;
  ungroundedNumbers: string[];
  reason?: string;
}

export interface BulletNumericCascadeResult {
  sections: NoteSection[];
  resolutions: BulletNumericResolutionItem[];
  residualRepairBullets: BulletNumericResolutionItem[];
  droppedCount: number;
  patchedCount: number;
  reCitedCount: number;
  derivedCount: number;
}

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
  /(?<=^|[^\p{L}\p{N}_])(?:duplicate|redundant|same as|already (?:covered|included|placed|captured)|identical|equivalent|trùng(?: lặp)?|tương đương)(?=$|[^\p{L}\p{N}_])/iu;

export const OMITTED_BY_RULE_REASON_REGEX =
  /(?<=^|[^\p{L}\p{N}_])(?:duplicate|redundant|same as|already (?:covered|included|placed|captured)|identical|equivalent|intermediate|derivation|rearrangement|rearranged|step|algebraic|simplified|expanded|derived|sub-step|exercise|drill|example|numerical|plug-in|plugin|worked|practice|calculation|number|sample|illustration|scalar|trùng(?: lặp)?|tương đương|biến đổi|trung gian|rút gọn|bài tập|ví dụ(?: số)?|thay số|tính cụ thể|minh họa|không phải công thức tổng quát)(?=$|[^\p{L}\p{N}_])/iu;

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
      /(?<=^|[^\p{L}\p{N}_])(?:intermediate|derivation|rearrangement|rearranged|step|sub-step|biến đổi|trung gian|rút gọn)(?=$|[^\p{L}\p{N}_])/iu.test(
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

    const isNumericPluginOrScalar =
      (Boolean(entry.latex) && isNumericPluginOrScalarAssignment(entry.latex)) ||
      (Boolean(entry.raw) && isNumericPluginOrScalarAssignment(entry.raw)) ||
      (Boolean((entry as any).rawText) && isNumericPluginOrScalarAssignment((entry as any).rawText));

    const isExerciseRule =
      Boolean(entry.isExerciseOnly) &&
      (hasNumericPlugIns(entry) || placedSlideNumbers.has(entry.slide));

    const isRearrangementRule = isIntermediateRearrangement(entry);

    if (
      isExplicitOmittedByRule ||
      isNumericPluginOrScalar ||
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
 * Normalizes an individual numeric raw token into a structured unit-aware token.
 */
export function normalizeNumericToken(
  raw: string,
): NormalizedNumberToken | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  // 1. Basis points: e.g. "5.8 bps", "5.8bps", "5.8 bp", "5.8bp", "580 bps"
  const bpsMatch = s.match(/^(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:bps|bp)$/i);
  if (bpsMatch) {
    const val = parseFloat(bpsMatch[1].replace(/,/g, ""));
    if (!isNaN(val)) {
      return {
        raw: s,
        value: val,
        unit: "bps",
        canonicalValue: Number((val * 0.0001).toFixed(12)),
      };
    }
  }

  // 2. Percentage: e.g. "5.8%", "25%", "0.25%"
  const pctMatch = s.match(/^(\d+(?:,\d{3})*(?:\.\d+)?)\s*%$/);
  if (pctMatch) {
    const val = parseFloat(pctMatch[1].replace(/,/g, ""));
    if (!isNaN(val)) {
      return {
        raw: s,
        value: val,
        unit: "percent",
        canonicalValue: Number((val / 100).toFixed(12)),
      };
    }
  }

  // 3. Currency with magnitude: $5M, $5 million, $5B, $5 billion, $5K, $5 thousand, 5M USD, 5 tỷ, 5 triệu, etc.
  const curMagMatch = s.match(
    /^(?:[\$€£₫]|USD|VND)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(b(?:illion)?|m(?:illion)?|k(?:|thousand)|tỷ|triệu|nghìn|ngàn)\s*(?:[\$€£₫]|USD|VND)?$/i,
  );
  if (curMagMatch) {
    const val = parseFloat(curMagMatch[1].replace(/,/g, ""));
    const mag = curMagMatch[2].toLowerCase();
    if (!isNaN(val)) {
      if (mag.startsWith("b") || mag === "tỷ") {
        return {
          raw: s,
          value: val,
          unit: "currency_b",
          canonicalValue: val * 1_000_000_000,
        };
      } else if (mag.startsWith("m") || mag === "triệu") {
        return {
          raw: s,
          value: val,
          unit: "currency_m",
          canonicalValue: val * 1_000_000,
        };
      } else if (
        mag.startsWith("k") ||
        mag.startsWith("thous") ||
        mag === "nghìn" ||
        mag === "ngàn"
      ) {
        return {
          raw: s,
          value: val,
          unit: "currency_k",
          canonicalValue: val * 1_000,
        };
      }
    }
  }

  // 4. Plain currency: e.g. "$4.50", "$50", "1,000 USD", "500 VND", "$1000"
  const curPlainMatch = s.match(
    /^(?:[\$€£₫]|USD|VND)\s*(\d+(?:,\d{3})*(?:\.\d+)?)$|^(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:[\$€£₫]|USD|VND)$/i,
  );
  if (curPlainMatch) {
    const numStr = (curPlainMatch[1] || curPlainMatch[2]).replace(/,/g, "");
    const val = parseFloat(numStr);
    if (!isNaN(val)) {
      return {
        raw: s,
        value: val,
        unit: "currency",
        canonicalValue: val,
      };
    }
  }

  // 5. Multipliers: e.g. "2.5x", "3x"
  const multMatch = s.match(/^(\d+(?:\.\d+)?)\s*x$/i);
  if (multMatch) {
    const val = parseFloat(multMatch[1]);
    if (!isNaN(val)) {
      return {
        raw: s,
        value: val,
        unit: "multiplier",
        canonicalValue: val,
      };
    }
  }

  // 6. Plain numbers (decimal or multi-digit integer or simple integer)
  const plainMatch = s.match(/^(\d+(?:,\d{3})*(?:\.\d+)?)$/);
  if (plainMatch) {
    const numStr = plainMatch[1].replace(/,/g, "");
    const val = parseFloat(numStr);
    if (!isNaN(val)) {
      return {
        raw: s,
        value: val,
        unit: "plain",
        canonicalValue: val,
      };
    }
  }

  return null;
}

/**
 * Extracts all unit-aware normalized numeric tokens from arbitrary text corpus.
 */
export function extractNormalizedNumbers(text: string): NormalizedNumberToken[] {
  if (!text || !text.trim()) return [];

  let s = text;
  // 1. Strip LaTeX subscripts and superscripts
  s = s.replace(/_(?:\{[^{}]+\}|[0-9a-zA-Z])/g, " ");
  s = s.replace(/\^(?:\{[^{}]+\}|[0-9a-zA-Z])/g, " ");

  // 2. Strip benign mathematical identity expressions: 1 + R, 1 - T_C, g = 0
  s = s.replace(/(?<!\d)\b1\s*[+\-*/]\s*[a-zA-Z]/g, " ");
  s = s.replace(/[a-zA-Z]\s*[+\-*/]\s*1\b(?!\.\d)/g, " ");
  s = s.replace(/[a-zA-Z]\s*=\s*0\b(?!\.\d)/g, " ");

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

  const tokens: NormalizedNumberToken[] = [];

  // A. Basis points: e.g. "5.8 bps", "5.8bp"
  const bpsRegex = /\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(bps|bp)\b/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = bpsRegex.exec(s)) !== null) {
    const rawTok = bMatch[0].trim();
    const tok = normalizeNumericToken(rawTok);
    if (tok) tokens.push(tok);
  }
  s = s.replace(bpsRegex, " ");

  // B. Currency with magnitude: $5M, $5 billion, $5K, 5M USD, 5 tỷ, 5 triệu, etc.
  const curMagRegex =
    /(?:[\$€£₫]|USD|VND)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(b(?:illion)?|m(?:illion)?|k(?:|thousand)|tỷ|triệu|nghìn|ngàn)\b|\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(b(?:illion)?|m(?:illion)?|k(?:|thousand)|tỷ|triệu|nghìn|ngàn)\s*(?:[\$€£₫]|USD|VND)?\b/gi;
  let cmMatch: RegExpExecArray | null;
  while ((cmMatch = curMagRegex.exec(s)) !== null) {
    const rawTok = cmMatch[0].trim();
    const tok = normalizeNumericToken(rawTok);
    if (tok) tokens.push(tok);
  }
  s = s.replace(curMagRegex, " ");

  // C. Percentage: 25%, 15%, 0.25% (ignore 100% and 0% if benign)
  const pctRegex = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*%/g;
  let pctMatch: RegExpExecArray | null;
  while ((pctMatch = pctRegex.exec(s)) !== null) {
    const rawTok = pctMatch[0].trim();
    const val = parseFloat(pctMatch[1].replace(/,/g, ""));
    if (val === 100 || val === 0) continue;
    const tok = normalizeNumericToken(rawTok);
    if (tok) tokens.push(tok);
  }
  s = s.replace(pctRegex, " ");

  // D. Plain currency: $4.50, $50, 1,000 USD, 500 VND
  const curPlainRegex =
    /(?:[\$€£₫]|USD|VND)\s*(\d+(?:,\d{3})*(?:\.\d+)?)|(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:[\$€£₫]|USD|VND)/gi;
  let cpMatch: RegExpExecArray | null;
  while ((cpMatch = curPlainRegex.exec(s)) !== null) {
    const rawTok = cpMatch[0].trim();
    const tok = normalizeNumericToken(rawTok);
    if (tok) tokens.push(tok);
  }
  s = s.replace(curPlainRegex, " ");

  // E. Multipliers: 2.5x, 3x
  const multRegex = /\b(\d+(?:\.\d+)?)\s*x\b/gi;
  let multMatch: RegExpExecArray | null;
  while ((multMatch = multRegex.exec(s)) !== null) {
    const rawTok = multMatch[0].trim();
    const tok = normalizeNumericToken(rawTok);
    if (tok) tokens.push(tok);
  }
  s = s.replace(multRegex, " ");

  // F. Decimals: 0.25, 12.5, 360.5
  const decimalRegex = /\b(\d+\.\d+)\b/g;
  let decMatch: RegExpExecArray | null;
  while ((decMatch = decimalRegex.exec(s)) !== null) {
    const rawTok = decMatch[1];
    const tok = normalizeNumericToken(rawTok);
    if (tok && tok.value !== 0 && tok.value !== 1) tokens.push(tok);
  }
  s = s.replace(decimalRegex, " ");

  // G. Multi-digit integers: 360, 365, 2025, 1,000, 50
  const intRegex = /\b(\d{1,3}(?:,\d{3})+|\d{2,})\b/g;
  let intMatch: RegExpExecArray | null;
  while ((intMatch = intRegex.exec(s)) !== null) {
    const rawTok = intMatch[1];
    const tok = normalizeNumericToken(rawTok);
    if (tok && tok.value !== 0 && tok.value !== 1) tokens.push(tok);
  }

  // Deduplicate by unit + canonicalValue
  const uniqueTokens: NormalizedNumberToken[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const key = `${t.unit}:${t.canonicalValue}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTokens.push(t);
    }
  }

  return uniqueTokens;
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

  // Match basis points: e.g. 5.8 bps, 5.8bp, 580 bps
  const bpsRegex = /\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(bps|bp)\b/gi;
  let bpsMatch: RegExpExecArray | null;
  while ((bpsMatch = bpsRegex.exec(s)) !== null) {
    const cleanVal = bpsMatch[1].replace(/,/g, "");
    found.push(`${cleanVal} ${bpsMatch[2].toLowerCase()}`);
  }
  s = s.replace(bpsRegex, " ");

  // Match currency with magnitude: $5M, $5 million, $5B, $5 billion, $5K, $5 thousand
  const curMagRegex =
    /(?:[\$€£₫]|USD|VND)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(b(?:illion)?|m(?:illion)?|k(?:|thousand)|tỷ|triệu|nghìn|ngàn)\b|\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(b(?:illion)?|m(?:illion)?|k(?:|thousand)|tỷ|triệu|nghìn|ngàn)\s*(?:[\$€£₫]|USD|VND)?\b/gi;
  let cmMatch: RegExpExecArray | null;
  while ((cmMatch = curMagRegex.exec(s)) !== null) {
    const rawVal = cmMatch[1] || cmMatch[3];
    const magRaw = (cmMatch[2] || cmMatch[4] || "").toLowerCase();
    if (rawVal) {
      const cleanVal = rawVal.replace(/,/g, "");
      let magLetter = "M";
      if (magRaw.startsWith("b") || magRaw === "tỷ") magLetter = "B";
      else if (
        magRaw.startsWith("k") ||
        magRaw.startsWith("thous") ||
        magRaw === "nghìn" ||
        magRaw === "ngàn"
      ) {
        magLetter = "K";
      }
      found.push(`$${cleanVal}${magLetter}`);
    }
  }
  s = s.replace(curMagRegex, " ");

  // Match currency values without magnitude: $4.50, $50, 4.50$, 1,000 VND
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
 * Unit-aware: prevents incompatible units or different magnitudes (e.g. $5M vs $5B, 5% vs 5 bps)
 * from false-passing.
 */
export function isNumberGrounded(numStr: string, sourceCorpus: string): boolean {
  if (!numStr || !sourceCorpus) return false;

  const target = normalizeNumericToken(numStr);
  const sourceTokens = extractNormalizedNumbers(sourceCorpus);

  if (target) {
    for (const src of sourceTokens) {
      const diff = Math.abs(src.canonicalValue - target.canonicalValue);
      const isValueEqual = diff < 1e-9;
      if (!isValueEqual) continue;

      // Unit compatibility checks
      // Rate units: percent and bps
      const isTargetRate = target.unit === "percent" || target.unit === "bps";
      const isSourceRate = src.unit === "percent" || src.unit === "bps";
      if (isTargetRate && isSourceRate) {
        return true;
      }
      if (isTargetRate && src.unit === "plain" && src.canonicalValue <= 1) {
        return true;
      }
      if (target.unit === "plain" && isSourceRate && target.canonicalValue <= 1) {
        return true;
      }

      // Currency units: currency, currency_k, currency_m, currency_b
      const isTargetCurrency = target.unit.startsWith("currency");
      const isSourceCurrency = src.unit.startsWith("currency");
      if (isTargetCurrency && isSourceCurrency) {
        return true;
      }
      if (isTargetCurrency && src.unit === "plain") {
        return true;
      }
      if (target.unit === "plain" && isSourceCurrency) {
        return true;
      }

      // Multiplier
      if (
        target.unit === "multiplier" &&
        (src.unit === "multiplier" || src.unit === "plain")
      ) {
        return true;
      }
      if (target.unit === "plain" && src.unit === "multiplier") {
        return true;
      }

      // Plain
      if (target.unit === "plain" && src.unit === "plain") {
        return true;
      }
    }

    // Direct string match fallback ONLY if compatible
    // Never allow currency magnitude or bps or percent to match an accidental substring
    if (
      target.unit === "currency_b" ||
      target.unit === "currency_m" ||
      target.unit === "currency_k" ||
      target.unit === "bps" ||
      target.unit === "multiplier"
    ) {
      return false;
    }

    if (target.unit === "percent") {
      if (
        sourceCorpus.includes(numStr) ||
        sourceCorpus.includes(`${target.value} %`)
      ) {
        return true;
      }
      return false;
    }

    if (target.unit === "currency") {
      return sourceCorpus.includes(numStr);
    }
  }

  // Direct substring match for plain strings
  if (sourceCorpus.includes(numStr)) {
    // If numStr is a plain integer e.g. "5", ensure word boundary
    if (/^\d+$/.test(numStr)) {
      const intRegex = new RegExp(`\\b${numStr}\\b`);
      return intRegex.test(sourceCorpus);
    }
    return true;
  }

  // Percentage <-> Decimal equivalence fallback (e.g. .25 for 0.25)
  if (numStr.endsWith("%")) {
    const pctVal = parseFloat(numStr.slice(0, -1));
    if (!isNaN(pctVal)) {
      const decVal = Number((pctVal / 100).toFixed(6));
      const decStr = decVal.toString();
      if (sourceCorpus.includes(decStr)) {
        return true;
      }
      if (decStr.startsWith("0.")) {
        const altDec = decStr.slice(1);
        if (sourceCorpus.includes(altDec)) return true;
      }
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
  if (!isNaN(floatVal) && numStr.includes(".")) {
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

  // 3. Extract subscripted variables: P_0, D_1, R_E, T_C, CF_t, \sigma_i, \beta_i, R_{t+1}, R_t+1
  const subscriptedSymbols: string[] = [];
  const subscriptRegex =
    /(\\[a-zA-Z]+|[a-zA-Z]{1,6})_(?:\{([^{}]+)\}|([a-zA-Z](?:[+-][0-9a-zA-Z]+)?|[0-9]+|[a-zA-Z0-9]+(?:,[a-zA-Z0-9]+)+|[a-zA-Z0-9]+))/g;
  let subMatch: RegExpExecArray | null;
  while ((subMatch = subscriptRegex.exec(s)) !== null) {
    const base = subMatch[1];
    const sub = subMatch[2] || subMatch[3];
    const cleanSub = sub ? sub.replace(/\s+/g, "").trim() : "";
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
  "Div": ["dividend", "cổ tức"],
  "div": ["dividend", "cổ tức"],
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

  // 3. For subscripted variables (e.g. P_0 -> match P0, P_0, or base P and index 0; R_{t+1}, Div_t+1, etc.)
  if (symbol.includes("_")) {
    const underscoreIdx = symbol.indexOf("_");
    const baseRaw = symbol.slice(0, underscoreIdx).trim();
    const subRaw = symbol.slice(underscoreIdx + 1).trim();
    const base = baseRaw.replace(/\\/g, "").toLowerCase();
    const cleanSub = subRaw.replace(/[{}]/g, "").replace(/\s+/g, "").toLowerCase();

    // Normalized variants: compact (rt+1), space-separated (r t+1), underscore (r_t+1), braced (r_{t+1})
    const compact = `${base}${cleanSub}`;
    const spaceSep = `${base} ${cleanSub}`;
    const underSep = `${base}_${cleanSub}`;
    const braced = `${base}_{${cleanSub}}`;

    const variants = [compact, spaceSep, underSep, braced, symbol.toLowerCase()];

    // Add space-padded operator variants if subscript has +, -, or comma (e.g. "t + 1")
    if (cleanSub.includes("+") || cleanSub.includes("-") || cleanSub.includes(",")) {
      const subSpaced = cleanSub.replace(/([+\-,])/g, " $1 ");
      variants.push(
        `${base} ${subSpaced}`,
        `${base}_${subSpaced}`,
        `${base}_{${subSpaced}}`,
        `${base}${subSpaced}`,
      );
    }

    if (baseRaw.startsWith("\\")) {
      const greekBase = baseRaw.toLowerCase();
      variants.push(
        `${greekBase}_${cleanSub}`,
        `${greekBase}_{${cleanSub}}`,
        `${greekBase} ${cleanSub}`,
        `${greekBase}${cleanSub}`,
      );
    }

    for (const v of variants) {
      if (
        normTarget.includes(v) ||
        normLedger.includes(v) ||
        normDeck.includes(v)
      ) {
        return true;
      }
    }

    // Check adjacent occurrence of base identifier and subscript expression in target, ledger, or deck
    const escapedBase = escapeRegExp(base);
    const escapedSub = escapeRegExp(cleanSub).replace(/([+\-,])/g, "\\s*\\$1\\s*");
    const basePattern = baseRaw.startsWith("\\")
      ? `(?:${escapedBase}|${escapeRegExp(baseRaw.toLowerCase())})`
      : escapedBase;

    const adjacentRegex = new RegExp(
      `(?<=^|[^\\p{L}\\p{N}_])${basePattern}[_\\s{()]*${escapedSub}(?=$|[^\\p{L}\\p{N}_])`,
      "iu",
    );

    if (
      adjacentRegex.test(convertedTarget) ||
      adjacentRegex.test(normLedger) ||
      adjacentRegex.test(convertedDeck)
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
    SYMBOL_EQUIVALENCE_KEYWORDS[
      symbol.replace(/_[^{}]+$/, "").replace(/_\{[^{}]+\}$/, "")
    ];

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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNonNumericTokens(text: string): string[] {
  if (!text) return [];
  const words =
    text
      .toLowerCase()
      .match(/[a-z\u00C0-\u024F\u1EA0-\u1EF9]+/g) || [];
  return words.filter((w) => w.length > 1);
}

function calculateNonNumericOverlap(textA: string, textB: string): number {
  const tokensA = extractNonNumericTokens(textA);
  const tokensB = new Set(extractNonNumericTokens(textB));
  if (tokensA.length === 0) return 0;
  const matchCount = tokensA.filter((t) => tokensB.has(t)).length;
  return Number((matchCount / tokensA.length).toFixed(4));
}

function getSlideCorpus(
  slideNumber: number,
  sources: SourceBlock[],
  ledger?: FormulaLedgerEntry[],
): string {
  const parts: string[] = [];
  const targetSources = sources.filter(
    (src, idx) => parseSlideNumber(src, idx) === slideNumber,
  );
  for (const s of targetSources) {
    if (s.text) parts.push(s.text);
  }
  if (Array.isArray(ledger)) {
    for (const entry of ledger) {
      if (entry.slide === slideNumber) {
        if (entry.raw) parts.push(entry.raw);
        if (entry.latex) parts.push(entry.latex);
        if (entry.label) parts.push(entry.label);
        if (entry.evidence) parts.push(entry.evidence);
      }
    }
  }
  return parts.join("\n").replace(/(\d+),(\d{3})/g, "$1$2");
}

/**
 * 5-Step numeric resolution cascade for a single grounded bullet:
 * 0. Check if all domain numbers are grounded on cited slide -> VERIFIED
 * 1. PATCH: If exactly 1 ungrounded number and reference quote has same number count and overlap >= 0.5
 * 2. RE-CITE: If all numbers grounded on another slide with contextual overlap >= 0.35
 * 3. KEEP_AS_DERIVED: If ungrounded numbers are difference, ratio, or percent change of slide numbers
 * 4. REPAIR: Queue for LLM repair (when dropResidual is false)
 * 5. DROP: Strip bullet (when dropResidual is true)
 */
export function resolveBulletNumericStep(
  bullet: GroundedBullet,
  sources: SourceBlock[],
  ledger?: FormulaLedgerEntry[],
  options?: { dropResidual?: boolean },
): {
  action: BulletNumericResolutionAction;
  bullet: GroundedBullet;
  ungroundedNumbers: string[];
  reason?: string;
} {
  const bulletNumbers = extractDomainNumbers(bullet.text);

  // If no numbers in bullet prose, it's already verified
  if (bulletNumbers.length === 0) {
    return {
      action: "VERIFIED",
      bullet: {
        ...bullet,
        status: bullet.status || "verified",
      },
      ungroundedNumbers: [],
      reason: "No quantitative figures in bullet text",
    };
  }

  const slideCorpus = getSlideCorpus(bullet.slide, sources, ledger);
  const ungrounded = bulletNumbers.filter(
    (num) => !isNumberGrounded(num, slideCorpus),
  );

  // Step 0: All numbers grounded on cited slide
  if (ungrounded.length === 0) {
    return {
      action: "VERIFIED",
      bullet: {
        ...bullet,
        status: bullet.status || "verified",
      },
      ungroundedNumbers: [],
      reason: "All domain numbers grounded on cited slide",
    };
  }

  // Step 1: PATCH (Deterministic, $0)
  // Guard: NEVER patch if bullet has 2+ mismatched numbers, or quote has different count of numbers
  if (ungrounded.length === 1) {
    const mismatchedNum = ungrounded[0];
    const targetSources = sources.filter(
      (src, idx) => parseSlideNumber(src, idx) === bullet.slide,
    );
    const citedSlideText = targetSources.map((s) => s.text || "").join("\n");

    // Gather candidate quotes: bullet.evidence and slide sentences
    const candidates: string[] = [];
    if (bullet.evidence && bullet.evidence.trim()) {
      candidates.push(bullet.evidence.trim());
    }
    const sentences = citedSlideText
      .split(/(?<=[.!?\n])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
    for (const st of sentences) {
      if (!candidates.includes(st)) {
        candidates.push(st);
      }
    }

    for (const cand of candidates) {
      const candNumbers = extractDomainNumbers(cand);
      if (candNumbers.length !== bulletNumbers.length) {
        continue;
      }

      const overlap = calculateNonNumericOverlap(bullet.text, cand);
      if (overlap < 0.5) {
        continue;
      }

      // Find the true replacement number
      let trueNumber: string | null = null;
      if (bulletNumbers.length === 1) {
        trueNumber = candNumbers[0];
      } else {
        const remainingCandNums = [...candNumbers];
        for (const bNum of bulletNumbers) {
          if (bNum === mismatchedNum) continue;
          const idx = remainingCandNums.findIndex((cNum) => {
            const bTok = normalizeNumericToken(bNum);
            const cTok = normalizeNumericToken(cNum);
            if (bTok && cTok) {
              return (
                Math.abs(bTok.canonicalValue - cTok.canonicalValue) < 1e-9
              );
            }
            return bNum === cNum;
          });
          if (idx !== -1) {
            remainingCandNums.splice(idx, 1);
          }
        }
        if (remainingCandNums.length === 1) {
          trueNumber = remainingCandNums[0];
        }
      }

      if (trueNumber && trueNumber !== mismatchedNum) {
        const patchedText = bullet.text.replace(
          new RegExp(escapeRegExp(mismatchedNum)),
          trueNumber,
        );
        const checkUngrounded = extractDomainNumbers(patchedText).filter(
          (n) => !isNumberGrounded(n, slideCorpus),
        );
        if (checkUngrounded.length === 0) {
          return {
            action: "PATCH",
            bullet: {
              ...bullet,
              text: patchedText,
              status: "verified",
            },
            ungroundedNumbers: [],
            reason: `Patched mismatched number ${mismatchedNum} -> ${trueNumber} from quote with overlap ${(overlap * 100).toFixed(0)}%`,
          };
        }
      }
    }
  }

  // Step 2: RE-CITE (Deterministic, $0)
  // Check other slides where ALL bullet numbers are grounded and contextual overlap >= 0.35
  const otherSlideNumbers = Array.from(
    new Set(sources.map((s, idx) => parseSlideNumber(s, idx))),
  ).filter((sn) => sn !== bullet.slide && sn > 0);

  let bestSlide: number | null = null;
  let bestOverlap = 0;
  let bestEvidence: string | undefined = undefined;

  for (const otherSlide of otherSlideNumbers) {
    const otherCorpus = getSlideCorpus(otherSlide, sources, ledger);
    const allGrounded = bulletNumbers.every((n) =>
      isNumberGrounded(n, otherCorpus),
    );
    if (!allGrounded) continue;

    const overlapText = calculateNonNumericOverlap(bullet.text, otherCorpus);
    const overlapEv = bullet.evidence
      ? calculateNonNumericOverlap(bullet.evidence, otherCorpus)
      : 0;
    const maxOverlap = Math.max(overlapText, overlapEv);

    if (maxOverlap >= 0.35 && maxOverlap > bestOverlap) {
      bestOverlap = maxOverlap;
      bestSlide = otherSlide;

      const otherSlideSources = sources.filter(
        (src, idx) => parseSlideNumber(src, idx) === otherSlide,
      );
      const otherSlideText = otherSlideSources.map((s) => s.text || "").join("\n");
      const sents = otherSlideText
        .split(/(?<=[.!?\n])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 5);

      let foundSent: string | undefined = undefined;
      let sentOverlap = 0;
      for (const sent of sents) {
        const hasAllNums = bulletNumbers.every((n) => isNumberGrounded(n, sent));
        if (hasAllNums) {
          const so = calculateNonNumericOverlap(bullet.text, sent);
          if (so > sentOverlap) {
            sentOverlap = so;
            foundSent = sent;
          }
        }
      }
      bestEvidence = foundSent || bullet.evidence;
    }
  }

  if (bestSlide !== null) {
    return {
      action: "RE_CITE",
      bullet: {
        ...bullet,
        slide: bestSlide,
        evidence: bestEvidence || bullet.evidence,
        status: "verified",
      },
      ungroundedNumbers: [],
      reason: `Re-cited from slide ${bullet.slide} to slide ${bestSlide} with contextual token overlap ${(bestOverlap * 100).toFixed(0)}%`,
    };
  }

  // Step 3: KEEP AS DERIVED (Deterministic, $0)
  // Check if each ungrounded number is difference, ratio, or percent change of two numbers on cited slide
  const slideTokens = extractNormalizedNumbers(slideCorpus);
  const slideValuesSet = new Set<number>();
  for (const st of slideTokens) {
    slideValuesSet.add(st.canonicalValue);
    slideValuesSet.add(st.value);
  }
  const slideVals = Array.from(slideValuesSet).filter((v) => !isNaN(v));

  const derivationReasons: string[] = [];
  let allDerived = true;

  for (const unNum of ungrounded) {
    const unTok = normalizeNumericToken(unNum);
    const targetValues: number[] = [];
    if (unTok) {
      targetValues.push(unTok.canonicalValue);
      targetValues.push(unTok.value);
    } else {
      const parsed = parseFloat(unNum);
      if (!isNaN(parsed)) targetValues.push(parsed);
    }

    let foundDerivation = false;
    for (let i = 0; i < slideVals.length; i++) {
      if (foundDerivation) break;
      for (let j = 0; j < slideVals.length; j++) {
        if (i === j) continue;
        const a = slideVals[i];
        const b = slideVals[j];

        // 1. Difference: a - b or |a - b|
        const d1 = a - b;
        const d2 = Math.abs(a - b);

        // 2. Ratio: a / b
        const r = Math.abs(b) > 1e-9 ? a / b : null;

        // 3. Percent change: (b - a) / a, ((b - a) / a) * 100, |b - a| / a, etc.
        const pc1 = Math.abs(a) > 1e-9 ? (b - a) / a : null;
        const pc2 = Math.abs(a) > 1e-9 ? ((b - a) / a) * 100 : null;
        const pc3 = Math.abs(a) > 1e-9 ? Math.abs((b - a) / a) : null;
        const pc4 = Math.abs(a) > 1e-9 ? Math.abs((b - a) / a) * 100 : null;

        const candidates = [
          { val: d1, desc: `${a} - ${b}` },
          { val: d2, desc: `|${a} - ${b}|` },
          ...(r !== null ? [{ val: r, desc: `${a} / ${b}` }] : []),
          ...(pc1 !== null ? [{ val: pc1, desc: `(${b} - ${a}) / ${a}` }] : []),
          ...(pc2 !== null ? [{ val: pc2, desc: `((${b} - ${a}) / ${a}) * 100` }] : []),
          ...(pc3 !== null ? [{ val: pc3, desc: `|${b} - ${a}| / ${a}` }] : []),
          ...(pc4 !== null ? [{ val: pc4, desc: `(|${b} - ${a}| / ${a}) * 100` }] : []),
        ];

        for (const cand of candidates) {
          for (const target of targetValues) {
            const diff = Math.abs(cand.val - target);
            const relDiff = target !== 0 ? diff / Math.abs(target) : diff;
            if (diff <= 0.01 || relDiff <= 0.01) {
              foundDerivation = true;
              derivationReasons.push(`${unNum} = ${cand.desc} (≈ ${cand.val.toFixed(2)})`);
              break;
            }
          }
          if (foundDerivation) break;
        }
      }
    }

    if (!foundDerivation) {
      allDerived = false;
      break;
    }
  }

  if (allDerived && derivationReasons.length > 0) {
    return {
      action: "KEEP_AS_DERIVED",
      bullet: {
        ...bullet,
        status: "derived",
      },
      ungroundedNumbers: [],
      reason: `Derived from numbers on slide ${bullet.slide}: ${derivationReasons.join(", ")}`,
    };
  }

  // Step 4: REPAIR vs Step 5: DROP
  if (options?.dropResidual) {
    return {
      action: "DROP",
      bullet,
      ungroundedNumbers: ungrounded,
      reason: `Ungrounded number(s) [${ungrounded.join(", ")}] failed cascade resolution; dropped`,
    };
  }

  return {
    action: "REPAIR",
    bullet,
    ungroundedNumbers: ungrounded,
    reason: `Ungrounded number(s) [${ungrounded.join(", ")}] queued for targeted repair`,
  };
}

/**
 * Runs the 5-step numeric resolution cascade on all grounded bullets across all sections.
 */
export function runBulletNumericCascade(
  sections: NoteSection[],
  sources: SourceBlock[],
  ledger?: FormulaLedgerEntry[],
  options?: { dropResidual?: boolean },
): BulletNumericCascadeResult {
  const clonedSections: NoteSection[] = JSON.parse(JSON.stringify(sections));

  const resolutions: BulletNumericResolutionItem[] = [];
  const residualRepairBullets: BulletNumericResolutionItem[] = [];
  let droppedCount = 0;
  let patchedCount = 0;
  let reCitedCount = 0;
  let derivedCount = 0;

  for (const sec of clonedSections) {
    // 1. Process Section-level groundedBullets
    if (Array.isArray(sec.groundedBullets) && sec.groundedBullets.length > 0) {
      const newGrounded: GroundedBullet[] = [];
      const droppedOriginalTexts = new Set<string>();
      const patchedTextMap = new Map<string, string>();

      for (let i = 0; i < sec.groundedBullets.length; i++) {
        const bullet = sec.groundedBullets[i];
        const stepRes = resolveBulletNumericStep(bullet, sources, ledger, options);

        const resItem: BulletNumericResolutionItem = {
          sectionLetter: sec.letter,
          bulletIndex: i,
          action: stepRes.action,
          originalText: bullet.text,
          resolvedText: stepRes.bullet.text,
          originalSlide: bullet.slide,
          resolvedSlide: stepRes.bullet.slide,
          ungroundedNumbers: stepRes.ungroundedNumbers,
          reason: stepRes.reason,
        };
        resolutions.push(resItem);

        if (stepRes.action === "DROP") {
          droppedCount++;
          droppedOriginalTexts.add(bullet.text);
        } else {
          if (stepRes.action === "PATCH") {
            patchedCount++;
            patchedTextMap.set(bullet.text, stepRes.bullet.text);
          } else if (stepRes.action === "RE_CITE") {
            reCitedCount++;
          } else if (stepRes.action === "KEEP_AS_DERIVED") {
            derivedCount++;
          } else if (stepRes.action === "REPAIR") {
            residualRepairBullets.push(resItem);
          }
          newGrounded.push(stepRes.bullet);
        }
      }

      sec.groundedBullets = newGrounded;
      if (Array.isArray(sec.bulletPoints)) {
        sec.bulletPoints = sec.bulletPoints
          .filter((bp) => !droppedOriginalTexts.has(bp))
          .map((bp) => (patchedTextMap.has(bp) ? patchedTextMap.get(bp)! : bp));
      }
    }

    // 2. Process SubSection-level groundedBullets
    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (Array.isArray(sub.groundedBullets) && sub.groundedBullets.length > 0) {
          const newSubGrounded: GroundedBullet[] = [];
          const droppedOriginalTexts = new Set<string>();
          const patchedTextMap = new Map<string, string>();

          for (let j = 0; j < sub.groundedBullets.length; j++) {
            const bullet = sub.groundedBullets[j];
            const stepRes = resolveBulletNumericStep(bullet, sources, ledger, options);

            const resItem: BulletNumericResolutionItem = {
              sectionLetter: sec.letter,
              subHeading: sub.heading,
              bulletIndex: j,
              action: stepRes.action,
              originalText: bullet.text,
              resolvedText: stepRes.bullet.text,
              originalSlide: bullet.slide,
              resolvedSlide: stepRes.bullet.slide,
              ungroundedNumbers: stepRes.ungroundedNumbers,
              reason: stepRes.reason,
            };
            resolutions.push(resItem);

            if (stepRes.action === "DROP") {
              droppedCount++;
              droppedOriginalTexts.add(bullet.text);
            } else {
              if (stepRes.action === "PATCH") {
                patchedCount++;
                patchedTextMap.set(bullet.text, stepRes.bullet.text);
              } else if (stepRes.action === "RE_CITE") {
                reCitedCount++;
              } else if (stepRes.action === "KEEP_AS_DERIVED") {
                derivedCount++;
              } else if (stepRes.action === "REPAIR") {
                residualRepairBullets.push(resItem);
              }
              newSubGrounded.push(stepRes.bullet);
            }
          }

          sub.groundedBullets = newSubGrounded;
          if (Array.isArray(sub.bulletPoints)) {
            sub.bulletPoints = sub.bulletPoints
              .filter((bp) => !droppedOriginalTexts.has(bp))
              .map((bp) => (patchedTextMap.has(bp) ? patchedTextMap.get(bp)! : bp));
          }
        }
      }
    }
  }

  return {
    sections: clonedSections,
    resolutions,
    residualRepairBullets,
    droppedCount,
    patchedCount,
    reCitedCount,
    derivedCount,
  };
}

export const resolveBulletNumbersCascade = resolveBulletNumericStep;
export const runBulletNumericCascadeOnSections = runBulletNumericCascade;

