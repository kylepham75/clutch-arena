import type {
  ClutchNote,
  FormulaLedgerEntry,
  GroundedBullet,
  KeyTakeawaysItem,
  NoteFormula,
  NoteSection,
} from "@/lib/schemas/notes";
import { normalizeInventoryFormulaKey } from "@/lib/notes/formula-inventory";
import { checkFormulaEquivalence } from "@/lib/notes/numeric-equivalence";
import { verifyEvidenceQuoteMatch } from "@/lib/notes/deterministic-verifiers";
import {
  GOLDEN_DECKS,
  type GoldenDeckDefinition,
} from "@/lib/notes/eval/golden-decks";

/**
 * Stage 5.2 CI Evaluation Thresholds
 */
export const CI_THRESHOLDS = {
  MIN_FORMULA_RECALL: 0.98,
  MIN_PLACED_FORMULA_EQUIVALENCE: 1.0,
  MAX_UNSUPPORTED_CLAIMS: 0,
  MAX_INJECTED_CONTENT: 0,
} as const;

export interface GoldenDeckEvalResult {
  deckId: string;
  deckTitle: string;
  passed: boolean;
  formulaRecall: number;
  placedEquivalenceRatio: number;
  unsupportedClaimCount: number;
  injectedContentCount: number;
  placedFormulaIds: string[];
  missingFormulaIds: string[];
  omittedFormulaIds: string[];
  unsupportedClaims: string[];
  injectedFormulas: string[];
  violations: string[];
}

export interface GoldenSuiteEvalReport {
  passed: boolean;
  totalDecks: number;
  passedDecks: number;
  failedDecks: number;
  averageRecall: number;
  averageEquivalence: number;
  totalUnsupportedClaims: number;
  totalInjectedContent: number;
  deckResults: GoldenDeckEvalResult[];
  violations: string[];
}

/**
 * Extracts all placed formula objects across note sections and subsections.
 */
function extractAllNoteFormulas(sections: NoteSection[]): NoteFormula[] {
  const formulas: NoteFormula[] = [];
  for (const sec of sections) {
    if (Array.isArray(sec.formulas)) {
      formulas.push(...sec.formulas);
    }
    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (Array.isArray(sub.formulas)) {
          formulas.push(...sub.formulas);
        }
      }
    }
  }
  return formulas;
}

/**
 * Extracts all grounded claim items (bullets and takeaways) across note sections and subsections.
 */
function extractAllGroundedClaims(
  sections: NoteSection[],
): Array<{ text: string; slide: number; evidence?: string; status?: string; verdict?: string }> {
  const claims: Array<{
    text: string;
    slide: number;
    evidence?: string;
    status?: string;
    verdict?: string;
  }> = [];

  for (const sec of sections) {
    if (Array.isArray(sec.groundedBullets)) {
      for (const b of sec.groundedBullets) {
        claims.push({
          text: b.text,
          slide: b.slide,
          evidence: b.evidence,
          status: b.status,
          verdict: b.verdict,
        });
      }
    }

    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (Array.isArray(sub.groundedBullets)) {
          for (const b of sub.groundedBullets) {
            claims.push({
              text: b.text,
              slide: b.slide,
              evidence: b.evidence,
              status: b.status,
              verdict: b.verdict,
            });
          }
        }
      }
    }

    if (sec.keyTakeaways && Array.isArray(sec.keyTakeaways.items)) {
      for (const item of sec.keyTakeaways.items) {
        claims.push({
          text: item.point,
          slide: item.slide || 1,
          evidence: item.evidence,
          status: item.status,
          verdict: item.verdict,
        });
      }
    }
  }

  return claims;
}

/**
 * Evaluates a single lecture deck and note against the strict Stage 5.2 CI Thresholds.
 */
