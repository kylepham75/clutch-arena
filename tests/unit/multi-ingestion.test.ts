import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { parseMultiDocuments } from "@/lib/ingestion/parse-multi-documents";
import { readMultiUpload } from "@/lib/ingestion/read-multi-upload";
import { createMultiIngestionHandler } from "@/lib/ingestion/multi-handler";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { GenerationResult } from "@/lib/schemas/ingestion";
import { studyText } from "../helpers/documents";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const mockResult: GenerationResult = {
  pack: mockMicroeconomics,
  sourceKind: "lecture",
  references: {},
  warnings: [],
  usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
};

describe("multi-document parsing", () => {
  it("rejects 0 files", async () => {
    const controller = new AbortController();
    await expect(parseMultiDocuments([], controller.signal)).rejects.toThrow(
      "Upload at least one file.",
    );
  });

  it("rejects more than 10 files", async () => {
    const controller = new AbortController();
    const files = Array.from(
      { length: 11 },
      (_, i) => new File([studyText], `doc${i}.txt`, { type: "text/plain" }),
    );
    await expect(parseMultiDocuments(files, controller.signal)).rejects.toThrow(
      "You can upload up to 10 files at once",
    );
  });

  it("combines multiple text files into a single composite document with attributed source labels", async () => {
    const controller = new AbortController();
    const file1 = new File(
      [studyText],
      "Economics_Lecture1.txt",
      { type: "text/plain" },
    );
    const file2 = new File(
      ["Monopoly is characterized by a single seller and very high barriers to entry in the target market."],
      "Economics_Lecture2.txt",
      { type: "text/plain" },
    );

    const { compositeDocument, documents } = await parseMultiDocuments([file1, file2], controller.signal);

    expect(documents.length).toBe(2);
    expect(compositeDocument.format).toBe("txt");
    expect(compositeDocument.fileName).toContain("2 files");
    expect(compositeDocument.sources.length).toBe(2);

    expect(compositeDocument.sources[0].id).toBe("doc0_lines-1-1");
    expect(compositeDocument.sources[0].label).toContain("Economics_Lecture1");
    expect(compositeDocument.sources[0].text).toBe(studyText);

    expect(compositeDocument.sources[1].id).toBe("doc1_lines-1-1");
    expect(compositeDocument.sources[1].label).toContain("Economics_Lecture2");
    expect(compositeDocument.sources[1].text).toContain("Monopoly");

    expect(compositeDocument.characterCount).toBe(
      file1.size + file2.size,
    );
  });
});

describe("readMultiUpload", () => {
  it("extracts multiple files and parsed options from multipart request", async () => {
    const form = new FormData();
    form.append("files", new File([studyText], "alpha.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "beta.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview", questionCount: 15 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const controller = new AbortController();
    const { files, options } = await readMultiUpload(request, controller.signal);

    expect(files.length).toBe(2);
    expect(files[0].name).toBe("alpha.txt");
    expect(files[1].name).toBe("beta.txt");
    expect(options.questionCount).toBe(15);
    expect(options.multiFile).toBe(true);
  });

  it("rejects request if total body exceeds maximum size", async () => {
    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: new Uint8Array(26 * 1024 * 1024),
      headers: { "content-type": "multipart/form-data; boundary=xyz" },
    });

    const controller = new AbortController();
    await expect(readMultiUpload(request, controller.signal)).rejects.toThrow();
  });
});

describe("multi ingestion HTTP handler", () => {
  it("previews multiple documents successfully without calling AI", async () => {
    const generate = vi.fn();
    const checkConfiguration = vi.fn();

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "preview" }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ generate, checkConfiguration });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.document.sources.length).toBe(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates questions on composite document when operation is generate", async () => {
    const generate = vi.fn().mockResolvedValue(mockResult);
    const checkConfiguration = vi.fn();

    const form = new FormData();
    form.append("files", new File([studyText], "notesA.txt", { type: "text/plain" }));
    form.append("files", new File([studyText], "notesB.txt", { type: "text/plain" }));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const request = new Request("http://localhost:3000/api/ingest/multi", {
      method: "POST",
      body: form,
    });

    const handler = createMultiIngestionHandler({ generate, checkConfiguration });
    const response = await handler(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.pack.title).toBe(mockMicroeconomics.title);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(checkConfiguration).toHaveBeenCalledTimes(1);
  });
});
