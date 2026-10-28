"use client";

import React, { useMemo, useState } from "react";
import {
  Printer,
  Copy,
  Check,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  AlertOctagon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { exportClutchNotePdf } from "@/lib/notes/export-pdf";
import type {
  ClutchNote,
  NoteFormula,
  NoteSection,
  GroundedBullet,
  TextbookDivergenceNotice,
  FormulaLedgerEntry,
} from "@/lib/schemas/notes";

interface NoteRendererProps {
  note: ClutchNote;
  onReset: () => void;
}

interface UncapturedFormulaItem {
  id: string;
  slide?: number;
  latex?: string;
  label?: string;
  reason: string;
}

export function formatSlideList(slides: number[]): string {
  if (!slides || slides.length === 0) return "";
  const sorted = Array.from(new Set(slides)).sort((a, b) => a - b);
  if (sorted.length === 1) return `Slide ${sorted[0]}`;

  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = curr;
      prev = curr;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);

  return `Slides ${ranges.join(", ")}`;
}

export function SlideChip({
  slide,
  slides,
  label,
}: {
  slide?: number;
  slides?: number[];
  label?: string;
}) {
  const text = label || (slides ? formatSlideList(slides) : slide ? `Slide ${slide}` : null);
  if (!text) return null;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-sans font-medium bg-[#f3f4f6] text-[#4b5563] border border-[#e5e7eb] select-none tracking-tight">
      {text}
    </span>
  );
}

export function ItemStatusChip({
  status,
  reviewReason,
}: {
  status?: string;
  reviewReason?: string;
}) {
  if (status === "contradicted") {
    return (
      <span
        title={reviewReason}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-sans font-medium bg-rose-50 text-rose-700 border border-rose-200 select-none"
      >
        <AlertOctagon size={11} className="stroke-[2.5]" />
        <span>Contradicted</span>
      </span>
    );
  }
  if (status === "needs_review" || status === "unsupported") {
    return (
      <span
        title={reviewReason}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-sans font-medium bg-amber-50 text-amber-700 border border-amber-200 select-none"
      >
        <AlertTriangle size={11} className="stroke-[2.5]" />
        <span>Needs review</span>
      </span>
    );
  }
  return null;
}

export function FormulaStatusBadge({ formula }: { formula: NoteFormula }) {
  if (formula.status === "contradicted") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-sans font-medium bg-rose-50 text-rose-700 border border-rose-200 select-none">
        <AlertOctagon size={12} className="stroke-[2.5]" />
        <span>Contradicted</span>
      </span>
    );
  }

  if (formula.status === "needs_review" || formula.status === "unsupported") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-sans font-medium bg-amber-50 text-amber-700 border border-amber-200 select-none">
        <AlertTriangle size={12} className="stroke-[2.5]" />
        <span>Needs review</span>
      </span>
    );
  }

  const isDerived =
    formula.status === "derived" ||
    formula.origin === "derived" ||
    Boolean(formula.derivedFrom && formula.derivedFrom.length > 0);

  if (isDerived) {
    const derivedLabel =
      formula.derivedFrom && formula.derivedFrom.length > 0
        ? `Derived from ${formula.derivedFrom.join(", ")}`
        : "Derived";
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-sans font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 select-none">
        <Sparkles size={12} className="stroke-[2]" />
        <span>{derivedLabel}</span>
      </span>
    );
  }

  if (formula.status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-sans font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 select-none">
        <Check size={12} className="stroke-[2.5]" />
        <span>Verified</span>
      </span>
    );
  }

  return null;
}

