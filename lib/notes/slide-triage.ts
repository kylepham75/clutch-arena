import type { SourceBlock } from "../schemas/ingestion";
import {
  type TriagedSlide,
  type SourceAtom,
  type SlideRegionTag,
  type SlideDisposition,
  triagedSlideSchema,
  sourceAtomSchema,
} from "../schemas/notes";
import { normalizePdfMathSymbols } from "./pdf-symbol-normalizer";

/**
 * Result structure returned by detectVisionAdjudicationNeed.
 */
export interface VisionAdjudicationResult {
  needed: boolean;
  reasons: string[];
}

/**
 * Result structure returned by triageSlideDeck.
 */
export interface TriageSlideDeckResult {
  slides: TriagedSlide[];
  includedSlides: TriagedSlide[];
  planningSignalSlides: TriagedSlide[];
  excludedSlideNumbers: number[];
  visionAdjudicationSlides: number[];
  extractedAtoms: SourceAtom[];
}

/**
 * Regex matching unmapped Private Use Area (PUA) glyphs, replacement glyphs,
 * or garbled ASCII control characters.
 */
const PUA_OR_GARBLED_REGEX = /[\uE000-\uF8FF\uFFFD\u25A1\u25AF\x00-\x08\x0E-\x1F]/;

/**
 * Regex matching keywords that indicate an embedded equation, formula, or diagram.
 */
const SPARSE_MATH_OR_DIAGRAM_REGEX =
  /\b(?:Formula|Equation|Model|Figure|Diagram|Exhibit)\b|Công\s*thức|Phương\s*trình|Sơ\s*đồ/i;

/**
 * Inspects raw slide text BEFORE normalization to detect indicators that text extraction
 * is incomplete or mathematically corrupted (EXTRACTION_UNCERTAIN).
 */
export function detectVisionAdjudicationNeed(rawText: string): VisionAdjudicationResult {
  if (!rawText || typeof rawText !== "string") {
    return { needed: false, reasons: [] };
  }

  const reasons: string[] = [];

  // 1. Private Use Area (PUA) glyphs, replacement characters, or garbled control characters
  if (PUA_OR_GARBLED_REGEX.test(rawText)) {
    reasons.push("Private Use Area (PUA) glyphs, replacement characters, or control characters detected");
  }

  // 2. Dangling mathematical operators at line ends or standalone '=' / '==' lines
  const lines = rawText.split(/\r?\n/);
  let hasDanglingOperator = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Standalone '=' or '==' line
    if (/^={1,2}$/.test(trimmed)) {
      hasDanglingOperator = true;
      break;
    }

    // Line starting with '=' followed immediately by a number/decimal without LHS variable
    if (/^={1,2}\s*[\d.,]+$/.test(trimmed)) {
      hasDanglingOperator = true;
      break;
    }

    // Line ending with dangling '=' or '==' (e.g. "T =", "S ==", "(Average Risk) =")
    if (/(?:[A-Za-z0-9_)]|\))\s*={1,2}$/.test(trimmed)) {
      hasDanglingOperator = true;
      break;
    }

    // Line ending with dangling arithmetic operator (+, -, −, ×, ÷, *, /)
    if (/(?:[A-Za-z0-9_)]|\))\s*[\+\-−×÷\*\/]$/.test(trimmed)) {
      hasDanglingOperator = true;
      break;
    }
  }

  if (hasDanglingOperator) {
    reasons.push("Dangling mathematical operators or incomplete equation fragments detected");
  }

  // 3. Very sparse text (< 35 non-whitespace chars) on a slide that mentions formula/equation/diagram
  const nonWhitespaceCount = rawText.replace(/\s+/g, "").length;
  if (nonWhitespaceCount < 35 && SPARSE_MATH_OR_DIAGRAM_REGEX.test(rawText)) {
    reasons.push("Sparse text with formula/diagram indicator suggesting image-embedded math");
  }

  return {
    needed: reasons.length > 0,
    reasons,
  };
}

/**
 * Checks whether a single line is an administrative boilerplate footer or prompt.
 */
