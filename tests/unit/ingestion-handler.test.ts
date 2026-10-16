import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createIngestionHandler } from "@/lib/ingestion/handler";
import { IngestionError } from "@/lib/ingestion/errors";
import { REQUEST_TIMEOUT_MS } from "@/lib/ingestion/limits";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
import type { GenerationResult } from "@/lib/schemas/ingestion";
import { studyText } from "../helpers/documents";

const result: GenerationResult = {
  pack: mockMicroeconomics,
  sourceKind: "lecture",
  references: {},
  warnings: [],
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
};
function upload(
  options: unknown = { operation: "preview" },
  file = new File([studyText], "notes.txt"),
) {
  const form = new FormData();
  form.set("file", file);
  form.set("options", JSON.stringify(options));
  return new Request("http://localhost:3000/api/ingest", {
    method: "POST",
    body: form,
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("ingestion HTTP handler", () => {
  it("previews without invoking the AI or requiring credentials", async () => {
    const generate = vi.fn();
    const checkConfiguration = vi.fn();
    const response = await createIngestionHandler({
      generate,
      checkConfiguration,
    })(upload());
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(json.document.sources[0].text).toBe(studyText);
    expect(json.requestId).toBe(response.headers.get("x-request-id"));
    expect(generate).not.toHaveBeenCalled();
    expect(checkConfiguration).not.toHaveBeenCalled();
  });
  it("passes source text and validated settings to generation and returns the pack", async () => {
    const generate = vi.fn().mockResolvedValue(result);
    const response = await createIngestionHandler({
      generate,
      checkConfiguration: () => {},
    })(
      upload({
        operation: "generate",
        questionCount: 5,
        focus: "Chapter 4",
        language: "vi",
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pack.id).toBe(mockMicroeconomics.id);
    expect(generate.mock.calls[0][0].sources[0].text).toBe(studyText);
    expect(generate.mock.calls[0][1]).toMatchObject({
      questionCount: 5,
      focus: "Chapter 4",
      language: "vi",
      mode: "variants",
    });
  });
  it("reports a missing key with a useful 503", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const response = await createIngestionHandler()(
      upload({ operation: "generate" }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("AI_NOT_CONFIGURED");
  });
  it.each([
    { questionCount: 0 },
    { questionCount: 31 },
    { questionCount: "5" },
    { language: "xx" },
    { mode: "anything" },
    { focus: "x".repeat(1001) },
    { apiKey: "never accepted" },
  ])("rejects invalid options", async (options) => {
    const response = await createIngestionHandler()(
      upload({ operation: "preview", ...options }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_OPTIONS");
  });
  it("rejects malformed multipart, missing files and duplicate fields", async () => {
    const handler = createIngestionHandler();
    const malformed = await handler(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        body: "broken",
        headers: { "content-type": "multipart/form-data; boundary=x" },
      }),
    );
    expect(malformed.status).toBe(400);
    for (const kind of ["missing", "duplicate", "bad-json"]) {
      const form = new FormData();
      if (kind !== "missing")
        form.append("file", new File([studyText], "a.txt"));
      if (kind === "duplicate")
        form.append("file", new File([studyText], "b.txt"));
      form.set(
        "options",
        kind === "bad-json" ? "{wrong" : '{"operation":"preview"}',
      );
      expect(
        (
          await handler(
            new Request("http://localhost/api/ingest", {
              method: "POST",
              body: form,
            }),
          )
        ).status,
      ).toBe(400);
    }
  });
  it("rejects cross-origin requests and nonmultipart bodies", async () => {
    const request = upload();
    request.headers.set("origin", "https://other.example");
    expect((await createIngestionHandler()(request)).status).toBe(403);
    expect(
      (
        await createIngestionHandler()(
          new Request("http://localhost/api/ingest", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
  });
  it("enforces the measured body limit without trusting Content-Length", async () => {
    const request = new Request("http://localhost/api/ingest", {
      method: "POST",
      body: new Uint8Array(26 * 1024 * 1024),
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    const response = await createIngestionHandler()(request);
    expect(response.status).toBe(413);
  });
  it("does not leak unexpected upstream errors", async () => {
    const response = await createIngestionHandler({
      checkConfiguration: () => {},
      generate: async () => {
        throw new Error("secret key and private document content");
      },
    })(upload({ operation: "generate" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret key");
  });
  it("times out even a stalled upload stream", async () => {
    vi.useFakeTimers();
    const request = new Request("http://localhost/api/ingest", {
      method: "POST",
      body: new ReadableStream(),
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    const pending = createIngestionHandler()(request);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    const response = await pending;
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("INGESTION_TIMEOUT");
  });
  it("releases processing slots on failure", async () => {
    const handler = createIngestionHandler({
      checkConfiguration: () => {
        throw new IngestionError("AI_NOT_CONFIGURED", "Missing key", 503);
      },
    });
    for (let i = 0; i < 4; i++)
      expect((await handler(upload({ operation: "generate" }))).status).toBe(
        503,
      );
    expect((await handler(upload())).status).toBe(200);
  });
  it("limits concurrent work and releases slots when requests finish", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      await gate;
      return result;
    });
    const handler = createIngestionHandler({
      generate,
      checkConfiguration: () => {},
    });
    const requests = [
      handler(upload({ operation: "generate" })),
      handler(upload({ operation: "generate" })),
    ];
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    const busy = await handler(upload());
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("30");
    release();
    await Promise.all(requests);
    expect((await handler(upload())).status).toBe(200);
  });
});
