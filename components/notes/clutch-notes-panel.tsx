"use client";

import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  UploadCloud,
  Zap,
  AlertCircle,
  FileSpreadsheet,
  Lock,
  ArrowRight,
  RefreshCw,
  Clock,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useUserTier,
  computeProfileQuotaSummary,
} from "@/hooks/use-user-tier";
import { formatQuotaResetCountdown } from "@/lib/pricing/tiers";
import { useAuth } from "@/lib/auth/context";
import { useLanguage } from "@/lib/i18n/context";
import { BeforeAfterModal } from "./before-after-modal";
import { NoteRenderer, notesToMarkdown } from "./note-renderer";
import { PricingModal } from "@/components/pricing/pricing-modal";
import { SAMPLE_CLUTCH_NOTE } from "@/lib/notes/sample-note";
import { optimizeUploadFileIfNeeded } from "@/lib/ingestion/client-compress";
import {
  extractSlidesInBrowser,
  ClientSlideExtractionError,
  type ExtractedSlideDeck,
} from "@/lib/notes/client-extract-slides";
import type { ClutchNote } from "@/lib/schemas/notes";
import type { StudyPack } from "@/lib/schemas/question";
import type { ParsedDocument, SourceBlock } from "@/lib/schemas/ingestion";

function hasCorruptedMath(sources: SourceBlock[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;

  return sources.some((src) => {
    const text = src.text;
    if (!text || text.trim().length === 0) return false;

    // 1. Missing font glyph placeholders or unmapped Private Use Area codepoints
    if (/[\uE000-\uF8FF\uFFFD\u25A0-\u25AF\u25FB-\u25FC]/.test(text)) {
      return true;
    }

    // 2. Dangling equality / assignment without expression (e.g., "WACC = \n", "y = \n")
    if (/(?:^|\n|\r)\s*[A-Za-z0-9_\(\)]+\s*=\s*(?:$|\n|\r)/m.test(text)) {
      return true;
    }

    // 3. Lines ending with dangling binary math operators without right-hand side
    if (/(?:^|\s)[A-Za-z0-9_\)]+\s*(?:[+*/=≤≥≠≈÷×]|−)\s*$/m.test(text)) {
      return true;
    }

    // 4. Broken adjacent conflicting operators (e.g. "+ =", "= /")
    if (/(?:[+\-*/=≤≥≠≈÷×]|−)\s*(?:[=*/≤≥≠≈÷×])/.test(text)) {
      return true;
    }

    return false;
  });
}

export interface ClutchNotesPanelProps {
  onPlayPack?: (pack: StudyPack) => void;
  onPackGenerated?: (
    pack: StudyPack,
    doc: ParsedDocument,
    references?: Record<string, any>,
  ) => void;
  onSwitchToTab?: (tab: "play" | "ingest" | "coach" | "arena" | "notes") => void;
}

