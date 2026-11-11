import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import {
  extractSlidesInBrowser,
  ClientSlideExtractionError,
  sortAndGroupPdfTextItems,
  normalizePdfMathSymbols,
  normalizePdfArrowSymbols,
} from "@/lib/notes/client-extract-slides";
import { makePdf, studyText } from "../helpers/documents";

const signal = () => new AbortController().signal;

async function makeTestPptx(
  slides: Array<{ num: number; xmlText: string; notesText?: string }>,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const slide of slides) {
    zip.file(
      `ppt/slides/slide${slide.num}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:bodyPr/>
          ${slide.xmlText}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`,
    );

    if (slide.notesText) {
      zip.file(
        `ppt/notesSlides/notesSlide${slide.num}.xml`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:t>${slide.notesText}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`,
      );
    }
  }

  return zip.generateAsync({ type: "arraybuffer" });
}

function makeCustomStreamPdf(streams: string[]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${streams.length} /Kids [${streams.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const stream of streams) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

function makePuaPdf(): Buffer {
  const toUnicode = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /CustomDef def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
12 beginbfchar
<41> <F0B4>
<42> <F0B8>
<43> <F0E5>
<44> <F0D6>
<45> <F0E0>
<46> <F05B>
<47> <F05D>
<48> <F0B1>
<49> <F02D>
<4A> <F0A3>
<4B> <F0B3>
<4C> <F0BB>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

  const stream = "BT /F1 12 Tf 50 750 Td (A B C D E F G H I J K L) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [4 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Length ${Buffer.byteLength(toUnicode)} >>\nstream\n${toUnicode}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

describe("client-extract-slides", () => {
  describe("file metadata & constraints validation", () => {
    it("rejects unsupported file extensions", async () => {
      const file = new File(["some text content"], "lecture.docx");
      await expect(extractSlidesInBrowser(file, signal())).rejects.toThrow(
        ClientSlideExtractionError,
      );
      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "UNSUPPORTED_FILE_TYPE",
          isUserActionable: true,
        },
      );
    });

    it("rejects files exceeding MAX_FILE_BYTES (25MB)", async () => {
      const file = new File(
        [new Uint8Array(25 * 1024 * 1024 + 1)],
        "huge-deck.pdf",
      );
      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "FILE_TOO_LARGE",
          isUserActionable: true,
        },
      );
    });

    it("honors cancellation via AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();
      const file = new File(
        [new Uint8Array(makePdf([studyText]))],
        "slides.pdf",
      );
      await expect(
        extractSlidesInBrowser(file, controller.signal),
      ).rejects.toMatchObject({
        name: "AbortError",
      });
    });
  });

  describe("PDF slide extraction", () => {
    it("extracts multi-page PDF documents into slide blocks", async () => {
      const pdfBytes = makePdf([
        "Slide 1: Introduction to Macroeconomics.",
        "Slide 2: Aggregate demand and aggregate supply curves.",
      ]);
      const file = new File([new Uint8Array(pdfBytes)], "lecture.pdf");

      const result = await extractSlidesInBrowser(file, signal());

      expect(result.fileName).toBe("lecture.pdf");
      expect(result.slideCount).toBe(2);
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0]).toEqual({
        id: "slide-1",
        label: "Slide 1",
        text: "Slide 1: Introduction to Macroeconomics.",
      });
      expect(result.sources[1]).toEqual({
        id: "slide-2",
        label: "Slide 2",
        text: "Slide 2: Aggregate demand and aggregate supply curves.",
      });
      expect(result.warnings).toEqual([]);
    });

    it("throws OCR_REQUIRED when PDF has no extractable text", async () => {
      const pdfBytes = makePdf([""]);
      const file = new File([new Uint8Array(pdfBytes)], "scanned-scan.pdf");

      await expect(extractSlidesInBrowser(file, signal())).rejects.toThrow(
        ClientSlideExtractionError,
      );
      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "OCR_REQUIRED",
          isUserActionable: true,
        },
      );
    });

    it("throws INVALID_FILE for invalid PDF header", async () => {
      const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "corrupt.pdf");

      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "INVALID_FILE",
          isUserActionable: true,
        },
      );
    });

    it("throws TOO_MANY_PAGES when PDF exceeds 150 pages", async () => {
      const pages = Array(151).fill("Small slide text");
      const pdfBytes = makePdf(pages);
      const file = new File([new Uint8Array(pdfBytes)], "massive-deck.pdf");

      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "TOO_MANY_PAGES",
          isUserActionable: true,
        },
      );
    });

    it("records warnings when some pages are empty or image-only", async () => {
      const pdfBytes = makePdf(["Valid slide text", "", "Another valid slide"]);
      const file = new File([new Uint8Array(pdfBytes)], "mixed-deck.pdf");

      const result = await extractSlidesInBrowser(file, signal());
      expect(result.slideCount).toBe(3);
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].label).toBe("Slide 1");
      expect(result.sources[1].label).toBe("Slide 3");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("1 slide(s) had no extractable text");
    });

    it("sorts out-of-order content streams into visual top-to-bottom reading order", async () => {
      // Content stream emitted in bottom-to-top order
      const stream = [
        "BT /F1 12 Tf 50 620 Td (Second line of slide text) Tj ET",
        "BT /F1 14 Tf 50 720 Td (First line of slide text) Tj ET",
      ].join("\n");
      const pdfBytes = makeCustomStreamPdf([stream]);
      const file = new File([new Uint8Array(pdfBytes)], "reorder.pdf");

      const result = await extractSlidesInBrowser(file, signal());
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].text).toBe(
        "First line of slide text\nSecond line of slide text",
      );
    });

    it("keeps baseline-shifted subscripts and operators on a single line during PDF extraction", async () => {
      // y = 500 for R, y = 495 for t+1, y = 500 for = 0.12
      const stream = [
        "BT /F1 12 Tf 50 500 Td (R) Tj ET",
        "BT /F1 9 Tf 61 495 Td (t+1) Tj ET",
        "BT /F1 12 Tf 85 500 Td (= 0.12) Tj ET",
      ].join("\n");
      const pdfBytes = makeCustomStreamPdf([stream]);
      const file = new File([new Uint8Array(pdfBytes)], "equation.pdf");

      const result = await extractSlidesInBrowser(file, signal());
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].text).not.toContain("\n");
      expect(result.sources[0].text).toMatch(/R\s*t\+1\s*=\s*0\.12/);
    });

    it("normalizes Symbol and MT Extra PUA math characters and arrows during PDF extraction", async () => {
      const pdfBytes = makePuaPdf();
      const file = new File([new Uint8Array(pdfBytes)], "pua.pdf");

      const result = await extractSlidesInBrowser(file, signal());
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].text).toBe("× ÷ ∑ √ → [ ] ± − ≤ ≥ ≈");
    });
  });

  describe("PPTX slide extraction", () => {
    it("extracts multi-slide out-of-order XML, math markup, and speaker notes", async () => {
      // Intentionally insert slide 2 before slide 1 into the ZIP
      const pptxBytes = await makeTestPptx([
        {
          num: 2,
          xmlText:
            "<a:p><a:r><a:t>Slide Two: Newton&apos;s Third Law</a:t></a:r></a:p>",
        },
        {
          num: 1,
          xmlText:
            "<a:p><a:r><a:t>Slide One: Newton&apos;s Second Law</a:t></a:r></a:p><a:p><m:t>F = m * a</m:t></a:p>",
          notesText: "Remember to explain acceleration units clearly to students",
        },
      ]);

      const file = new File([pptxBytes], "physics.pptx");
      const result = await extractSlidesInBrowser(file, signal());

      expect(result.fileName).toBe("physics.pptx");
      expect(result.slideCount).toBe(2);
      expect(result.sources).toHaveLength(2);

      // Verify slides were sorted numerically despite out-of-order zip entries
      expect(result.sources[0].id).toBe("slide-1");
      expect(result.sources[0].label).toBe("Slide 1");
      expect(result.sources[0].text).toContain("Slide One: Newton's Second Law");
      expect(result.sources[0].text).toContain("F = m * a");
      expect(result.sources[0].text).toContain(
        "[Notes: Remember to explain acceleration units clearly to students]",
      );

      expect(result.sources[1].id).toBe("slide-2");
      expect(result.sources[1].label).toBe("Slide 2");
      expect(result.sources[1].text).toBe("Slide Two: Newton's Third Law");
      expect(result.warnings).toEqual([]);
    });

    it("throws OCR_REQUIRED for empty or image-only PPTX", async () => {
      const zip = new JSZip();
      // Slide contains only empty shape tree with no text
      zip.file(
        "ppt/slides/slide1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:pic>image.png</p:pic></p:spTree></p:cSld>
</p:sld>`,
      );
      const pptxBytes = await zip.generateAsync({ type: "arraybuffer" });
      const file = new File([pptxBytes], "images-only.pptx");

      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "OCR_REQUIRED",
          isUserActionable: true,
        },
      );
    });

    it("throws INVALID_FILE for corrupted PPTX / non-zip file", async () => {
      const file = new File([new Uint8Array([0x01, 0x02, 0x03, 0x04])], "broken.pptx");

      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "INVALID_FILE",
          isUserActionable: true,
        },
      );
    });

    it("records warnings when some PPTX slides are empty", async () => {
      const zip = new JSZip();
      zip.file(
        "ppt/slides/slide1.xml",
        `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>Content on slide 1</a:t></a:p></p:sld>`,
      );
      zip.file(
        "ppt/slides/slide2.xml",
        `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>   </a:t></a:p></p:sld>`,
      );
      const pptxBytes = await zip.generateAsync({ type: "arraybuffer" });
      const file = new File([pptxBytes], "mixed.pptx");

      const result = await extractSlidesInBrowser(file, signal());
      expect(result.slideCount).toBe(2);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].label).toBe("Slide 1");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        "1 slide(s) contained only images or had no extractable text",
      );
    });

    it("throws TOO_MUCH_TEXT when text exceeds MAX_EXTRACTED_CHARACTERS", async () => {
      const largeText = "A".repeat(125_000);
      const pptxBytes = await makeTestPptx([
        {
          num: 1,
          xmlText: `<a:p><a:r><a:t>${largeText}</a:t></a:r></a:p>`,
        },
      ]);
      const file = new File([pptxBytes], "giant.pptx");

      await expect(extractSlidesInBrowser(file, signal())).rejects.toMatchObject(
        {
          code: "TOO_MUCH_TEXT",
          isUserActionable: true,
        },
      );
    });
  });

  describe("sortAndGroupPdfTextItems unit tests", () => {
    it("sorts out-of-order items on the same line into left-to-right order", () => {
      const items = [
        { str: "World!", transform: [12, 0, 0, 12, 100, 500], width: 40 },
        { str: "Hello", transform: [12, 0, 0, 12, 50, 500], width: 35 },
      ];
      expect(sortAndGroupPdfTextItems(items)).toBe("Hello World!");
    });

    it("sorts out-of-order items across multiple lines into top-to-bottom reading order", () => {
      const items = [
        { str: "Bottom line content", transform: [12, 0, 0, 12, 50, 400], width: 120 },
        { str: "Top line header", transform: [14, 0, 0, 14, 50, 700], width: 100 },
        { str: "Middle line paragraph", transform: [12, 0, 0, 12, 50, 550], width: 110 },
      ];
      expect(sortAndGroupPdfTextItems(items)).toBe(
        "Top line header\nMiddle line paragraph\nBottom line content",
      );
    });

    it("sorts out-of-order items both across lines and within the same line", () => {
      const items = [
        { str: "Col2", transform: [12, 0, 0, 12, 200, 500], width: 30 },
        { str: "Line1", transform: [12, 0, 0, 12, 50, 700], width: 30 },
        { str: "Col1", transform: [12, 0, 0, 12, 50, 500], width: 30 },
        { str: "Title", transform: [12, 0, 0, 12, 90, 700], width: 30 },
      ];
      expect(sortAndGroupPdfTextItems(items)).toBe("Line1 Title\nCol1 Col2");
    });

    it("groups inline subscripts with baseline shift (e.g. y=500 for R, y=495 for t+1, y=500 for = 0.12) onto a single line", () => {
      // Items provided in scrambled order
      const items = [
        { str: "= 0.12", transform: [12, 0, 0, 12, 85, 500], width: 35 },
        { str: "R", transform: [12, 0, 0, 12, 50, 500], width: 10 },
        { str: "t+1", transform: [9, 0, 0, 9, 61, 495], width: 18 },
      ];
      const result = sortAndGroupPdfTextItems(items);
      expect(result).toBe("Rt+1 = 0.12");
      expect(result).not.toContain("\n");
    });

    it("groups inline superscripts with baseline shift (e.g. y=500 for (1 + r), y=506 for t) onto a single line", () => {
      const items = [
        { str: "- 1", transform: [12, 0, 0, 12, 105, 500], width: 20 },
        { str: "(1 + r)", transform: [12, 0, 0, 12, 50, 500], width: 40 },
        { str: "t", transform: [8, 0, 0, 8, 92, 506], width: 5 },
      ];
      const result = sortAndGroupPdfTextItems(items);
      expect(result).toBe("(1 + r)t - 1");
      expect(result).not.toContain("\n");
    });

    it("normalizes Symbol, MT Extra PUA math codepoints, delimiters, and arrows", () => {
      const items = [
        {
          str: "\uF05B \uF0B4 \uF0B8 \uF0E5 \uF0D6 \uF05D \uF0B1 \uF02D \uF0A3 \uF0B3 \uF0BB \uF0E0 \uF0DF \uF0E1 \uF0E2 \uF0DC",
          transform: [12, 0, 0, 12, 50, 500],
          width: 200,
        },
      ];
      expect(sortAndGroupPdfTextItems(items)).toBe("[ × ÷ ∑ √ ] ± − ≤ ≥ ≈ → ← ↑ ↓ ⇒");
    });

    it("falls back gracefully to stream order when transforms are missing or all zero", () => {
      const items = [
        { str: "Zero transform item 1 " },
        { str: "Item 2", hasEOL: true },
        { str: "Item 3", transform: [0, 0, 0, 0, 0, 0] },
      ];
      expect(sortAndGroupPdfTextItems(items)).toBe("Zero transform item 1 Item 2\nItem 3");
    });

    it("returns empty string for empty items array", () => {
      expect(sortAndGroupPdfTextItems([])).toBe("");
    });
  });
});
