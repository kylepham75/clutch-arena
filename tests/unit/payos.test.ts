import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  isPayosConfigured,
  generatePayosOrderCode,
  decodePlanFromOrderCode,
  buildPayosDescription,
  computePayosPaymentSignature,
  verifyPayosWebhookSignature,
  buildVietQrImageUrl,
  type PayosPlanId,
} from "@/lib/payments/payos";

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
});
