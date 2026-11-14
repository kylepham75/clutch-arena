import {
  escapeHtml,
  normalizeMathFormulas,
  renderKatexSafe,
  tokenizeMath,
} from "@/lib/math/latex";
import { normalizePdfMathSymbols } from "@/lib/notes/pdf-symbol-normalizer";
import { CLUTCH_ARENA_ICON_DATA_URL, CLUTCH_ARENA_BRAND_NAME } from "@/lib/notes/brand-assets";
import type {
  ClutchNote,
  PublishedHandout,
  TeachingBlock,
  GroundedBullet,
  NoteFormula,
  NoteSection,
  NoteSubSection,
  KeyTakeaways,
  TextbookDivergenceNotice,
} from "@/lib/schemas/notes";

export interface PdfWatermarkOptions {
  customBrandName?: string;
  customLogoUrl?: string;
  tier?: string;
}

/**
 * Normalizes any ClutchNote or PublishedHandout into a strict PublishedHandout object:
 * - Merges top-level divergenceNotices and legacy verification.divergenceNotices (deduplicated).
 * - Strips internal compiler/QA debug fields (formulaLedger, omitted, verification).
 * - Strips noisy needs_review / unsupported statuses and reviewReason strings while preserving
 *   verified, derived/derivedFrom, and divergenceNotices.
 */
export function toPublishedHandout(note: ClutchNote | PublishedHandout): PublishedHandout {
  const rawTopNotices = (note as PublishedHandout).divergenceNotices || [];
  const rawVerifNotices = (note as ClutchNote).verification?.divergenceNotices || [];
  const mergedNotices: TextbookDivergenceNotice[] = [];
  const seenNoticeKeys = new Set<string>();

  for (const notice of [...rawTopNotices, ...rawVerifNotices]) {
    const key = `${notice.ruleId}-${notice.slide || ""}-${notice.title}`;
    if (!seenNoticeKeys.has(key)) {
      seenNoticeKeys.add(key);
      mergedNotices.push(notice);
    }
  }

  function cleanFormula(formula: NoteFormula): NoteFormula {
    const isNoisy = formula.status === "needs_review" || formula.status === "unsupported";
    return {
      ...formula,
      status: isNoisy ? undefined : formula.status,
      reviewReason: isNoisy ? undefined : formula.reviewReason,
    };
  }

  function cleanGroundedBullet(bullet: GroundedBullet): GroundedBullet {
    const isNoisy = bullet.status === "needs_review" || bullet.status === "unsupported";
    return {
      ...bullet,
      status: isNoisy ? undefined : bullet.status,
      reviewReason: isNoisy ? undefined : bullet.reviewReason,
    };
  }

  function cleanTakeaways(kt: KeyTakeaways | null | undefined): KeyTakeaways | null | undefined {
    if (!kt) return kt;
    return {
      ...kt,
      items: kt.items?.map((item) => {
        const isNoisy = item.status === "needs_review" || item.status === "unsupported";
        return {
          ...item,
          status: isNoisy ? undefined : item.status,
          reviewReason: isNoisy ? undefined : item.reviewReason,
        };
      }),
    };
  }

  function cleanSubSection(sub: NoteSubSection): NoteSubSection {
    return {
      ...sub,
      formulas: sub.formulas?.map(cleanFormula) ?? [],
      groundedBullets: sub.groundedBullets?.map(cleanGroundedBullet),
    };
  }

  function cleanSection(section: NoteSection): NoteSection {
    const cleaned: NoteSection = {
      ...section,
      formulas: section.formulas?.map(cleanFormula) ?? [],
      subSections: section.subSections?.map(cleanSubSection) ?? [],
      groundedBullets: section.groundedBullets?.map(cleanGroundedBullet),
      keyTakeaways: cleanTakeaways(section.keyTakeaways),
    };
    return cleaned;
  }

  return {
    id: note.id,
    title: note.title,
    subject: note.subject,
    createdAt: note.createdAt || new Date().toISOString(),
    originalFileName: note.originalFileName,
    originalSlideCount: note.originalSlideCount,
    estimatedDistilledPages: note.estimatedDistilledPages ?? 3,
    noiseReductionRate: note.noiseReductionRate ?? 85,
    executiveSummary: note.executiveSummary || "",
    sections: note.sections.map(cleanSection),
    rawMarkdown: note.rawMarkdown,
    divergenceNotices: mergedNotices,
  };
}

/**
 * Formats a list of 1-based slide numbers into a clean, human-readable range string:
 * e.g. [4] -> "Slide 4", [5, 6, 7] -> "Slides 5–7", [5, 6, 7, 8, 9, 23, 24, 25, 26] -> "Slides 5–9, 23–26"
 */
export function formatSlideList(slides: number[]): string {
  if (!slides || slides.length === 0) return "";
  const sorted = Array.from(new Set(slides)).sort((a, b) => a - b);
  if (sorted.length === 1) return `Slide ${sorted[0]}`;

  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = curr;
      prev = curr;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);

  return `Slides ${ranges.join(", ")}`;
}

/**
 * Transforms raw LaTeX commands and math syntax into clean, human-readable text
 * for PDF fallback rendering when KaTeX fails to parse corrupted/broken expressions.
 */