function isAdministrativeBoilerplate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Copyright notices
  if (/^(?:©|Copyright|\(c\))\s+/i.test(trimmed)) return true;
  if (/\b(?:All rights reserved|Pearson Education|McGraw-Hill|John Wiley|Cengage|Published by)\b/i.test(trimmed)) {
    return true;
  }

  // Attendance check-in / QR prompts
  if (/\b(?:Scan QR|Attendance QR|Điểm danh|Quét mã QR|Check-in QR)\b/i.test(trimmed)) {
    return true;
  }

  // Standalone slide numbering footers: e.g. "Slide 5", "Page 10 of 45", "12 / 50"
  if (/^(?:Slide|Page|Trang)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(trimmed)) {
    return true;
  }
  if (/^\d+\s*\/\s*\d+$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Checks whether a single line represents a pure numeric arithmetic substitution.
 */
function isPureNumericSubstitution(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Must contain an '=' or '≈' to be an arithmetic calculation/result
  if (!trimmed.includes("=") && !trimmed.includes("≈")) {
    return false;
  }

  // Boundary conditions with inequalities (e.g. "R > g", "g < R") must NOT be stripped
  if (/[><≤≥≠]/.test(trimmed) && !trimmed.includes("=")) {
    return false;
  }
  if (/\b(?:if|when|requires?|where|assuming|condition|boundary|lưu ý|chú ý|note)\b/i.test(trimmed)) {
    return false;
  }

  // If the line contains substantive English/Vietnamese conceptual words (> 2 chars), keep it
  const words = trimmed.match(/[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]{3,}/g) || [];
  const substantiveWords = words.filter(
    (w) => !/^(?:ans|sum|max|min|avg|exp|log|sin|cos|tan)$/i.test(w)
  );
  if (substantiveWords.length > 0) {
    return false;
  }

  // Must contain at least two digits to be a numeric plug-in
  const digitCount = (trimmed.match(/\d/g) || []).length;
  if (digitCount < 2) {
    return false;
  }

  // Non-math / non-digit characters in the line
  const nonMathChars = trimmed.replace(/[\d\s\$€£%+\-−×÷\*\/\^()[\].,=≈_]/g, "");

  // Case 1: 100% digits, operators, and math symbols (zero letters!)
  // e.g. "0.26 = 0.04 + 1.1 × (0.24 - 0.04)" or "= (0.21 - 0.05 + 0.14) / 3 = 0.10"
  if (nonMathChars.length === 0) {
    return true;
  }

  // Case 2: A single variable at the LHS followed by '=' and purely numeric arithmetic on the RHS
  // e.g. "P = 2.50 / (0.10 - 0.05) = 50" or "P_0 = 2.50 / 0.05 = 50"
  if (/^[A-Za-z]$/.test(nonMathChars)) {
    const parts = trimmed.split(/=|≈/);
    if (parts.length >= 2) {
      const rhs = parts.slice(1).join("=");
      const rhsNonMath = rhs.replace(/[\d\s\$€£%+\-−×÷\*\/\^()[\].,=≈_]/g, "");
      if (rhsNonMath.length === 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Strips pure numeric substitution lines and administrative boilerplate lines
 * while keeping conceptual statements, symbolic formulas, boundary conditions,
 * and variable definitions intact.
 */
export function stripWorkedArithmeticNoise(slideText: string): string {
  if (!slideText || typeof slideText !== "string") {
    return "";
  }

  const lines = slideText.split(/\r?\n/);
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (isAdministrativeBoilerplate(trimmed)) {
      continue;
    }

    if (isPureNumericSubstitution(trimmed)) {
      continue;
    }

    keptLines.push(line);
  }

  return keptLines.join("\n").trim();
}

/**
 * Cleans an individual recipe step by stripping company names, currency amounts,
 * and trailing numeric arithmetic results while keeping symbolic variables intact.
 */
function cleanRecipeStep(step: string): string {
  let cleaned = step.trim();

  // Strip company names (e.g. "Company ABC", "Công ty XYZ")
  cleaned = cleaned.replace(/\b(?:Company|Công ty|Corp|Corporation|Inc)\s+[A-Za-z0-9&]+/gi, "the firm");

  // Strip trailing numeric calculation chains: e.g. "= 2.50 / (0.10 - 0.05) = 50" or "= $50"
  cleaned = cleaned.replace(/\s*=\s*[\$€£]?\s*[\d.,]+(?:\s*[\+\-−×÷\*\/\^]\s*[\$€£]?\s*[\d.,]+)*\s*=\s*[\$€£]?\s*[\d.,]+%?/g, "");
  cleaned = cleaned.replace(/\s*=\s*[\$€£]?\s*[\d.,]+%?$/g, "");

  // Strip standalone specific dollar amounts (e.g. "$4.50", "$100") not part of variables
  cleaned = cleaned.replace(/[\$€£]\s*\d+(?:\.\d+)?/g, "");

  // Collapse consecutive whitespace
  cleaned = cleaned.replace(/[^\S\n]{2,}/g, " ").trim();

  // Strip trailing punctuation artifacts
  cleaned = cleaned.replace(/[,;:]\s*$/, "").trim();

  return cleaned;
}

/**
 * Extracts generalizable calculation steps or analytical workflow rules
 * from a worked example / exercise slide BEFORE raw arithmetic substitutions are stripped.
 */
export function extractGeneralizableRecipeFromExample(slideText: string): string[] {
  if (!slideText || typeof slideText !== "string") {
    return [];
  }

  const cleanInput = slideText.replace(/\r\n/g, "\n");
  const rawLines = cleanInput.split("\n").map((l) => l.trim()).filter(Boolean);
  const steps: string[] = [];

  // Patterns for explicit step lines
  const explicitStepRegex = /^(?:Step|Bước|Giai đoạn|Phase|Stage)\s*(\d+)[\s:.-]+(.*)$/i;
  const numberedActionRegex =
    /^(\d+)[\.\)\-:]\s+(?:Calculate|Compute|Find|Discount|Estimate|Determine|Sum|Add|Multiply|Divide|Project|Forecast|Solve|Identify|Apply|Tính|Chiết khấu|Xác định|Tìm|Dự phóng|Cộng|Ước tính|Áp dụng)\b(.*)$/i;
  const sequenceWordRegex =
    /^(?:First|Second|Third|Fourth|Fifth|Then|Next|Finally|Trước hết|Sau đó|Tiếp theo|Cuối cùng)[\s,:-]+(.*)$/i;
  const procedureSentenceRegex =
    /^(?:Calculate|Compute|Find|Discount|Determine|Estimate|Tính|Chiết khấu|Xác định)\b.*(?:P_|D_|terminal|Year 0|hiện tại|discount back|PV|FV)/i;

  for (const line of rawLines) {
    let matchedContent: string | null = null;
    let prefix = "";

    const stepMatch = line.match(explicitStepRegex);
    if (stepMatch) {
      prefix = `Step ${stepMatch[1]}: `;
      matchedContent = stepMatch[2].trim();
    } else {
      const numMatch = line.match(numberedActionRegex);
      if (numMatch) {
        prefix = `Step ${numMatch[1]}: `;
        const actionRest = line.replace(/^\d+[\.\)\-:]\s*/, "").trim();
        matchedContent = actionRest;
      } else {
        const seqMatch = line.match(sequenceWordRegex);
        if (seqMatch) {
          matchedContent = line.trim();
        } else if (procedureSentenceRegex.test(line)) {
          matchedContent = line.trim();
        }
      }
    }

    if (matchedContent) {
      const cleaned = cleanRecipeStep(prefix ? `${prefix}${matchedContent}` : matchedContent);
      if (cleaned && cleaned.length >= 8 && !isPureNumericSubstitution(cleaned)) {
        steps.push(cleaned);
      }
    }
  }

  // Fallback 1: inline sequence sentences like "First, find... Then, discount... Finally, sum..."
  if (steps.length === 0) {
    const sentenceMatches = cleanInput.match(
      /(?:First|Then|Next|Finally|Trước hết|Sau đó|Tiếp theo|Cuối cùng)[^.!?\n]+(?:[.!?\n]|$)/gi
    );
    if (sentenceMatches && sentenceMatches.length > 1) {
      for (const sent of sentenceMatches) {
        const cleaned = cleanRecipeStep(sent.trim());
        if (cleaned && cleaned.length >= 8 && !isPureNumericSubstitution(cleaned)) {
          steps.push(cleaned);
        }
      }
    }
  }

  // Fallback 2: single-line multi-stage procedure statement
  if (steps.length === 0) {
    for (const line of rawLines) {
      if (/(?:calculate|compute|find|tính)\s+terminal\s+value.*then\s+discount/i.test(line)) {
        const cleaned = cleanRecipeStep(line);
        if (cleaned) {
          steps.push(cleaned);
        }
      }
    }
  }

  return steps;
}

/**
 * Checks whether earlierText is a strict prefix or subset of laterText
 * indicating an incremental animation build sequence.
 */
function isIncrementalBuildSubset(earlierText: string, laterText: string): boolean {
  const normEarlier = earlierText.trim().replace(/\s+/g, " ");
  const normLater = laterText.trim().replace(/\s+/g, " ");

  if (!normEarlier || !normLater) return false;
  if (normEarlier === normLater) return true;

  // Strict prefix / substring check
  if (normLater.length > normEarlier.length && normLater.includes(normEarlier)) {
    return true;
  }

  // Line-by-line bullet subset check
  const earlierLines = earlierText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5);
  const laterLines = laterText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5);

  if (earlierLines.length > 0 && laterLines.length > earlierLines.length) {
    const allEarlierInLater = earlierLines.every((eLine) =>
      laterLines.some((lLine) => lLine.includes(eLine) || eLine.includes(lLine))
    );
    if (allEarlierInLater) {
      return true;
    }
  }

  return false;
}

