import { generateObject, type LanguageModel } from "ai";
import { IngestionError } from "@/lib/ingestion/errors";
import type { SourceBlock } from "@/lib/schemas/ingestion";
import {
  type NoteSection,
  type NoteSubSection,
  type NoteFormula,
  type GroundedBullet,
  type KeyTakeawaysItem,
  type FormulaLedgerEntry,
  type SynthesisOmittedFormula,
  type NoteOmittedFormula,
  type SynthesisSection,
  type TextbookDivergenceNotice,
  type ClaimVerificationItem,
  type FormulaVerificationResult,
  type NoteVerificationRecord,
  type VerificationStatus,
  synthesisSchema,
} from "@/lib/schemas/notes";
import {
  runDeterministicVerifiers,
  verifyEvidenceQuoteMatch,
  verifyFormulaSymbolSet,
  runBulletNumericCascade,
  resolveBulletNumericStep,
  type DeterministicVerificationReport,
  type BulletNumericResolutionItem,
  type BulletNumericCascadeResult,
} from "@/lib/notes/deterministic-verifiers";
import {
  verifyNoteFormulasEquivalence,
  type EquivalenceCheckOptions,
  type NoteFormulasEquivalenceReport,
} from "@/lib/notes/numeric-equivalence";
import {
  verifyNoteClaimsWithLlm,
  extractVerifiableClaimsFromNote,
  deduplicateNoteSections,
  type VerifierLlmReport,
  type VerifiableNoteClaim,
} from "@/lib/notes/verifier-llm";
import { annotateNoteWithDivergenceNotices } from "@/lib/notes/domain-rule-packs";
import {
  CLUTCH_NOTES_SYSTEM_PROMPT,
  type FinancialConventionPin,
  extractFinancialConventions,
  pinConventionsToSections,
} from "@/lib/ai/prompts-notes";
import {
  injectLedgerFormulasById,
  applyHallucinationShield,
  mapSynthesisSection,
} from "@/lib/ai/generate-notes";

export {
  type FinancialConventionPin,
  extractFinancialConventions,
  pinConventionsToSections,
  deduplicateNoteSections,
};

export type SectionQualityAction =
  | "SHIP"
  | "SHIP_AND_REGEN_BACKGROUND"
  | "RETRY_OR_OMIT";

export interface SectionQualityDecision {
  sectionLetter: string;
  titleVi: string;
  initialBulletCount: number;
  droppedBulletCount: number;
  dropRate: number;
  action: SectionQualityAction;
  omitted: boolean;
  notice?: string;
}

export interface SectionQualityGateResult {
  sections: NoteSection[];
  decisions: SectionQualityDecision[];
  omittedNotices: string[];
  backgroundRegenSections: string[];
}

/**
 * Evaluates the claim/bullet drop rate of a section and assigns a quality gate action:
 * - dropRate < 0.08 (< 8%) -> "SHIP"
 * - 0.08 <= dropRate <= 0.20 (8% <= drop_rate <= 20%) -> "SHIP_AND_REGEN_BACKGROUND"
 * - dropRate > 0.20 (> 20%) -> "RETRY_OR_OMIT"
 */
export function evaluateSectionDropRate(
  initialBulletCount: number,
  droppedBulletCount: number,
): { dropRate: number; action: SectionQualityAction } {
  if (initialBulletCount <= 0 || droppedBulletCount <= 0) {
    return { dropRate: 0, action: "SHIP" };
  }
  const dropRate = droppedBulletCount / initialBulletCount;
  if (dropRate < 0.08) {
    return { dropRate, action: "SHIP" };
  }
  if (dropRate <= 0.20) {
    return { dropRate, action: "SHIP_AND_REGEN_BACKGROUND" };
  }
  return { dropRate, action: "RETRY_OR_OMIT" };
}

function countSectionBullets(sec?: NoteSection): number {
  if (!sec) return 0;
  let count = 0;
  if (Array.isArray(sec.groundedBullets) && sec.groundedBullets.length > 0) {
    count += sec.groundedBullets.length;
  } else if (Array.isArray(sec.bulletPoints) && sec.bulletPoints.length > 0) {
    count += sec.bulletPoints.length;
  }
  if (Array.isArray(sec.subSections)) {
    for (const sub of sec.subSections) {
      if (Array.isArray(sub.groundedBullets) && sub.groundedBullets.length > 0) {
        count += sub.groundedBullets.length;
      } else if (Array.isArray(sub.bulletPoints) && sub.bulletPoints.length > 0) {
        count += sub.bulletPoints.length;
      }
    }
  }
  return count;
}

/**
 * Runs the Section-Level Quality Gate on verified sections:
 * Evaluates drop rates, retains valid sections, triggers background regens for 8%-20%,
 * and retries or cleanly omits sections with >20% dropped claims with student notices.
 */
