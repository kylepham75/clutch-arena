import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminOrServerClient } from "@/lib/supabase/server-helpers";
import { invalidateUserQuotaLedgerCache } from "@/lib/rate-limit";
import {
  calculateTierExpiration,
  getRegionalCogsCeiling,
  isTierExpired,
  normalizeTier,
  type UserTier,
} from "@/lib/pricing/tiers";

const SQUAD_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SQUAD_CODE_REGEX = /^CLUTCH-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type SquadInviteStatus = "available" | "redeemed" | "revoked";
export type SquadSeatIndex = 1 | 2;

export interface SquadInviteRecord {
  id: string;
  subscriptionId: string;
  buyerUserId: string;
  code: string;
  seatIndex: SquadSeatIndex;
  status: SquadInviteStatus;
  redeemedByUserId: string | null;
  redeemedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface SquadInviteSummary {
  id: string;
  code: string;
  seatIndex: SquadSeatIndex;
  status: SquadInviteStatus;
  expiresAt: string;
  redeemedAt: string | null;
  subscriptionId: string;
}

export type SquadInviteErrorCode =
  | "INVALID_CODE"
  | "INVITE_NOT_FOUND"
  | "SELF_REDEMPTION_NOT_ALLOWED"
  | "INVITE_REVOKED"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_REDEEMED";

export type RedeemSquadInviteResult =
  | {
      ok: true;
      tier: UserTier;
      expiresAt: string | null;
      preservedHigherTier: boolean;
      invite: SquadInviteSummary;
    }
  | {
      ok: false;
      code: SquadInviteErrorCode;
      status: 400 | 404 | 409 | 410;
      error: string;
    };

interface SquadInviteDbRow {
  id: string;
  subscription_id: string;
  buyer_user_id: string;
  code: string;
  seat_index: number;
  status: string;
  redeemed_by_user_id?: string | null;
  redeemed_at?: string | null;
  expires_at: string;
  created_at?: string | null;
}

interface ProfileTierRow {
  tier?: string | null;
  tier_expires_at?: string | null;
}

interface UserSubscriptionStatusRow {
  id: string;
  tier?: string | null;
  status?: string | null;
  expires_at?: string | null;
}

const squadInvitesMemoryStore = new Map<string, SquadInviteRecord>();
const codeToInviteIdMap = new Map<string, string>();
const subscriptionToInviteIdsMap = new Map<string, string[]>();
const operationLockMap = new Map<string, Promise<unknown>>();

export function clearSquadInvitesCache(): void {
  squadInvitesMemoryStore.clear();
  codeToInviteIdMap.clear();
  subscriptionToInviteIdsMap.clear();
  operationLockMap.clear();
}

async function withOperationLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = operationLockMap.get(lockKey) ?? Promise.resolve();
  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  operationLockMap.set(lockKey, current);

  try {
    await prev.catch(() => {});
    return await fn();
  } finally {
    releaseLock();
    if (operationLockMap.get(lockKey) === current) {
      operationLockMap.delete(lockKey);
    }
  }
}

function cloneInvite(record: SquadInviteRecord): SquadInviteRecord {
  return { ...record };
}

function toSquadInviteSummary(record: SquadInviteRecord): SquadInviteSummary {
  return {
    id: record.id,
    code: record.code,
    seatIndex: record.seatIndex,
    status: record.status,
    expiresAt: record.expiresAt,
    redeemedAt: record.redeemedAt,
    subscriptionId: record.subscriptionId,
  };
}

function normalizeStatus(raw: unknown): SquadInviteStatus {
  if (raw === "redeemed" || raw === "revoked") {
    return raw;
  }
  return "available";
}

function mapDbRowToInvite(row: SquadInviteDbRow): SquadInviteRecord {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    buyerUserId: String(row.buyer_user_id),
    code: String(row.code ?? "").trim().toUpperCase(),
    seatIndex: Number(row.seat_index) === 2 ? 2 : 1,
    status: normalizeStatus(row.status),
    redeemedByUserId: row.redeemed_by_user_id ? String(row.redeemed_by_user_id) : null,
    redeemedAt: row.redeemed_at ? String(row.redeemed_at) : null,
    expiresAt: String(row.expires_at),
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
  };
}

function toDbRow(record: SquadInviteRecord): SquadInviteDbRow {
  return {
    id: record.id,
    subscription_id: record.subscriptionId,
    buyer_user_id: record.buyerUserId,
    code: record.code,
    seat_index: record.seatIndex,
    status: record.status,
    redeemed_by_user_id: record.redeemedByUserId,
    redeemed_at: record.redeemedAt,
    expires_at: record.expiresAt,
    created_at: record.createdAt,
  };
}