/**
 * Triages a single slide into region tags and disposition.
 */
export function triageSlide(
  source: SourceBlock,
  index: number,
  prevTriaged?: TriagedSlide
): TriagedSlide {
  // 1. Resolve 1-based slide number
  let slide = index + 1;
  const labelMatch =
    source.label.match(/(?:slide|page|trang)\s*(\d+)/i) || source.label.match(/^(\d+)$/);
  if (labelMatch) {
    const parsed = parseInt(labelMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) {
      slide = parsed;
    }
  }
  const label = source.label || `Slide ${slide}`;

  // 2. Vision adjudication inspection on RAW text
  const visionResult = detectVisionAdjudicationNeed(source.text);
  const requiresVisionAdjudication = visionResult.needed;

  // 3. Normalization and noise stripping
  const normalized = normalizePdfMathSymbols(source.text);
  const cleanedText = stripWorkedArithmeticNoise(normalized);

  // 4. Multi-label region tagging
  const tags: SlideRegionTag[] = [];

  if (requiresVisionAdjudication) {
    tags.push("EXTRACTION_UNCERTAIN");
  }

  // Check ADMIN
  const isAdminSlide =
    /\b(?:Chapter|Chương|Course|Overview|Syllabus|Lecturer|Instructor|Giảng viên|Office Hours|Email)\b/i.test(
      source.text
    ) ||
    /\b(?:Agenda|Table of Contents|Mục lục|Learning Objectives|Mục tiêu bài học|Course Outline|Outline)\b/i.test(
      source.text
    ) ||
    /\b(?:Attendance|Check-in|QR Code|Điểm danh|Quét mã QR)\b/i.test(source.text) ||
    /\b(?:Thank you|Cảm ơn|Q&A|Questions\?|Any questions|End of Chapter|Hết chương|The End)\b/i.test(
      source.text
    );

  if (isAdminSlide) {
    tags.push("ADMIN");
  }

  // Check EXAM_HINT
  const isExamHint =
    /\b(?:Note|Lưu ý|Caution|Important|Quan trọng|Chú ý|Warning|Cảnh báo|Exam trap|Exam tip|Trap|Pitfall|Common pitfall|Bẫy thi)\b/i.test(
      source.text
    ) ||
    /\b(?:Requires|Bắt buộc|Điều kiện|Assumes that|Giả định rằng|Only if|Chỉ khi)\s+.*[><≤≥≠]/i.test(
      source.text
    ) ||
    /\b(?:[Rr]|k_?[ed]?|IRR|WACC|NPV|g|rho|β|σ)\b\s*[><≤≥]\s*(?:0|1|\b(?:[Rr]|k_?[ed]?|WACC|g)\b)/.test(
      source.text
    ) ||
    /\botherwise the model breaks down\b/i.test(source.text);

  if (isExamHint) {
    tags.push("EXAM_HINT");
  }

  // Check FORMULA (symbolic equations, operators, or accounting identities)
  const isFormula =
    /\\(?:frac|sum|sqrt|prod|int)/.test(source.text) ||
    /\b(?:beta|sigma|alpha|theta|delta|mu|lambda|rho)\b|[βσαθδμλρΣΔΩ]/.test(source.text) ||
    /[A-Za-z]{1,4}(?:_[A-Za-z0-9]+)?\s*=\s*[A-Za-z0-9_\(\)\s\+\-−×÷\*\/\^]+/.test(source.text) ||
    /\b(?:Net Working Capital|Operating Cycle|Cash Cycle|DuPont|Gordon Growth|DDM|CAPM|WACC|NPV|IRR|EBIT|EBITDA)\s*=/i.test(
      source.text
    );

  if (isFormula) {
    tags.push("FORMULA");
  }

  // Check WORKED_EXAMPLE
  const isWorkedExample =
    /\b(?:Example|Ví dụ|Exercise|Bài tập|Problem|Practice|Luyện tập|Solution|Lời giải|Suppose Company|Giả sử công ty|Case study)\b/i.test(
      source.text
    );

  if (isWorkedExample) {
    tags.push("WORKED_EXAMPLE");
  }

  // Check DIAGRAM_TABLE
  const isDiagramOrTable =
    /\b(?:Timeline|Table|Bảng|Sơ đồ|Diagram|Chart|Đồ thị|Flowchart)\b/i.test(source.text) ||
    /\bt\s*=\s*0\b/i.test(source.text) ||
    /(?:\|[^\n]+\|[\r\n]+){2,}/.test(source.text);

  if (isDiagramOrTable) {
    tags.push("DIAGRAM_TABLE");
  }

  // Check CONCEPT
  // Strip pure admin metadata lines so substantive slides titled "Chapter X Overview" aren't dropped
  const substantiveNonAdminText = cleanedText
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^(?:Chapter|Chương)\s+\d*\b.*$/i.test(t) && t.length < 80) return false;
      if (/^(?:Overview|Agenda|Table of Contents|Mục lục|Syllabus|Course Outline|Outline|Learning Objectives|Mục tiêu bài học)\b/i.test(t) && t.length < 80) {
        return false;
      }
      if (/\b(?:Instructor|Lecturer|Giảng viên|Office Hours|Email|Attendance|QR Code|Điểm danh|Quét mã QR|Thank you|Cảm ơn|Q&A|Any questions|End of Chapter|Hết chương|The End)\b/i.test(t)) {
        return false;
      }
      return true;
    })
    .join(" ")
    .trim();

  const isPlanningHeaderOnly =
    /\b(?:Agenda|Table of Contents|Mục lục|Learning Objectives|Mục tiêu bài học|Course Outline|Outline|Syllabus)\b/i.test(
      source.text
    );

  const isConcept =
    /\b(?:is defined as|refers to|means that|defined as|principle|intuition|mechanism|assumption|được định nghĩa là|nghĩa là|nguyên lý|bản chất|ý nghĩa|giả định)\b/i.test(
      source.text
    ) ||
    (cleanedText.length > 40 && !isAdminSlide && !isWorkedExample) ||
    (substantiveNonAdminText.length > 80 && !isPlanningHeaderOnly && !isWorkedExample);

  if (isConcept) {
    tags.push("CONCEPT");
  }

  // Ensure at least one tag is present
  if (tags.length === 0) {
    tags.push(cleanedText.length > 30 ? "CONCEPT" : "ADMIN");
  }

  // 5. Extract generalizable recipe steps from worked examples
  const extractedRecipeSteps = tags.includes("WORKED_EXAMPLE")
    ? extractGeneralizableRecipeFromExample(normalized)
    : [];

  // 6. Disposition determination
  let disposition: SlideDisposition = "INCLUDE";
  let reason = "Core conceptual or mathematical slide included for synthesis";

  // Check 1: Animation build duplicate check against prevTriaged
  if (prevTriaged) {
    const prevClean = prevTriaged.cleanedText.trim();
    const currClean = cleanedText.trim();
    if (prevClean && currClean) {
      if (prevClean === currClean) {
        disposition = "CONSOLIDATE_BUILD";
        reason = `Identical build duplicate of slide ${prevTriaged.slide}`;
      } else if (isIncrementalBuildSubset(currClean, prevClean)) {
        disposition = "CONSOLIDATE_BUILD";
        reason = `Partial build subset of slide ${prevTriaged.slide}`;
      }
    }
  }

  // Check 2: ADMIN disposition
  if (disposition !== "CONSOLIDATE_BUILD" && tags.includes("ADMIN")) {
    const hasSubstantiveContent =
      tags.includes("FORMULA") || tags.includes("CONCEPT") || tags.includes("EXAM_HINT");

    if (!hasSubstantiveContent) {
      const isPlanningSignal =
        /\b(?:Agenda|Table of Contents|Mục lục|Learning Objectives|Mục tiêu bài học|Course Outline|Outline)\b/i.test(
          source.text
        );
      if (isPlanningSignal) {
        disposition = "PLANNING_SIGNAL_ONLY";
        reason = "Course syllabus or learning objectives retained as planning signal";
      } else {
        disposition = "EXCLUDE_NOISE";
        reason = "Administrative metadata, cover slide, or boilerplate excluded as noise";
      }
    } else {
      disposition = "INCLUDE";
      reason = "Mixed slide containing administrative notes alongside critical concepts/formulas";
    }
  }

  // Check 3: WORKED_EXAMPLE disposition
  if (disposition === "INCLUDE" && tags.includes("WORKED_EXAMPLE")) {
    const hasStandaloneConceptOrFormula =
      (tags.includes("CONCEPT") || tags.includes("FORMULA")) &&
      !/^\s*(?:Example|Ví dụ|Exercise|Bài tập|Practice|Problem)/i.test(source.text.trim());

    if (!hasStandaloneConceptOrFormula) {
      if (extractedRecipeSteps.length > 0) {
        disposition = "EXTRACT_RECIPE_ONLY";
        reason = "Worked example with generalizable calculation steps or procedure";
      } else {
        disposition = "EXCLUDE_NOISE";
        reason = "Pure numeric arithmetic plug-in with no generalizable method excluded as noise";
      }
    }
  }

  const triaged: TriagedSlide = {
    slide,
    label,
    tags,
    disposition,
    reason,
    requiresVisionAdjudication,
    extractedRecipeSteps,
    cleanedText,
  };

  return triagedSlideSchema.parse(triaged);
}

