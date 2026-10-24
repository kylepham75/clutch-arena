"use client";

import React from "react";
import {
  X,
  Sparkles,
  Zap,
  CheckCircle2,
  FileText,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  QrCode,
  Layers,
  Printer,
  ChevronRight,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";

interface BeforeAfterModalProps {
  open: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
  onLoadSampleClick?: () => void;
}

export function BeforeAfterModal({
  open,
  onClose,
  onUpgradeClick,
  onLoadSampleClick,
}: BeforeAfterModalProps) {
  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      className="before-after-dialog-content"
      title="Clutch Notes AI Pro Upgrade"
      description="Compare raw lecture slides to synthesized exam notes"
      hideHeader
      hideCloseButton
    >
      <div className="relative text-[#1f261b] w-full">
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close upgrade modal"
          className="absolute -top-3 -right-3 sm:-top-4 sm:-right-4 p-2 text-[#7f8a77] hover:text-[#1a2118] rounded-lg hover:bg-[#f3f5ee] transition-colors cursor-pointer z-10"
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div className="text-center max-w-2xl mx-auto mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-[#fff4ec] border border-[#fbd8c8] text-[#d9532f] text-xs font-bold uppercase tracking-wider">
            <Sparkles size={14} className="text-[#e96b44]" />
            <span>Unlocked on Cram Pass, Pro &amp; Tutor</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1a2118] tracking-tight mb-2">
            Transform <span className="text-[#e96b44]">27 Cluttered Slides</span> into a{" "}
            <span className="text-[#e96b44]">3-Page Exam Sheet</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#67705f] leading-relaxed">
            Clutch Notes AI strips away administrative fluff, attendance QR codes, and repetitive homework steps to
            produce bilingual revision notes with LaTeX equations and watermarked PDF export. Included in the 7-Day Cram
            Pass (69.000đ), Đấu Sĩ Pro (299.000đ), and Giảng Viên &amp; Nhóm Học.
          </p>
        </div>

        {/* Visual Comparison Split Card: Before vs After */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-7">
          {/* BEFORE COLUMN */}
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-5 relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#ececec]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-red-700">
                  Before: Raw Lecturer Deck
                </span>
              </div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                27 Slides · 65% Clutter
              </span>
            </div>

            {/* Mock Cluttered Slides */}
            <div className="space-y-2.5 text-xs text-[#666] font-mono select-none">
              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] flex items-center justify-between shadow-2xs">
                <div className="flex items-center gap-2">
                  <QrCode size={16} className="text-red-500" />
                  <span>Slide 1-2: Course Info & Attendance QR</span>
                </div>
                <span className="text-[10px] text-red-600 font-bold">NOISE</span>
              </div>

              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] shadow-2xs">
                <div className="font-semibold text-[#333] mb-1">Slide 7: Agenda</div>
                <div className="text-[11px] text-[#777]">Overview, announcements, homework review, 10-min break...</div>
              </div>

              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] shadow-2xs">
                <div className="font-semibold text-[#333] mb-1">Slide 14: Messy Spreadsheet Screenshot</div>
                <div className="text-[10px] text-[#777]">
                  Row 42: P0 = D1/(r-g) = 2.40/(0.12 - 0.05) = $34.28 (unformatted cell calculation)
                </div>
              </div>

              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] flex items-center justify-between shadow-2xs">
                <span>Slide 27: "Any questions? Thank you!"</span>
                <span className="text-[10px] text-red-600 font-bold">NOISE</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#ececec] flex items-center gap-2 text-xs text-red-700 font-medium">
              <AlertTriangle size={14} />
              <span>Wastes 45+ minutes skimming through non-exam material</span>
            </div>
          </div>

          {/* AFTER COLUMN */}
          <div className="bg-[#fffbf6] border-2 border-[#f3aa84] rounded-xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#fcdccb]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#e96b44]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#963714]">
                  After: Clutch Arena Note
                </span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#fbede5] text-[#d9532f] border border-[#fbd8c8]">
                3 Pages · 100% Exam-Ready
              </span>
            </div>

            {/* Mock Distilled Note Preview */}
            <div className="space-y-3 text-xs">
              <div className="bg-white border border-[#fcdccb] rounded-lg p-2.5 shadow-2xs">
                <div className="text-[11px] font-bold text-[#c8532f] mb-1">
                  B. CÔNG THỨC TỔNG QUÁT: Gordon Constant Growth
                </div>
                <div className="py-1 px-2 rounded bg-[#fdf8f4] text-[#c24e23] text-center my-1 text-xs sm:text-sm font-bold flex justify-center">
                  <MathText content="$$P_0 = \frac{D_1}{r - g}$$" />
                </div>
                <div className="text-[10px] text-[#6b7562]">
                  <strong>Trong đó:</strong> P_0 (giá cổ phiếu), D_1 (cổ tức kỳ tới), r (tỷ suất đòi hỏi), g (tốc độ
                  tăng trưởng).
                </div>
              </div>

              <div className="bg-[#fdfaf5] border-l-4 border-[#e96b44] rounded-r-lg p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#963714] mb-1">
                  <Sparkles size={13} className="text-[#e96b44]" />
                  <span>KEY TAKEAWAYS & BOUNDARY CONDITIONS</span>
                </div>
                <div className="text-[11px] text-[#3c4636] leading-relaxed">
                  1. Điều kiện mô hình: Bắt buộc <strong>g &lt; r</strong> (nếu g ≥ r, mẫu số âm/vô cực, mô hình đổ
                  vỡ).
                </div>
                <div className="text-[11px] text-[#3c4636] leading-relaxed">
                  2. Phân biệt đề thi: "vừa trả" = D_0; "sẽ trả năm tới" = D_1.
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#fcdccb] flex items-center justify-between text-xs text-[#2e7d32] font-semibold">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[#2e7d32]" />
                <span>89% Noise Stripped · Bilingual Anchoring</span>
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#b45309]">KaTeX &amp; PDF</span>
            </div>
          </div>
        </div>

        {/* Value Props Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7 text-center">
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Layers size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">30 Decks / Day</div>
            <div className="text-[11px] text-[#717b68]">Up to 25MB PDF/PPTX</div>
          </div>
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Zap size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">Bilingual EN/VI</div>
            <div className="text-[11px] text-[#717b68]">Academic terms in context</div>
          </div>
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Sparkles size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">LaTeX Math</div>
            <div className="text-[11px] text-[#717b68]">"Trong đó:" variable lists</div>
          </div>
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Printer size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">Watermarked PDF</div>
            <div className="text-[11px] text-[#717b68]">Exam revision sheets</div>
          </div>
        </div>

        {/* Action CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            onClick={() => {
              onClose();
              onUpgradeClick();
            }}
            className="w-full sm:w-auto px-8 py-3 bg-[#e96b44] hover:bg-[#d95e37] text-white font-bold text-sm rounded-xl shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.01]"
          >
            <Zap size={16} />
            <span>View Plans &amp; Unlock (From 69.000đ)</span>
            <ArrowRight size={16} />
          </Button>

          {onLoadSampleClick && (
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                onLoadSampleClick();
              }}
              className="w-full sm:w-auto px-5 py-3 border-[#dce1d5] bg-white hover:bg-[#f7f8f4] text-[#3d4735] font-semibold text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-2xs"
            >
              <span>Try Interactive Demo Note</span>
              <ChevronRight size={16} />
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
