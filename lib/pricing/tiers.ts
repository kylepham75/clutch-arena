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
}

export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  contender: {
    tier: "contender",
    maxUploadsPerWeek: 2,
    maxFilesPerUpload: 1,
    maxQuestionsPerRun: 10,
    canUseConceptRemix: false,
    canDebriefWithCoach: false,
    canExportCheatSheet: false,
    canHostArenaRemix: false,
    maxArenaPlayers: 8,
    hasCohortAnalytics: false,
  },
  cram_pass: {
    tier: "cram_pass",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 10,
    maxQuestionsPerRun: 30,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 16,
    hasCohortAnalytics: false,
  },
  pro: {
    tier: "pro",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 10,
    maxQuestionsPerRun: 30,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 16,
    hasCohortAnalytics: false,
  },
  tutor: {
    tier: "tutor",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 10,
    maxQuestionsPerRun: 30,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 32,
    hasCohortAnalytics: true,
  },
};

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
      "2 document uploads / week (1 file per upload)",
      "Up to 10 questions per run in Classic Recall",
      "Unlimited joining of friend /arena rooms (100% free)",
      "Unlimited Base64 pack importing ($0 AI token cost)",
      "Basic document grounding & citations",
    ],
    featuresVi: [
      "2 lần tải tài liệu / tuần (1 tệp mỗi lần tải)",
      "Tối đa 10 câu hỏi / lượt ở chế độ Ôn tập kinh điển",
      "Tham gia phòng đấu /arena của bạn bè không giới hạn (100% miễn phí)",
      "Nhập bộ đề chia sẻ Base64 không giới hạn (0đ chi phí token AI)",
      "Trích dẫn và căn cứ câu hỏi từ tài liệu gốc",
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
    priceVnd: 69_000,
    priceVndFormatted: "69.000đ",
    priceUsd: 3.99,
    priceUsdFormatted: "$3.99",
    featuresEn: [
      "7 days full Pro access (one-time purchase)",
      "Multi-document synthesis (up to 10 files / 25MB)",
      "Full 30-question runs & Concept Remix mode",
      "Unlimited AI Coach deep debriefs",
      "1-Click PDF Cheat Sheet export of missed questions",
      "Smart model routing for high-speed generation",
    ],
    featuresVi: [
      "7 ngày toàn quyền Pro (mua 1 lần, không trừ tiền tự động)",
      "Tổng hợp đa tài liệu cùng lúc (tối đa 10 tệp / 25MB)",
      "Đầy đủ 30 câu hỏi / lượt & chế độ Biến thể Concept Remix",
      "Gia sư AI phản hồi và hướng dẫn chi tiết không giới hạn",
      "Xuất cẩm nang Cheat Sheet PDF 1 chạm các câu làm sai",
      "Định tuyến mô hình AI ưu tiên xử lý tốc độ cao",
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
      "Host Privileges: host 30Q remix rooms (friends play free!)",
      "Multi-document synthesis up to 10 files",
      "1-Click PDF Cheat Sheet with verbatim citations",
      "Unlimited AI Coach debriefs & comeback sprints",
      "Cloud sync across all devices via Supabase",
    ],
    featuresVi: [
      "Toàn quyền suốt 4 tháng học kỳ (tương đương 74.000đ/tháng)",
      "Đặc quyền Chủ phòng: mở phòng 30 câu Remix cho bạn bè chơi miễn phí",
      "Tổng hợp đa tài liệu cùng lúc lên đến 10 tệp",
      "Xuất cẩm nang Cheat Sheet PDF kèm trích dẫn gốc",
      "Gia sư AI & Luyện bứt phá điểm yếu không giới hạn",
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
    badgeEn: "Educator Tier",
    badgeVi: "Dành cho Giảng viên",
    priceVnd: 399_000,
    priceVndFormatted: "399.000đ",
    priceUsd: 19.99,
    priceUsdFormatted: "$19.99",
    featuresEn: [
      "32+ player /arena lobbies for live classroom reviews",
      "Custom branded Base64 pack links (your name & logo)",
      "Cohort accuracy & missed-concept analytics",
      "Unlimited students join classroom rooms for $0",
      "Priority API queue for high-concurrency match starts",
    ],
    featuresVi: [
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
    if (expiresRaw) {
      const expiresMs = new Date(expiresRaw).getTime();
      if (!isNaN(expiresMs) && expiresMs <= Date.now()) {
        localStorage.setItem(USER_TIER_STORAGE_KEY, "contender");
        localStorage.removeItem(USER_TIER_EXPIRES_KEY);
        return "contender";
      }
    }

    if (raw && (raw === "contender" || raw === "cram_pass" || raw === "pro" || raw === "tutor")) {
      return raw;
    }
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

    // Sync to Supabase in the background if the user is authenticated
    void syncUserTierToCloud(tier, calculatedExpires);
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
 * Syncs the user tier & expiration timestamp to Supabase `profiles` & `user_profiles`.
 */
export async function syncUserTierToCloud(
  tier: UserTier,
  expiresAt?: string | null,
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return false;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

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

    // Record subscription event for paid plans
    if (tier !== "contender") {
      try {
        await supabase.from("user_subscriptions").insert({
          user_id: user.id,
          tier,
          cycle: tier === "cram_pass" ? "one_time" : tier === "pro" ? "semester" : "monthly",
          amount: tier === "cram_pass" ? 69000 : tier === "pro" ? 299000 : 399000,
          currency: "VND",
          payment_method: "vietqr",
          status: "active",
          starts_at: now,
          expires_at: expiresAt ?? null,
        });
      } catch {
        // subscription history table optional
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches the user tier & expiration timestamp from Supabase and syncs to localStorage.
 * Used when a user logs in on a new device (e.g. mobile after purchasing on laptop).
 */
export async function fetchCloudUserTier(): Promise<{
  tier: UserTier;
  expiresAt: string | null;
  isExpired: boolean;
}> {
  const defaultResult = {
    tier: getStoredUserTier(),
    expiresAt: getStoredTierExpires(),
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
    if (!user) return defaultResult;

    let cloudTier: string | null = null;
    let cloudExpiresAt: string | null = null;

    // Check `profiles` table first
    const { data: profileData, error: profileErr } = await supabase
      .from("profiles")
      .select("tier, tier_expires_at")
      .eq("id", user.id)
      .maybeSingle();

    if (!profileErr && profileData) {
      cloudTier = profileData.tier;
      cloudExpiresAt = profileData.tier_expires_at;
    } else {
      // Fallback to `user_profiles` table
      const { data: userProfileData, error: userProfileErr } = await supabase
        .from("user_profiles")
        .select("tier, tier_expires_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!userProfileErr && userProfileData) {
        cloudTier = userProfileData.tier;
        cloudExpiresAt = userProfileData.tier_expires_at;
      }
    }

    if (!cloudTier) return defaultResult;

    let normalizedTier: UserTier = "contender";
    if (cloudTier === "cram_pass" || cloudTier === "pro" || cloudTier === "tutor") {
      normalizedTier = cloudTier;
    }

    // Check if the cloud subscription has expired
    if (cloudExpiresAt) {
      const expiresMs = new Date(cloudExpiresAt).getTime();
      if (!isNaN(expiresMs) && expiresMs <= Date.now()) {
        // Expired! Downgrade local and cloud state to contender
        setStoredUserTier("contender", null);
        void syncUserTierToCloud("contender", null);
        return { tier: "contender", expiresAt: null, isExpired: true };
      }
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
