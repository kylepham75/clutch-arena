import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { checkRateLimit } from "@/lib/rate-limit";
import { createIngestionHandler } from "@/lib/ingestion/handler";
import { createMultiIngestionHandler } from "@/lib/ingestion/multi-handler";
import { createCoachHandler } from "@/lib/coach/handler";
import { studyText } from "../helpers/documents";

describe("Rate Limiting & Server-Side Tier Enforcement", () => {
  it("enforces tier-aware sliding window limits (2/week for guest/contender, 50/day for paid)", async () => {
    const guestId = `test-guest-${Date.now()}`;

    // Limit is 2 per week for guest / contender
    const res1 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res1.allowed).toBe(true);
    expect(res1.limit).toBe(2);
    expect(res1.remaining).toBe(1);

    const res2 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(0);

    // 3rd request must be blocked
    const res3 = await checkRateLimit(guestId, "ingest", "guest");
    expect(res3.allowed).toBe(false);
    expect(res3.remaining).toBe(0);
    expect(res3.retryAfter).toBeGreaterThan(0);

    // Paid tier (cram_pass) gets 50 per day
    const paidId = `test-paid-${Date.now()}`;
    const paidRes = await checkRateLimit(paidId, "ingest", "cram_pass");
    expect(paidRes.allowed).toBe(true);
    expect(paidRes.limit).toBe(50);
    expect(paidRes.remaining).toBe(49);
  });

  it("blocks >10 questions on /api/ingest for guest and contender tiers (403 TIER_UPGRADE_REQUIRED)", async () => {
    const handler = createIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      verifyAuth: vi.fn().mockResolvedValue({
        authenticated: true,
        user: { id: "user-1" },
        tier: "contender",
        tierExpiresAt: null,
      }),
    });

    const form = new FormData();
    form.set("file", new File([studyText], "notes.txt"));
    form.set(
      "options",
      JSON.stringify({ operation: "generate", questionCount: 20 }),
    );

    const req = new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
  });

  it("blocks multi-file generation on /api/ingest-multi for guest and contender tiers (403 TIER_UPGRADE_REQUIRED)", async () => {
    const handler = createMultiIngestionHandler({
      generate: vi.fn(),
      checkConfiguration: () => {},
      verifyAuth: vi.fn().mockResolvedValue({
        authenticated: false,
        user: null,
        tier: "guest",
        tierExpiresAt: null,
      }),
    });

    const form = new FormData();
    form.append("files", new File([studyText], "notes1.txt"));
    form.append("files", new File([studyText], "notes2.txt"));
    form.set("options", JSON.stringify({ operation: "generate", questionCount: 10 }));

    const req = new Request("http://localhost:3000/api/ingest-multi", {
      method: "POST",
      body: form,
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("TIER_UPGRADE_REQUIRED");
  });

  it("returns HTTP 429 RATE_LIMIT_EXCEEDED on /api/ingest when quota exhausted", async () => {
    const mockLimiter = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 2,
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
          sources: [{ id: "1", label: "Page 1", text: "Study material" }],
        },
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