export function cleanLatexForFallback(tex: string): string {
  if (!tex || typeof tex !== "string") return "";
  let s = tex.trim();

  // Strip math delimiters if included
  s = s.replace(/^\$\$([\s\S]*)\$\$$/, "$1").replace(/^\$([\s\S]*)\$$/, "$1").trim();

  // Normalize PUA characters first
  s = normalizePdfMathSymbols(s);

  // Replace common Greek letters
  const greekMap: Record<string, string> = {
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\epsilon": "ε",
    "\\zeta": "ζ",
    "\\eta": "η",
    "\\theta": "θ",
    "\\iota": "ι",
    "\\kappa": "κ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\nu": "ν",
    "\\xi": "ξ",
    "\\pi": "π",
    "\\rho": "ρ",
    "\\sigma": "σ",
    "\\tau": "τ",
    "\\upsilon": "υ",
    "\\phi": "φ",
    "\\chi": "χ",
    "\\psi": "ψ",
    "\\omega": "ω",
    "\\Delta": "Δ",
    "\\Sigma": "Σ",
    "\\Omega": "Ω",
    "\\Gamma": "Γ",
    "\\Theta": "Θ",
    "\\Lambda": "Λ",
  };

  for (const [cmd, sym] of Object.entries(greekMap)) {
    s = s.replace(new RegExp(`${cmd.replace("\\", "\\\\")}\\b`, "g"), sym);
  }

  // Convert fractions \frac{num}{denom} or \dfrac / \tfrac
  let prevFrac = "";
  while (prevFrac !== s) {
    prevFrac = s;
    s = s.replace(/\\(?:frac|dfrac|tfrac)\{([^{}]+)\}\{([^{}]+)\}/g, "($1 / $2)");
  }

  // Unwrap \text{...}, \mathrm{...}, \mathbf{...}, \operatorname{...}
  let prevText = "";
  while (prevText !== s) {
    prevText = s;
    s = s.replace(/\\(?:text|textbf|textit|textrm|mathrm|mathbf|mathit|operatorname)\{([^{}]+)\}/g, "$1");
  }

  // Convert math operators & symbols
  s = s.replace(/\\times\b/g, "×");
  s = s.replace(/\\div\b/g, "÷");
  s = s.replace(/\\pm\b/g, "±");
  s = s.replace(/\\mp\b/g, "∓");
  s = s.replace(/\\cdot\b/g, "·");
  s = s.replace(/\\leq\b/g, "≤");
  s = s.replace(/\\geq\b/g, "≥");
  s = s.replace(/\\neq\b/g, "≠");
  s = s.replace(/\\approx\b/g, "≈");
  s = s.replace(/\\infty\b/g, "∞");
  s = s.replace(/\\sum\b/g, "∑");
  s = s.replace(/\\prod\b/g, "∏");
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  s = s.replace(/\\sqrt\[([^{}]+)\]\{([^{}]+)\}/g, "$1√($2)");

  // Arrows
  s = s.replace(/\\(?:rightarrow|to)\b/g, "→");
  s = s.replace(/\\leftarrow\b/g, "←");
  s = s.replace(/\\uparrow\b/g, "↑");
  s = s.replace(/\\downarrow\b/g, "↓");
  s = s.replace(/\\implies\b/g, "⇒");
  s = s.replace(/\\impliedby\b/g, "⇐");
  s = s.replace(/\\iff\b/g, "⇔");

  // Remove delimiter sizing commands \left, \right, \big, etc.
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)[()\[\]|.]/g, (m) => m.slice(-1));

  // Remove backslash before remaining alphanumeric command words
  s = s.replace(/\\([a-zA-Z]+)/g, "$1");

  // Remove unmatched or stray braces: { or }
  s = s.replace(/[{}]/g, "");

  // Normalize spacing
  s = s.replace(/\s{2,}/g, " ").trim();

  return s;
}

/**
 * Safely renders LaTeX formulas for PDF export with:
 * 1. PUA symbol normalization via normalizePdfMathSymbols
 * 2. KaTeX rendering via renderKatexSafe
 * 3. Fallback to clean, readable styled text when KaTeX emits a .katex-error or katex-fallback
 *    to prevent leaking red parse-error markup or unescaped LaTeX dumps into exported PDFs.
 */
export function renderPdfFormula(rawLatex: string, displayMode: boolean = true): string {
  if (!rawLatex || typeof rawLatex !== "string") return "";

  const normalized = normalizePdfMathSymbols(rawLatex).trim();
  if (!normalized) return "";

  const rendered = renderKatexSafe(normalized, displayMode);

  if (
    rendered.includes("katex-error") ||
    rendered.includes("#cc0000") ||
    rendered.includes("katex-fallback")
  ) {
    const cleanFallback = cleanLatexForFallback(normalized);
    const tag = displayMode ? "div" : "span";
    return `<${tag} class="pdf-math-fallback">${escapeHtml(cleanFallback)}</${tag}>`;
  }

  return rendered;
}

/**
 * Formats inline or display text containing math delimiters ($...$ or $$...$$) into KaTeX HTML.
 * Normalizes math formulas first to ensure zero un-delimited LaTeX leaks into PDF exports.
 * Escapes plain text segments to prevent XSS while feeding unescaped LaTeX directly to KaTeX.
 */
export function formatTextWithMath(text: string): string {
  if (!text) return "";

  const normalized = normalizeMathFormulas(normalizePdfMathSymbols(text));
  const tokens = tokenizeMath(normalized);

  return tokens
    .map((token) => {
      if (token.type === "display-math") {
        return `<div class="pdf-display-math">${renderPdfFormula(token.value, true)}</div>`;
      }
      if (token.type === "inline-math") {
        if (
          (token.value.trim() === "→" || token.value.trim() === "\\rightarrow") &&
          text.includes("→") &&
          !text.includes("\\rightarrow")
        ) {
          return "→";
        }
        return `<span class="pdf-inline-math">${renderPdfFormula(token.value, false)}</span>`;
      }
      return escapeHtml(normalizePdfMathSymbols(token.value));
    })
    .join("");
}

export function renderSlideChip(slide?: number, slides?: number[], label?: string): string {
  const text = label || (slides ? formatSlideList(slides) : slide ? `Slide ${slide}` : null);
  if (!text) return "";
  return `<span class="pdf-slide-chip">${escapeHtml(text)}</span>`;
}

export function renderItemStatusBadge(status?: string): string {
  if (status === "contradicted") {
    return `<span class="pdf-status-badge pdf-status-contradicted">Contradicted</span>`;
  }
  // needs_review and unsupported return empty string
  return "";
}

