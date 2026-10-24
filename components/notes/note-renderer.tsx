"use client";

import React, { useState } from "react";
import { Printer, Copy, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { exportClutchNotePdf } from "@/lib/notes/export-pdf";
import type { ClutchNote, NoteFormula, NoteSection } from "@/lib/schemas/notes";

interface NoteRendererProps {
  note: ClutchNote;
  onReset: () => void;
}

function FormulaBlock({ formula }: { formula: NoteFormula }) {
  return (
    <div className="my-3">
      {formula.leadText ? (
        <p className="text-sm sm:text-[15px] text-[#1f2937] leading-relaxed mb-2.5">
          <MathText content={formula.leadText} inline />
        </p>
      ) : formula.name ? (
        <div className="text-sm font-bold text-[#111827] mb-2">
          <MathText content={formula.name} inline />
        </div>
      ) : null}

      {/* Centered crisp bordered equation box */}
      <div className="my-3 flex justify-center overflow-x-auto py-0.5">
        <div className="inline-block border border-[#1f2937] bg-white px-5 sm:px-7 py-2.5 sm:py-3 text-[#111827] max-w-full overflow-x-auto">
          <MathText content={`$$${formula.latex}$$`} />
        </div>
      </div>

      {/* "Trong đó:" variable list — rendered only when new variables are defined */}
      {formula.variables && formula.variables.length > 0 && (
        <div className="mt-2.5 mb-3 text-sm sm:text-[15px] text-[#1f2937]">
          <div className="mb-1.5">Trong đó:</div>
          <ul className="pl-7 space-y-1 list-disc marker:text-[#111827]">
            {formula.variables.map((v, vIdx) => (
              <li key={vIdx} className="leading-relaxed">
                <span className="font-medium text-[#111827]">
                  <MathText content={`$${v.symbol}$`} inline />
                </span>
                {": "}
                <MathText content={v.definition} inline />
              </li>
            ))}
          </ul>
        </div>
      )}

      {formula.description && (
        <p className="text-sm sm:text-[15px] text-[#1f2937] leading-relaxed mt-2.5 mb-1.5">
          <MathText content={formula.description} inline />
        </p>
      )}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="pl-7 space-y-1.5 list-disc marker:text-[#111827] text-sm sm:text-[15px] text-[#1f2937] my-2">
      {items.map((bp, idx) => (
        <li key={idx} className="leading-relaxed">
          <MathText content={bp} inline />
        </li>
      ))}
    </ul>
  );
}

export function NoteRenderer({ note, onReset }: NoteRendererProps) {
  const [copied, setCopied] = useState(false);

  const displayNoiseRate =
    note.noiseReductionRate > 0 && note.noiseReductionRate <= 1
      ? Math.round(note.noiseReductionRate * 100)
      : Math.round(note.noiseReductionRate || 85);

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

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(`note-sec-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 animate-in fade-in duration-300 pb-16">
      {/* Compact Sticky Top Toolbar */}
      <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 bg-white/95 backdrop-blur-xs border border-[#e2e6db] rounded-xl px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5b6653] hover:text-[#1a2118] transition-colors cursor-pointer"
          >
            <ArrowLeft size={15} />
            <span>New Deck</span>
          </button>

          <span className="hidden sm:inline-block h-4 w-px bg-[#e2e6db]" />

          <span className="px-2.5 py-0.5 rounded-full bg-[#f7f8f4] border border-[#e2e6dc] text-[#4c5745] text-[11px] font-semibold">
            {note.originalSlideCount} Slides → {note.estimatedDistilledPages} Pages
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-[#edf5e8] border border-[#cde0c3] text-[#2e6320] text-[11px] font-bold">
            {displayNoiseRate}% Noise Stripped
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick jump section anchors */}
          {note.sections.length > 1 && (
            <div className="hidden md:flex items-center gap-1 mr-1">
              {note.sections.map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => scrollToSection(sec.id)}
                  title={sec.titleVi}
                  className="w-6 h-6 rounded text-[11px] font-bold text-[#5c6753] hover:text-[#991b1b] hover:bg-[#fdf2f2] transition-colors cursor-pointer"
                >
                  {sec.letter}
                </button>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyMarkdown}
            className="border-[#dce1d5] bg-white hover:bg-[#f7f8f4] text-[#3d4735] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            {copied ? <Check size={14} className="text-[#2e7d32]" /> : <Copy size={14} />}
            <span>{copied ? "Copied" : "Copy Markdown"}</span>
          </Button>

          <Button
            size="sm"
            onClick={handleExportPdf}
            className="bg-[#e96b44] hover:bg-[#d95e37] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Printer size={14} />
            <span>Export PDF</span>
          </Button>
        </div>
      </div>

      {/* Single Continuous Concise Study Handout Sheet */}
      <article className="bg-white border border-[#dcded6] rounded-xl px-6 py-8 sm:px-14 sm:py-12 shadow-sm relative overflow-hidden">
        {/* Subtle centered Clutch Arena watermark */}
        <div
          className="pointer-events-none select-none absolute inset-0 overflow-hidden opacity-[0.04] flex items-center justify-center z-0"
          aria-hidden="true"
        >
          <div className="flex flex-col items-center justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand-icon.png" alt="" className="w-48 h-48 sm:w-64 sm:h-64 object-contain" />
            <span className="text-2xl sm:text-3xl font-black tracking-[0.25em] text-[#1a2118] uppercase">
              Clutch Arena
            </span>
          </div>
        </div>

        <div
          className="relative z-10 font-serif text-[#111827]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {/* Top-left subtle course label */}
          <div className="text-xs sm:text-sm italic font-semibold text-[#374151] mb-4">
            {note.subject} — Clutch Notes AI
          </div>

          {/* Centered Chapter / Topic Title */}
          <h1 className="text-xl sm:text-[26px] font-bold text-[#991b1b] text-center uppercase tracking-wide mb-7 leading-snug">
            {note.title}
          </h1>

          {/* Continuous Flow of Alphabetical Sections */}
          <div className="space-y-6">
            {note.sections.map((section: NoteSection) => {
              const formulasIntroduceBullets =
                section.formulas.length > 0 &&
                !section.formulas[0].leadText &&
                Boolean(section.formulas[0].description?.trim().endsWith(":"));

              const hasStructuredTakeaways =
                section.keyTakeaways &&
                section.keyTakeaways.items &&
                section.keyTakeaways.items.length > 0;

              const fallbackTakeawayPoints: string[] = [];
              if (section.keyTakeaways && !hasStructuredTakeaways) {
                const kt = section.keyTakeaways;
                if (kt.summaryPoints && kt.summaryPoints.length > 0) {
                  fallbackTakeawayPoints.push(...kt.summaryPoints);
                } else {
                  if (kt.modelSelectionRule) fallbackTakeawayPoints.push(kt.modelSelectionRule);
                  if (kt.realWorldConditions) fallbackTakeawayPoints.push(kt.realWorldConditions);
                  if (kt.boundaryConditions) fallbackTakeawayPoints.push(kt.boundaryConditions);
                }
              }

              return (
                <section
                  key={section.id}
                  id={`note-sec-${section.id}`}
                  className="scroll-mt-20"
                >
                  {/* Section Heading (A., B., C., D., E.) */}
                  <h2 className="text-base sm:text-[17px] font-bold text-[#991b1b] tracking-wide mb-2.5">
                    {section.titleVi}
                  </h2>

                  {/* Bold 1-line Core Principle Statement */}
                  {section.coreStatement && (
                    <p className="text-sm sm:text-[15px] font-bold text-[#111827] text-center my-3 px-2 leading-relaxed">
                      <MathText content={section.coreStatement} inline />
                    </p>
                  )}

                  {/* Concise 1-line Overview / Lead-in */}
                  {section.overview && (
                    <p className="text-sm sm:text-[15px] text-[#1f2937] leading-relaxed mb-2">
                      <MathText content={section.overview} inline />
                    </p>
                  )}

                  {/* Section-level Bullets & Boxed Formulas in natural reading order */}
                  {formulasIntroduceBullets ? (
                    <>
                      {section.formulas.map((f, fIdx) => (
                        <FormulaBlock key={fIdx} formula={f} />
                      ))}
                      <BulletList items={section.bulletPoints} />
                    </>
                  ) : (
                    <>
                      <BulletList items={section.bulletPoints} />
                      {section.formulas.map((f, fIdx) => (
                        <FormulaBlock key={fIdx} formula={f} />
                      ))}
                    </>
                  )}

                  {/* Sub-Sections (CASE 1, CASE 2, CASE 3, Finding g, Finding R, etc.) */}
                  {section.subSections && section.subSections.length > 0 && (
                    <div className="space-y-4 mt-3.5">
                      {section.subSections.map((sub, sIdx) => (
                        <div key={sIdx}>
                          {sub.heading && (
                            <h3 className="text-sm sm:text-[15px] font-bold text-[#111827] mb-1.5">
                              <MathText content={sub.heading} inline />
                            </h3>
                          )}
                          {sub.leadIn && (
                            <p className="text-sm sm:text-[15px] text-[#1f2937] leading-relaxed mb-1.5">
                              <MathText content={sub.leadIn} inline />
                            </p>
                          )}
                          <BulletList items={sub.bulletPoints} />
                          {sub.formulas.map((f, fIdx) => (
                            <FormulaBlock key={fIdx} formula={f} />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Crisp Boxed KEY TAKEAWAYS */}
                  {section.keyTakeaways &&
                    (hasStructuredTakeaways || fallbackTakeawayPoints.length > 0) && (
                      <div className="my-5 border border-[#1f2937] bg-white px-5 py-4">
                        <div className="text-sm sm:text-[15px] font-bold text-[#991b1b] uppercase tracking-wide mb-2">
                          {section.keyTakeaways.title || "KEY TAKEAWAYS"}
                        </div>

                        {hasStructuredTakeaways ? (
                          <ol className="pl-6 space-y-1.5 list-decimal text-sm sm:text-[15px] text-[#111827]">
                            {section.keyTakeaways.items!.map((item, idx) => (
                              <li key={idx} className="leading-relaxed">
                                <MathText content={item.point} inline />
                                {item.subBullets && item.subBullets.length > 0 && (
                                  <ul className="pl-6 mt-1 space-y-1 list-disc marker:text-[#111827]">
                                    {item.subBullets.map((sb, sbIdx) => (
                                      <li key={sbIdx} className="leading-relaxed">
                                        <MathText content={sb} inline />
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <ol className="pl-6 space-y-1.5 list-decimal text-sm sm:text-[15px] text-[#111827]">
                            {fallbackTakeawayPoints.map((pt, idx) => (
                              <li key={idx} className="leading-relaxed">
                                <MathText content={pt} inline />
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                </section>
              );
            })}
          </div>
        </div>
      </article>
    </div>
  );
}
