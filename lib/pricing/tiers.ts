export type UserTier = "contender" | "cram_pass" | "pro_monthly" | "pro" | "tutor";

export type TierKey = UserTier;

export type PlanId = TierKey | "pro_semester" | "tutor_guild";

export type BillingCycle = "free" | "one_time" | "monthly" | "semester";

export type BillingRegion = "VN" | "ROW";

export interface RegionalPrice {
  amount: number;
  currency: "VND" | "USD";
  formatted: string;
}

export interface TierLimits {
  tier: TierKey;
  maxUploadsPerWeek: number;
  maxFilesPerUpload: number;
  maxQuestionsPerRun: number;
  canUseConceptRemix: boolean;
  canDebriefWithCoach: boolean;
  maxCoachDebriefRepliesPerRun?: number;
  canExportCheatSheet: boolean;
  canHostArenaRemix: boolean;
  maxArenaPlayers: number;
  hasCohortAnalytics: boolean;
  canUseClutchNotes: boolean;
  maxNotesPerDay: number;
  canCustomWatermarkPdf?: boolean;
  // Stage 1 Section 7 Quota & COGS fields
  newDeckCredits: number;
  sonnetProDeckCredits: number;
  haikuOverflowDeckCredits: number;
  dailyDeckBurstLimit: number;
  freeRegenerationsPerDeck: number;
  cogsCeilingUsd: number | { VN: number; ROW: number };
  verifiedPoolSize: number;
  servedSubsetSize: number;
}

export type RegionalCogsCeiling = { VN: number; ROW: number };

function createRegionalCeiling(vn: number, row: number): number & RegionalCogsCeiling {
  const boxed = new Number(vn);
  Object.assign(boxed, { VN: vn, ROW: row });
  return boxed as unknown as number & RegionalCogsCeiling;
}

export function resolveRegionalCeiling(
  ceilingUsd: number | RegionalCogsCeiling | (number & RegionalCogsCeiling),
  region: BillingRegion = "VN",
): number {
  if (
    ceilingUsd !== null &&
    typeof ceilingUsd === "object" &&
    ("VN" in ceilingUsd || "ROW" in ceilingUsd)
  ) {
    const regional = ceilingUsd as RegionalCogsCeiling;
    return Number(region === "ROW" ? (regional.ROW ?? regional.VN) : (regional.VN ?? regional.ROW));
  }
  return Number(ceilingUsd);
}

export function getRegionalCogsCeiling(
  tierOrCeiling: TierKey | number | RegionalCogsCeiling | (number & RegionalCogsCeiling),
  region: BillingRegion = "VN",
): number {
  if (typeof tierOrCeiling === "string" && tierOrCeiling in TIER_LIMITS) {
    return region === "ROW"
      ? TIER_LIMITS[tierOrCeiling as TierKey].cogsCeilingUsd.ROW
      : TIER_LIMITS[tierOrCeiling as TierKey].cogsCeilingUsd.VN;
  }
  return resolveRegionalCeiling(
    tierOrCeiling as number | RegionalCogsCeiling | (number & RegionalCogsCeiling),
    region,
  );
}

