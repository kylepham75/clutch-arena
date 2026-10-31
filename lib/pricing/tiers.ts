export type UserTier = "contender" | "cram_pass" | "pro" | "tutor";

export type BillingCycle = "free" | "one_time" | "monthly" | "semester";

export interface TierLimits {
  tier: UserTier;
  maxUploadsPerWeek: number;
  maxFilesPerUpload: number;
  maxQuestionsPerRun: number;
  canUseConceptRemix: boolean;
  canDebriefWithCoach: boolean;
  canExportCheatSheet: boolean;
  canHostArenaRemix: boolean;
  maxArenaPlayers: number;
  hasCohortAnalytics: boolean;
  canUseClutchNotes: boolean;
  maxNotesPerDay: number;
  // Stage 1 Section 7 Quota & COGS fields
  newDeckCredits: number;
  dailyDeckBurstLimit: number;
  freeRegenerationsPerDeck: number;
  cogsCeilingUsd: number;
  verifiedPoolSize: number;
  servedSubsetSize: number;
}

export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  contender: {
    tier: "contender",
    maxUploadsPerWeek: 2,
    maxFilesPerUpload: 1,
    maxQuestionsPerRun: 15,
    canUseConceptRemix: false,
    canDebriefWithCoach: false,
    canExportCheatSheet: false,
    canHostArenaRemix: false,
    maxArenaPlayers: 8,
    hasCohortAnalytics: false,
    canUseClutchNotes: true,
    maxNotesPerDay: 1,
    newDeckCredits: 3,
    dailyDeckBurstLimit: 3,
    freeRegenerationsPerDeck: 1,
    cogsCeilingUsd: 0.05,
    verifiedPoolSize: 15,
    servedSubsetSize: 15,
  },
  cram_pass: {
    tier: "cram_pass",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 10,
    maxQuestionsPerRun: 35,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 15,
    hasCohortAnalytics: false,
    canUseClutchNotes: true,
    maxNotesPerDay: 30,
    newDeckCredits: 12,
    dailyDeckBurstLimit: 4,
    freeRegenerationsPerDeck: 3,
    cogsCeilingUsd: 1.25,
    verifiedPoolSize: 35,
    servedSubsetSize: 25,
  },
  pro: {
    tier: "pro",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 10,
    maxQuestionsPerRun: 35,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 15,
    hasCohortAnalytics: false,
    canUseClutchNotes: true,
    maxNotesPerDay: 30,
    newDeckCredits: 50,
    dailyDeckBurstLimit: 6,
    freeRegenerationsPerDeck: 5,
    cogsCeilingUsd: 9.75,
    verifiedPoolSize: 35,
    servedSubsetSize: 35,
  },
  tutor: {
    tier: "tutor",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 10,
    maxQuestionsPerRun: 35,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 50,
    hasCohortAnalytics: true,
    canUseClutchNotes: true,
    maxNotesPerDay: 50,
    newDeckCredits: 50,
    dailyDeckBurstLimit: 50,
    freeRegenerationsPerDeck: 5,
    cogsCeilingUsd: 7.00,
    verifiedPoolSize: 35,
    servedSubsetSize: 35,
  },
};

export function getMaxArenaPlayersForTier(tier: UserTier): number {
  return TIER_LIMITS[tier]?.maxArenaPlayers ?? 8;
}

export function formatDeckCreditsCounter(used: number, limit: number): string {
  return `${used} of ${limit} decks used`;
}

/* -------------------------------------------------------------------------- */
/*  COGS Degradation Ladder & Unit Economic Protection Engine                */
/* -------------------------------------------------------------------------- */

export type CogsDegradationMode = "full" | "gentle" | "hard" | "halted";

export interface CogsBudgetStatus {
  mode: CogsDegradationMode;
  spentUsd: number;
  reservedUsd: number;
  projectedUsd: number;
  ceilingUsd: number;
  utilizationRatio: number;
  targetQuestionCount: number;
  allowVisionOcr: boolean;
  allowBorderlineVision: boolean;
  allowCrossFamilyVerifier: boolean;
  useCheaperGeneratorSlug: boolean;
  conciseExplanations: boolean;
  serveCachedPoolsOnly: boolean;
  bannerNotice: string | null;
}

