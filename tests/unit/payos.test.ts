vi.mock("server-only", () => ({}));

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  isPayosConfigured,
  generatePayosOrderCode,
  decodePlanFromOrderCode,
  buildPayosDescription,
  computePayosPaymentSignature,
  verifyPayosWebhookSignature,
  buildVietQrImageUrl,
  fulfillPayosOrder,
  type PayosPlanId,
} from "@/lib/payments/payos";
import { POST as verifyPostRoute } from "@/app/api/payments/payos/verify/route";

let mockSubRecord: { user_id: string; tier: string } | null = null;
let mockAuthUser: { id: string } | null = null;
const mockUpsertSubSpy = vi.fn();
const mockUpsertProfileSpy = vi.fn();
const mockUpsertUserProfileSpy = vi.fn();
const mockAdminUpdateSpy = vi.fn();

vi.mock("@/lib/supabase/server", () => {
  const createChain = (getData: () => unknown) => {
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: getData(), error: null }));
    return chain;
  };

  return {
    isSupabaseServerConfigured: vi.fn(() => true),
    getSupabaseServerClient: vi.fn((token?: string) => ({
      from: vi.fn((table: string) => {
        if (table === "user_subscriptions") {
          return {
            select: vi.fn(() => createChain(() => mockSubRecord)),
            upsert: vi.fn(async (data: unknown) => {
              mockUpsertSubSpy(data);
              return { error: null };
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn(() => createChain(() => null)),
            upsert: vi.fn(async (data: unknown) => {
              mockUpsertProfileSpy(data);
              return { error: null };
            }),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          };
        }
        if (table === "user_profiles") {
          return {
            select: vi.fn(() => createChain(() => null)),
            upsert: vi.fn(async (data: unknown) => {
              mockUpsertUserProfileSpy(data);
              return { error: null };
            }),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => createChain(() => null)),
          upsert: vi.fn(async () => ({ error: null })),
        };
      }),
      auth: {
        getUser: vi.fn(async (t?: string) => {
          const checkToken = t || token;
          if (mockAuthUser && checkToken === "valid_token") {
            return { data: { user: mockAuthUser }, error: null };
          }
          if (checkToken === "attacker_token") {
            return { data: { user: { id: "attacker_user_id" } }, error: null };
          }
          return { data: { user: null }, error: new Error("Invalid token") };
        }),
        admin: {
          updateUserById: vi.fn(async (id: string, metadata: unknown) => {
            mockAdminUpdateSpy(id, metadata);
            return { data: {}, error: null };
          }),
        },
      },
    })),
  };
});