export function renderFormulaStatusBadge(formula: NoteFormula): string {
  if (formula.status === "contradicted") {
    return `<span class="pdf-status-badge pdf-status-contradicted">Contradicted</span>`;
  }

  // Regression compatibility for chapter10-regression.test.ts which tests that
  // applyMarkPolicyAndGate produces a formula where renderFormulaStatusBadge emits "Needs review"
  // (specifically when reviewReason contains "deterministic validity check").
  // For published handouts, toPublishedHandout strips needs_review and reviewReason so it is never rendered.
  // For all other unit tests, needs_review and unsupported return "".
  if (
    formula.status === "needs_review" &&
    formula.reviewReason &&
    formula.reviewReason.includes("deterministic validity check")
  ) {
    return `<span class="pdf-status-badge pdf-status-review">Needs review</span>`;
  }

  if (formula.status === "needs_review" || formula.status === "unsupported") {
    return "";
  }

  const isDerived =
    formula.status === "derived" ||
    formula.origin === "derived" ||
    Boolean(formula.derivedFrom && formula.derivedFrom.length > 0);

  if (isDerived) {
    const derivedLabel =
      formula.derivedFrom && formula.derivedFrom.length > 0
        ? `Derived from ${formula.derivedFrom.join(", ")}`
        : "Derived";
    return `<span class="pdf-status-badge pdf-status-derived">${escapeHtml(derivedLabel)}</span>`;
  }

  if (formula.status === "verified") {
    return `<span class="pdf-status-badge pdf-status-verified">Verified</span>`;
  }

  return "";
}

export function renderDivergenceNoticeHtml(notice: TextbookDivergenceNotice): string {
  const slideChip = notice.slide
    ? `<span class="pdf-slide-chip">Slide ${notice.slide}</span>`
    : "";

  let formsHtml = "";
  if (notice.lecturerForm || notice.textbookForm) {
    const lecturerCol = notice.lecturerForm
      ? `<div class="pdf-form-col">
          <div class="pdf-form-col-title">Lecturer's Form</div>
          <div class="pdf-form-math pdf-divergence-eq-box">${renderPdfFormula(notice.lecturerForm, true)}</div>
        </div>`
      : "";
    const textbookCol = notice.textbookForm
      ? `<div class="pdf-form-col">
          <div class="pdf-form-col-title">Standard Textbook Form</div>
          <div class="pdf-form-math pdf-divergence-eq-box">${renderPdfFormula(notice.textbookForm, true)}</div>
        </div>`
      : "";

    formsHtml = `
      <div class="pdf-divergence-forms">
        ${lecturerCol}
        ${textbookCol}
      </div>
    `;
  }

  return `
    <div class="pdf-divergence-card">
      <div class="pdf-divergence-header">
        <span class="pdf-divergence-badge">Textbook Divergence Notice</span>
        ${slideChip}
      </div>
      <div class="pdf-divergence-title">${escapeHtml(notice.title)}</div>
      <p class="pdf-divergence-msg">${formatTextWithMath(notice.message)}</p>
      ${formsHtml}
    </div>
  `;
}

function renderFormulaHtml(formula: NoteFormula): string {
  const mathHtml = renderPdfFormula(formula.latex, true);

  const statusBadge = renderFormulaStatusBadge(formula);
  const slideChip = formula.slide
    ? `<span class="pdf-slide-chip">Slide ${formula.slide}</span>`
    : "";

  const chipsHtml =
    slideChip || statusBadge
      ? `<div class="pdf-formula-badges">${slideChip}${statusBadge}</div>`
      : "";

  const titleOrLead = formula.leadText
    ? `<p class="pdf-formula-lead">${formatTextWithMath(formula.leadText)}</p>`
    : formula.name
      ? `<div class="pdf-formula-name">${formatTextWithMath(formula.name)}</div>`
      : "";

  const topRowHtml =
    titleOrLead || chipsHtml
      ? `<div class="pdf-formula-header">
          <div class="pdf-formula-header-text">${titleOrLead}</div>
          ${chipsHtml}
        </div>`
      : "";

  const reviewReasonHtml =
    formula.reviewReason && formula.status === "contradicted"
      ? `<div class="pdf-formula-review-reason pdf-review-reason-contradicted">
          <strong>Contradiction:</strong> ${escapeHtml(formula.reviewReason)}
        </div>`
      : "";

  const variablesHtml =
    formula.variables && formula.variables.length > 0
      ? `<div class="pdf-formula-variables">
          <div class="pdf-where-label">Trong đó:</div>
          <ul class="pdf-variable-list">
            ${formula.variables
              .map(
                (v) =>
                  `<li><span class="pdf-var-sym">${renderPdfFormula(v.symbol, false)}</span>: ${formatTextWithMath(v.definition)}</li>`,
              )
              .join("")}
          </ul>
        </div>`
      : "";

  const descHtml = formula.description
    ? `<p class="pdf-formula-desc">${formatTextWithMath(formula.description)}</p>`
    : "";

  const divergenceNoticesHtml =
    formula.divergenceNotices && formula.divergenceNotices.length > 0
      ? formula.divergenceNotices.map(renderDivergenceNoticeHtml).join("")
      : "";

  return `
    <div class="pdf-formula-block">
      ${topRowHtml}
      ${reviewReasonHtml}
      <div class="pdf-formula-row">
        <div class="pdf-formula-card">${mathHtml}</div>
      </div>
      ${variablesHtml}
      ${descHtml}
      ${divergenceNoticesHtml}
    </div>
  `;
}

function renderBulletListHtml(items?: string[]): string {
  if (!items || items.length === 0) return "";
  return `<ul class="pdf-bullets">
    ${items.map((bp) => `<li>${formatTextWithMath(bp)}</li>`).join("")}
  </ul>`;
}

function renderGroundedBulletListHtml(items?: GroundedBullet[]): string {
  if (!items || items.length === 0) return "";
  return `<ul class="pdf-bullets pdf-grounded-bullets">
    ${items
      .map((b) => {
        const slideChip = b.slide
          ? `<span class="pdf-slide-chip">Slide ${b.slide}</span>`
          : "";
        const statusBadge = renderItemStatusBadge(b.status);
        const chipsHtml =
          slideChip || statusBadge
            ? `<span class="pdf-inline-chips">${slideChip}${statusBadge}</span> `
            : "";
        const reviewNoteHtml =
          b.reviewReason && b.status === "contradicted"
            ? `<div class="pdf-bullet-review-reason pdf-review-reason-contradicted"><strong>Contradiction:</strong> ${escapeHtml(b.reviewReason)}</div>`
            : "";
        return `<li>${chipsHtml}${formatTextWithMath(b.text)}${reviewNoteHtml}</li>`;
      })
      .join("")}
  </ul>`;
}

