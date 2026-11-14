import katex from "katex";
import {
  type AcceptedFormula,
  type DocumentBlueprint,
  type FormulaCandidate,
  type NoteDefect,
  type NoteDefectType,
  type NoteFormula,
  type NoteSection,
  type QAReport,
  type SectionDraft,
  type SourceAtom,
  type SymbolBinding,
  type NoteVerificationRecord,
  qaReportSchema,
  noteDefectSchema,
} from "@/lib/schemas/notes";
import {
  isDanglingOrEmptySideEquation,
  normalizeInventoryFormulaKey,
} from "@/lib/notes/formula-inventory";
import { normalizePdfMathSymbols } from "@/lib/notes/pdf-symbol-normalizer";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface ReferenceIntegrityInput {
  sectionDrafts?: SectionDraft[];
  sections?: NoteSection[];
  acceptedFormulas: AcceptedFormula[];
  atoms: SourceAtom[];
  symbolBindings: SymbolBinding[];
}

export interface ReferenceIntegrityResult {
  passed: boolean;
  unresolvedFormulaRefs: string[];
  unresolvedAtomIds: string[];
  unresolvedSymbolBindingIds: string[];
  defects: NoteDefect[];
}

export interface ManifestCoverageInput {
  blueprint?: DocumentBlueprint;
  sectionDrafts?: SectionDraft[];
  sections: NoteSection[];
  acceptedFormulas: AcceptedFormula[];
  atoms?: SourceAtom[];
}

export interface ManifestCoverageResult {
  passed: boolean;
  requiredFormulaIds: string[];
  renderedFormulaIds: string[];
  missingFormulaIds: string[];
  requiredAtomIds: string[];
  coveredAtomIds: string[];
  missingAtomIds: string[];
  defects: NoteDefect[];
}

export interface StrictKatexCompileFailure {
  sectionLetter: string;
  targetId: string;
  latex: string;
  error: string;
}

export interface StrictKatexCompileInput {
  sections: NoteSection[];
}

export interface KatexCompileResult {
  passed: boolean;
  totalChecked: number;
  failures: StrictKatexCompileFailure[];
  defects: NoteDefect[];
}

export interface ConditionPreservationMissing {
  atomId: string;
  slide: number;
  sectionLetter: string;
  content: string;
  reason: string;
}

export interface ConditionPreservationInput {
  sections: NoteSection[];
  sectionDrafts?: SectionDraft[];
  atoms: SourceAtom[];
  acceptedFormulas?: AcceptedFormula[];
  blueprint?: DocumentBlueprint;
}

export interface ConditionPreservationResult {
  passed: boolean;
  totalConditions: number;
  missingConditions: ConditionPreservationMissing[];
  defects: NoteDefect[];
}

export interface SymbolHygieneDuplicate {
  symbol: string;
  sectionLetter: string;
  formulaLatex: string;
}

export interface SymbolHygieneMisplaced {
  symbol: string;
  expectedSectionLetter: string;
  actualSectionLetter?: string;
  reason: string;
}

export interface SymbolHygieneInput {
  sections: NoteSection[];
  acceptedFormulas: AcceptedFormula[];
  symbolBindings: SymbolBinding[];
  blueprint?: DocumentBlueprint;
}

export interface SymbolHygieneResult {
  passed: boolean;
  duplicateDefinitions: SymbolHygieneDuplicate[];
  misplacedDefinitions: SymbolHygieneMisplaced[];
  defects: NoteDefect[];
}

export interface QualityRubricInput {
  blueprint?: DocumentBlueprint;
  sectionDrafts?: SectionDraft[];
  sections: NoteSection[];
  acceptedFormulas: AcceptedFormula[];
  atoms: SourceAtom[];
  symbolBindings: SymbolBinding[];
  excludedCandidates?: FormulaCandidate[];
}

export interface CompilerQualityRubricReport {
  passed: boolean;
  qaReport: QAReport;
  referenceIntegrity: ReferenceIntegrityResult;
  manifestCoverage: ManifestCoverageResult;
  katexCompile: KatexCompileResult;
  conditionPreservation: ConditionPreservationResult;
  symbolHygiene: SymbolHygieneResult;
  defects: NoteDefect[];
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function createDefect(params: {
  id: string;
  sectionLetter: string;
  targetId: string;
  defectType: NoteDefectType;
  reason: string;
  slide?: number;
  requiredFormulaId?: string;
}): NoteDefect {
  return noteDefectSchema.parse(params);
}

const COMMON_PROSE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "or", "that",
  "the", "to", "was", "were", "will", "with", " các", "của", "cho",
  "được", "khi", "là", "và", "với", "trong", "thì", "mà", "từ",
]);

function extractSignificantTokens(text: string): Set<string> {
  if (!text) return new Set();
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9_\u00C0-\u1EF9]/gi, " ");
  const words = normalized
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !COMMON_PROSE_STOP_WORDS.has(w));
  return new Set(words);
}

