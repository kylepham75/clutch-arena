import { describe, it, expect } from "vitest";
import { parseDocument } from "@/lib/ingestion/parse-document";
import { parseTxt } from "@/lib/ingestion/parse-txt";
import {
  validateDocxArchive,
  validatePptxArchive,
  validateFile,
} from "@/lib/ingestion/validate-file";
import { makePdf, makeDocx, studyText } from "../helpers/documents";

const signal = () => new AbortController().signal;
describe("real document parsers", () => {
  it("preserves UTF-8 Vietnamese and TXT line references", async () => {
    const text =
      "Chương 4: Độ co giãn của cầu. Độ co giãn đo lường mức độ phản ứng của lượng cầu với giá.";
    const result = await parseDocument(new File([text], "notes.TXT"), signal());
    expect(result.sources[0]).toEqual({
      id: "lines-1-1",
      label: "Lines 1–1",
      text,
    });
    expect(result.pageCount).toBeNull();
  });
  it("parses actual DOCX bytes with paragraph rather than fabricated page references", async () => {
    const result = await parseDocument(
      new File([new Uint8Array(await makeDocx())], "notes.docx"),
      signal(),
    );
    expect(result.sources[0].label).toBe("Paragraph 1");
    expect(result.sources[0].text).toBe(studyText);
    expect(result.sources[1].text).toContain("Opportunity cost");
    expect(result.pageCount).toBeNull();
  });
  it("parses actual PDF pages and preserves page numbers", async () => {
    const result = await parseDocument(
      new File(
        [
          new Uint8Array(
            makePdf([
              studyText,
              "Opportunity cost is the value of the next-best alternative forgone.",
            ]),
          ),
        ],
        "notes.pdf",
      ),
      signal(),
    );
    expect(result.pageCount).toBe(2);
    expect(result.sources.map((source) => source.label)).toEqual([
      "Page 1",
      "Page 2",
    ]);
    expect(result.sources[0].text).toContain("Price elasticity");
  });
  it("reports scanned/empty PDFs as requiring OCR", async () => {
    await expect(
      parseDocument(
        new File([new Uint8Array(makePdf([""]))], "scan.pdf"),
        signal(),
      ),
    ).rejects.toMatchObject({ code: "OCR_REQUIRED" });
  });
  it("rejects over-limit PDF page counts", async () => {
    await expect(
      parseDocument(
        new File(
          [new Uint8Array(makePdf(Array(151).fill("small page")))],
          "long.pdf",
        ),
        signal(),
      ),
    ).rejects.toMatchObject({ code: "TOO_MANY_PAGES" });
  });
  it.each([
    [new File([""], "empty.txt"), "EMPTY_FILE"],
    [new File([studyText], "notes.exe"), "UNSUPPORTED_FILE"],
    [
      new File([studyText], "notes.pdf", { type: "text/plain" }),
      "FILE_TYPE_MISMATCH",
    ],
    [
      new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.txt"),
      "FILE_TOO_LARGE",
    ],
  ])("rejects invalid file metadata", (file, code) => {
    expect(() => validateFile(file as File)).toThrow(
      expect.objectContaining({ code }),
    );
  });
  it.each([
    [new File([studyText], "fake.pdf"), "INVALID_PDF"],
    [new File(["not a zip"], "fake.docx"), "INVALID_DOCX"],
    [new File(["\u0000".repeat(50)], "binary.txt"), "BINARY_TEXT_FILE"],
    [
      new File([new Uint8Array([0xff, 0xfe, 0x00])], "encoding.txt"),
      "INVALID_TEXT_ENCODING",
    ],
    [new File(["short"], "short.txt"), "INSUFFICIENT_TEXT"],
    [new File(["a".repeat(120001)], "long.txt"), "TOO_MUCH_TEXT"],
  ])("returns explicit content errors", async (file, code) => {
    await expect(parseDocument(file as File, signal())).rejects.toMatchObject({
      code,
    });
  });
  it("rejects DOCX archives advertising excessive expanded size", async () => {
    const bytes = await makeDocx();
    const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(21 * 1024 * 1024, offset + 24);
    expect(() => validateDocxArchive(bytes)).toThrow(
      expect.objectContaining({ code: "DOCUMENT_TOO_LARGE" }),
    );
  });
  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseDocument(new File([studyText], "notes.txt"), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates and parses PowerPoint (.pptx) presentations in parseDocument", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:txBody>
          <a:p><a:r><a:t>${studyText}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>`,
    );
    const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const file = new File([new Uint8Array(pptxBuffer)], "slides.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    expect(validateFile(file)).toBe("pptx");

    const result = await parseDocument(file, signal());
    expect(result.format).toBe("pptx");
    expect(result.pageCount).toBe(1);
    expect(result.sources[0].label).toBe("Slide 1");
    expect(result.sources[0].text).toContain("Price elasticity");
  });

  it("rejects PPTX archives advertising excessive expanded size", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("ppt/media/image1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(51 * 1024 * 1024, offset + 24);
    expect(() => validatePptxArchive(bytes)).toThrow(
      expect.objectContaining({ code: "DOCUMENT_TOO_LARGE", status: 413 }),
    );
  });

  it("rejects slide-delimited TXT files exceeding MAX_PDF_PAGES (150) slides with TOO_MANY_PAGES", () => {
    const slides = Array.from(
      { length: 151 },
      (_, idx) => `=== Slide ${idx + 1} ===\nSlide ${idx + 1} content about economics.`,
    ).join("\n");
    expect(() => parseTxt(Buffer.from(slides, "utf8"))).toThrow(
      expect.objectContaining({ code: "TOO_MANY_PAGES", status: 413 }),
    );
  });
});