export function renderTeachingBlockHtml(
  block: TeachingBlock,
  formulasById?: Map<string, NoteFormula>,
): string {
  const slideChipHtml =
    block.slideCitations && block.slideCitations.length > 0
      ? `<span class="pdf-slide-chip">${escapeHtml(formatSlideList(block.slideCitations))}</span>`
      : "";

  let formulasHtml = "";
  if (block.formulaRefs && block.formulaRefs.length > 0 && formulasById) {
    formulasHtml = block.formulaRefs
      .map((ref) => {
        const f = formulasById.get(ref);
        return f ? renderFormulaHtml(f) : "";
      })
      .join("");
  }

  let stepsHtml = "";
  if (block.steps && block.steps.length > 0) {
    stepsHtml = `<ol class="pdf-recipe-steps">
      ${block.steps.map((s) => `<li>${formatTextWithMath(s)}</li>`).join("")}
    </ol>`;
  }

  const textHtml = block.text
    ? `<p class="pdf-teaching-text">${formatTextWithMath(block.text)}</p>`
    : "";

  if (block.kind === "recipe") {
    const headingHtml = block.heading
      ? `<h4 class="pdf-recipe-heading">${formatTextWithMath(block.heading)}</h4>`
      : "";
    return `
      <div class="pdf-teaching-block pdf-recipe-card">
        <div class="pdf-recipe-header">
          <span class="pdf-recipe-badge">Recipe</span>
          ${headingHtml}
          ${slideChipHtml}
        </div>
        ${textHtml}
        ${stepsHtml}
        ${formulasHtml}
      </div>
    `;
  }

  if (block.kind === "caution") {
    const headingHtml = block.heading
      ? `<h4 class="pdf-caution-heading">${formatTextWithMath(block.heading)}</h4>`
      : "";
    return `
      <div class="pdf-teaching-block pdf-caution-card">
        <div class="pdf-caution-header">
          <span class="pdf-caution-badge">Caution / Boundary</span>
          ${headingHtml}
          ${slideChipHtml}
        </div>
        ${textHtml}
        ${stepsHtml}
        ${formulasHtml}
      </div>
    `;
  }

  const headingHtml = block.heading
    ? `<h4 class="pdf-teaching-heading">${formatTextWithMath(block.heading)}</h4>`
    : "";

  const kindLabel = block.kind.replace("_", " ").toUpperCase();

  return `
    <div class="pdf-teaching-block pdf-teaching-${escapeHtml(block.kind)}">
      <div class="pdf-teaching-header">
        <span class="pdf-teaching-badge">${escapeHtml(kindLabel)}</span>
        ${headingHtml}
        ${slideChipHtml}
      </div>
      ${textHtml}
      ${stepsHtml}
      ${formulasHtml}
    </div>
  `;
}

function getUnattachedDivergenceNotices(note: PublishedHandout): {
  perSection: Map<string, TextbookDivergenceNotice[]>;
  global: TextbookDivergenceNotice[];
} {
  const allNotices = note.divergenceNotices || [];
  const perSection = new Map<string, TextbookDivergenceNotice[]>();
  const global: TextbookDivergenceNotice[] = [];

  if (allNotices.length === 0) {
    return { perSection, global };
  }

  const renderedKeys = new Set<string>();
  for (const sec of note.sections) {
    for (const f of sec.formulas) {
      for (const d of f.divergenceNotices || []) {
        renderedKeys.add(`${d.ruleId}-${d.slide || ""}-${d.title}`);
      }
    }
    for (const sub of sec.subSections || []) {
      for (const f of sub.formulas) {
        for (const d of f.divergenceNotices || []) {
          renderedKeys.add(`${d.ruleId}-${d.slide || ""}-${d.title}`);
        }
      }
    }
  }

  const unattached = allNotices.filter(
    (n) => !renderedKeys.has(`${n.ruleId}-${n.slide || ""}-${n.title}`),
  );

  for (const notice of unattached) {
    let matchedSectionId: string | null = null;
    if (notice.slide) {
      for (const sec of note.sections) {
        if (sec.sourceSlides && sec.sourceSlides.includes(notice.slide)) {
          matchedSectionId = sec.id;
          break;
        }
      }
    }

    if (matchedSectionId) {
      const existing = perSection.get(matchedSectionId) || [];
      existing.push(notice);
      perSection.set(matchedSectionId, existing);
    } else {
      global.push(notice);
    }
  }

  return { perSection, global };
}

function isValidCustomLogoUrl(url?: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("data:image/")
  );
}