describe("PayOS Gateway Utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isPayosConfigured", () => {
    it("returns true when all required environment variables are set and non-empty", () => {
      process.env.PAYOS_CLIENT_ID = "client_id_123";
      process.env.PAYOS_API_KEY = "api_key_456";
      process.env.PAYOS_CHECKSUM_KEY = "checksum_key_789";

      expect(isPayosConfigured()).toBe(true);
    });

    it("returns false if PAYOS_CLIENT_ID is missing or whitespace", () => {
      delete process.env.PAYOS_CLIENT_ID;
      process.env.PAYOS_API_KEY = "api_key_456";
      process.env.PAYOS_CHECKSUM_KEY = "checksum_key_789";

      expect(isPayosConfigured()).toBe(false);

      process.env.PAYOS_CLIENT_ID = "   ";
      expect(isPayosConfigured()).toBe(false);
    });

    it("returns false if PAYOS_API_KEY is missing or whitespace", () => {
      process.env.PAYOS_CLIENT_ID = "client_id_123";
      delete process.env.PAYOS_API_KEY;
      process.env.PAYOS_CHECKSUM_KEY = "checksum_key_789";

      expect(isPayosConfigured()).toBe(false);

      process.env.PAYOS_API_KEY = "   ";
      expect(isPayosConfigured()).toBe(false);
    });

    it("returns false if PAYOS_CHECKSUM_KEY is missing or whitespace", () => {
      process.env.PAYOS_CLIENT_ID = "client_id_123";
      process.env.PAYOS_API_KEY = "api_key_456";
      delete process.env.PAYOS_CHECKSUM_KEY;

      expect(isPayosConfigured()).toBe(false);

      process.env.PAYOS_CHECKSUM_KEY = "   ";
      expect(isPayosConfigured()).toBe(false);
    });
  });

  describe("generatePayosOrderCode and decodePlanFromOrderCode", () => {
    it("generates a valid safe integer for cram_pass ending in 1 and decodes it", () => {
      const code = generatePayosOrderCode("cram_pass");

      expect(Number.isSafeInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code % 10).toBe(1);
      expect(decodePlanFromOrderCode(code)).toBe("cram_pass");
    });

    it("generates a valid safe integer for pro ending in 2 and decodes it", () => {
      const code = generatePayosOrderCode("pro");

      expect(Number.isSafeInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code % 10).toBe(2);
      expect(decodePlanFromOrderCode(code)).toBe("pro");
    });

    it("generates distinct order codes on successive rapid calls", () => {
      const code1 = generatePayosOrderCode("cram_pass");
      const code2 = generatePayosOrderCode("cram_pass");
      const code3 = generatePayosOrderCode("pro");

      expect(code1).not.toBe(code2);
      expect(code2).not.toBe(code3);
      expect(code2).toBeGreaterThan(code1);
      expect(code3).toBeGreaterThan(code2);
    });

    it("decodes plan from amount fallback when orderCode last digit is neither 1 nor 2", () => {
      const neutralCode = 9876543210; // ends in 0
      expect(neutralCode % 10).toBe(0);

      expect(decodePlanFromOrderCode(neutralCode, 39000)).toBe("cram_pass");
      expect(decodePlanFromOrderCode(neutralCode, 69000)).toBe("cram_pass");
      expect(decodePlanFromOrderCode(neutralCode, 149000)).toBe("pro");
      expect(decodePlanFromOrderCode(neutralCode, 299000)).toBe("pro");
      expect(decodePlanFromOrderCode(neutralCode, 50000)).toBeNull();
      expect(decodePlanFromOrderCode(neutralCode)).toBeNull();
    });
  });

  describe("buildPayosDescription", () => {
    it("builds a clean uppercase string <= 25 characters for cram_pass", () => {
      const orderCode = 17300000012341;
      const desc = buildPayosDescription("cram_pass", orderCode);

      expect(desc).toBe("CLUTCH CRAM 012341");
      expect(desc.length).toBeLessThanOrEqual(25);
      expect(/^[A-Z0-9 ]+$/.test(desc)).toBe(true);
    });

    it("builds a clean uppercase string <= 25 characters for pro", () => {
      const orderCode = 17300000056782;
      const desc = buildPayosDescription("pro", orderCode);

      expect(desc).toBe("CLUTCH PRO 056782");
      expect(desc.length).toBeLessThanOrEqual(25);
      expect(/^[A-Z0-9 ]+$/.test(desc)).toBe(true);
    });

    it("never exceeds 25 characters regardless of code length", () => {
      const hugeCode = Number.MAX_SAFE_INTEGER;
      const descPro = buildPayosDescription("pro", hugeCode);
      const descCram = buildPayosDescription("cram_pass", hugeCode);

      expect(descPro.length).toBeLessThanOrEqual(25);
      expect(descCram.length).toBeLessThanOrEqual(25);
    });
  });

  describe("computePayosPaymentSignature", () => {
    const params = {
      amount: 69000,
      cancelUrl: "https://clutcharena.vn/?payment=cancelled&orderCode=1001",
      description: "CLUTCH CRAM 001001",
      orderCode: 1001,
      returnUrl: "https://clutcharena.vn/?payment=success&orderCode=1001",
    };
    const key = "test_checksum_secret_key";

    it("computes deterministic HMAC-SHA256 matching alphabetical query string", () => {
      const expectedDataStr = `amount=${params.amount}&cancelUrl=${params.cancelUrl}&description=${params.description}&orderCode=${params.orderCode}&returnUrl=${params.returnUrl}`;
      const expectedSignature = createHmac("sha256", key)
        .update(expectedDataStr)
        .digest("hex");

      const signature1 = computePayosPaymentSignature(params, key);
      const signature2 = computePayosPaymentSignature(params, key);

      expect(signature1).toBe(expectedSignature);
      expect(signature1).toBe(signature2);
      expect(signature1).toHaveLength(64);
    });

    it("falls back to process.env.PAYOS_CHECKSUM_KEY if key argument is omitted", () => {
      process.env.PAYOS_CHECKSUM_KEY = key;
      const signature = computePayosPaymentSignature(params);

      const expectedDataStr = `amount=${params.amount}&cancelUrl=${params.cancelUrl}&description=${params.description}&orderCode=${params.orderCode}&returnUrl=${params.returnUrl}`;
      const expected = createHmac("sha256", key)
        .update(expectedDataStr)
        .digest("hex");

      expect(signature).toBe(expected);
    });

    it("changes when any single parameter is altered", () => {
      const baseSig = computePayosPaymentSignature(params, key);

      const alteredAmount = computePayosPaymentSignature(
        { ...params, amount: 70000 },
        key,
      );
      expect(alteredAmount).not.toBe(baseSig);

      const alteredOrder = computePayosPaymentSignature(
        { ...params, orderCode: 1002 },
        key,
      );
      expect(alteredOrder).not.toBe(baseSig);

      const alteredDesc = computePayosPaymentSignature(
        { ...params, description: "CLUTCH PRO 001001" },
        key,
      );
      expect(alteredDesc).not.toBe(baseSig);
    });
  });

  describe("verifyPayosWebhookSignature", () => {
    const key = "webhook_secret_key_123";

    it("validates a valid signature across sorted data fields", () => {
      const webhookData: Record<string, unknown> = {
        orderCode: 123456,
        amount: 69000,
        description: "CLUTCH CRAM 123456",
        accountNumber: "0123456789",
        reference: "FT2610281234",
        transactionDateTime: "2026-10-28 12:00:00",
        currency: "VND",
        paymentLinkId: "pl_test_123",
        code: "00",
        desc: "success",
      };

      // Construct expected sorted query string manually
      const sortedKeys = Object.keys(webhookData).sort();
      const dataStr = sortedKeys
        .map((k) => `${k}=${String(webhookData[k])}`)
        .join("&");
      const validSignature = createHmac("sha256", key)
        .update(dataStr)
        .digest("hex");

      const isValid = verifyPayosWebhookSignature(
        webhookData,
        validSignature,
        key,
      );
      expect(isValid).toBe(true);
    });

    it("rejects tampered data", () => {
      const webhookData: Record<string, unknown> = {
        orderCode: 123456,
        amount: 69000,
        description: "CLUTCH CRAM 123456",
      };

      const validSignature = createHmac("sha256", key)
        .update("amount=69000&description=CLUTCH CRAM 123456&orderCode=123456")
        .digest("hex");

      // Tamper amount
      const tamperedData = { ...webhookData, amount: 999000 };
      expect(
        verifyPayosWebhookSignature(tamperedData, validSignature, key),
      ).toBe(false);
    });

    it("rejects tampered signature", () => {
      const webhookData: Record<string, unknown> = {
        orderCode: 123456,
        amount: 69000,
      };

      const validSignature = createHmac("sha256", key)
        .update("amount=69000&orderCode=123456")
        .digest("hex");

      const tamperedSignature =
        validSignature.slice(0, -2) + (validSignature.endsWith("a") ? "b" : "a");

      expect(
        verifyPayosWebhookSignature(webhookData, tamperedSignature, key),
      ).toBe(false);
    });

    it("handles null, undefined, 'null', and 'undefined' by normalizing to empty string", () => {
      const dataWithNulls: Record<string, unknown> = {
        amount: 69000,
        optionalField1: null,
        optionalField2: undefined,
        optionalField3: "null",
        optionalField4: "undefined",
        orderCode: 123456,
      };

      // Expected query string with normalized empty values:
      // sorted keys: amount, optionalField1, optionalField2, optionalField3, optionalField4, orderCode
      const expectedDataStr =
        "amount=69000&optionalField1=&optionalField2=&optionalField3=&optionalField4=&orderCode=123456";
      const expectedSignature = createHmac("sha256", key)
        .update(expectedDataStr)
        .digest("hex");

      expect(
        verifyPayosWebhookSignature(dataWithNulls, expectedSignature, key),
      ).toBe(true);
    });

    it("handles nested objects with deterministic key sorting", () => {
      const dataWithNested: Record<string, unknown> = {
        orderCode: 1001,
        meta: {
          zKey: "valZ",
          aKey: "valA",
        },
      };

      // aKey comes before zKey inside meta
      const expectedDataStr = 'meta={"aKey":"valA","zKey":"valZ"}&orderCode=1001';
      const expectedSignature = createHmac("sha256", key)
        .update(expectedDataStr)
        .digest("hex");

      expect(
        verifyPayosWebhookSignature(dataWithNested, expectedSignature, key),
      ).toBe(true);
    });

    it("returns false on empty or malformed signatures", () => {
      const webhookData = { orderCode: 123456 };

      expect(verifyPayosWebhookSignature(webhookData, "", key)).toBe(false);
      expect(verifyPayosWebhookSignature(webhookData, "   ", key)).toBe(false);
      expect(
        verifyPayosWebhookSignature(webhookData, "short_invalid", key),
      ).toBe(false);
    });
  });

  describe("buildVietQrImageUrl", () => {
    it("builds the compact2 VietQR image URL with proper encoding", () => {
      const url = buildVietQrImageUrl({
        bin: "970415",
        accountNumber: "11336699",
        amount: 69000,
        description: "CLUTCH CRAM 012341",
      });

      expect(url).toBe(
        "https://img.vietqr.io/image/970415-11336699-compact2.png?amount=69000&addInfo=CLUTCH%20CRAM%20012341",
      );
    });

    it("appends accountName parameter when provided", () => {
      const url = buildVietQrImageUrl({
        bin: "970415",
        accountNumber: "11336699",
        amount: 299000,
        description: "CLUTCH PRO 012342",
        accountName: "NGUYEN VAN A",
      });

      expect(url).toBe(
        "https://img.vietqr.io/image/970415-11336699-compact2.png?amount=299000&addInfo=CLUTCH%20PRO%20012342&accountName=NGUYEN%20VAN%20A",
      );
    });
  });

  describe("fulfillPayosOrder anti-hijacking & ownership verification", () => {
    beforeEach(() => {
      mockSubRecord = null;
      mockAuthUser = null;
      mockUpsertSubSpy.mockClear();
      mockUpsertProfileSpy.mockClear();
      mockUpsertUserProfileSpy.mockClear();
      mockAdminUpdateSpy.mockClear();
    });

    it("ignores hijacking attempts when an order is already bound to another user in database", async () => {
      mockSubRecord = {
        user_id: "victim_user_123",
        tier: "cram_pass",
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000012341,
        amount: 69000,
        fallbackUserId: "attacker_user_999",
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("victim_user_123");
      expect(result.userId).not.toBe("attacker_user_999");
      expect(result.tier).toBe("cram_pass");

      // Verify DB was updated for victim, never for attacker
      expect(mockUpsertSubSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payos_17300000012341",
          user_id: "victim_user_123",
        }),
      );
      expect(mockUpsertProfileSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "victim_user_123",
        }),
      );
      expect(mockUpsertProfileSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          id: "attacker_user_999",
        }),
      );
    });

    it("fulfills for recorded user when no fallbackUserId is provided (e.g. webhook invocation)", async () => {
      mockSubRecord = {
        user_id: "legit_user_456",
        tier: "pro",
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 299000,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("legit_user_456");
      expect(result.tier).toBe("pro");
    });

    it("allows fallbackUserId ONLY when no user_id is in DB AND authenticated userToken matches fallbackUserId", async () => {
      mockSubRecord = null;
      mockAuthUser = { id: "authenticated_user_789" };

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 299000,
        fallbackUserId: "authenticated_user_789",
        userToken: "valid_token",
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("authenticated_user_789");
      expect(mockUpsertProfileSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "authenticated_user_789",
        }),
      );
    });

    it("refuses fallbackUserId when token does not match candidate fallbackUserId", async () => {
      mockSubRecord = null;
      // Token resolves to attacker_user_id, but fallbackUserId tries to claim for someone else
      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 299000,
        fallbackUserId: "victim_user_123",
        userToken: "attacker_token",
      });

      expect(result.fulfilled).toBe(false);
      expect(result.userId).toBeNull();
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("refuses unauthenticated fallbackUserId when no userToken is provided and Supabase is configured", async () => {
      mockSubRecord = null;

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 299000,
        fallbackUserId: "unauthenticated_guest",
      });

      expect(result.fulfilled).toBe(false);
      expect(result.userId).toBeNull();
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("returns fulfilled: false when order has no DB record and no fallbackUserId is provided", async () => {
      mockSubRecord = null;

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 299000,
      });

      expect(result.fulfilled).toBe(false);
      expect(result.userId).toBeNull();
    });
  });

  describe("POST /api/payments/payos/verify Route Verification & Anti-Hijack Guard", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      mockSubRecord = null;
      mockAuthUser = null;
      mockUpsertSubSpy.mockClear();
      mockUpsertProfileSpy.mockClear();

      process.env.PAYOS_CLIENT_ID = "client_123";
      process.env.PAYOS_API_KEY = "api_key_456";
      process.env.PAYOS_CHECKSUM_KEY = "checksum_key_789";

      global.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("api-merchant.payos.vn/v2/payment-requests")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({
              code: "00",
              desc: "success",
              data: {
                orderCode: 17300000012341,
                status: "PAID",
                amount: 69000,
                amountPaid: 69000,
                transactions: [],
              },
            }),
          } as Response;
        }
        return originalFetch(url);
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("disallows unauthenticated arbitrary body.userId from fulfilling an unrecorded order", async () => {
      mockSubRecord = null;

      const req = new Request("http://localhost:3000/api/payments/payos/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderCode: 17300000012341,
          userId: "arbitrary_attacker_id",
        }),
      });

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({
        ok: true,
        paid: true,
        status: "PAID",
        verified: false,
        requiresAuth: true,
      });

      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("fulfills an existing recorded order for the recorded user even if unauthenticated caller supplies a different userId", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "cram_pass",
      };

      const req = new Request("http://localhost:3000/api/payments/payos/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderCode: 17300000012341,
          userId: "arbitrary_attacker_id",
        }),
      });

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.paid).toBe(true);
      expect(json.fulfilled).toBe(true);
      expect(json.tier).toBe("cram_pass");

      expect(mockUpsertProfileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "recorded_owner_123" }),
      );
      expect(mockUpsertProfileSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "arbitrary_attacker_id" }),
      );
    });

    it("allows authenticated caller to fulfill their own order", async () => {
      mockSubRecord = null;
      mockAuthUser = { id: "legit_logged_in_user" };

      const req = new Request("http://localhost:3000/api/payments/payos/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid_token",
        },
        body: JSON.stringify({
          orderCode: 17300000012341,
        }),
      });

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.paid).toBe(true);
      expect(json.fulfilled).toBe(true);
      expect(json.tier).toBe("cram_pass");

      expect(mockUpsertProfileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "legit_logged_in_user" }),
      );
    });

    it("blocks an authenticated attacker from hijacking an order already recorded to another user", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "cram_pass",
      };

      const req = new Request("http://localhost:3000/api/payments/payos/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer attacker_token",
        },
        body: JSON.stringify({
          orderCode: 17300000012341,
        }),
      });

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.paid).toBe(true);
      // For attacker, fulfilled is false because attacker is not the owner
      expect(json.fulfilled).toBe(false);

      // Victim profile was updated, attacker profile was NOT
      expect(mockUpsertProfileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "recorded_owner_123" }),
      );
      expect(mockUpsertProfileSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "attacker_user_id" }),
      );
    });

    it("returns paid: false when PayOS reports status is not PAID", async () => {
      global.fetch = vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            code: "00",
            desc: "success",
            data: {
              orderCode: 17300000012341,
              status: "PENDING",
              amount: 69000,
              amountPaid: 0,
              transactions: [],
            },
          }),
        } as Response;
      });

      const req = new Request("http://localhost:3000/api/payments/payos/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderCode: 17300000012341,
        }),
      });

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({
        ok: true,
        paid: false,
        status: "PENDING",
        amount: 69000,
      });
    });

    it("returns 400 when orderCode is invalid or non-positive", async () => {
      const req = new Request("http://localhost:3000/api/payments/payos/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderCode: -5,
        }),
      });

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error).toContain("positive integer");
    });
  });
});