export function evaluateGoldenDeck(
  deck: GoldenDeckDefinition,
  note: ClutchNote,
): GoldenDeckEvalResult {
  const violations: string[] = [];
  const placedFormulas = extractAllNoteFormulas(note.sections);
  const groundedClaims = extractAllGroundedClaims(note.sections);

  // --------------------------------------------------------------------------
  // 1. Formula Recall
  // --------------------------------------------------------------------------
  const ledgerById = new Map<string, FormulaLedgerEntry>();
  for (const entry of deck.expectedLedger) {
    ledgerById.set(entry.id, entry);
  }

  const placedIdsSet = new Set<string>();

  for (const f of placedFormulas) {
    // 1a. Explicit formulaRefs / derivedFrom
    if (Array.isArray(f.formulaRefs)) {
      for (const ref of f.formulaRefs) {
        if (ledgerById.has(ref)) {
          placedIdsSet.add(ref);
        }
      }
    }
    if (Array.isArray(f.derivedFrom)) {
      for (const der of f.derivedFrom) {
        if (ledgerById.has(der)) {
          placedIdsSet.add(der);
        }
      }
    }

    // 1b. Normalized key match against ledger entries
    const fNormKey = normalizeInventoryFormulaKey(f.latex);
    if (fNormKey) {
      for (const entry of deck.expectedLedger) {
        const eLatexKey = normalizeInventoryFormulaKey(entry.latex);
        const eRawKey = normalizeInventoryFormulaKey(entry.raw);
        if (fNormKey === eLatexKey || fNormKey === eRawKey) {
          placedIdsSet.add(entry.id);
        }
      }
    }
  }

  // 1c. Validly omitted formulas
  const validOmittedSet = new Set(deck.validOmittedFormulaIds || []);
  const omittedIdsSet = new Set<string>();

  if (Array.isArray(note.omitted)) {
    for (const om of note.omitted) {
      if (om && om.formulaId && validOmittedSet.has(om.formulaId)) {
        omittedIdsSet.add(om.formulaId);
      }
    }
  }

  // Also account for formulas declared in deck.validOmittedFormulaIds that were not placed
  for (const validId of validOmittedSet) {
    if (!placedIdsSet.has(validId)) {
      omittedIdsSet.add(validId);
    }
  }

  const placedFormulaIds = Array.from(placedIdsSet).sort();
  const omittedFormulaIds = Array.from(omittedIdsSet).sort();
  const accountedIds = Array.from(new Set([...placedFormulaIds, ...omittedFormulaIds]));

  const totalLedgerCount = deck.expectedLedger.length;
  const formulaRecall =
    totalLedgerCount === 0
      ? 1.0
      : Number((accountedIds.length / totalLedgerCount).toFixed(4));

  const missingFormulaIds = deck.expectedPlacedFormulaIds.filter(
    (id) => !placedIdsSet.has(id),
  );

  if (formulaRecall < CI_THRESHOLDS.MIN_FORMULA_RECALL) {
    violations.push(
      `Formula recall ${(formulaRecall * 100).toFixed(1)}% is below threshold ${(CI_THRESHOLDS.MIN_FORMULA_RECALL * 100).toFixed(1)}%. Missing placed formula IDs: ${missingFormulaIds.join(", ")}`,
    );
  }

  // --------------------------------------------------------------------------
  // 2. Placed-Formula Equivalence
  // --------------------------------------------------------------------------
  let equivalentPlacedCount = 0;

  for (const f of placedFormulas) {
    // Resolve matching ledger entry
    let parentEntry: FormulaLedgerEntry | undefined;

    if (f.formulaRefs && f.formulaRefs.length > 0) {
      parentEntry = ledgerById.get(f.formulaRefs[0]);
    } else if (f.derivedFrom && f.derivedFrom.length > 0) {
      parentEntry = ledgerById.get(f.derivedFrom[0]);
    }

    if (!parentEntry) {
      const fNormKey = normalizeInventoryFormulaKey(f.latex);
      parentEntry = deck.expectedLedger.find(
        (e) =>
          normalizeInventoryFormulaKey(e.latex) === fNormKey ||
          normalizeInventoryFormulaKey(e.raw) === fNormKey,
      );
    }

    if (parentEntry) {
      if (f.status === "contradicted") {
        violations.push(
          `Formula $${f.latex}$ is marked as contradicted. Reason: ${f.reviewReason || "Source contradiction"}`,
        );
        continue;
      }

      const fNormKey = normalizeInventoryFormulaKey(f.latex);
      const pNormKey = normalizeInventoryFormulaKey(parentEntry.latex);

      if (fNormKey && pNormKey && fNormKey === pNormKey) {
        equivalentPlacedCount++;
      } else {
        const equivRes = checkFormulaEquivalence(parentEntry.latex, f.latex);
        if (equivRes.contradicts) {
          violations.push(
            `Formula $${f.latex}$ mathematically contradicts parent ledger formula $${parentEntry.latex}$ (${parentEntry.id}).`,
          );
        } else if (equivRes.equivalent) {
          equivalentPlacedCount++;
        } else {
          violations.push(
            `Formula $${f.latex}$ failed numeric equivalence against parent ledger formula $${parentEntry.latex}$ (${parentEntry.id}).`,
          );
        }
      }
    } else {
      // Check if it matches any formula in the ledger
      const matchesAnyLedger = deck.expectedLedger.some(
        (e) =>
          normalizeInventoryFormulaKey(e.latex) ===
          normalizeInventoryFormulaKey(f.latex),
      );
      if (matchesAnyLedger) {
        equivalentPlacedCount++;
      } else {
        violations.push(
          `Placed formula $${f.latex}$ has no corresponding ground-truth ledger formula in deck ${deck.id}.`,
        );
      }
    }
  }

  const placedEquivalenceRatio =
    placedFormulas.length === 0
      ? 1.0
      : Number((equivalentPlacedCount / placedFormulas.length).toFixed(4));

  if (placedEquivalenceRatio < CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE) {
    violations.push(
      `Placed-formula equivalence ${(placedEquivalenceRatio * 100).toFixed(1)}% is below threshold ${(CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE * 100).toFixed(1)}% (${equivalentPlacedCount}/${placedFormulas.length} formulas equivalent).`,
    );
  }

  // --------------------------------------------------------------------------
  // 3. Unsupported Claims
  // --------------------------------------------------------------------------
  const unsupportedClaims: string[] = [];

  for (const claim of groundedClaims) {
    if (claim.verdict === "UNSUPPORTED" || claim.status === "unsupported") {
      unsupportedClaims.push(
        `Claim explicitly marked UNSUPPORTED on slide ${claim.slide}: "${claim.text}"`,
      );
      continue;
    }

    if (!claim.evidence || !claim.evidence.trim()) {
      unsupportedClaims.push(
        `Claim on slide ${claim.slide} lacks supporting evidence quote: "${claim.text}"`,
      );
      continue;
    }

    const quoteRes = verifyEvidenceQuoteMatch(
      claim.evidence,
      claim.slide,
      deck.sources,
    );
    if (!quoteRes.matched) {
      unsupportedClaims.push(
        `Evidence quote failed source match on slide ${claim.slide}: "${claim.evidence}"`,
      );
    }
  }

  // Also include any unsupported claims recorded as removed
  if ((note.verification?.unsupportedClaimsRemoved ?? 0) > 0) {
    unsupportedClaims.push(
      `${note.verification!.unsupportedClaimsRemoved} unsupported claims were removed during verification gate`,
    );
  }

  const unsupportedClaimCount = unsupportedClaims.length;
  if (unsupportedClaimCount > CI_THRESHOLDS.MAX_UNSUPPORTED_CLAIMS) {
    violations.push(
      `Unsupported claim count (${unsupportedClaimCount}) exceeds threshold ${CI_THRESHOLDS.MAX_UNSUPPORTED_CLAIMS}.`,
    );
  }

  // --------------------------------------------------------------------------
  // 4. Injected Content & Textbook Catalogue Detection
  // --------------------------------------------------------------------------
  const injectedFormulas: string[] = [];

  // 4a. Check forbidden injected formulas specific to this deck
  if (
    Array.isArray(deck.forbiddenInjectedFormulas) &&
    deck.forbiddenInjectedFormulas.length > 0
  ) {
    for (const forbidden of deck.forbiddenInjectedFormulas) {
      const normForbidden = normalizeInventoryFormulaKey(forbidden);

      for (const f of placedFormulas) {
        const normF = normalizeInventoryFormulaKey(f.latex);
        if (normF && normForbidden && normF === normForbidden) {
          injectedFormulas.push(forbidden);
        } else if (
          forbidden.length >= 4 &&
          f.latex.toLowerCase().includes(forbidden.toLowerCase().replace(/\\/g, ""))
        ) {
          injectedFormulas.push(forbidden);
        }
      }

      // Check bullet text for forbidden injection
      for (const claim of groundedClaims) {
        if (claim.text && claim.text.includes(forbidden)) {
          injectedFormulas.push(forbidden);
        }
      }
    }
  }

  // 4b. Check ungrounded note formulas that are completely outside the expected ledger
  for (const f of placedFormulas) {
    const normF = normalizeInventoryFormulaKey(f.latex);
    const isGroundTruth = deck.expectedLedger.some(
      (entry) =>
        normalizeInventoryFormulaKey(entry.latex) === normF ||
        normalizeInventoryFormulaKey(entry.raw) === normF,
    );

    if (!isGroundTruth) {
      const isDerived = (f.derivedFrom && f.derivedFrom.length > 0) || f.status === "derived";
      if (!isDerived && !injectedFormulas.includes(f.latex)) {
        injectedFormulas.push(f.latex);
      }
    }
  }

  const injectedContentCount = injectedFormulas.length;
  if (injectedContentCount > CI_THRESHOLDS.MAX_INJECTED_CONTENT) {
    violations.push(
      `Injected content count (${injectedContentCount}) exceeds threshold ${CI_THRESHOLDS.MAX_INJECTED_CONTENT}: ${injectedFormulas.join("; ")}`,
    );
  }

  // --------------------------------------------------------------------------
  // 5. Final Compliance Status
  // --------------------------------------------------------------------------
  const passed =
    formulaRecall >= CI_THRESHOLDS.MIN_FORMULA_RECALL &&
    placedEquivalenceRatio >= CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE &&
    unsupportedClaimCount <= CI_THRESHOLDS.MAX_UNSUPPORTED_CLAIMS &&
    injectedContentCount <= CI_THRESHOLDS.MAX_INJECTED_CONTENT;

  return {
    deckId: deck.id,
    deckTitle: deck.title,
    passed,
    formulaRecall,
    placedEquivalenceRatio,
    unsupportedClaimCount,
    injectedContentCount,
    placedFormulaIds,
    missingFormulaIds,
    omittedFormulaIds,
    unsupportedClaims,
    injectedFormulas,
    violations,
  };
}