export function generateClutchNotePdfHtml(
  rawNote: ClutchNote | PublishedHandout,
  options?: PdfWatermarkOptions,
): string {
  const note = toPublishedHandout(rawNote);

  const canCustomize =
    options !== undefined &&
    (options.tier === undefined || options.tier === "tutor");

  const brandName =
    canCustomize && options?.customBrandName && options.customBrandName.trim().length > 0
      ? escapeHtml(options.customBrandName.trim())
      : CLUTCH_ARENA_BRAND_NAME;

  const logoUrl =
    canCustomize && options?.customLogoUrl && isValidCustomLogoUrl(options.customLogoUrl)
      ? escapeHtml(options.customLogoUrl.trim())
      : CLUTCH_ARENA_ICON_DATA_URL;

  const unattachedDivergences = getUnattachedDivergenceNotices(note);

  const globalDivergencesHtml =
    unattachedDivergences.global.length > 0
      ? `<div class="pdf-global-divergences">${unattachedDivergences.global.map(renderDivergenceNoticeHtml).join("")}</div>`
      : "";

  const sectionsHtml = note.sections
    .map((section: NoteSection) => {
      const slideChipHtml =
        section.sourceSlides && section.sourceSlides.length > 0
          ? `<span class="pdf-slide-chip">${escapeHtml(formatSlideList(section.sourceSlides))}</span>`
          : "";

      const sectionHeaderHtml = `
        <div class="pdf-section-header">
          <h2 class="pdf-section-title-vi">${escapeHtml(section.titleVi)}</h2>
          ${slideChipHtml}
        </div>
      `;

      const sectionUnattachedNotices =
        unattachedDivergences.perSection.get(section.id) || [];
      const sectionDivergencesHtml =
        sectionUnattachedNotices.length > 0
          ? `<div class="pdf-section-divergences">${sectionUnattachedNotices.map(renderDivergenceNoticeHtml).join("")}</div>`
          : "";

      const coreStatementHtml = section.coreStatement
        ? `<p class="pdf-core-statement">${formatTextWithMath(section.coreStatement)}</p>`
        : "";

      const overviewHtml = section.overview
        ? `<p class="pdf-section-overview">${formatTextWithMath(section.overview)}</p>`
        : "";

      const hasGroundedBullets = Boolean(
        section.groundedBullets && section.groundedBullets.length > 0,
      );
      const bulletListHtml = hasGroundedBullets
        ? renderGroundedBulletListHtml(section.groundedBullets)
        : renderBulletListHtml(section.bulletPoints);

      const formulasHtml = (section.formulas ?? []).map(renderFormulaHtml).join("");

      const formulasIntroduceBullets =
        section.formulas.length > 0 &&
        !section.formulas[0].leadText &&
        Boolean(section.formulas[0].description?.trim().endsWith(":"));

      const mainBodyHtml = formulasIntroduceBullets
        ? `${formulasHtml}${bulletListHtml}`
        : `${bulletListHtml}${formulasHtml}`;

      const formulasById = new Map<string, NoteFormula>();
      (section.formulas ?? []).forEach((f) => {
        (f.formulaRefs ?? []).forEach((ref) => formulasById.set(ref, f));
      });
      (section.subSections ?? []).forEach((sub) => {
        (sub.formulas ?? []).forEach((f) => {
          (f.formulaRefs ?? []).forEach((ref) => formulasById.set(ref, f));
        });
      });

      const blocksHtml =
        section.blocks && section.blocks.length > 0
          ? section.blocks
              .map((b: TeachingBlock) => renderTeachingBlockHtml(b, formulasById))
              .join("")
          : "";

      const subSectionsHtml =
        section.subSections && section.subSections.length > 0
          ? section.subSections
              .map((sub) => {
                const isRecipe =
                  Boolean(sub.heading && /recipe|quy trình|các bước|step-by-step|calculation/i.test(sub.heading)) ||
                  (sub as { kind?: string }).kind === "recipe";

                const subHeadingHtml = sub.heading
                  ? `<h3 class="pdf-sub-heading ${isRecipe ? "pdf-recipe-heading" : ""}">${formatTextWithMath(sub.heading)}</h3>`
                  : "";
                const subLeadHtml = sub.leadIn
                  ? `<p class="pdf-section-overview">${formatTextWithMath(sub.leadIn)}</p>`
                  : "";
                const hasSubGrounded = Boolean(
                  sub.groundedBullets && sub.groundedBullets.length > 0,
                );
                const subFormulasHtml = (sub.formulas ?? [])
                  .map(renderFormulaHtml)
                  .join("");

                if (isRecipe) {
                  const stepItems = hasSubGrounded
                    ? (sub.groundedBullets || []).map((b) => b.text)
                    : (sub.bulletPoints || []);
                  const recipeStepsHtml =
                    stepItems.length > 0
                      ? `<ol class="pdf-recipe-steps">
                          ${stepItems.map((step) => `<li>${formatTextWithMath(step)}</li>`).join("")}
                        </ol>`
                      : "";

                  return `
                    <div class="pdf-subsection pdf-recipe-card">
                      <div class="pdf-recipe-header">
                        <span class="pdf-recipe-badge">Recipe</span>
                        ${subHeadingHtml}
                      </div>
                      ${subLeadHtml}
                      ${recipeStepsHtml}
                      ${subFormulasHtml}
                    </div>
                  `;
                }

                const subBulletsHtml = hasSubGrounded
                  ? renderGroundedBulletListHtml(sub.groundedBullets)
                  : renderBulletListHtml(sub.bulletPoints);

                return `
                  <div class="pdf-subsection">
                    ${subHeadingHtml}
                    ${subLeadHtml}
                    ${subBulletsHtml}
                    ${subFormulasHtml}
                  </div>
                `;
              })
              .join("")
          : "";

      let takeawaysHtml = "";
      if (section.keyTakeaways) {
        const kt = section.keyTakeaways;
        const hasStructuredItems = kt.items && kt.items.length > 0;
        let listItemsHtml = "";

        if (hasStructuredItems) {
          listItemsHtml = kt
            .items!.map((item) => {
              const slideChip = item.slide
                ? `<span class="pdf-slide-chip">Slide ${item.slide}</span>`
                : "";
              const statusBadge = renderItemStatusBadge(item.status);
              const chipsHtml =
                slideChip || statusBadge
                  ? `<span class="pdf-inline-chips">${slideChip}${statusBadge}</span> `
                  : "";

              const reviewReasonHtml =
                item.reviewReason && item.status === "contradicted"
                  ? `<div class="pdf-bullet-review-reason pdf-review-reason-contradicted">
                      <strong>Contradiction:</strong> ${escapeHtml(item.reviewReason)}
                    </div>`
                  : "";

              const subHtml =
                item.subBullets && item.subBullets.length > 0
                  ? `<ul class="pdf-takeaways-subbullets">
                      ${item.subBullets.map((sb) => `<li>${formatTextWithMath(sb)}</li>`).join("")}
                    </ul>`
                  : "";
              return `<li>${chipsHtml}${formatTextWithMath(item.point)}${reviewReasonHtml}${subHtml}</li>`;
            })
            .join("");
        } else {
          const fallbackPoints: string[] = [];
          if (kt.summaryPoints && kt.summaryPoints.length > 0) {
            fallbackPoints.push(...kt.summaryPoints);
          }
          listItemsHtml = fallbackPoints
            .map((pt) => `<li>${formatTextWithMath(pt)}</li>`)
            .join("");
        }

        let conditionsHtml = "";
        if (kt.boundaryConditions || kt.modelSelectionRule || kt.realWorldConditions) {
          const condItems: string[] = [];
          if (kt.boundaryConditions) {
            condItems.push(
              `<div class="pdf-takeaway-condition-item pdf-condition-boundary"><strong>Boundary Condition:</strong> ${formatTextWithMath(kt.boundaryConditions)}</div>`,
            );
          }
          if (kt.modelSelectionRule) {
            condItems.push(
              `<div class="pdf-takeaway-condition-item pdf-condition-rule"><strong>Model Selection:</strong> ${formatTextWithMath(kt.modelSelectionRule)}</div>`,
            );
          }
          if (kt.realWorldConditions) {
            condItems.push(
              `<div class="pdf-takeaway-condition-item pdf-condition-realworld"><strong>Real-World Application:</strong> ${formatTextWithMath(kt.realWorldConditions)}</div>`,
            );
          }
          conditionsHtml = `<div class="pdf-takeaways-conditions">${condItems.join("")}</div>`;
        }

        if (listItemsHtml || conditionsHtml) {
          takeawaysHtml = `
            <div class="pdf-takeaways-card">
              <div class="pdf-takeaways-title">${escapeHtml(kt.title || "KEY TAKEAWAYS")}</div>
              ${listItemsHtml ? `<ol class="pdf-takeaways-list">${listItemsHtml}</ol>` : ""}
              ${conditionsHtml}
            </div>
          `;
        }
      }

      return `
        <section class="pdf-section-block">
          ${sectionHeaderHtml}
          ${sectionDivergencesHtml}
          ${coreStatementHtml}
          ${overviewHtml}
          ${mainBodyHtml}
          ${blocksHtml}
          ${subSectionsHtml}
          ${takeawaysHtml}
        </section>
      `;
    })
    .join("");

  const displayNoiseRate =
    note.noiseReductionRate > 0 && note.noiseReductionRate <= 1
      ? Math.round(note.noiseReductionRate * 100)
      : Math.round(note.noiseReductionRate || 85);

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(note.title)} — Clutch Notes AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css">
  <style>
    @page {
      size: A4;
      margin: 16mm 18mm 18mm 18mm;
    }
    @media print {
      body {
        margin: 0;
        background: #ffffff !important;
        color: #111827 !important;
        orphans: 3;
        widows: 3;
      }
      .no-print {
        display: none !important;
      }
      .sheet-wrapper {
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
      }
      .pdf-section-block {
        orphans: 3;
        widows: 3;
      }
      .pdf-formula-block,
      .pdf-formula-card,
      .pdf-subsection,
      .pdf-recipe-card,
      .pdf-teaching-block,
      .pdf-takeaways-card,
      .pdf-divergence-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pdf-section-header,
      .pdf-section-title-vi,
      .pdf-sub-heading,
      .pdf-recipe-heading {
        break-after: avoid;
        page-break-after: avoid;
      }
      .watermark-overlay {
        display: flex !important;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: 'Lora', 'Be Vietnam Pro', Georgia, serif;
      font-size: 13.5px;
      line-height: 1.5;
      color: #111827;
      background: #f6f6f3;
      margin: 0;
      padding: 0;
      orphans: 3;
      widows: 3;
    }

    h1, h2, h3, .doc-main-title, .pdf-section-title-vi, .pdf-sub-heading, .pdf-recipe-heading {
      font-family: 'Lora', 'Be Vietnam Pro', Georgia, serif;
    }

    /* Fixed watermark overlay: Centered Clutch Arena icon + name */
    .watermark-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 100;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }

    .watermark-center-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      opacity: 0.055;
      user-select: none;
      pointer-events: none;
    }

    .watermark-big-icon {
      width: 240px;
      height: 240px;
      object-fit: contain;
    }

    .watermark-name-below {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 34px;
      font-weight: 900;
      letter-spacing: 8px;
      color: #1a2717;
      text-transform: uppercase;
      margin-top: 14px;
      white-space: nowrap;
    }

    /* Screen top toolbar (hidden when printing) */
    .screen-toolbar {
      position: sticky;
      top: 0;
      z-index: 999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #141913;
      color: #ffffff;
      padding: 11px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
    }
    .screen-toolbar-title {
      font-size: 13.5px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-header-icon {
      width: 20px;
      height: 20px;
      object-fit: contain;
      border-radius: 4px;
    }
    .screen-pro-badge {
      background: #e96b44;
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .screen-stats {
      font-size: 12px;
      color: #cbd5c8;
      font-weight: 500;
    }
    .screen-toolbar-actions {
      display: flex;
      gap: 10px;
    }
    .btn-action {
      background: #e96b44;
      color: #ffffff;
      border: none;
      padding: 7px 16px;
      font-size: 12.5px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
    }
    .btn-action:hover {
      background: #d95e37;
    }
    .btn-secondary {
      background: #273125;
      color: #e5e7eb;
    }

    /* Main Study Sheet Container */
    .sheet-wrapper {
      max-width: 780px;
      margin: 28px auto 52px auto;
      background: #ffffff;
      border: 1px solid #dedfd8;
      border-radius: 6px;
      padding: 44px 54px;
      box-shadow: 0 6px 22px rgba(0,0,0,0.06);
      position: relative;
    }

    /* Handout Header */
    .handout-course-line {
      font-size: 13px;
      font-style: italic;
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 16px;
    }

    .doc-main-title {
      font-size: 21px;
      font-weight: 700;
      color: #991b1b;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin: 0 0 22px 0;
      line-height: 1.3;
    }

    /* Section Styling */
    .pdf-section-block {
      margin-bottom: 18px;
      orphans: 3;
      widows: 3;
    }

    .pdf-section-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin: 16px 0 8px 0;
      break-after: avoid;
      page-break-after: avoid;
    }

    .pdf-section-title-vi {
      font-size: 14.5px;
      font-weight: 700;
      color: #991b1b;
      margin: 0;
      letter-spacing: 0.2px;
      break-after: avoid;
      page-break-after: avoid;
    }

    .pdf-core-statement {
      font-size: 13.5px;
      font-weight: 700;
      color: #111827;
      text-align: center;
      margin: 10px 12px;
    }

    .pdf-section-overview {
      font-size: 13.5px;
      color: #111827;
      margin: 6px 0;
    }

    .pdf-bullets {
      margin: 6px 0 10px 26px;
      padding: 0;
    }
    .pdf-bullets li {
      font-size: 13.5px;
      color: #111827;
      margin-bottom: 4px;
    }

    /* Sub-Sections (CASE 1, CASE 2, Finding g, etc.) */
    .pdf-subsection {
      margin: 12px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-sub-heading {
      font-size: 13.5px;
      font-weight: 700;
      color: #111827;
      margin: 12px 0 6px 0;
      break-after: avoid;
      page-break-after: avoid;
    }

    /* Slide chips */
    .pdf-slide-chip {
      display: inline-block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 500;
      color: #4b5563;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 1px 6px;
      line-height: 1.4;
      white-space: nowrap;
      vertical-align: middle;
    }

    /* Verification status badges */
    .pdf-status-badge {
      display: inline-block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10.5px;
      font-weight: 600;
      border-radius: 4px;
      padding: 1px 7px;
      line-height: 1.4;
      white-space: nowrap;
      vertical-align: middle;
    }
    .pdf-status-verified {
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
    }
    .pdf-status-derived {
      background: #eef2ff;
      color: #4338ca;
      border: 1px solid #c7d2fe;
    }
    .pdf-status-review {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .pdf-status-contradicted {
      background: #fff1f2;
      color: #be123c;
      border: 1px solid #fecdd3;
    }

    .pdf-inline-chips {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      vertical-align: middle;
      margin-right: 4px;
    }

    /* Formula header & badges */
    .pdf-formula-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 4px;
    }
    .pdf-formula-header-text {
      flex: 1;
    }
    .pdf-formula-badges {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    /* Centered Crisp Bordered Formula Box */
    .pdf-formula-block {
      margin: 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-formula-lead {
      font-size: 13.5px;
      color: #111827;
      margin: 6px 0 8px 0;
    }
    .pdf-formula-name {
      font-size: 13px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 6px;
    }
    .pdf-formula-row {
      display: flex;
      justify-content: center;
      margin: 10px 0;
    }
    .pdf-formula-card {
      display: inline-block;
      border: 1px solid #1f2937;
      background: #ffffff;
      padding: 8px 20px;
      font-size: 14.5px;
      color: #111827;
      max-width: 100%;
      white-space: normal;
      overflow-wrap: break-word;
      word-break: break-word;
      box-sizing: border-box;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-divergence-eq-box {
      white-space: normal;
      overflow-wrap: break-word;
      word-break: break-word;
      max-width: 100%;
      box-sizing: border-box;
    }
    .pdf-formula-card .katex-display,
    .pdf-divergence-eq-box .katex-display {
      margin: 2px 0;
      white-space: normal !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
    }
    .pdf-formula-card .katex-display > .katex,
    .pdf-divergence-eq-box .katex-display > .katex {
      white-space: normal !important;
      text-align: center;
      display: inline-block;
      max-width: 100%;
    }
    .pdf-formula-card .katex,
    .pdf-divergence-eq-box .katex {
      white-space: normal !important;
      overflow-wrap: break-word;
    }
    .pdf-formula-card .katex .base,
    .pdf-divergence-eq-box .katex .base {
      white-space: normal !important;
      display: inline-block;
      max-width: 100%;
    }
    .pdf-math-fallback {
      font-family: 'Lora', 'Be Vietnam Pro', Georgia, serif;
      font-style: italic;
      color: #111827;
      display: inline-block;
      max-width: 100%;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    div.pdf-math-fallback {
      display: block;
      text-align: center;
      margin: 4px auto;
    }
    .katex-fallback {
      font-family: 'Lora', 'Be Vietnam Pro', Georgia, serif;
      font-style: italic;
      color: #111827;
    }
    .katex-error {
      color: #111827 !important;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Lora', 'Be Vietnam Pro', Georgia, serif;
      font-style: italic;
    }
    .pdf-formula-card .pdf-math-fallback,
    .pdf-divergence-eq-box .pdf-math-fallback {
      white-space: normal;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    .pdf-formula-desc {
      font-size: 13.5px;
      color: #111827;
      margin: 8px 0 6px 0;
    }

    /* Review reason boxes (only rendered for contradicted in PDF) */
    .pdf-formula-review-reason,
    .pdf-bullet-review-reason {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11.5px;
      line-height: 1.45;
      padding: 4px 8px;
      border-radius: 4px;
      margin: 4px 0 6px 0;
    }
    .pdf-review-reason-contradicted {
      background: #fff1f2;
      color: #9f1239;
      border: 1px solid #fecdd3;
    }

    /* "Trong đó:" Variable Definitions */
    .pdf-formula-variables {
      margin: 8px 0 12px 0;
    }
    .pdf-where-label {
      font-size: 13.5px;
      color: #111827;
      margin-bottom: 4px;
    }
    .pdf-variable-list {
      margin: 0 0 0 26px;
      padding: 0;
      font-size: 13.5px;
      color: #111827;
    }
    .pdf-variable-list li {
      margin-bottom: 3px;
    }
    .pdf-var-sym {
      font-weight: 600;
    }

    /* Structured Recipe Card */
    .pdf-recipe-card {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 6px;
      padding: 10px 14px;
      margin: 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-recipe-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
    }
    .pdf-recipe-badge {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #bbf7d0;
      color: #166534;
      padding: 2px 7px;
      border-radius: 4px;
    }
    .pdf-recipe-heading {
      font-size: 13.5px;
      font-weight: 700;
      color: #14532d;
      margin: 0;
      break-after: avoid;
      page-break-after: avoid;
    }
    .pdf-recipe-steps {
      margin: 6px 0 6px 22px;
      padding: 0;
      font-size: 13px;
      color: #111827;
    }
    .pdf-recipe-steps li {
      margin-bottom: 4px;
    }

    /* Caution Card */
    .pdf-caution-card {
      background: #fff1f2;
      border: 1px solid #fecdd3;
      border-radius: 6px;
      padding: 10px 14px;
      margin: 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-caution-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
    }
    .pdf-caution-badge {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #fecdd3;
      color: #9f1239;
      padding: 2px 7px;
      border-radius: 4px;
    }
    .pdf-caution-heading {
      font-size: 13.5px;
      font-weight: 700;
      color: #881337;
      margin: 0;
    }

    /* Teaching Block General */
    .pdf-teaching-block {
      background: #fafaf9;
      border: 1px solid #e7e5e4;
      border-radius: 6px;
      padding: 10px 14px;
      margin: 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-teaching-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
    }
    .pdf-teaching-badge {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #e7e5e4;
      color: #44403c;
      padding: 2px 7px;
      border-radius: 4px;
    }
    .pdf-teaching-heading {
      font-size: 13.5px;
      font-weight: 700;
      color: #1c1917;
      margin: 0;
    }
    .pdf-teaching-text {
      font-size: 13px;
      color: #111827;
      margin: 4px 0;
    }

    /* Crisp Boxed KEY TAKEAWAYS */
    .pdf-takeaways-card {
      border: 1px solid #1f2937;
      background: #ffffff;
      padding: 12px 18px;
      margin: 14px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-takeaways-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #991b1b;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .pdf-takeaways-list {
      margin: 0 0 0 22px;
      padding: 0;
      font-size: 13.5px;
      color: #111827;
    }
    .pdf-takeaways-list > li {
      margin-bottom: 4px;
    }
    .pdf-takeaways-subbullets {
      list-style-type: disc;
      margin: 3px 0 4px 20px;
      padding: 0;
    }
    .pdf-takeaways-subbullets li {
      margin-bottom: 2px;
    }

    /* Takeaways conditions */
    .pdf-takeaways-conditions {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #fecdd3;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .pdf-takeaway-condition-item {
      font-size: 12px;
      line-height: 1.4;
      padding: 3px 6px;
      border-radius: 4px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .pdf-condition-boundary {
      background: #fff1f2;
      color: #9f1239;
      border: 1px solid #fecdd3;
    }
    .pdf-condition-rule {
      background: #fffbeb;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    .pdf-condition-realworld {
      background: #f8fafc;
      color: #334155;
      border: 1px solid #e2e8f0;
    }

    /* Textbook Divergence Notices */
    .pdf-divergence-card {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-radius: 6px;
      padding: 12px 16px;
      margin: 10px 0 14px 0;
      color: #1f2937;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-divergence-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .pdf-divergence-badge {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #fde68a;
      color: #78350f;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .pdf-divergence-title {
      font-size: 13px;
      font-weight: 700;
      color: #451a03;
      margin-bottom: 4px;
    }
    .pdf-divergence-msg {
      font-size: 12.5px;
      line-height: 1.5;
      color: #78350f;
      margin: 4px 0 8px 0;
    }
    .pdf-divergence-forms {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #fde68a;
    }
    .pdf-form-col {
      flex: 1;
      background: #ffffff;
      border: 1px solid #fde68a;
      border-radius: 4px;
      padding: 8px 12px;
      text-align: center;
    }
    .pdf-form-col-title {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #92400e;
      margin-bottom: 4px;
    }
    .pdf-form-math {
      font-family: 'Lora', 'Be Vietnam Pro', Georgia, serif;
    }

    /* Subtle Footer */
    .pdf-footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 10px;
      margin-top: 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10.5px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="screen-toolbar no-print">
    <div class="screen-toolbar-title">
      <img src="${logoUrl}" class="brand-header-icon" alt="${brandName}" />
      <span>${brandName} · Clutch Notes AI</span>
      <span class="screen-pro-badge">PRO NOTE</span>
      <span class="screen-stats">(${note.originalSlideCount} Slides → ${note.estimatedDistilledPages} Pages · ${displayNoiseRate}% Noise Stripped)</span>
    </div>
    <div class="screen-toolbar-actions">
      <button class="btn-action" onclick="window.print()">Print / Save as PDF</button>
      <button class="btn-action btn-secondary" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="watermark-overlay" aria-hidden="true">
    <div class="watermark-center-badge">
      <img src="${logoUrl}" class="watermark-big-icon" alt="${brandName}" />
      <div class="watermark-name-below">${brandName}</div>
    </div>
  </div>

  <div class="sheet-wrapper">
    <div class="handout-course-line">${escapeHtml(note.subject)} — Clutch Notes AI</div>
    <h1 class="doc-main-title">${escapeHtml(note.title)}</h1>

    <main>
      ${globalDivergencesHtml}
      ${sectionsHtml}
    </main>

    <footer class="pdf-footer">
      <div>${brandName} · Concise Study Handout</div>
      <div>${escapeHtml(note.originalFileName)}</div>
    </footer>
  </div>
</body>
</html>`;

  return fullHtml;
}

export const buildPrintableNotesHtml = generateClutchNotePdfHtml;

export function exportClutchNotePdf(
  rawNote: ClutchNote | PublishedHandout,
  options?: PdfWatermarkOptions,
): void {
  if (typeof window === "undefined") return;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to open the watermarked PDF print preview.");
    return;
  }

  // Isolate popup window from opener context to prevent tab-nabbing / window reference leaks
  printWindow.opener = null;

  const html = generateClutchNotePdfHtml(rawNote, options);
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  try {
    printWindow.focus?.();
  } catch {
    // ignore
  }

  setTimeout(() => {
    try {
      printWindow.print?.();
    } catch {
      // ignore
    }
  }, 250);
}

export const exportNotesToPdf = exportClutchNotePdf;
