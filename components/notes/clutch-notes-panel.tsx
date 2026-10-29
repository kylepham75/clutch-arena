"use client";

import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  FileText,
  UploadCloud,
  Sparkles,
  Zap,
  ShieldCheck,
  Printer,
  Layers,
  AlertCircle,
  FileSpreadsheet,
  Lock,
  ArrowRight,
  RefreshCw,
  Clock,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserTier } from "@/hooks/use-user-tier";
import { useAuth } from "@/lib/auth/context";
import { useLanguage } from "@/lib/i18n/context";
import { BeforeAfterModal } from "./before-after-modal";
import { NoteRenderer } from "./note-renderer";
import { PricingModal } from "@/components/pricing/pricing-modal";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import {
  extractSlidesInBrowser,
  ClientSlideExtractionError,
  type ExtractedSlideDeck,
} from "@/lib/notes/client-extract-slides";
import type { ClutchNote } from "@/lib/schemas/notes";

export function ClutchNotesPanel() {
  const { user, session } = useAuth();
  const { tier, isPaidTier, isCramPassOrAbove, isProOrAbove, setTier } = useUserTier();
  const { t, language } = useLanguage();

  const [note, setNote] = useState<ClutchNote | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [dailyUsage, setDailyUsage] = useState<number>(0);

  // Modals
  const [beforeAfterOpen, setBeforeAfterOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  // Normalize paid tier check (available to 7-Day Cram Pass, Pro Semester, and Tutor tiers)
  const userAppTier = (user?.app_metadata?.tier as string)?.toUpperCase();
  const userMetaTier = (user?.user_metadata?.tier as string)?.toUpperCase();
  const hasNotesAccess =
    isPaidTier ||
    isCramPassOrAbove ||
    isProOrAbove ||
    tier === "cram_pass" ||
    tier === "pro" ||
    tier === "tutor" ||
    userAppTier === "PRO" ||
    userAppTier === "CRAM_PASS" ||
    userAppTier === "TUTOR" ||
    userMetaTier === "PRO" ||
    userMetaTier === "CRAM_PASS" ||
    userMetaTier === "TUTOR";

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setError(null);
      setWarnings([]);
      if (!acceptedFiles || acceptedFiles.length === 0) return;

      // Free Tier Gate: trigger Before/After modal if not on a paid tier
      if (!hasNotesAccess) {
        setBeforeAfterOpen(true);
        return;
      }

      const file = acceptedFiles[0];
      const ext = file.name.split(".").at(-1)?.toLowerCase();

      if (ext !== "pdf" && ext !== "pptx") {
        setError(t.notes.errInvalidFileType);
        return;
      }

      if (file.size > 25 * 1024 * 1024) {
        setError(
          `${t.notes.errFileTooLargePrefix}${(file.size / (1024 * 1024)).toFixed(1)}${t.notes.errFileTooLargeSuffix}`,
        );
        return;
      }

      setSelectedFile(file);
    },
    [hasNotesAccess, t.notes],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
    },
    maxFiles: 1,
    multiple: false,
  });

  const handleGenerate = async () => {
    if (!selectedFile) return;

    if (!hasNotesAccess) {
      setBeforeAfterOpen(true);
      return;
    }

    setLoading(true);
    setError(null);
    setWarnings([]);
    setProgressStep(t.notes.step1);

    const progressTimers = [
      setTimeout(() => {
        setProgressStep(t.notes.step2);
      }, 800),
      setTimeout(() => {
        setProgressStep(t.notes.step3);
      }, 3500),
      setTimeout(() => {
        setProgressStep(t.notes.step4);
      }, 9000),
      setTimeout(() => {
        setProgressStep(t.notes.step5);
      }, 18_000),
      setTimeout(() => {
        setProgressStep(t.notes.step6);
      }, 35_000),
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 120_000); // 2 minutes matching serverless maxDuration

    try {
      let extracted: ExtractedSlideDeck | null = null;
      let useMultipartFallback = false;

      try {
        extracted = await extractSlidesInBrowser(selectedFile, controller.signal);
      } catch (err: any) {
        if (
          err instanceof ClientSlideExtractionError ||
          err?.isUserActionable === true ||
          err?.name === "AbortError"
        ) {
          throw err;
        }

        // Only fall back to multipart if file size is within 4.5MB server limit
        if (selectedFile.size <= 4.5 * 1024 * 1024) {
          console.warn(
            "[ClutchNotes] Client extraction encountered non-actionable error, falling back to server multipart ingestion:",
            err,
          );
          useMultipartFallback = true;
        } else {
          throw new Error(
            `${t.notes.errLocalExtractionFailedPrefix} (${err?.message || "unknown error"}), ${t.notes.errLocalExtractionFailedSuffix}`,
          );
        }
      }

      const effectiveTier = tier && tier !== "contender" ? tier : "contender";
      const headers: Record<string, string> = {
        "x-test-tier": effectiveTier,
      };

      let token = session?.access_token;
      if (!token) {
        try {
          const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            token = data.session?.access_token;
          }
        } catch {
          // ignore
        }
      }

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      let requestBody: BodyInit;
      if (!useMultipartFallback && extracted) {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify({
          fileName: extracted.fileName,
          slideCount: extracted.slideCount,
          sources: extracted.sources,
          warnings: extracted.warnings,
          focus: focus.trim() || undefined,
        });
      } else {
        const formData = new FormData();
        formData.append("file", selectedFile);
        if (focus.trim()) {
          formData.append("focus", focus.trim());
        }
        requestBody = formData;
      }

      const res = await fetch("/api/notes/generate", {
        method: "POST",
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      let data: any = null;
      let rawText = "";
      try {
        rawText = await res.text();
        data = JSON.parse(rawText);
      } catch {
        // Response is not JSON (e.g. Vercel 504 / 413 proxy page)
      }

      if (!res.ok || !data || !data.ok) {
        if (res.status === 413) {
          throw new Error(t.notes.errPayloadTooLarge);
        }
        if (res.status === 504) {
          throw new Error(t.notes.errGatewayTimeout);
        }
        if (res.status === 403) {
          setBeforeAfterOpen(true);
          throw new Error(
            data?.error?.message || t.notes.errSubscriptionRequired,
          );
        }
        if (res.status === 429) {
          throw new Error(
            data?.error?.message || t.notes.errDailyQuotaReached,
          );
        }
        const serverMsg =
          data?.error?.message ||
          (res.statusText
            ? `Server error (${res.status}): ${res.statusText}`
            : t.notes.errServerGeneric);
        throw new Error(serverMsg);
      }

      setNote(data.note);
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setWarnings(data.warnings);
      } else {
        setWarnings([]);
      }
      setDailyUsage((prev) => prev + 1);
      setSelectedFile(null);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError(t.notes.errTimeoutClient);
      } else if (
        err.message?.includes("Failed to fetch") ||
        err.message?.includes("NetworkError") ||
        err.name === "TypeError"
      ) {
        setError(t.notes.errNetwork);
      } else {
        setError(err.message || t.notes.errUnexpected);
      }
    } finally {
      clearTimeout(timeoutId);
      progressTimers.forEach(clearTimeout);
      setLoading(false);
      setProgressStep(null);
    }
  };

  const handleLoadSample = () => {
    setNote(SAMPLE_CLUTCH_NOTE);
    setError(null);
    setWarnings([]);
  };

  const handleUpgradeFromModal = () => {
    setPricingOpen(true);
  };

  // If a note has been generated, render the high-retention note view
  if (note) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-4">
        {warnings && warnings.length > 0 && (
          <div
            role="alert"
            className="bg-[#fffbeb] border border-[#fde68a] rounded-2xl p-4 sm:p-5 text-[#92400e] shadow-xs space-y-2.5 animate-in fade-in duration-200"
          >
            <div className="flex items-center gap-2 font-bold text-sm sm:text-base text-[#b45309]">
              <AlertCircle size={18} className="text-[#d97706] flex-shrink-0" />
              <span>{t.notes.someSlidesUnread}</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm text-[#92400e] pl-1">
              {warnings.map((warn, index) => (
                <li key={index} className="leading-relaxed">
                  {warn}
                </li>
              ))}
            </ul>
            <p className="text-xs sm:text-sm text-[#b45309] font-medium pt-2 border-t border-[#fde68a]">
              {t.notes.unreadFormulasNote}
            </p>
          </div>
        )}
        <NoteRenderer
          note={note}
          onReset={() => {
            setNote(null);
            setWarnings([]);
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300 pb-16">
      {/* Header Introduction Card */}
      <div className="bg-white border border-[#e2e6db] rounded-2xl p-6 sm:p-7 shadow-sm relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#fff4ec] border border-[#fbd8c8] text-[#d9532f] text-xs font-bold uppercase tracking-wider">
            <Sparkles size={14} className="text-[#e96b44]" />
            <span>{t.notes.badge}</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-[#e96b44] text-white text-[10px] font-black">
              {t.notes.tierBadge}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-[#737c6b]">
            <Clock size={14} className="text-[#e96b44]" />
            <span>
              {t.notes.dailyQuota} <strong className="text-[#1f261c]">{30 - dailyUsage}</strong>/30 {t.notes.remaining}
            </span>
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1a2118] tracking-tight mb-2">
          {t.notes.title}
        </h1>
        <p className="text-xs sm:text-sm text-[#67705f] max-w-2xl leading-relaxed">
          {t.notes.subtitle}
        </p>
      </div>

      {/* Upload Dropzone Container */}
      <div className="bg-white border border-[#e2e6db] rounded-2xl p-6 sm:p-7 space-y-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-[#1e251a] flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#fbede5] text-[#e46d47] flex items-center justify-center">
              <FileSpreadsheet size={16} />
            </div>
            <span>{t.notes.uploadHeader}</span>
          </div>
          <span className="text-xs text-[#7e8777] font-medium">{t.notes.fileLimitNote}</span>
        </div>

        {/* Dropzone with PRO badge */}
        <div
          {...getRootProps()}
          className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-all cursor-pointer select-none ${
            isDragActive
              ? "border-[#e96943] bg-[#fff8f4]"
              : selectedFile
                ? "border-[#8fa578] bg-[#f6f9f3]"
                : "border-[#d8ded0] bg-[#fafbf8] hover:border-[#e96943] hover:bg-[#fff9f6]"
          }`}
        >
          <input {...getInputProps()} />

          {/* Premium Tier Badge on Dropzone */}
          <div className="absolute top-3.5 right-3.5 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#fef3c7] border border-[#fde68a] text-[#b45309] text-[11px] font-black tracking-wider uppercase">
            <Sparkles size={12} className="text-[#b45309]" />
            <span>{t.notes.paidTiersBadge}</span>
          </div>

          <div className="w-14 h-14 mx-auto rounded-xl bg-[#fbede5] text-[#e46d47] flex items-center justify-center mb-3.5 shadow-xs">
            <UploadCloud size={28} />
          </div>

          {selectedFile ? (
            <div className="space-y-1">
              <div className="text-base font-bold text-[#1f271a]">{selectedFile.name}</div>
              <div className="text-xs font-semibold text-[#2e6320]">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · {t.notes.readyToSynthesize}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 max-w-md mx-auto">
              <div className="text-sm font-bold text-[#1f261b]">
                {t.notes.dropTitle}
              </div>
              <p className="text-xs text-[#788270] leading-relaxed">
                {t.notes.dropDesc}
              </p>
            </div>
          )}

          {!hasNotesAccess && (
            <div className="mt-4 pt-3.5 border-t border-[#ebeee5] flex items-center justify-center gap-1.5 text-xs text-[#b45309] font-medium">
              <Lock size={13} className="text-[#b45309]" />
              <span>{t.notes.lockedNotice}</span>
            </div>
          )}
        </div>

        {/* Optional Study Focus Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#5a6452]">
            {t.notes.focusLabel}
          </label>
          <input
            type="text"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder={t.notes.focusPlaceholder}
            className="w-full px-4 py-2.5 bg-[#fafbf8] border border-[#dce1d5] rounded-xl text-xs sm:text-sm text-[#1f261b] placeholder-[#959d8e] focus:outline-none focus:border-[#e96943] focus:bg-white transition-colors"
          />
        </div>

        {/* Error notice */}
        {error && (
          <div className="bg-[#fef2f2] border border-red-200 rounded-xl p-3.5 flex items-start gap-3 text-red-800 text-xs">
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{error}</div>
          </div>
        )}

        {/* Progress State */}
        {loading && (
          <div className="bg-[#fafbf8] border border-[#dce2d4] rounded-xl p-4 text-center space-y-2.5">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-[#c8532f]">
              <RefreshCw size={14} className="animate-spin text-[#e96b44]" />
              <span>{progressStep || t.notes.synthesizingDefault}</span>
            </div>
            <div className="w-full bg-[#ebeee5] rounded-full h-1.5 overflow-hidden">
              <div className="bg-gradient-to-r from-[#e96b44] to-[#f59e0b] h-full w-2/3 animate-pulse" />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            onClick={handleLoadSample}
            disabled={loading}
            className="w-full sm:w-auto border-[#dce1d5] bg-white hover:bg-[#f7f8f4] text-[#424c3a] text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-2xs"
          >
            <Sparkles size={14} className="text-[#e96b44]" />
            <span>{t.notes.loadSampleBtn}</span>
          </Button>

          <Button
            onClick={handleGenerate}
            disabled={loading || !selectedFile}
            className={`w-full sm:w-auto px-6 py-2.5 text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs ${
              selectedFile && !loading
                ? "bg-[#e96b44] hover:bg-[#d95e37] text-white shadow-sm hover:scale-[1.01]"
                : "bg-[#e8ece2] text-[#939c8c] cursor-not-allowed border border-[#dce0d5]"
            }`}
          >
            <Zap size={15} />
            <span>{t.notes.synthesizeBtn}</span>
            <ArrowRight size={15} />
          </Button>
        </div>
      </div>

      {/* Before / After Preview Card CTA */}
      <div className="bg-[#fafbf8] border border-[#e2e6db] rounded-2xl p-6 sm:p-7 flex flex-col md:flex-row items-center justify-between gap-5 shadow-2xs">
        <div className="space-y-1.5 text-center md:text-left">
          <div className="text-xs font-bold uppercase tracking-wider text-[#e46d47] flex items-center justify-center md:justify-start gap-1.5">
            <Sparkles size={14} />
            <span>{t.notes.showcaseEyebrow}</span>
          </div>
          <h3 className="text-base sm:text-lg font-extrabold text-[#1f261b]">
            {t.notes.showcaseTitle}
          </h3>
          <p className="text-xs text-[#6e7766] max-w-lg leading-relaxed">
            {t.notes.showcaseDesc}
          </p>
        </div>

        <Button
          onClick={() => setBeforeAfterOpen(true)}
          className="w-full md:w-auto px-5 py-2.5 bg-white hover:bg-[#f5f6f1] border border-[#d6dbcf] hover:border-[#c3cbb8] text-[#2c3525] text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-2xs"
        >
          <span>{t.notes.showcaseBtn}</span>
          <ArrowRight size={14} />
        </Button>
      </div>

      {/* Before / After Modal */}
      <BeforeAfterModal
        open={beforeAfterOpen}
        onClose={() => setBeforeAfterOpen(false)}
        onUpgradeClick={handleUpgradeFromModal}
        onLoadSampleClick={handleLoadSample}
      />

      {/* Pricing / Upgrade Modal */}
      <PricingModal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        initialReason={t.notes.pricingInitialReason}
      />
    </div>
  );
}