export const TIER_LIMITS: Record<TierKey, TierLimits & { cogsCeilingUsd: number & RegionalCogsCeiling }> = {
  contender: {
    tier: "contender",
    maxUploadsPerWeek: 2,
    maxFilesPerUpload: 1,
    maxQuestionsPerRun: 10,
    canUseConceptRemix: false,
    canDebriefWithCoach: true,
    maxCoachDebriefRepliesPerRun: 2,
    canExportCheatSheet: false,
    canHostArenaRemix: false,
    maxArenaPlayers: 8,
    hasCohortAnalytics: false,
    canUseClutchNotes: true,
    maxNotesPerDay: 1,
    canCustomWatermarkPdf: false,
    newDeckCredits: 2,
    sonnetProDeckCredits: 0,
    haikuOverflowDeckCredits: 0,
    dailyDeckBurstLimit: 2,
    freeRegenerationsPerDeck: 1,
    cogsCeilingUsd: createRegionalCeiling(0.08, 0.08),
    verifiedPoolSize: 15,
    servedSubsetSize: 15,
  },
  cram_pass: {
    tier: "cram_pass",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 5,
    maxQuestionsPerRun: 30,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 15,
    hasCohortAnalytics: false,
    canUseClutchNotes: true,
    maxNotesPerDay: 5,
    canCustomWatermarkPdf: false,
    newDeckCredits: 5,
    sonnetProDeckCredits: 5,
    haikuOverflowDeckCredits: 10,
    dailyDeckBurstLimit: 4,
    freeRegenerationsPerDeck: 3,
    cogsCeilingUsd: createRegionalCeiling(0.85, 1.50),
    verifiedPoolSize: 35,
    servedSubsetSize: 30,
  },
  pro_monthly: {
    tier: "pro_monthly",
    maxUploadsPerWeek: Infinity,
    maxFilesPerUpload: 10,
    maxQuestionsPerRun: 30,
    canUseConceptRemix: true,
    canDebriefWithCoach: true,
    canExportCheatSheet: true,
    canHostArenaRemix: true,
    maxArenaPlayers: 15,
    hasCohortAnalytics: false,
    canUseClutchNotes: true,
    maxNotesPerDay: 8,
    canCustomWatermarkPdf: false,
    newDeckCredits: 12,
    sonnetProDeckCredits: 12,
    haikuOverflowDeckCredits: 20,
    dailyDeckBurstLimit: 8,
    freeRegenerationsPerDeck: 5,
    cogsCeilingUsd: createRegionalCeiling(1.50, 3.20),
    verifiedPoolSize: 35,
    servedSubsetSize: 30,
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
    maxArenaPlayers: 15,
    hasCohortAnalytics: false,
    canUseClutchNotes: true,
    maxNotesPerDay: 10,
    canCustomWatermarkPdf: false,
    newDeckCredits: 30,
    sonnetProDeckCredits: 30,
    haikuOverflowDeckCredits: 60,
    dailyDeckBurstLimit: 10,
    freeRegenerationsPerDeck: 5,
    cogsCeilingUsd: createRegionalCeiling(3.80, 8.50),
    verifiedPoolSize: 35,
    servedSubsetSize: 30,
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
    maxArenaPlayers: 50,
    hasCohortAnalytics: true,
    canUseClutchNotes: true,
    maxNotesPerDay: 25,
    canCustomWatermarkPdf: true,
    newDeckCredits: 45,
    sonnetProDeckCredits: 45,
    haikuOverflowDeckCredits: 105,
    dailyDeckBurstLimit: 25,
    freeRegenerationsPerDeck: 5,
    cogsCeilingUsd: createRegionalCeiling(6.50, 10.50),
    verifiedPoolSize: 35,
    servedSubsetSize: 30,
  },
};

export function getMaxArenaPlayersForTier(tier: UserTier | TierKey): number {
  return TIER_LIMITS[tier]?.maxArenaPlayers ?? 8;
}

