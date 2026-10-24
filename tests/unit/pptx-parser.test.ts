import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx } from "@/lib/ingestion/parse-pptx";
import { validateSlideFile, parseSlideDeck } from "@/lib/notes/parse-slides";
import { IngestionError } from "@/lib/ingestion/errors";

describe("PowerPoint (.pptx) & Slide Parser", () => {
  it("rejects non-zip files as invalid presentation", async () => {
    const corruptBuffer = Buffer.from("NOT_A_VALID_PPTX_FILE");
    await expect(parsePptx(corruptBuffer)).rejects.toThrow(IngestionError);
  });

  it("extracts text from multiple slides in correct numerical order", async () => {
    const zip = new JSZip();

    // Slide 1 XML
    const slide1Xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:txBody>
          <a:p>
            <a:r><a:t>Lecture 5: Equity Valuation</a:t></a:r>
          </a:p>
          <a:p>
            <a:r><a:t>Corporate Finance FIN301</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    // Slide 2 XML with math text
    const slide2Xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <p:txBody>
          <a:p>
            <a:r><a:t>Gordon Constant Growth Formula:</a:t></a:r>
          </a:p>
          <a:p>
            <m:oMath>
              <m:r><m:t>P_0 = D_1 / (r - g)</m:t></m:r>
            </m:oMath>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    // Add in reverse to test numerical sorting
    zip.file("ppt/slides/slide2.xml", slide2Xml);
    zip.file("ppt/slides/slide1.xml", slide1Xml);

    const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await parsePptx(pptxBuffer);

    expect(result.pageCount).toBe(2);
    expect(result.sources.length).toBe(2);

    // Verify slide 1 comes first
    expect(result.sources[0].label).toBe("Slide 1");
    expect(result.sources[0].text).toContain("Lecture 5: Equity Valuation");

    // Verify slide 2 contains formula
    expect(result.sources[1].label).toBe("Slide 2");
    expect(result.sources[1].text).toContain("Gordon Constant Growth Formula");
    expect(result.sources[1].text).toContain("P_0 = D_1 / (r - g)");
  });

  it("extracts speaker notes when present in presentation", async () => {
    const zip = new JSZip();

    const slide1Xml = `<p:sp><p:txBody><a:p><a:r><a:t>Main Concept Slide</a:t></a:r></a:p></p:txBody></p:sp>`;
    const notes1Xml = `<p:sp><p:txBody><a:p><a:r><a:t>Make sure students remember that g must be less than r!</a:t></a:r></a:p></p:txBody></p:sp>`;

    zip.file("ppt/slides/slide1.xml", slide1Xml);
    zip.file("ppt/notesSlides/notesSlide1.xml", notes1Xml);

    const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await parsePptx(pptxBuffer);

    expect(result.sources[0].text).toContain("Main Concept Slide");
    expect(result.sources[0].text).toContain("[Notes: Make sure students remember that g must be less than r!]");
  });

  it("validates file size and format in validateSlideFile", () => {
    const validPdf = new File(["dummy pdf content"], "deck.pdf", { type: "application/pdf" });
    expect(validateSlideFile(validPdf)).toBe("pdf");

    const validPptx = new File(["dummy pptx content"], "deck.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(validateSlideFile(validPptx)).toBe("pptx");

    const invalidDoc = new File(["dummy docx content"], "notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(() => validateSlideFile(invalidDoc)).toThrow(IngestionError);

    // Test file size exceeding 25MB
    const oversized = new File(["a".repeat(26 * 1024 * 1024)], "huge.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(() => validateSlideFile(oversized)).toThrow(IngestionError);
  });
});