export function evaluateCogsDegradation(
  spentUsd: number,
  ceilingUsd: number,
  estimatedCallCostUsd = 0,
  reservedUsd = 0,
): CogsBudgetStatus {
  const res = reservedUsd ?? 0;
  const est = estimatedCallCostUsd ?? 0;
  const projectedUsd = Number((spentUsd + res + est).toFixed(6));
  const utilizationRatio =
    ceilingUsd > 0
      ? Number((projectedUsd / ceilingUsd).toFixed(4))
      : projectedUsd > 0
        ? 1.01
        : 0;

  if (utilizationRatio > 1.0) {
    return {
      mode: "halted",
      spentUsd,
      reservedUsd: res,
      projectedUsd,
      ceilingUsd,
      utilizationRatio,
      targetQuestionCount: 0,
      allowVisionOcr: false,
      allowBorderlineVision: false,
      allowCrossFamilyVerifier: false,
      useCheaperGeneratorSlug: true,
      conciseExplanations: true,
      serveCachedPoolsOnly: true,
      bannerNotice:
        "Subscription deck generation budget reached for this period. Cached class decks remain free and instantly accessible.",
    };
  }

  if (utilizationRatio > 0.9) {
    return {
      mode: "hard",
      spentUsd,
      reservedUsd: res,
      projectedUsd,
      ceilingUsd,
      utilizationRatio,
      targetQuestionCount: 15,
      allowVisionOcr: false,
      allowBorderlineVision: false,
      allowCrossFamilyVerifier: false,
      useCheaperGeneratorSlug: true,
      conciseExplanations: true,
      serveCachedPoolsOnly: false,
      bannerNotice: null,
    };
  }

  if (utilizationRatio >= 0.7) {
    return {
      mode: "gentle",
      spentUsd,
      reservedUsd: res,
      projectedUsd,
      ceilingUsd,
      utilizationRatio,
      targetQuestionCount: 20,
      allowVisionOcr: true,
      allowBorderlineVision: false,
      allowCrossFamilyVerifier: true,
      useCheaperGeneratorSlug: true,
      conciseExplanations: true,
      serveCachedPoolsOnly: false,
      bannerNotice: null,
    };
  }

  return {
    mode: "full",
    spentUsd,
    reservedUsd: res,
    projectedUsd,
    ceilingUsd,
    utilizationRatio,
    targetQuestionCount: 25,
    allowVisionOcr: true,
    allowBorderlineVision: true,
    allowCrossFamilyVerifier: true,
    useCheaperGeneratorSlug: false,
    conciseExplanations: false,
    serveCachedPoolsOnly: false,
    bannerNotice: null,
  };
}

export interface PlanPricing {
  id: UserTier;
  cycle: BillingCycle;
  nameEn: string;
  nameVi: string;
  taglineEn: string;
  taglineVi: string;
  badgeEn?: string;
  badgeVi?: string;
  priceVnd: number;
  priceVndFormatted: string;
  priceUsd: number;
  priceUsdFormatted: string;
  featuresEn: string[];
  featuresVi: string[];
  recommended?: boolean;
  comingSoon?: boolean;
}