export function ClutchNotesPanel({
  onPlayPack,
  onPackGenerated,
  onSwitchToTab,
}: ClutchNotesPanelProps = {}) {
  const { user, session, openAuthModal } = useAuth();
  const {
    tier,
    limits,
    isPaidTier,
    quotaState,
    refreshQuota,
    updateQuotaFromResponse,
  } = useUserTier();
  const { t, language } = useLanguage();
  const isVi = language === "vi";
  const quotaSummary = computeProfileQuotaSummary(tier, quotaState, isVi);

  const [note, setNote] = useState<ClutchNote | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [currentSourceFile, setCurrentSourceFile] = useState<File | null>(null);
  const [noteSources, setNoteSources] = useState<SourceBlock[]>([]);
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [isCreatingQuiz, setIsCreatingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState<{
    resetsAt: string | null;
  } | null>(null);
  const [progressStep, setProgressStep] = useState<string | null>(null);

  // Modals
  const [beforeAfterOpen, setBeforeAfterOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setError(null);
      setQuotaExhausted(null);
      setWarnings([]);
      setQuizError(null);
      if (!acceptedFiles || acceptedFiles.length === 0) return;

      // Guests must sign in first; signed-in Free (Contender) users can synthesize inside rolling % quota
      if (!user) {
        openAuthModal(
          isVi
            ? "Đăng nhập miễn phí để tổng hợp Clutch Notes AI"
            : "Sign in free to synthesize Clutch Notes AI",
        );
        return;
      }

      if (!limits.canUseClutchNotes) {
        setPricingOpen(true);
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
    [user, openAuthModal, isVi, limits.canUseClutchNotes, t.notes],
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

    if (!user) {
      openAuthModal(
        isVi
          ? "Đăng nhập miễn phí để tổng hợp Clutch Notes AI"
          : "Sign in free to synthesize Clutch Notes AI",
      );
      return;
    }

    if (!limits.canUseClutchNotes) {
      setPricingOpen(true);
      return;
    }

    setLoading(true);
    setError(null);
    setQuotaExhausted(null);
    setQuizError(null);
    setWarnings([]);
    setProgressStep(t.notes.step1);
    setCurrentSourceFile(selectedFile);

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
    }, 300_000); // 5 minutes matching serverless maxDuration

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

      // Check if client-extracted PDF slides exhibit corrupted math or heavy PUA substitutions
      const isPdf = selectedFile.name.toLowerCase().endsWith(".pdf");
      if (
        !useMultipartFallback &&
        extracted &&
        isPdf &&
        hasCorruptedMath(extracted.sources)
      ) {
        console.warn(
          "[ClutchNotes] Unreadable/corrupted math streams or PUA substitutions detected in client-extracted PDF. Preferring server multipart upload for high-fidelity OCR.",
        );
        useMultipartFallback = true;
      }

      const effectiveTier = tier && tier !== "contender" ? tier : "contender";
      const headers: Record<string, string> = {};
      if (process.env.NODE_ENV !== "production") {
        headers["x-test-tier"] = effectiveTier;
      }

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
          ...(extracted.fileSha256 ? { fileSha256: extracted.fileSha256 } : {}),
        });
      } else {
        let uploadFile = selectedFile;
        if (uploadFile.size > 4.5 * 1024 * 1024) {
          try {
            const result = await optimizeUploadFileIfNeeded(uploadFile);
            uploadFile = result.file;
          } catch {
            // Keep original file if optimization is not possible
          }
        }
        const formData = new FormData();
        formData.append("file", uploadFile);
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

      if (data?.quota) {
        updateQuotaFromResponse(data.quota);
      } else if (res.ok || res.status === 429) {
        void refreshQuota();
      }

      if (!res.ok || !data || !data.ok) {
        if (res.status === 413) {
          throw new Error(t.notes.errPayloadTooLarge);
        }
        if (res.status === 504) {
          throw new Error(t.notes.errGatewayTimeout);
        }
        if (res.status === 401) {
          openAuthModal(
            isVi
              ? "Vui lòng đăng nhập để sử dụng Clutch Notes AI"
              : "Please sign in to access Clutch Notes AI",
          );
          throw new Error(
            data?.error?.message ||
              (isVi
                ? "Vui lòng đăng nhập để sử dụng Clutch Notes AI."
                : "Please sign in to access Clutch Notes AI."),
          );
        }
        if (res.status === 403) {
          setPricingOpen(true);
          throw new Error(
            data?.error?.message || t.notes.errSubscriptionRequired,
          );
        }
        if (res.status === 429) {
          const retryAfterSeconds =
            typeof data?.error?.retryAfter === "number" &&
            data.error.retryAfter > 0
              ? data.error.retryAfter
              : null;
          const fallbackResetsAt = retryAfterSeconds
            ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString()
            : null;
          const resetsAt =
            data?.quota?.resetsAt ?? quotaState?.resetsAt ?? fallbackResetsAt;
          setQuotaExhausted({ resetsAt });
          throw new Error(
            data?.error?.message ||
              (isVi
                ? "Hạn mức AI trong chu kỳ luân phiên đã tạm hết. Vui lòng chờ đặt lại hoặc nâng cấp gói."
                : "AI quota reached for this rolling window. Please wait for reset or upgrade your plan."),
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
      if (Array.isArray(data.sources) && data.sources.length > 0) {
        setNoteSources(data.sources);
      } else if (extracted?.sources) {
        setNoteSources(extracted.sources);
      } else {
        setNoteSources([]);
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setWarnings(data.warnings);
      } else {
        setWarnings([]);
      }
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

  const handleCreateQuizDeck = async (questionCount = 15) => {
    if (!note || isCreatingQuiz) return;
    setIsCreatingQuiz(true);
    setQuizError(null);

    try {
      let fileToUpload: File | null = currentSourceFile;

      // Handle files exceeding Vercel's 4.5MB multipart payload limit
      if (fileToUpload && fileToUpload.size > 4.2 * 1024 * 1024) {
        try {
          const { file: optimized } = await optimizeUploadFileIfNeeded(fileToUpload);
          fileToUpload = optimized;
        } catch {
          // keep original for threshold check below
        }
      }

      // Fallback to already-extracted text sources or note markdown if no compact binary file is available
      if (!fileToUpload || fileToUpload.size > 4.2 * 1024 * 1024) {
        const safeBaseName = (note.title || "Clutch_Note")
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 60);
        const textContent =
          noteSources.length > 0
            ? noteSources
                .map((s, idx) => {
                  const match = s.label.match(/(?:Slide|Page)\s+(\d+)/i);
                  const slideNum = match ? match[1] : String(idx + 1);
                  return `--- Slide ${slideNum} ---\n${s.text}`;
                })
                .join("\n\n")
            : notesToMarkdown(note, t.notes) || note.rawMarkdown || note.title;
        fileToUpload = new File([textContent], `${safeBaseName}.txt`, {
          type: "text/plain",
        });
      }

      const options = {
        operation: "generate",
        questionCount: Math.min(Math.max(questionCount, 5), 30),
        mode: "variants",
        language: language === "vi" ? "vi" : "en",
        focus: focus.trim(),
      };

      const formData = new FormData();
      formData.set("file", fileToUpload);
      formData.set("options", JSON.stringify(options));

      const headers: Record<string, string> = {};
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
      const effectiveTier = tier && tier !== "contender" ? tier : "contender";
      if (process.env.NODE_ENV !== "production" && effectiveTier !== "contender") {
        headers["x-test-tier"] = effectiveTier;
      }

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers,
        body: formData,
      });

      let data: any = null;
      try {
        const rawText = await res.text();
        data = JSON.parse(rawText);
      } catch {
        // non-JSON response
      }

      if (data?.quota) {
        updateQuotaFromResponse(data.quota);
      } else if (res.ok || res.status === 429) {
        void refreshQuota();
      }

      if (!res.ok || !data || !data.ok) {
        if (res.status === 413) {
          throw new Error(t.notes.errPayloadTooLarge);
        }
        if (res.status === 504) {
          throw new Error(t.notes.errGatewayTimeout);
        }
        throw new Error(data?.error?.message || t.upload.genericIngestError);
      }

      if (onPackGenerated && data.pack && data.document) {
        onPackGenerated(data.pack, data.document, data.references);
      }
      if (onPlayPack && data.pack) {
        onPlayPack(data.pack);
      } else if (onSwitchToTab) {
        onSwitchToTab("play");
      }
    } catch (err: any) {
      setQuizError(
        err?.message ||
          (language === "vi"
            ? "Không thể tạo bộ đề trắc nghiệm. Vui lòng thử lại."
            : "Failed to create quiz deck. Please try again."),
      );
    } finally {
      setIsCreatingQuiz(false);
    }
  };

  const handleLoadSample = () => {
    setNote(SAMPLE_CLUTCH_NOTE);
    setCurrentSourceFile(null);
    setNoteSources([]);
    setError(null);
    setQuotaExhausted(null);
    setQuizError(null);
    setWarnings([]);
  };

  const handleUpgradeFromModal = () => {
    setPricingOpen(true);
  };

  const quotaToneClasses =
    quotaSummary.statusTone === "healthy"
      ? "bg-[#edf5e8] border-[#cde0c3] text-[#2e6320]"
      : quotaSummary.statusTone === "caution"
        ? "bg-[#fffbeb] border-[#fde68a] text-[#b45309]"
        : "bg-[#fef2f2] border-red-200 text-red-700";

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
        {quizError && (
          <div
            role="alert"
            className="bg-[#fef2f2] border border-red-200 rounded-xl p-3.5 flex items-start gap-3 text-red-800 text-xs animate-in fade-in"
          >
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{quizError}</div>
          </div>
        )}
        <NoteRenderer
          note={note}
          onReset={() => {
            setNote(null);
            setCurrentSourceFile(null);
            setNoteSources([]);
            setWarnings([]);
            setQuotaExhausted(null);
            setQuizError(null);
          }}
          onCreateQuiz={handleCreateQuizDeck}
          isCreatingQuiz={isCreatingQuiz}
          canExportPdf={limits.canExportCheatSheet}
          onUpgradeClick={() => setPricingOpen(true)}
        />
        <PricingModal
          open={pricingOpen}
          onClose={() => setPricingOpen(false)}
          initialReason={t.notes.pricingInitialReason}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300 pb-16">
      {/* Header Introduction Card */}
      <div className="bg-white border border-[#e2e6db] rounded-2xl p-6 sm:p-7 shadow-sm relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          {isPaidTier ? (
            <span className="badge-pro">{quotaSummary.tierLabel}</span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#f3f5ee] border border-[#dce1d5] text-[#424c3a] text-[11px] font-bold uppercase tracking-wider">
              {quotaSummary.tierLabel}
            </span>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${quotaToneClasses}`}
              title={quotaSummary.quotaLabel}
            >
              <Zap size={13} />
              <span>
                {quotaSummary.remainingPct}% {isVi ? "hạn mức AI" : "AI quota"}
              </span>
            </div>

            {quotaSummary.resetCountdown && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f7f8f4] border border-[#e2e6db] text-[11px] font-medium text-[#5a6452]">
                <Clock size={12} className="text-[#b83811]" />
                <span>{quotaSummary.resetCountdown}</span>
              </span>
            )}

            {quotaSummary.isDegraded && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#fffbeb] border border-[#fde68a] text-[11px] font-bold text-[#b45309]">
                <Sparkles size={12} />
                <span>
                  {quotaState?.mode === "cached_only" ||
                  quotaState?.mode === "halted"
                    ? isVi
                      ? "Chỉ bộ nhớ đệm"
                      : "Cached Only"
                    : isVi
                      ? "Chế độ Eco"
                      : "Eco Mode"}
                </span>
              </span>
            )}
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1a2118] tracking-tight mb-2">
          {t.notes.title}
        </h1>
        <p className="text-xs sm:text-sm text-[#67705f] max-w-2xl leading-relaxed">
          {t.notes.subtitle}
        </p>

        {user && !isPaidTier && (
          <div className="mt-4 pt-3.5 border-t border-[#ebeee5] flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-[#5a6452]">
              {isVi
                ? "Gói Miễn phí: tổng hợp ghi chú tóm tắt 1 phần cô đọng trong hạn mức AI luân phiên. Nâng cấp để mở khóa đầy đủ nhiều phần & xuất PDF."
                : "Free Contender: synthesize a concise 1-section study note inside your rolling AI quota. Upgrade for full multi-section notes & PDF export."}
            </span>
            <button
              type="button"
              onClick={() => setPricingOpen(true)}
              className="inline-flex items-center gap-1 font-bold text-[#b83811] hover:text-[#9e2e0a] cursor-pointer shrink-0"
            >
              <span>{isVi ? "Nâng cấp Pro" : "Upgrade to Pro"}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        )}
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

        {/* Dropzone */}
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

          {/* Tier / Access Badge on Dropzone */}
          <div className="absolute top-3.5 right-3.5 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#fef3c7] border border-[#fde68a] text-[#b45309] text-[11px] font-black tracking-wider uppercase">
            <Zap size={12} className="text-[#b45309]" />
            <span>
              {!user
                ? isVi
                  ? "ĐĂNG NHẬP MIỄN PHÍ"
                  : "FREE SIGN-IN"
                : !isPaidTier
                  ? isVi
                    ? "MIỄN PHÍ · 1 PHẦN"
                    : "FREE · 1-SECTION"
                  : quotaSummary.tierLabel}
            </span>
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

          {!user && (
            <div className="mt-4 pt-3.5 border-t border-[#ebeee5] flex items-center justify-center gap-1.5 text-xs text-[#b45309] font-medium">
              <Lock size={13} className="text-[#b45309]" />
              <span>
                {isVi
                  ? "Đăng nhập miễn phí để tổng hợp Clutch Notes AI trong hạn mức luân phiên"
                  : "Sign in free to synthesize Clutch Notes AI inside your rolling quota"}
              </span>
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

        {/* Error / Quota Exhaustion notice */}
        {error && (
          <div
            role="alert"
            className="bg-[#fef2f2] border border-red-200 rounded-xl p-3.5 space-y-2.5 text-red-800 text-xs"
          >
            <div className="flex items-start gap-3">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
            {quotaExhausted && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-red-200/80 pl-7">
                <div className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                  <Clock size={13} />
                  <span>
                    {formatQuotaResetCountdown(
                      quotaExhausted.resetsAt ?? quotaState?.resetsAt,
                      isVi,
                    ) ||
                      quotaSummary.resetCountdown ||
                      (isVi
                        ? "Đang chờ làm mới chu kỳ"
                        : "Rolling window reset pending")}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setPricingOpen(true)}
                  className="bg-[#b83811] hover:bg-[#9e2e0a] text-white text-xs font-bold rounded-lg px-3 py-1.5 h-auto cursor-pointer"
                >
                  <Zap size={12} className="mr-1" />
                  <span>{isVi ? "Nâng cấp gói" : "Upgrade Plan"}</span>
                </Button>
              </div>
            )}
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
            <BookOpen size={14} className="text-[#e96b44]" />
            <span>{t.notes.loadSampleBtn}</span>
          </Button>

          <Button
            onClick={handleGenerate}
            disabled={loading || !selectedFile}
            className={`w-full sm:w-auto px-6 py-2.5 text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs ${
              selectedFile && !loading
                ? "bg-[#b83811] hover:bg-[#9e2e0a] text-white shadow-xs"
                : "bg-[#e8ece2] text-[#555f4c] cursor-not-allowed border border-[#dce0d5]"
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
