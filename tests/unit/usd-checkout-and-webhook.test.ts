import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createHmac } from "node:crypto";
import {
  EXPECTED_PLAN_AMOUNTS_USD,
  EXPECTED_PLAN_AMOUNTS_CENTS,
  isUsdCheckoutConfigured,
  createUsdCheckoutSession,
  verifyUsdWebhookSignature,
  fulfillUsdOrder,
  clearFulfilledUsdOrderCache,
  mapUsdPlanToUserTier,
  mapUsdPlanToCycle,
  type UsdPlanId,
} from "@/lib/payments/polar";
import { POST as createUsdRoute } from "@/app/api/payments/usd/create/route";
import { POST as polarWebhookRoute } from "@/app/api/webhooks/polar/route";
import * as serverGuard from "@/lib/auth/server-guard";

describe("USD Checkout & Polar/LemonSqueezy Webhook Engine", () => {
  const originalEnv = { ...process.env };
  const TEST_SECRET = "whsec_test_secret_key_clutch_arena_12345";

  beforeEach(() => {
    vi.restoreAllMocks();
    clearFulfilledUsdOrderCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    clearFulfilledUsdOrderCache();
    process.env = originalEnv;
  });

  describe("Plan Constants & Mappers", () => {
    it("exports exact expected plan amounts in USD", () => {
      expect(EXPECTED_PLAN_AMOUNTS_USD.cram_pass).toBe(4.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.pro_monthly).toBe(9.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.pro).toBe(29.0);
      expect(EXPECTED_PLAN_AMOUNTS_USD.pro_semester).toBe(29.0);
      expect(EXPECTED_PLAN_AMOUNTS_USD.tutor).toBe(24.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.tutor_guild).toBe(24.99);
    });

    it("exports exact expected plan amounts in cents", () => {
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.cram_pass).toBe(499);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.pro_monthly).toBe(999);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.pro).toBe(2900);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.pro_semester).toBe(2900);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.tutor).toBe(2499);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.tutor_guild).toBe(2499);
    });

    it("maps USD plan IDs to canonical UserTier", () => {
      expect(mapUsdPlanToUserTier("cram_pass")).toBe("cram_pass");
      expect(mapUsdPlanToUserTier("pro_monthly")).toBe("pro_monthly");
      expect(mapUsdPlanToUserTier("pro")).toBe("pro");
      expect(mapUsdPlanToUserTier("pro_semester")).toBe("pro");
      expect(mapUsdPlanToUserTier("tutor")).toBe("tutor");
      expect(mapUsdPlanToUserTier("tutor_guild")).toBe("tutor");
    });

    it("maps USD plan IDs to correct billing cycles", () => {
      expect(mapUsdPlanToCycle("cram_pass")).toBe("one_time");
      expect(mapUsdPlanToCycle("pro_monthly")).toBe("monthly");
      expect(mapUsdPlanToCycle("pro")).toBe("semester");
      expect(mapUsdPlanToCycle("pro_semester")).toBe("semester");
      expect(mapUsdPlanToCycle("tutor")).toBe("monthly");
      expect(mapUsdPlanToCycle("tutor_guild")).toBe("monthly");
    });
  });

  describe("isUsdCheckoutConfigured()", () => {
    it("returns false when no USD environment variables are set", () => {
      delete process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED;
      delete process.env.POLAR_ACCESS_TOKEN;
      delete process.env.LEMONSQUEEZY_API_KEY;
      delete process.env.POLAR_CHECKOUT_BASE_URL;
      delete process.env.LEMONSQUEEZY_CHECKOUT_BASE_URL;

      expect(isUsdCheckoutConfigured()).toBe(false);
    });

    it("returns true when NEXT_PUBLIC_USD_CHECKOUT_ENABLED is 'true'", () => {
      process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED = "true";
      expect(isUsdCheckoutConfigured()).toBe(true);
    });

    it("returns true when POLAR_ACCESS_TOKEN is configured", () => {
      process.env.POLAR_ACCESS_TOKEN = "polar_at_123456789";
      expect(isUsdCheckoutConfigured()).toBe(true);
    });

    it("returns true when LEMONSQUEEZY_API_KEY is configured", () => {
      process.env.LEMONSQUEEZY_API_KEY = "lsq_key_123456789";
      expect(isUsdCheckoutConfigured()).toBe(true);
    });

    it("returns true when plan-specific checkout URL is configured", () => {
      process.env.POLAR_CHECKOUT_URL_CRAM_PASS = "https://buy.polar.sh/cram";
      expect(isUsdCheckoutConfigured()).toBe(true);
    });
  });

  describe("createUsdCheckoutSession()", () => {
    it("throws an error for an invalid planId", async () => {
      await expect(
        createUsdCheckoutSession({
          planId: "invalid_plan" as UsdPlanId,
          userId: "user_123",
          origin: "http://localhost:3000",
        }),
      ).rejects.toThrow('Invalid USD plan ID: "invalid_plan"');
    });

    it("creates a checkout session using fallback URL when API is not called", async () => {
      const result = await createUsdCheckoutSession({
        planId: "cram_pass",
        userId: "user_test_1",
        userEmail: "student@example.edu",
        origin: "http://localhost:3000",
      });

      expect(result.checkoutId).toMatch(/^polar_chk_/);
      expect(result.provider).toBe("polar");
      expect(result.planId).toBe("cram_pass");
      expect(result.amountUsd).toBe(4.99);
      expect(result.currency).toBe("USD");
      expect(result.checkoutUrl).toContain(result.checkoutId);
      expect(result.checkoutUrl).toContain("user_test_1");
      expect(result.checkoutUrl).toContain("student%40example.edu");
    });

    it("creates a checkout session using configured direct checkout URL", async () => {
      process.env.POLAR_CHECKOUT_URL_TUTOR = "https://polar.sh/checkout/tutor-guild";

      const result = await createUsdCheckoutSession({
        planId: "tutor",
        userId: "tutor_user_99",
        userEmail: "ta@university.edu",
        origin: "http://localhost:3000",
      });

      expect(result.provider).toBe("polar");
      expect(result.planId).toBe("tutor");
      expect(result.amountUsd).toBe(24.99);
      expect(result.checkoutUrl).toContain("https://polar.sh/checkout/tutor-guild");
      expect(result.checkoutUrl).toContain("checkout%5Bcustom%5D%5Buser_id%5D=tutor_user_99");
      expect(result.checkoutUrl).toContain("checkout%5Bcustom%5D%5Bplan_id%5D=tutor");
    });

    it("prefers lemonsqueezy provider when only Lemon Squeezy env vars are set", async () => {
      delete process.env.POLAR_ACCESS_TOKEN;
      delete process.env.POLAR_CHECKOUT_BASE_URL;
      process.env.LEMONSQUEEZY_API_KEY = "lsq_test_key";
      process.env.LEMONSQUEEZY_CHECKOUT_URL_PRO = "https://clutch.lemonsqueezy.com/buy/pro";

      const result = await createUsdCheckoutSession({
        planId: "pro",
        userId: "user_ls_1",
        origin: "http://localhost:3000",
      });

      expect(result.provider).toBe("lemonsqueezy");
      expect(result.planId).toBe("pro");
      expect(result.amountUsd).toBe(29.0);
      expect(result.checkoutUrl).toContain("https://clutch.lemonsqueezy.com/buy/pro");
    });
  });

  describe("verifyUsdWebhookSignature()", () => {
    const rawPayload = JSON.stringify({ type: "order.paid", data: { id: "order_123" } });

    it("returns false if raw body is missing or signature is null", () => {
      expect(verifyUsdWebhookSignature("", "sig_123", TEST_SECRET)).toBe(false);
      expect(verifyUsdWebhookSignature(rawPayload, null, TEST_SECRET)).toBe(false);
      expect(verifyUsdWebhookSignature(rawPayload, "", TEST_SECRET)).toBe(false);
      expect(verifyUsdWebhookSignature(rawPayload, "sig_123", "")).toBe(false);
    });

    it("verifies a standard hex HMAC signature successfully", () => {
      const signature = createHmac("sha256", TEST_SECRET).update(rawPayload).digest("hex");
      expect(verifyUsdWebhookSignature(rawPayload, signature, TEST_SECRET)).toBe(true);
    });

    it("verifies a signature prefixed with 'sha256='", () => {
      const signature = createHmac("sha256", TEST_SECRET).update(rawPayload).digest("hex");
      expect(verifyUsdWebhookSignature(rawPayload, `sha256=${signature}`, TEST_SECRET)).toBe(true);
    });

    it("verifies Standard Webhook base64 format ('v1,<base64>')", () => {
      const signature = createHmac("sha256", TEST_SECRET).update(rawPayload).digest("base64");
      expect(verifyUsdWebhookSignature(rawPayload, `v1,${signature}`, TEST_SECRET)).toBe(true);
      expect(verifyUsdWebhookSignature(rawPayload, `v1=${signature}`, TEST_SECRET)).toBe(true);
    });

    it("rejects tampered raw body payloads", () => {
      const signature = createHmac("sha256", TEST_SECRET).update(rawPayload).digest("hex");
      const tamperedPayload = rawPayload + " ";
      expect(verifyUsdWebhookSignature(tamperedPayload, signature, TEST_SECRET)).toBe(false);
    });

    it("rejects signatures computed with the wrong secret", () => {
      const signature = createHmac("sha256", "wrong_secret").update(rawPayload).digest("hex");
      expect(verifyUsdWebhookSignature(rawPayload, signature, TEST_SECRET)).toBe(false);
    });
  });

  describe("fulfillUsdOrder()", () => {
    it("fulfills a cram_pass order and calculates 7-day expiration", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_cram_1",
        userId: "user_cram_1",
        planId: "cram_pass",
        amountUsd: 4.99,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.alreadyFulfilled).toBe(false);
      expect(result.userId).toBe("user_cram_1");
      expect(result.tier).toBe("cram_pass");

      const expDate = new Date(result.expiresAt).getTime();
      const expectedDays = (expDate - Date.now()) / (1000 * 60 * 60 * 24);
      expect(expectedDays).toBeGreaterThan(6.5);
      expect(expectedDays).toBeLessThan(7.5);
    });

    it("fulfills a pro_monthly order and calculates 30-day expiration", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_monthly_1",
        userId: "user_monthly_1",
        planId: "pro_monthly",
        amountUsd: 9.99,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("user_monthly_1");
      expect(result.tier).toBe("pro_monthly");

      const expDate = new Date(result.expiresAt).getTime();
      const expectedDays = (expDate - Date.now()) / (1000 * 60 * 60 * 24);
      expect(expectedDays).toBeGreaterThan(29);
      expect(expectedDays).toBeLessThan(31);
    });

    it("fulfills a pro semester order and calculates 120-day expiration", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_pro_1",
        userId: "user_pro_1",
        planId: "pro",
        amountUsd: 29.0,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("user_pro_1");
      expect(result.tier).toBe("pro");

      const expDate = new Date(result.expiresAt).getTime();
      const expectedDays = (expDate - Date.now()) / (1000 * 60 * 60 * 24);
      expect(expectedDays).toBeGreaterThan(118);
      expect(expectedDays).toBeLessThan(121);
    });

    it("fulfills a tutor plan order with 30-day expiration", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_tutor_1",
        userId: "user_tutor_1",
        planId: "tutor",
        amountUsd: 24.99,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("user_tutor_1");
      expect(result.tier).toBe("tutor");

      const expDate = new Date(result.expiresAt).getTime();
      const expectedDays = (expDate - Date.now()) / (1000 * 60 * 60 * 24);
      expect(expectedDays).toBeGreaterThan(29);
      expect(expectedDays).toBeLessThan(31);
    });

    it("accepts amounts given in cents (e.g. 2900 for pro plan)", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_cents_1",
        userId: "user_cents_1",
        planId: "pro",
        amountUsd: 2900,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.tier).toBe("pro");
    });

    it("rejects fulfillment when amount is lower than expected plan amount (anti-tamper)", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_tamper_1",
        userId: "user_tamper_1",
        planId: "pro",
        amountUsd: 1.0, // Should be 29.0 or 2900
      });

      expect(result.fulfilled).toBe(false);
    });

    it("is strictly idempotent: second call returns alreadyFulfilled: true without recalculating", async () => {
      const first = await fulfillUsdOrder({
        checkoutId: "chk_idempotent_1",
        userId: "user_idem_1",
        planId: "cram_pass",
        amountUsd: 4.99,
      });

      expect(first.fulfilled).toBe(true);
      expect(first.alreadyFulfilled).toBe(false);

      const second = await fulfillUsdOrder({
        checkoutId: "chk_idempotent_1",
        userId: "user_idem_1",
        planId: "cram_pass",
        amountUsd: 4.99,
      });

      expect(second.fulfilled).toBe(true);
      expect(second.alreadyFulfilled).toBe(true);
      expect(second.expiresAt).toBe(first.expiresAt);
    });

    it("clearing in-memory cache resets fulfillment tracking", async () => {
      await fulfillUsdOrder({
        checkoutId: "chk_cache_clear_1",
        userId: "user_cache_1",
        planId: "cram_pass",
        amountUsd: 4.99,
      });

      clearFulfilledUsdOrderCache();

      const fresh = await fulfillUsdOrder({
        checkoutId: "chk_cache_clear_1",
        userId: "user_cache_1",
        planId: "cram_pass",
        amountUsd: 4.99,
      });

      expect(fresh.alreadyFulfilled).toBe(false);
    });
  });

  describe("API Route: POST /api/payments/usd/create", () => {
    it("returns 503 when USD checkout is not configured", async () => {
      delete process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED;
      delete process.env.POLAR_ACCESS_TOKEN;
      delete process.env.LEMONSQUEEZY_API_KEY;
      delete process.env.POLAR_CHECKOUT_BASE_URL;
      delete process.env.LEMONSQUEEZY_CHECKOUT_BASE_URL;

      const req = new Request("http://localhost:3000/api/payments/usd/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "cram_pass" }),
      });

      const res = await createUsdRoute(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain("USD checkout is not configured");
    });

    it("returns 400 for invalid JSON body", async () => {
      process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED = "true";

      const req = new Request("http://localhost:3000/api/payments/usd/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid-json-string",
      });

      const res = await createUsdRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe("Invalid JSON body");
    });

    it("returns 401 AUTH_REQUIRED when user is not authenticated", async () => {
      process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED = "true";

      vi.spyOn(serverGuard, "verifyAuthToken").mockResolvedValue({
        authenticated: false,
        isGuest: true,
        tier: "guest",
        devMode: false,
      });

      const req = new Request("http://localhost:3000/api/payments/usd/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "cram_pass" }),
      });

      const res = await createUsdRoute(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe("AUTH_REQUIRED");
    });

    it("returns 400 when an invalid planId is passed", async () => {
      process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED = "true";

      vi.spyOn(serverGuard, "verifyAuthToken").mockResolvedValue({
        authenticated: true,
        user: { id: "user_test_400", email: "test@example.com" } as unknown as import("@supabase/supabase-js").User,
        tier: "contender",
        tierExpiresAt: null,
      });

      const req = new Request("http://localhost:3000/api/payments/usd/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "fake_tier_name" }),
      });

      const res = await createUsdRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain("Invalid planId");
    });

    it("returns 200 and checkout session for valid authenticated user across all tiers", async () => {
      process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED = "true";

      vi.spyOn(serverGuard, "verifyAuthToken").mockResolvedValue({
        authenticated: true,
        user: { id: "user_auth_valid", email: "auth_valid@clutch.gg" } as unknown as import("@supabase/supabase-js").User,
        tier: "contender",
        tierExpiresAt: null,
      });

      const tiersToTest: UsdPlanId[] = ["cram_pass", "pro_monthly", "pro", "tutor"];

      for (const planId of tiersToTest) {
        const req = new Request("http://localhost:3000/api/payments/usd/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ planId }),
        });

        const res = await createUsdRoute(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.checkout.planId).toBe(planId);
        expect(json.checkout.amountUsd).toBe(EXPECTED_PLAN_AMOUNTS_USD[planId]);
        expect(json.checkout.checkoutUrl).toBeDefined();
      }
    });
  });

  describe("API Route: POST /api/webhooks/polar", () => {
    it("returns 400 when webhook signature is missing or invalid", async () => {
      process.env.POLAR_WEBHOOK_SECRET = TEST_SECRET;

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "order.paid" }),
      });

      const res = await polarWebhookRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe("Invalid webhook signature");
    });

    it("processes Polar order.paid webhook and fulfills subscription", async () => {
      process.env.POLAR_WEBHOOK_SECRET = TEST_SECRET;

      const payload = {
        type: "order.paid",
        data: {
          id: "polar_order_webhook_1",
          amount: 29.0,
          customer_email: "student_polar@example.com",
          metadata: {
            userId: "user_polar_order_1",
            planId: "pro",
            checkoutId: "polar_chk_webhook_1",
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = createHmac("sha256", TEST_SECRET).update(rawBody).digest("hex");

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "webhook-signature": signature,
        },
        body: rawBody,
      });

      const res = await polarWebhookRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.received).toBe(true);

      // Verify that order is now fulfilled and cached
      const idempotentCheck = await fulfillUsdOrder({
        checkoutId: "polar_chk_webhook_1",
        userId: "user_polar_order_1",
        planId: "pro",
      });
      expect(idempotentCheck.alreadyFulfilled).toBe(true);
      expect(idempotentCheck.tier).toBe("pro");
    });

    it("processes Lemon Squeezy order_created webhook and fulfills subscription", async () => {
      process.env.LEMONSQUEEZY_WEBHOOK_SECRET = TEST_SECRET;

      const payload = {
        meta: {
          event_name: "order_created",
          custom_data: {
            user_id: "user_lemon_1",
            plan_id: "tutor",
            checkout_id: "lsq_chk_webhook_1",
          },
        },
        data: {
          id: "order_ls_123",
          attributes: {
            total_usd: 24.99,
            user_email: "tutor_ls@guild.edu",
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = createHmac("sha256", TEST_SECRET).update(rawBody).digest("hex");

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
        },
        body: rawBody,
      });

      const res = await polarWebhookRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.received).toBe(true);

      // Verify fulfillment
      const idempotentCheck = await fulfillUsdOrder({
        checkoutId: "lsq_chk_webhook_1",
        userId: "user_lemon_1",
        planId: "tutor",
      });
      expect(idempotentCheck.alreadyFulfilled).toBe(true);
      expect(idempotentCheck.tier).toBe("tutor");
    });
  });
});