export const PRICING_PLANS: PlanPricing[] = [
  {
    id: "contender",
    cycle: "free",
    nameEn: "Contender",
    nameVi: "Người Thách Đấu",
    taglineEn: "Zero-cost viral entry for solo recall & friendly lobbies",
    taglineVi: "Bắt đầu miễn phí cho ôn tập cá nhân & tham gia phòng đấu",
    priceVnd: 0,
    priceVndFormatted: "0đ",
    priceUsd: 0,
    priceUsdFormatted: "$0",
    featuresEn: [
      "3 document deck credits (15 questions per pack)",
      "1 free regeneration per deck",
      "1 short summary note",
      "Cross-family blind AI verification ON",
      "Unlimited joining of friend /arena rooms (100% free)",
      "Basic document grounding & citations (no distractor rationale)",
    ],
    featuresVi: [
      "3 lượt tạo bộ đề tài liệu (15 câu hỏi / bộ)",
      "1 lần tạo lại miễn phí cho mỗi bộ đề",
      "1 bản tóm tắt ngắn",
      "Hệ thống kiểm định chéo AI độc lập bật 100%",
      "Tham gia phòng đấu /arena của bạn bè không giới hạn (100% miễn phí)",
      "Trích dẫn căn cứ gốc (không kèm giải thích bẫy đáp án nhiễu)",
    ],
  },
  {
    id: "cram_pass",
    cycle: "one_time",
    nameEn: "7-Day Cram Pass",
    nameVi: "Vé Ôn Thi Cấp Tốc (7 Ngày)",
    taglineEn: "No subscription. Instant unlock 48h before exams",
    taglineVi: "Thanh toán 1 lần, không gia hạn. Dành cho 48h nước rút trước kỳ thi",
    badgeEn: "Most Popular for Finals",
    badgeVi: "Được chọn nhiều nhất mùa thi",
    recommended: true,
    priceVnd: 5_000,
    priceVndFormatted: "5.000đ",
    priceUsd: 3.99,
    priceUsdFormatted: "$3.99",
    featuresEn: [
      "7 days full Pro access (one-time purchase)",
      "12 document deck credits (up to 35 questions per pack)",
      "Full distractor rationale ('why the others are wrong')",
      "Full, sectioned Clutch Notes revision notes generator",
      "3 free regenerations per deck",
      "Cross-family blind AI verification ON",
      "Multi-document synthesis (up to 10 files / 25MB)",
      "Unlimited AI Coach deep debriefs",
    ],
    featuresVi: [
      "7 ngày toàn quyền Pro (mua 1 lần, không trừ tiền tự động)",
      "12 lượt tạo bộ đề tài liệu (tối đa 35 câu hỏi / bộ)",
      "Giải thích bẫy đáp án nhiễu ('vì sao các đáp án khác sai')",
      "Tạo tài liệu Clutch Notes đầy đủ, phân mục chi tiết",
      "3 lần tạo lại miễn phí cho mỗi bộ đề",
      "Hệ thống kiểm định chéo AI độc lập bật 100%",
      "Tổng hợp đa tài liệu cùng lúc (tối đa 10 tệp / 25MB)",
      "Gia sư AI phản hồi và hướng dẫn chi tiết không giới hạn",
    ],
  },
  {
    id: "pro",
    cycle: "semester",
    nameEn: "Clutch Pro (Semester)",
    nameVi: "Đấu Sĩ Pro (Học Kỳ)",
    taglineEn: "Continuous mastery with host privileges all semester",
    taglineVi: "Đặc quyền Chủ phòng & làm chủ toàn bộ học kỳ không gián đoạn",
    badgeEn: "Best Value ($7.25/mo)",
    badgeVi: "Tiết kiệm nhất (74.750đ/tháng)",
    priceVnd: 299_000,
    priceVndFormatted: "299.000đ",
    priceUsd: 29.0,
    priceUsdFormatted: "$29",
    featuresEn: [
      "Full access for entire 4-month semester",
      "50 document deck credits (up to 35 questions per pack)",
      "Full distractor rationale ('why the others are wrong')",
      "Full, sectioned Clutch Notes revision notes generator (30 decks/day)",
      "5 free regenerations per deck",
      "Cross-family blind AI verification ON",
      "Host Privileges: host 35Q remix rooms (friends play free!)",
      "Multi-document synthesis up to 10 files",
      "1-Click PDF Cheat Sheet with verbatim citations",
    ],
    featuresVi: [
      "Toàn quyền suốt 4 tháng học kỳ (tương đương 74.000đ/tháng)",
      "50 lượt tạo bộ đề tài liệu (tối đa 35 câu hỏi / bộ)",
      "Giải thích bẫy đáp án nhiễu ('vì sao các đáp án khác sai')",
      "Tạo tài liệu Clutch Notes đầy đủ, phân mục chi tiết (30 bộ/ngày)",
      "5 lần tạo lại miễn phí cho mỗi bộ đề",
      "Hệ thống kiểm định chéo AI độc lập bật 100%",
      "Đặc quyền Chủ phòng: mở phòng 35 câu Remix cho bạn bè chơi miễn phí",
      "Tổng hợp đa tài liệu cùng lúc lên đến 10 tệp",
      "Xuất cẩm nang Cheat Sheet PDF kèm trích dẫn gốc",
      "Đồng bộ đám mây trên mọi thiết bị qua Supabase",
    ],
  },
  {
    id: "tutor",
    cycle: "monthly",
    nameEn: "Tutor & Guild",
    nameVi: "Giảng Viên & Nhóm Học",
    taglineEn: "For university TAs, IELTS/SAT tutors & study guilds",
    taglineVi: "Dành cho trợ giảng đại học, gia sư IELTS/SAT & câu lạc bộ học tập",
    badgeEn: "Coming Soon",
    badgeVi: "Sắp ra mắt",
    comingSoon: true,
    priceVnd: 399_000,
    priceVndFormatted: "399.000đ",
    priceUsd: 19.99,
    priceUsdFormatted: "$19.99",
    featuresEn: [
      "Clutch Notes AI: Slide-to-summary lecture notes generator",
      "32+ player /arena lobbies for live classroom reviews",
      "Custom branded Base64 pack links (your name & logo)",
      "Cohort accuracy & missed-concept analytics",
      "Unlimited students join classroom rooms for $0",
      "Priority API queue for high-concurrency match starts",
    ],
    featuresVi: [
      "Clutch Notes AI: Tóm tắt slide bài giảng PDF/PPTX thành tài liệu ôn thi",
      "Phòng đấu /arena lên đến 32+ người cho lớp học trực tiếp",
      "Mã chia sẻ Base64 gắn thương hiệu & logo riêng của bạn",
      "Bảng phân tích độ chính xác & lỗ hổng kiến thức chung của lớp",
      "Học viên tham gia phòng học hoàn toàn miễn phí ($0)",
      "Ưu tiên hàng đợi máy chủ khi khởi tạo trận đấu đông người",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  Referral & Earn-Your-Pass Store                                           */
/* -------------------------------------------------------------------------- */

export const REFERRAL_STORAGE_KEY = "clutch:referrals:v1";
export const USER_TIER_STORAGE_KEY = "clutch:user_tier:v1";
export const USER_TIER_EXPIRES_KEY = "clutch:user_tier_expires:v1";

export interface ReferralState {
  unlockedRemixRuns: number;
  friendsInvited: number;
  roomsHostedWith4Players: number;
  packsImportedByClassmates: number;
}

/**
 * Calculates default expiration ISO timestamp based on tier cycle.
 * - cram_pass: 7 days
 * - pro: 120 days (4-month semester)
 * - tutor: 30 days (1 month)
 * - contender: null (permanent free)
 */
export function calculateTierExpiration(tier: UserTier): string | null {
  const now = Date.now();
  if (tier === "cram_pass") {
    return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (tier === "pro") {
    return new Date(now + 120 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (tier === "tutor") {
    return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

/**
 * Normalizes raw tier values from cloud profiles or external inputs to valid UserTier.
 */
export function normalizeTier(raw: unknown): UserTier {
  if (typeof raw !== "string") return "contender";
  const t = raw.toLowerCase().trim();
  if (t === "cram_pass" || t === "crampass" || t === "cram-pass") return "cram_pass";
  if (t === "pro") return "pro";
  if (t === "tutor") return "tutor";
  return "contender";
}

/**
 * Checks if a tier expiration timestamp has elapsed.
 */
export function isTierExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expMs = new Date(expiresAt).getTime();
  if (isNaN(expMs)) return false;
  return expMs <= Date.now();
}

export interface ProfileRecordLike {
  tier?: string | null;
  tier_expires_at?: string | null;
  updated_at?: string | null;
}

/**
 * Resolves active tier and expiration from a profiles or user_profiles database record.
 * Handles manual admin non-expiring grants and grants updated after previous expiration.
 */
export function resolveTierFromProfileRecord(
  record: ProfileRecordLike | null | undefined,
): { tier: UserTier; expiresAt: string | null } | null {
  if (!record?.tier) return null;

  const normTier = normalizeTier(record.tier);
  if (normTier === "contender") return null;

  if (!record.tier_expires_at) {
    return { tier: normTier, expiresAt: null };
  }

  const expMs = new Date(record.tier_expires_at).getTime();
  if (!isNaN(expMs) && expMs > Date.now()) {
    return { tier: normTier, expiresAt: record.tier_expires_at };
  }

  if (record.updated_at) {
    const updatedMs = new Date(record.updated_at).getTime();
    if (!isNaN(updatedMs) && !isNaN(expMs) && updatedMs > expMs) {
      return { tier: normTier, expiresAt: calculateTierExpiration(normTier) };
    }
  }

  return null;
}

export function getStoredTierExpires(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(USER_TIER_EXPIRES_KEY);
  } catch {
    return null;
  }
}

export function getStoredUserTier(): UserTier {
  if (typeof window === "undefined") return "contender";
  try {
    const raw = localStorage.getItem(USER_TIER_STORAGE_KEY);
    const expiresRaw = localStorage.getItem(USER_TIER_EXPIRES_KEY);

    // If an expiration timestamp exists and has elapsed, revert to contender
    if (isTierExpired(expiresRaw)) {
      localStorage.setItem(USER_TIER_STORAGE_KEY, "contender");
      localStorage.removeItem(USER_TIER_EXPIRES_KEY);
      return "contender";
    }

    return normalizeTier(raw);
  } catch {
    // localStorage unavailable
  }
  return "contender";
}

export function setStoredUserTier(tier: UserTier, expiresAt?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const calculatedExpires =
      expiresAt !== undefined ? expiresAt : calculateTierExpiration(tier);

    localStorage.setItem(USER_TIER_STORAGE_KEY, tier);
    if (calculatedExpires) {
      localStorage.setItem(USER_TIER_EXPIRES_KEY, calculatedExpires);
    } else {
      localStorage.removeItem(USER_TIER_EXPIRES_KEY);
    }

    window.dispatchEvent(
      new CustomEvent("clutch:tier_updated", {
        detail: { tier, expiresAt: calculatedExpires },
      }),
    );

    // Never allow client-side code to overwrite an active paid tier with contender
    if (tier === "contender") {
      const currentTier = localStorage.getItem(USER_TIER_STORAGE_KEY);
      const currentExpires = localStorage.getItem(USER_TIER_EXPIRES_KEY);
      if (currentTier && normalizeTier(currentTier) !== "contender") {
        if (!isTierExpired(currentExpires)) {
          // Active unexpired paid tier; do not downgrade client-side
          return;
        }
      }
      void syncUserTierToCloud("contender", null);
    }
  } catch {
    // ignore
  }
}

export function clearStoredUserTier(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(USER_TIER_STORAGE_KEY, "contender");
    localStorage.removeItem(USER_TIER_EXPIRES_KEY);
    window.dispatchEvent(
      new CustomEvent("clutch:tier_updated", {
        detail: { tier: "contender", expiresAt: null },
      }),
    );
  } catch {
    // ignore
  }
}

/**
 * Syncs downgrade-to-free state to Supabase when an entitlement expires.
 * Paid tier upgrades must only be written server-side via payment webhooks.
 */
export async function syncUserTierToCloud(
  tier: UserTier,
  expiresAt?: string | null,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // Security guard: prevent client from writing paid tiers to Supabase
  if (tier !== "contender") return false;

  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return false;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    // Guard: Prevent downgrading if cloud profile currently has an active unexpired paid tier
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("tier, tier_expires_at, updated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (resolveTierFromProfileRecord(currentProfile)) {
      // Cloud subscription is still active; block downgrade
      return false;
    }

    const now = new Date().toISOString();
    const payload = {
      id: user.id,
      email: user.email,
      tier,
      tier_expires_at: expiresAt ?? null,
      updated_at: now,
    };

    // Upsert into `profiles` table
    try {
      await supabase.from("profiles").upsert(payload);
    } catch {
      // profiles table might be pending migration
    }

    // Also update `user_profiles` for backwards compatibility
    try {
      await supabase.from("user_profiles").upsert(payload);
    } catch {
      // ignore
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches the authoritative user tier & expiration timestamp from Supabase
 * (`user_subscriptions` and `profiles`) and overwrites any spoofed local state.
 */
export async function fetchCloudUserTier(): Promise<{
  tier: UserTier;
  expiresAt: string | null;
  isExpired: boolean;
}> {
  const defaultResult = {
    tier: "contender" as UserTier,
    expiresAt: null,
    isExpired: false,
  };

  if (typeof window === "undefined") return defaultResult;

  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return defaultResult;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      clearStoredUserTier();
      return defaultResult;
    }

    let cloudTier: string | null = null;
    let cloudExpiresAt: string | null = null;

    // 1. Check active `user_subscriptions` first
    const { data: subData, error: subErr } = await supabase
      .from("user_subscriptions")
      .select("tier, expires_at, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subErr && subData?.tier) {
      const isSubExpired = isTierExpired(subData.expires_at);

      if (!isSubExpired) {
        cloudTier = subData.tier;
        cloudExpiresAt = subData.expires_at;
      }
      // If subscription has expired, do not stop; fall through to profiles table!
    }

    if (!cloudTier) {
      // 2. Fallback to `profiles` table
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("tier, tier_expires_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!profileErr && profileData) {
        const resolved = resolveTierFromProfileRecord(profileData);
        if (resolved) {
          cloudTier = resolved.tier;
          cloudExpiresAt = resolved.expiresAt;
        }
      }
    }

    if (!cloudTier) {
      // 3. Fallback to `user_profiles` table
      const { data: userProfileData, error: userProfileErr } = await supabase
        .from("user_profiles")
        .select("tier, tier_expires_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!userProfileErr && userProfileData) {
        const resolved = resolveTierFromProfileRecord(userProfileData);
        if (resolved) {
          cloudTier = resolved.tier;
          cloudExpiresAt = resolved.expiresAt;
        }
      }
    }

    if (!cloudTier) {
      clearStoredUserTier();
      return defaultResult;
    }

    const normalizedTier = normalizeTier(cloudTier);

    // Check if the cloud subscription has expired
    if (isTierExpired(cloudExpiresAt)) {
      // Expired! Downgrade local and cloud state to contender
      setStoredUserTier("contender", null);
      void syncUserTierToCloud("contender", null);
      return { tier: "contender", expiresAt: null, isExpired: true };
    }

    // Update local storage with cloud source of truth
    if (normalizedTier !== getStoredUserTier() || cloudExpiresAt !== getStoredTierExpires()) {
      localStorage.setItem(USER_TIER_STORAGE_KEY, normalizedTier);
      if (cloudExpiresAt) {
        localStorage.setItem(USER_TIER_EXPIRES_KEY, cloudExpiresAt);
      } else {
        localStorage.removeItem(USER_TIER_EXPIRES_KEY);
      }
      window.dispatchEvent(
        new CustomEvent("clutch:tier_updated", {
          detail: { tier: normalizedTier, expiresAt: cloudExpiresAt },
        }),
      );
    }

    return {
      tier: normalizedTier,
      expiresAt: cloudExpiresAt,
      isExpired: false,
    };
  } catch {
    return defaultResult;
  }
}

export const syncUserTierWithCloud = fetchCloudUserTier;

export function getStoredReferralState(): ReferralState {
  const defaultState: ReferralState = {
    unlockedRemixRuns: 0,
    friendsInvited: 0,
    roomsHostedWith4Players: 0,
    packsImportedByClassmates: 0,
  };
  if (typeof window === "undefined") return defaultState;
  try {
    const raw = localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (raw) {
      return { ...defaultState, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return defaultState;
}

export function saveStoredReferralState(state: ReferralState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("clutch:referrals_updated", { detail: state }));
  } catch {
    // ignore
  }
}

/**
 * Consumes one unlocked Concept Remix run if available.
 * Returns true if a run was consumed, false otherwise.
 */
export function consumeUnlockedRemixRun(): boolean {
  const current = getStoredReferralState();
  if (current.unlockedRemixRuns > 0) {
    saveStoredReferralState({
      ...current,
      unlockedRemixRuns: current.unlockedRemixRuns - 1,
    });
    return true;
  }
  return false;
}

/**
 * Awards 3 free Concept Remix runs when a referral condition is met
 * (e.g., hosting a 4-player game or getting 3 friends to import a pack).
 */
export function awardReferralPass(reason: "arena_4_player" | "pack_imports_3"): void {
  const current = getStoredReferralState();
  const next: ReferralState = {
    ...current,
    unlockedRemixRuns: current.unlockedRemixRuns + 3,
    ...(reason === "arena_4_player"
      ? { roomsHostedWith4Players: current.roomsHostedWith4Players + 1 }
      : { packsImportedByClassmates: current.packsImportedByClassmates + 3 }),
  };
  saveStoredReferralState(next);
}
