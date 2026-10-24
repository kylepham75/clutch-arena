import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  extractSlidesInBrowser,
  ClientSlideExtractionError,
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
});