export function TextbookDivergenceCard({
  notice,
}: {
  notice: TextbookDivergenceNotice;
}) {
  return (
    <div className="my-2.5 rounded-lg border border-amber-300 bg-amber-50/70 p-3.5 text-xs sm:text-[13px] text-[#1f2937] font-sans">
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900 font-bold text-[10.5px] uppercase tracking-wider">
          <AlertTriangle size={12} className="text-amber-800" />
          <span>Textbook Divergence Notice</span>
        </span>
        {notice.slide && <SlideChip slide={notice.slide} />}
      </div>
      <div className="font-semibold text-amber-950 mb-1">{notice.title}</div>
      <p className="text-amber-900/90 leading-relaxed mb-2">
        <MathText content={notice.message} inline />
      </p>

      {(notice.lecturerForm || notice.textbookForm) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-amber-200">
          {notice.lecturerForm && (
            <div className="bg-white/90 rounded border border-amber-200 p-2 text-center">
              <div className="text-[10.5px] font-bold text-amber-900 uppercase tracking-wide mb-1">
                Lecturer&apos;s Form
              </div>
              <div className="note-formula-wrap max-w-full whitespace-normal break-words py-1 font-serif">
                <MathText content={`$$${notice.lecturerForm}$$`} />
              </div>
            </div>
          )}
          {notice.textbookForm && (
            <div className="bg-white/90 rounded border border-amber-200 p-2 text-center">
              <div className="text-[10.5px] font-bold text-emerald-900 uppercase tracking-wide mb-1">
                Standard Textbook Form
              </div>
              <div className="note-formula-wrap max-w-full whitespace-normal break-words py-1 font-serif">
                <MathText content={`$$${notice.textbookForm}$$`} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FormulaBlock({ formula }: { formula: NoteFormula }) {
  const isDerived =
    formula.status === "derived" ||
    formula.origin === "derived" ||
    Boolean(formula.derivedFrom && formula.derivedFrom.length > 0);

  const hasStatusOrChip = Boolean(
    formula.slide ||
    formula.status ||
    isDerived
  );

  return (
    <div className="my-3">
      {/* Top row: leadText / name + Slide chip & Verification badge */}
      {(formula.leadText || formula.name || hasStatusOrChip) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div className="flex-1 min-w-[200px]">
            {formula.leadText ? (
              <p className="text-sm sm:text-[15px] text-[#1f2937] leading-relaxed">
                <MathText content={formula.leadText} inline />
              </p>
            ) : formula.name ? (
              <div className="text-sm font-bold text-[#111827]">
                <MathText content={formula.name} inline />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 self-start">
            {formula.slide && <SlideChip slide={formula.slide} />}
            <FormulaStatusBadge formula={formula} />
          </div>
        </div>
      )}

      {/* Review reason callout when flagged */}
      {formula.reviewReason && (formula.status === "needs_review" || formula.status === "contradicted") && (
        <div
          className={`text-xs rounded px-2.5 py-1 mb-2 font-sans flex items-start gap-1.5 ${
            formula.status === "contradicted"
              ? "text-rose-800 bg-rose-50 border border-rose-200"
              : "text-amber-800 bg-amber-50 border border-amber-200"
          }`}
        >
          {formula.status === "contradicted" ? (
            <AlertOctagon size={13} className="mt-0.5 shrink-0 text-rose-600" />
          ) : (
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
          )}
          <span>{formula.reviewReason}</span>
        </div>
      )}

      {/* Centered crisp bordered equation box */}
      <div className="my-3 flex justify-center py-0.5 max-w-full">
        <div className="note-formula-wrap inline-block border border-[#1f2937] bg-white px-5 sm:px-7 py-2.5 sm:py-3 text-[#111827] max-w-full whitespace-normal break-words">
          <MathText content={`$$${formula.latex}$$`} />
        </div>
      </div>

      {/* "Trong đó:" variable list — rendered only when new variables are defined */}
      {formula.variables && formula.variables.length > 0 && (
        <div className="mt-2.5 mb-3 text-sm sm:text-[15px] text-[#1f2937]">
          <div className="mb-1.5 font-medium">Trong đó:</div>
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

      {/* Attached textbook divergence notices */}
      {formula.divergenceNotices && formula.divergenceNotices.length > 0 && (
        <div className="space-y-2 mt-2.5 mb-3">
          {formula.divergenceNotices.map((notice, nIdx) => (
            <TextbookDivergenceCard key={nIdx} notice={notice} />
          ))}
        </div>
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

function GroundedBulletList({ items }: { items: GroundedBullet[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="pl-7 space-y-2 list-disc marker:text-[#111827] text-sm sm:text-[15px] text-[#1f2937] my-2">
      {items.map((bullet, idx) => (
        <li key={idx} className="leading-relaxed">
          <div className="inline-flex flex-wrap items-center gap-1.5 align-middle mr-1.5">
            <SlideChip slide={bullet.slide} />
            <ItemStatusChip status={bullet.status} reviewReason={bullet.reviewReason} />
          </div>
          <span className="align-middle">
            <MathText content={bullet.text} inline />
          </span>
          {bullet.reviewReason && (bullet.status === "needs_review" || bullet.status === "contradicted") && (
            <div
              className={`text-xs rounded px-2 py-0.5 mt-1 font-sans ${
                bullet.status === "contradicted"
                  ? "text-rose-800 bg-rose-50/80 border border-rose-200/80"
                  : "text-amber-800 bg-amber-50/80 border border-amber-200/80"
              }`}
            >
              <span className="font-semibold">Review note: </span>
              {bullet.reviewReason}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function BulletsBlock({
  groundedBullets,
  bulletPoints,
}: {
  groundedBullets?: GroundedBullet[];
  bulletPoints?: string[];
}) {
  if (groundedBullets && groundedBullets.length > 0) {
    return <GroundedBulletList items={groundedBullets} />;
  }
  if (bulletPoints && bulletPoints.length > 0) {
    return <BulletList items={bulletPoints} />;
  }
  return null;
}

function getUnattachedDivergenceNotices(note: ClutchNote): {
  perSection: Map<string, TextbookDivergenceNotice[]>;
  global: TextbookDivergenceNotice[];
} {
  const allNotices = note.verification?.divergenceNotices || [];
  const perSection = new Map<string, TextbookDivergenceNotice[]>();
  const global: TextbookDivergenceNotice[] = [];

  if (allNotices.length === 0) {
    return { perSection, global };
  }

  const renderedKeys = new Set<string>();
  for (const sec of note.sections) {
    for (const f of sec.formulas) {
      for (const d of f.divergenceNotices || []) {
        renderedKeys.add(`${d.ruleId}-${d.slide || ""}-${d.title}`);
      }
    }
    for (const sub of sec.subSections || []) {
      for (const f of sub.formulas) {
        for (const d of f.divergenceNotices || []) {
          renderedKeys.add(`${d.ruleId}-${d.slide || ""}-${d.title}`);
        }
      }
    }
  }

  const unattached = allNotices.filter(
    (n) => !renderedKeys.has(`${n.ruleId}-${n.slide || ""}-${n.title}`)
  );

  for (const notice of unattached) {
    let matchedSectionId: string | null = null;
    if (notice.slide) {
      for (const sec of note.sections) {
        if (sec.sourceSlides && sec.sourceSlides.includes(notice.slide)) {
          matchedSectionId = sec.id;
          break;
        }
      }
    }

    if (matchedSectionId) {
      const existing = perSection.get(matchedSectionId) || [];
      existing.push(notice);
      perSection.set(matchedSectionId, existing);
    } else {
      global.push(notice);
    }
  }

  return { perSection, global };
}

function getUncapturedFormulas(note: ClutchNote): UncapturedFormulaItem[] {
  const omittedByRuleSet = new Set<string>(
    note.verification?.omittedByRuleFormulaIds || [],
  );

  const omittedMap = new Map<string, { reason: string; status?: string }>();
  if (note.omitted) {
    for (const o of note.omitted) {
      if (o && o.formulaId) {
        omittedMap.set(o.formulaId, {
          reason: o.reason,
          status: (o as any).status,
        });
        if ((o as any).status === "omitted_by_rule") {
          omittedByRuleSet.add(o.formulaId);
        }
      }
    }
  }

  const ledgerMap = new Map<string, FormulaLedgerEntry>();
  if (note.formulaLedger) {
    for (const entry of note.formulaLedger) {
      ledgerMap.set(entry.id, entry);
    }
  }

  const placedIds = new Set<string>(note.verification?.placedFormulaIds || []);
  for (const sec of note.sections) {
    for (const f of sec.formulas) {
      for (const ref of f.formulaRefs || []) {
        placedIds.add(ref);
      }
    }
    for (const sub of sec.subSections || []) {
      for (const f of sub.formulas) {
        for (const ref of f.formulaRefs || []) {
          placedIds.add(ref);
        }
      }
    }
  }

  const targetUncapturedIds = new Set<string>();

  // 1. Explicit uncaptured IDs from verification gate (minus any marked omitted_by_rule)
  if (note.verification?.uncapturedFormulaIds) {
    for (const id of note.verification.uncapturedFormulaIds) {
      if (!omittedByRuleSet.has(id)) {
        targetUncapturedIds.add(id);
      }
    }
  }

  // 2. Formulas explicitly marked as uncaptured_error in omitted[]
  if (note.omitted) {
    for (const o of note.omitted) {
      if (
        o &&
        o.formulaId &&
        (o as any).status === "uncaptured_error" &&
        !omittedByRuleSet.has(o.formulaId)
      ) {
        targetUncapturedIds.add(o.formulaId);
      }
    }
  }

  // 3. Fallback compatibility: If verification is not provided (e.g. mock note without verification gate),
  // include unplaced formulas from omitted or ledger that are not omitted_by_rule
  if (!note.verification) {
    if (note.omitted) {
      for (const o of note.omitted) {
        if (o && o.formulaId && !omittedByRuleSet.has(o.formulaId)) {
          targetUncapturedIds.add(o.formulaId);
        }
      }
    }
    if (note.formulaLedger) {
      for (const entry of note.formulaLedger) {
        if (!placedIds.has(entry.id) && !omittedByRuleSet.has(entry.id)) {
          targetUncapturedIds.add(entry.id);
        }
      }
    }
  }

  const items: UncapturedFormulaItem[] = [];

  for (const id of targetUncapturedIds) {
    if (omittedByRuleSet.has(id)) continue;

    const ledger = ledgerMap.get(id);
    const omittedEntry = omittedMap.get(id);

    const reason =
      omittedEntry?.reason ||
      (ledger?.isExerciseOnly
        ? "Appeared solely in a practice exercise or worked example"
        : ledger?.evidence
          ? `Slide context: "${ledger.evidence}"`
          : "Omitted from core summary sections as non-essential or duplicate");

    items.push({
      id,
      slide: ledger?.slide,
      latex: ledger?.latex,
      label: ledger?.label,
      reason,
    });
  }

  items.sort((a, b) => {
    if (a.slide && b.slide && a.slide !== b.slide) {
      return a.slide - b.slide;
    }
    const aNum = parseInt(a.id.replace(/\D/g, ""), 10) || 0;
    const bNum = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
    return aNum - bNum;
  });

  return items;
}

export function NoteRenderer({ note, onReset }: NoteRendererProps) {
  const [copied, setCopied] = useState(false);

  const displayNoiseRate =
    note.noiseReductionRate > 0 && note.noiseReductionRate <= 1
      ? Math.round(note.noiseReductionRate * 100)
      : Math.round(note.noiseReductionRate || 85);

  const unattachedDivergences = useMemo(
    () => getUnattachedDivergenceNotices(note),
    [note]
  );

  const uncapturedFormulas = useMemo(
    () => getUncapturedFormulas(note),
    [note]
  );

  const displayWarnings = useMemo(() => {
    const rawWarnings = note.verification?.warnings || [];
    if (uncapturedFormulas.length === 0) {
      return rawWarnings.filter((w) => !w.startsWith("Uncaptured formula IDs:"));
    }
    return rawWarnings;
  }, [note.verification?.warnings, uncapturedFormulas.length]);

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
          <h1 className="text-xl sm:text-[26px] font-bold text-[#991b1b] text-center uppercase tracking-wide mb-6 leading-snug">
            {note.title}
          </h1>

          {/* Ingestion & Verification Notices Alert Banner */}
          {displayWarnings.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50/90 p-4 text-xs sm:text-[13px] text-amber-950 font-sans shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-700 shrink-0" />
                  <span className="font-bold text-sm text-amber-900">
                    Ingestion & Verification Notices
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900 font-semibold text-[11px]">
                  {displayWarnings.length}{" "}
                  {displayWarnings.length === 1 ? "Notice" : "Notices"}
                </span>
              </div>

              <ul className="pl-5 space-y-1 list-disc marker:text-amber-700 text-amber-900 leading-relaxed my-2">
                {displayWarnings.map((w, idx) => (
                  <li key={idx}>
                    <MathText content={w} inline />
                  </li>
                ))}
              </ul>

              <p className="text-[11.5px] italic text-amber-800/90 mt-2.5 pt-2 border-t border-amber-200/80">
                Formulas or tables from these slides should be double-checked against your original lecture deck.
              </p>
            </div>
          )}

          {/* Global Unattached Textbook Divergence Notices */}
          {unattachedDivergences.global.length > 0 && (
            <div className="mb-6 space-y-2">
              {unattachedDivergences.global.map((notice, nIdx) => (
                <TextbookDivergenceCard key={nIdx} notice={notice} />
              ))}
            </div>
          )}

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

              const sectionUnattachedNotices =
                unattachedDivergences.perSection.get(section.id) || [];

              return (
                <section
                  key={section.id}
                  id={`note-sec-${section.id}`}
                  className="scroll-mt-20"
                >
                  {/* Section Heading & Slide Chips */}
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
                    <h2 className="text-base sm:text-[17px] font-bold text-[#991b1b] tracking-wide">
                      {section.titleVi}
                    </h2>
                    {section.sourceSlides && section.sourceSlides.length > 0 && (
                      <SlideChip slides={section.sourceSlides} />
                    )}
                  </div>

                  {/* Section-level unattached divergence notices */}
                  {sectionUnattachedNotices.length > 0 && (
                    <div className="space-y-2 my-2.5">
                      {sectionUnattachedNotices.map((notice, nIdx) => (
                        <TextbookDivergenceCard key={nIdx} notice={notice} />
                      ))}
                    </div>
                  )}

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
                      <BulletsBlock
                        groundedBullets={section.groundedBullets}
                        bulletPoints={section.bulletPoints}
                      />
                    </>
                  ) : (
                    <>
                      <BulletsBlock
                        groundedBullets={section.groundedBullets}
                        bulletPoints={section.bulletPoints}
                      />
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
                          <BulletsBlock
                            groundedBullets={sub.groundedBullets}
                            bulletPoints={sub.bulletPoints}
                          />
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
                          <ol className="pl-6 space-y-2 list-decimal text-sm sm:text-[15px] text-[#111827]">
                            {section.keyTakeaways.items!.map((item, idx) => (
                              <li key={idx} className="leading-relaxed">
                                <div className="inline-flex flex-wrap items-center gap-1.5 align-middle mr-1.5">
                                  {item.slide && <SlideChip slide={item.slide} />}
                                  <ItemStatusChip
                                    status={item.status}
                                    reviewReason={item.reviewReason}
                                  />
                                </div>
                                <span className="align-middle">
                                  <MathText content={item.point} inline />
                                </span>
                                {item.reviewReason && (item.status === "needs_review" || item.status === "contradicted") && (
                                  <div
                                    className={`text-xs rounded px-2 py-0.5 mt-1 font-sans ${
                                      item.status === "contradicted"
                                        ? "text-rose-800 bg-rose-50/80 border border-rose-200/80"
                                        : "text-amber-800 bg-amber-50/80 border border-amber-200/80"
                                    }`}
                                  >
                                    <span className="font-semibold">Review note: </span>
                                    {item.reviewReason}
                                  </div>
                                )}
                                {item.subBullets && item.subBullets.length > 0 && (
                                  <ul className="pl-6 mt-1 space-y-1 list-disc marker:text-[#111827]">
                                    {item.subBullets.map((sb, sbIdx) => (
                                      <li key={sbIdx} className="leading-relaxed">
                                        {sb.includes("→") && !sb.includes("$") && !sb.includes("\\") ? (
                                          <span>{sb}</span>
                                        ) : (
                                          <MathText content={sb} inline />
                                        )}
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
                                {pt.includes("→") && !pt.includes("$") && !pt.includes("\\") ? (
                                  <span>{pt}</span>
                                ) : (
                                  <MathText content={pt} inline />
                                )}
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

          {/* Dedicated Crisp Boxed Uncaptured Source Formulas Section */}
          {uncapturedFormulas.length > 0 && (
            <section className="mt-10 pt-6 border-t-2 border-dashed border-[#dcded6]">
              <div className="border border-[#cbd5e1] bg-[#f8fafc] rounded-xl p-5 sm:p-6 font-sans">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <h3 className="text-sm sm:text-base font-bold text-[#1e293b] uppercase tracking-wide">
                    Uncaptured Source Formulas
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#e2e8f0] text-[#334155] border border-[#cbd5e1]">
                    {uncapturedFormulas.length}{" "}
                    {uncapturedFormulas.length === 1 ? "Formula Omitted" : "Formulas Omitted"}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-[#475569] leading-relaxed mb-4">
                  The following formulas appeared in the lecture slides (e.g. in practice exercises or appendices) but were omitted from core summary sections.
                </p>

                <div className="space-y-3">
                  {uncapturedFormulas.map((entry) => (
                    <div
                      key={entry.id}
                      className="bg-white border border-[#e2e8f0] rounded-lg p-3.5 sm:p-4 text-xs sm:text-[13px] shadow-2xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 font-sans">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#0f172a] font-mono text-xs px-2 py-0.5 bg-[#f1f5f9] rounded border border-[#cbd5e1]">
                            {entry.id}
                          </span>
                          {entry.label && (
                            <span className="font-semibold text-[#334155]">
                              {entry.label}
                            </span>
                          )}
                        </div>
                        {entry.slide && <SlideChip slide={entry.slide} />}
                      </div>

                      {entry.latex && (
                        <div className="note-formula-wrap my-2.5 flex justify-center py-2 px-3 bg-[#f8fafc] rounded border border-[#e2e8f0] font-serif max-w-full whitespace-normal break-words">
                          <MathText content={`$$${entry.latex}$$`} />
                        </div>
                      )}

                      <div className="text-xs text-[#64748b] mt-1.5 flex items-start gap-1.5">
                        <span className="font-semibold text-[#475569] shrink-0">Reason:</span>
                        <span className="leading-relaxed">{entry.reason}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      </article>
    </div>
  );
}
