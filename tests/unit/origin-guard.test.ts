import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedOrigin } from "@/lib/utils";

describe("CSRF & Origin Guard (isAllowedOrigin)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects sec-fetch-site: cross-site unconditionally", () => {
    const req = new Request("https://clutcharena.com/api/repair", {
      method: "POST",
      headers: {
        origin: "https://clutcharena.com",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(isAllowedOrigin("https://clutcharena.com", req)).toBe(false);
  });

  it("ignores spoofed x-forwarded-host and x-forwarded-proto headers", () => {
    const req = new Request("https://clutcharena.com/api/auth/account", {
      method: "DELETE",
      headers: {
        origin: "https://evil-attacker.example",
        "x-forwarded-host": "evil-attacker.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(isAllowedOrigin("https://evil-attacker.example", req)).toBe(false);
  });

  it("permits canonical request URL origin and configured NEXT_PUBLIC_SITE_URL / VERCEL_URL origins", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.clutcharena.com");
    vi.stubEnv("VERCEL_URL", "clutch-preview-123.vercel.app");

    const sameReq = new Request("https://clutcharena.com/api/notes/generate", {
      method: "POST",
    });
    expect(isAllowedOrigin("https://clutcharena.com", sameReq)).toBe(true);
    expect(isAllowedOrigin("https://app.clutcharena.com", sameReq)).toBe(true);
    expect(isAllowedOrigin("https://clutch-preview-123.vercel.app", sameReq)).toBe(true);
    expect(isAllowedOrigin("https://attacker.vercel.app", sameReq)).toBe(false);
  });

  it("permits localhost development host aliases when request host is local", () => {
    const req = new Request("http://localhost:3000/api/coach", {
      method: "POST",
    });
    expect(isAllowedOrigin("http://127.0.0.1:3000", req)).toBe(true);
    expect(isAllowedOrigin("http://0.0.0.0:3000", req)).toBe(true);
    expect(isAllowedOrigin("https://localhost:3000", req)).toBe(false);
  });

  it("falls back to Referer header when Origin is absent, and rejects missing Origin+Referer on state-changing requests in production", () => {
    const validRefererReq = new Request("https://clutcharena.com/api/repair", {
      method: "POST",
      headers: {
        referer: "https://clutcharena.com/study/123",
      },
    });
    expect(isAllowedOrigin(null, validRefererReq)).toBe(true);

    const badRefererReq = new Request("https://clutcharena.com/api/repair", {
      method: "POST",
      headers: {
        referer: "https://evil.example/phish",
      },
    });
    expect(isAllowedOrigin(null, badRefererReq)).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    const missingBothProdPost = new Request("https://clutcharena.com/api/repair", {
      method: "POST",
    });
    expect(isAllowedOrigin(null, missingBothProdPost)).toBe(false);

    const missingBothProdGet = new Request("https://clutcharena.com/api/quota", {
      method: "GET",
    });
    expect(isAllowedOrigin(null, missingBothProdGet)).toBe(true);
  });
});