function extractSectionAllText(sec: NoteSection): string {
  const parts: string[] = [
    sec.titleVi,
    sec.titleEn || "",
    sec.coreStatement || "",
    sec.overview || "",
    ...(sec.bulletPoints || []),
    ...(sec.groundedBullets || []).flatMap((b) => [b.text, b.evidence]),
    ...(sec.formulas || []).flatMap((f) => [
      f.name || "",
      f.leadText || "",
      f.latex,
      f.description || "",
      ...(f.variables || []).map((v) => `${v.symbol} ${v.definition}`),
    ]),
    ...(sec.subSections || []).flatMap((sub) => [
      sub.heading,
      sub.leadIn || "",
      ...(sub.bulletPoints || []),
      ...(sub.groundedBullets || []).flatMap((b) => [b.text, b.evidence]),
      ...(sub.formulas || []).flatMap((f) => [
        f.name || "",
        f.leadText || "",
        f.latex,
        f.description || "",
        ...(f.variables || []).map((v) => `${v.symbol} ${v.definition}`),
      ]),
    ]),
  ];
  if (sec.keyTakeaways) {
    parts.push(sec.keyTakeaways.title || "");
    parts.push(sec.keyTakeaways.modelSelectionRule || "");
    parts.push(sec.keyTakeaways.realWorldConditions || "");
    parts.push(sec.keyTakeaways.boundaryConditions || "");
    parts.push(...(sec.keyTakeaways.summaryPoints || []));
    for (const item of sec.keyTakeaways.items || []) {
      parts.push(item.point);
      parts.push(item.evidence || "");
      parts.push(...(item.subBullets || []));
    }
  }
  return parts.filter(Boolean).join(" ");
}

function isAtomCoveredInText(atom: SourceAtom, sectionText: string): boolean {
  if (!sectionText) return false;

  // 1. Explicit atom id match
  if (sectionText.includes(atom.id)) return true;

  // 2. Exact verbatim evidence match
  if (
    atom.evidence &&
    atom.evidence.trim().length > 5 &&
    sectionText.toLowerCase().includes(atom.evidence.trim().toLowerCase())
  ) {
    return true;
  }

  // 3. Significant token overlap >= 40%
  const atomTokens = extractSignificantTokens(
    `${atom.content} ${atom.evidence || ""}`,
  );
  if (atomTokens.size === 0) return true;

  const sectionTokens = extractSignificantTokens(sectionText);
  let matches = 0;
  for (const token of atomTokens) {
    if (sectionTokens.has(token)) {
      matches++;
    }
  }
  const ratio = matches / atomTokens.size;
  return ratio >= 0.4;
}

export function hasUnbalancedBraces(latex: string): boolean {
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    // Count consecutive preceding backslashes
    let slashCount = 0;
    let j = i - 1;
    while (j >= 0 && latex[j] === "\\") {
      slashCount++;
      j--;
    }
    const isEscaped = slashCount % 2 === 1;
    if (!isEscaped) {
      if (latex[i] === "{") {
        depth++;
      } else if (latex[i] === "}") {
        depth--;
        if (depth < 0) return true;
      }
    }
  }
  return depth !== 0;
}

export function hasRawArrowsOutsideText(latex: string): boolean {
  if (!latex) return false;
  let s = latex;
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(
      /\\(?:text|mathrm|mathbf|textbf|mathit|operatorname)\{[^{}]*\}/g,
      "",
    );
  }
  const pattern = /(?<![<])=>|(?<![-<])->(?![>])|(?<![<])<-(?![-=>])/;
  return pattern.test(s);
}

function extractInlineMathSpans(text: string): string[] {
  if (!text) return [];
  const spans: string[] = [];
  const s = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => {
    spans.push(inner);
    return "";
  });
  s.replace(/(?<!\$)\$(?!\$)([^$]+?)(?<!\$)\$(?!\$)/g, (_m, inner) => {
    spans.push(inner);
    return "";
  });
  return spans;
}

interface ParsedInequality {
  lhs: string;
  op: "<" | ">" | "<=" | ">=";
  rhs: string;
  raw: string;
}

function parseInequalities(text: string): ParsedInequality[] {
  if (!text) return [];
  const results: ParsedInequality[] = [];
  let s = text.replace(/\$/g, " ");
  s = s.replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\le\b|\\leq\b|≤/g, "<=");
  s = s.replace(/\\ge\b|\\geq\b|≥/g, ">=");

  const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|>=|<|>)\s*([a-zA-Z0-9_]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(s)) !== null) {
    results.push({
      lhs: match[1].toLowerCase(),
      op: match[2] as "<" | ">" | "<=" | ">=",
      rhs: match[3].toLowerCase(),
      raw: match[0],
    });
  }
  return results;
}

function isInvertedInequality(
  expected: ParsedInequality,
  candidate: ParsedInequality,
): boolean {
  const isOppositeOp = (
    (expected.op === "<" || expected.op === "<=") &&
    (candidate.op === ">" || candidate.op === ">=")
  ) || (
    (expected.op === ">" || expected.op === ">=") &&
    (candidate.op === "<" || candidate.op === "<=")
  );

  const isSameOp = (
    (expected.op === "<" || expected.op === "<=") &&
    (candidate.op === "<" || candidate.op === "<=")
  ) || (
    (expected.op === ">" || expected.op === ">=") &&
    (candidate.op === ">" || candidate.op === ">=")
  );

  // A < B vs A > B
  if (expected.lhs === candidate.lhs && expected.rhs === candidate.rhs) {
    return isOppositeOp;
  }

  // A < B vs B < A (B < A is equivalent to A > B)
  if (expected.lhs === candidate.rhs && expected.rhs === candidate.lhs) {
    return isSameOp;
  }

  return false;
}

