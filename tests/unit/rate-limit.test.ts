import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { checkRateLimit } from "@/lib/rate-limit";
import { createIngestionHandler } from "@/lib/ingestion/handler";
import { createCoachHandler } from "@/lib/coach/handler";
import { studyText } from "../helpers/documents";

describe("Rate Limiting & Abuse Prevention", () => {
  it("enforces in-memory sliding window limits when Redis is unconfigured", async () => {
    const testId = `test-user-${Date.now()}`;

    // Limit is 3 per day for ingest
    const res1 = await checkRateLimit(testId, "ingest");
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = await checkRateLimit(testId, "ingest");
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = await checkRateLimit(testId, "ingest");
    expect(res3.allowed).toBe(true);
    expect(res3.remaining).toBe(0);

    // 4th request must be blocked
    const res4 = await checkRateLimit(testId, "ingest");
    expect(res4.allowed).toBe(false);
    expect(res4.remaining).toBe(0);
    expect(res4.retryAfter).toBeGreaterThan(0);
  });

  it("returns HTTP 429 RATE_LIMIT_EXCEEDED on /api/ingest when quota exhausted", async () => {
    const mockLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 3,
      remaining: 0,
      reset: 3600,
      retryAfter: 3600,
    });

    const handler = createIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      rateLimiter: mockLimiter,
    });

    const form = new FormData();
    form.set("file", new File([studyText], "notes.txt"));
    form.set("options", JSON.stringify({ operation: "generate" }));

    const req = new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(mockLimiter).toHaveBeenCalled();
  });

  it("returns HTTP 429 on /api/coach when coach rate limit is reached", async () => {
    const mockLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 20,
      remaining: 0,
      reset: 600,
      retryAfter: 600,
    });

    const handler = createCoachHandler({
      rateLimiter: mockLimiter,
    });

    const req = new Request("http://localhost:3000/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Help me" }] }],
        document: {
          fileName: "notes.txt",
          format: "txt",
          sources: [{ id: "1", label: "Page 1", text: "Study material" }],
          characterCount: 14,
          pageCount: 1,
          warnings: [],
        },
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
