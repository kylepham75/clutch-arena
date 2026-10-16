import { expect, test } from "@playwright/test";
import { makeDocx, makePdf, studyText } from "../helpers/documents";

test("HTTP preview extracts a real TXT, DOCX and PDF with source labels", async ({
  request,
}) => {
  for (const file of [
    {
      name: "study.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(studyText),
      label: "Lines 1–1",
    },
    {
      name: "study.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await makeDocx(),
      label: "Paragraph 1",
    },
    {
      name: "study.pdf",
      mimeType: "application/pdf",
      buffer: makePdf(),
      label: "Page 1",
    },
  ]) {
    const response = await request.post("/api/ingest", {
      multipart: { file, options: JSON.stringify({ operation: "preview" }) },
    });
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(200);
    expect(body.document.sources[0].label).toBe(file.label);
    expect(body.document.sources[0].text).toContain("Price elasticity");
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

test("HTTP rejects malformed files and invalid generation options", async ({
  request,
}) => {
  const unsupported = await request.post("/api/ingest", {
    multipart: {
      file: {
        name: "a.exe",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(studyText),
      },
      options: '{"operation":"preview"}',
    },
  });
  expect(unsupported.status()).toBe(415);
  const corrupt = await request.post("/api/ingest", {
    multipart: {
      file: {
        name: "a.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(studyText),
      },
      options: '{"operation":"preview"}',
    },
  });
  expect(corrupt.status()).toBe(422);
  const options = await request.post("/api/ingest", {
    multipart: {
      file: {
        name: "a.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(studyText),
      },
      options: '{"operation":"preview","questionCount":500}',
    },
  });
  expect(options.status()).toBe(400);
});

test("HTTP /api/ingest/multi extracts multiple mixed files simultaneously into composite deck", async ({
  request,
}) => {
  const fileTxt = {
    name: "Lecture1_Notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(studyText),
  };
  const fileDocx = {
    name: "Lecture2_Summary.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await makeDocx(),
  };
  const filePdf = {
    name: "Lecture3_Slides.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(),
  };

  const response = await request.post("/api/ingest/multi", {
    multipart: {
      file1: fileTxt,
      file2: fileDocx,
      file3: filePdf,
      options: JSON.stringify({ operation: "preview", questionCount: 15 }),
    },
  });

  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.operation).toBe("preview");
  expect(body.documents.length).toBe(3);
  expect(body.document.sources.length).toBe(4);
  expect(body.document.format).toBe("mixed");
  expect(body.document.sources[0].label).toContain("Lecture1_Notes");
  expect(body.document.sources[1].label).toContain("Lecture2_Summary");
  expect(body.document.sources[3].label).toContain("Lecture3_Slides");
});