export function canUseCustomWatermarkPdf(tier: UserTier | TierKey): boolean {
  return tier === "tutor";
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
  ceilingUsd: number | { VN: number; ROW: number },
  estimatedCallCostUsd = 0,
  reservedUsd = 0,
  billingRegion: BillingRegion = "VN",
): CogsBudgetStatus {
  const effectiveCeiling = resolveRegionalCeiling(ceilingUsd, billingRegion);
  const res = reservedUsd ?? 0;
  const est = estimatedCallCostUsd ?? 0;
  const projectedUsd = Number((spentUsd + res + est).toFixed(6));
  const utilizationRatio =
    effectiveCeiling > 0
      ? Number((projectedUsd / effectiveCeiling).toFixed(4))
      : projectedUsd > 0
        ? 1.01
        : 0;

  if (utilizationRatio > 1.0) {
    return {
      mode: "halted",
      spentUsd,
      reservedUsd: res,
      projectedUsd,
      ceilingUsd: effectiveCeiling,
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
      ceilingUsd: effectiveCeiling,
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
      ceilingUsd: effectiveCeiling,
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
    ceilingUsd: effectiveCeiling,
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
  id: PlanId;
  cycle: BillingCycle;
  nameEn: string;
  nameVi: string;
  taglineEn: string;
  taglineVi: string;
  badgeEn?: string;
  badgeVi?: string;
  pricing: Record<BillingRegion, RegionalPrice>;
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
    pricing: {
      VN: { amount: 0, currency: "VND", formatted: "0đ" },
      ROW: { amount: 0, currency: "USD", formatted: "$0" },
    },
    priceVnd: 0,
    priceVndFormatted: "0đ",
    priceUsd: 0,
    priceUsdFormatted: "$0",
    featuresEn: [
      "2 document deck credits / month (10 questions per pack)",
      "1 free regeneration per deck",
      "1 short summary note preview / month",
      "2 free AI Coach debrief replies per completed run",
      "Cross-family blind AI verification ON",
      "Unlimited joining of friend /arena rooms (100% free)",
      "Basic document grounding & citations (no distractor rationale)",
    ],
    featuresVi: [
      "2 lượt tạo bộ đề tài liệu / tháng (10 câu hỏi / bộ)",
      "1 lần tạo lại miễn phí cho mỗi bộ đề",
      "1 bản tóm tắt ngắn xem trước / tháng",
      "2 tin nhắn gia sư AI phản hồi miễn phí sau mỗi lượt chơi",
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
    badgeEn: "48h Exam Sprint",
    badgeVi: "Nước rút 48h",
    recommended: false,
    pricing: {
      VN: { amount: 69_000, currency: "VND", formatted: "69.000đ" },
      ROW: { amount: 4.99, currency: "USD", formatted: "$4.99" },
    },
    priceVnd: 69_000,
    priceVndFormatted: "69.000đ",
    priceUsd: 4.99,
    priceUsdFormatted: "$4.99",
    featuresEn: [
      "7 days full Pro access (one-time purchase)",
      "5 Sonnet Pro deck credits + 10 Fast-Track Haiku overflow decks (up to 30 questions/pack + unlimited $0 shared syllabus cache plays)",
      "Full distractor rationale ('why the others are wrong')",
      "Full Clutch Notes revision notes generator (up to 5 full notesheets)",
      "3 free regenerations per deck",
      "Cross-family blind AI verification ON",
      "Multi-document synthesis up to 5 files (15MB)",
      "Unlimited AI Coach deep debriefs",
    ],
    featuresVi: [
      "7 ngày toàn quyền Pro (mua 1 lần, không trừ tiền tự động)",
      "5 lượt bộ đề Sonnet Pro + 10 bộ đề Haiku tăng tốc (tối đa 30 câu/bộ + chơi bộ đề kho chung $0 không giới hạn)",
      "Giải thích bẫy đáp án nhiễu ('vì sao các đáp án khác sai')",
      "Tạo tài liệu Clutch Notes đầy đủ, phân mục chi tiết (tối đa 5 bộ)",
      "3 lần tạo lại miễn phí cho mỗi bộ đề",
      "Hệ thống kiểm định chéo AI độc lập bật 100%",
      "Tổng hợp đa tài liệu cùng lúc (tối đa 5 tệp / 15MB)",
      "Gia sư AI phản hồi và hướng dẫn chi tiết không giới hạn",
    ],
  },
  {
    id: "pro_monthly",
    cycle: "monthly",
    nameEn: "Clutch Pro (Monthly)",
    nameVi: "Đấu Sĩ Pro (Hàng Tháng)",
    taglineEn: "Flexible month-to-month access for active terms",
    taglineVi: "Đăng ký theo tháng linh hoạt cho kỳ học",
    pricing: {
      VN: { amount: 109_000, currency: "VND", formatted: "109.000đ/tháng" },
      ROW: { amount: 9.99, currency: "USD", formatted: "$9.99/mo" },
    },
    priceVnd: 109_000,
    priceVndFormatted: "109.000đ",
    priceUsd: 9.99,
    priceUsdFormatted: "$9.99",
    featuresEn: [
      "Full access for 1 month (auto-renews or cancel anytime)",
      "12 Sonnet Pro deck credits + 20 Fast-Track Haiku overflow decks (up to 30 questions/pack + unlimited $0 shared syllabus cache plays)",
      "Full distractor rationale ('why the others are wrong')",
      "Full Clutch Notes revision notes generator (max 8/day)",
      "5 free regenerations per deck",
      "Cross-family blind AI verification ON",
      "Host Privileges: host 30Q remix rooms (friends play free!)",
      "Multi-document synthesis up to 10 files (25MB)",
      "1-Click PDF Cheat Sheet with verbatim citations",
    ],
    featuresVi: [
      "Toàn quyền truy cập trong 1 tháng",
      "12 lượt bộ đề Sonnet Pro + 20 bộ đề Haiku tăng tốc (tối đa 30 câu/bộ + chơi bộ đề kho chung $0 không giới hạn)",
      "Giải thích bẫy đáp án nhiễu ('vì sao các đáp án khác sai')",
      "Tạo tài liệu Clutch Notes đầy đủ (tối đa 8 bộ/ngày)",
      "5 lần tạo lại miễn phí cho mỗi bộ đề",
      "Hệ thống kiểm định chéo AI độc lập bật 100%",
      "Đặc quyền Chủ phòng: mở phòng 30 câu Remix cho bạn bè chơi miễn phí",
      "Tổng hợp đa tài liệu cùng lúc lên đến 10 tệp (25MB)",
      "Xuất cẩm nang Cheat Sheet PDF kèm trích dẫn gốc",
    ],
  },
  {
    id: "pro",
    cycle: "semester",
    nameEn: "Clutch Pro (Semester)",
    nameVi: "Đấu Sĩ Pro (Học Kỳ)",
    taglineEn: "Continuous mastery with host privileges all semester",
    taglineVi: "Đặc quyền Chủ phòng & làm chủ toàn bộ học kỳ không gián đoạn",
    recommended: true,
    badgeEn: "Best Value (Save 27–31%)",
    badgeVi: "Tiết kiệm nhất (Giảm 27–31%)",
    pricing: {
      VN: { amount: 299_000, currency: "VND", formatted: "299.000đ/kỳ" },
      ROW: { amount: 29.0, currency: "USD", formatted: "$29.00/sem" },
    },
    priceVnd: 299_000,
    priceVndFormatted: "299.000đ",
    priceUsd: 29.0,
    priceUsdFormatted: "$29",
    featuresEn: [
      "Full access for entire 4-month semester",
      "30 Sonnet Pro deck credits + 60 Fast-Track Haiku overflow decks (up to 30 questions/pack + unlimited $0 shared syllabus cache plays)",
      "Full distractor rationale ('why the others are wrong')",
      "Full, sectioned Clutch Notes revision notes generator (max 10/day)",
      "5 free regenerations per deck",
      "Cross-family blind AI verification ON",
      "Host Privileges: host 30Q remix rooms (friends play free!)",
      "Multi-document synthesis up to 10 files (25MB)",
      "1-Click PDF Cheat Sheet with verbatim citations",
    ],
    featuresVi: [
      "Toàn quyền suốt 4 tháng học kỳ (tương đương 74.750đ/tháng)",
      "30 lượt bộ đề Sonnet Pro + 60 bộ đề Haiku tăng tốc (tối đa 30 câu/bộ + chơi bộ đề kho chung $0 không giới hạn)",
      "Giải thích bẫy đáp án nhiễu ('vì sao các đáp án khác sai')",
      "Tạo tài liệu Clutch Notes đầy đủ, phân mục chi tiết (tối đa 10 bộ/ngày)",
      "5 lần tạo lại miễn phí cho mỗi bộ đề",
      "Hệ thống kiểm định chéo AI độc lập bật 100%",
      "Đặc quyền Chủ phòng: mở phòng 30 câu Remix cho bạn bè chơi miễn phí",
      "Tổng hợp đa tài liệu cùng lúc lên đến 10 tệp (25MB)",
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
    badgeEn: "For TAs & Study Guilds",
    badgeVi: "Dành cho Trợ Giảng & CLB",
    comingSoon: false,
    pricing: {
      VN: { amount: 399_000, currency: "VND", formatted: "399.000đ/tháng" },
      ROW: { amount: 24.99, currency: "USD", formatted: "$24.99/mo" },
    },
    priceVnd: 399_000,
    priceVndFormatted: "399.000đ",
    priceUsd: 24.99,
    priceUsdFormatted: "$24.99",
    featuresEn: [
      "45 Sonnet Pro deck credits + 105 Fast-Track Haiku overflow decks / month (150 total fresh decks + unlimited $0 shared syllabus cache plays)",
      "Full Clutch Notes revision notes generator (max 25/day)",
      "50 player /arena lobbies for live classroom reviews",
      "Custom branded Base64 pack links (your name & logo)",
      "Cohort accuracy & missed-concept analytics",
      "Unlimited students join classroom rooms for $0",
      "Priority API queue for high-concurrency match starts",
    ],
    featuresVi: [
      "45 lượt bộ đề Sonnet Pro + 105 bộ đề Haiku tăng tốc / tháng (tổng 150 bộ đề mới + chơi kho chung $0 không giới hạn)",
      "Tạo tài liệu Clutch Notes đầy đủ, phân mục chi tiết (tối đa 25 bộ/ngày)",
      "Phòng đấu /arena lên đến 50 người cho lớp học trực tiếp",
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
 * - pro_monthly: 30 days (1 month)
 * - pro: 120 days (4-month semester)
 * - tutor: 30 days (1 month)
 * - contender: null (permanent free)
 */
export function calculateTierExpiration(tier: UserTier | PlanId | string): string | null {
  const now = Date.now();
  if (tier === "cram_pass") {
    return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (tier === "pro_monthly") {
    return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (tier === "pro" || tier === "pro_semester") {
    return new Date(now + 120 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (tier === "tutor" || tier === "tutor_guild") {
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
  if (t === "pro_monthly" || t === "pro-monthly" || t === "monthly") return "pro_monthly";
  if (t === "pro" || t === "pro_semester" || t === "pro-semester" || t === "semester") return "pro";
  if (t === "tutor" || t === "tutor_guild" || t === "tutor-guild") return "tutor";
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
 * Handles manual admin non-expiring grants (tier_expires_at === null).
 * Elapsed tier_expires_at returns null.
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
    const previousTier = localStorage.getItem(USER_TIER_STORAGE_KEY);
    const previousExpires = localStorage.getItem(USER_TIER_EXPIRES_KEY);

    // Never allow client-side code to overwrite an active unexpired paid tier with contender
    if (
      tier === "contender" &&
      previousTier &&
      normalizeTier(previousTier) !== "contender" &&
      previousExpires &&
      !isTierExpired(previousExpires)
    ) {
      return;
    }

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

    if (tier === "contender") {
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
