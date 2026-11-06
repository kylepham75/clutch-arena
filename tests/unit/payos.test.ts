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
  clearFulfilledOrderCache,
  isAdminTestEmail,
  createPayosPaymentLink,
  resolveTrustedPayosOrigin,
  isAllowedPayosOrigin,
  SANDBOX_TEST_AMOUNT_VND,
  EXPECTED_PLAN_AMOUNTS_VND,
  type PayosPlanId,
} from "@/lib/payments/payos";
import { POST as createPostRoute } from "@/app/api/payments/payos/create/route";
import { POST as verifyPostRoute } from "@/app/api/payments/payos/verify/route";
import { POST as webhookPostRoute } from "@/app/api/webhooks/payos/route";

let mockSubRecord: {
  id?: string;
  user_id: string;
  tier: string;
  amount?: number;
  status?: string;
  expires_at?: string;
  cogs_ceiling_usd?: number;
} | null = null;
let mockAuthUser: { id: string; email?: string } | null = null;
let mockProfileEmail: string | null = null;
let mockUpsertSubError: { message: string } | null = null;
const mockUpsertSubSpy = vi.fn();
const mockUpsertProfileSpy = vi.fn();
const mockUpsertUserProfileSpy = vi.fn();
const mockUpsertQuotaLedgerSpy = vi.fn();
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
              if (mockUpsertSubError) {
                return { error: mockUpsertSubError };
              }
              return { error: null };
            }),
          };
        }
        if (table === "user_quota_ledgers") {
          return {
            select: vi.fn(() => createChain(() => null)),
            upsert: vi.fn(async (data: unknown) => {
              mockUpsertQuotaLedgerSpy(data);
              return { error: null };
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn(() =>
              createChain(() =>
                mockProfileEmail ? { email: mockProfileEmail } : null,
              ),
            ),
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
            select: vi.fn(() =>
              createChain(() =>
                mockProfileEmail ? { email: mockProfileEmail } : null,
              ),
            ),
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
            return {
              data: {
                user: { id: "attacker_user_id", email: "attacker@evil.com" },
              },
              error: null,
            };
          }
          return { data: { user: null }, error: new Error("Invalid token") };
        }),
        admin: {
          getUserById: vi.fn(async (id: string) => {
            if (mockAuthUser && mockAuthUser.id === id) {
              return { data: { user: mockAuthUser }, error: null };
            }
            return { data: { user: null }, error: null };
          }),
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
    clearFulfilledOrderCache();
    mockUpsertSubError = null;
    mockUpsertQuotaLedgerSpy.mockClear();
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

    it("generates a valid safe integer for pro_semester ending in 2 and decodes it as pro", () => {
      const code = generatePayosOrderCode("pro_semester");

      expect(Number.isSafeInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code % 10).toBe(2);
      expect(decodePlanFromOrderCode(code)).toBe("pro");
    });

    it("generates a valid safe integer for pro_monthly ending in 3 and decodes it", () => {
      const code = generatePayosOrderCode("pro_monthly");

      expect(Number.isSafeInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code % 10).toBe(3);
      expect(decodePlanFromOrderCode(code)).toBe("pro_monthly");
    });

    it("generates a valid safe integer for tutor ending in 4 and decodes it", () => {
      const code = generatePayosOrderCode("tutor");

      expect(Number.isSafeInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code % 10).toBe(4);
      expect(decodePlanFromOrderCode(code)).toBe("tutor");
    });

    it("generates a valid safe integer for tutor_guild ending in 4 and decodes it as tutor", () => {
      const code = generatePayosOrderCode("tutor_guild");

      expect(Number.isSafeInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code % 10).toBe(4);
      expect(decodePlanFromOrderCode(code)).toBe("tutor");
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

    it("decodes plan from amount fallback for all 4 primary pricing tiers when orderCode last digit is neutral", () => {
      const neutralCode = 9876543210; // ends in 0
      expect(neutralCode % 10).toBe(0);

      // Cram pass (69k VND, and legacy 39k, sandbox 5k)
      expect(decodePlanFromOrderCode(neutralCode, 5000)).toBe("cram_pass");
      expect(decodePlanFromOrderCode(neutralCode, 39000)).toBe("cram_pass");
      expect(decodePlanFromOrderCode(neutralCode, 69000)).toBe("cram_pass");

      // Pro monthly (109k VND)
      expect(decodePlanFromOrderCode(neutralCode, 109000)).toBe("pro_monthly");

      // Pro semester (299k VND, and legacy 149k)
      expect(decodePlanFromOrderCode(neutralCode, 149000)).toBe("pro");
      expect(decodePlanFromOrderCode(neutralCode, 299000)).toBe("pro");

      // Tutor (399k VND)
      expect(decodePlanFromOrderCode(neutralCode, 399000)).toBe("tutor");

      // Unsupported or missing amounts
      expect(decodePlanFromOrderCode(neutralCode, 50000)).toBeNull();
      expect(decodePlanFromOrderCode(neutralCode, 0)).toBeNull();
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

    it("builds a clean uppercase string <= 25 characters for pro_semester with CLUTCH PRO prefix", () => {
      const orderCode = 17300000056782;
      const desc = buildPayosDescription("pro_semester", orderCode);

      expect(desc).toBe("CLUTCH PRO 056782");
      expect(desc.length).toBeLessThanOrEqual(25);
      expect(/^[A-Z0-9 ]+$/.test(desc)).toBe(true);
    });

    it("builds a clean uppercase string <= 25 characters for pro_monthly with CLUTCH MONTHLY prefix", () => {
      const orderCode = 17300000099993;
      const desc = buildPayosDescription("pro_monthly", orderCode);

      expect(desc).toBe("CLUTCH MONTHLY 099993");
      expect(desc.length).toBeLessThanOrEqual(25);
      expect(/^[A-Z0-9 ]+$/.test(desc)).toBe(true);
    });

    it("builds a clean uppercase string <= 25 characters for tutor with CLUTCH TUTOR prefix", () => {
      const orderCode = 17300000088884;
      const desc = buildPayosDescription("tutor", orderCode);

      expect(desc).toBe("CLUTCH TUTOR 088884");
      expect(desc.length).toBeLessThanOrEqual(25);
      expect(/^[A-Z0-9 ]+$/.test(desc)).toBe(true);
    });

    it("builds a clean uppercase string <= 25 characters for tutor_guild with CLUTCH TUTOR prefix", () => {
      const orderCode = 17300000088884;
      const desc = buildPayosDescription("tutor_guild", orderCode);

      expect(desc).toBe("CLUTCH TUTOR 088884");
      expect(desc.length).toBeLessThanOrEqual(25);
      expect(/^[A-Z0-9 ]+$/.test(desc)).toBe(true);
    });

    it("never exceeds 25 characters regardless of code length across all plan variants", () => {
      const hugeCode = Number.MAX_SAFE_INTEGER;
      const plans: PayosPlanId[] = [
        "cram_pass",
        "pro",
        "pro_semester",
        "pro_monthly",
        "tutor",
        "tutor_guild",
      ];

      for (const plan of plans) {
        const desc = buildPayosDescription(plan, hugeCode);
        expect(desc.length).toBeLessThanOrEqual(25);
        expect(/^[A-Z0-9 ]+$/.test(desc)).toBe(true);
      }
    });
  });

  describe("isAdminTestEmail Allowlist Guard", () => {
    it("returns true for exact allowlisted email", () => {
      process.env.ADMIN_TEST_EMAILS = "admin@clutcharena.vn,tester@clutch.io";
      expect(isAdminTestEmail("admin@clutcharena.vn")).toBe(true);
      expect(isAdminTestEmail("tester@clutch.io")).toBe(true);
    });

    it("returns true case-insensitively", () => {
      process.env.ADMIN_TEST_EMAILS = "admin@clutcharena.vn,tester@clutch.io";
      expect(isAdminTestEmail("ADMIN@CLUTCHARENA.VN")).toBe(true);
      expect(isAdminTestEmail("Tester@Clutch.IO")).toBe(true);
    });

    it("returns true for emails with leading and trailing whitespace", () => {
      process.env.ADMIN_TEST_EMAILS = "admin@clutcharena.vn,tester@clutch.io";
      expect(isAdminTestEmail("  admin@clutcharena.vn  ")).toBe(true);
      expect(isAdminTestEmail("  tester@clutch.io  ")).toBe(true);
    });

    it("correctly handles messy comma-separated lists with whitespace and trailing commas", () => {
      process.env.ADMIN_TEST_EMAILS =
        "  admin@clutcharena.vn , ,  tester@clutch.io ,  dev@arena.vn, ";
      expect(isAdminTestEmail("admin@clutcharena.vn")).toBe(true);
      expect(isAdminTestEmail("tester@clutch.io")).toBe(true);
      expect(isAdminTestEmail("dev@arena.vn")).toBe(true);
    });

    it("returns false for non-allowlisted email addresses", () => {
      process.env.ADMIN_TEST_EMAILS = "admin@clutcharena.vn";
      expect(isAdminTestEmail("hacker@malicious.com")).toBe(false);
      expect(isAdminTestEmail("student@university.edu.vn")).toBe(false);
      expect(isAdminTestEmail("admin@clutcharena.com")).toBe(false); // different TLD
    });

    it("returns false for empty string, whitespace-only, null, or undefined", () => {
      process.env.ADMIN_TEST_EMAILS = "admin@clutcharena.vn";
      expect(isAdminTestEmail("")).toBe(false);
      expect(isAdminTestEmail("   ")).toBe(false);
      expect(isAdminTestEmail(undefined)).toBe(false);
      expect(isAdminTestEmail(null)).toBe(false);
    });

    it("returns false when ADMIN_TEST_EMAILS is unset or empty", () => {
      delete process.env.ADMIN_TEST_EMAILS;
      expect(isAdminTestEmail("admin@clutcharena.vn")).toBe(false);

      process.env.ADMIN_TEST_EMAILS = "";
      expect(isAdminTestEmail("admin@clutcharena.vn")).toBe(false);

      process.env.ADMIN_TEST_EMAILS = "   ";
      expect(isAdminTestEmail("admin@clutcharena.vn")).toBe(false);
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
        validSignature.slice(0, -2) +
        (validSignature.endsWith("a") ? "b" : "a");

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

      const expectedDataStr =
        'meta={"aKey":"valA","zKey":"valZ"}&orderCode=1001';
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
      mockProfileEmail = null;
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

    it("refuses fulfillment when paid amount does not match recorded DB subscription amount", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "pro",
        amount: 299000,
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 69000, // Tampered underpayment
      });

      expect(result.fulfilled).toBe(false);
      expect(result.expiresAt).toBeNull();
      expect(mockUpsertSubSpy).not.toHaveBeenCalled();
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("refuses fulfillment when params.expectedAmount does not match params.amount", async () => {
      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 69000,
        expectedAmount: 299000,
      });

      expect(result.fulfilled).toBe(false);
      expect(result.expiresAt).toBeNull();
      expect(mockUpsertSubSpy).not.toHaveBeenCalled();
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("refuses fulfillment when params.expectedAmount does not match recorded DB amount", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "pro",
        amount: 299000,
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 299000,
        expectedAmount: 109000, // Parameter claims 109k, but DB recorded 299k
      });

      expect(result.fulfilled).toBe(false);
      expect(result.expiresAt).toBeNull();
      expect(mockUpsertSubSpy).not.toHaveBeenCalled();
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("successfully fulfills when paid amount matches recorded DB amount", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "pro",
        amount: 299000,
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 299000,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("recorded_owner_123");
      expect(result.tier).toBe("pro");
      expect(mockUpsertSubSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payos_17300000056782",
          user_id: "recorded_owner_123",
          amount: 299000,
          status: "active",
        }),
      );
    });

    it("refuses fulfillment for underpaid non-sandbox order even if recorded DB amount matches underpayment", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "pro",
        amount: 2000,
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000056782,
        amount: 2000,
        expectedAmount: 2000,
      });

      expect(result.fulfilled).toBe(false);
      expect(result.expiresAt).toBeNull();
      expect(mockUpsertSubSpy).not.toHaveBeenCalled();
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/payments/payos/verify Route Verification & Anti-Hijack Guard", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      mockSubRecord = null;
      mockAuthUser = null;
      mockProfileEmail = null;
      mockUpsertSubSpy.mockClear();
      mockUpsertProfileSpy.mockClear();
      mockUpsertUserProfileSpy.mockClear();
      mockUpsertQuotaLedgerSpy.mockClear();
      mockAdminUpdateSpy.mockClear();

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

    it("rejects unauthenticated requests to /verify with 401 AUTH_REQUIRED", async () => {
      mockSubRecord = null;

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderCode: 17300000012341,
            userId: "arbitrary_attacker_id",
          }),
        },
      );

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json).toEqual({
        ok: false,
        error: "AUTH_REQUIRED",
        verified: false,
        requiresAuth: true,
      });

      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("fulfills an existing recorded order for the authenticated recorded owner even if body supplies a different userId", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "cram_pass",
      };
      mockAuthUser = { id: "recorded_owner_123" };

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
            userId: "arbitrary_attacker_id",
          }),
        },
      );

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

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
          }),
        },
      );

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

    it("blocks an authenticated attacker from verifying or hijacking an order already recorded to another user", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "cram_pass",
      };

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer attacker_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
          }),
        },
      );

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.fulfilled).toBe(false);
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("returns paid: false when PayOS reports status is not PAID", async () => {
      mockAuthUser = { id: "legit_logged_in_user" };
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

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
          }),
        },
      );

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
      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderCode: -5,
          }),
        },
      );

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error).toContain("positive integer");
    });

    it("returns 400 Payment amount mismatch when paid amount from PayOS does not match recorded DB amount", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "pro",
        amount: 299000, // DB expects 299k
      };
      mockAuthUser = { id: "recorded_owner_123" };

      // global.fetch returns amountPaid: 69000 (attacker underpaid)
      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
          }),
        },
      );

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error).toBe("Payment amount mismatch");
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("successfully fulfills when paid amount matches recorded DB amount in verify route", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "cram_pass",
        amount: 69000,
      };
      mockAuthUser = { id: "recorded_owner_123" };

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
          }),
        },
      );

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
    });
  });

  describe("Sandbox 5,000 VND Protection & $0.05 COGS Ceiling", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      mockSubRecord = null;
      mockAuthUser = null;
      mockProfileEmail = null;
      mockUpsertSubSpy.mockClear();
      mockUpsertProfileSpy.mockClear();
      mockUpsertUserProfileSpy.mockClear();
      mockUpsertQuotaLedgerSpy.mockClear();
      mockAdminUpdateSpy.mockClear();

      process.env.PAYOS_CLIENT_ID = "client_123";
      process.env.PAYOS_API_KEY = "api_key_456";
      process.env.PAYOS_CHECKSUM_KEY = "checksum_key_789";
      process.env.ADMIN_TEST_EMAILS = "admin@clutcharena.vn";

      global.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("api-merchant.payos.vn/v2/payment-requests/")) {
          // getPayosPaymentInfo
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
                amount: 5000,
                amountPaid: 5000,
                transactions: [],
              },
            }),
          } as Response;
        }
        if (urlStr.includes("api-merchant.payos.vn/v2/payment-requests")) {
          // createPayosPaymentLink
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({
              code: "00",
              desc: "success",
              data: {
                orderCode: 17300000012341,
                amount: 5000,
                description: "CLUTCH CRAM 012341",
                bin: "970415",
                accountNumber: "11336699",
                accountName: "CLUTCH ARENA",
                checkoutUrl: "https://pay.payos.vn/web/test",
                qrCode: "000201...",
                status: "PENDING",
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

    it("createPayosPaymentLink throws error for non-allowlisted email on 5000 VND sandbox attempt", async () => {
      await expect(
        createPayosPaymentLink({
          planId: "cram_pass",
          origin: "https://clutcharena.vn",
          amount: 5000,
          userEmail: "unauthorized@example.com",
        }),
      ).rejects.toThrow("Sandbox test payment unauthorized for this account");
    });

    it("createPayosPaymentLink allows 5000 VND sandbox link creation for allowlisted admin email", async () => {
      const result = await createPayosPaymentLink({
        planId: "cram_pass",
        origin: "https://clutcharena.vn",
        amount: 5000,
        userEmail: "admin@clutcharena.vn",
      });

      expect(result.amount).toBe(5000);
      expect(Number.isSafeInteger(result.orderCode)).toBe(true);
      expect(result.orderCode % 10).toBe(1);
      expect(result.vietQrImageUrl).toContain("amount=5000");
    });

    it("POST /api/payments/payos/verify returns 403 when non-allowlisted user attempts to verify 5000 VND payment", async () => {
      mockSubRecord = {
        user_id: "non_admin_user_1",
        tier: "cram_pass",
        amount: 5000,
      };
      mockAuthUser = {
        id: "non_admin_user_1",
        email: "stranger@gmail.com",
      };

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
            email: "stranger@gmail.com",
          }),
        },
      );

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error).toBe(
        "Sandbox test payment unauthorized for this account",
      );
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("POST /api/payments/payos/verify fulfills 5000 VND payment with 0.05 COGS ceiling in app_metadata and user_quota_ledgers for allowlisted admin user", async () => {
      mockSubRecord = {
        user_id: "admin_user_1",
        tier: "cram_pass",
        amount: 5000,
      };
      mockAuthUser = {
        id: "admin_user_1",
        email: "admin@clutcharena.vn",
      };

      const req = new Request(
        "http://localhost:3000/api/payments/payos/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            orderCode: 17300000012341,
          }),
        },
      );

      const res = await verifyPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.paid).toBe(true);
      expect(json.fulfilled).toBe(true);
      expect(json.tier).toBe("cram_pass");
      expect(json.cogsCeilingUsd).toBe(0.05);

      expect(mockUpsertSubSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payos_17300000012341",
          user_id: "admin_user_1",
          amount: 5000,
          cogs_ceiling_usd: 0.05,
          status: "active",
        }),
      );
      expect(mockUpsertQuotaLedgerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user:admin_user_1",
          tier: "cram_pass",
          cogs_ceiling_usd: 0.05,
          updated_at: expect.any(String),
        }),
      );
      expect(mockUpsertProfileSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "admin_user_1",
          cogs_ceiling_usd: 0.05,
        }),
      );
      expect(mockAdminUpdateSpy).toHaveBeenCalledWith(
        "admin_user_1",
        expect.objectContaining({
          app_metadata: expect.objectContaining({
            tier: "cram_pass",
            plan_id: "cram_pass",
            cogs_ceiling_usd: 0.05,
            cogs_limit_usd: 0.05,
            is_sandbox: true,
          }),
        }),
      );
    });

    it("fulfillPayosOrder directly applies 0.05 COGS ceiling to user_quota_ledgers and app_metadata on 5000 VND / trial_24h payment", async () => {
      mockAuthUser = {
        id: "admin_user_1",
        email: "admin@clutcharena.vn",
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000012345, // ends in 5 -> trial_24h
        amount: 5000,
        fallbackUserId: "admin_user_1",
        userToken: "valid_token",
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("admin_user_1");
      expect(result.tier).toBe("trial_24h");
      expect(result.cogsCeilingUsd).toBe(0.05);

      expect(mockUpsertSubSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payos_17300000012345",
          user_id: "admin_user_1",
          amount: 5000,
          cogs_ceiling_usd: 0.05,
          status: "active",
        }),
      );
      expect(mockUpsertQuotaLedgerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user:admin_user_1",
          tier: "cram_pass",
          cogs_ceiling_usd: 0.05,
          updated_at: expect.any(String),
        }),
      );
      expect(mockUpsertProfileSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "admin_user_1",
          cogs_ceiling_usd: 0.05,
        }),
      );
      expect(mockAdminUpdateSpy).toHaveBeenCalledWith(
        "admin_user_1",
        expect.objectContaining({
          app_metadata: expect.objectContaining({
            tier: "cram_pass",
            plan_id: "trial_24h",
            cogs_ceiling_usd: 0.05,
            cogs_limit_usd: 0.05,
            is_sandbox: true,
          }),
        }),
      );
    });
  });

  describe("Idempotent Order Fulfillment & Replay Defense (SA-06)", () => {
    beforeEach(() => {
      mockSubRecord = null;
      mockAuthUser = null;
      mockProfileEmail = null;
      mockUpsertSubSpy.mockClear();
      mockUpsertProfileSpy.mockClear();
      mockUpsertUserProfileSpy.mockClear();
      mockUpsertQuotaLedgerSpy.mockClear();
      mockAdminUpdateSpy.mockClear();
    });

    it("returns immediately without extending expiresAt or mutating DB when subscription is already active in DB", async () => {
      const fixedExpiresAt = "2026-11-12T00:00:00.000Z";
      mockSubRecord = {
        id: "payos_17300000012341",
        user_id: "user_already_active",
        tier: "cram_pass",
        amount: 69000,
        status: "active",
        expires_at: fixedExpiresAt,
      };

      const result = await fulfillPayosOrder({
        orderCode: 17300000012341,
        amount: 69000,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.alreadyFulfilled).toBe(true);
      expect(result.status).toBe("active");
      expect(result.userId).toBe("user_already_active");
      expect(result.tier).toBe("cram_pass");
      expect(result.planId).toBe("cram_pass");
      expect(result.expiresAt).toBe(fixedExpiresAt);
      expect(result.expires_at).toBe(fixedExpiresAt);

      expect(mockUpsertSubSpy).not.toHaveBeenCalled();
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
      expect(mockUpsertUserProfileSpy).not.toHaveBeenCalled();
      expect(mockAdminUpdateSpy).not.toHaveBeenCalled();
    });

    it("prevents replay extension via in-memory idempotency guard when fulfillPayosOrder is called twice for the same orderCode", async () => {
      mockAuthUser = { id: "replay_test_user" };

      const firstResult = await fulfillPayosOrder({
        orderCode: 17300000099991,
        amount: 69000,
        fallbackUserId: "replay_test_user",
        userToken: "valid_token",
      });

      expect(firstResult.fulfilled).toBe(true);
      expect(firstResult.alreadyFulfilled).toBe(false);
      expect(mockUpsertSubSpy).toHaveBeenCalledTimes(1);
      expect(mockUpsertProfileSpy).toHaveBeenCalledTimes(1);
      expect(mockAdminUpdateSpy).toHaveBeenCalledTimes(1);

      const secondResult = await fulfillPayosOrder({
        orderCode: 17300000099991,
        amount: 69000,
        fallbackUserId: "replay_test_user",
        userToken: "valid_token",
      });

      expect(secondResult.fulfilled).toBe(true);
      expect(secondResult.alreadyFulfilled).toBe(true);
      expect(secondResult.expiresAt).toBe(firstResult.expiresAt);
      // Spy call counts must remain 1 (no duplicate writes on second invocation)
      expect(mockUpsertSubSpy).toHaveBeenCalledTimes(1);
      expect(mockUpsertProfileSpy).toHaveBeenCalledTimes(1);
      expect(mockAdminUpdateSpy).toHaveBeenCalledTimes(1);
    });

    it("prevents extending expiresAt when POST /api/payments/payos/verify is replayed for the same orderCode", async () => {
      const originalFetch = global.fetch;
      process.env.PAYOS_CLIENT_ID = "client_123";
      process.env.PAYOS_API_KEY = "api_key_456";
      process.env.PAYOS_CHECKSUM_KEY = "checksum_key_789";

      mockSubRecord = {
        id: "payos_17300000088881",
        user_id: "verify_replay_user",
        tier: "cram_pass",
        amount: 69000,
      };
      mockAuthUser = { id: "verify_replay_user" };

      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          code: "00",
          desc: "success",
          data: {
            orderCode: 17300000088881,
            status: "PAID",
            amount: 69000,
            amountPaid: 69000,
            transactions: [],
          },
        }),
      })) as unknown as typeof fetch;

      try {
        const makeReq = () =>
          new Request("http://localhost:3000/api/payments/payos/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer valid_token",
            },
            body: JSON.stringify({ orderCode: 17300000088881 }),
          });

        const res1 = await verifyPostRoute(makeReq());
        const json1 = await res1.json();

        expect(res1.status).toBe(200);
        expect(json1.fulfilled).toBe(true);
        expect(json1.alreadyFulfilled).toBe(false);
        expect(mockUpsertSubSpy).toHaveBeenCalledTimes(1);

        const res2 = await verifyPostRoute(makeReq());
        const json2 = await res2.json();

        expect(res2.status).toBe(200);
        expect(json2.fulfilled).toBe(true);
        expect(json2.alreadyFulfilled).toBe(true);
        expect(json2.expiresAt).toBe(json1.expiresAt);
        expect(mockUpsertSubSpy).toHaveBeenCalledTimes(1);
        expect(mockUpsertProfileSpy).toHaveBeenCalledTimes(1);
        expect(mockAdminUpdateSpy).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("Origin Allowlist Validation & /api/payments/payos/create Hardening (SA-06 / SA-17)", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      mockSubRecord = null;
      mockAuthUser = { id: "auth_buyer_1", email: "buyer@clutcharena.vn" };
      mockProfileEmail = null;
      mockUpsertSubError = null;
      mockUpsertSubSpy.mockClear();
      mockUpsertProfileSpy.mockClear();

      process.env.PAYOS_CLIENT_ID = "client_123";
      process.env.PAYOS_API_KEY = "api_key_456";
      process.env.PAYOS_CHECKSUM_KEY = "checksum_key_789";
      process.env.NEXT_PUBLIC_APP_URL = "https://clutcharena.vn";

      global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            code: "00",
            desc: "success",
            data: {
              orderCode: parsedBody.orderCode ?? 17300000012341,
              amount: parsedBody.amount ?? 69000,
              description: parsedBody.description ?? "CLUTCH CRAM",
              bin: "970415",
              accountNumber: "11336699",
              accountName: "CLUTCH ARENA",
              checkoutUrl: "https://pay.payos.vn/web/checkout",
              qrCode: "000201...",
              status: "PENDING",
            },
          }),
        } as Response;
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("rejects spoofed Origin header and falls back to canonical NEXT_PUBLIC_APP_URL", async () => {
      expect(isAllowedPayosOrigin("https://evil.example.com")).toBe(false);
      expect(isAllowedPayosOrigin("https://clutcharena.vn")).toBe(true);
      expect(resolveTrustedPayosOrigin("https://evil.example.com")).toBe(
        "https://clutcharena.vn",
      );

      const req = new Request(
        "http://localhost:3000/api/payments/payos/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
            Origin: "https://evil.example.com",
          },
          body: JSON.stringify({
            planId: "cram_pass",
          }),
        },
      );

      const res = await createPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const sentPayload = JSON.parse(String(fetchCall[1]?.body));
      expect(sentPayload.returnUrl).toContain("https://clutcharena.vn/?payment=success");
      expect(sentPayload.returnUrl).not.toContain("evil.example.com");
      expect(sentPayload.cancelUrl).toContain("https://clutcharena.vn/?payment=cancelled");
      expect(sentPayload.cancelUrl).not.toContain("evil.example.com");
    });

    it("rejects unauthenticated POST /api/payments/payos/create requests even when body.userId is supplied", async () => {
      mockAuthUser = null;
      mockProfileEmail = "victim@clutcharena.vn";

      const req = new Request(
        "http://localhost:3000/api/payments/payos/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            planId: "cram_pass",
            userId: "victim_profile_id",
            email: "victim@clutcharena.vn",
          }),
        },
      );

      const res = await createPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.ok).toBe(false);
      expect(json.error).toBe("AUTH_REQUIRED");
      expect(mockUpsertSubSpy).not.toHaveBeenCalled();
    });

    it("returns 500 and aborts PayOS link creation if pending user_subscriptions DB insert fails", async () => {
      mockUpsertSubError = { message: "Database connection refused" };

      const req = new Request(
        "http://localhost:3000/api/payments/payos/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            planId: "cram_pass",
          }),
        },
      );

      const res = await createPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.ok).toBe(false);
      expect(json.error).toContain("Failed to persist pending subscription");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("ignores non-5000 client amount in createPayosPaymentLink and POST /create, enforcing canonical plan price", async () => {
      // 1. Direct call to createPayosPaymentLink with non-5000 client amount
      const directResult = await createPayosPaymentLink({
        planId: "pro",
        origin: "https://clutcharena.vn",
        amount: 2000,
        userEmail: "buyer@clutcharena.vn",
      });

      expect(directResult.amount).toBe(299000);
      expect(directResult.vietQrImageUrl).toContain("amount=299000");

      // 2. HTTP POST route call with non-5000 client amount
      const req = new Request(
        "http://localhost:3000/api/payments/payos/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid_token",
          },
          body: JSON.stringify({
            planId: "pro",
            amount: 2000,
          }),
        },
      );

      const res = await createPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);

      expect(mockUpsertSubSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: "pro",
          amount: 299000,
        }),
      );

      const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const fetchCall = fetchCalls[fetchCalls.length - 1];
      expect(fetchCall).toBeDefined();
      const sentPayload = JSON.parse(String(fetchCall[1]?.body));
      expect(sentPayload.amount).toBe(299000);
      expect(sentPayload.items[0].price).toBe(299000);
    });
  });

  describe("PayOS Webhook Security & Tampering Defenses", () => {
    const key = "webhook_secret_key_123";

    beforeEach(() => {
      mockSubRecord = null;
      mockAuthUser = null;
      mockProfileEmail = null;
      mockUpsertSubSpy.mockClear();
      mockUpsertProfileSpy.mockClear();
      mockUpsertUserProfileSpy.mockClear();
      mockAdminUpdateSpy.mockClear();

      process.env.PAYOS_CHECKSUM_KEY = key;
      process.env.ADMIN_TEST_EMAILS = "admin@clutcharena.vn";
    });

    it("webhook skips fulfillment when received amount does not match recorded DB amount", async () => {
      mockSubRecord = {
        user_id: "recorded_owner_123",
        tier: "pro",
        amount: 299000,
      };

      const webhookData: Record<string, unknown> = {
        orderCode: 17300000056782,
        amount: 69000, // Attacker manipulated amount to 69k
        description: "CLUTCH PRO 056782",
      };

      const sortedKeys = Object.keys(webhookData).sort();
      const dataStr = sortedKeys
        .map((k) => `${k}=${String(webhookData[k])}`)
        .join("&");
      const signature = createHmac("sha256", key)
        .update(dataStr)
        .digest("hex");

      const req = new Request("http://localhost:3000/api/webhooks/payos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "00",
          data: webhookData,
          signature,
        }),
      });

      const res = await webhookPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe("Payment amount mismatch; skipped fulfillment");
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });

    it("webhook skips fulfillment for 5000 VND sandbox payment when user is not allowlisted admin", async () => {
      mockSubRecord = {
        user_id: "regular_user_123",
        tier: "cram_pass",
        amount: 5000,
      };
      mockProfileEmail = "regular_student@school.edu.vn";

      const webhookData: Record<string, unknown> = {
        orderCode: 17300000012341,
        amount: 5000,
        description: "CLUTCH CRAM 012341",
      };

      const sortedKeys = Object.keys(webhookData).sort();
      const dataStr = sortedKeys
        .map((k) => `${k}=${String(webhookData[k])}`)
        .join("&");
      const signature = createHmac("sha256", key)
        .update(dataStr)
        .digest("hex");

      const req = new Request("http://localhost:3000/api/webhooks/payos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "00",
          data: webhookData,
          signature,
        }),
      });

      const res = await webhookPostRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe(
        "Sandbox test unauthorized; skipped fulfillment",
      );
      expect(mockUpsertProfileSpy).not.toHaveBeenCalled();
    });
  });
});
