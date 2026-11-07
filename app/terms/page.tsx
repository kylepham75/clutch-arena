"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  Lock,
  Scale,
  FileText,
  Database,
  Cpu,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Globe,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";

export default function TermsOfServicePage() {
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
              href="/privacy"
              className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline hidden sm:inline-block"
            >
              {isVi ? "Chính sách bảo mật →" : "Privacy Policy →"}
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Title Header */}
        <div className="mb-10 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 mb-4">
            <Scale size={14} />
            <span>{isVi ? "Điều khoản pháp lý" : "Legal Terms"}</span>
            <span className="text-amber-400 dark:text-amber-600">•</span>
            <span>{isVi ? "Hiệu lực: Tháng 11/2026" : "Effective: November 2026"}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-stone-900 dark:text-stone-100">
            {isVi ? "Điều Khoản Dịch Vụ" : "Terms of Service"}
          </h1>
          <p className="mt-3 text-base text-stone-600 dark:text-stone-400 max-w-2xl">
            {isVi
              ? "Quy định sử dụng nền tảng Clutch Arena, bảo vệ quyền tác giả tài liệu bài giảng, cam kết Zero Data Retention và thanh toán minh bạch."
              : "Terms governing use of Clutch Arena, slide copyright protection, OpenRouter Zero Data Retention, and transparent payment rules."}
          </p>
        </div>

        {/* Quick Trust Highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          <div className="p-4 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs mb-1">
              <ShieldCheck size={16} />
              <span>{isVi ? "OpenRouter ZDR" : "Zero Data Retention"}</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              {isVi
                ? "Bắt buộc cờ `zdr: true`. Không lưu tài liệu bài giảng, tuyệt đối không dùng để huấn luyện mô hình AI công khai."
                : "Strict `zdr: true` enforcement. Slide text is never stored or used to train foundational AI models."}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-xs mb-1">
              <Lock size={16} />
              <span>{isVi ? "Bảo Vệ Bản Quyền" : "Copyright Safe"}</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              {isVi
                ? "`shared_deck_cache` chỉ lưu câu hỏi phái sinh và công thức ẩn danh. Không phát tán lại file PDF/slide gốc."
                : "`shared_deck_cache` only caches derived practice questions & formulas. Raw slide files are never shared."}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-xs mb-1">
              <CheckCircle2 size={16} />
              <span>{isVi ? "Thanh Toán VietQR" : "PayOS VietQR"}</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              {isVi
                ? "Tuân thủ quy định NHNN & NĐ 13/2023/NĐ-CP. Vé Ôn Cấp Tốc một lần không tự động gia hạn định kỳ."
                : "SBV & Decree 13 compliant. One-time Cram Passes never auto-renew."}
            </p>
          </div>
        </div>

        {/* Legal Clauses Container */}
        <div className="space-y-8 bg-white dark:bg-stone-900/90 rounded-2xl border border-stone-200 dark:border-stone-800 p-6 sm:p-10 shadow-xs leading-relaxed text-sm text-stone-700 dark:text-stone-300">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">1.</span>
              {isVi ? "Chấp Thuận Điều Khoản" : "Acceptance of Terms"}
            </h2>
            <p>
              {isVi
                ? "Chào mừng bạn đến với Clutch Arena. Bằng việc truy cập, tạo tài khoản, tải lên tài liệu học tập hoặc tham gia các phòng thi đấu đối kháng trực tiếp, bạn đồng ý tuân thủ toàn bộ các điều khoản trong văn bản này. Nếu bạn không đồng ý với bất kỳ điều khoản nào, vui lòng ngừng sử dụng dịch vụ ngay lập tức."
                : "Welcome to Clutch Arena. By accessing our platform, creating an account, uploading study documents, or joining real-time multiplayer arena matches, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, please discontinue using the platform."}
            </p>
            <p>
              {isVi
                ? "Dịch vụ được thiết kế cho mục đích hỗ trợ sinh viên và người học ôn thi chủ động (Active Recall), trích xuất công thức và biến thể bài tập (Concept Twins). Người dùng có trách nhiệm tuân thủ nội quy khảo thí tại trường đại học hoặc cơ sở đào tạo của mình."
                : "The platform is designed as an active recall study tool, extracting key formulas and concept twins for exam preparation. Users remain responsible for adhering to their academic institution's examination and integrity policies."}
            </p>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">2.</span>
              {isVi
                ? "Tài Liệu Bài Giảng & Cam Kết OpenRouter Zero Data Retention (ZDR)"
                : "Lecture Slides & OpenRouter Zero Data Retention (ZDR)"}
            </h2>
            <p>
              {isVi
                ? "Khi bạn tải lên bài giảng, slide PowerPoint hoặc file PDF ghi chú môn học:"
                : "When you upload lecture slides, presentation notes, or PDF study materials:"}
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Kích hoạt cờ Zero Data Retention (`zdr: true`): " : "Zero Data Retention (`zdr: true`): "}
                </strong>
                {isVi
                  ? "Mọi yêu cầu suy luận AI gửi đến nhà cung cấp OpenRouter đều bắt buộc kèm tiêu đề cấu hình `zdr: true`. Điều này đảm bảo toàn bộ dữ liệu nội dung bài giảng của bạn được xóa hoàn toàn khỏi bộ nhớ tạm của nhà cung cấp AI ngay sau khi phản hồi được hoàn tất."
                  : "Every AI inference request sent via OpenRouter enforces the `zdr: true` flag. This legally and technically guarantees your uploaded slide text is completely purged from provider ephemeral memory upon completion of the inference call."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Tuyệt đối không dùng để huấn luyện mô hình AI: " : "Zero Model Training Guarantee: "}
                </strong>
                {isVi
                  ? "Dữ liệu bài giảng và ghi chú của bạn không bao giờ được dùng để huấn luyện, tinh chỉnh (fine-tune) hoặc cải tiến bất kỳ mô hình ngôn ngữ lớn (LLM) công khai hay thương mại nào."
                  : "Your course notes and slides are never used to train, fine-tune, evaluate, or improve any public or commercial foundation models."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Xử lý trong bộ nhớ tạm thời: " : "Ephemeral In-Memory Parsing: "}
                </strong>
                {isVi
                  ? "Nội dung slide chỉ được phân tích cú pháp trong bộ nhớ phiên làm việc nhằm trích xuất định dạng câu hỏi trắc nghiệm, công thức KaTeX và đối chiếu số trang phục vụ trích dẫn nguyên văn."
                  : "Slide text is parsed ephemerally in-memory solely to generate active recall practice questions, KaTeX formulas, and exact slide page citations."}
              </li>
            </ul>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">3.</span>
              {isVi
                ? "Bản Quyền Tác Giả & Cơ Chế Bộ Đệm Phái Sinh (`shared_deck_cache`)"
                : "Copyright Protection & Derived Content (`shared_deck_cache`)"}
            </h2>
            <p>
              {isVi
                ? "Clutch Arena tôn trọng nghiêm ngặt quyền sở hữu trí tuệ của giảng viên, trường đại học và nhà xuất bản giáo trình:"
                : "Clutch Arena rigorously respects the intellectual property rights of educators, academic institutions, and publishers:"}
            </p>
            <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-stone-800 dark:text-stone-200 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-300">
                <AlertCircle size={16} />
                <span>{isVi ? "Nguyên Tắc Lưu Trữ Phái Sinh" : "Derived Practice Caching Standard"}</span>
              </div>
              <p className="text-xs sm:text-sm">
                {isVi
                  ? "Hệ thống `shared_deck_cache` CHỈ lưu trữ các câu hỏi trắc nghiệm đã được biến đổi phái sinh, công thức toán học và thẻ ghi nhớ ôn tập được tổng hợp ẩn danh. Hệ thống TUYỆT ĐỐI KHÔNG lưu trữ, tái phân phối hoặc chia sẻ nguyên văn tệp tin PDF/slide gốc có bản quyền của giảng viên cho bất kỳ bên thứ ba nào."
                  : "The `shared_deck_cache` stores ONLY de-identified, derived practice questions, KaTeX formulas, and study flashcards. The platform STRICTLY NEVER stores, redistributes, or serves raw copyrighted lecture PDFs or slide files to other users or third parties."}
              </p>
            </div>
            <p>
              {isVi
                ? "Sinh viên giữ toàn quyền sở hữu đối với các ghi chú học tập cá nhân do chính mình tạo ra. Nội dung câu hỏi ôn tập do AI tổng hợp được coi là tài liệu học tập phái sinh phục vụ mục đích tự học phi thương mại."
                : "Students retain full ownership over their original notes. Synthesized question sets are deemed transformative derived study aids intended for individual, non-commercial educational review."}
            </p>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">4.</span>
              {isVi ? "Quy Tắc Đấu Trường Trực Tiếp (Multiplayer Arena)" : "Multiplayer Arena & Code of Conduct"}
            </h2>
            <p>
              {isVi
                ? "Tính năng Đấu Trường Trực Tiếp (/arena) cho phép người học kết nối qua WebSocket để thi đấu bấm chuông tốc độ. Người dùng cam kết:"
                : "The live Multiplayer Arena (/arena) enables real-time buzzer quiz matches over WebSockets. Users agree to:"}
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>{isVi ? "Không đặt tên phòng hoặc biệt danh có tính xúc phạm, quấy rối hoặc vi phạm thuần phong mỹ tục." : "Not use abusive, offensive, defamatory, or infringing room codes or contender nicknames."}</li>
              <li>{isVi ? "Không sử dụng phần mềm gian lận, can thiệp script tự động bấm chuông hoặc phá hoại đường truyền của người chơi khác." : "Refrain from deploying automated buzzer bots, unauthorized scripts, or attempting denial-of-service attacks on room lobbies."}</li>
              <li>{isVi ? "Chấp nhận bot thích ứng (Adaptive Bots) do hệ thống cung cấp khi luyện tập một mình hoặc phòng thiếu người." : "Accept built-in Adaptive Bots provided by the platform for solo late-night practice and room slot balancing."}</li>
            </ul>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">5.</span>
              {isVi ? "Điều Khoản Thanh Toán & Cổng PayOS VietQR" : "Payment Terms & PayOS VietQR Checkout"}
            </h2>
            <p>
              {isVi
                ? "Các giao dịch thanh toán trên Clutch Arena được thực hiện minh bạch theo các nguyên tắc sau:"
                : "Payments on Clutch Arena are conducted transparently under the following rules:"}
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Cổng thanh toán VietQR PayOS: " : "PayOS VietQR Gateway: "}
                </strong>
                {isVi
                  ? "Thanh toán bằng Việt Nam Đồng (VND) được xử lý an toàn qua cổng PayOS và mạng lưới Napas 24/7, tuân thủ Thông tư của Ngân hàng Nhà nước Việt Nam và Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân."
                  : "VND payments are processed securely via PayOS over the Napas 24/7 VietQR banking network, in strict adherence to State Bank of Vietnam regulations and Vietnam Decree 13/2023/ND-CP."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Không tự động gia hạn đối với Vé Ôn Thi Cấp Tốc (Cram Pass): " : "No Auto-Renewal on Cram Passes: "}
                </strong>
                {isVi
                  ? "Các gói Vé Ôn Thi Cấp Tốc (24 Giờ hoặc 7 Ngày) là khoản thanh toán một lần, TUYỆT ĐỐI KHÔNG tự động trừ tiền trong tài khoản ngân hàng của bạn ở kỳ tiếp theo."
                  : "One-time Cram Passes (24-Hour & 7-Day passes) do NOT auto-renew. You will never encounter surprise recurring charges on single passes."}
              </li>
              <li>
                <strong className="text-stone-900 dark:text-stone-100">
                  {isVi ? "Chính sách hoàn tiền (Cam kết trích dẫn 100%): " : "100% Citation Refund Guarantee: "}
                </strong>
                {isVi
                  ? "Chúng tôi cam kết mọi câu hỏi và công thức đều có trích dẫn nguồn số trang cụ thể từ slide của bạn. Nếu hệ thống tự ý bịa đặt kiến thức ngoài tài liệu bài giảng đã tải lên, bạn có quyền yêu cầu hoàn tiền 100% trong vòng 48 giờ."
                  : "We guarantee 100% verbatim citations for all extracted questions and formulas. If our AI hallucinates facts outside your provided lecture slides, you are eligible for a 100% refund within 48 hours."}
              </li>
            </ul>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 6 */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">6.</span>
              {isVi ? "Danh Sách Đơn Vị Xử Lý Dữ Liệu Phụ (Sub-processors)" : "Sub-processors Disclosure"}
            </h2>
            <p>
              {isVi
                ? "Nhằm cung cấp dịch vụ ổn định, Clutch Arena sử dụng các đối tác hạ tầng công nghệ tin cậy sau:"
                : "To deliver reliable and secure operations, Clutch Arena relies on the following verified sub-processors:"}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border border-stone-200 dark:border-stone-800 rounded-lg">
                <thead className="bg-stone-100 dark:bg-stone-800/60 text-stone-900 dark:text-stone-100 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="px-3 py-2.5">{isVi ? "Đơn vị" : "Sub-processor"}</th>
                    <th className="px-3 py-2.5">{isVi ? "Mục đích" : "Purpose"}</th>
                    <th className="px-3 py-2.5">{isVi ? "Biện pháp an toàn dữ liệu" : "Data Safeguard"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">OpenRouter</td>
                    <td className="px-3 py-2.5">{isVi ? "Cổng suy luận AI (LLM inference)" : "AI inference gateway"}</td>
                    <td className="px-3 py-2.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      Zero Data Retention (`zdr: true`)
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">Supabase Inc.</td>
                    <td className="px-3 py-2.5">{isVi ? "Xác thực người dùng & Cơ sở dữ liệu đám mây" : "Auth & PostgreSQL database"}</td>
                    <td className="px-3 py-2.5">{isVi ? "Mã hóa AES-256, TLS 1.3, Row-Level Security" : "AES-256 encryption at rest, TLS 1.3, RLS"}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">PayOS (Napas VietQR)</td>
                    <td className="px-3 py-2.5">{isVi ? "Xử lý thanh toán VietQR chuyển khoản" : "VietQR payment & checkout gateway"}</td>
                    <td className="px-3 py-2.5">{isVi ? "Tuân thủ chuẩn bảo mật NHNN & NĐ 13/2023/NĐ-CP" : "Licensed SBV intermediary, Decree 13 compliant"}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-stone-900 dark:text-stone-100">Upstash Inc.</td>
                    <td className="px-3 py-2.5">{isVi ? "Giới hạn tần suất & Trạng thái phòng đấu ngắn hạn" : "Rate limiting & ephemeral room state"}</td>
                    <td className="px-3 py-2.5">{isVi ? "Dữ liệu tự hủy (TTL) trong bộ nhớ tạm" : "In-memory store with auto-expiring TTL"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">7.</span>
              {isVi ? "Miễn Trừ Trách Nhiệm & Giới Hạn Pháp Lý" : "Disclaimers & Limitation of Liability"}
            </h2>
            <p>
              {isVi
                ? "Dịch vụ được cung cấp trên nguyên tắc 'nguyên trạng' (as-is). Clutch Arena không đảm bảo việc sử dụng nền tảng sẽ giúp người học đạt được một điểm số cụ thể trong các kỳ thi chính thức. Người học chịu trách nhiệm kiểm tra lại kiến thức với giáo trình chính thống của cơ sở đào tạo."
                : "The service is provided on an 'as-is' basis. While Clutch Arena employs strict active recall methodologies and verbatim citation extraction, we do not guarantee specific academic exam scores. Students are expected to cross-verify all study points against their syllabus."}
            </p>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">8.</span>
              {isVi ? "Luật Điều Chỉnh & Giải Quyết Tranh Chấp" : "Governing Law & Dispute Resolution"}
            </h2>
            <p>
              {isVi
                ? "Điều khoản này được điều chỉnh và giải thích theo pháp luật nước Cộng hòa Xã hội Chủ nghĩa Việt Nam. Mọi tranh chấp phát sinh sẽ được ưu tiên giải quyết thông qua thương lượng hòa giải trước khi đưa ra cơ quan tài phán có thẩm quyền tại Việt Nam."
                : "These Terms are governed by and construed in accordance with the laws of the Socialist Republic of Vietnam. Any dispute arising hereunder shall first be submitted to good-faith mutual negotiation prior to adjudication in competent courts of Vietnam."}
            </p>
          </section>

          <hr className="border-stone-100 dark:border-stone-800" />

          {/* Section 9 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">9.</span>
              {isVi ? "Liên Hệ Pháp Lý" : "Legal Contact"}
            </h2>
            <p>
              {isVi
                ? "Nếu bạn có bất kỳ câu hỏi nào về Điều khoản Dịch vụ, vui lòng liên hệ bộ phận pháp lý của chúng tôi tại:"
                : "If you have questions or inquiries regarding these Terms of Service, please contact our legal counsel at:"}
            </p>
            <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-800/50 text-xs sm:text-sm font-mono space-y-1">
              <div>Email: <a href="mailto:legal@clutcharena.com" className="text-amber-600 dark:text-amber-400 hover:underline">legal@clutcharena.com</a></div>
              <div>Support: <a href="mailto:support@clutcharena.com" className="text-amber-600 dark:text-amber-400 hover:underline">support@clutcharena.com</a></div>
              <div>Platform: Clutch Arena · Active Recall & Multiplayer Study Engine</div>
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
            <Link href="/privacy" className="hover:text-stone-900 dark:hover:text-stone-200 transition-colors font-medium text-amber-600 dark:text-amber-400">
              {isVi ? "Chính sách bảo mật" : "Privacy Policy"}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
