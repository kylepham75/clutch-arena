"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageSquare, Send, Sparkles, Star, AlertCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import type {
  FeedbackCategory,
  FeedbackSubmission,
  FeedbackContext,
} from "@/lib/schemas/telemetry";

export interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCategory?: FeedbackCategory;
  context?: {
    packTitle?: string;
    questionId?: string;
    citation?: string;
    tier?: string;
  };
}

const CATEGORY_OPTIONS: {
  id: FeedbackCategory;
  labelEn: string;
  labelVi: string;
}[] = [
  { id: "general", labelEn: "General", labelVi: "Góp ý chung" },
  { id: "citation_mismatch", labelEn: "Citation Mismatch", labelVi: "Lỗi trích dẫn" },
  { id: "gameplay_bug", labelEn: "Gameplay / UI Bug", labelVi: "Lỗi trận đấu / UI" },
  { id: "parser_edge_case", labelEn: "Parser Edge Case", labelVi: "Lỗi trích xuất đề" },
  { id: "smoke_test_intent", labelEn: "Feature / Pilot", labelVi: "Tính năng / Thử nghiệm" },
];

export function FeedbackDialog({
  open,
  onOpenChange,
  initialCategory,
  context,
}: FeedbackDialogProps) {
  const { language } = useLanguage();
  const { session } = useAuth();
  const isVi = language === "vi";

  const [category, setCategory] = useState<FeedbackCategory>(() => initialCategory ?? "general");
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const prevOpenRef = useRef(open);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const nextCat = initialCategory ?? "general";
      setCategory(nextCat);
      setRating(null);
      setContact("");
      setError(null);
      setSubmitted(false);

      if (nextCat === "citation_mismatch") {
        setMessage((prev) => {
          if (!prev.trim()) {
            return isVi
              ? "Trích dẫn tài liệu này có điểm chưa khớp với nội dung bài học: "
              : "This citation does not match the course material or page content: ";
          }
          return prev;
        });
      } else {
        setMessage("");
      }
    }
    prevOpenRef.current = open;
  }, [open, initialCategory, isVi]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError(
        isVi
          ? "Vui lòng nhập nội dung góp ý trước khi gửi."
          : "Please enter your message before submitting.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    const payloadContext: FeedbackContext = {};
    if (context?.packTitle) payloadContext.packTitle = context.packTitle.slice(0, 200);
    if (context?.questionId) payloadContext.questionId = context.questionId.slice(0, 100);
    if (context?.citation) payloadContext.citation = context.citation.slice(0, 300);
    if (context?.tier) payloadContext.tier = context.tier.slice(0, 40);
    if (language === "vi" || language === "en") payloadContext.language = language;
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      payloadContext.userAgent = navigator.userAgent.slice(0, 300);
    }

    const body: FeedbackSubmission = {
      kind: "feedback",
      category,
      message: trimmedMessage.slice(0, 2000),
      ...(contact.trim() ? { contact: contact.trim().slice(0, 160) } : {}),
      ...(rating ? { rating } : {}),
      ...(Object.keys(payloadContext).length > 0 ? { context: payloadContext } : {}),
    };

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const res = await fetch("/api/telemetry", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(
          errJson?.error ||
            (isVi
              ? "Không thể gửi góp ý lúc này. Vui lòng thử lại sau."
              : "Failed to send feedback. Please try again later."),
        );
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : isVi ? "Đã có lỗi xảy ra." : "An error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isVi ? "Góp ý & Báo lỗi" : "Feedback & Bug Report"}
      description={
        isVi
          ? "Phản hồi của bạn giúp Clutch Arena ngày càng hoàn thiện và chính xác hơn."
          : "Your feedback directly helps improve citation grounding and gameplay polish."
      }
      className="max-w-lg"
    >
      {submitted ? (
        <div className="py-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={28} />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100">
              {isVi ? "Cảm ơn bạn đã đóng góp!" : "Thank You for Your Feedback!"}
            </h3>
            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 max-w-sm mx-auto">
              {isVi
                ? "Chúng mình đã ghi nhận thông tin và sẽ kiểm tra, cải thiện hệ thống trong các bản cập nhật sớm nhất."
                : "We've recorded your submission and our team will review it promptly."}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-bold px-6 py-2 rounded-xl mt-2"
          >
            {isVi ? "Đóng" : "Close"}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-stone-900 dark:text-stone-100 mt-2">
          {/* Context Chip (if present) */}
          {(context?.packTitle || context?.citation) && (
            <div className="rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 p-2.5 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                <Sparkles size={13} className="text-amber-600" />
                <span>{isVi ? "Ngữ cảnh báo cáo" : "Attached Context"}</span>
              </div>
              {context.packTitle && (
                <div className="text-stone-700 dark:text-stone-300 truncate">
                  <span className="text-stone-500 font-medium">{isVi ? "Bộ đề: " : "Pack: "}</span>
                  <span className="font-semibold">{context.packTitle}</span>
                </div>
              )}
              {context.citation && (
                <div className="text-stone-700 dark:text-stone-300 line-clamp-2">
                  <span className="text-stone-500 font-medium">{isVi ? "Trích dẫn: " : "Citation: "}</span>
                  <span className="font-mono text-[11px] text-amber-700 dark:text-amber-400">
                    {context.citation}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Category Selector Pills */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
              {isVi ? "Phân loại" : "Category"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_OPTIONS.map((cat) => {
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-amber-600 border-amber-600 text-white font-bold shadow-xs"
                        : "bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                    }`}
                  >
                    {isVi ? cat.labelVi : cat.labelEn}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Star Rating (Optional) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                {isVi ? "Đánh giá trải nghiệm (Tùy chọn)" : "Experience Rating (Optional)"}
              </label>
              {rating !== null && (
                <button
                  type="button"
                  onClick={() => setRating(null)}
                  className="text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
                >
                  {isVi ? "Xóa đánh giá" : "Clear"}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((starVal) => {
                const isActive = rating !== null && starVal <= rating;
                return (
                  <button
                    key={starVal}
                    type="button"
                    onClick={() => setRating(rating === starVal ? null : starVal)}
                    className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                    aria-label={`${starVal} star${starVal > 1 ? "s" : ""}`}
                  >
                    <Star
                      size={20}
                      className={
                        isActive
                          ? "text-amber-500 fill-amber-500"
                          : "text-stone-300 dark:text-stone-600 hover:text-amber-400"
                      }
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Message Textarea (Required) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="feedback-message" className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                {isVi ? "Chi tiết góp ý / mô tả lỗi *" : "Feedback details / Bug description *"}
              </label>
              <span className="text-[10px] text-stone-400 font-mono">
                {message.length}/2000
              </span>
            </div>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                category === "citation_mismatch"
                  ? isVi
                    ? "Mô tả câu hỏi nào trích dẫn sai số trang, sai ý hoặc trích đoạn không tìm thấy..."
                    : "Describe which question cited the wrong page, wrong source, or unmatched excerpt..."
                  : isVi
                    ? "Chia sẻ trải nghiệm của bạn, tính năng bạn mong muốn hoặc lỗi gặp phải..."
                    : "Share your experience, feature ideas, or describe any issues you encountered..."
              }
              rows={4}
              maxLength={2000}
              required
              className="w-full text-xs sm:text-sm p-3 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-y"
            />
          </div>

          {/* Contact Input (Optional) */}
          <div className="space-y-1.5">
            <label htmlFor="feedback-contact" className="text-xs font-semibold text-stone-700 dark:text-stone-300">
              {isVi ? "Kênh liên hệ hỗ trợ (Tùy chọn)" : "Contact for Follow-up (Optional)"}
            </label>
            <input
              id="feedback-contact"
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={isVi ? "Zalo / Discord / Email để team liên hệ phản hồi" : "Zalo / Discord / Email for follow-up"}
              maxLength={160}
              className="w-full text-xs sm:text-sm px-3 py-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
            />
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {isVi ? "Hủy" : "Cancel"}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !message.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-sm"
            >
              {submitting ? (
                <span>{isVi ? "Đang gửi..." : "Sending..."}</span>
              ) : (
                <>
                  <Send size={14} />
                  <span>{isVi ? "Gửi góp ý" : "Send Feedback"}</span>
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
