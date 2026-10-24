"use client";

import React, { useState } from "react";
import {
  FileText,
  Printer,
  Copy,
  Check,
  Sparkles,
  ArrowLeft,
  Share2,
  ChevronDown,
  Layers,
  HelpCircle,
  AlertOctagon,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { exportClutchNotePdf } from "@/lib/notes/export-pdf";
import type { ClutchNote, NoteSection } from "@/lib/schemas/notes";

interface NoteRendererProps {
  note: ClutchNote;
  onReset: () => void;
}

export function NoteRenderer({ note, onReset }: NoteRendererProps) {
  const [copied, setCopied] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string>(
    note.sections[0]?.id || "section-a",
  );

  const displayNoiseRate =
    note.noiseReductionRate > 0 && note.noiseReductionRate <= 1
      ? Math.round(note.noiseReductionRate * 100)
      : Math.round(note.noiseReductionRate || 85);

  const parsedDate = new Date(note.createdAt);
  const isValidDate = !isNaN(parsedDate.getTime()) && parsedDate.getFullYear() >= 2024;
  const noteDate = isValidDate ? parsedDate : new Date();
  const generatedDate = noteDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const handleCopyMarkdown = () => {
    if (!note.rawMarkdown) return;
    navigator.clipboard.writeText(note.rawMarkdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExportPdf = () => {
    exportClutchNotePdf(note);
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300 pb-16">
      {/* Top action header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#e2e6db] rounded-xl p-4 shadow-xs">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#67735f] hover:text-[#1a2118] transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Upload Another Deck</span>
        </button>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyMarkdown}
            className="border-[#dce1d5] bg-white hover:bg-[#f7f8f4] text-[#3d4735] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            {copied ? <Check size={14} className="text-[#2e7d32]" /> : <Copy size={14} />}
            <span>{copied ? "Copied Markdown" : "Copy Markdown"}</span>
          </Button>

          <Button
            size="sm"
            onClick={handleExportPdf}
            className="bg-[#e96b44] hover:bg-[#d95e37] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Printer size={14} />
            <span>Export Watermarked PDF</span>
          </Button>
        </div>
      </div>

      {/* Hero Note Metadata Card */}
      <div className="bg-white border border-[#e2e6db] rounded-2xl p-6 sm:p-7 shadow-xs relative overflow-hidden">
        {/* Watermark: Big Clutch Arena icon with name below in the middle */}
        <div
          className="pointer-events-none select-none absolute inset-0 overflow-hidden opacity-[0.035] flex items-center justify-center z-0"
          aria-hidden="true"
        >
          <div className="flex flex-col items-center justify-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand-icon.png" alt="" className="w-24 h-24 sm:w-32 sm:h-32 object-contain" />
            <span className="text-lg sm:text-xl font-black tracking-[0.25em] text-[#1a2118] uppercase">
              Clutch Arena
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3 relative z-10">
          <span className="px-2.5 py-0.5 rounded-full bg-[#fff4ec] border border-[#fbd8c8] text-[#d9532f] text-[11px] font-bold uppercase tracking-wider">
            Clutch Notes AI · Pro Synthesis
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-[#f7f8f4] border border-[#e2e6dc] text-[#55604e] text-[11px] font-semibold">
            {note.originalSlideCount} Slides → {note.estimatedDistilledPages} Pages
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-[#edf5e8] border border-[#cde0c3] text-[#2e6320] text-[11px] font-bold">
            {displayNoiseRate}% Noise Stripped
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1a2118] tracking-tight mb-2 relative z-10">
          {note.title}
        </h1>

        <div className="text-xs text-[#707a68] flex flex-wrap gap-x-6 gap-y-1 mb-5 font-mono relative z-10">
          <span>Subject: <strong className="text-[#2b3525] font-sans">{note.subject}</strong></span>
          <span>Source: <strong className="text-[#2b3525] font-sans">{note.originalFileName}</strong></span>
          <span>Generated: <strong className="text-[#2b3525] font-sans">{generatedDate}</strong></span>
          <span>Note ID: <strong className="text-[#d9532f] font-mono">{note.id}</strong></span>
        </div>

        {/* Executive summary block */}
        <div className="bg-[#fdfaf5] border-l-4 border-[#e96b44] rounded-r-xl p-4 text-xs sm:text-sm text-[#384131] leading-relaxed relative z-10">
          <span className="font-bold text-[#c2512a] mr-1">TỔNG QUAN TÀI LIỆU (Executive Summary):</span>
          <MathText content={note.executiveSummary} inline />
        </div>
      </div>

      {/* Section navigation tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {note.sections.map((section) => {
          const isActive = activeSectionId === section.id;
          return (
            <button
              key={section.id}
              onClick={() => setActiveSectionId(section.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                isActive
                  ? "bg-[#e96b44] text-white shadow-xs"
                  : "bg-white border border-[#e2e6db] text-[#5c6753] hover:text-[#1a2118] hover:bg-[#f7f8f4]"
              }`}
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center text-[11px] font-black ${isActive ? "bg-[#d45832] text-white" : "bg-[#f1f3ea] text-[#56604e]"}`}>
                {section.letter}
              </span>
              <span>{section.titleVi.split(":")[0].replace(/^[A-Z]\.\s*/, "") || section.titleEn}</span>
            </button>
          );
        })}
      </div>

      {/* Active Section Content */}
      {note.sections
        .filter((sec) => sec.id === activeSectionId)
        .map((section: NoteSection) => (
          <div
            key={section.id}
            className="bg-white border border-[#e2e6db] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs relative overflow-hidden"
          >
            {/* Watermark: Big Clutch Arena icon with name below in the middle */}
            <div
              className="pointer-events-none select-none absolute inset-0 overflow-hidden opacity-[0.035] flex items-center justify-center z-0"
              aria-hidden="true"
            >
              <div className="flex flex-col items-center justify-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand-icon.png" alt="" className="w-32 h-32 sm:w-44 sm:h-44 object-contain" />
                <span className="text-xl sm:text-2xl font-black tracking-[0.25em] text-[#1a2118] uppercase">
                  Clutch Arena
                </span>
              </div>
            </div>

            {/* Section Header */}
            <div className="border-b border-[#edf0e8] pb-4 relative z-10">
              <div className="flex items-baseline gap-3 mb-1">
                <span className="px-2.5 py-1 rounded-md bg-[#fbede5] border border-[#f6cfc1] text-[#d9532f] text-xs font-black">
                  Section {section.letter}
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-[#1a2118] tracking-tight">
                  {section.titleVi}
                </h2>
              </div>
              <p className="text-xs font-semibold text-[#737f6a] uppercase tracking-wider ml-1">
                {section.titleEn}
              </p>
            </div>

            {/* Overview / Bilingual Concept Explanation */}
            <div className="text-sm text-[#2f3929] leading-relaxed bg-[#fafbf8] border border-[#e5e9de] rounded-xl p-4">
              <MathText content={section.overview} />
            </div>

            {/* Key Bullet Points */}
            {section.bulletPoints && section.bulletPoints.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#b45309] uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen size={14} />
                  <span>Điểm Trọng Tâm Ôn Thi (Core Takeaways)</span>
                </h3>
                <ul className="space-y-2">
                  {section.bulletPoints.map((bp, idx) => (
                    <li
                      key={idx}
                      className="text-xs sm:text-sm text-[#333d2c] flex items-start gap-2.5 bg-white p-3 rounded-lg border border-[#e8ece2] shadow-2xs"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#e96b44] mt-2 flex-shrink-0" />
                      <div className="flex-1">
                        <MathText content={bp} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Formula Cards */}
            {section.formulas && section.formulas.length > 0 && (
              <div className="space-y-4 pt-2">
                <h3 className="text-xs font-bold text-[#b45309] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="text-sm">📐</span>
                  <span>Công Thức Chuẩn Hóa &amp; Định Nghĩa Biến Số (LaTeX Standardization)</span>
                </h3>

                <div className="grid grid-cols-1 gap-4">
                  {section.formulas.map((formula, fIdx) => (
                    <div
                      key={fIdx}
                      className="bg-[#fdfcf9] border border-[#e4e8dc] rounded-xl p-5 shadow-2xs relative overflow-hidden"
                    >
                      <div className="text-xs font-bold text-[#c8532f] uppercase tracking-wider mb-2">
                        {formula.name}
                      </div>

                      {/* LaTeX Equation Display */}
                      <div className="my-3 py-3 px-4 rounded-lg bg-[#fafbf8] border border-[#e1e6d7] text-center overflow-x-auto text-[#111827]">
                        <MathText content={`$$${formula.latex}$$`} />
                      </div>

                      {formula.description && (
                        <p className="text-xs text-[#6e7765] italic mb-3">
                          <MathText content={formula.description} inline />
                        </p>
                      )}

                      {/* "Trong đó:" Variable Definitions */}
                      {formula.variables && formula.variables.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-[#edf0e8] bg-[#f7f9f4] rounded-lg p-3.5">
                          <div className="text-xs font-bold text-[#2d5c21] mb-2 flex items-center gap-1">
                            <span>Trong đó: (Where:)</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {formula.variables.map((v, vIdx) => (
                              <div
                                key={vIdx}
                                className="flex items-baseline gap-2 bg-white p-2 rounded border border-[#e3e8da] shadow-2xs"
                              >
                                <span className="font-bold text-[#d9532f] font-mono flex-shrink-0">
                                  <MathText content={`$${v.symbol}$`} inline />:
                                </span>
                                <span className="text-[#333d2c]">{v.definition}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* KEY TAKEAWAYS Box */}
            {section.keyTakeaways && (
              <div className="mt-6 pt-4 border-t border-[#edf0e8]">
                <div className="bg-[#fffbf6] border-2 border-[#f3aa84] rounded-xl p-5 sm:p-6 shadow-xs">
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#fcdccb]">
                    <div className="p-1 rounded bg-[#e96b44] text-white">
                      <Sparkles size={16} />
                    </div>
                    <h4 className="text-sm sm:text-base font-extrabold text-[#963714] tracking-tight">
                      {section.keyTakeaways.title}
                    </h4>
                  </div>

                  <div className="space-y-3 text-xs sm:text-sm">
                    {section.keyTakeaways.modelSelectionRule && (
                      <div className="bg-white p-3 rounded-lg border border-[#fcdccb]">
                        <span className="font-bold text-[#c24e23] block mb-1">
                          (a) Cách Chọn Mô Hình (Model Selection Rule):
                        </span>
                        <div className="text-[#333d2c] leading-relaxed">
                          <MathText content={section.keyTakeaways.modelSelectionRule} />
                        </div>
                      </div>
                    )}

                    {section.keyTakeaways.realWorldConditions && (
                      <div className="bg-white p-3 rounded-lg border border-[#fcdccb]">
                        <span className="font-bold text-[#c24e23] block mb-1">
                          (b) Điều Kiện Áp Dụng Thực Tế (Real-World Conditions):
                        </span>
                        <div className="text-[#333d2c] leading-relaxed">
                          <MathText content={section.keyTakeaways.realWorldConditions} />
                        </div>
                      </div>
                    )}

                    {section.keyTakeaways.boundaryConditions && (
                      <div className="bg-[#fef2f2] p-3.5 rounded-lg border-l-4 border-[#ef4444] text-red-900">
                        <span className="font-bold text-[#b91c1c] flex items-center gap-1.5 mb-1 text-xs">
                          <AlertOctagon size={14} />
                          <span>(c) Giới Hạn Toán Học &amp; Bẫy Thi Cử (Mathematical Boundary &amp; Pitfalls):</span>
                        </span>
                        <div className="text-red-950 text-xs sm:text-sm leading-relaxed">
                          <MathText content={section.keyTakeaways.boundaryConditions} />
                        </div>
                      </div>
                    )}

                    {section.keyTakeaways.summaryPoints && section.keyTakeaways.summaryPoints.length > 0 && (
                      <div className="mt-3 pt-2">
                        <div className="text-xs font-bold text-[#963714] mb-2 uppercase tracking-wider">
                          Key Exam Rules:
                        </div>
                        <ul className="space-y-1.5 pl-1">
                          {section.keyTakeaways.summaryPoints.map((sp, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-xs text-[#333d2c]">
                              <span className="text-[#d9532f] font-bold">{idx + 1}.</span>
                              <div className="flex-1">
                                <MathText content={sp} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
