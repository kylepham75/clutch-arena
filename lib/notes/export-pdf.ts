import {
  escapeHtml,
  normalizeMathFormulas,
  renderKatexSafe,
  tokenizeMath,
} from "@/lib/math/latex";
import { CLUTCH_ARENA_ICON_DATA_URL, CLUTCH_ARENA_BRAND_NAME } from "@/lib/notes/brand-assets";
import type {
  ClutchNote,
  FormulaLedgerEntry,
  GroundedBullet,
  NoteFormula,
  NoteSection,
  TextbookDivergenceNotice,
} from "@/lib/schemas/notes";

export interface UncapturedFormulaItem {
  id: string;
  slide?: number;
  latex?: string;
  label?: string;
  reason: string;
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
 * Formats inline or display text containing math delimiters ($...$ or $$...$$) into KaTeX HTML.
 * Normalizes math formulas first to ensure zero un-delimited LaTeX leaks into PDF exports.
 * Escapes plain text segments to prevent XSS while feeding unescaped LaTeX directly to KaTeX.
 */
export function formatTextWithMath(text: string): string {
  if (!text) return "";

  const normalized = normalizeMathFormulas(text);
  const tokens = tokenizeMath(normalized);

  return tokens
    .map((token) => {
      if (token.type === "display-math") {
        return `<div class="pdf-display-math">${renderKatexSafe(token.value, true)}</div>`;
      }
      if (token.type === "inline-math") {
        return `<span class="pdf-inline-math">${renderKatexSafe(token.value, false)}</span>`;
      }
      return escapeHtml(token.value);
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
  if (status === "needs_review" || status === "unsupported") {
    return `<span class="pdf-status-badge pdf-status-review">Needs review</span>`;
  }
  return "";
}

export function renderFormulaStatusBadge(formula: NoteFormula): string {
  if (formula.status === "contradicted") {
    return `<span class="pdf-status-badge pdf-status-contradicted">Contradicted</span>`;
  }

  if (formula.status === "needs_review" || formula.status === "unsupported") {
    return `<span class="pdf-status-badge pdf-status-review">Needs review</span>`;
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
          <div class="pdf-form-math">${renderKatexSafe(notice.lecturerForm, true)}</div>
        </div>`
      : "";
    const textbookCol = notice.textbookForm
      ? `<div class="pdf-form-col">
          <div class="pdf-form-col-title">Standard Textbook Form</div>
          <div class="pdf-form-math">${renderKatexSafe(notice.textbookForm, true)}</div>
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
  const mathHtml = renderKatexSafe(formula.latex, true);

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
    formula.reviewReason &&
    (formula.status === "needs_review" ||
      formula.status === "unsupported" ||
      formula.status === "contradicted")
      ? `<div class="pdf-formula-review-reason pdf-review-reason-${formula.status}">
          <strong>${formula.status === "contradicted" ? "Contradiction:" : "Review note:"}</strong> ${escapeHtml(formula.reviewReason)}
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
                  `<li><span class="pdf-var-sym">${renderKatexSafe(v.symbol, false)}</span>: ${formatTextWithMath(v.definition)}</li>`,
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
          b.reviewReason &&
          (b.status === "needs_review" ||
            b.status === "unsupported" ||
            b.status === "contradicted")
            ? `<div class="pdf-bullet-review-reason pdf-review-reason-${b.status}"><strong>Review note:</strong> ${escapeHtml(b.reviewReason)}</div>`
            : "";
        return `<li>${chipsHtml}${formatTextWithMath(b.text)}${reviewNoteHtml}</li>`;
      })
      .join("")}
  </ul>`;
}

function getUnattachedDivergenceNotices(note: ClutchNote): {
  perSection: Map<string, TextbookDivergenceNotice[]>;
  global: TextbookDivergenceNotice[];
} {
  const allNotices = note.verification?.divergenceNotices || [];
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

export function getUncapturedFormulas(note: ClutchNote): UncapturedFormulaItem[] {
  const omittedMap = new Map<string, string>();
  if (note.omitted) {
    for (const o of note.omitted) {
      if (o.formulaId) {
        omittedMap.set(o.formulaId, o.reason);
      }
    }
  }

  const ledgerMap = new Map<string, FormulaLedgerEntry>();
  if (note.formulaLedger) {
    for (const entry of note.formulaLedger) {
      ledgerMap.set(entry.id, entry);
    }
  }

  const placedIds = new Set<string>(note.verification?.placedFormulaIds || []);
  for (const sec of note.sections) {
    for (const f of sec.formulas) {
      for (const ref of f.formulaRefs || []) {
        placedIds.add(ref);
      }
    }
    for (const sub of sec.subSections || []) {
      for (const f of sub.formulas) {
        for (const ref of f.formulaRefs || []) {
          placedIds.add(ref);
        }
      }
    }
  }

  const uncapturedIds = new Set<string>();

  if (note.verification?.uncapturedFormulaIds) {
    for (const id of note.verification.uncapturedFormulaIds) {
      uncapturedIds.add(id);
    }
  }

  if (note.omitted) {
    for (const o of note.omitted) {
      if (o.formulaId) {
        uncapturedIds.add(o.formulaId);
      }
    }
  }

  if (note.formulaLedger) {
    for (const entry of note.formulaLedger) {
      if (!placedIds.has(entry.id)) {
        uncapturedIds.add(entry.id);
      }
    }
  }

  const items: UncapturedFormulaItem[] = [];

  for (const id of uncapturedIds) {
    const ledger = ledgerMap.get(id);
    const omittedReason = omittedMap.get(id);

    const reason =
      omittedReason ||
      (ledger?.isExerciseOnly
        ? "Appeared solely in a practice exercise or worked example"
        : ledger?.evidence
          ? `Slide context: "${ledger.evidence}"`
          : "Omitted from core summary sections as non-essential or duplicate");

    items.push({
      id,
      slide: ledger?.slide,
      latex: ledger?.latex,
      label: ledger?.label,
      reason,
    });
  }

  items.sort((a, b) => {
    if (a.slide && b.slide && a.slide !== b.slide) {
      return a.slide - b.slide;
    }
    const aNum = parseInt(a.id.replace(/\D/g, ""), 10) || 0;
    const bNum = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
    return aNum - bNum;
  });

  return items;
}

function renderUncapturedSectionHtml(items: UncapturedFormulaItem[]): string {
  if (!items || items.length === 0) return "";
  const countLabel = `${items.length} ${
    items.length === 1 ? "Formula Omitted" : "Formulas Omitted"
  }`;

  const itemsHtml = items
    .map((item) => {
      const slideChip = item.slide
        ? `<span class="pdf-slide-chip">Slide ${item.slide}</span>`
        : "";
      const labelHtml = item.label
        ? `<span class="pdf-uncaptured-label">${escapeHtml(item.label)}</span>`
        : "";
      const mathHtml = item.latex
        ? `<div class="pdf-uncaptured-math">${renderKatexSafe(item.latex, true)}</div>`
        : "";

      return `
        <div class="pdf-uncaptured-item">
          <div class="pdf-uncaptured-item-header">
            <div class="pdf-uncaptured-id-row">
              <span class="pdf-uncaptured-id">${escapeHtml(item.id)}</span>
              ${labelHtml}
            </div>
            ${slideChip}
          </div>
          ${mathHtml}
          <div class="pdf-uncaptured-reason">
            <strong>Reason:</strong> ${escapeHtml(item.reason)}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <section class="pdf-uncaptured-section">
      <div class="pdf-uncaptured-container">
        <div class="pdf-uncaptured-header">
          <h3 class="pdf-uncaptured-title">Uncaptured Source Formulas</h3>
          <span class="pdf-uncaptured-badge">${countLabel}</span>
        </div>
        <p class="pdf-uncaptured-subtitle">
          The following formulas appeared in the lecture slides (e.g. in practice exercises or appendices) but were omitted from core summary sections.
        </p>
        <div class="pdf-uncaptured-list">
          ${itemsHtml}
        </div>
      </div>
    </section>
  `;
}

export function generateClutchNotePdfHtml(note: ClutchNote): string {
  const unattachedDivergences = getUnattachedDivergenceNotices(note);
  const uncapturedFormulas = getUncapturedFormulas(note);

  let warningBannerHtml = "";
  if (note.verification?.warnings && note.verification.warnings.length > 0) {
    const warningsList = note.verification.warnings
      .map((w) => `<li>${formatTextWithMath(w)}</li>`)
      .join("");
    const countLabel = `${note.verification.warnings.length} ${
      note.verification.warnings.length === 1 ? "Notice" : "Notices"
    }`;

    warningBannerHtml = `
      <div class="pdf-warning-banner">
        <div class="pdf-warning-header">
          <div class="pdf-warning-title">
            <span class="pdf-warning-icon">⚠</span> Ingestion & Verification Notices
          </div>
          <span class="pdf-warning-count">${countLabel}</span>
        </div>
        <ul class="pdf-warning-list">
          ${warningsList}
        </ul>
        <p class="pdf-warning-note">Formulas or tables from these slides should be double-checked against your original lecture deck.</p>
      </div>
    `;
  }

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

      const subSectionsHtml =
        section.subSections && section.subSections.length > 0
          ? section.subSections
              .map((sub) => {
                const subHeadingHtml = sub.heading
                  ? `<h3 class="pdf-sub-heading">${formatTextWithMath(sub.heading)}</h3>`
                  : "";
                const subLeadHtml = sub.leadIn
                  ? `<p class="pdf-section-overview">${formatTextWithMath(sub.leadIn)}</p>`
                  : "";
                const hasSubGrounded = Boolean(
                  sub.groundedBullets && sub.groundedBullets.length > 0,
                );
                const subBulletsHtml = hasSubGrounded
                  ? renderGroundedBulletListHtml(sub.groundedBullets)
                  : renderBulletListHtml(sub.bulletPoints);
                const subFormulasHtml = (sub.formulas ?? [])
                  .map(renderFormulaHtml)
                  .join("");
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
                item.reviewReason &&
                (item.status === "needs_review" ||
                  item.status === "unsupported" ||
                  item.status === "contradicted")
                  ? `<div class="pdf-bullet-review-reason pdf-review-reason-${item.status}">
                      <strong>Review note:</strong> ${escapeHtml(item.reviewReason)}
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
          } else {
            if (kt.modelSelectionRule) fallbackPoints.push(kt.modelSelectionRule);
            if (kt.realWorldConditions) fallbackPoints.push(kt.realWorldConditions);
            if (kt.boundaryConditions) fallbackPoints.push(kt.boundaryConditions);
          }
          listItemsHtml = fallbackPoints
            .map((pt) => `<li>${formatTextWithMath(pt)}</li>`)
            .join("");
        }

        if (listItemsHtml) {
          takeawaysHtml = `
            <div class="pdf-takeaways-card">
              <div class="pdf-takeaways-title">${escapeHtml(kt.title || "KEY TAKEAWAYS")}</div>
              <ol class="pdf-takeaways-list">
                ${listItemsHtml}
              </ol>
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
          ${subSectionsHtml}
          ${takeawaysHtml}
        </section>
      `;
    })
    .join("");

  const uncapturedSectionHtml = renderUncapturedSectionHtml(uncapturedFormulas);

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
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
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
      .pdf-formula-block,
      .pdf-formula-card,
      .pdf-takeaways-card,
      .pdf-divergence-card,
      .pdf-uncaptured-item,
      .pdf-warning-banner {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pdf-section-title-vi,
      .pdf-sub-heading,
      .pdf-uncaptured-title {
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
    }

    h1, h2, h3, .doc-main-title, .pdf-section-title-vi, .pdf-sub-heading, .pdf-uncaptured-title {
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
    }

    .pdf-section-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin: 16px 0 8px 0;
    }

    .pdf-section-title-vi {
      font-size: 14.5px;
      font-weight: 700;
      color: #991b1b;
      margin: 0;
      letter-spacing: 0.2px;
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
    }
    .pdf-sub-heading {
      font-size: 13.5px;
      font-weight: 700;
      color: #111827;
      margin: 12px 0 6px 0;
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
      overflow-x: auto;
    }
    .pdf-formula-card .katex-display {
      margin: 2px 0;
    }
    .pdf-formula-desc {
      font-size: 13.5px;
      color: #111827;
      margin: 8px 0 6px 0;
    }

    /* Review reason boxes */
    .pdf-formula-review-reason,
    .pdf-bullet-review-reason {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11.5px;
      line-height: 1.45;
      padding: 4px 8px;
      border-radius: 4px;
      margin: 4px 0 6px 0;
    }
    .pdf-review-reason-needs_review,
    .pdf-review-reason-unsupported {
      background: #fffbeb;
      color: #92400e;
      border: 1px solid #fde68a;
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

    /* Crisp Boxed KEY TAKEAWAYS */
    .pdf-takeaways-card {
      border: 1px solid #1f2937;
      background: #ffffff;
      padding: 12px 18px;
      margin: 14px 0;
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

    /* Ingestion Warning Banner */
    .pdf-warning-banner {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fefce8;
      border: 1px solid #fde047;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 20px;
      color: #713f12;
    }
    .pdf-warning-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #fef08a;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .pdf-warning-title {
      font-weight: 700;
      font-size: 13px;
      color: #854d0e;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pdf-warning-count {
      font-size: 11px;
      font-weight: 600;
      background: #fef08a;
      color: #713f12;
      padding: 2px 8px;
      border-radius: 12px;
    }
    .pdf-warning-list {
      margin: 6px 0 6px 20px;
      padding: 0;
      font-size: 12.5px;
      line-height: 1.5;
    }
    .pdf-warning-list li {
      margin-bottom: 3px;
    }
    .pdf-warning-note {
      font-size: 11px;
      font-style: italic;
      color: #854d0e;
      margin: 6px 0 0 0;
      padding-top: 6px;
      border-top: 1px solid #fef08a;
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

    /* Uncaptured Source Formulas Section */
    .pdf-uncaptured-section {
      margin-top: 28px;
      padding-top: 16px;
      border-top: 2px dashed #dcded6;
    }
    .pdf-uncaptured-container {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 16px 20px;
    }
    .pdf-uncaptured-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .pdf-uncaptured-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #1e293b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0;
    }
    .pdf-uncaptured-badge {
      font-size: 11px;
      font-weight: 600;
      background: #e2e8f0;
      color: #334155;
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid #cbd5e1;
    }
    .pdf-uncaptured-subtitle {
      font-size: 12px;
      color: #475569;
      line-height: 1.4;
      margin: 4px 0 12px 0;
    }
    .pdf-uncaptured-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pdf-uncaptured-item {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
    }
    .pdf-uncaptured-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .pdf-uncaptured-id-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pdf-uncaptured-id {
      font-family: monospace;
      font-size: 11.5px;
      font-weight: 700;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 1px 6px;
      color: #0f172a;
    }
    .pdf-uncaptured-label {
      font-size: 12px;
      font-weight: 600;
      color: #334155;
    }
    .pdf-uncaptured-math {
      font-family: 'Lora', 'Be Vietnam Pro', Georgia, serif;
      margin: 6px 0;
      padding: 6px 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      text-align: center;
    }
    .pdf-uncaptured-reason {
      font-size: 11.5px;
      color: #64748b;
      margin-top: 4px;
      line-height: 1.4;
    }
    .pdf-uncaptured-reason strong {
      color: #475569;
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
      <img src="${CLUTCH_ARENA_ICON_DATA_URL}" class="brand-header-icon" alt="Clutch Arena" />
      <span>${CLUTCH_ARENA_BRAND_NAME} · Clutch Notes AI</span>
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
      <img src="${CLUTCH_ARENA_ICON_DATA_URL}" class="watermark-big-icon" alt="Clutch Arena" />
      <div class="watermark-name-below">${CLUTCH_ARENA_BRAND_NAME}</div>
    </div>
  </div>

  <div class="sheet-wrapper">
    <div class="handout-course-line">${escapeHtml(note.subject)} — Clutch Notes AI</div>
    <h1 class="doc-main-title">${escapeHtml(note.title)}</h1>

    <main>
      ${warningBannerHtml}
      ${globalDivergencesHtml}
      ${sectionsHtml}
      ${uncapturedSectionHtml}
    </main>

    <footer class="pdf-footer">
      <div>${CLUTCH_ARENA_BRAND_NAME} · Concise Study Handout</div>
      <div>${escapeHtml(note.originalFileName)}</div>
    </footer>
  </div>
</body>
</html>`;

  return fullHtml;
}

export function exportClutchNotePdf(note: ClutchNote): void {
  if (typeof window === "undefined") return;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to open the watermarked PDF print preview.");
    return;
  }

  const html = generateClutchNotePdfHtml(note);
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