function isMatchingInequality(
  expected: ParsedInequality,
  candidate: ParsedInequality,
): boolean {
  const isSameOp = (
    (expected.op === "<" || expected.op === "<=") &&
    (candidate.op === "<" || candidate.op === "<=")
  ) || (
    (expected.op === ">" || expected.op === ">=") &&
    (candidate.op === ">" || candidate.op === ">=")
  );

  const isOppositeOp = (
    (expected.op === "<" || expected.op === "<=") &&
    (candidate.op === ">" || candidate.op === ">=")
  ) || (
    (expected.op === ">" || expected.op === ">=") &&
    (candidate.op === "<" || candidate.op === "<=")
  );

  // A < B vs A < B
  if (expected.lhs === candidate.lhs && expected.rhs === candidate.rhs) {
    return isSameOp;
  }

  // A < B vs B > A (B > A is equivalent to A < B)
  if (expected.lhs === candidate.rhs && expected.rhs === candidate.lhs) {
    return isOppositeOp;
  }

  return false;
}

function latexContainsSymbolGlyph(latex: string, symbol: string): boolean {
  if (!latex || !symbol) return false;
  const cleanSym = symbol.replace(/^\$+|\$+$/g, "").trim();
  if (!cleanSym) return false;
  const escaped = cleanSym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<![a-zA-Z0-9_])${escaped}(?![a-zA-Z0-9_])`);
  return regex.test(latex);
}

// ---------------------------------------------------------------------------
// 1. Reference Integrity Verifier
// ---------------------------------------------------------------------------

export function verifyReferenceIntegrity(
  input: ReferenceIntegrityInput,
): ReferenceIntegrityResult {
  const acceptedFormulaMap = new Map<string, AcceptedFormula>(
    input.acceptedFormulas.map((f) => [f.id, f]),
  );
  const atomMap = new Map<string, SourceAtom>(
    input.atoms.map((a) => [a.id, a]),
  );
  const symbolBindingMap = new Map<string, SymbolBinding>(
    input.symbolBindings.map((b) => [b.id, b]),
  );

  const unresolvedFormulaRefs: string[] = [];
  const unresolvedAtomIds: string[] = [];
  const unresolvedSymbolBindingIds: string[] = [];
  const defects: NoteDefect[] = [];

  // 1. Verify section drafts
  if (input.sectionDrafts) {
    for (const draft of input.sectionDrafts) {
      for (const block of draft.blocks) {
        for (const ref of block.formulaRefs || []) {
          if (!acceptedFormulaMap.has(ref)) {
            unresolvedFormulaRefs.push(ref);
            defects.push(
              createDefect({
                id: `defect-ref-formula-${draft.letter}-${block.id}-${ref}`,
                sectionLetter: draft.letter,
                targetId: block.id,
                defectType: "MISSING_FORMULA",
                reason: `Teaching block '${block.id}' references non-existent accepted formula '${ref}'`,
                requiredFormulaId: ref,
              }),
            );
          }
        }

        for (const atomId of block.supportAtomIds || []) {
          if (!atomMap.has(atomId)) {
            unresolvedAtomIds.push(atomId);
            defects.push(
              createDefect({
                id: `defect-ref-atom-${draft.letter}-${block.id}-${atomId}`,
                sectionLetter: draft.letter,
                targetId: block.id,
                defectType: "UNSUPPORTED_CLAUSE",
                reason: `Teaching block '${block.id}' references non-existent support atom '${atomId}'`,
              }),
            );
          }
        }

        for (const symId of block.symbolBindingIds || []) {
          if (!symbolBindingMap.has(symId)) {
            unresolvedSymbolBindingIds.push(symId);
            defects.push(
              createDefect({
                id: `defect-ref-sym-${draft.letter}-${block.id}-${symId}`,
                sectionLetter: draft.letter,
                targetId: block.id,
                defectType: "SYMBOL_DEFINITION_MISPLACED",
                reason: `Teaching block '${block.id}' references non-existent symbol binding '${symId}'`,
              }),
            );
          }
        }
      }
    }
  }

  // 2. Verify sections (sec.formulas and sec.subSections[].formulas)
  if (input.sections) {
    for (const sec of input.sections) {
      const allFormulas = [
        ...(sec.formulas || []),
        ...(sec.subSections || []).flatMap((sub) => sub.formulas || []),
      ];

      for (const formula of allFormulas) {
        for (const ref of formula.formulaRefs || []) {
          if (!acceptedFormulaMap.has(ref)) {
            unresolvedFormulaRefs.push(ref);
            defects.push(
              createDefect({
                id: `defect-ref-sec-formula-${sec.letter}-${ref}`,
                sectionLetter: sec.letter,
                targetId: formula.name || formula.latex,
                defectType: "MISSING_FORMULA",
                reason: `Formula in section '${sec.letter}' references non-existent accepted formula '${ref}'`,
                slide: formula.slide,
                requiredFormulaId: ref,
              }),
            );
          }
        }
      }
    }
  }

  // 3. Verify accepted formulas' symbol bindings
  for (const formula of input.acceptedFormulas) {
    for (const symId of formula.symbolBindingIds || []) {
      if (!symbolBindingMap.has(symId)) {
        unresolvedSymbolBindingIds.push(symId);
        defects.push(
          createDefect({
            id: `defect-ref-acc-sym-${formula.id}-${symId}`,
            sectionLetter: "GLOBAL",
            targetId: formula.id,
            defectType: "SYMBOL_DEFINITION_MISPLACED",
            reason: `Accepted formula '${formula.id}' references non-existent symbol binding '${symId}'`,
            slide: formula.slide,
          }),
        );
      }
    }
  }

  const uniqueFormulaRefs = Array.from(new Set(unresolvedFormulaRefs));
  const uniqueAtomIds = Array.from(new Set(unresolvedAtomIds));
  const uniqueSymbolBindingIds = Array.from(new Set(unresolvedSymbolBindingIds));

  return {
    passed:
      uniqueFormulaRefs.length === 0 &&
      uniqueAtomIds.length === 0 &&
      uniqueSymbolBindingIds.length === 0 &&
      defects.length === 0,
    unresolvedFormulaRefs: uniqueFormulaRefs,
    unresolvedAtomIds: uniqueAtomIds,
    unresolvedSymbolBindingIds: uniqueSymbolBindingIds,
    defects,
  };
}

// ---------------------------------------------------------------------------
// 2. Manifest Coverage Verifier
// ---------------------------------------------------------------------------

export function verifyManifestCoverage(
  input: ManifestCoverageInput,
): ManifestCoverageResult {
  // Required formulas: blueprint union acceptedFormulas
  const bpFormulaIds = input.blueprint
    ? input.blueprint.sections.flatMap((s) => s.requiredFormulaIds || [])
    : [];
  const acceptedIds = input.acceptedFormulas.map((f) => f.id);
  const requiredFormulaIds = Array.from(
    new Set([...bpFormulaIds, ...acceptedIds]),
  );

  // Rendered formula IDs from sections
  const renderedSet = new Set<string>();
  const allSectionFormulas = input.sections.flatMap((sec) => [
    ...(sec.formulas || []),
    ...(sec.subSections || []).flatMap((sub) => sub.formulas || []),
  ]);

  for (const formula of allSectionFormulas) {
    if (formula.formulaRefs && formula.formulaRefs.length > 0) {
      for (const ref of formula.formulaRefs) {
        renderedSet.add(ref);
      }
    }

    const normKey = normalizeInventoryFormulaKey(formula.latex);
    if (normKey) {
      for (const accepted of input.acceptedFormulas) {
        if (normalizeInventoryFormulaKey(accepted.displayLatex) === normKey) {
          renderedSet.add(accepted.id);
        }
      }
    }
  }

  const renderedFormulaIds = Array.from(renderedSet);
  const missingFormulaIds = requiredFormulaIds.filter(
    (id) => !renderedSet.has(id),
  );

  // Required atoms
  let requiredAtomIds: string[] = [];
  if (input.blueprint) {
    requiredAtomIds = Array.from(
      new Set(input.blueprint.sections.flatMap((s) => s.requiredAtomIds || [])),
    );
  } else if (input.atoms) {
    const candidateKinds = new Set([
      "boundary_condition",
      "rule",
      "definition",
      "procedure",
    ]);
    requiredAtomIds = input.atoms
      .filter((a) => candidateKinds.has(a.kind))
      .map((a) => a.id);
  }

  // Covered atoms
  const coveredAtomSet = new Set<string>();

  // 1. From section drafts
  if (input.sectionDrafts) {
    for (const draft of input.sectionDrafts) {
      for (const block of draft.blocks) {
        for (const atomId of block.supportAtomIds || []) {
          coveredAtomSet.add(atomId);
        }
      }
    }
  }

  // 2. From sections text
  if (input.atoms) {
    for (const atom of input.atoms) {
      if (coveredAtomSet.has(atom.id)) continue;
      for (const sec of input.sections) {
        const secText = extractSectionAllText(sec);
        if (isAtomCoveredInText(atom, secText)) {
          coveredAtomSet.add(atom.id);
          break;
        }
      }
    }
  }

  const coveredAtomIds = Array.from(coveredAtomSet);
  const missingAtomIds = requiredAtomIds.filter(
    (id) => !coveredAtomSet.has(id),
  );

  const defects: NoteDefect[] = [];

  for (const missingId of missingFormulaIds) {
    const accepted = input.acceptedFormulas.find((f) => f.id === missingId);
    const owningSection = input.blueprint?.sections.find((s) =>
      (s.requiredFormulaIds || []).includes(missingId),
    );
    const sectionLetter = owningSection?.letter ?? "GLOBAL";

    defects.push(
      createDefect({
        id: `defect-missing-formula-${missingId}`,
        sectionLetter,
        targetId: missingId,
        defectType: "MISSING_FORMULA",
        reason: `Required formula '${missingId}' is missing from rendered note sections`,
        requiredFormulaId: missingId,
        slide: accepted?.slide,
      }),
    );
  }

  for (const missingAtomId of missingAtomIds) {
    const atom = input.atoms?.find((a) => a.id === missingAtomId);
    const owningSection = input.blueprint?.sections.find((s) =>
      (s.requiredAtomIds || []).includes(missingAtomId),
    );
    const sectionLetter = owningSection?.letter ?? "GLOBAL";

    defects.push(
      createDefect({
        id: `defect-missing-atom-${missingAtomId}`,
        sectionLetter,
        targetId: missingAtomId,
        defectType: "UNSUPPORTED_CLAUSE",
        reason: `Required source atom '${missingAtomId}' is missing from rendered note sections and drafts`,
        slide: atom?.slide,
      }),
    );
  }

  return {
    passed:
      missingFormulaIds.length === 0 &&
      missingAtomIds.length === 0 &&
      defects.length === 0,
    requiredFormulaIds,
    renderedFormulaIds,
    missingFormulaIds,
    requiredAtomIds,
    coveredAtomIds,
    missingAtomIds,
    defects,
  };
}

// ---------------------------------------------------------------------------
// 3. Strict KaTeX Compile Verifier
// ---------------------------------------------------------------------------

export function verifyStrictKatexCompile(
  input: StrictKatexCompileInput,
): KatexCompileResult {
  let totalChecked = 0;
  const failures: StrictKatexCompileFailure[] = [];
  const defects: NoteDefect[] = [];

  function checkTarget(
    latex: string,
    sectionLetter: string,
    targetId: string,
    displayMode: boolean,
    slide?: number,
  ) {
    totalChecked++;

    // 1. Empty check
    if (!latex || !latex.trim()) {
      const error = "Empty LaTeX math expression";
      failures.push({ sectionLetter, targetId, latex, error });
      defects.push(
        createDefect({
          id: `defect-katex-empty-${sectionLetter}-${failures.length}`,
          sectionLetter,
          targetId,
          defectType: "KATEX_SYNTAX_ERROR",
          reason: error,
          slide,
        }),
      );
      return;
    }

    const trimmed = latex.trim();

    // 2. Dangling or empty side equation
    if (isDanglingOrEmptySideEquation(trimmed)) {
      const error = `Dangling relation operator or empty side in equation: '${trimmed}'`;
      failures.push({ sectionLetter, targetId, latex: trimmed, error });
      defects.push(
        createDefect({
          id: `defect-katex-dangling-${sectionLetter}-${failures.length}`,
          sectionLetter,
          targetId,
          defectType: "KATEX_SYNTAX_ERROR",
          reason: error,
          slide,
        }),
      );
      return;
    }

    // 3. Unbalanced curly braces
    if (hasUnbalancedBraces(trimmed)) {
      const error = `Unbalanced curly braces '{' and '}' in LaTeX: '${trimmed}'`;
      failures.push({ sectionLetter, targetId, latex: trimmed, error });
      defects.push(
        createDefect({
          id: `defect-katex-braces-${sectionLetter}-${failures.length}`,
          sectionLetter,
          targetId,
          defectType: "KATEX_SYNTAX_ERROR",
          reason: error,
          slide,
        }),
      );
      return;
    }

    // 4. Raw unescaped arrows outside \text{...}
    if (hasRawArrowsOutsideText(trimmed)) {
      const error = `Raw unescaped '=>' or '->' arrow outside \\text{...}: '${trimmed}'`;
      failures.push({ sectionLetter, targetId, latex: trimmed, error });
      defects.push(
        createDefect({
          id: `defect-katex-rawarrow-${sectionLetter}-${failures.length}`,
          sectionLetter,
          targetId,
          defectType: "KATEX_SYNTAX_ERROR",
          reason: error,
          slide,
        }),
      );
      return;
    }

    // 5. KaTeX render check
    let sanitized = normalizePdfMathSymbols(trimmed);
    sanitized = sanitized.replace(/(?<!\\)%/g, "\\%");

    try {
      katex.renderToString(sanitized, {
        displayMode,
        throwOnError: true,
        trust: false,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ sectionLetter, targetId, latex: trimmed, error });
      defects.push(
        createDefect({
          id: `defect-katex-render-${sectionLetter}-${failures.length}`,
          sectionLetter,
          targetId,
          defectType: "KATEX_SYNTAX_ERROR",
          reason: `KaTeX parse error: ${error} in '${trimmed}'`,
          slide,
        }),
      );
    }
  }

  for (const sec of input.sections) {
    const sectionLetter = sec.letter;

    // Check boxed formulas
    for (let fIdx = 0; fIdx < (sec.formulas || []).length; fIdx++) {
      const formula = sec.formulas[fIdx];
      const targetId = formula.name || `formula-${sectionLetter}-${fIdx + 1}`;
      checkTarget(formula.latex, sectionLetter, targetId, true, formula.slide);

      // Check formula variables
      for (const v of formula.variables || []) {
        if (v.symbol) {
          checkTarget(
            v.symbol,
            sectionLetter,
            `${targetId}-var-${v.symbol}`,
            false,
            formula.slide,
          );
        }
      }
    }

    // Check subSections boxed formulas
    for (const sub of sec.subSections || []) {
      for (let fIdx = 0; fIdx < (sub.formulas || []).length; fIdx++) {
        const formula = sub.formulas[fIdx];
        const targetId = formula.name || `subformula-${sectionLetter}-${fIdx + 1}`;
        checkTarget(formula.latex, sectionLetter, targetId, true, formula.slide);

        for (const v of formula.variables || []) {
          if (v.symbol) {
            checkTarget(
              v.symbol,
              sectionLetter,
              `${targetId}-var-${v.symbol}`,
              false,
              formula.slide,
            );
          }
        }
      }
    }

    // Check inline math spans across section text
    const textPool: string[] = [
      sec.coreStatement || "",
      sec.overview || "",
      ...(sec.bulletPoints || []),
      ...(sec.groundedBullets || []).flatMap((b) => [b.text, b.evidence]),
      ...(sec.subSections || []).flatMap((sub) => [
        sub.leadIn || "",
        ...(sub.bulletPoints || []),
        ...(sub.groundedBullets || []).flatMap((b) => [b.text, b.evidence]),
      ]),
    ];

    if (sec.keyTakeaways) {
      textPool.push(sec.keyTakeaways.modelSelectionRule || "");
      textPool.push(sec.keyTakeaways.realWorldConditions || "");
      textPool.push(sec.keyTakeaways.boundaryConditions || "");
      textPool.push(...(sec.keyTakeaways.summaryPoints || []));
      for (const item of sec.keyTakeaways.items || []) {
        textPool.push(item.point);
        textPool.push(item.evidence || "");
        textPool.push(...(item.subBullets || []));
      }
    }

    for (let tIdx = 0; tIdx < textPool.length; tIdx++) {
      const text = textPool[tIdx];
      const inlineMathSpans = extractInlineMathSpans(text);
      for (let mIdx = 0; mIdx < inlineMathSpans.length; mIdx++) {
        const span = inlineMathSpans[mIdx];
        checkTarget(
          span,
          sectionLetter,
          `inline-${sectionLetter}-${tIdx}-${mIdx}`,
          false,
        );
      }
    }
  }

  return {
    passed: failures.length === 0 && defects.length === 0,
    totalChecked,
    failures,
    defects,
  };
}

// ---------------------------------------------------------------------------
// 4. Condition Preservation Verifier
// ---------------------------------------------------------------------------

export function verifyConditionPreservation(
  input: ConditionPreservationInput,
): ConditionPreservationResult {
  const conditionAtomMap = new Map<string, SourceAtom>();

  for (const atom of input.atoms) {
    if (atom.kind === "boundary_condition") {
      conditionAtomMap.set(atom.id, atom);
    }
  }

  if (input.acceptedFormulas) {
    const conditionAtomIds = new Set(
      input.acceptedFormulas.flatMap((f) => f.conditionAtomIds || []),
    );
    for (const atom of input.atoms) {
      if (conditionAtomIds.has(atom.id)) {
        conditionAtomMap.set(atom.id, atom);
      }
    }
  }

  const conditionAtoms = Array.from(conditionAtomMap.values());
  const missingConditions: ConditionPreservationMissing[] = [];
  const defects: NoteDefect[] = [];

  for (const atom of conditionAtoms) {
    // 1. Determine target section
    let targetSectionLetter = "GLOBAL";
    if (input.blueprint) {
      const bpSec = input.blueprint.sections.find(
        (s) =>
          (s.requiredAtomIds || []).includes(atom.id) ||
          (s.sourceSlides || []).includes(atom.slide),
      );
      if (bpSec) {
        targetSectionLetter = bpSec.letter;
      }
    }

    if (targetSectionLetter === "GLOBAL") {
      const noteSec = input.sections.find((s) =>
        (s.sourceSlides || []).includes(atom.slide),
      );
      if (noteSec) {
        targetSectionLetter = noteSec.letter;
      } else if (input.sections.length > 0) {
        targetSectionLetter = input.sections[0].letter;
      }
    }

    // 2. Draft check (if drafts provided)
    let referencedInDrafts = false;
    if (input.sectionDrafts && input.sectionDrafts.length > 0) {
      for (const draft of input.sectionDrafts) {
        for (const block of draft.blocks) {
          if ((block.supportAtomIds || []).includes(atom.id)) {
            referencedInDrafts = true;
            break;
          }
          if (
            atom.content &&
            block.text &&
            block.text.toLowerCase().includes(atom.content.toLowerCase())
          ) {
            referencedInDrafts = true;
            break;
          }
        }
        if (referencedInDrafts) break;
      }
    } else {
      referencedInDrafts = true;
    }

    // 3. Section text compilation and inequality check
    const targetSection =
      input.sections.find((s) => s.letter === targetSectionLetter) ??
      input.sections[0];
    const targetSectionText = targetSection
      ? extractSectionAllText(targetSection)
      : "";
    const fullDocumentText = input.sections
      .map((s) => extractSectionAllText(s))
      .join(" ");

    const textToInspect = targetSectionText || fullDocumentText;

    // Parse inequalities from atom
    const atomInequalities = [
      ...parseInequalities(atom.content),
      ...parseInequalities(atom.evidence || ""),
    ];
    const textInequalities = parseInequalities(textToInspect);

    let isInverted = false;
    let invertedDetails = "";
    let isMatched = false;

    for (const expected of atomInequalities) {
      for (const actual of textInequalities) {
        if (isInvertedInequality(expected, actual)) {
          isInverted = true;
          invertedDetails = `expected '${expected.raw}', but section states inverted condition '${actual.raw}'`;
          break;
        }
        if (isMatchingInequality(expected, actual)) {
          isMatched = true;
        }
      }
      if (isInverted) break;
    }

    let isPreserved = false;
    let failureReason = "";

    if (isInverted) {
      isPreserved = false;
      failureReason = `Boundary condition inequality inverted: ${invertedDetails}`;
    } else if (isMatched) {
      isPreserved = true;
    } else {
      // Check token overlap >= 40% or evidence match
      if (isAtomCoveredInText(atom, textToInspect)) {
        isPreserved = true;
      } else {
        isPreserved = false;
        failureReason = `Boundary condition '${atom.content}' not preserved in section text (token overlap < 40%)`;
      }
    }

    if (!referencedInDrafts && !isPreserved) {
      failureReason = `Boundary condition '${atom.content}' is omitted from section drafts and not preserved in section text`;
    }

    if (!isPreserved) {
      missingConditions.push({
        atomId: atom.id,
        slide: atom.slide,
        sectionLetter: targetSectionLetter,
        content: atom.content,
        reason: failureReason,
      });

      defects.push(
        createDefect({
          id: `defect-condition-${atom.id}`,
          sectionLetter: targetSectionLetter,
          targetId: atom.id,
          defectType: "MISSING_CONDITION",
          reason: failureReason,
          slide: atom.slide,
        }),
      );
    }
  }

  return {
    passed: missingConditions.length === 0 && defects.length === 0,
    totalConditions: conditionAtoms.length,
    missingConditions,
    defects,
  };
}

// ---------------------------------------------------------------------------
// 5. Symbol First-Use Hygiene Verifier
// ---------------------------------------------------------------------------

export function verifySymbolFirstUseHygiene(
  input: SymbolHygieneInput,
): SymbolHygieneResult {
  const duplicateDefinitions: SymbolHygieneDuplicate[] = [];
  const misplacedDefinitions: SymbolHygieneMisplaced[] = [];
  const defects: NoteDefect[] = [];

  const acceptedMap = new Map<string, AcceptedFormula>(
    input.acceptedFormulas.map((f) => [f.id, f]),
  );

  interface FormulaReadingEntry {
    index: number;
    sectionLetter: string;
    scopeId: string;
    formula: NoteFormula;
  }

  const readingOrder: FormulaReadingEntry[] = [];
  let orderIndex = 0;

  for (const sec of input.sections) {
    const scopeId =
      input.blueprint?.sections.find((s) => s.letter === sec.letter)
        ?.symbolScopeId ?? "global";

    for (const f of sec.formulas || []) {
      readingOrder.push({
        index: orderIndex++,
        sectionLetter: sec.letter,
        scopeId,
        formula: f,
      });
    }

    for (const sub of sec.subSections || []) {
      for (const f of sub.formulas || []) {
        readingOrder.push({
          index: orderIndex++,
          sectionLetter: sec.letter,
          scopeId,
          formula: f,
        });
      }
    }
  }

  // 1. Check for Duplicate Definitions within scope
  const globalDefinedSymbols = new Set<string>();
  const scopeDefinedSymbols = new Map<string, Set<string>>();

  for (const entry of readingOrder) {
    const { sectionLetter, scopeId, formula } = entry;
    const scopeSet = scopeDefinedSymbols.get(scopeId) ?? new Set<string>();

    for (const v of formula.variables || []) {
      const sym = v.symbol.replace(/^\$+|\$+$/g, "").trim();
      if (!sym) continue;

      const isDuplicate =
        scopeId === "global"
          ? globalDefinedSymbols.has(sym)
          : scopeSet.has(sym) || globalDefinedSymbols.has(sym);

      if (isDuplicate) {
        duplicateDefinitions.push({
          symbol: sym,
          sectionLetter,
          formulaLatex: formula.latex,
        });
        defects.push(
          createDefect({
            id: `defect-sym-dup-${sectionLetter}-${sym}-${duplicateDefinitions.length}`,
            sectionLetter,
            targetId: formula.name || formula.latex,
            defectType: "SYMBOL_DEFINITION_MISPLACED",
            reason: `Duplicate definition of symbol '${sym}' in section '${sectionLetter}' (scope: '${scopeId}')`,
            slide: formula.slide,
          }),
        );
      } else {
        if (scopeId === "global") {
          globalDefinedSymbols.add(sym);
        } else {
          scopeSet.add(sym);
          scopeDefinedSymbols.set(scopeId, scopeSet);
        }
      }
    }
  }

  // 2. Check for Misplaced / Omitted First-Use Definitions
  for (const binding of input.symbolBindings) {
    if (!binding.meaning || !binding.meaning.trim()) continue;
    const symGlyph = binding.symbolLatex.replace(/^\$+|\$+$/g, "").trim();
    if (!symGlyph) continue;

    // Find all formulas in reading order referencing this binding
    const referencingEntries = readingOrder.filter((entry) => {
      const scopeMatches =
        !binding.scopeId ||
        binding.scopeId === "global" ||
        entry.scopeId === "global" ||
        entry.scopeId === binding.scopeId;
      if (!scopeMatches) return false;

      // Accepted formula binding match
      const accepted =
        entry.formula.formulaRefs && entry.formula.formulaRefs.length > 0
          ? acceptedMap.get(entry.formula.formulaRefs[0])
          : input.acceptedFormulas.find(
              (f) =>
                normalizeInventoryFormulaKey(f.displayLatex) ===
                normalizeInventoryFormulaKey(entry.formula.latex),
            );

      if (accepted && (accepted.symbolBindingIds || []).includes(binding.id)) {
        return true;
      }

      // Glyph in formula latex
      return latexContainsSymbolGlyph(entry.formula.latex, symGlyph);
    });

    if (referencingEntries.length === 0) {
      continue;
    }

    const firstUse = referencingEntries[0];
    const isDefinedInFirst = (firstUse.formula.variables || []).some(
      (v) => v.symbol.replace(/^\$+|\$+$/g, "").trim() === symGlyph,
    );

    if (!isDefinedInFirst) {
      // Find if any later formula in the note defined it
      const laterEntry = readingOrder
        .slice(firstUse.index + 1)
        .find((entry) =>
          (entry.formula.variables || []).some(
            (v) => v.symbol.replace(/^\$+|\$+$/g, "").trim() === symGlyph,
          ),
        );

      if (laterEntry) {
        misplacedDefinitions.push({
          symbol: symGlyph,
          expectedSectionLetter: firstUse.sectionLetter,
          actualSectionLetter: laterEntry.sectionLetter,
          reason: `Symbol '${symGlyph}' is first used in section '${firstUse.sectionLetter}' but defined later in section '${laterEntry.sectionLetter}'`,
        });
        defects.push(
          createDefect({
            id: `defect-sym-late-${binding.id}`,
            sectionLetter: firstUse.sectionLetter,
            targetId: firstUse.formula.name || firstUse.formula.latex,
            defectType: "SYMBOL_DEFINITION_MISPLACED",
            reason: `Symbol '${symGlyph}' is first referenced in section '${firstUse.sectionLetter}' but its definition is delayed until section '${laterEntry.sectionLetter}'`,
            slide: firstUse.formula.slide ?? binding.slide,
          }),
        );
      } else {
        misplacedDefinitions.push({
          symbol: symGlyph,
          expectedSectionLetter: firstUse.sectionLetter,
          reason: `Symbol '${symGlyph}' has a defined meaning but is omitted from variables on first use in section '${firstUse.sectionLetter}'`,
        });
        defects.push(
          createDefect({
            id: `defect-sym-omitted-${binding.id}`,
            sectionLetter: firstUse.sectionLetter,
            targetId: firstUse.formula.name || firstUse.formula.latex,
            defectType: "SYMBOL_DEFINITION_MISPLACED",
            reason: `Symbol '${symGlyph}' with known meaning ('${binding.meaning}') is referenced in formula '${firstUse.formula.latex}' in section '${firstUse.sectionLetter}' but is omitted from formula variables`,
            slide: firstUse.formula.slide ?? binding.slide,
          }),
        );
      }
    }
  }

  return {
    passed:
      duplicateDefinitions.length === 0 &&
      misplacedDefinitions.length === 0 &&
      defects.length === 0,
    duplicateDefinitions,
    misplacedDefinitions,
    defects,
  };
}

// ---------------------------------------------------------------------------
// 6. Comprehensive Compiler Quality Rubric Evaluation
// ---------------------------------------------------------------------------

export function evaluateCompilerQualityRubric(
  input: QualityRubricInput,
): CompilerQualityRubricReport {
  // 1. Pillar Checks
  const referenceIntegrity = verifyReferenceIntegrity({
    sectionDrafts: input.sectionDrafts,
    sections: input.sections,
    acceptedFormulas: input.acceptedFormulas,
    atoms: input.atoms,
    symbolBindings: input.symbolBindings,
  });

  const manifestCoverage = verifyManifestCoverage({
    blueprint: input.blueprint,
    sectionDrafts: input.sectionDrafts,
    sections: input.sections,
    acceptedFormulas: input.acceptedFormulas,
    atoms: input.atoms,
  });

  const katexCompile = verifyStrictKatexCompile({
    sections: input.sections,
  });

  const conditionPreservation = verifyConditionPreservation({
    sections: input.sections,
    sectionDrafts: input.sectionDrafts,
    atoms: input.atoms,
    acceptedFormulas: input.acceptedFormulas,
    blueprint: input.blueprint,
  });

  const symbolHygiene = verifySymbolFirstUseHygiene({
    sections: input.sections,
    acceptedFormulas: input.acceptedFormulas,
    symbolBindings: input.symbolBindings,
    blueprint: input.blueprint,
  });

  // 2. Section Overfull Check
  const overfullDefects: NoteDefect[] = [];
  if (input.sectionDrafts && input.blueprint) {
    for (const draft of input.sectionDrafts) {
      const plan = input.blueprint.sections.find(
        (s) => s.letter === draft.letter || s.id === draft.id,
      );
      if (plan && draft.blocks.length > plan.targetBlockBudget) {
        overfullDefects.push(
          createDefect({
            id: `defect-overfull-${draft.letter}`,
            sectionLetter: draft.letter,
            targetId: draft.id,
            defectType: "SECTION_OVERFULL",
            reason: `Section '${draft.letter}' has ${draft.blocks.length} blocks, exceeding targetBlockBudget of ${plan.targetBlockBudget}`,
          }),
        );
      }
    }
  }

  // 3. Aggregate defects
  const allDefectsMap = new Map<string, NoteDefect>();
  for (const d of [
    ...referenceIntegrity.defects,
    ...manifestCoverage.defects,
    ...katexCompile.defects,
    ...conditionPreservation.defects,
    ...symbolHygiene.defects,
    ...overfullDefects,
  ]) {
    allDefectsMap.set(d.id, d);
  }
  const allDefects = Array.from(allDefectsMap.values());

  // 4. Status determination
  let status: "READY" | "NEEDS_SOURCE_REVIEW" | "LAYOUT_OVERFLOW" | "FAILED";

  if (
    manifestCoverage.missingFormulaIds.length > 0 ||
    katexCompile.failures.length > 0
  ) {
    status = "FAILED";
  } else if (overfullDefects.length > 0) {
    status = "LAYOUT_OVERFLOW";
  } else if (allDefects.length > 0) {
    status = "NEEDS_SOURCE_REVIEW";
  } else {
    status = "READY";
  }

  // 5. Construct validated QAReport
  const qaReport: QAReport = qaReportSchema.parse({
    status,
    missingRequiredFormulaIds: manifestCoverage.missingFormulaIds,
    acceptedFormulaCount: input.acceptedFormulas.length,
    excludedCandidateCount: input.excludedCandidates?.length ?? 0,
    defects: allDefects,
    appliedPatches: 0,
    verificationRecord: {
      status:
        status === "READY"
          ? "passed"
          : status === "FAILED"
            ? "failed"
            : "marked",
      repairAttempted: false,
      coverageRatio:
        manifestCoverage.requiredFormulaIds.length > 0
          ? manifestCoverage.renderedFormulaIds.length /
            manifestCoverage.requiredFormulaIds.length
          : 1,
      totalLedgerFormulas: manifestCoverage.requiredFormulaIds.length,
      placedFormulaIds: manifestCoverage.renderedFormulaIds,
      uncapturedFormulaIds: manifestCoverage.missingFormulaIds,
      unsupportedClaimsRemoved: 0,
      needsReviewCount: allDefects.length,
      contradictedFormulaCount: 0,
      evidenceMatchRatio: 1,
      numberGroundingPassed: true,
      ungroundedNumbers: [],
      symbolGroundingPassed: symbolHygiene.passed,
      ungroundedSymbols: [],
      claimVerdicts: [],
      formulaResults: [],
      divergenceNotices: [],
      warnings: [],
    },
  });

  return {
    passed: qaReport.status === "READY",
    qaReport,
    referenceIntegrity,
    manifestCoverage,
    katexCompile,
    conditionPreservation,
    symbolHygiene,
    defects: allDefects,
  };
}
