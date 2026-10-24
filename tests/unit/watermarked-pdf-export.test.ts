import { describe, it, expect } from "vitest";
import { generateClutchNotePdfHtml } from "@/lib/notes/export-pdf";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";

describe("Clutch Arena Watermarked PDF Export Generator", () => {
  it("generates concise study handout HTML with watermark, boxed equations, subSections, and KaTeX", () => {
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

    // 4. Must include concise section headers & sub-case headings
    expect(html).toContain("CHAPTER 9: STOCK VALUATION");
    expect(html).toContain("NGUYÊN LÝ CƠ BẢN");
    expect(html).toContain("CÔNG THỨC TỔNG QUÁT");
    expect(html).toContain("CASE 1: Zero Growth Model");
    expect(html).toContain("CASE 2: Constant Growth Model");
    expect(html).toContain("VALUE OF PREFERENCE SHARE");

    // 5. Must include LaTeX rendered boxed formulas and "Trong đó:" variable block
    expect(html).toContain("pdf-formula-card");
    expect(html).toContain("Trong đó:");
    expect(html).toContain("pdf-variable-list");

    // 6. Must include crisp bordered Key Takeaways box with structured sub-bullets
    expect(html).toContain("pdf-takeaways-card");
    expect(html).toContain("KEY TAKEAWAYS");
    expect(html).toContain("Constant growth → Gordon model");
    expect(html).toContain("otherwise the model breaks down");
    expect(html).toContain("katex");

    // 7. Must include print CSS rules with page-break-inside avoid
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-inside: avoid");
  });
});