export async function runSectionQualityGate(input: {
  initialSections: NoteSection[];
  verifiedSections: NoteSection[];
  perSectionDroppedCounts?: Record<string, number>;
  retrySectionFn?: (
    section: NoteSection,
    strictPrompt: string,
  ) => Promise<NoteSection | null>;
  onBackgroundRegenSection?: (section: NoteSection) => void | Promise<void>;
}): Promise<SectionQualityGateResult> {
  const decisions: SectionQualityDecision[] = [];
  const omittedNotices: string[] = [];
  const backgroundRegenSections: string[] = [];
  const keptSections: NoteSection[] = [];

  for (const sec of input.verifiedSections) {
    const initialSec = input.initialSections.find(
      (s) => s.letter === sec.letter || s.id === sec.id,
    );
    const initialBulletCount = initialSec
      ? countSectionBullets(initialSec)
      : countSectionBullets(sec);
    const currentBulletCount = countSectionBullets(sec);
    const droppedCount =
      input.perSectionDroppedCounts?.[sec.letter] ??
      Math.max(0, initialBulletCount - currentBulletCount);

    const { dropRate, action } = evaluateSectionDropRate(
      initialBulletCount,
      droppedCount,
    );

    if (action === "SHIP") {
      keptSections.push(sec);
      decisions.push({
        sectionLetter: sec.letter,
        titleVi: sec.titleVi,
        initialBulletCount,
        droppedBulletCount: droppedCount,
        dropRate,
        action: "SHIP",
        omitted: false,
      });
    } else if (action === "SHIP_AND_REGEN_BACKGROUND") {
      keptSections.push(sec);
      backgroundRegenSections.push(sec.letter);
      decisions.push({
        sectionLetter: sec.letter,
        titleVi: sec.titleVi,
        initialBulletCount,
        droppedBulletCount: droppedCount,
        dropRate,
        action: "SHIP_AND_REGEN_BACKGROUND",
        omitted: false,
      });
      if (input.onBackgroundRegenSection) {
        try {
          const res = input.onBackgroundRegenSection(sec);
          if (res && typeof (res as Promise<void>).catch === "function") {
            (res as Promise<void>).catch(console.warn);
          }
        } catch (err) {
          console.warn(
            `[runSectionQualityGate] Background regen callback failed for section ${sec.letter}:`,
            err,
          );
        }
      }
    } else {
      // RETRY_OR_OMIT (>20% drop rate)
      let retriedSection: NoteSection | null = null;
      if (input.retrySectionFn) {
        const strictPrompt = `Section ${sec.letter} (${sec.titleVi}) had a ${(dropRate * 100).toFixed(1)}% claim drop rate due to ungrounded claims. Please regenerate this section with strict source slide grounding only. Omit unverified numbers and ungrounded statements.`;
        try {
          retriedSection = await input.retrySectionFn(sec, strictPrompt);
        } catch (err) {
          console.warn(
            `[runSectionQualityGate] retrySectionFn failed for section ${sec.letter}:`,
            err,
          );
        }
      }

      if (retriedSection && countSectionBullets(retriedSection) > 0) {
        keptSections.push(retriedSection);
        decisions.push({
          sectionLetter: sec.letter,
          titleVi: sec.titleVi,
          initialBulletCount,
          droppedBulletCount: droppedCount,
          dropRate,
          action: "RETRY_OR_OMIT",
          omitted: false,
        });
      } else {
        const notice = `Section ${sec.letter} (${sec.titleVi}) was omitted because >20% of its synthesized claims could not be verified against source slides.`;
        omittedNotices.push(notice);
        decisions.push({
          sectionLetter: sec.letter,
          titleVi: sec.titleVi,
          initialBulletCount,
          droppedBulletCount: droppedCount,
          dropRate,
          action: "RETRY_OR_OMIT",
          omitted: true,
          notice,
        });
      }
    }
  }

  return {
    sections: keptSections,
    decisions,
    omittedNotices,
    backgroundRegenSections,
  };
}

export const evaluateSectionQualityGate = runSectionQualityGate;

export interface VerificationGateOptions {
  enableVerifierLlm?: boolean;
  verifierModel?: LanguageModel;
  repairModel?: LanguageModel;
  repairFn?: (
    repairPrompt: string,
    signal?: AbortSignal,
  ) => Promise<SynthesisSection[] | NoteSection[]>;
  skipVerifierLlm?: boolean;
  maxRepairAttempts?: number;
  throwOnContradictedFormula?: boolean;
  numericEquivalenceOptions?: EquivalenceCheckOptions;
  signal?: AbortSignal;
  enforceSectionQualityGate?: boolean;
  retrySectionFn?: (
    section: NoteSection,
    strictPrompt: string,
  ) => Promise<NoteSection | null>;
  onBackgroundRegenSection?: (section: NoteSection) => void | Promise<void>;
  pinConventions?: boolean;
}

export interface VerificationGateInput {
  sections: NoteSection[];
  sources: SourceBlock[];
  ledger: FormulaLedgerEntry[];
  omitted?: (SynthesisOmittedFormula | NoteOmittedFormula)[];
  options?: VerificationGateOptions;
}

export interface VerificationGateResult {
  sections: NoteSection[];
  verification: NoteVerificationRecord;
  repairAttempted: boolean;
  contradictedFormulaCount: number;
  needsReviewCount: number;
  unsupportedClaimsRemoved: number;
  decisions?: SectionQualityDecision[];
  omittedNotices?: string[];
  omittedSectionNotices?: string[];
  backgroundRegenSections?: string[];
  pinnedConventions?: FinancialConventionPin[];
}

export interface TargetedRepairPromptInput {
  sections: NoteSection[];
  contradictedFormulas?: Array<{
    latex: string;
    parentLedgerLatex?: string;
    parentLedgerId?: string;
    reason?: string;
  }>;
  uncapturedFormulas?: Array<{
    id: string;
    latex: string;
    label?: string;
    slide: number;
    raw?: string;
  }>;
  contradictedClaims?: Array<{
    claimId: string;
    text: string;
    slide: number;
    reason: string;
  }>;
  warnings?: string[];
  residualNumericBullets?: BulletNumericResolutionItem[];
}

export interface VerificationPipelineReport {
  annotatedSections: NoteSection[];
  divergenceNotices: TextbookDivergenceNotice[];
  deterministicReport: DeterministicVerificationReport;
  equivalenceReport: NoteFormulasEquivalenceReport;
  verifierLlmReport?: VerifierLlmReport;
  claims: VerifiableNoteClaim[];
}

/**
 * Builds a concise, targeted repair prompt giving the synthesis LLM
 * the exact defects to fix while keeping all valid content untouched.
 */
