import { escapeHtml, renderKatexSafe } from "@/lib/math/latex";
import { CLUTCH_ARENA_ICON_DATA_URL, CLUTCH_ARENA_BRAND_NAME } from "@/lib/notes/brand-assets";
import type { ClutchNote, NoteSection } from "@/lib/schemas/notes";

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

export function generateClutchNotePdfHtml(note: ClutchNote): string {
  const sectionsHtml = note.sections
    .map((section: NoteSection) => {
      const bulletListHtml =
        section.bulletPoints && section.bulletPoints.length > 0
          ? `<ul class="pdf-bullets">
              ${section.bulletPoints
                .map((bp) => `<li>${formatTextWithMath(bp)}</li>`)
                .join("")}
            </ul>`
          : "";

      const formulasHtml =
        section.formulas && section.formulas.length > 0
          ? section.formulas
              .map((formula) => {
                const mathHtml = renderKatexSafe(formula.latex, true);
                const variablesHtml =
                  formula.variables && formula.variables.length > 0
                    ? `<div class="pdf-formula-variables">
                        <div class="pdf-where-label">Trong đó (Where):</div>
                        <ul class="pdf-variable-list">
                          ${formula.variables
                            .map(
                              (v) =>
                                `<li><strong>${renderKatexSafe(v.symbol, false)}</strong>: ${escapeHtml(v.definition)}</li>`,
                            )
                            .join("")}
                        </ul>
                      </div>`
                    : "";

                return `
                  <div class="pdf-formula-card">
                    <div class="pdf-formula-name">📐 ${escapeHtml(formula.name)}</div>
                    <div class="pdf-formula-render">${mathHtml}</div>
                    ${formula.description ? `<p class="pdf-formula-desc">${escapeHtml(formula.description)}</p>` : ""}
                    ${variablesHtml}
                  </div>
                `;
              })
              .join("")
          : "";

      const takeawaysHtml = section.keyTakeaways
        ? `
          <div class="pdf-takeaways-card">
            <div class="pdf-takeaways-header">
              <span class="pdf-takeaways-badge">PRO SYNTHESIS</span>
              <h3>🌟 ${escapeHtml(section.keyTakeaways.title)}</h3>
            </div>
            ${
              section.keyTakeaways.modelSelectionRule
                ? `<div class="pdf-takeaways-point">
                    <strong>1. Model Selection (Cách chọn mô hình):</strong>
                    ${formatTextWithMath(section.keyTakeaways.modelSelectionRule)}
                  </div>`
                : ""
            }
            ${
              section.keyTakeaways.realWorldConditions
                ? `<div class="pdf-takeaways-point">
                    <strong>2. Real-World Conditions (Điều kiện áp dụng thực tế):</strong>
                    ${formatTextWithMath(section.keyTakeaways.realWorldConditions)}
                  </div>`
                : ""
            }
            ${
              section.keyTakeaways.boundaryConditions
                ? `<div class="pdf-takeaways-point pdf-pitfall-alert">
                    <strong>3. Mathematical Boundary & Pitfalls (Giới hạn toán học & Bẫy thi cử):</strong>
                    ${formatTextWithMath(section.keyTakeaways.boundaryConditions)}
                  </div>`
                : ""
            }
            <ul class="pdf-takeaways-bullets">
              ${section.keyTakeaways.summaryPoints
                .map((sp) => `<li>${formatTextWithMath(sp)}</li>`)
                .join("")}
            </ul>
          </div>
        `
        : "";

      return `
        <section class="pdf-section-block">
          <div class="pdf-section-header">
            <span class="pdf-section-letter">${escapeHtml(section.letter)}</span>
            <div class="pdf-section-title-wrap">
              <h2 class="pdf-section-title-vi">${escapeHtml(section.titleVi)}</h2>
              <span class="pdf-section-title-en">${escapeHtml(section.titleEn)}</span>
            </div>
          </div>
          <div class="pdf-section-overview">
            ${formatTextWithMath(section.overview)}
          </div>
          ${bulletListHtml}
          ${formulasHtml}
          ${takeawaysHtml}
        </section>
      `;
    })
    .join("");

  const parsedDate = new Date(note.createdAt);
  const isValidDate = !isNaN(parsedDate.getTime()) && parsedDate.getFullYear() >= 2024;
  const noteDate = isValidDate ? parsedDate : new Date();
  const generatedDate = noteDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const displayNoiseRate =
    note.noiseReductionRate > 0 && note.noiseReductionRate <= 1
      ? Math.round(note.noiseReductionRate * 100)
      : Math.round(note.noiseReductionRate || 85);

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(note.title)} — Clutch Notes AI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
  <style>
    @page {
      size: A4;
      margin: 14mm 12mm 16mm 12mm;
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
      .pdf-section-block {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pdf-formula-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pdf-takeaways-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .watermark-overlay {
        display: flex !important;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.55;
      color: #1c231c;
      background: #fdfdfc;
      margin: 0;
      padding: 0;
    }

    /* Fixed watermark overlay: Big Clutch Arena icon with name below in the middle of the page */
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
      opacity: 0.065;
      user-select: none;
      pointer-events: none;
    }

    .watermark-big-icon {
      width: 250px;
      height: 250px;
      object-fit: contain;
    }

    .watermark-name-below {
      font-size: 38px;
      font-weight: 900;
      letter-spacing: 8px;
      color: #1a2717;
      text-transform: uppercase;
      margin-top: 16px;
      white-space: nowrap;
    }

    .brand-header-icon {
      width: 22px;
      height: 22px;
      object-fit: contain;
    }

    /* Screen top toolbar */
    .screen-toolbar {
      position: sticky;
      top: 0;
      z-index: 999;
      background: #141913;
      color: #ffffff;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
    }
    .screen-toolbar-title {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .screen-pro-badge {
      background: #e96b44;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .screen-toolbar-actions {
      display: flex;
      gap: 12px;
    }
    .btn-action {
      background: #e96b44;
      color: #ffffff;
      border: none;
      padding: 7px 18px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-action:hover {
      background: #d95e37;
    }
    .btn-secondary {
      background: #273125;
      color: #e5e7eb;
    }
    .btn-secondary:hover {
      background: #374435;
    }

    /* Main Container */
    .sheet-wrapper {
      max-width: 820px;
      margin: 24px auto 48px auto;
      background: #ffffff;
      border: 1px solid #e3e8e2;
      border-radius: 8px;
      padding: 36px 42px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.06);
      position: relative;
    }

    /* Official Clutch Header */
    .pdf-meta-header {
      border-bottom: 2px solid #1c2a1a;
      padding-bottom: 18px;
      margin-bottom: 24px;
      position: relative;
    }
    .brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .brand-logo-text {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 1px;
      color: #1a2a18;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-pill {
      background: #fbede5;
      color: #d9532f;
      font-size: 10px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 4px;
    }
    .deck-stats-pill {
      font-size: 11px;
      background: #fdfaf5;
      color: #c2512a;
      border: 1px solid #fbd8c8;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 999px;
    }
    .doc-main-title {
      font-size: 24px;
      font-weight: 800;
      color: #10190f;
      margin: 0 0 6px 0;
      line-height: 1.25;
    }
    .doc-sub-info {
      font-size: 12px;
      color: #52634f;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }

    /* Executive summary callout */
    .exec-summary-box {
      background: #fdfaf5;
      border-left: 4px solid #e96b44;
      padding: 12px 16px;
      margin-bottom: 28px;
      border-radius: 0 6px 6px 0;
      font-size: 12.5px;
      color: #384131;
      line-height: 1.5;
    }
    .exec-summary-box strong {
      color: #c2512a;
    }

    /* Section styling */
    .pdf-section-block {
      margin-bottom: 32px;
    }
    .pdf-section-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      border-bottom: 1.5px solid #d7e0d5;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .pdf-section-letter {
      background: #fbede5;
      color: #d9532f;
      font-weight: 900;
      font-size: 14px;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .pdf-section-title-vi {
      font-size: 16px;
      font-weight: 800;
      color: #172415;
      margin: 0;
      display: inline;
    }
    .pdf-section-title-en {
      font-size: 13px;
      font-weight: 600;
      color: #4b6348;
      margin-left: 8px;
    }
    .pdf-section-overview {
      font-size: 13px;
      color: #263323;
      margin-bottom: 10px;
    }
    .pdf-bullets {
      margin: 8px 0 16px 20px;
      padding: 0;
    }
    .pdf-bullets li {
      font-size: 12.5px;
      color: #243021;
      margin-bottom: 5px;
    }

    /* Formula Cards */
    .pdf-formula-card {
      background: #f9fbf9;
      border: 1px solid #dce4da;
      border-radius: 6px;
      padding: 14px 18px;
      margin: 14px 0;
    }
    .pdf-formula-name {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #1c451b;
      margin-bottom: 6px;
    }
    .pdf-formula-render {
      font-size: 17px;
      text-align: center;
      margin: 10px 0 12px 0;
      color: #0c1a0a;
      overflow-x: auto;
    }
    .pdf-formula-desc {
      font-size: 11px;
      font-style: italic;
      color: #556752;
      margin: 0 0 10px 0;
    }
    .pdf-formula-variables {
      background: #ffffff;
      border: 1px dashed #cfdad0;
      border-radius: 4px;
      padding: 8px 12px;
    }
    .pdf-where-label {
      font-size: 11px;
      font-weight: 700;
      color: #1b4d1b;
      margin-bottom: 4px;
    }
    .pdf-variable-list {
      margin: 0;
      padding-left: 18px;
      font-size: 11.5px;
      color: #2b3927;
    }
    .pdf-variable-list li {
      margin-bottom: 3px;
    }

    /* Key Takeaways Card */
    .pdf-takeaways-card {
      background: #fffbf6;
      border: 1.5px solid #f3aa84;
      border-radius: 8px;
      padding: 16px 20px;
      margin-top: 18px;
      box-shadow: 0 2px 8px rgba(233, 107, 68, 0.08);
    }
    .pdf-takeaways-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      border-bottom: 1px solid #fcdccb;
      padding-bottom: 6px;
    }
    .pdf-takeaways-badge {
      background: #e96b44;
      color: #ffffff;
      font-size: 9.5px;
      font-weight: 900;
      padding: 2px 6px;
      border-radius: 3px;
      letter-spacing: 0.5px;
    }
    .pdf-takeaways-header h3 {
      font-size: 13.5px;
      font-weight: 800;
      color: #963714;
      margin: 0;
    }
    .pdf-takeaways-point {
      font-size: 12px;
      color: #1e3a1e;
      margin-bottom: 8px;
      line-height: 1.45;
    }
    .pdf-pitfall-alert {
      background: #fef2f2;
      border-left: 3px solid #ef4444;
      padding: 6px 10px;
      border-radius: 0 4px 4px 0;
      color: #991b1b;
      font-weight: 500;
    }
    .pdf-takeaways-bullets {
      margin: 8px 0 0 18px;
      padding: 0;
      font-size: 11.5px;
      color: #254023;
    }
    .pdf-takeaways-bullets li {
      margin-bottom: 4px;
    }

    /* Official Footer */
    .pdf-footer {
      border-top: 1px solid #d5ded3;
      padding-top: 14px;
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #637760;
    }
  </style>
</head>
<body>
  <div class="screen-toolbar no-print">
    <div class="screen-toolbar-title">
      <span>Clutch Notes AI — Watermarked Revision Sheet</span>
      <span class="screen-pro-badge">PRO TIER</span>
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
    <header class="pdf-meta-header">
      <div class="brand-row">
        <div class="brand-logo-text">
          <img src="${CLUTCH_ARENA_ICON_DATA_URL}" class="brand-header-icon" alt="Clutch Arena" />
          <span>${CLUTCH_ARENA_BRAND_NAME}</span>
          <span class="brand-pill">PRO NOTE</span>
        </div>
        <div class="deck-stats-pill">
          ${note.originalSlideCount} Slides Distilled → ${note.estimatedDistilledPages} Pages · ${displayNoiseRate}% Noise Stripped
        </div>
      </div>
      <h1 class="doc-main-title">${escapeHtml(note.title)}</h1>
      <div class="doc-sub-info">
        <span><strong>Subject:</strong> ${escapeHtml(note.subject)}</span>
        <span><strong>Deck:</strong> ${escapeHtml(note.originalFileName)}</span>
        <span><strong>Generated:</strong> ${escapeHtml(generatedDate)}</span>
        <span><strong>Note ID:</strong> ${escapeHtml(note.id)}</span>
      </div>
    </header>

    <div class="exec-summary-box">
      <strong>Executive Summary:</strong> ${formatTextWithMath(escapeHtml(note.executiveSummary))}
    </div>

    <main>
      ${sectionsHtml}
    </main>

    <footer class="pdf-footer">
      <div>Clutch Arena Academic Synthesis Engine · Bilingual Revision Sheet (EN/VI)</div>
      <div>Strictly for Student Personal Exam Preparation · Licensed Pro User</div>
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