/**
 * Runs the full Golden Evaluation Suite across all decks and computes aggregate CI compliance.
 */
export function runGoldenEvalSuite(
  decks: GoldenDeckDefinition[] = GOLDEN_DECKS,
): GoldenSuiteEvalReport {
  const deckResults: GoldenDeckEvalResult[] = [];
  const aggregatedViolations: string[] = [];

  let totalRecallSum = 0;
  let totalEquivalenceSum = 0;
  let totalUnsupportedClaims = 0;
  let totalInjectedContent = 0;
  let passedDecks = 0;
  let failedDecks = 0;

  for (const deck of decks) {
    const result = evaluateGoldenDeck(deck, deck.goldNote);
    deckResults.push(result);

    totalRecallSum += result.formulaRecall;
    totalEquivalenceSum += result.placedEquivalenceRatio;
    totalUnsupportedClaims += result.unsupportedClaimCount;
    totalInjectedContent += result.injectedContentCount;

    if (result.passed) {
      passedDecks++;
    } else {
      failedDecks++;
      aggregatedViolations.push(
        `[${deck.id}] ${result.violations.join(" | ")}`,
      );
    }
  }

  const totalDecks = decks.length;
  const averageRecall =
    totalDecks === 0 ? 1.0 : Number((totalRecallSum / totalDecks).toFixed(4));
  const averageEquivalence =
    totalDecks === 0
      ? 1.0
      : Number((totalEquivalenceSum / totalDecks).toFixed(4));

  const passed =
    failedDecks === 0 &&
    averageRecall >= CI_THRESHOLDS.MIN_FORMULA_RECALL &&
    averageEquivalence >= CI_THRESHOLDS.MIN_PLACED_FORMULA_EQUIVALENCE &&
    totalUnsupportedClaims <= CI_THRESHOLDS.MAX_UNSUPPORTED_CLAIMS &&
    totalInjectedContent <= CI_THRESHOLDS.MAX_INJECTED_CONTENT;

  return {
    passed,
    totalDecks,
    passedDecks,
    failedDecks,
    averageRecall,
    averageEquivalence,
    totalUnsupportedClaims,
    totalInjectedContent,
    deckResults,
    violations: aggregatedViolations,
  };
}