export function buildTargetedRepairPrompt(
  input: TargetedRepairPromptInput,
): string {
  const parts: string[] = [];

  parts.push("## TARGETED STUDY NOTE REPAIR REQUEST");
  parts.push(
    "Please perform a surgical, single-pass repair on the study note sections below to resolve specific verification defects.",
  );
  parts.push(
    "CRITICAL: Preserve all existing correct sections, headings, bullets, and formulas. Fix ONLY the targeted defects listed below.",
  );
  parts.push("");

  if (input.contradictedFormulas && input.contradictedFormulas.length > 0) {
    parts.push("### 1. CONTRADICTED FORMULAS (MUST FIX)");
    parts.push(
      "The following formulas mathematically contradict the authoritative source slide ledger formulas. Replace them with the exact authoritative ledger formula:",
    );
    for (const cf of input.contradictedFormulas) {
      parts.push(`- Contradicted formula in note: $${cf.latex}$`);
      if (cf.parentLedgerLatex) {
        parts.push(
          `  Authoritative ledger formula (${cf.parentLedgerId || "Ledger"}): $${cf.parentLedgerLatex}$`,
        );
      }
      if (cf.reason) {
        parts.push(`  Issue: ${cf.reason}`);
      }
    }
    parts.push("");
  }

  if (input.uncapturedFormulas && input.uncapturedFormulas.length > 0) {
    parts.push("### 2. UNCAPTURED SOURCE FORMULAS (MUST PLACE)");
    parts.push(
      "The following formulas from the source slide ledger were missing from the synthesized sections. Integrate them into the most appropriate section or subsection:",
    );
    for (const uf of input.uncapturedFormulas) {
      parts.push(
        `- [${uf.id}] Slide ${uf.slide}: $${uf.latex}$ ${uf.label ? `(${uf.label})` : ""}`,
      );
    }
    parts.push("");
  }

  if (input.contradictedClaims && input.contradictedClaims.length > 0) {
    parts.push(
      "### 3. CONTRADICTED CONCEPTUAL CLAIMS (MUST CORRECT OR REMOVE)",
    );
    parts.push(
      "The following conceptual claims contradict the source slide text. Correct them to match the slides or remove them completely:",
    );
    for (const cc of input.contradictedClaims) {
      parts.push(`- [${cc.claimId}] Slide ${cc.slide}: "${cc.text}"`);
      parts.push(`  Correction needed: ${cc.reason}`);
    }
    parts.push("");
  }

  if (input.residualNumericBullets && input.residualNumericBullets.length > 0) {
    parts.push("### 4. UNGROUNDED NUMERIC BULLETS (REPAIR OR REMOVE)");
    parts.push(
      "The following bullets contain numbers that could not be verified on the cited slide. Correct the numbers to match the slide or remove the specific ungrounded claim:",
    );
    for (const b of input.residualNumericBullets) {
      parts.push(
        `- [Section ${b.sectionLetter}] Slide ${b.originalSlide}: "${b.originalText}"`,
      );
      if (b.ungroundedNumbers.length > 0) {
        parts.push(`  Ungrounded numbers: ${b.ungroundedNumbers.join(", ")}`);
      }
    }
    parts.push("");
  }

  if (input.warnings && input.warnings.length > 0) {
    parts.push("### 5. ADDITIONAL DEFECT WARNINGS");
    for (const w of input.warnings) {
      parts.push(`- ${w}`);
    }
    parts.push("");
  }

  parts.push("### CURRENT SYNTHESIZED NOTE SECTIONS");
  parts.push("```json");
  parts.push(JSON.stringify(input.sections, null, 2));
  parts.push("```");

  return parts.join("\n");
}

/**
 * Runs the verification pipeline:
 * 1. Domain rule packs (divergence notices)
 * 2. Deterministic verifiers (coverage, quotes, numbers, symbols)
 * 3. Numeric equivalence (algebraic / sample testing)
 * 4. Optional Independent Verifier LLM
 */
export async function executeVerificationPipeline(input: {
  sections: NoteSection[];
  sources: SourceBlock[];
  ledger: FormulaLedgerEntry[];
  omitted?: (SynthesisOmittedFormula | NoteOmittedFormula)[];
  options?: VerificationGateOptions;
}): Promise<VerificationPipelineReport> {
  // 1. Domain Rule Packs (Divergence notices without rewriting formula LaTeX)
  const { sections: annotatedSections, notices: divergenceNotices } =
    annotateNoteWithDivergenceNotices(input.sections, input.ledger);

  // 2. Deterministic verifiers
  const deterministicReport = runDeterministicVerifiers({
    sections: annotatedSections,
    sources: input.sources,
    ledger: input.ledger,
    omitted: input.omitted,
  });

  // 3. Numeric equivalence verifier
  const equivalenceReport = verifyNoteFormulasEquivalence(
    annotatedSections,
    input.ledger,
    input.options?.numericEquivalenceOptions,
  );

  // 4. Extract verifiable claims
  const claims = extractVerifiableClaimsFromNote(annotatedSections);

  // 5. Optional Independent Verifier LLM
  let verifierLlmReport: VerifierLlmReport | undefined;
  const shouldRunVerifierLlm =
    !input.options?.skipVerifierLlm &&
    Boolean(input.options?.enableVerifierLlm || input.options?.verifierModel);

  if (shouldRunVerifierLlm && claims.length > 0 && input.options?.verifierModel) {
    try {
      verifierLlmReport = await verifyNoteClaimsWithLlm({
        sections: annotatedSections,
        sources: input.sources,
        model: input.options.verifierModel,
        signal: input.options?.signal,
      });
    } catch (err) {
      console.warn(
        "[executeVerificationPipeline] Verifier LLM call failed or mock was exhausted, falling back to deterministic check:",
        err,
      );
    }
  }

  return {
    annotatedSections,
    divergenceNotices,
    deterministicReport,
    equivalenceReport,
    verifierLlmReport,
    claims,
  };
}

