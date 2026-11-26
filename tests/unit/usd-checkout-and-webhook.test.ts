import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXPECTED_PLAN_AMOUNTS_USD,
  EXPECTED_PLAN_AMOUNTS_CENTS,
  isUsdCheckoutConfigured,
  createUsdCheckoutSession,
  verifyUsdWebhookSignature,
  fulfillUsdOrder,
  revokeUsdSubscription,
  clearFulfilledUsdOrderCache,
  mapUsdPlanToUserTier,
  mapUsdPlanToCycle,
  type UsdPlanId,
} from "@/lib/payments/polar";
import {
  getUserSquadInvites,
  redeemSquadInviteCode,
} from "@/lib/payments/squad-invites";
import { POST as createUsdRoute } from "@/app/api/payments/usd/create/route";
import { POST as polarWebhookRoute } from "@/app/api/webhooks/polar/route";
import * as serverGuard from "@/lib/auth/server-guard";
import * as serverHelpers from "@/lib/supabase/server-helpers";

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
      expect(EXPECTED_PLAN_AMOUNTS_USD.cram_pass).toBe(3.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.cram_squad_3).toBe(8.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.pro_monthly).toBe(7.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.pro).toBe(11.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.pro_semester).toBe(11.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.tutor).toBe(19.99);
      expect(EXPECTED_PLAN_AMOUNTS_USD.tutor_guild).toBe(19.99);
    });

    it("exports exact expected plan amounts in cents", () => {
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.cram_pass).toBe(399);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.cram_squad_3).toBe(899);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.pro_monthly).toBe(799);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.pro).toBe(1199);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.pro_semester).toBe(1199);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.tutor).toBe(1999);
      expect(EXPECTED_PLAN_AMOUNTS_CENTS.tutor_guild).toBe(1999);
    });

    it("maps USD plan IDs to canonical UserTier", () => {
      expect(mapUsdPlanToUserTier("cram_pass")).toBe("cram_pass");
      expect(mapUsdPlanToUserTier("cram_squad_3")).toBe("cram_pass");
      expect(mapUsdPlanToUserTier("pro_monthly")).toBe("pro_monthly");
      expect(mapUsdPlanToUserTier("pro")).toBe("pro");
      expect(mapUsdPlanToUserTier("pro_semester")).toBe("pro");
      expect(mapUsdPlanToUserTier("tutor")).toBe("tutor");
      expect(mapUsdPlanToUserTier("tutor_guild")).toBe("tutor");
    });

    it("maps USD plan IDs to correct billing cycles", () => {
      expect(mapUsdPlanToCycle("cram_pass")).toBe("one_time");
      expect(mapUsdPlanToCycle("cram_squad_3")).toBe("one_time");
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
      expect(result.amountUsd).toBe(3.99);
      expect(result.currency).toBe("USD");
      expect(result.checkoutUrl).toContain(result.checkoutId);
      expect(result.checkoutUrl).toContain("user_test_1");
      expect(result.checkoutUrl).toContain("student%40example.edu");
    });

    it("creates a checkout session for cram_squad_3 at $8.99", async () => {
      const result = await createUsdCheckoutSession({
        planId: "cram_squad_3",
        userId: "user_squad_1",
        userEmail: "squad@example.edu",
        origin: "http://localhost:3000",
      });

      expect(result.checkoutId).toMatch(/^polar_chk_/);
      expect(result.provider).toBe("polar");
      expect(result.planId).toBe("cram_squad_3");
      expect(result.amountUsd).toBe(8.99);
      expect(result.currency).toBe("USD");
      expect(result.checkoutUrl).toContain("plan_id=cram_squad_3");
      expect(result.checkoutUrl).toContain("amount=8.99");
    });

    it("does not fall back to POLAR_PRODUCT_ID_CRAM_PASS or POLAR_PRODUCT_ID for cram_squad_3 when POLAR_PRODUCT_ID_CRAM_SQUAD_3 is unset", async () => {
      process.env.POLAR_ACCESS_TOKEN = "polar_at_test_123";
      process.env.POLAR_PRODUCT_ID_CRAM_PASS = "prod_cram_pass_only";
      process.env.POLAR_PRODUCT_ID = "prod_generic_fallback";
      delete process.env.POLAR_PRODUCT_ID_CRAM_SQUAD_3;
      delete process.env.POLAR_CHECKOUT_URL_CRAM_SQUAD_3;
      delete process.env.POLAR_CHECKOUT_BASE_URL;

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // Without direct checkout URL, uses sandbox/polar fallback URL instead of wrong product ID
      process.env.POLAR_SANDBOX = "true";
      const fallbackResult = await createUsdCheckoutSession({
        planId: "cram_squad_3",
        userId: "user_squad_no_prod",
        origin: "http://localhost:3000",
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fallbackResult.checkoutUrl).toContain("https://sandbox.polar.sh/checkout/");
      expect(fallbackResult.checkoutUrl).toContain("plan_id=cram_squad_3");
      expect(fallbackResult.checkoutUrl).toContain("amount=8.99");

      // With POLAR_CHECKOUT_URL_CRAM_SQUAD_3 configured, uses that checkout URL directly
      process.env.POLAR_CHECKOUT_URL_CRAM_SQUAD_3 = "https://buy.polar.sh/cram-squad-3";
      const directUrlResult = await createUsdCheckoutSession({
        planId: "cram_squad_3",
        userId: "user_squad_direct_url",
        origin: "http://localhost:3000",
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(directUrlResult.checkoutUrl).toContain("https://buy.polar.sh/cram-squad-3");
      expect(directUrlResult.checkoutUrl).toContain("checkout%5Bcustom%5D%5Bplan_id%5D=cram_squad_3");
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
      expect(result.amountUsd).toBe(19.99);
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
      expect(result.amountUsd).toBe(11.99);
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
        amountUsd: 3.99,
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

    it("fulfills a cram_squad_3 order at $8.99 and maps to cram_pass tier", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_squad_1",
        userId: "user_squad_1",
        planId: "cram_squad_3",
        amountUsd: 8.99,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.alreadyFulfilled).toBe(false);
      expect(result.userId).toBe("user_squad_1");
      expect(result.tier).toBe("cram_pass");
      expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    });

    it("fulfills a pro_monthly order and calculates 30-day expiration", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_monthly_1",
        userId: "user_monthly_1",
        planId: "pro_monthly",
        amountUsd: 7.99,
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
        amountUsd: 11.99,
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
        amountUsd: 19.99,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.userId).toBe("user_tutor_1");
      expect(result.tier).toBe("tutor");

      const expDate = new Date(result.expiresAt).getTime();
      const expectedDays = (expDate - Date.now()) / (1000 * 60 * 60 * 24);
      expect(expectedDays).toBeGreaterThan(29);
      expect(expectedDays).toBeLessThan(31);
    });

    it("accepts amounts given in cents (e.g. 1199 for pro plan)", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_cents_1",
        userId: "user_cents_1",
        planId: "pro",
        amountUsd: 1199,
      });

      expect(result.fulfilled).toBe(true);
      expect(result.tier).toBe("pro");
    });

    it("rejects fulfillment when amount is lower than expected plan amount (anti-tamper)", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_test_tamper_1",
        userId: "user_tamper_1",
        planId: "pro",
        amountUsd: 1.0, // Should be 11.99 or 1199
      });

      expect(result.fulfilled).toBe(false);
    });

    it("is strictly idempotent: second call returns alreadyFulfilled: true without recalculating", async () => {
      const first = await fulfillUsdOrder({
        checkoutId: "chk_idempotent_1",
        userId: "user_idem_1",
        planId: "cram_pass",
        amountUsd: 3.99,
      });

      expect(first.fulfilled).toBe(true);
      expect(first.alreadyFulfilled).toBe(false);

      const second = await fulfillUsdOrder({
        checkoutId: "chk_idempotent_1",
        userId: "user_idem_1",
        planId: "cram_pass",
        amountUsd: 3.99,
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
        amountUsd: 3.99,
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

    it("persists decimal 8.99, returns 2 squadCodes (including on repeat calls), logs user_subscriptions upsert errors, and cascades revocation to squad invites", async () => {
      const subStore = new Map<string, Record<string, unknown>>();
      const inviteStore = new Map<string, Record<string, unknown>>();
      const profileStore = new Map<string, Record<string, unknown>>();
      const userProfileStore = new Map<string, Record<string, unknown>>();
      const ledgerStore = new Map<string, Record<string, unknown>>();
      const upsertSubSpy = vi.fn();
      let injectSubUpsertError: { message: string } | null = null;

      const makeSelect = (rowsFn: () => Array<Record<string, unknown>>) => {
        const filters: Array<{ col: string; val: unknown }> = [];
        const builder: Record<string, unknown> = {
          eq(col: string, val: unknown) {
            filters.push({ col, val });
            return builder;
          },
          async maybeSingle() {
            const matched = rowsFn().filter((r) => filters.every((f) => r[f.col] === f.val));
            return { data: matched[0] ?? null, error: null };
          },
          then(
            onFulfilled?: (v: { data: Array<Record<string, unknown>>; error: null }) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) {
            const matched = rowsFn().filter((r) => filters.every((f) => r[f.col] === f.val));
            return Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      };

      const makeUpdate = (store: Map<string, Record<string, unknown>>, patch: Record<string, unknown>) => {
        const filters: Array<{ col: string; val: unknown }> = [];
        const apply = () => {
          const updated: Array<Record<string, unknown>> = [];
          for (const [k, row] of store.entries()) {
            if (filters.every((f) => row[f.col] === f.val)) {
              const next = { ...row, ...patch };
              store.set(k, next);
              updated.push(next);
            }
          }
          return updated;
        };
        const builder: Record<string, unknown> = {
          eq(col: string, val: unknown) {
            filters.push({ col, val });
            return builder;
          },
          async select() {
            return { data: apply(), error: null };
          },
          then(
            onFulfilled?: (v: { data: Array<Record<string, unknown>>; error: null }) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) {
            return Promise.resolve({ data: apply(), error: null }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      };

      const mockSupabase = {
        from(table: string) {
          if (table === "user_subscriptions") {
            return {
              select: () => makeSelect(() => Array.from(subStore.values())),
              upsert: async (payload: Record<string, unknown>) => {
                upsertSubSpy(payload);
                if (injectSubUpsertError) {
                  return { error: injectSubUpsertError };
                }
                subStore.set(String(payload.id), { ...payload });
                return { error: null };
              },
              update: (patch: Record<string, unknown>) => makeUpdate(subStore, patch),
            };
          }
          if (table === "squad_invites") {
            return {
              select: () => makeSelect(() => Array.from(inviteStore.values())),
              upsert: async (rows: Array<Record<string, unknown>> | Record<string, unknown>) => {
                const list = Array.isArray(rows) ? rows : [rows];
                for (const row of list) {
                  inviteStore.set(String(row.id), { ...row });
                }
                return { error: null };
              },
              update: (patch: Record<string, unknown>) => makeUpdate(inviteStore, patch),
            };
          }
          if (table === "profiles") {
            return {
              select: () => makeSelect(() => Array.from(profileStore.values())),
              upsert: async (payload: Record<string, unknown>) => {
                profileStore.set(String(payload.id), { ...payload });
                return { error: null };
              },
              update: (patch: Record<string, unknown>) => makeUpdate(profileStore, patch),
            };
          }
          if (table === "user_profiles") {
            return {
              select: () => makeSelect(() => Array.from(userProfileStore.values())),
              upsert: async (payload: Record<string, unknown>) => {
                userProfileStore.set(String(payload.id), { ...payload });
                return { error: null };
              },
              update: (patch: Record<string, unknown>) => makeUpdate(userProfileStore, patch),
            };
          }
          if (table === "user_quota_ledgers") {
            return {
              select: () => makeSelect(() => Array.from(ledgerStore.values())),
              upsert: async (payload: Record<string, unknown>) => {
                ledgerStore.set(String(payload.user_id), { ...payload });
                return { error: null };
              },
              update: (patch: Record<string, unknown>) => makeUpdate(ledgerStore, patch),
            };
          }
          return {
            select: () => makeSelect(() => []),
            upsert: async () => ({ error: null }),
            update: () => makeUpdate(new Map(), {}),
          };
        },
        auth: {
          admin: {
            updateUserById: vi.fn(async () => ({ data: {}, error: null })),
          },
        },
      } as unknown as SupabaseClient;

      vi.spyOn(serverHelpers, "getSupabaseAdminOrServerClient").mockReturnValue(mockSupabase);

      // 1. Fresh cram_squad_3 fulfillment persists decimal 8.99 and returns 2 unique squadCodes
      const first = await fulfillUsdOrder({
        checkoutId: "chk_squad_db_1",
        userId: "user_squad_buyer_db",
        planId: "cram_squad_3",
        amountUsd: 8.99,
      });

      expect(first.fulfilled).toBe(true);
      expect(first.alreadyFulfilled).toBe(false);
      expect(first.tier).toBe("cram_pass");
      expect(first.squadCodes).toHaveLength(2);
      expect(new Set(first.squadCodes).size).toBe(2);
      for (const code of first.squadCodes ?? []) {
        expect(code).toMatch(/^CLUTCH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      }
      expect(upsertSubSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "usd_chk_squad_db_1",
          user_id: "user_squad_buyer_db",
          tier: "cram_squad_3",
          amount: 8.99,
          currency: "USD",
          status: "active",
        }),
      );

      // 2. Repeated/idempotent call returns the exact same 2 squadCodes
      const second = await fulfillUsdOrder({
        checkoutId: "chk_squad_db_1",
        userId: "user_squad_buyer_db",
        planId: "cram_squad_3",
      });
      expect(second.fulfilled).toBe(true);
      expect(second.alreadyFulfilled).toBe(true);
      expect(second.squadCodes).toEqual(first.squadCodes);

      // 3. Partner redeems seat 1; then revokeUsdSubscription cascades revocation to both invites and downgrades partner
      const [code1, code2] = first.squadCodes!;
      const redeemRes = await redeemSquadInviteCode({
        code: code1,
        redeemerUserId: "partner_usd_1",
      });
      expect(redeemRes.ok).toBe(true);

      const revokeRes = await revokeUsdSubscription({
        checkoutId: "chk_squad_db_1",
        userId: "user_squad_buyer_db",
        reason: "refunded",
      });
      expect(revokeRes.revoked).toBe(true);
      expect(revokeRes.reason).toBe("refunded");

      const buyerInvites = await getUserSquadInvites({ userId: "user_squad_buyer_db" });
      expect(buyerInvites.purchased).toHaveLength(2);
      expect(buyerInvites.purchased.every((i) => i.status === "revoked")).toBe(true);

      const revokedRedeemAttempt = await redeemSquadInviteCode({
        code: code2,
        redeemerUserId: "partner_usd_2",
      });
      expect(revokedRedeemAttempt.ok).toBe(false);
      if (!revokedRedeemAttempt.ok) {
        expect(revokedRedeemAttempt.code).toBe("INVITE_REVOKED");
      }
      expect(profileStore.get("partner_usd_1")?.tier).toBe("contender");

      // 4. Surfaces/logs { error } if user_subscriptions upsert returns an error
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      injectSubUpsertError = { message: 'invalid input syntax for type integer: "8.99"' };

      await fulfillUsdOrder({
        checkoutId: "chk_squad_err_1",
        userId: "user_squad_err",
        planId: "cram_squad_3",
        amountUsd: 8.99,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[USD Fulfillment] user_subscriptions upsert failed:",
        expect.objectContaining({
          subscriptionId: "usd_chk_squad_err_1",
          userId: "user_squad_err",
          planId: "cram_squad_3",
          error: { message: 'invalid input syntax for type integer: "8.99"' },
        }),
      );
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

      const tiersToTest: UsdPlanId[] = [
        "cram_pass",
        "cram_squad_3",
        "pro_monthly",
        "pro",
        "tutor",
      ];

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
          amount: 11.99,
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

    it("processes Polar order.paid webhook for cram_squad_3 at $8.99 and fulfills as cram_pass tier", async () => {
      process.env.POLAR_WEBHOOK_SECRET = TEST_SECRET;

      const payload = {
        type: "order.paid",
        data: {
          id: "polar_order_squad_1",
          amount: 8.99,
          customer_email: "squad_polar@example.com",
          metadata: {
            userId: "user_polar_squad_1",
            planId: "cram_squad_3",
            checkoutId: "polar_chk_squad_1",
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

      const idempotentCheck = await fulfillUsdOrder({
        checkoutId: "polar_chk_squad_1",
        userId: "user_polar_squad_1",
        planId: "cram_squad_3",
      });
      expect(idempotentCheck.alreadyFulfilled).toBe(true);
      expect(idempotentCheck.tier).toBe("cram_pass");
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
            total_usd: 19.99,
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

    it("verifies Standard Webhooks framing (`webhook-id`.`webhook-timestamp`.`rawBody`) and rejects stale timestamps", () => {
      const msgId = "msg_std_123";
      const freshTs = String(Math.floor(Date.now() / 1000));
      const staleTs = String(Math.floor(Date.now() / 1000) - 600);
      const rawBody = JSON.stringify({ type: "order.paid", data: { id: "ord_std" } });

      const freshSig = createHmac("sha256", TEST_SECRET)
        .update(`${msgId}.${freshTs}.${rawBody}`)
        .digest("base64");
      expect(
        verifyUsdWebhookSignature(rawBody, `v1,${freshSig}`, TEST_SECRET, {
          id: msgId,
          timestamp: freshTs,
        }),
      ).toBe(true);

      const staleSig = createHmac("sha256", TEST_SECRET)
        .update(`${msgId}.${staleTs}.${rawBody}`)
        .digest("base64");
      expect(
        verifyUsdWebhookSignature(rawBody, `v1,${staleSig}`, TEST_SECRET, {
          id: msgId,
          timestamp: staleTs,
        }),
      ).toBe(false);
    });

    it("rejects cent-denominated underpayment (e.g. 399 cents for tutor 1999 cents / $19.99)", async () => {
      const result = await fulfillUsdOrder({
        checkoutId: "chk_cent_underpay_1",
        userId: "user_cent_tamper",
        planId: "tutor",
        amountUsd: 399,
      });

      expect(result.fulfilled).toBe(false);
    });

    it("deduplicates canonical checkout ID vs order/subscription IDs across Polar webhook events", async () => {
      process.env.POLAR_WEBHOOK_SECRET = TEST_SECRET;

      const orderPayload = {
        type: "order.paid",
        data: {
          id: "polar_order_canon_1",
          checkout_id: "polar_canon_chk_1",
          amount: 19.99,
          metadata: {
            userId: "user_canon_1",
            planId: "tutor",
            checkoutId: "polar_local_chk_1",
          },
        },
      };
      const rawOrder = JSON.stringify(orderPayload);
      const sig = createHmac("sha256", TEST_SECRET).update(rawOrder).digest("hex");

      const res = await polarWebhookRoute(
        new Request("http://localhost:3000/api/webhooks/polar", {
          method: "POST",
          headers: { "Content-Type": "application/json", "webhook-signature": sig },
          body: rawOrder,
        }),
      );
      expect(res.status).toBe(200);

      // Replaying using order ID, local metadata checkoutId, or Polar checkout_id all hit idempotency
      const byLocal = await fulfillUsdOrder({
        checkoutId: "polar_local_chk_1",
        userId: "user_canon_1",
        planId: "tutor",
      });
      const byOrder = await fulfillUsdOrder({
        checkoutId: "polar_order_canon_1",
        userId: "user_canon_1",
        planId: "tutor",
      });
      expect(byLocal.alreadyFulfilled).toBe(true);
      expect(byOrder.alreadyFulfilled).toBe(true);
    });

    it("handles Polar order.refunded and subscription.revoked events by revoking entitlements", async () => {
      process.env.POLAR_WEBHOOK_SECRET = TEST_SECRET;

      await fulfillUsdOrder({
        checkoutId: "polar_refund_chk_1",
        userId: "user_refund_1",
        planId: "pro",
        amountUsd: 11.99,
      });

      const refundPayload = {
        type: "order.refunded",
        data: {
          id: "polar_order_refund_1",
          checkout_id: "polar_refund_chk_1",
          metadata: { userId: "user_refund_1" },
        },
      };
      const rawBody = JSON.stringify(refundPayload);
      const sig = createHmac("sha256", TEST_SECRET).update(rawBody).digest("hex");

      const res = await polarWebhookRoute(
        new Request("http://localhost:3000/api/webhooks/polar", {
          method: "POST",
          headers: { "Content-Type": "application/json", "webhook-signature": sig },
          body: rawBody,
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.revoked).toBe(true);
      expect(json.reason).toBe("refunded");

      const revokeRes = await revokeUsdSubscription({
        checkoutId: "polar_refund_chk_1",
        userId: "user_refund_1",
        reason: "revoked",
      });
      expect(revokeRes.revoked).toBe(true);
    });

    it("rejects cross-origin POST /api/payments/usd/create with 403 and oversized webhook bodies with 413", async () => {
      process.env.NEXT_PUBLIC_USD_CHECKOUT_ENABLED = "true";
      const badOriginReq = new Request("http://localhost:3000/api/payments/usd/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil-attacker.example",
        },
        body: JSON.stringify({ planId: "pro" }),
      });
      const originRes = await createUsdRoute(badOriginReq);
      expect(originRes.status).toBe(403);

      const bigReq = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "order.paid", pad: "a".repeat(140_000) }),
      });
      const bigRes = await polarWebhookRoute(bigReq);
      expect(bigRes.status).toBe(413);
    });
  });
});
