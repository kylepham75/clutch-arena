vi.mock("server-only", () => ({}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import * as serverHelpers from "@/lib/supabase/server-helpers";
import * as serverGuard from "@/lib/auth/server-guard";
import * as rateLimitModule from "@/lib/rate-limit";
import {
  clearSquadInvitesCache,
  mintSquadInvitesForOrder,
  getUserSquadInvites,
  redeemSquadInviteCode,
  revokeSquadInvitesForSubscription,
} from "@/lib/payments/squad-invites";
import { POST as redeemRoute } from "@/app/api/payments/squad/redeem/route";
import { GET as mineRoute } from "@/app/api/payments/squad/mine/route";

interface MockSquadInviteRow {
  id: string;
  subscription_id: string;
  buyer_user_id: string;
  code: string;
  seat_index: number;
  status: string;
  redeemed_by_user_id: string | null;
  redeemed_at: string | null;
  expires_at: string;
  created_at: string;
}

interface MockSubscriptionRow {
  id: string;
  user_id: string;
  tier: string;
  cycle?: string;
  amount?: number;
  currency?: string;
  payment_method?: string;
  status: string;
  starts_at?: string;
  expires_at: string | null;
  updated_at?: string;
}

interface MockProfileRow {
  id: string;
  tier: string;
  tier_expires_at: string | null;
  updated_at?: string;
}

interface MockQuotaLedgerRow {
  user_id: string;
  tier: string;
  cogs_ceiling_usd?: number;
  updated_at?: string;
  [key: string]: unknown;
}

function createInMemorySupabaseMock() {
  const squadInvites = new Map<string, MockSquadInviteRow>();
  const userSubscriptions = new Map<string, MockSubscriptionRow>();
  const profiles = new Map<string, MockProfileRow>();
  const userProfiles = new Map<string, MockProfileRow>();
  const userQuotaLedgers = new Map<string, MockQuotaLedgerRow>();
  const authAdminUpdates: Array<{ userId: string; attrs: unknown }> = [];

  function makeSelectBuilder<T extends object>(rowsProvider: () => T[]) {
    const filters: Array<{ col: string; val: unknown }> = [];
    const builder: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return builder;
      },
      async maybeSingle() {
        const matched = rowsProvider().filter((row) =>
          filters.every((f) => (row as Record<string, unknown>)[f.col] === f.val),
        );
        return { data: matched[0] ?? null, error: null };
      },
      then(
        onFulfilled?: (val: { data: T[]; error: null }) => unknown,
        onRejected?: (err: unknown) => unknown,
      ) {
        const matched = rowsProvider().filter((row) =>
          filters.every((f) => (row as Record<string, unknown>)[f.col] === f.val),
        );
        return Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function makeUpdateBuilder<T extends object>(
    store: Map<string, T>,
    patch: Partial<T>,
  ) {
    const filters: Array<{ col: string; val: unknown }> = [];
    const applyUpdate = (): T[] => {
      const updated: T[] = [];
      for (const [key, row] of store.entries()) {
        if (filters.every((f) => (row as Record<string, unknown>)[f.col] === f.val)) {
          const next = { ...row, ...patch };
          store.set(key, next);
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
        return { data: applyUpdate(), error: null };
      },
      then(
        onFulfilled?: (val: { data: T[]; error: null }) => unknown,
        onRejected?: (err: unknown) => unknown,
      ) {
        return Promise.resolve({ data: applyUpdate(), error: null }).then(
          onFulfilled,
          onRejected,
        );
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      if (table === "squad_invites") {
        return {
          select: () => makeSelectBuilder(() => Array.from(squadInvites.values())),
          upsert: async (rows: MockSquadInviteRow | MockSquadInviteRow[]) => {
            const list = Array.isArray(rows) ? rows : [rows];
            for (const row of list) {
              squadInvites.set(row.id, { ...row });
            }
            return { error: null };
          },
          update: (patch: Partial<MockSquadInviteRow>) =>
            makeUpdateBuilder(squadInvites, patch),
        };
      }

      if (table === "user_subscriptions") {
        return {
          select: () => makeSelectBuilder(() => Array.from(userSubscriptions.values())),
          upsert: async (
            rows: MockSubscriptionRow | MockSubscriptionRow[],
          ) => {
            const list = Array.isArray(rows) ? rows : [rows];
            for (const row of list) {
              userSubscriptions.set(row.id, { ...row });
            }
            return { error: null };
          },
          update: (patch: Partial<MockSubscriptionRow>) =>
            makeUpdateBuilder(userSubscriptions, patch),
        };
      }

      if (table === "profiles") {
        return {
          select: () => makeSelectBuilder(() => Array.from(profiles.values())),
          upsert: async (row: MockProfileRow) => {
            profiles.set(row.id, { ...row });
            return { error: null };
          },
          update: (patch: Partial<MockProfileRow>) => makeUpdateBuilder(profiles, patch),
        };
      }

      if (table === "user_profiles") {
        return {
          select: () => makeSelectBuilder(() => Array.from(userProfiles.values())),
          upsert: async (row: MockProfileRow) => {
            userProfiles.set(row.id, { ...row });
            return { error: null };
          },
          update: (patch: Partial<MockProfileRow>) =>
            makeUpdateBuilder(userProfiles, patch),
        };
      }

      if (table === "user_quota_ledgers") {
        return {
          select: () => makeSelectBuilder(() => Array.from(userQuotaLedgers.values())),
          upsert: async (row: MockQuotaLedgerRow) => {
            userQuotaLedgers.set(row.user_id, { ...row });
            return { error: null };
          },
          update: (patch: Partial<MockQuotaLedgerRow>) =>
            makeUpdateBuilder(userQuotaLedgers, patch),
        };
      }

      return {
        select: () => makeSelectBuilder(() => []),
        upsert: async () => ({ error: null }),
        update: () => makeUpdateBuilder(new Map(), {}),
      };
    },
    auth: {
      admin: {
        updateUserById: vi.fn(async (userId: string, attrs: unknown) => {
          authAdminUpdates.push({ userId, attrs });
          return { data: {}, error: null };
        }),
      },
    },
  } as unknown as SupabaseClient;

  return {
    client,
    squadInvites,
    userSubscriptions,
    profiles,
    userProfiles,
    userQuotaLedgers,
    authAdminUpdates,
  };
}

function mockAuthenticatedUser(userId: string, tier: "contender" | "cram_pass" | "pro_monthly" | "pro" | "tutor" = "contender") {
  vi.spyOn(serverGuard, "verifyAuthToken").mockResolvedValue({
    authenticated: true,
    user: { id: userId, email: `${userId}@example.edu` } as unknown as User,
    tier,
    tierExpiresAt: null,
    token: `token-${userId}`,
  });
}

describe("Cram Squad 3-Pack Invites & Redemption", () => {
  let dbMock: ReturnType<typeof createInMemorySupabaseMock>;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearSquadInvitesCache();
    dbMock = createInMemorySupabaseMock();
    vi.spyOn(serverHelpers, "getSupabaseAdminOrServerClient").mockReturnValue(
      dbMock.client,
    );
    invalidateSpy = vi
      .spyOn(rateLimitModule, "invalidateUserQuotaLedgerCache")
      .mockResolvedValue(undefined);
    vi.spyOn(rateLimitModule, "checkRateLimit").mockResolvedValue({
      allowed: true,
      remaining: 99,
      limit: 100,
      retryAfter: 0,
      reset: Date.now() + 60_000,
    });
  });

  afterEach(() => {
    clearSquadInvitesCache();
    vi.restoreAllMocks();
  });

  describe("SQL Migration (20261125_subscriptions_numeric_and_squad_invites.sql)", () => {
    const migrationSql = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261125_subscriptions_numeric_and_squad_invites.sql",
      ),
      "utf8",
    );

    it("alters user_subscriptions.amount to numeric(12,2)", () => {
      expect(migrationSql).toMatch(/ALTER TABLE\s+public\.user_subscriptions/i);
      expect(migrationSql).toMatch(
        /ALTER COLUMN\s+amount\s+TYPE\s+numeric\(12,2\)/i,
      );
    });

    it("defines squad_invites table with constraints, indexes, and RLS policies", () => {
      expect(migrationSql).toMatch(
        /CREATE TABLE IF NOT EXISTS\s+public\.squad_invites/i,
      );
      expect(migrationSql).toMatch(/seat_index\s+int\s+NOT NULL\s+CHECK\s*\(seat_index IN \(1,\s*2\)\)/i);
      expect(migrationSql).toMatch(/UNIQUE\s*\(subscription_id,\s*seat_index\)/i);
      expect(migrationSql).toMatch(
        /ALTER TABLE\s+public\.squad_invites\s+ENABLE ROW LEVEL SECURITY/i,
      );
      expect(migrationSql).toMatch(/public\.is_service_role\(\)/i);
      expect(migrationSql).toMatch(
        /FOR SELECT[\s\S]*auth\.uid\(\)\s*=\s*buyer_user_id\s+OR\s+auth\.uid\(\)\s*=\s*redeemed_by_user_id/i,
      );
    });

    it("defines on_subscription_revoked_cascade_squad_invites trigger cascading to squad_redeem_* rows", () => {
      expect(migrationSql).toMatch(
        /CREATE OR REPLACE FUNCTION\s+public\.cascade_squad_invites_on_subscription_revocation\(\)/i,
      );
      expect(migrationSql).toMatch(
        /CREATE TRIGGER\s+on_subscription_revoked_cascade_squad_invites/i,
      );
      expect(migrationSql).toMatch(/AFTER UPDATE OF status ON public\.user_subscriptions/i);
      expect(migrationSql).toMatch(/'squad_redeem_'\s*\|\|\s*si\.id/i);
      expect(migrationSql).toMatch(/SET tier\s*=\s*'contender'/i);
    });
  });

  describe("mintSquadInvitesForOrder()", () => {
    it("mints 2 unique CLUTCH-XXXX-XXXX codes (seatIndex 1 and 2) and is strictly idempotent", async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const first = await mintSquadInvitesForOrder({
        subscriptionId: "usd_squad_chk_1",
        buyerUserId: "buyer_1",
        expiresAt,
      });

      expect(first).toHaveLength(2);
      expect(first.map((i) => i.seatIndex)).toEqual([1, 2]);
      expect(first[0].code).toMatch(/^CLUTCH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(first[1].code).toMatch(/^CLUTCH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(first[0].code).not.toBe(first[1].code);
      expect(first[0].status).toBe("available");
      expect(first[1].status).toBe("available");
      expect(dbMock.squadInvites.size).toBe(2);

      // Repeat call with same subscriptionId (in-memory hit)
      const second = await mintSquadInvitesForOrder({
        subscriptionId: "usd_squad_chk_1",
        buyerUserId: "buyer_1",
        expiresAt,
      });
      expect(second.map((i) => i.code)).toEqual(first.map((i) => i.code));
      expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id));

      // Repeat call after clearing in-memory cache (DB-backed idempotency)
      clearSquadInvitesCache();
      const third = await mintSquadInvitesForOrder({
        subscriptionId: "usd_squad_chk_1",
        buyerUserId: "buyer_1",
        expiresAt,
      });
      expect(third.map((i) => i.code)).toEqual(first.map((i) => i.code));
      expect(third.map((i) => i.seatIndex)).toEqual([1, 2]);
    });
  });

  describe("POST /api/payments/squad/redeem", () => {
    it("rejects cross-origin requests with 403 FORBIDDEN_ORIGIN", async () => {
      const req = new Request("http://localhost:3000/api/payments/squad/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil-attacker.example",
        },
        body: JSON.stringify({ code: "CLUTCH-AB12-CD34" }),
      });

      const res = await redeemRoute(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("FORBIDDEN_ORIGIN");
    });

    it("rejects unauthenticated requests with 401 AUTH_REQUIRED", async () => {
      vi.spyOn(serverGuard, "verifyAuthToken").mockResolvedValue({
        authenticated: false,
        isGuest: true,
        tier: "guest",
        devMode: false,
      });

      const req = new Request("http://localhost:3000/api/payments/squad/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ code: "CLUTCH-AB12-CD34" }),
      });

      const res = await redeemRoute(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("AUTH_REQUIRED");
    });

    it("rejects invalid code formats with 400 INVALID_CODE", async () => {
      mockAuthenticatedUser("partner_invalid");

      for (const badCode of ["short", "NOT-A-VALID-SQUAD-CODE", "CLUTCH-123-456"]) {
        const req = new Request("http://localhost:3000/api/payments/squad/redeem", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ code: badCode }),
        });

        const res = await redeemRoute(req);
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json.ok).toBe(false);
        expect(json.code).toBe("INVALID_CODE");
      }
    });

    it("rejects self-redemption by the buyer with 400 SELF_REDEMPTION_NOT_ALLOWED", async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const [invite1] = await mintSquadInvitesForOrder({
        subscriptionId: "sub_self_1",
        buyerUserId: "buyer_self",
        expiresAt,
      });

      mockAuthenticatedUser("buyer_self");

      const req = new Request("http://localhost:3000/api/payments/squad/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ code: invite1.code }),
      });

      const res = await redeemRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("SELF_REDEMPTION_NOT_ALLOWED");
    });

    it("rejects non-existent code with 404 INVITE_NOT_FOUND", async () => {
      mockAuthenticatedUser("partner_missing");

      const req = new Request("http://localhost:3000/api/payments/squad/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ code: "CLUTCH-ZZZZ-9999" }),
      });

      const res = await redeemRoute(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVITE_NOT_FOUND");
    });

    it("rejects already-redeemed (409), revoked (409), and expired (410) codes", async () => {
      const futureIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const [invActive1, invActive2] = await mintSquadInvitesForOrder({
        subscriptionId: "sub_states_1",
        buyerUserId: "buyer_states",
        expiresAt: futureIso,
      });

      // Partner 1 redeems invite 1
      mockAuthenticatedUser("partner_first");
      const firstRes = await redeemRoute(
        new Request("http://localhost:3000/api/payments/squad/redeem", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ code: invActive1.code }),
        }),
      );
      expect(firstRes.status).toBe(200);

      // Partner 2 tries already-redeemed invite 1 -> 409 INVITE_ALREADY_REDEEMED
      mockAuthenticatedUser("partner_second");
      const dupRes = await redeemRoute(
        new Request("http://localhost:3000/api/payments/squad/redeem", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ code: invActive1.code }),
        }),
      );
      const dupJson = await dupRes.json();
      expect(dupRes.status).toBe(409);
      expect(dupJson.code).toBe("INVITE_ALREADY_REDEEMED");

      // Revoke subscription -> invite 2 becomes revoked -> 409 INVITE_REVOKED
      await revokeSquadInvitesForSubscription({
        subscriptionId: "sub_states_1",
        reason: "refunded",
      });
      const revokedRes = await redeemRoute(
        new Request("http://localhost:3000/api/payments/squad/redeem", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ code: invActive2.code }),
        }),
      );
      const revokedJson = await revokedRes.json();
      expect(revokedRes.status).toBe(409);
      expect(revokedJson.code).toBe("INVITE_REVOKED");

      // Expired invite -> 410 INVITE_EXPIRED
      const [invExpired] = await mintSquadInvitesForOrder({
        subscriptionId: "sub_expired_1",
        buyerUserId: "buyer_expired",
        expiresAt: pastIso,
      });
      const expRes = await redeemRoute(
        new Request("http://localhost:3000/api/payments/squad/redeem", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ code: invExpired.code }),
        }),
      );
      const expJson = await expRes.json();
      expect(expRes.status).toBe(410);
      expect(expJson.code).toBe("INVITE_EXPIRED");
    });

    it("succeeds (200) for 2 distinct partners, granting cram_pass and calling invalidateUserQuotaLedgerCache", async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const [invite1, invite2] = await mintSquadInvitesForOrder({
        subscriptionId: "sub_partners_1",
        buyerUserId: "buyer_partners",
        expiresAt,
      });

      for (const [partnerId, invite] of [
        ["partner_alpha", invite1],
        ["partner_beta", invite2],
      ] as const) {
        mockAuthenticatedUser(partnerId);
        const res = await redeemRoute(
          new Request("http://localhost:3000/api/payments/squad/redeem", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://localhost:3000",
            },
            body: JSON.stringify({ code: invite.code.toLowerCase() }),
          }),
        );
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.tier).toBe("cram_pass");
        expect(json.preservedHigherTier).toBe(false);
        expect(json.invite.status).toBe("redeemed");
        expect(invalidateSpy).toHaveBeenCalledWith(partnerId);
        expect(dbMock.profiles.get(partnerId)?.tier).toBe("cram_pass");
        expect(dbMock.userSubscriptions.get(`squad_redeem_${invite.id}`)?.status).toBe(
          "active",
        );
      }
    });

    it("preserves higher active tiers (pro / tutor) with preservedHigherTier: true when redeemed", async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const proExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const tutorExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const [invite1, invite2] = await mintSquadInvitesForOrder({
        subscriptionId: "sub_higher_1",
        buyerUserId: "buyer_higher",
        expiresAt,
      });

      dbMock.profiles.set("pro_partner", {
        id: "pro_partner",
        tier: "pro",
        tier_expires_at: proExpiresAt,
      });
      dbMock.profiles.set("tutor_partner", {
        id: "tutor_partner",
        tier: "tutor",
        tier_expires_at: tutorExpiresAt,
      });

      // Pro user redeems invite 1
      mockAuthenticatedUser("pro_partner", "pro");
      const proRes = await redeemRoute(
        new Request("http://localhost:3000/api/payments/squad/redeem", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ code: invite1.code }),
        }),
      );
      const proJson = await proRes.json();

      expect(proRes.status).toBe(200);
      expect(proJson.ok).toBe(true);
      expect(proJson.tier).toBe("pro");
      expect(proJson.expiresAt).toBe(proExpiresAt);
      expect(proJson.preservedHigherTier).toBe(true);
      expect(dbMock.profiles.get("pro_partner")?.tier).toBe("pro");
      expect(invalidateSpy).toHaveBeenCalledWith("pro_partner");

      // Tutor user redeems invite 2
      mockAuthenticatedUser("tutor_partner", "tutor");
      const tutorRes = await redeemRoute(
        new Request("http://localhost:3000/api/payments/squad/redeem", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({ code: invite2.code }),
        }),
      );
      const tutorJson = await tutorRes.json();

      expect(tutorRes.status).toBe(200);
      expect(tutorJson.ok).toBe(true);
      expect(tutorJson.tier).toBe("tutor");
      expect(tutorJson.expiresAt).toBe(tutorExpiresAt);
      expect(tutorJson.preservedHigherTier).toBe(true);
      expect(dbMock.profiles.get("tutor_partner")?.tier).toBe("tutor");
      expect(invalidateSpy).toHaveBeenCalledWith("tutor_partner");
    });
  });

  describe("GET /api/payments/squad/mine", () => {
    it("rejects unauthenticated requests with 401 AUTH_REQUIRED", async () => {
      vi.spyOn(serverGuard, "verifyAuthToken").mockResolvedValue({
        authenticated: false,
        isGuest: true,
        tier: "guest",
        devMode: false,
      });

      const res = await mineRoute(
        new Request("http://localhost:3000/api/payments/squad/mine", { method: "GET" }),
      );
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("AUTH_REQUIRED");
    });

    it("returns buyer's purchased codes and reflects status updates after partner redemption", async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const [invite1, invite2] = await mintSquadInvitesForOrder({
        subscriptionId: "sub_mine_1",
        buyerUserId: "buyer_mine",
        expiresAt,
      });

      // Buyer checks before redemption
      mockAuthenticatedUser("buyer_mine", "cram_pass");
      const beforeRes = await mineRoute(
        new Request("http://localhost:3000/api/payments/squad/mine", { method: "GET" }),
      );
      const beforeJson = await beforeRes.json();

      expect(beforeRes.status).toBe(200);
      expect(beforeJson.ok).toBe(true);
      expect(beforeJson.purchased).toHaveLength(2);
      expect(beforeJson.purchased.map((p: { code: string; status: string }) => [p.code, p.status])).toEqual([
        [invite1.code, "available"],
        [invite2.code, "available"],
      ]);

      // Partner 1 redeems invite 1
      await redeemSquadInviteCode({
        code: invite1.code,
        redeemerUserId: "partner_mine_1",
      });

      // Buyer checks again and sees updated redeemed status on seat 1
      const afterRes = await mineRoute(
        new Request("http://localhost:3000/api/payments/squad/mine", { method: "GET" }),
      );
      const afterJson = await afterRes.json();

      expect(afterRes.status).toBe(200);
      expect(afterJson.purchased).toHaveLength(2);
      expect(afterJson.purchased[0].status).toBe("redeemed");
      expect(afterJson.purchased[0].redeemedAt).toEqual(expect.any(String));
      expect(afterJson.purchased[1].status).toBe("available");
      expect(afterJson.purchased[1].redeemedAt).toBeNull();

      // Partner 1 sees the redeemed code under `redeemed`
      mockAuthenticatedUser("partner_mine_1", "cram_pass");
      const partnerRes = await mineRoute(
        new Request("http://localhost:3000/api/payments/squad/mine", { method: "GET" }),
      );
      const partnerJson = await partnerRes.json();
      expect(partnerRes.status).toBe(200);
      expect(partnerJson.redeemed).toHaveLength(1);
      expect(partnerJson.redeemed[0].code).toBe(invite1.code);
      expect(partnerJson.redeemed[0].status).toBe("redeemed");
    });
  });

  describe("revokeSquadInvitesForSubscription()", () => {
    it("revokes available/redeemed invites and downgrades redeemed seats lacking another active subscription back to contender", async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const [invite1, invite2] = await mintSquadInvitesForOrder({
        subscriptionId: "sub_revoke_1",
        buyerUserId: "buyer_revoke",
        expiresAt,
      });

      // Partner 1 has only this squad pass; Partner 2 also has an independent active Pro subscription
      await redeemSquadInviteCode({
        code: invite1.code,
        redeemerUserId: "partner_only_squad",
      });

      const proExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      dbMock.profiles.set("partner_also_pro", {
        id: "partner_also_pro",
        tier: "pro",
        tier_expires_at: proExpiresAt,
      });
      dbMock.userSubscriptions.set("usd_independent_pro", {
        id: "usd_independent_pro",
        user_id: "partner_also_pro",
        tier: "pro",
        status: "active",
        expires_at: proExpiresAt,
      });

      await redeemSquadInviteCode({
        code: invite2.code,
        redeemerUserId: "partner_also_pro",
      });

      invalidateSpy.mockClear();

      const revokeResult = await revokeSquadInvitesForSubscription({
        subscriptionId: "sub_revoke_1",
        reason: "refunded",
      });

      expect(revokeResult.revokedCodes).toEqual([invite1.code, invite2.code]);
      expect(revokeResult.downgradedUserIds).toEqual(["partner_only_squad"]);

      // Both squad invites are revoked in DB & buyer view
      const { purchased } = await getUserSquadInvites({ userId: "buyer_revoke" });
      expect(purchased.every((i) => i.status === "revoked")).toBe(true);

      // Squad redeem subscription row for partner_only_squad was revoked
      expect(dbMock.userSubscriptions.get(`squad_redeem_${invite1.id}`)?.status).toBe(
        "refunded",
      );

      // Partner without another active sub is downgraded to contender
      expect(dbMock.profiles.get("partner_only_squad")?.tier).toBe("contender");
      expect(dbMock.profiles.get("partner_only_squad")?.tier_expires_at).toBeNull();
      expect(dbMock.userProfiles.get("partner_only_squad")?.tier).toBe("contender");
      expect(dbMock.userQuotaLedgers.get("user:partner_only_squad")?.tier).toBe(
        "contender",
      );
      expect(
        dbMock.userQuotaLedgers.get("user:partner_only_squad")?.cogs_ceiling_usd,
      ).toBe(0.08);

      // Partner with independent active Pro subscription keeps Pro tier
      expect(dbMock.profiles.get("partner_also_pro")?.tier).toBe("pro");
      expect(invalidateSpy).toHaveBeenCalledWith("partner_only_squad");
      expect(invalidateSpy).toHaveBeenCalledWith("partner_also_pro");
    });
  });
});