/**
 * Checks if a section has substantive content other than the bullet currently being evaluated.
 */
function hasOtherSectionContent(
  sec: NoteSection,
  bulletTextToExclude?: string,
): boolean {
  if (sec.coreStatement && sec.coreStatement.trim().length > 0) return true;
  if (Array.isArray(sec.formulas) && sec.formulas.length > 0) return true;
  if (Array.isArray(sec.subSections) && sec.subSections.length > 0) return true;
  if (
    sec.keyTakeaways &&
    Array.isArray(sec.keyTakeaways.items) &&
    sec.keyTakeaways.items.length > 0
  ) {
    return true;
  }

  const otherBullets = (sec.groundedBullets || []).filter(
    (b) => b && b.text !== bulletTextToExclude,
  );
  if (otherBullets.length > 0) return true;

  const otherBulletPoints = (sec.bulletPoints || []).filter(
    (bp) => bp !== bulletTextToExclude,
  );
  if (otherBulletPoints.length > 0) return true;

  return false;
}

/**
 * Applies the MARK policy and Hard-Fail enforcement:
 * 1. Remove UNSUPPORTED claims from bullets, coreStatement, takeaways (with empty-section guardrail).
 * 2. Mark uncertain/unverified items with status "needs_review" and descriptive reviewReason.
 * 3. Hard-fail ONLY if a formula contradicts the source slides.
 * 4. Construct NoteVerificationRecord.
 */