/**
 * Extracts boundary and exam hint statements from cleaned slide text into SourceAtom records.
 */
function extractBoundaryAndHintAtoms(slide: TriagedSlide): SourceAtom[] {
  const atoms: SourceAtom[] = [];
  const lines = slide.cleanedText.split("\n").map((l) => l.trim()).filter(Boolean);

  let bIndex = 1;
  for (const line of lines) {
    const isBoundaryOrHint =
      /\b(?:Note|Lưu ý|Caution|Important|Quan trọng|Chú ý|Warning|Cảnh báo|Exam trap|Exam tip|Pitfall)\b/i.test(
        line
      ) ||
      /\b(?:Requires|Bắt buộc|Điều kiện|Assumes that|Giả định rằng|Only if|Chỉ khi)\s+.*[><≤≥≠]/i.test(
        line
      ) ||
      /[Rg]\s*[><]\s*[Rg]/.test(line) ||
      /\botherwise the model breaks down\b/i.test(line);

    if (isBoundaryOrHint) {
      const isBoundary = /Requires|boundary|break down|[><≤≥≠]/i.test(line);
      const atom: SourceAtom = {
        id: `S${slide.slide}:B${bIndex++}`,
        slide: slide.slide,
        kind: isBoundary ? "boundary_condition" : "exam_hint",
        topic: isBoundary ? `Boundary Condition (${slide.label})` : `Exam Warning (${slide.label})`,
        content: line,
        evidence: line,
        isWorkedExampleDerived: false,
      };
      atoms.push(sourceAtomSchema.parse(atom));
    }
  }

  // If slide was tagged EXAM_HINT but no individual line matched, extract entire slide text as atom
  if (atoms.length === 0 && slide.tags.includes("EXAM_HINT") && slide.cleanedText) {
    const atom: SourceAtom = {
      id: `S${slide.slide}:B1`,
      slide: slide.slide,
      kind: "exam_hint",
      topic: `Exam Guidance (${slide.label})`,
      content: slide.cleanedText,
      evidence: slide.cleanedText,
      isWorkedExampleDerived: false,
    };
    atoms.push(sourceAtomSchema.parse(atom));
  }

  return atoms;
}

