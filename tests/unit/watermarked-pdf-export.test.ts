import { describe, it, expect } from "vitest";
import { generateClutchNotePdfHtml } from "@/lib/notes/export-pdf";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";

describe("Clutch Arena Watermarked PDF Export Generator", () => {
  it("generates complete HTML with repeating watermark and KaTeX stylesheet", () => {
    const html = generateClutchNotePdfHtml(SAMPLE_CLUTCH_NOTE);

    // 1. Must include KaTeX stylesheet for vector math rendering
    expect(html).toContain("katex.min.css");

    // 2. Must include official Clutch Arena branding & Pro note label
    expect(html).toContain("CLUTCH ARENA");
    expect(html).toContain("PRO NOTE");
    expect(html).toContain("Clutch Notes AI");

    // 3. Must include big centered watermark with Clutch Arena icon and name below
    expect(html).toContain("watermark-overlay");
    expect(html).toContain("watermark-center-badge");
    expect(html).toContain("watermark-big-icon");
    expect(html).toContain("watermark-name-below");
    expect(html).toContain("CLUTCH ARENA");
    expect(html).not.toContain("CLUTCH ARENA · PRO NOTES");

    // 4. Must include bilingual section headers
    expect(html).toContain("NGUYÊN LÝ CƠ BẢN");
    expect(html).toContain("CÔNG THỨC TỔNG QUÁT");

    // 5. Must include LaTeX rendered formulas and "Trong đó:" variable block
    expect(html).toContain("pdf-formula-card");
    expect(html).toContain("Trong đó (Where):");
    expect(html).toContain("pdf-variable-list");

    // 6. Must include Key Takeaways callout box with boundary condition warning
    expect(html).toContain("pdf-takeaways-card");
    expect(html).toContain("pdf-pitfall-alert");
    expect(html).toContain("CRITICAL MATHEMATICAL PITFALL");
    expect(html).toContain("katex");

    // 7. Must include print CSS rules with page-break-inside avoid
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-inside: avoid");
  });
});
