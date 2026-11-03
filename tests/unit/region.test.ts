import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import {
  CLUTCH_REGION_COOKIE,
  CLUTCH_REGION_HEADER,
  REGION_HEADER_VERCEL,
  REGION_HEADER_CLOUDFLARE,
  isValidBillingRegion,
  parseBillingRegion,
  detectBillingRegionFromCountry,
  detectBillingRegionFromHeaders,
  getBillingRegion,
  getBillingRegionClient,
  setBillingRegionClient,
  getEffectiveCurrency,
  formatRegionalPrice,
  getPlanRegionalPrice,
  type BillingRegion,
  type PlanId,
} from "@/lib/pricing/region";
import { PRICING_PLANS } from "@/lib/pricing/tiers";

describe("Geo-IP Billing Region & Regional Pricing Test Suite", () => {
  /* -------------------------------------------------------------------------- */
  /*  1. detectBillingRegionFromCountry                                         */
  /* -------------------------------------------------------------------------- */
  describe("detectBillingRegionFromCountry", () => {
    it("returns 'VN' for exact 'VN'", () => {
      expect(detectBillingRegionFromCountry("VN")).toBe("VN");
    });

    it("returns 'VN' for lowercase 'vn'", () => {
      expect(detectBillingRegionFromCountry("vn")).toBe("VN");
    });

    it("returns 'VN' when surrounded by whitespace", () => {
      expect(detectBillingRegionFromCountry(" VN ")).toBe("VN");
      expect(detectBillingRegionFromCountry("  vn\t")).toBe("VN");
    });

    it("returns 'ROW' for non-VN countries", () => {
      expect(detectBillingRegionFromCountry("US")).toBe("ROW");
      expect(detectBillingRegionFromCountry("GB")).toBe("ROW");
      expect(detectBillingRegionFromCountry("SG")).toBe("ROW");
      expect(detectBillingRegionFromCountry("JP")).toBe("ROW");
      expect(detectBillingRegionFromCountry("AU")).toBe("ROW");
      expect(detectBillingRegionFromCountry("DE")).toBe("ROW");
      expect(detectBillingRegionFromCountry("FR")).toBe("ROW");
      expect(detectBillingRegionFromCountry("CA")).toBe("ROW");
    });

    it("returns 'ROW' for empty string, null, and undefined values", () => {
      expect(detectBillingRegionFromCountry("")).toBe("ROW");
      expect(detectBillingRegionFromCountry("   ")).toBe("ROW");
      expect(detectBillingRegionFromCountry(null)).toBe("ROW");
      expect(detectBillingRegionFromCountry(undefined)).toBe("ROW");
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  2. detectBillingRegionFromHeaders                                         */
  /* -------------------------------------------------------------------------- */
  describe("detectBillingRegionFromHeaders", () => {
    it("resolves 'VN' when x-vercel-ip-country is 'VN'", () => {
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_VERCEL]: "VN" })).toBe("VN");
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_VERCEL]: "vn" })).toBe("VN");
    });

    it("resolves 'VN' when cf-ipcountry is 'VN'", () => {
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_CLOUDFLARE]: "VN" })).toBe("VN");
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_CLOUDFLARE]: "vn" })).toBe("VN");
    });

    it("resolves 'VN' when x-clutch-region is 'VN'", () => {
      expect(detectBillingRegionFromHeaders({ [CLUTCH_REGION_HEADER]: "VN" })).toBe("VN");
      expect(detectBillingRegionFromHeaders({ [CLUTCH_REGION_HEADER]: "vn" })).toBe("VN");
    });

    it("respects x-clutch-region: ROW override even if country header is 'VN'", () => {
      const headers = {
        [CLUTCH_REGION_HEADER]: "ROW",
        [REGION_HEADER_VERCEL]: "VN",
        [REGION_HEADER_CLOUDFLARE]: "VN",
      };
      expect(detectBillingRegionFromHeaders(headers)).toBe("ROW");
    });

    it("respects x-clutch-region: VN override even if country header is 'US'", () => {
      const headers = {
        [CLUTCH_REGION_HEADER]: "VN",
        [REGION_HEADER_VERCEL]: "US",
      };
      expect(detectBillingRegionFromHeaders(headers)).toBe("VN");
    });

    it("returns 'ROW' when no regional headers are present", () => {
      expect(detectBillingRegionFromHeaders({})).toBe("ROW");
      expect(
        detectBillingRegionFromHeaders({
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0",
        }),
      ).toBe("ROW");
    });

    it("returns 'ROW' for non-VN countries in Geo-IP headers", () => {
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_VERCEL]: "US" })).toBe("ROW");
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_CLOUDFLARE]: "SG" })).toBe("ROW");
    });

    it("supports Headers web standard instance", () => {
      const headersVn = new Headers();
      headersVn.set(REGION_HEADER_VERCEL, "VN");
      expect(detectBillingRegionFromHeaders(headersVn)).toBe("VN");

      const headersRow = new Headers();
      headersRow.set(REGION_HEADER_VERCEL, "US");
      expect(detectBillingRegionFromHeaders(headersRow)).toBe("ROW");

      const headersOverride = new Headers();
      headersOverride.set(REGION_HEADER_VERCEL, "VN");
      headersOverride.set(CLUTCH_REGION_HEADER, "ROW");
      expect(detectBillingRegionFromHeaders(headersOverride)).toBe("ROW");
    });

    it("supports plain object records with case-insensitive header keys", () => {
      expect(detectBillingRegionFromHeaders({ "X-Vercel-IP-Country": "VN" })).toBe("VN");
      expect(detectBillingRegionFromHeaders({ "CF-IPCountry": "VN" })).toBe("VN");
      expect(detectBillingRegionFromHeaders({ "X-Clutch-Region": "VN" })).toBe("VN");
    });

    it("supports objects implementing .get()", () => {
      const customContainer = {
        get(key: string) {
          if (key === REGION_HEADER_VERCEL) return "VN";
          return null;
        },
      };
      expect(detectBillingRegionFromHeaders(customContainer)).toBe("VN");
    });

    it("supports array string headers in plain records", () => {
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_VERCEL]: ["VN"] })).toBe("VN");
      expect(detectBillingRegionFromHeaders({ [REGION_HEADER_VERCEL]: ["US"] })).toBe("ROW");
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  3. parseBillingRegion and isValidBillingRegion                            */
  /* -------------------------------------------------------------------------- */
  describe("parseBillingRegion and isValidBillingRegion", () => {
    it("isValidBillingRegion accurately distinguishes valid literal regions", () => {
      expect(isValidBillingRegion("VN")).toBe(true);
      expect(isValidBillingRegion("ROW")).toBe(true);

      // Must reject non-normalized or non-region values
      expect(isValidBillingRegion("vn")).toBe(false);
      expect(isValidBillingRegion("row")).toBe(false);
      expect(isValidBillingRegion("US")).toBe(false);
      expect(isValidBillingRegion("")).toBe(false);
      expect(isValidBillingRegion(null)).toBe(false);
      expect(isValidBillingRegion(undefined)).toBe(false);
      expect(isValidBillingRegion(123)).toBe(false);
      expect(isValidBillingRegion({})).toBe(false);
      expect(isValidBillingRegion(true)).toBe(false);
    });

    it("parseBillingRegion normalizes valid regions with case and whitespace insensitivity", () => {
      expect(parseBillingRegion("VN")).toBe("VN");
      expect(parseBillingRegion("vn")).toBe("VN");
      expect(parseBillingRegion("  VN  ")).toBe("VN");
      expect(parseBillingRegion("  vn  ")).toBe("VN");

      expect(parseBillingRegion("ROW")).toBe("ROW");
      expect(parseBillingRegion("row")).toBe("ROW");
      expect(parseBillingRegion("  ROW  ")).toBe("ROW");
      expect(parseBillingRegion(" RoW ")).toBe("ROW");
    });

    it("parseBillingRegion returns null for invalid strings, numbers, null, and undefined", () => {
      expect(parseBillingRegion("US")).toBeNull();
      expect(parseBillingRegion("GB")).toBeNull();
      expect(parseBillingRegion("VI")).toBeNull();
      expect(parseBillingRegion("")).toBeNull();
      expect(parseBillingRegion("   ")).toBeNull();
      expect(parseBillingRegion(null)).toBeNull();
      expect(parseBillingRegion(undefined)).toBeNull();
      expect(parseBillingRegion(123 as unknown as string)).toBeNull();
      expect(parseBillingRegion({} as unknown as string)).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  4. getBillingRegion Resolver Priority                                     */
  /* -------------------------------------------------------------------------- */
  describe("getBillingRegion resolver priority", () => {
    it("Priority 1: Valid cookie takes precedence over all headers", () => {
      // Cookie is ROW, but headers claim VN
      const reqRowCookie = {
        cookies: {
          get: (name: string) => (name === CLUTCH_REGION_COOKIE ? { value: "ROW" } : undefined),
        },
        headers: {
          [CLUTCH_REGION_HEADER]: "VN",
          [REGION_HEADER_VERCEL]: "VN",
        },
      };
      expect(getBillingRegion(reqRowCookie)).toBe("ROW");

      // Cookie is VN, but headers claim US / ROW
      const reqVnCookie = {
        cookies: {
          get: (name: string) => (name === CLUTCH_REGION_COOKIE ? { value: "VN" } : undefined),
        },
        headers: {
          [CLUTCH_REGION_HEADER]: "ROW",
          [REGION_HEADER_VERCEL]: "US",
        },
      };
      expect(getBillingRegion(reqVnCookie)).toBe("VN");
    });

    it("Priority 1: Extracts cookie from raw 'cookie' header string", () => {
      const req = {
        headers: {
          cookie: `session_id=xyz; ${CLUTCH_REGION_COOKIE}=VN; theme=dark`,
          [REGION_HEADER_VERCEL]: "US",
        },
      };
      expect(getBillingRegion(req)).toBe("VN");
    });

    it("Priority 1: Ignores invalid cookie and falls through to headers", () => {
      const req = {
        cookies: {
          get: (name: string) => (name === CLUTCH_REGION_COOKIE ? { value: "INVALID_REGION" } : undefined),
        },
        headers: {
          [REGION_HEADER_VERCEL]: "VN",
        },
      };
      expect(getBillingRegion(req)).toBe("VN");
    });

    it("Priority 2: Explicit header (x-clutch-region) takes precedence over Geo-IP country headers", () => {
      // Override to ROW while Geo-IP is VN
      const reqRowOverride = {
        headers: {
          [CLUTCH_REGION_HEADER]: "ROW",
          [REGION_HEADER_VERCEL]: "VN",
          [REGION_HEADER_CLOUDFLARE]: "VN",
        },
      };
      expect(getBillingRegion(reqRowOverride)).toBe("ROW");

      // Override to VN while Geo-IP is US
      const reqVnOverride = {
        headers: {
          [CLUTCH_REGION_HEADER]: "VN",
          [REGION_HEADER_VERCEL]: "US",
        },
      };
      expect(getBillingRegion(reqVnOverride)).toBe("VN");
    });

    it("Priority 3: Geo-IP country headers resolve correctly", () => {
      // Vercel Geo-IP
      expect(
        getBillingRegion({
          headers: { [REGION_HEADER_VERCEL]: "VN" },
        }),
      ).toBe("VN");

      // Cloudflare Geo-IP
      expect(
        getBillingRegion({
          headers: { [REGION_HEADER_CLOUDFLARE]: "VN" },
        }),
      ).toBe("VN");

      // Foreign country
      expect(
        getBillingRegion({
          headers: { [REGION_HEADER_VERCEL]: "US" },
        }),
      ).toBe("ROW");
    });

    it("Priority 4: Safe fallback to 'ROW' when empty, invalid, or headers missing", () => {
      expect(getBillingRegion()).toBe("ROW");
      expect(getBillingRegion(undefined)).toBe("ROW");
      expect(getBillingRegion(null)).toBe("ROW");
      expect(getBillingRegion({})).toBe("ROW");
      expect(getBillingRegion({ headers: {} })).toBe("ROW");
      expect(getBillingRegion(12345)).toBe("ROW");
      expect(getBillingRegion("non-existent-cookie")).toBe("ROW");
    });

    it("never throws when called without arguments or with unexpected types", () => {
      expect(() => getBillingRegion()).not.toThrow();
      expect(() => getBillingRegion(null)).not.toThrow();
      expect(() => getBillingRegion(undefined)).not.toThrow();
      expect(() => getBillingRegion(false)).not.toThrow();
      expect(() => getBillingRegion([])).not.toThrow();
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  5. Currency & Price Formatting                                            */
  /* -------------------------------------------------------------------------- */
  describe("Currency & Price formatting", () => {
    describe("getEffectiveCurrency", () => {
      it("maps 'VN' to 'VND' and 'ROW' to 'USD'", () => {
        expect(getEffectiveCurrency("VN")).toBe("VND");
        expect(getEffectiveCurrency("ROW")).toBe("USD");
      });
    });

    describe("formatRegionalPrice", () => {
      it("formats VN prices with dot thousands separators and trailing đ", () => {
        expect(formatRegionalPrice(0, "VN")).toBe("0đ");
        expect(formatRegionalPrice(69000, "VN")).toBe("69.000đ");
        expect(formatRegionalPrice(109000, "VN")).toBe("109.000đ");
        expect(formatRegionalPrice(299000, "VN")).toBe("299.000đ");
        expect(formatRegionalPrice(399000, "VN")).toBe("399.000đ");
        expect(formatRegionalPrice(1500000, "VN")).toBe("1.500.000đ");
      });

      it("handles negative VN amounts", () => {
        expect(formatRegionalPrice(-69000, "VN")).toBe("-69.000đ");
      });

      it("formats ROW prices with $ prefix, whole integers without decimals, and decimals with two places", () => {
        expect(formatRegionalPrice(0, "ROW")).toBe("$0");
        expect(formatRegionalPrice(29, "ROW")).toBe("$29");
        expect(formatRegionalPrice(4.99, "ROW")).toBe("$4.99");
        expect(formatRegionalPrice(9.99, "ROW")).toBe("$9.99");
        expect(formatRegionalPrice(24.99, "ROW")).toBe("$24.99");
      });

      it("handles negative ROW amounts", () => {
        expect(formatRegionalPrice(-4.99, "ROW")).toBe("-$4.99");
        expect(formatRegionalPrice(-29, "ROW")).toBe("-$29");
      });
    });

    describe("getPlanRegionalPrice", () => {
      it("retrieves accurate pricing and currency for contender", () => {
        const vn = getPlanRegionalPrice("contender", "VN");
        expect(vn).toEqual({
          amount: 0,
          currency: "VND",
          formatted: "0đ",
        });

        const row = getPlanRegionalPrice("contender", "ROW");
        expect(row).toEqual({
          amount: 0,
          currency: "USD",
          formatted: "$0",
        });
      });

      it("retrieves accurate pricing and currency for cram_pass", () => {
        const vn = getPlanRegionalPrice("cram_pass", "VN");
        expect(vn).toEqual({
          amount: 69000,
          currency: "VND",
          formatted: "69.000đ",
        });

        const row = getPlanRegionalPrice("cram_pass", "ROW");
        expect(row).toEqual({
          amount: 4.99,
          currency: "USD",
          formatted: "$4.99",
        });
      });

      it("retrieves accurate pricing and currency for pro_monthly", () => {
        const vn = getPlanRegionalPrice("pro_monthly", "VN");
        expect(vn).toEqual({
          amount: 109000,
          currency: "VND",
          formatted: "109.000đ/tháng",
        });

        const row = getPlanRegionalPrice("pro_monthly", "ROW");
        expect(row).toEqual({
          amount: 9.99,
          currency: "USD",
          formatted: "$9.99/mo",
        });
      });

      it("retrieves accurate pricing and currency for pro and pro_semester alias", () => {
        const vnPro = getPlanRegionalPrice("pro", "VN");
        const vnSemester = getPlanRegionalPrice("pro_semester", "VN");
        expect(vnPro).toEqual({
          amount: 299000,
          currency: "VND",
          formatted: "299.000đ/kỳ",
        });
        expect(vnSemester).toEqual(vnPro);

        const rowPro = getPlanRegionalPrice("pro", "ROW");
        const rowSemester = getPlanRegionalPrice("pro_semester", "ROW");
        expect(rowPro).toEqual({
          amount: 29.0,
          currency: "USD",
          formatted: "$29.00/sem",
        });
        expect(rowSemester).toEqual(rowPro);
      });

      it("retrieves accurate pricing and currency for tutor and tutor_guild alias", () => {
        const vnTutor = getPlanRegionalPrice("tutor", "VN");
        const vnGuild = getPlanRegionalPrice("tutor_guild", "VN");
        expect(vnTutor).toEqual({
          amount: 399000,
          currency: "VND",
          formatted: "399.000đ/tháng",
        });
        expect(vnGuild).toEqual(vnTutor);

        const rowTutor = getPlanRegionalPrice("tutor", "ROW");
        const rowGuild = getPlanRegionalPrice("tutor_guild", "ROW");
        expect(rowTutor).toEqual({
          amount: 24.99,
          currency: "USD",
          formatted: "$24.99/mo",
        });
        expect(rowGuild).toEqual(rowTutor);
      });

      it("throws an error when planId is not recognized", () => {
        expect(() => getPlanRegionalPrice("non_existent_tier" as PlanId, "VN")).toThrow(
          'Plan pricing not found for planId: "non_existent_tier"',
        );
      });
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  6. Strict UI Language / Locale Decoupling                                 */
  /* -------------------------------------------------------------------------- */
  describe("Strict UI Language / Locale Decoupling", () => {
    it("Scenario A: English student studying in Vietnam (locale = 'en', country = 'VN') resolves to 'VN' (VND)", () => {
      const expatRequest = new NextRequest("http://localhost:3000/pricing?lang=en", {
        headers: {
          [REGION_HEADER_VERCEL]: "VN",
          "accept-language": "en-US,en;q=0.9",
          cookie: "clutch_language=en",
        },
      });

      const resolvedRegion = getBillingRegion(expatRequest);
      expect(resolvedRegion).toBe("VN");
      expect(getEffectiveCurrency(resolvedRegion)).toBe("VND");

      const cramPrice = getPlanRegionalPrice("cram_pass", resolvedRegion);
      expect(cramPrice.currency).toBe("VND");
      expect(cramPrice.formatted).toBe("69.000đ");
    });

    it("Scenario B: Vietnamese student studying abroad (locale = 'vi', country = 'US') resolves to 'ROW' (USD)", () => {
      const studyAbroadRequest = new NextRequest("http://localhost:3000/pricing?lang=vi", {
        headers: {
          [REGION_HEADER_VERCEL]: "US",
          "accept-language": "vi-VN,vi;q=0.9,en;q=0.8",
          cookie: "clutch_language=vi",
        },
      });

      const resolvedRegion = getBillingRegion(studyAbroadRequest);
      expect(resolvedRegion).toBe("ROW");
      expect(getEffectiveCurrency(resolvedRegion)).toBe("USD");

      const cramPrice = getPlanRegionalPrice("cram_pass", resolvedRegion);
      expect(cramPrice.currency).toBe("USD");
      expect(cramPrice.formatted).toBe("$4.99");
    });

    it("guarantees toggling UI language ('vi' <-> 'en') has strictly zero impact on resolved billing region", () => {
      const languages = ["vi", "en", "ja", "fr", "de"];

      for (const lang of languages) {
        // In Vietnam: always VN
        const vnReq = new NextRequest(`http://localhost:3000/?lang=${lang}`, {
          headers: {
            [REGION_HEADER_VERCEL]: "VN",
            "accept-language": `${lang};q=1.0`,
            cookie: `clutch_language=${lang}`,
          },
        });
        expect(getBillingRegion(vnReq)).toBe("VN");

        // In the US: always ROW
        const usReq = new NextRequest(`http://localhost:3000/?lang=${lang}`, {
          headers: {
            [REGION_HEADER_VERCEL]: "US",
            "accept-language": `${lang};q=1.0`,
            cookie: `clutch_language=${lang}`,
          },
        });
        expect(getBillingRegion(usReq)).toBe("ROW");
      }
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  7. Next.js Middleware Integration                                         */
  /* -------------------------------------------------------------------------- */
  describe("Next.js Middleware Integration", () => {
    it("injects x-clutch-region header into downstream request and sets clutch_region cookie for Geo-IP 'VN'", () => {
      const req = new NextRequest("http://localhost:3000/pricing", {
        headers: {
          [REGION_HEADER_VERCEL]: "VN",
        },
      });

      const res = middleware(req);

      // Injects downstream request header
      expect(res.headers.get("x-middleware-request-x-clutch-region")).toBe("VN");
      expect(res.headers.get("x-middleware-override-headers")).toContain(CLUTCH_REGION_HEADER);

      // Sets cookie on response when missing
      const setCookie = res.cookies.get(CLUTCH_REGION_COOKIE);
      expect(setCookie).toBeDefined();
      expect(setCookie?.value).toBe("VN");
      expect(setCookie?.path).toBe("/");
      expect(setCookie?.maxAge).toBe(31536000);
      expect(setCookie?.sameSite).toBe("lax");
      expect(setCookie?.httpOnly).toBe(false);
    });

    it("injects x-clutch-region: ROW header and sets clutch_region=ROW cookie for Geo-IP 'US'", () => {
      const req = new NextRequest("http://localhost:3000/pricing", {
        headers: {
          [REGION_HEADER_VERCEL]: "US",
        },
      });

      const res = middleware(req);

      expect(res.headers.get("x-middleware-request-x-clutch-region")).toBe("ROW");
      expect(res.headers.get("x-middleware-override-headers")).toContain(CLUTCH_REGION_HEADER);

      const setCookie = res.cookies.get(CLUTCH_REGION_COOKIE);
      expect(setCookie).toBeDefined();
      expect(setCookie?.value).toBe("ROW");
    });

    it("leaves cookie untouched if already set to correct region", () => {
      const req = new NextRequest("http://localhost:3000/pricing", {
        headers: {
          [REGION_HEADER_VERCEL]: "VN",
          cookie: `${CLUTCH_REGION_COOKIE}=VN`,
        },
      });

      const res = middleware(req);

      // Header is still forwarded
      expect(res.headers.get("x-middleware-request-x-clutch-region")).toBe("VN");

      // Response cookie should NOT be re-set since existing cookie already matches
      expect(res.cookies.get(CLUTCH_REGION_COOKIE)).toBeUndefined();
    });

    it("updates cookie if existing cookie differs from resolved region", () => {
      // For instance, cookie had an invalid value, but Geo-IP is VN
      const req = new NextRequest("http://localhost:3000/pricing", {
        headers: {
          [REGION_HEADER_VERCEL]: "VN",
          cookie: `${CLUTCH_REGION_COOKIE}=INVALID_REGION`,
        },
      });

      const res = middleware(req);

      expect(res.headers.get("x-middleware-request-x-clutch-region")).toBe("VN");
      const setCookie = res.cookies.get(CLUTCH_REGION_COOKIE);
      expect(setCookie).toBeDefined();
      expect(setCookie?.value).toBe("VN");
    });

    it("respects Cloudflare cf-ipcountry header in middleware", () => {
      const req = new NextRequest("http://localhost:3000/pricing", {
        headers: {
          [REGION_HEADER_CLOUDFLARE]: "VN",
        },
      });

      const res = middleware(req);

      expect(res.headers.get("x-middleware-request-x-clutch-region")).toBe("VN");
      expect(res.cookies.get(CLUTCH_REGION_COOKIE)?.value).toBe("VN");
    });

    it("respects explicit x-clutch-region override header in middleware", () => {
      const req = new NextRequest("http://localhost:3000/pricing", {
        headers: {
          [CLUTCH_REGION_HEADER]: "ROW",
          [REGION_HEADER_VERCEL]: "VN",
        },
      });

      const res = middleware(req);

      expect(res.headers.get("x-middleware-request-x-clutch-region")).toBe("ROW");
      expect(res.cookies.get(CLUTCH_REGION_COOKIE)?.value).toBe("ROW");
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  8. Client Cookie Helpers (getBillingRegionClient & setBillingRegionClient)*/
  /* -------------------------------------------------------------------------- */
  describe("Client Cookie Helpers", () => {
    const originalDocument = globalThis.document;

    afterEach(() => {
      if (originalDocument) {
        globalThis.document = originalDocument;
      } else {
        // @ts-expect-error cleanup mocked document
        delete globalThis.document;
      }
    });

    it("getBillingRegionClient returns 'ROW' safely in server / non-browser environments", () => {
      // @ts-expect-error simulate SSR
      delete globalThis.document;
      expect(getBillingRegionClient()).toBe("ROW");
    });

    it("setBillingRegionClient is a safe no-op in server / non-browser environments", () => {
      // @ts-expect-error simulate SSR
      delete globalThis.document;
      expect(() => setBillingRegionClient("VN")).not.toThrow();
    });

    it("reads and parses region from document.cookie in browser environment", () => {
      let mockCookie = `${CLUTCH_REGION_COOKIE}=VN; path=/`;
      globalThis.document = {
        get cookie() {
          return mockCookie;
        },
        set cookie(val: string) {
          mockCookie = val;
        },
      } as unknown as Document;

      expect(getBillingRegionClient()).toBe("VN");

      mockCookie = `${CLUTCH_REGION_COOKIE}=ROW; other=123`;
      expect(getBillingRegionClient()).toBe("ROW");

      mockCookie = "unrelated_cookie=abc";
      expect(getBillingRegionClient()).toBe("ROW");
    });

    it("persists valid region via setBillingRegionClient to document.cookie", () => {
      let writtenCookie = "";
      globalThis.document = {
        get cookie() {
          return writtenCookie;
        },
        set cookie(val: string) {
          writtenCookie = val;
        },
      } as unknown as Document;

      setBillingRegionClient("VN");
      expect(writtenCookie).toContain(`${CLUTCH_REGION_COOKIE}=VN`);
      expect(writtenCookie).toContain("max-age=31536000");

      setBillingRegionClient("ROW");
      expect(writtenCookie).toContain(`${CLUTCH_REGION_COOKIE}=ROW`);
    });

    it("falls back to 'ROW' when setting an invalid region", () => {
      let writtenCookie = "";
      globalThis.document = {
        get cookie() {
          return writtenCookie;
        },
        set cookie(val: string) {
          writtenCookie = val;
        },
      } as unknown as Document;

      setBillingRegionClient("INVALID" as unknown as BillingRegion);
      expect(writtenCookie).toContain(`${CLUTCH_REGION_COOKIE}=ROW`);
    });
  });
});