export function applyMarkPolicyAndGate(input: {
  sections: NoteSection[];
  sources: SourceBlock[];
  ledger: FormulaLedgerEntry[];
  omitted?: SynthesisOmittedFormula[];
  pipelineReport: VerificationPipelineReport;
  options?: VerificationGateOptions;
  repairAttempted: boolean;
}): VerificationGateResult {
  const {
    pipelineReport,
    sources,
    ledger,
    options,
    repairAttempted,
  } = input;

  const clonedSections: NoteSection[] = JSON.parse(
    JSON.stringify(pipelineReport.annotatedSections),
  );

  let unsupportedClaimsRemoved = 0;
  let needsReviewCount = 0;
  let contradictedFormulaCount = 0;

  // Build claim verdict lookup
  const claimVerdictMap = new Map<string, ClaimVerificationItem>();
  if (pipelineReport.verifierLlmReport?.verdicts) {
    for (const v of pipelineReport.verifierLlmReport.verdicts) {
      if (v?.claimId) {
        claimVerdictMap.set(v.claimId, v);
      }
    }
  }

  const claims = pipelineReport.claims;
  const quoteFailBullets = new Set<string>();
  for (const fb of pipelineReport.deterministicReport.evidence.failedBullets) {
    quoteFailBullets.add(`${fb.sectionLetter}:::${fb.text}`);
  }

  const quoteFailTakeaways = new Set<string>();
  for (const ft of pipelineReport.deterministicReport.evidence.failedTakeaways) {
    quoteFailTakeaways.add(`${ft.sectionLetter}:::${ft.point}`);
  }

  // Symbol results per formula
  const symbolPerFormulaMap = new Map<
    string,
    { passed: boolean; ungroundedSymbols: string[] }
  >();
  for (const pf of pipelineReport.deterministicReport.symbols.perFormulaResults) {
    symbolPerFormulaMap.set(pf.latex, {
      passed: pf.passed,
      ungroundedSymbols: pf.ungroundedSymbols,
    });
  }

  // Formula equivalence lookup
  const equivResultMap = new Map<
    NoteFormula,
    { equivalent: boolean; contradicts: boolean; reason?: string }
  >();
  for (const fr of pipelineReport.equivalenceReport.formulaResults) {
    equivResultMap.set(fr.formula, fr.result);
  }

  const formulaResults: FormulaVerificationResult[] = [];
  const warnings: string[] = [
    ...pipelineReport.deterministicReport.summary.warnings,
  ];

  // Process sections
  for (const sec of clonedSections) {
    // 1. Core Statement
    const coreClaim = claims.find(
      (c) => c.sectionLetter === sec.letter && c.kind === "coreStatement",
    );
    if (coreClaim && sec.coreStatement) {
      const v = claimVerdictMap.get(coreClaim.claimId);
      if (v?.verdict === "UNSUPPORTED") {
        sec.coreStatement = undefined;
        unsupportedClaimsRemoved++;
      } else if (v?.verdict === "CONTRADICTED") {
        warnings.push(
          `Section ${sec.letter} core statement contradicted by slide ${coreClaim.slide}: ${v.reason}`,
        );
      }
    }

    // 2. Section Grounded Bullets
    if (Array.isArray(sec.groundedBullets) && sec.groundedBullets.length > 0) {
      const retainedBullets: GroundedBullet[] = [];
      const retainedBulletPoints: string[] = [];

      for (let idx = 0; idx < sec.groundedBullets.length; idx++) {
        const gb = sec.groundedBullets[idx];
        if (!gb || !gb.text) continue;

        const bulletClaim = claims.find(
          (c) =>
            c.sectionLetter === sec.letter &&
            c.kind === "bullet" &&
            c.subHeading === undefined &&
            c.bulletIndex === idx,
        );
        const v = bulletClaim ? claimVerdictMap.get(bulletClaim.claimId) : undefined;

        // Check if UNSUPPORTED
        if (v?.verdict === "UNSUPPORTED") {
          const hasOtherContent = hasOtherSectionContent(sec, gb.text);
          if (!hasOtherContent && retainedBullets.length === 0) {
            // Guardrail: Keep bullet flagged needs_review to prevent empty section
            gb.status = "needs_review";
            gb.verdict = "UNSUPPORTED";
            gb.reviewReason = `Unsupported claim preserved to prevent empty section: ${v.reason || "No source support"}`;
            needsReviewCount++;
            retainedBullets.push(gb);
            retainedBulletPoints.push(gb.text);
          } else {
            unsupportedClaimsRemoved++;
            continue; // Remove unsupported bullet
          }
        } else {
          // Check quote match
          const quoteCheck = verifyEvidenceQuoteMatch(
            gb.evidence || "",
            gb.slide,
            sources,
          );
          const quoteFailed =
            !quoteCheck.matched ||
            quoteFailBullets.has(`${sec.letter}:::${gb.text}`);

          if (v?.verdict === "CONTRADICTED") {
            gb.status = "needs_review";
            gb.verdict = "CONTRADICTED";
            gb.reviewReason =
              v.reason || "Bullet contradicts source slide text";
            needsReviewCount++;
          } else if (quoteFailed) {
            gb.status = "needs_review";
            gb.reviewReason =
              gb.reviewReason ||
              `Evidence quote failed source match on slide ${gb.slide}`;
            needsReviewCount++;
          } else if (v?.verdict === "SUPPORTED") {
            gb.status = "verified";
            gb.verdict = "SUPPORTED";
          }
          retainedBullets.push(gb);
          retainedBulletPoints.push(gb.text);
        }
      }

      sec.groundedBullets = retainedBullets;
      sec.bulletPoints = retainedBulletPoints;
    }

    // 3. SubSection Bullets
    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (!sub) continue;
        if (
          Array.isArray(sub.groundedBullets) &&
          sub.groundedBullets.length > 0
        ) {
          const retainedSubBullets: GroundedBullet[] = [];
          const retainedSubBulletPoints: string[] = [];

          for (let idx = 0; idx < sub.groundedBullets.length; idx++) {
            const gb = sub.groundedBullets[idx];
            if (!gb || !gb.text) continue;

            const bulletClaim = claims.find(
              (c) =>
                c.sectionLetter === sec.letter &&
                c.kind === "bullet" &&
                c.subHeading === sub.heading &&
                c.bulletIndex === idx,
            );
            const v = bulletClaim
              ? claimVerdictMap.get(bulletClaim.claimId)
              : undefined;

            if (v?.verdict === "UNSUPPORTED") {
              const hasFormulas =
                Array.isArray(sub.formulas) && sub.formulas.length > 0;
              if (!hasFormulas && retainedSubBullets.length === 0) {
                // Keep marked to prevent completely blank subsection
                gb.status = "needs_review";
                gb.verdict = "UNSUPPORTED";
                gb.reviewReason = `Unsupported claim preserved to prevent empty subsection: ${v.reason || "No source support"}`;
                needsReviewCount++;
                retainedSubBullets.push(gb);
                retainedSubBulletPoints.push(gb.text);
              } else {
                unsupportedClaimsRemoved++;
                continue;
              }
            } else {
              const quoteCheck = verifyEvidenceQuoteMatch(
                gb.evidence || "",
                gb.slide,
                sources,
              );
              const quoteFailed =
                !quoteCheck.matched ||
                quoteFailBullets.has(`${sec.letter}:::${gb.text}`);

              if (v?.verdict === "CONTRADICTED") {
                gb.status = "needs_review";
                gb.verdict = "CONTRADICTED";
                gb.reviewReason =
                  v.reason || "Bullet contradicts source slide text";
                needsReviewCount++;
              } else if (quoteFailed) {
                gb.status = "needs_review";
                gb.reviewReason =
                  gb.reviewReason ||
                  `Evidence quote failed source match on slide ${gb.slide}`;
                needsReviewCount++;
              } else if (v?.verdict === "SUPPORTED") {
                gb.status = "verified";
                gb.verdict = "SUPPORTED";
              }
              retainedSubBullets.push(gb);
              retainedSubBulletPoints.push(gb.text);
            }
          }

          sub.groundedBullets = retainedSubBullets;
          sub.bulletPoints = retainedSubBulletPoints;
        }
      }
    }

    // 4. Key Takeaways Items
    if (
      sec.keyTakeaways &&
      Array.isArray(sec.keyTakeaways.items) &&
      sec.keyTakeaways.items.length > 0
    ) {
      const retainedItems: KeyTakeawaysItem[] = [];

      for (let idx = 0; idx < sec.keyTakeaways.items.length; idx++) {
        const item = sec.keyTakeaways.items[idx];
        if (!item || !item.point) continue;

        const takeawayClaim = claims.find(
          (c) =>
            c.sectionLetter === sec.letter &&
            c.kind === "takeaway" &&
            c.takeawayIndex === idx,
        );
        const v = takeawayClaim
          ? claimVerdictMap.get(takeawayClaim.claimId)
          : undefined;

        if (v?.verdict === "UNSUPPORTED") {
          unsupportedClaimsRemoved++;
          continue;
        }

        const quoteCheck = item.evidence
          ? verifyEvidenceQuoteMatch(item.evidence, item.slide || 1, sources)
          : { matched: true };
        const quoteFailed =
          !quoteCheck.matched ||
          quoteFailTakeaways.has(`${sec.letter}:::${item.point}`);

        if (v?.verdict === "CONTRADICTED") {
          item.status = "needs_review";
          item.verdict = "CONTRADICTED";
          item.reviewReason =
            v.reason || "Takeaway contradicts source slide text";
          needsReviewCount++;
        } else if (quoteFailed) {
          item.status = "needs_review";
          item.reviewReason =
            item.reviewReason ||
            `Evidence quote failed source match on slide ${item.slide || 1}`;
          needsReviewCount++;
        } else if (v?.verdict === "SUPPORTED") {
          item.status = "verified";
          item.verdict = "SUPPORTED";
        }

        retainedItems.push(item);
      }

      sec.keyTakeaways.items = retainedItems;
    }

    // 5. Formulas (Section & SubSection)
    const allFormulas: NoteFormula[] = [
      ...(sec.formulas || []),
      ...(sec.subSections?.flatMap((s) => s.formulas || []) || []),
    ];

    for (const f of allFormulas) {
      if (!f || !f.latex) continue;

      const symRes =
        symbolPerFormulaMap.get(f.latex) ||
        verifyFormulaSymbolSet(f, sources, ledger);
      const symbolSetGrounded = symRes.passed;

      // Find matching equivalence result
      let eqRes:
        | { equivalent: boolean; contradicts: boolean; reason?: string }
        | undefined;
      for (const fr of pipelineReport.equivalenceReport.formulaResults) {
        if (fr.formula.latex === f.latex) {
          eqRes = fr.result;
          break;
        }
      }

      const contradicts = Boolean(
        eqRes?.contradicts || f.status === "contradicted",
      );
      const equivalent = Boolean(
        eqRes?.equivalent || f.numericEquivalencePassed,
      );
      const isLowConfidenceOcr =
        f.origin === "ocr" &&
        f.confidence !== undefined &&
        f.confidence < 0.75;

      let formulaStatus: VerificationStatus = f.status || "verified";

      if (contradicts) {
        formulaStatus = "contradicted";
        f.status = "contradicted";
        f.reviewReason =
          eqRes?.reason ||
          f.reviewReason ||
          "Formula mathematically contradicts source ledger formula";
        contradictedFormulaCount++;
      } else if (!symbolSetGrounded) {
        formulaStatus = "needs_review";
        f.status = "needs_review";
        f.reviewReason = `Ungrounded symbols: ${symRes.ungroundedSymbols.join(", ")}`;
        needsReviewCount++;
      } else if (isLowConfidenceOcr) {
        formulaStatus = "needs_review";
        f.status = "needs_review";
        f.reviewReason = `Low confidence OCR formula (${f.confidence} < 0.75)`;
        needsReviewCount++;
      } else if (!equivalent && (!f.formulaRefs || f.formulaRefs.length === 0)) {
        formulaStatus = "needs_review";
        f.status = "needs_review";
        f.reviewReason =
          f.reviewReason ||
          eqRes?.reason ||
          "Formula could not be verified against ledger";
        needsReviewCount++;
      } else if (f.status === "needs_review") {
        formulaStatus = "needs_review";
        needsReviewCount++;
      } else if (f.derivedFrom && f.derivedFrom.length > 0 && equivalent) {
        formulaStatus = "derived";
        f.status = "derived";
      } else if (equivalent || (f.formulaRefs && f.formulaRefs.length > 0)) {
        formulaStatus = "verified";
        f.status = "verified";
      }

      formulaResults.push({
        latex: f.latex,
        slide: f.slide,
        formulaRefs: f.formulaRefs,
        derivedFrom: f.derivedFrom,
        status: formulaStatus,
        symbolSetGrounded,
        ungroundedSymbols: symRes.ungroundedSymbols,
        numericEquivalencePassed: f.numericEquivalencePassed,
        contradictsSource: contradicts,
        reason: f.reviewReason,
        divergenceNotices: f.divergenceNotices || [],
      });
    }
  }

  // 5b. Deduplicate bullets and takeaways across sections and subsections
  const duplicateClaimIds = new Set(
    pipelineReport.verifierLlmReport?.duplicateIds || [],
  );
  const { sections: dedupedSections, removedDuplicateCount } =
    deduplicateNoteSections(clonedSections, duplicateClaimIds, claims);
  clonedSections.length = 0;
  clonedSections.push(...dedupedSections);

  if (removedDuplicateCount > 0) {
    unsupportedClaimsRemoved += removedDuplicateCount;
    warnings.push(
      `Deduplication: removed ${removedDuplicateCount} duplicate bullet(s)/takeaway(s) across sections.`,
    );
  }

  // 6. Hard-Fail ONLY on formulas that mathematically contradict the source
  if (
    contradictedFormulaCount > 0 &&
    options?.throwOnContradictedFormula !== false
  ) {
    throw new IngestionError(
      "FORMULA_CONTRADICTS_SOURCE",
      "Generated note contains a formula that mathematically contradicts the source slides.",
      422,
    );
  }

  // 7. Overall Verification Status Construction
  const detCoverage = pipelineReport.deterministicReport.coverage;
  const overallStatus =
    contradictedFormulaCount > 0
      ? "failed"
      : repairAttempted &&
          needsReviewCount === 0 &&
          unsupportedClaimsRemoved === 0 &&
          detCoverage.uncapturedErrorIds.length === 0
        ? "repaired"
        : needsReviewCount > 0 ||
            unsupportedClaimsRemoved > 0 ||
            detCoverage.uncapturedErrorIds.length > 0
          ? "marked"
          : "passed";

  const verification: NoteVerificationRecord = {
    status: overallStatus,
    repairAttempted,
    coverageRatio: detCoverage.coverageRatio,
    totalLedgerFormulas: ledger.length,
    placedFormulaIds: detCoverage.placedIds,
    uncapturedFormulaIds: detCoverage.uncapturedErrorIds,
    omittedByRuleFormulaIds: detCoverage.omittedByRuleIds,
    unsupportedClaimsRemoved,
    needsReviewCount,
    contradictedFormulaCount,
    evidenceMatchRatio:
      pipelineReport.deterministicReport.evidence.matchRatio,
    numberGroundingPassed:
      pipelineReport.deterministicReport.numbers.passed,
    ungroundedNumbers:
      pipelineReport.deterministicReport.numbers.ungroundedNumbers,
    symbolGroundingPassed:
      pipelineReport.deterministicReport.symbols.passed,
    ungroundedSymbols:
      pipelineReport.deterministicReport.symbols.ungroundedSymbols,
    claimVerdicts: pipelineReport.verifierLlmReport?.verdicts || [],
    formulaResults,
    divergenceNotices: pipelineReport.divergenceNotices,
    warnings,
  };

  return {
    sections: clonedSections,
    verification,
    repairAttempted,
    contradictedFormulaCount,
    needsReviewCount,
    unsupportedClaimsRemoved,
  };
}

