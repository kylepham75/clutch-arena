import { escapeHtml, renderKatexSafe } from "@/lib/math/latex";
import { CLUTCH_ARENA_ICON_DATA_URL, CLUTCH_ARENA_BRAND_NAME } from "@/lib/notes/brand-assets";
import type { ClutchNote, NoteFormula, NoteSection } from "@/lib/schemas/notes";

/**
 * Formats inline or display text containing math delimiters ($...$ or $$...$$) into KaTeX HTML.
 * Escapes plain text segments to prevent XSS while feeding unescaped LaTeX directly to KaTeX.
 */
function formatTextWithMath(text: string): string {
  if (!text) return "";

  const parts: string[] = [];
  const regex = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith("$$")) {
      const math = token.slice(2, -2).trim();
      parts.push(`<div class="pdf-display-math">${renderKatexSafe(math, true)}</div>`);
    } else {
      const math = token.slice(1, -1).trim();
      parts.push(`<span class="pdf-inline-math">${renderKatexSafe(math, false)}</span>`);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  return parts.join("");
}

function renderFormulaHtml(formula: NoteFormula): string {
  const mathHtml = renderKatexSafe(formula.latex, true);

  const leadHtml = formula.leadText
    ? `<p class="pdf-formula-lead">${formatTextWithMath(formula.leadText)}</p>`
    : formula.name
      ? `<div class="pdf-formula-name">${formatTextWithMath(formula.name)}</div>`
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

  return `
    <div class="pdf-formula-block">
      ${leadHtml}
      <div class="pdf-formula-row">
        <div class="pdf-formula-card">${mathHtml}</div>
      </div>
      ${variablesHtml}
      ${descHtml}
    </div>
  `;
}

function renderBulletListHtml(items?: string[]): string {
  if (!items || items.length === 0) return "";
  return `<ul class="pdf-bullets">
    ${items.map((bp) => `<li>${formatTextWithMath(bp)}</li>`).join("")}
  </ul>`;
}

export function generateClutchNotePdfHtml(note: ClutchNote): string {
  const sectionsHtml = note.sections
    .map((section: NoteSection) => {
      const coreStatementHtml = section.coreStatement
        ? `<p class="pdf-core-statement">${formatTextWithMath(section.coreStatement)}</p>`
        : "";

      const overviewHtml = section.overview
        ? `<p class="pdf-section-overview">${formatTextWithMath(section.overview)}</p>`
        : "";

      const bulletListHtml = renderBulletListHtml(section.bulletPoints);
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
                const subBulletsHtml = renderBulletListHtml(sub.bulletPoints);
                const subFormulasHtml = (sub.formulas ?? []).map(renderFormulaHtml).join("");
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
              const subHtml =
                item.subBullets && item.subBullets.length > 0
                  ? `<ul class="pdf-takeaways-subbullets">
                      ${item.subBullets.map((sb) => `<li>${formatTextWithMath(sb)}</li>`).join("")}
                    </ul>`
                  : "";
              return `<li>${formatTextWithMath(item.point)}${subHtml}</li>`;
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
          <h2 class="pdf-section-title-vi">${escapeHtml(section.titleVi)}</h2>
          ${coreStatementHtml}
          ${overviewHtml}
          ${mainBodyHtml}
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
      .pdf-takeaways-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pdf-section-title-vi,
      .pdf-sub-heading {
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

    h1, h2, h3, .doc-main-title, .pdf-section-title-vi, .pdf-sub-heading {
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

    .pdf-section-title-vi {
      font-size: 14.5px;
      font-weight: 700;
      color: #991b1b;
      margin: 16px 0 8px 0;
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
      ${sectionsHtml}
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