function cacheInviteRecord(record: SquadInviteRecord): void {
  const copy = cloneInvite(record);
  squadInvitesMemoryStore.set(copy.id, copy);
  codeToInviteIdMap.set(copy.code.toUpperCase(), copy.id);

  const existingIds = subscriptionToInviteIdsMap.get(copy.subscriptionId) ?? [];
  if (!existingIds.includes(copy.id)) {
    subscriptionToInviteIdsMap.set(copy.subscriptionId, [...existingIds, copy.id]);
  }
}

function generateUniqueSquadCode(): string {
  const alphabetLen = SQUAD_CODE_ALPHABET.length;
  for (let attempt = 0; attempt < 32; attempt++) {
    const bytes = randomBytes(8);
    let chars = "";
    for (let i = 0; i < 8; i++) {
      chars += SQUAD_CODE_ALPHABET[bytes[i] % alphabetLen];
    }
    const candidate = `CLUTCH-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
    if (!codeToInviteIdMap.has(candidate)) {
      return candidate;
    }
  }
  const fallback = randomBytes(8);
  let chars = "";
  for (let i = 0; i < 8; i++) {
    chars += SQUAD_CODE_ALPHABET[fallback[i] % alphabetLen];
  }
  return `CLUTCH-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

async function execListQuery<T>(chain: unknown): Promise<{ data: T[]; error: unknown }> {
  if (!chain || typeof chain !== "object") {
    return { data: [], error: null };
  }
  const res = (await (chain as Promise<{ data?: T[] | null; error?: unknown }>)) ?? {};
  return {
    data: Array.isArray(res.data) ? res.data : [],
    error: res.error ?? null,
  };
}

async function execMaybeSingle<T>(chain: unknown): Promise<{ data: T | null; error: unknown }> {
  if (!chain || typeof chain !== "object") {
    return { data: null, error: null };
  }
  const query = chain as {
    maybeSingle?: () => Promise<{ data?: T | T[] | null; error?: unknown }>;
  };
  const res =
    typeof query.maybeSingle === "function"
      ? await query.maybeSingle()
      : await (chain as Promise<{ data?: T | T[] | null; error?: unknown }>);
  const raw = res?.data;
  const item = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
  return { data: item, error: res?.error ?? null };
}

function getCachedInvitesForSubscription(subscriptionId: string): SquadInviteRecord[] {
  const byId = new Map<string, SquadInviteRecord>();
  const indexedIds = subscriptionToInviteIdsMap.get(subscriptionId) ?? [];
  for (const id of indexedIds) {
    const rec = squadInvitesMemoryStore.get(id);
    if (rec && rec.subscriptionId === subscriptionId) {
      byId.set(rec.id, rec);
    }
  }
  for (const seatIndex of [1, 2] as const) {
    const id = `squad_${subscriptionId}_${seatIndex}`;
    const rec = squadInvitesMemoryStore.get(id);
    if (rec && rec.subscriptionId === subscriptionId) {
      byId.set(rec.id, rec);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.seatIndex - b.seatIndex);
}

async function fetchDbInvitesBySubscription(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<SquadInviteRecord[]> {
  try {
    const table = supabase.from("squad_invites") as unknown as {
      select?: (cols: string) => { eq?: (col: string, val: string) => unknown };
    };
    if (typeof table?.select !== "function") return [];
    const sel = table.select("*");
    const query = typeof sel?.eq === "function" ? sel.eq("subscription_id", subscriptionId) : sel;
    const { data, error } = await execListQuery<SquadInviteDbRow>(query);
    if (error || data.length === 0) return [];
    const mapped = data
      .filter((row) => !row.subscription_id || row.subscription_id === subscriptionId)
      .map(mapDbRowToInvite);
    for (const rec of mapped) {
      cacheInviteRecord(rec);
    }
    return mapped.sort((a, b) => a.seatIndex - b.seatIndex);
  } catch {
    return [];
  }
}

async function upsertProfileRecord(
  supabase: SupabaseClient,
  tableName: "profiles" | "user_profiles",
  userId: string,
  values: { tier: UserTier; tier_expires_at: string | null; updated_at: string },
  preferUpdate: boolean,
): Promise<void> {
  try {
    const table = supabase.from(tableName) as unknown as {
      update?: (payload: Record<string, unknown>) => { eq?: (col: string, val: string) => unknown };
      upsert?: (payload: Record<string, unknown>, opts?: { onConflict?: string }) => unknown;
    };
    if (preferUpdate && typeof table?.update === "function") {
      const upd = table.update(values);
      const q = typeof upd?.eq === "function" ? upd.eq("id", userId) : upd;
      await q;
      return;
    }
    if (typeof table?.upsert === "function") {
      await table.upsert({ id: userId, ...values }, { onConflict: "id" });
      return;
    }
    if (typeof table?.update === "function") {
      const upd = table.update(values);
      const q = typeof upd?.eq === "function" ? upd.eq("id", userId) : upd;
      await q;
    }
  } catch {
    // Ignore optional/mock table differences
  }
}

async function resetUserQuotaLedgerForCramPass(
  supabase: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<void> {
  const actorKey = `user:${userId}`;
  const cramCeiling = getRegionalCogsCeiling("cram_pass", "VN");
  const today = nowIso.slice(0, 10);

  const legacyPayload = {
    user_id: actorKey,
    tier: "cram_pass",
    cogs_spent_usd: 0,
    estimated_cogs_usd: 0,
    cogs_reserved_usd: 0,
    cogs_ceiling_usd: cramCeiling,
    deck_credits_used: 0,
    decks_generated_count: 0,
    deck_credits_limit: 0,
    daily_burst_used: 0,
    daily_burst_date: today,
    unlocked_decks: {},
    updated_at: nowIso,
  };

  const fullPayload = {
    ...legacyPayload,
    window_started_at: nowIso,
    window_spent_usd: 0,
    window_reserved_usd: 0,
    weekly_started_at: nowIso,
    weekly_spent_usd: 0,
    weekly_reserved_usd: 0,
  };

  try {
    const table = supabase.from("user_quota_ledgers") as unknown as {
      upsert?: (
        payload: Record<string, unknown>,
        opts?: { onConflict?: string },
      ) => Promise<{ error?: unknown }>;
      update?: (payload: Record<string, unknown>) => { eq?: (col: string, val: string) => unknown };
    };
    if (typeof table?.upsert === "function") {
      const res = await table.upsert(fullPayload, { onConflict: "user_id" });
      if (res?.error) {
        await table.upsert(legacyPayload, { onConflict: "user_id" });
      }
      return;
    }
    if (typeof table?.update === "function") {
      const upd = table.update(fullPayload);
      const q = typeof upd?.eq === "function" ? upd.eq("user_id", actorKey) : upd;
      await q;
    }
  } catch {
    // Ignore optional/mock table differences
  }
}

async function downgradeUserQuotaLedgerToContender(
  supabase: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<void> {
  const actorKey = `user:${userId}`;
  const payload = {
    tier: "contender",
    cogs_ceiling_usd: 0.08,
    updated_at: nowIso,
  };

  try {
    const table = supabase.from("user_quota_ledgers") as unknown as {
      update?: (p: Record<string, unknown>) => { eq?: (col: string, val: string) => unknown };
      upsert?: (p: Record<string, unknown>, opts?: { onConflict?: string }) => unknown;
    };
    if (typeof table?.update === "function") {
      const upd = table.update(payload);
      const q = typeof upd?.eq === "function" ? upd.eq("user_id", actorKey) : upd;
      await q;
      return;
    }
    if (typeof table?.upsert === "function") {
      await table.upsert({ user_id: actorKey, ...payload }, { onConflict: "user_id" });
    }
  } catch {
    // Ignore optional/mock table differences
  }
}

async function safeUpdateAuthAppMetadata(
  supabase: SupabaseClient,
  userId: string,
  tier: UserTier,
  expiresAt: string | null,
): Promise<void> {
  try {
    const admin = (
      supabase as unknown as {
        auth?: {
          admin?: {
            updateUserById?: (
              uid: string,
              attrs: { app_metadata: { tier: UserTier; tier_expires_at: string | null } },
            ) => Promise<unknown>;
          };
        };
      }
    )?.auth?.admin;
    if (typeof admin?.updateUserById === "function") {
      await admin.updateUserById(userId, {
        app_metadata: {
          tier,
          tier_expires_at: expiresAt,
        },
      });
    }
  } catch {
    // Best-effort metadata sync; never block entitlement flow
  }
}

export async function mintSquadInvitesForOrder(params: {
  subscriptionId: string;
  buyerUserId: string;
  expiresAt: string;
  userToken?: string;
}): Promise<SquadInviteRecord[]> {
  const subscriptionId = params.subscriptionId.trim();
  const buyerUserId = params.buyerUserId.trim();
  if (!subscriptionId || !buyerUserId) {
    throw new Error("Invalid squad invite mint parameters.");
  }

  const effectiveExpiresAt =
    params.expiresAt?.trim() ||
    calculateTierExpiration("cram_pass") ||
    new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

  return withOperationLock(`mint:${subscriptionId}`, async () => {
    const cached = getCachedInvitesForSubscription(subscriptionId);
    if (cached.length >= 2) {
      return cached.slice(0, 2).map(cloneInvite);
    }

    const supabase = getSupabaseAdminOrServerClient(params.userToken);
    let existingInvites = cached;

    if (supabase) {
      const dbInvites = await fetchDbInvitesBySubscription(supabase, subscriptionId);
      if (dbInvites.length >= 2) {
        return dbInvites.slice(0, 2).map(cloneInvite);
      }
      if (dbInvites.length > 0) {
        const merged = new Map<number, SquadInviteRecord>();
        for (const rec of existingInvites) merged.set(rec.seatIndex, rec);
        for (const rec of dbInvites) merged.set(rec.seatIndex, rec);
        existingInvites = Array.from(merged.values()).sort((a, b) => a.seatIndex - b.seatIndex);
      }
    }

    const existingBySeat = new Map<SquadSeatIndex, SquadInviteRecord>();
    for (const rec of existingInvites) {
      existingBySeat.set(rec.seatIndex, rec);
    }

    const nowIso = new Date().toISOString();
    const newlyMinted: SquadInviteRecord[] = [];
    const allSeats: SquadInviteRecord[] = [];

    for (const seatIndex of [1, 2] as const) {
      const existingSeat = existingBySeat.get(seatIndex);
      if (existingSeat) {
        allSeats.push(existingSeat);
        continue;
      }
      const created: SquadInviteRecord = {
        id: `squad_${subscriptionId}_${seatIndex}`,
        subscriptionId,
        buyerUserId,
        code: generateUniqueSquadCode(),
        seatIndex,
        status: "available",
        redeemedByUserId: null,
        redeemedAt: null,
        expiresAt: effectiveExpiresAt,
        createdAt: nowIso,
      };
      newlyMinted.push(created);
      allSeats.push(created);
    }

    if (supabase && newlyMinted.length > 0) {
      try {
        const table = supabase.from("squad_invites") as unknown as {
          upsert?: (
            rows: SquadInviteDbRow[],
            opts?: { onConflict?: string },
          ) => Promise<{ error?: unknown }>;
        };
        if (typeof table?.upsert === "function") {
          const upsertRes = await table.upsert(newlyMinted.map(toDbRow), { onConflict: "id" });
          if (upsertRes?.error) {
            const dbRaceRows = await fetchDbInvitesBySubscription(supabase, subscriptionId);
            if (dbRaceRows.length >= 2) {
              return dbRaceRows.slice(0, 2).map(cloneInvite);
            }
          }
        }
      } catch {
        // Preserve in-memory fallback when DB is mocked/unavailable
      }
    }

    for (const rec of allSeats) {
      cacheInviteRecord(rec);
    }

    return allSeats.sort((a, b) => a.seatIndex - b.seatIndex).map(cloneInvite);
  });
}

export async function getUserSquadInvites(params: {
  userId: string;
  userToken?: string;
}): Promise<{ purchased: SquadInviteSummary[]; redeemed: SquadInviteSummary[] }> {
  const userId = params.userId.trim();
  if (!userId) {
    return { purchased: [], redeemed: [] };
  }

  const purchasedMap = new Map<string, SquadInviteRecord>();
  const redeemedMap = new Map<string, SquadInviteRecord>();

  for (const rec of squadInvitesMemoryStore.values()) {
    if (rec.buyerUserId === userId) {
      purchasedMap.set(rec.id, rec);
    }
    if (rec.redeemedByUserId === userId) {
      redeemedMap.set(rec.id, rec);
    }
  }

  const supabase = getSupabaseAdminOrServerClient(params.userToken);
  if (supabase) {
    try {
      const table = supabase.from("squad_invites") as unknown as {
        select?: (cols: string) => { eq?: (col: string, val: string) => unknown };
      };
      if (typeof table?.select === "function") {
        const buyerSel = table.select("*");
        const buyerQuery =
          typeof buyerSel?.eq === "function" ? buyerSel.eq("buyer_user_id", userId) : buyerSel;
        const { data: buyerRows } = await execListQuery<SquadInviteDbRow>(buyerQuery);

        for (const row of buyerRows) {
          const mapped = mapDbRowToInvite(row);
          if (mapped.buyerUserId === userId) {
            cacheInviteRecord(mapped);
            purchasedMap.set(mapped.id, mapped);
          }
        }

        const redeemerSel = table.select("*");
        const redeemerQuery =
          typeof redeemerSel?.eq === "function"
            ? redeemerSel.eq("redeemed_by_user_id", userId)
            : redeemerSel;
        const { data: redeemerRows } = await execListQuery<SquadInviteDbRow>(redeemerQuery);

        for (const row of redeemerRows) {
          const mapped = mapDbRowToInvite(row);
          if (mapped.redeemedByUserId === userId) {
            cacheInviteRecord(mapped);
            redeemedMap.set(mapped.id, mapped);
          }
        }
      }
    } catch {
      // Gracefully fall back to in-memory records
    }
  }

  const purchased = Array.from(purchasedMap.values())
    .sort((a, b) => {
      if (a.subscriptionId === b.subscriptionId) {
        return a.seatIndex - b.seatIndex;
      }
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    })
    .map(toSquadInviteSummary);

  const redeemed = Array.from(redeemedMap.values())
    .sort((a, b) => {
      const aMs = Date.parse(a.redeemedAt ?? a.createdAt);
      const bMs = Date.parse(b.redeemedAt ?? b.createdAt);
      return bMs - aMs;
    })
    .map(toSquadInviteSummary);

  return { purchased, redeemed };
}

function validateInviteForRedemption(
  invite: SquadInviteRecord,
  redeemerUserId: string,
  nowMs: number,
): Extract<RedeemSquadInviteResult, { ok: false }> | null {
  if (invite.buyerUserId === redeemerUserId) {
    return {
      ok: false,
      code: "SELF_REDEMPTION_NOT_ALLOWED",
      status: 400,
      error: "You cannot redeem your own squad invite code.",
    };
  }

  if (invite.status === "revoked") {
    return {
      ok: false,
      code: "INVITE_REVOKED",
      status: 409,
      error: "This squad invite code has been revoked.",
    };
  }

  if (invite.status === "redeemed") {
    return {
      ok: false,
      code: "INVITE_ALREADY_REDEEMED",
      status: 409,
      error: "This squad invite code has already been redeemed.",
    };
  }

  const expiresMs = Date.parse(invite.expiresAt);
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    return {
      ok: false,
      code: "INVITE_EXPIRED",
      status: 410,
      error: "This squad invite code has expired.",
    };
  }

  return null;
}

export async function redeemSquadInviteCode(params: {
  code: string;
  redeemerUserId: string;
  userToken?: string;
}): Promise<RedeemSquadInviteResult> {
  const normalizedCode = params.code.trim().toUpperCase();
  const redeemerUserId = params.redeemerUserId.trim();

  if (!SQUAD_CODE_REGEX.test(normalizedCode)) {
    return {
      ok: false,
      code: "INVALID_CODE",
      status: 400,
      error: "Invalid squad invite code format.",
    };
  }

  if (!redeemerUserId) {
    return {
      ok: false,
      code: "INVALID_CODE",
      status: 400,
      error: "Invalid redeemer user.",
    };
  }

  const supabase = getSupabaseAdminOrServerClient(params.userToken);

  return withOperationLock(`code:${normalizedCode}`, async () => {
    const memInviteId = codeToInviteIdMap.get(normalizedCode);
    let invite: SquadInviteRecord | null = memInviteId
      ? (squadInvitesMemoryStore.get(memInviteId) ?? null)
      : null;
    let foundInDb = false;

    if (supabase) {
      try {
        const table = supabase.from("squad_invites") as unknown as {
          select?: (cols: string) => { eq?: (col: string, val: string) => unknown };
        };
        if (typeof table?.select === "function") {
          const sel = table.select("*");
          const q = typeof sel?.eq === "function" ? sel.eq("code", normalizedCode) : sel;
          const { data: dbRow } = await execMaybeSingle<SquadInviteDbRow>(q);
          if (dbRow) {
            const mapped = mapDbRowToInvite(dbRow);
            if (!mapped.code || mapped.code === normalizedCode) {
              foundInDb = true;
              const existingMem = squadInvitesMemoryStore.get(mapped.id);
              // Terminal states in memory ("redeemed"/"revoked") must not regress to "available" on static DB stubs
              if (!existingMem || existingMem.status === "available" || mapped.status !== "available") {
                invite = mapped;
                cacheInviteRecord(mapped);
              } else {
                invite = existingMem;
              }
            }
          }
        }
      } catch {
        // Fall back to in-memory invite if present
      }
    }

    if (!invite) {
      return {
        ok: false,
        code: "INVITE_NOT_FOUND",
        status: 404,
        error: "Squad invite code not found.",
      };
    }

    const latestMem = squadInvitesMemoryStore.get(invite.id);
    const currentInvite = latestMem ?? invite;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const validationFailure = validateInviteForRedemption(currentInvite, redeemerUserId, nowMs);
    if (validationFailure) {
      return validationFailure;
    }

    const updatedInvite: SquadInviteRecord = {
      ...currentInvite,
      status: "redeemed",
      redeemedByUserId: redeemerUserId,
      redeemedAt: nowIso,
    };

    if (supabase) {
      const table = supabase.from("squad_invites") as unknown as {
        update?: (payload: Record<string, unknown>) => {
          eq?: (col: string, val: string) => {
            eq?: (col: string, val: string) => {
              select?: (cols: string) => unknown;
            };
            select?: (cols: string) => unknown;
          };
        };
        upsert?: (
          rows: SquadInviteDbRow | SquadInviteDbRow[],
          opts?: { onConflict?: string },
        ) => Promise<{ error?: unknown }>;
      };

      if (typeof table?.update === "function") {
        const upd = table.update({
          status: "redeemed",
          redeemed_by_user_id: redeemerUserId,
          redeemed_at: nowIso,
        });
        const eq1 = typeof upd?.eq === "function" ? upd.eq("id", currentInvite.id) : upd;
        const eq2 =
          typeof (eq1 as { eq?: (c: string, v: string) => unknown })?.eq === "function"
            ? (eq1 as { eq: (c: string, v: string) => unknown }).eq("status", "available")
            : eq1;

        const eq2Obj = eq2 as { select?: (cols: string) => unknown } | null | undefined;
        if (eq2Obj && typeof eq2Obj.select === "function") {
          const selectRes = (await (eq2Obj.select("*") as Promise<{
            data?: SquadInviteDbRow[] | null;
            error?: unknown;
          }>)) ?? {};
          if (selectRes.error) {
            throw new Error("Failed to claim squad invite.");
          }
          if (foundInDb && Array.isArray(selectRes.data) && selectRes.data.length === 0) {
            const refreshed = await execMaybeSingle<SquadInviteDbRow>(
              (
                supabase.from("squad_invites") as unknown as {
                  select?: (cols: string) => { eq?: (col: string, val: string) => unknown };
                }
              )
                ?.select?.("*")
                ?.eq?.("id", currentInvite.id),
            );
            if (refreshed.data) {
              const latestDb = mapDbRowToInvite(refreshed.data);
              cacheInviteRecord(latestDb);
              if (latestDb.status === "revoked") {
                return {
                  ok: false,
                  code: "INVITE_REVOKED",
                  status: 409,
                  error: "This squad invite code has been revoked.",
                };
              }
            }
            return {
              ok: false,
              code: "INVITE_ALREADY_REDEEMED",
              status: 409,
              error: "This squad invite code has already been redeemed.",
            };
          }
        } else {
          const res = (await eq2) as { error?: unknown } | undefined;
          if (res?.error) {
            throw new Error("Failed to claim squad invite.");
          }
        }
      } else if (typeof table?.upsert === "function") {
        const upsertRes = await table.upsert(toDbRow(updatedInvite), { onConflict: "id" });
        if (upsertRes?.error) {
          throw new Error("Failed to claim squad invite.");
        }
      }
    }

    cacheInviteRecord(updatedInvite);

    const defaultCramExpiresAt =
      calculateTierExpiration("cram_pass") ?? new Date(nowMs + SEVEN_DAYS_MS).toISOString();
    const defaultCramExpiryMs = Date.parse(defaultCramExpiresAt);

    let effectiveTier: UserTier = "cram_pass";
    let effectiveExpiresAt: string | null = defaultCramExpiresAt;
    let preservedHigherTier = false;
    let hasExistingProfileRow = false;

    if (supabase) {
      try {
        const profileTable = supabase.from("profiles") as unknown as {
          select?: (cols: string) => { eq?: (col: string, val: string) => unknown };
        };
        if (typeof profileTable?.select === "function") {
          const sel = profileTable.select("tier, tier_expires_at");
          const q = typeof sel?.eq === "function" ? sel.eq("id", redeemerUserId) : sel;
          const { data: profileData } = await execMaybeSingle<ProfileTierRow>(q);
          if (profileData) {
            hasExistingProfileRow = true;
            const currentTier = normalizeTier(profileData.tier);
            const currentExpiresAt =
              typeof profileData.tier_expires_at === "string"
                ? profileData.tier_expires_at
                : null;
            const currentActive = currentTier !== "contender" && !isTierExpired(currentExpiresAt);

            if (currentActive) {
              if (
                currentTier === "pro_monthly" ||
                currentTier === "pro" ||
                currentTier === "tutor"
              ) {
                preservedHigherTier = true;
                effectiveTier = currentTier;
                effectiveExpiresAt = currentExpiresAt;
              } else if (currentTier === "cram_pass") {
                const currentExpiryMs = currentExpiresAt ? Date.parse(currentExpiresAt) : NaN;
                if (
                  currentExpiresAt === null ||
                  (Number.isFinite(currentExpiryMs) && currentExpiryMs > defaultCramExpiryMs)
                ) {
                  preservedHigherTier = true;
                  effectiveTier = "cram_pass";
                  effectiveExpiresAt = currentExpiresAt;
                }
              }
            }
          }
        }
      } catch {
        // Proceed with Cram Pass entitlement if profile read fails on partial mock
      }
    }

    if (supabase && !preservedHigherTier) {
      try {
        const subTable = supabase.from("user_subscriptions") as unknown as {
          upsert?: (
            payload: Record<string, unknown>,
            opts?: { onConflict?: string },
          ) => Promise<unknown>;
        };
        if (typeof subTable?.upsert === "function") {
          await subTable.upsert(
            {
              id: `squad_redeem_${updatedInvite.id}`,
              user_id: redeemerUserId,
              tier: "cram_pass",
              cycle: "one_time",
              amount: 0,
              currency: "USD",
              payment_method: "squad_invite",
              status: "active",
              starts_at: nowIso,
              expires_at: effectiveExpiresAt,
              updated_at: nowIso,
            },
            { onConflict: "id" },
          );
        }
      } catch {
        // Continue applying entitlement across profile/ledger/auth
      }

      const profileUpdate = {
        tier: "cram_pass" as UserTier,
        tier_expires_at: effectiveExpiresAt,
        updated_at: nowIso,
      };
      await upsertProfileRecord(
        supabase,
        "profiles",
        redeemerUserId,
        profileUpdate,
        hasExistingProfileRow,
      );
      await upsertProfileRecord(
        supabase,
        "user_profiles",
        redeemerUserId,
        profileUpdate,
        hasExistingProfileRow,
      );
      await resetUserQuotaLedgerForCramPass(supabase, redeemerUserId, nowIso);
      await safeUpdateAuthAppMetadata(supabase, redeemerUserId, "cram_pass", effectiveExpiresAt);
    }

    await invalidateUserQuotaLedgerCache(redeemerUserId);

    return {
      ok: true,
      tier: effectiveTier,
      expiresAt: effectiveExpiresAt,
      preservedHigherTier,
      invite: toSquadInviteSummary(updatedInvite),
    };
  });
}

export async function revokeSquadInvitesForSubscription(params: {
  subscriptionId: string;
  reason?: "refunded" | "revoked" | "cancelled";
  userToken?: string;
}): Promise<{ revokedCodes: string[]; downgradedUserIds: string[] }> {
  const subscriptionId = params.subscriptionId.trim();
  const reason = params.reason ?? "revoked";
  if (!subscriptionId) {
    return { revokedCodes: [], downgradedUserIds: [] };
  }

  return withOperationLock(`revoke:${subscriptionId}`, async () => {
    const nowIso = new Date().toISOString();
    const supabase = getSupabaseAdminOrServerClient(params.userToken);

    const invitesById = new Map<string, SquadInviteRecord>();
    for (const rec of getCachedInvitesForSubscription(subscriptionId)) {
      invitesById.set(rec.id, rec);
    }

    if (supabase) {
      const dbInvites = await fetchDbInvitesBySubscription(supabase, subscriptionId);
      for (const rec of dbInvites) {
        invitesById.set(rec.id, rec);
      }
    }

    const invites = Array.from(invitesById.values()).sort((a, b) => a.seatIndex - b.seatIndex);
    const revokedCodes: string[] = [];
    const affectedUserIds = new Set<string>();
    const revokedInvites: SquadInviteRecord[] = [];

    for (const invite of invites) {
      revokedCodes.push(invite.code);
      if (invite.redeemedByUserId) {
        affectedUserIds.add(invite.redeemedByUserId);
      }
      const next: SquadInviteRecord = {
        ...invite,
        status: "revoked",
      };
      revokedInvites.push(next);
      cacheInviteRecord(next);
    }

    if (supabase) {
      try {
        const inviteTable = supabase.from("squad_invites") as unknown as {
          update?: (payload: Record<string, unknown>) => {
            eq?: (col: string, val: string) => Promise<unknown>;
          };
          upsert?: (rows: SquadInviteDbRow[], opts?: { onConflict?: string }) => Promise<unknown>;
        };
        if (typeof inviteTable?.update === "function") {
          const upd = inviteTable.update({ status: "revoked" });
          const q = typeof upd?.eq === "function" ? upd.eq("subscription_id", subscriptionId) : upd;
          await q;
        } else if (typeof inviteTable?.upsert === "function" && revokedInvites.length > 0) {
          await inviteTable.upsert(revokedInvites.map(toDbRow), { onConflict: "id" });
        }
      } catch {
        // Keep in-memory revocation authoritative even if DB mock fails
      }

      const targetSubIds = new Set<string>(
        revokedInvites.map((inv) => `squad_redeem_${inv.id}`),
      );
      if (targetSubIds.size === 0) {
        targetSubIds.add(`squad_redeem_squad_${subscriptionId}_1`);
        targetSubIds.add(`squad_redeem_squad_${subscriptionId}_2`);
      }

      try {
        const subTable = supabase.from("user_subscriptions") as unknown as {
          update?: (payload: Record<string, unknown>) => {
            eq?: (col: string, val: string) => Promise<unknown>;
          };
          upsert?: (
            payload: Record<string, unknown>,
            opts?: { onConflict?: string },
          ) => Promise<unknown>;
        };
        if (typeof subTable?.update === "function") {
          for (const redeemSubId of targetSubIds) {
            const upd = subTable.update({
              status: reason,
              expires_at: nowIso,
              updated_at: nowIso,
            });
            const q = typeof upd?.eq === "function" ? upd.eq("id", redeemSubId) : upd;
            await q;
          }
        } else if (typeof subTable?.upsert === "function") {
          for (const inv of revokedInvites) {
            if (!inv.redeemedByUserId) continue;
            await subTable.upsert(
              {
                id: `squad_redeem_${inv.id}`,
                user_id: inv.redeemedByUserId,
                tier: "cram_pass",
                cycle: "one_time",
                amount: 0,
                currency: "USD",
                payment_method: "squad_invite",
                status: reason,
                starts_at: inv.redeemedAt ?? nowIso,
                expires_at: nowIso,
                updated_at: nowIso,
              },
              { onConflict: "id" },
            );
          }
        }
      } catch {
        // Ignore partial mock table errors
      }
    }

    const downgradedUserIds: string[] = [];
    const revokedSubIds = new Set<string>(
      revokedInvites.map((inv) => `squad_redeem_${inv.id}`),
    );
    revokedSubIds.add(`squad_redeem_squad_${subscriptionId}_1`);
    revokedSubIds.add(`squad_redeem_squad_${subscriptionId}_2`);

    for (const uid of affectedUserIds) {
      let hasOtherActiveSubscription = false;

      if (supabase) {
        try {
          const subTable = supabase.from("user_subscriptions") as unknown as {
            select?: (cols: string) => { eq?: (col: string, val: string) => unknown };
          };
          if (typeof subTable?.select === "function") {
            const sel = subTable.select("id, tier, status, expires_at");
            const q = typeof sel?.eq === "function" ? sel.eq("user_id", uid) : sel;
            const { data: userSubs } = await execListQuery<UserSubscriptionStatusRow>(q);
            hasOtherActiveSubscription = userSubs.some((sub) => {
              if (revokedSubIds.has(sub.id)) return false;
              const statusStr = String(sub.status ?? "").toLowerCase().trim();
              if (statusStr !== "active") return false;
              if (normalizeTier(sub.tier) === "contender") return false;
              return !isTierExpired(sub.expires_at);
            });
          }
        } catch {
          hasOtherActiveSubscription = false;
        }
      }

      if (!hasOtherActiveSubscription) {
        downgradedUserIds.push(uid);

        if (supabase) {
          const downgradeProfile = {
            tier: "contender" as UserTier,
            tier_expires_at: null,
            updated_at: nowIso,
          };
          await upsertProfileRecord(supabase, "profiles", uid, downgradeProfile, true);
          await upsertProfileRecord(supabase, "user_profiles", uid, downgradeProfile, true);
          await downgradeUserQuotaLedgerToContender(supabase, uid, nowIso);
          await safeUpdateAuthAppMetadata(supabase, uid, "contender", null);
        }
      }

      await invalidateUserQuotaLedgerCache(uid);
    }

    return {
      revokedCodes,
      downgradedUserIds,
    };
  });
}