/**
 * Triages an entire slide deck, consolidating incremental animation builds
 * and generating initial deterministic SourceAtom records.
 */
export function triageSlideDeck(sources: SourceBlock[]): TriageSlideDeckResult {
  if (!sources || sources.length === 0) {
    return {
      slides: [],
      includedSlides: [],
      planningSignalSlides: [],
      excludedSlideNumbers: [],
      visionAdjudicationSlides: [],
      extractedAtoms: [],
    };
  }

  // 1. Initial pass: triage each slide individually
  const slides: TriagedSlide[] = [];
  for (let i = 0; i < sources.length; i++) {
    const prev = i > 0 ? slides[i - 1] : undefined;
    slides.push(triageSlide(sources[i], i, prev));
  }

  // 2. Incremental animation build consolidation pass
  // If slide i is a strict subset or prefix of slide i+1, mark slide i as CONSOLIDATE_BUILD
  for (let i = 0; i < slides.length - 1; i++) {
    const current = slides[i];
    const next = slides[i + 1];

    if (current.disposition === "EXCLUDE_NOISE" || current.disposition === "PLANNING_SIGNAL_ONLY") {
      continue;
    }
    if (current.disposition === "EXTRACT_RECIPE_ONLY" && next.disposition !== "EXTRACT_RECIPE_ONLY") {
      continue;
    }

    if (isIncrementalBuildSubset(current.cleanedText, next.cleanedText)) {
      current.disposition = "CONSOLIDATE_BUILD";
      current.reason = `Partial animation build consolidated into slide ${next.slide}`;
    }
  }

  // 3. Partition slides by disposition
  const includedSlides = slides.filter((s) => s.disposition === "INCLUDE");
  const planningSignalSlides = slides.filter((s) => s.disposition === "PLANNING_SIGNAL_ONLY");
  const excludedSlideNumbers = slides
    .filter((s) => s.disposition === "EXCLUDE_NOISE" || s.disposition === "CONSOLIDATE_BUILD")
    .map((s) => s.slide);
  const visionAdjudicationSlides = slides
    .filter((s) => s.requiresVisionAdjudication)
    .map((s) => s.slide);

  // 4. Generate deterministic SourceAtom records
  const extractedAtoms: SourceAtom[] = [];

  for (const slide of slides) {
    // A. Recipe atoms from worked examples (id format: S<slide>:R<n>)
    if (slide.extractedRecipeSteps.length > 0) {
      slide.extractedRecipeSteps.forEach((step, idx) => {
        const recipeAtom: SourceAtom = {
          id: `S${slide.slide}:R${idx + 1}`,
          slide: slide.slide,
          kind: "procedure",
          topic: `Worked Example Procedure (${slide.label})`,
          content: step,
          evidence: step,
          isWorkedExampleDerived: true,
        };
        extractedAtoms.push(sourceAtomSchema.parse(recipeAtom));
      });
    }

    // B. Boundary conditions and exam hints (id format: S<slide>:B<n>)
    if (slide.tags.includes("EXAM_HINT")) {
      const hintAtoms = extractBoundaryAndHintAtoms(slide);
      extractedAtoms.push(...hintAtoms);
    }
  }

  return {
    slides,
    includedSlides,
    planningSignalSlides,
    excludedSlideNumbers,
    visionAdjudicationSlides,
    extractedAtoms,
  };
}
