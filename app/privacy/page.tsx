"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  Lock,
  Eye,
  Trash2,
  FileText,
  Database,
  Cpu,
  Mail,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Globe,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";

export default function PrivacyPolicyPage() {
  const { language, setLanguage } = useLanguage();
  const isVi = language === "vi";

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 transition-colors">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 dark:border-stone-800/80 bg-white/85 dark:bg-stone-950/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span>{isVi ? "Quay lại Clutch Arena" : "Back to Clutch Arena"}</span>
          </Link>

          <div className="flex items-center gap-3">
            {/* Language Switcher */}
            <div className="flex items-center bg-stone-100 dark:bg-stone-800/70 p-1 rounded-lg border border-stone-200 dark:border-stone-700">
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  !isVi
                    ? "bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs"
                    : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                }`}
                aria-label="Switch to English"
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage("vi")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  isVi
                    ? "bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs"
                    : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                }`}
                aria-label="Chuyển sang Tiếng Việt"
              >
                VI
              </button>
            </div>

            <Link
              href="/terms"
              className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline hidden sm:inline-block"
            >
              {isVi ? "Điều khoản dịch vụ →" : "Terms of Service →"}
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Title Header */}
        <div className="mb-10 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 mb-4">
            <ShieldCheck size={14} />
            <span>{isVi ? "Bảo Vệ Dữ Liệu Cá Nhân" : "Data Protection"}</span>
            <span className="text-emerald-400 dark:text-emerald-600">•</span>
            <span>{isVi ? "Tuân thủ NĐ 13/2023/NĐ-CP & GDPR" : "Decree 13/2023/ND-CP & GDPR Compliant"}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-stone-900 dark:text-stone-100">
            {isVi ? "Chính Sách Bảo Mật" : "Privacy Policy"}
          </h1>
          <p className="mt-3 text-base text-stone-600 dark:text-stone-400 max-w-2xl">
            {isVi
              ? "Cam kết bảo vệ dữ liệu cá nhân của người học, quy trình xử lý tài liệu tải lên không lưu vết (Zero Data Retention) và quyền xóa dữ liệu vĩnh viễn."
              : "Our commitment to protecting your personal data, zero data retention slide parsing, and complete data deletion rights under Decree 13/2023/ND-CP and GDPR."}
          </p>
        </div>

        {/* Quick Privacy Highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          <div className="p-4 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs mb-1">
              <ShieldCheck size={16} />
              <span>{isVi ? "Nghị Định 13/2023/NĐ-CP" : "Decree 13/2023/ND-CP"}</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              {isVi
                ? "Bảo vệ thông tin người dùng Việt Nam theo quy chuẩn quốc gia, phân định rõ vai trò Bên Kiểm Soát Dữ Liệu."
                : "Full compliance with Vietnam's Personal Data Protection decree and international privacy principles."}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-xs mb-1">
              <Lock size={16} />
              <span>{isVi ? "OpenRouter `zdr: true`" : "Zero AI Retention"}</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              {isVi
                ? "Nội dung slide bài giảng được xóa ngay sau suy luận. Không lưu, không huấn luyện mô hình LLM."
                : "Slide content processed ephemerally with `zdr: true`. Never retained or used for LLM model training."}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-xs mb-1">
              <Trash2 size={16} />
              <span>{isVi ? "Quyền Xóa Vĩnh Viễn" : "Right to be Forgotten"}</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              {isVi
                ? "Toàn quyền yêu cầu xóa cascade tài khoản, lịch sử làm bài và mọi dữ liệu liên quan khỏi hệ thống."
                : "Permanent cascade deletion of account records, run history, and study data upon request."}
            </p>
          </div>
        </div>

        {/* Privacy Policy Clauses */}
        <div className="space-y-8 bg-white dark:bg-stone-900/90 rounded-2xl border border-stone-200 dark:border-stone-800 p-6 sm:p-10 shadow-xs leading-relaxed text-sm text-stone-700 dark:text-stone-300">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">1.</span>
              {isVi ? "Cơ Sở Pháp Lý & Phạm Vi Áp Dụng" : "Legal Framework & Scope"}
            </h2>
            <p>
              {isVi
                ? "Chính sách bảo mật này mô tả cách Clutch Arena ('chúng tôi', 'nền tảng') thu thập, xử lý, bảo vệ và xóa dữ liệu cá nhân của người dùng. Chúng tôi cam kết tuân thủ nghiêm ngặt:"
                : "This Privacy Policy describes how Clutch Arena ('we', 'our platform') collects, processes, secures, and deletes user personal data. We operate in full accordance with:"}
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Nghị định số 13/2023/NĐ-CP " : "Vietnam Government Decree No. 13/2023/ND-CP "}
                </strong>
                {isVi ? "của Chính phủ nước Cộng hòa Xã hội Chủ nghĩa Việt Nam về Bảo vệ dữ liệu cá nhân." : "on Personal Data Protection."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Tiêu chuẩn GDPR " : "EU General Data Protection Regulation (GDPR) "}
                </strong>
                {isVi ? "đối với người dùng quốc tế về quyền kiểm soát thông tin cá nhân." : "benchmarks regarding user transparency and data subject rights."}
              </li>
            </ul>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">2.</span>
              {isVi ? "Dữ Liệu Chúng Tôi Thu Thập" : "Information We Collect"}
            </h2>
            <p>
              {isVi
                ? "Chúng tôi chỉ thu thập dữ liệu tối thiểu cần thiết để phục vụ trải nghiệm học tập:"
                : "We collect only the minimum data required to facilitate active learning sessions:"}
            </p>
            <div className="space-y-3">
              <div className="p-3.5 rounded-lg bg-stone-50 dark:bg-stone-800/40 border border-stone-200/60 dark:border-stone-700/60">
                <strong className="text-stone-900 dark:text-stone-100 block text-xs uppercase tracking-wider mb-1">
                  {isVi ? "A. Thông Tin Tài Khoản (Account Data)" : "A. Account Data"}
                </strong>
                <p className="text-xs">
                  {isVi
                    ? "Địa chỉ email và mã định danh người dùng (User ID) do Supabase Auth quản lý khi bạn đăng nhập qua Email, Google hoặc GitHub. Chúng tôi không bao giờ lưu trữ mật khẩu thuần."
                    : "Email address and unique User ID managed via Supabase Auth when signing in via Email, Google, or GitHub. Plaintext passwords are never stored."}
                </p>
              </div>

              <div className="p-3.5 rounded-lg bg-stone-50 dark:bg-stone-800/40 border border-stone-200/60 dark:border-stone-700/60">
                <strong className="text-stone-900 dark:text-stone-100 block text-xs uppercase tracking-wider mb-1">
                  {isVi ? "B. Tiến Độ Học Tập & Nhật Ký Thi Đấu (Study Progress & Telemetry)" : "B. Study Progress & Telemetry"}
                </strong>
                <p className="text-xs">
                  {isVi
                    ? "Điểm số làm bài, chuỗi câu trả lời đúng (streak), thẻ độ nhuần nhuyễn khái niệm (Concept Mastery), tổng điểm kinh nghiệm (XP) và lịch sử thi đấu phòng multiplayer."
                    : "Practice run scores, streak counters, concept mastery flags (Mastered, Learning, Needs Review), XP points, and multiplayer match results."}
                </p>
              </div>

              <div className="p-3.5 rounded-lg bg-stone-50 dark:bg-stone-800/40 border border-stone-200/60 dark:border-stone-700/60">
                <strong className="text-stone-900 dark:text-stone-100 block text-xs uppercase tracking-wider mb-1">
                  {isVi ? "C. Dữ Liệu Giao Dịch Thanh Toán (Payment Records)" : "C. Payment & Transaction Records"}
                </strong>
                <p className="text-xs">
                  {isVi
                    ? "Mã đơn hàng PayOS, số tiền thanh toán, trạng thái kích hoạt gói dịch vụ. Chúng tôi TUYỆT ĐỐI KHÔNG lưu trữ số tài khoản ngân hàng, mã PIN hoặc mật khẩu Internet Banking của bạn."
                    : "PayOS order code, amount, and tier activation status. We NEVER store bank passwords, OTPs, or debit/credit card numbers."}
                </p>
              </div>
            </div>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">3.</span>
              {isVi
                ? "Quy Trình Xử Lý Slide & Cam Kết Zero Data Retention (`zdr: true`)"
                : "Slide Processing & Zero Data Retention Guarantee (`zdr: true`)"}
            </h2>
            <p>
              {isVi
                ? "Tài liệu học tập là tài sản trí tuệ quan trọng của người học và giảng viên. Cơ chế bảo vệ kỹ thuật của chúng tôi bao gồm:"
                : "Course materials represent critical academic assets. Our technical architecture guarantees:"}
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Xử lý trong bộ nhớ tạm (In-Memory Processing): " : "Ephemeral In-Memory Processing: "}
                </strong>
                {isVi
                  ? "Tệp tin PDF/slide khi tải lên được trích xuất văn bản trực tiếp trong bộ nhớ tạm thời của máy chủ. Tệp slide gốc không bao giờ được lưu trữ công khai hoặc chia sẻ."
                  : "Uploaded PDFs and slides are parsed in server memory to extract text and formulas. Raw files are not permanently stored in public buckets."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Cờ bảo mật OpenRouter `zdr: true`: " : "OpenRouter `zdr: true` Header: "}
                </strong>
                {isVi
                  ? "Khi trích xuất câu hỏi trắc nghiệm hoặc tóm tắt công thức qua cổng AI OpenRouter, hệ thống bắt buộc gửi cờ `zdr: true` (Zero Data Retention). Các nhà cung cấp mô hình AI không được phép ghi lại hay lưu giữ nội dung slide của bạn vào bất kỳ nhật ký nào."
                  : "Every AI inference request via OpenRouter enforces the `zdr: true` parameter, legally and contractually forbidding model providers from logging or storing your slide text."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Tuyệt đối không dùng để huấn luyện mô hình: " : "No Foundation Model Training: "}
                </strong>
                {isVi
                  ? "Nội dung bài giảng của bạn không bao giờ được sử dụng để đào tạo, huấn luyện lại hoặc tinh chỉnh bất kỳ mô hình AI công khai nào."
                  : "Your notes, slides, and answers are never used to train, align, or improve any public or private LLMs."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Nguyên tắc bộ đệm `shared_deck_cache`: " : "Derived Practice Caching Standard: "}
                </strong>
                {isVi
                  ? "Bộ đệm đề thi chỉ lưu các câu hỏi trắc nghiệm, công thức và thẻ ghi nhớ đã được tổng hợp ẩn danh. Không lưu và không phân phối tệp PDF/slide gốc có bản quyền."
                  : "The cache retains only de-identified practice questions and formulas. Raw copyrighted slides are never redistributed."}
              </li>
            </ul>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 4 */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">4.</span>
              {isVi ? "Danh Sách Đơn Vị Xử Lý Dữ Liệu Phụ (Sub-processors)" : "Sub-processors & Third-Party Services"}
            </h2>
            <p>
              {isVi
                ? "Dữ liệu được xử lý thông qua các nhà cung cấp hạ tầng bảo mật đạt chuẩn quốc tế:"
                : "Personal data is processed via verified third-party infrastructure providers:"}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border border-stone-200 dark:border-stone-800 rounded-lg">
                <thead className="bg-stone-100 dark:bg-stone-800/60 text-stone-900 dark:text-stone-100 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="px-3 py-2.5">{isVi ? "Đơn vị" : "Sub-processor"}</th>
                    <th className="px-3 py-2.5">{isVi ? "Nhiệm vụ" : "Function"}</th>
                    <th className="px-3 py-2.5">{isVi ? "Vị trí & Biện pháp bảo vệ" : "Location & Safeguards"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">OpenRouter</td>
                    <td className="px-3 py-2.5">{isVi ? "Cổng suy luận trí tuệ nhân tạo (AI)" : "AI inference API gateway"}</td>
                    <td className="px-3 py-2.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      Zero Data Retention (`zdr: true`)
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">Supabase Inc.</td>
                    <td className="px-3 py-2.5">{isVi ? "Quản lý phiên đăng nhập & Lưu trữ tiến độ" : "User authentication & cloud database"}</td>
                    <td className="px-3 py-2.5">{isVi ? "Mã hóa TLS 1.3, AES-256, RLS" : "TLS 1.3 in transit, AES-256 at rest, Row-Level Security"}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">PayOS</td>
                    <td className="px-3 py-2.5">{isVi ? "Thanh toán Napas VietQR chuyển khoản" : "VietQR payment processing"}</td>
                    <td className="px-3 py-2.5">{isVi ? "Việt Nam · Tuân thủ quy định NHNN & NĐ 13" : "Vietnam · SBV licensed intermediary"}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">Upstash Inc.</td>
                    <td className="px-3 py-2.5">{isVi ? "Bộ đệm giới hạn tần suất & Phòng đấu WebSocket" : "Rate limiting & live room state"}</td>
                    <td className="px-3 py-2.5">{isVi ? "Lưu trữ ngắn hạn, tự hủy sau phiên đấu" : "In-memory cache with strict TTL expiration"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">5.</span>
              {isVi ? "Quyền Của Chủ Thể Dữ Liệu (User Rights)" : "Your Data Protection Rights"}
            </h2>
            <p>
              {isVi
                ? "Theo Nghị định 13/2023/NĐ-CP và GDPR, bạn có toàn quyền đối với dữ liệu của mình:"
                : "Under Decree 13/2023/ND-CP and GDPR, you possess complete control over your personal data:"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30">
                <div className="font-semibold text-xs text-stone-900 dark:text-stone-100 mb-1 flex items-center gap-1.5">
                  <Eye size={14} className="text-emerald-600" />
                  <span>{isVi ? "Quyền Được Biết & Truy Cập" : "Right of Access"}</span>
                </div>
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  {isVi
                    ? "Xem toàn bộ lịch sử luyện tập, điểm số và thẻ ghi nhớ trong bảng tiến độ học tập bất kỳ lúc nào."
                    : "Inspect all study history, runs, and concept mastery tags directly in your progress dashboard."}
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30">
                <div className="font-semibold text-xs text-stone-900 dark:text-stone-100 mb-1 flex items-center gap-1.5">
                  <RefreshCw size={14} className="text-amber-600" />
                  <span>{isVi ? "Quyền Chỉnh Sửa Dữ Liệu" : "Right to Rectification"}</span>
                </div>
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  {isVi
                    ? "Cập nhật email liên kết, chỉnh sửa thẻ ôn tập hoặc thiết lập lại tiến độ ôn thi."
                    : "Update your account details, edit flashcard notes, or reset individual topic mastery scores."}
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30">
                <div className="font-semibold text-xs text-stone-900 dark:text-stone-100 mb-1 flex items-center gap-1.5">
                  <FileText size={14} className="text-blue-600" />
                  <span>{isVi ? "Quyền Di Chuyển Dữ Liệu" : "Data Portability"}</span>
                </div>
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  {isVi
                    ? "Xuất bộ câu hỏi ra các định dạng chuẩn (Markdown, Anki .apkg, Quizlet, CSV, JSON) bất kỳ lúc nào."
                    : "Export study decks to standard formats (Markdown, Anki .apkg, Quizlet, CSV, JSON) at zero cost."}
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30">
                <div className="font-semibold text-xs text-stone-900 dark:text-stone-100 mb-1 flex items-center gap-1.5">
                  <Trash2 size={14} className="text-rose-600" />
                  <span>{isVi ? "Quyền Xóa Vĩnh Viễn (Quên Dữ Liệu)" : "Right to be Forgotten"}</span>
                </div>
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  {isVi
                    ? "Yêu cầu xóa vĩnh viễn tài khoản và toàn bộ dữ liệu lịch sử thi đấu liên quan (Cascade Deletion) khỏi cơ sở dữ liệu."
                    : "Request permanent cascade deletion of your user account, study telemetry, and associated database records."}
                </p>
              </div>
            </div>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">6.</span>
              {isVi ? "Thời Hạn Lưu Trữ & Biện Pháp An Toàn Kỹ Thuật" : "Data Retention & Security Measures"}
            </h2>
            <p>
              {isVi
                ? "Dữ liệu được lưu trữ trong suốt thời gian tài khoản hoạt động. Khi bạn yêu cầu hủy tài khoản hoặc sau 12 tháng không phát sinh hoạt động đăng nhập, dữ liệu sẽ được chuyển vào chế độ ẩn danh và xóa vĩnh viễn theo chu kỳ tự động."
                : "Data is retained during active account tenure. Inactive accounts (12+ months) are automatically queued for anonymization and purge. Ephemeral match sessions expire immediately upon match conclusion."}
            </p>
            <p>
              {isVi
                ? "Tất cả đường truyền kết nối đều bắt buộc sử dụng HTTPS / TLS 1.3 và chữ ký điện tử an toàn cho các webhook thanh toán PayOS."
                : "All client-server communications are encrypted via HTTPS / TLS 1.3, with cryptographic signature verification enforced on PayOS payment webhooks."}
            </p>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">7.</span>
              {isVi ? "Cán Bộ Bảo Vệ Dữ Liệu (DPO) & Thông Tin Liên Hệ" : "Data Protection Officer (DPO) Contact"}
            </h2>
            <p>
              {isVi
                ? "Để thực hiện quyền truy cập, chỉnh sửa, yêu cầu xóa dữ liệu cá nhân hoặc phản hồi về quyền riêng tư, vui lòng liên hệ:"
                : "To exercise your rights to access, rectify, or delete your personal data, or for privacy inquiries, contact our Data Protection Officer:"}
            </p>
            <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-800/50 text-xs sm:text-sm font-mono space-y-1">
              <div>DPO Email: <a href="mailto:dpo@clutcharena.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">dpo@clutcharena.com</a></div>
              <div>Privacy Desk: <a href="mailto:privacy@clutcharena.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">privacy@clutcharena.com</a></div>
              <div>Response Time: {isVi ? "Tối đa trong vòng 72 giờ làm việc" : "Within 72 business hours"}</div>
            </div>
          </section>
        </div>

        {/* Footer Navigation */}
        <div className="mt-10 pt-6 border-t border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-500">
          <div>
            © 2026 Clutch Arena. {isVi ? "Bảo lưu mọi quyền." : "All rights reserved."}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-stone-900 dark:hover:text-stone-200 transition-colors">
              {isVi ? "Trang chủ" : "Home"}
            </Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-stone-900 dark:hover:text-stone-200 transition-colors font-medium text-emerald-600 dark:text-emerald-400">
              {isVi ? "Điều khoản dịch vụ" : "Terms of Service"}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
