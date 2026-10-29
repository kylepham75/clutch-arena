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
import { useLanguage } from "@/lib/i18n/context";

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
  const { t } = useLanguage();

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      className="before-after-dialog-content"
      title={t.notes.modalTitle}
      description={t.notes.modalDesc}
      hideHeader
      hideCloseButton
    >
      <div className="relative text-[#1f261b] w-full">
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label={t.notes.modalCloseAria}
          className="absolute -top-3 -right-3 sm:-top-4 sm:-right-4 p-2 text-[#7f8a77] hover:text-[#1a2118] rounded-lg hover:bg-[#f3f5ee] transition-colors cursor-pointer z-10"
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div className="text-center max-w-2xl mx-auto mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-[#fff4ec] border border-[#fbd8c8] text-[#d9532f] text-xs font-bold uppercase tracking-wider">
            <Sparkles size={14} className="text-[#e96b44]" />
            <span>{t.notes.modalBadgeUnlocked}</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1a2118] tracking-tight mb-2">
            {t.notes.modalTransformPrefix} <span className="text-[#e96b44]">{t.notes.modalTransformSlides}</span> {t.notes.modalTransformInto}{" "}
            <span className="text-[#e96b44]">{t.notes.modalTransformSheet}</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#67705f] leading-relaxed">
            {t.notes.modalDescFull}
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
                  {t.notes.modalBeforeHeader}
                </span>
              </div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                {t.notes.modalBeforeStats}
              </span>
            </div>

            {/* Mock Cluttered Slides */}
            <div className="space-y-2.5 text-xs text-[#666] font-mono select-none">
              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] flex items-center justify-between shadow-2xs">
                <div className="flex items-center gap-2">
                  <QrCode size={16} className="text-red-500" />
                  <span>{t.notes.modalSlide12Title}</span>
                </div>
                <span className="text-[10px] text-red-600 font-bold">{t.notes.modalNoiseLabel}</span>
              </div>

              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] shadow-2xs">
                <div className="font-semibold text-[#333] mb-1">{t.notes.modalSlide7Title}</div>
                <div className="text-[11px] text-[#777]">{t.notes.modalSlide7Desc}</div>
              </div>

              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] shadow-2xs">
                <div className="font-semibold text-[#333] mb-1">{t.notes.modalSlide14Title}</div>
                <div className="text-[10px] text-[#777]">
                  {t.notes.modalSlide14Desc}
                </div>
              </div>

              <div className="p-2.5 rounded bg-white border border-[#e5e5e5] flex items-center justify-between shadow-2xs">
                <span>{t.notes.modalSlide27Title}</span>
                <span className="text-[10px] text-red-600 font-bold">{t.notes.modalNoiseLabel}</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#ececec] flex items-center gap-2 text-xs text-red-700 font-medium">
              <AlertTriangle size={14} />
              <span>{t.notes.modalBeforeWarning}</span>
            </div>
          </div>

          {/* AFTER COLUMN */}
          <div className="bg-[#fffbf6] border-2 border-[#f3aa84] rounded-xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#fcdccb]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#e96b44]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#963714]">
                  {t.notes.modalAfterHeader}
                </span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#fbede5] text-[#d9532f] border border-[#fbd8c8]">
                {t.notes.modalAfterStats}
              </span>
            </div>

            {/* Mock Distilled Note Preview */}
            <div className="space-y-3 text-xs font-serif text-[#111827]">
              <div className="bg-white border border-[#e5e7eb] rounded-lg p-3 shadow-2xs">
                <div className="text-[11px] font-bold text-[#991b1b] mb-1">
                  {t.notes.modalFormulaHeading}
                </div>
                <div className="text-[11px] mb-1.5">{t.notes.modalFormulaCondition}</div>
                <div className="flex justify-center my-1.5">
                  <div className="inline-block border border-[#1f2937] bg-white px-3 py-1 text-xs">
                    <MathText content="$$P_0 = \frac{D_1}{1 + R} + \frac{P_1}{1 + R}$$" />
                  </div>
                </div>
                <div className="text-[10.5px] text-[#374151]">
                  <strong>{t.notes.whereVariables}</strong> <MathText content="$P_0$" inline />: {t.notes.modalWherePriceToday} ·{" "}
                  <MathText content="$D_1$" inline />: {t.notes.modalWhereDividend} ·{" "}
                  <MathText content="$R$" inline />: {t.notes.modalWhereRequiredReturn}
                </div>
              </div>

              <div className="bg-white border border-[#1f2937] p-3">
                <div className="text-[11px] font-bold text-[#991b1b] uppercase mb-1">
                  {t.notes.modalKeyTakeawaysHeading}
                </div>
                <ol className="pl-4 list-decimal space-y-0.5 text-[11px] text-[#111827] leading-snug">
                  <li>{t.notes.modalTakeaway1}</li>
                  <li>{t.notes.modalTakeaway2}</li>
                  <li>
                    {t.notes.modalTakeaway3Prefix}<strong>g &lt; R</strong>{t.notes.modalTakeaway3Suffix}
                  </li>
                </ol>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#fcdccb] flex items-center justify-between text-xs text-[#2e7d32] font-semibold">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[#2e7d32]" />
                <span>{t.notes.modalAfterFooter}</span>
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#b45309]">{t.notes.modalKatexPdfBadge}</span>
            </div>
          </div>
        </div>

        {/* Value Props Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7 text-center">
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Layers size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">{t.notes.modalProp1Title}</div>
            <div className="text-[11px] text-[#717b68]">{t.notes.modalProp1Desc}</div>
          </div>
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Zap size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">{t.notes.modalProp2Title}</div>
            <div className="text-[11px] text-[#717b68]">{t.notes.modalProp2Desc}</div>
          </div>
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Sparkles size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">{t.notes.modalProp3Title}</div>
            <div className="text-[11px] text-[#717b68]">{t.notes.modalProp3Desc}</div>
          </div>
          <div className="p-3 rounded-lg bg-[#fafbf8] border border-[#e2e6db]">
            <Printer size={18} className="mx-auto text-[#e96b44] mb-1.5" />
            <div className="text-xs font-bold text-[#1f261b]">{t.notes.modalProp4Title}</div>
            <div className="text-[11px] text-[#717b68]">{t.notes.modalProp4Desc}</div>
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
            <span>{t.notes.modalUpgradeBtn}</span>
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
              <span>{t.notes.modalDemoBtn}</span>
              <ChevronRight size={16} />
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