/**
 * Stage 4.4 Verification Gate & Targeted Repair Loop:
 * 1. Financial convention detection and pinning.
 * 2. 5-step numeric resolution cascade (Steps 1–3: PATCH, RE_CITE, KEEP_AS_DERIVED at $0 cost).
 * 3. Executes verification pipeline against sources and ledger.
 * 4. Determines if targeted repair (max 1 pass) is warranted (including residual numeric bullets).
 * 5. Runs targeted repair if triggered, post-processes with injection and shield, and re-verifies.
 * 6. Applies MARK policy and hard-fail enforcement.
 * 7. Applies Step 5 (DROP) on residual ungrounded bullets with empty-section guardrail.
 * 8. Evaluates Section-Level Quality Gate decisions.
 * 9. Returns final note sections, decisions, and NoteVerificationRecord.
 */
export async function runVerificationGate(
  input: VerificationGateInput,
): Promise<VerificationGateResult> {
  const { sections, sources, ledger, omitted, options } = input;

  // Step 0: Financial Convention Pinning
  const shouldPinConventions = options?.pinConventions !== false;
  const detectedConventions = shouldPinConventions
    ? extractFinancialConventions(sources)
    : [];
  let currentSections = detectedConventions.length > 0
    ? pinConventionsToSections(sections, detectedConventions)
    : sections;

  // Step 1: Run 5-step numeric cascade (Steps 1–3: PATCH, RE_CITE, KEEP_AS_DERIVED at $0 cost)
  const preCascade = runBulletNumericCascade(
    currentSections,
    sources,
    ledger,
    { dropResidual: false },
  );
  currentSections = preCascade.sections;
  const residualNumericBullets = preCascade.residualRepairBullets;

  // Step 2: Initial verification pipeline run
  const initialPipeline = await executeVerificationPipeline({
    sections: currentSections,
    sources,
    ledger,
    omitted,
    options,
  });

  // Step 3: Check if targeted repair is warranted
  const detCoverage = initialPipeline.deterministicReport.coverage;
  const unjustifiedUncaptured = detCoverage.uncapturedErrorIds;

  const hasContradictedFormula =
    initialPipeline.equivalenceReport.contradictedFormulas > 0;
  const hasUncapturedFormulas = unjustifiedUncaptured.length > 0;
  const hasContradictedClaims =
    (initialPipeline.verifierLlmReport?.contradictedIds.length ?? 0) > 0;
  const hasResidualNumericBullets = residualNumericBullets.length > 0;

  const repairWarranted =
    hasContradictedFormula ||
    hasUncapturedFormulas ||
    hasContradictedClaims ||
    hasResidualNumericBullets;

  const canRepair =
    Boolean(options?.repairFn || options?.repairModel) &&
    (options?.maxRepairAttempts ?? 1) >= 1;

  let repairAttempted = false;

  // Step 4: Targeted repair loop (at most 1 repair pass)
  if (repairWarranted && canRepair) {
    repairAttempted = true;

    const contradictedFormulas =
      initialPipeline.equivalenceReport.formulaResults
        .filter((r) => r.result.contradicts)
        .map((r) => ({
          latex: r.formula.latex,
          parentLedgerLatex: r.parentLedgerEntries[0]?.latex,
          parentLedgerId: r.parentLedgerEntries[0]?.id,
          reason: r.result.reason,
        }));

    const uncapturedFormulas = ledger
      .filter((e) => unjustifiedUncaptured.includes(e.id))
      .map((e) => ({
        id: e.id,
        latex: e.latex,
        label: e.label,
        slide: e.slide,
        raw: e.raw,
      }));

    const contradictedClaims = (
      initialPipeline.verifierLlmReport?.verdicts || []
    )
      .filter((v) => v.verdict === "CONTRADICTED")
      .map((v) => {
        const claim = initialPipeline.claims.find(
          (c) => c.claimId === v.claimId,
        );
        return {
          claimId: v.claimId,
          text: claim?.text || "",
          slide: v.slide,
          reason: v.reason,
        };
      });

    const repairPrompt = buildTargetedRepairPrompt({
      sections: currentSections,
      contradictedFormulas,
      uncapturedFormulas,
      contradictedClaims,
      warnings: initialPipeline.deterministicReport.summary.warnings,
      residualNumericBullets,
    });

    try {
      let repairedSections: NoteSection[] | undefined;

      if (options?.repairFn) {
        const res = await options.repairFn(repairPrompt, options.signal);
        if (Array.isArray(res) && res.length > 0) {
          const first = res[0] as any;
          if (first && typeof first === "object") {
            if (Array.isArray(first.bulletPoints) || ("formulas" in first && !("bullets" in first))) {
              repairedSections = res as NoteSection[];
            } else {
              repairedSections = (res as SynthesisSection[]).map((sec, idx) =>
                mapSynthesisSection(sec, idx, ledger),
              );
            }
          }
        }
      } else if (options?.repairModel) {
        const repairRes = await generateObject({
          model: options.repairModel,
          schema: synthesisSchema,
          system: CLUTCH_NOTES_SYSTEM_PROMPT,
          prompt: repairPrompt,
          temperature: 0,
          abortSignal: options.signal,
        });

        if (repairRes.object && Array.isArray(repairRes.object.sections)) {
          repairedSections = repairRes.object.sections.map((sec, idx) =>
            mapSynthesisSection(sec, idx, ledger),
          );
        }
      }

      if (repairedSections && repairedSections.length > 0) {
        // Post-repair processing: inject authoritative ledger formulas -> shield -> re-inject
        const { sections: injected1 } = injectLedgerFormulasById(
          repairedSections,
          ledger,
        );
        const rawSlideText = sources.map((s) => s.text).join("\n");
        const shielded = applyHallucinationShield(injected1, rawSlideText);
        const { sections: injected2 } = injectLedgerFormulasById(
          shielded,
          ledger,
        );
        currentSections = injected2;

        if (detectedConventions.length > 0) {
          currentSections = pinConventionsToSections(currentSections, detectedConventions);
        }
      }
    } catch (err) {
      console.warn(
        "[runVerificationGate] Targeted repair pass failed or aborted, proceeding with un-repaired sections:",
        err,
      );
    }
  }

  // Step 5: Re-run verification pipeline after repair (or use initial report)
  const finalPipeline = repairAttempted
    ? await executeVerificationPipeline({
        sections: currentSections,
        sources,
        ledger,
        omitted,
        options,
      })
    : initialPipeline;

  // Step 6: Apply MARK policy and Hard-Fail enforcement
  const markResult = applyMarkPolicyAndGate({
    sections: finalPipeline.annotatedSections,
    sources,
    ledger,
    omitted,
    pipelineReport: finalPipeline,
    options,
    repairAttempted,
  });

  // Step 7: Apply Step 5 (DROP) on any residual bullets that still fail numeric grounding
  const perSectionDroppedCounts: Record<string, number> = {};
  const sectionsAfterDrop: NoteSection[] = JSON.parse(
    JSON.stringify(markResult.sections),
  );

  for (const sec of sectionsAfterDrop) {
    if (Array.isArray(sec.groundedBullets) && sec.groundedBullets.length > 0) {
      const keptBullets: GroundedBullet[] = [];
      const droppedOriginalTexts = new Set<string>();

      for (const bullet of sec.groundedBullets) {
        const stepRes = resolveBulletNumericStep(bullet, sources, ledger, {
          dropResidual: true,
        });
        if (stepRes.action === "DROP") {
          const hasOther =
            hasOtherSectionContent(sec, bullet.text) || keptBullets.length > 0;
          if (!hasOther) {
            keptBullets.push({
              ...bullet,
              status: "needs_review",
              reviewReason:
                "Ungrounded numeric claim preserved to prevent empty section",
            });
          } else {
            droppedOriginalTexts.add(bullet.text);
            perSectionDroppedCounts[sec.letter] =
              (perSectionDroppedCounts[sec.letter] || 0) + 1;
          }
        } else {
          keptBullets.push(stepRes.bullet);
        }
      }

      sec.groundedBullets = keptBullets;
      if (Array.isArray(sec.bulletPoints)) {
        sec.bulletPoints = sec.bulletPoints.filter(
          (bp) => !droppedOriginalTexts.has(bp),
        );
      }
    }

    if (Array.isArray(sec.subSections)) {
      for (const sub of sec.subSections) {
        if (
          Array.isArray(sub.groundedBullets) &&
          sub.groundedBullets.length > 0
        ) {
          const keptSubBullets: GroundedBullet[] = [];
          const droppedSubTexts = new Set<string>();

          for (const bullet of sub.groundedBullets) {
            const stepRes = resolveBulletNumericStep(bullet, sources, ledger, {
              dropResidual: true,
            });
            if (stepRes.action === "DROP") {
              const hasOther =
                (Array.isArray(sub.formulas) && sub.formulas.length > 0) ||
                keptSubBullets.length > 0;
              if (!hasOther) {
                keptSubBullets.push({
                  ...bullet,
                  status: "needs_review",
                  reviewReason:
                    "Ungrounded numeric claim preserved to prevent empty subsection",
                });
              } else {
                droppedSubTexts.add(bullet.text);
                perSectionDroppedCounts[sec.letter] =
                  (perSectionDroppedCounts[sec.letter] || 0) + 1;
              }
            } else {
              keptSubBullets.push(stepRes.bullet);
            }
          }

          sub.groundedBullets = keptSubBullets;
          if (Array.isArray(sub.bulletPoints)) {
            sub.bulletPoints = sub.bulletPoints.filter(
              (bp) => !droppedSubTexts.has(bp),
            );
          }
        }
      }
    }
  }

  // Step 8: Section-Level Quality Gate
  let finalSections = sectionsAfterDrop;
  let decisions: SectionQualityDecision[] = [];
  let omittedNotices: string[] = [];
  let backgroundRegenSections: string[] = [];

  if (options?.enforceSectionQualityGate) {
    const gateRes = await runSectionQualityGate({
      initialSections: sections,
      verifiedSections: finalSections,
      perSectionDroppedCounts,
      retrySectionFn: options?.retrySectionFn,
      onBackgroundRegenSection: options?.onBackgroundRegenSection,
    });
    finalSections = gateRes.sections;
    decisions = gateRes.decisions;
    omittedNotices = gateRes.omittedNotices;
    backgroundRegenSections = gateRes.backgroundRegenSections;
  } else {
    decisions = finalSections.map((sec) => {
      const initialSec = sections.find((s) => s.letter === sec.letter);
      const initialBulletCount = initialSec
        ? countSectionBullets(initialSec)
        : countSectionBullets(sec);
      const droppedCount = perSectionDroppedCounts[sec.letter] || 0;
      const { dropRate, action } = evaluateSectionDropRate(
        initialBulletCount,
        droppedCount,
      );
      return {
        sectionLetter: sec.letter,
        titleVi: sec.titleVi,
        initialBulletCount,
        droppedBulletCount: droppedCount,
        dropRate,
        action,
        omitted: false,
      };
    });
  }

  return {
    ...markResult,
    sections: finalSections,
    decisions,
    omittedNotices,
    omittedSectionNotices: omittedNotices,
    backgroundRegenSections,
    pinnedConventions: detectedConventions,
  };
}
