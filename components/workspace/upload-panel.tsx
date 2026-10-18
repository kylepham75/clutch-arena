"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import {
  UploadCloud,
  FileText,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Play,
  RotateCcw,
  Sliders,
  X,
  FileCheck,
  Users,
} from "lucide-react";
import type {
  IngestionOptions,
  ParsedDocument,
  GenerationResult,
} from "@/lib/schemas/ingestion";
import type { StudyPack } from "@/lib/schemas/question";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { useUserTier } from "@/hooks/use-user-tier";
import { PricingModal } from "@/components/pricing/pricing-modal";
import { formatRejectionError } from "@/lib/utils/format-upload-error";

export function UploadPanel({
  onPackGenerated,
  onDocumentPreviewed,
  onPlayPack,
  onHostArena,
}: {
  onPackGenerated: (
    pack: StudyPack,
    doc: ParsedDocument,
    references?: GenerationResult["references"],
  ) => void;
  onDocumentPreviewed: (doc: ParsedDocument) => void;
  onPlayPack: (pack: StudyPack) => void;
  onHostArena?: (pack: StudyPack) => void;
}) {
  const { language: siteLang, t } = useLanguage();
  const { session, user, canGenerate, openAuthModal, incrementGuestUsage } = useAuth();
  const { tier, limits } = useUserTier();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingReason, setPricingReason] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [operation, setOperation] = useState<"generate" | "preview">("generate");
  const [questionCount, setQuestionCount] = useState(5);
  const [mode, setMode] = useState<"variants" | "exact">("variants");
  const [language, setLanguage] = useState<"en" | "vi">(siteLang);

  useEffect(() => {
    setLanguage(siteLang);
  }, [siteLang]);
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [previewResult, setPreviewResult] = useState<ParsedDocument | null>(null);
  const [generatedResult, setGeneratedResult] = useState<GenerationResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFiles((prev) => {
        const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
        const fresh = acceptedFiles.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));
        const updated = [...prev, ...fresh].slice(0, 10);
        const combinedBytes = updated.reduce((sum, f) => sum + f.size, 0);
        if (combinedBytes > 25 * 1024 * 1024) {
          setError({
            code: "TOO_LARGE",
            message: "Combined files exceed 25 MB limit. Please select fewer or smaller files.",
          });
        } else {
          setError(null);
        }
        return updated;
      });
      setPreviewResult(null);
      setGeneratedResult(null);
    }
  }, []);

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => {
      const remaining = prev.filter((_, i) => i !== index);
      const remainingBytes = remaining.reduce((sum, f) => sum + f.size, 0);
      if (remainingBytes <= 25 * 1024 * 1024) {
        setError((prevErr) => (prevErr?.code === "TOO_LARGE" ? null : prevErr));
      }
      return remaining;
    });
    setPreviewResult(null);
    setGeneratedResult(null);
  };

  const handleClearAll = () => {
    setFiles([]);
    setError(null);
    setPreviewResult(null);
    setGeneratedResult(null);
  };

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    maxFiles: 10,
    multiple: true,
    maxSize: 25 * 1024 * 1024,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
    },
  });

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
      setProgressMsg("");
    }
  };

  const handleSubmit = async (overrideOperation?: "generate" | "preview") => {
    if (files.length === 0) {
      setError({ code: "NO_FILE", message: "Please select at least one file to upload." });
      return;
    }

    if (totalBytes > 25 * 1024 * 1024) {
      setError({
        code: "TOO_LARGE",
        message: "Combined files exceed 25 MB limit. Please select fewer or smaller files.",
      });
      return;
    }

    if (files.length > limits.maxFilesPerUpload) {
      setPricingReason(
        siteLang === "vi"
          ? "Tổng hợp đa tài liệu cùng lúc (tối đa 10 tệp / 25MB) yêu cầu Vé Ôn Thi Cấp Tốc (Cram Pass) hoặc Clutch Pro. Gói Contender miễn phí hỗ trợ 1 tệp mỗi lần tải."
          : "Multi-document synthesis (up to 10 files / 25MB) requires a 7-Day Cram Pass or Clutch Pro. Free Contender includes 1 file per upload.",
      );
      setPricingOpen(true);
      return;
    }

    const op = overrideOperation || operation;

    if (op === "generate" && !canGenerate) {
      openAuthModal("guest_limit_reached");
      setError({
        code: "AUTH_REQUIRED",
        message: "Free guest limit reached (2/2). Please sign in or create an account to generate custom study packs.",
      });
      return;
    }

    setLoading(true);
    setError(null);
    const startTime = Date.now();
    setProgressMsg(
      op === "preview"
        ? `Extracting structure across ${files.length} document${files.length > 1 ? "s" : ""}...`
        : `Reading and analyzing ${files.length} document${files.length > 1 ? "s" : ""}...`,
    );

    const progressInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (op === "preview") {
        setProgressMsg(
          `Extracting text blocks across ${files.length} document${files.length > 1 ? "s" : ""} (${elapsed}s)...`,
        );
      } else {
        if (elapsed < 6) {
          setProgressMsg(
            `Reading & parsing ${files.length} document${files.length > 1 ? "s" : ""} (${elapsed}s)...`,
          );
        } else if (elapsed < 16) {
          setProgressMsg(
            `Synthesizing key topics & learning objectives (${elapsed}s)...`,
          );
        } else if (elapsed < 30) {
          setProgressMsg(
            `Formulating active-recall questions & variants (${elapsed}s)...`,
          );
        } else {
          setProgressMsg(
            `Verifying source citations and finalizing study pack (${elapsed}s)...`,
          );
        }
      }
    }, 1500);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const options: IngestionOptions = {
        operation: op,
        mode,
        questionCount,
        language,
        focus: focus.trim(),
        multiFile: files.length > 1,
      };

      const formData = new FormData();
      if (files.length === 1) {
        formData.set("file", files[0]);
      } else {
        files.forEach((f) => formData.append("files", f));
      }
      formData.set("options", JSON.stringify(options));

      const endpoint = files.length > 1 ? "/api/ingest/multi" : "/api/ingest";

      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        const customErr: any = new Error(data?.error?.message || "Ingestion request failed.");
        customErr.code = data?.error?.code;
        throw customErr;
      }

      if (op === "preview") {
        setPreviewResult(data.document);
        onDocumentPreviewed(data.document);
      } else {
        if (!user) {
          incrementGuestUsage();
        }
        setGeneratedResult(data);
        onPackGenerated(data.pack, data.document, data.references);
      }
    } catch (err: any) {
      if (err.code === "AUTH_REQUIRED") {
        openAuthModal("auth_required");
      }
      if (err.name === "AbortError") {
        setError({ code: "CANCELLED", message: "Upload was cancelled." });
      } else {
        setError({
          code: err.code || "INGEST_ERROR",
          message: err.message || "Something went wrong while processing the document.",
        });
      }
    } finally {
      clearInterval(progressInterval);
      setLoading(false);
      setProgressMsg("");
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="upload-panel surface" aria-label="Document ingestion">
      <div className="section-top flex items-start justify-between flex-wrap gap-2">
        <div className="flex items-start gap-3">
          <div className="section-icon">
            <UploadCloud size={20} />
          </div>
          <div>
            <h2>{t.upload.title}</h2>
            <p>{t.upload.desc}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setPricingReason(null);
            setPricingOpen(true);
          }}
          className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1 cursor-pointer"
        >
          <span>{tier === "contender" ? "Contender: 2 uploads/wk (1 file)" : `${tier.toUpperCase()}: Unlimited (10 files)`}</span>
        </button>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? "dropzone-active" : ""} ${files.length > 0 ? "dropzone-has-file" : ""}`}
      >
        <input {...getInputProps()} aria-label="Upload document file" />
        <div className="dropzone-content">
          <div className="dropzone-icon">
            {files.length > 0 ? <FileCheck size={28} /> : <UploadCloud size={28} />}
          </div>
          {files.length > 0 ? (
            <div className="dropzone-selected">
              <strong>{files.length} {files.length === 1 ? t.upload.docSelectedSingle : t.upload.docSelectedPlural}</strong>
              <span>
                {files.length < 10
                  ? `${t.upload.addMoreFiles} (${files.length}/10 · ${totalBytes >= 1024 * 1024 ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB` : `${(totalBytes / 1024).toFixed(0)} KB`})`
                  : `${t.upload.maxFilesAttached} (${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`}
              </span>
            </div>
          ) : (
            <div>
              <strong>{t.upload.dropIdle}</strong>
              <span>{t.upload.dropSubtitle}</span>
            </div>
          )}
        </div>
      </div>

      {/* Selected Files List */}
      {files.length > 0 && (
        <div className="selected-files-container">
          <div className="selected-files-header">
            <span className="selected-files-title">
              {t.upload.attachedFiles} ({files.length}/10)
            </span>
            <div className="selected-files-meta">
              <span className="selected-files-size">
                {totalBytes > 1024 * 1024
                  ? `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
                  : `${(totalBytes / 1024).toFixed(1)} KB`}
              </span>
              <button
                type="button"
                className="clear-all-btn"
                onClick={handleClearAll}
                title={t.upload.clearAll}
              >
                {t.upload.clearAll}
              </button>
            </div>
          </div>

          <div className="selected-files-list">
            {files.map((f, idx) => {
              const ext = f.name.split(".").pop()?.toUpperCase() || "FILE";
              return (
                <div key={`${f.name}-${f.size}-${idx}`} className="file-chip">
                  <span className={`file-badge file-badge-${ext.toLowerCase()}`}>
                    {ext}
                  </span>
                  <span className="file-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="file-size">
                    {f.size >= 1024 * 1024
                      ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
                      : `${(f.size / 1024).toFixed(0)} KB`}
                  </span>
                  <button
                    type="button"
                    className="file-remove-btn"
                    onClick={() => handleRemoveFile(idx)}
                    aria-label={`Remove ${f.name}`}
                    title="Remove file"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          {files.length > 1 && (
            <div className="multi-file-notice">
              <Sparkles size={14} className="multi-file-notice-icon" />
              <span>
                <strong>{t.upload.unifiedMasterDeck}:</strong> {t.upload.unifiedDesc}
              </span>
            </div>
          )}
        </div>
      )}

      {fileRejections.length > 0 && (
        <div className="upload-error-box" role="alert">
          <AlertCircle size={16} />
          <span>
            {formatRejectionError(fileRejections[0].errors[0], t.upload.fileTypes)}
          </span>
        </div>
      )}

      {/* Options */}
      <div className="upload-config">
        <div className="field-label">
          <Sliders size={13} />
          {t.upload.optionsTitle}
        </div>
        <div className="operation-toggle" role="group" aria-label="Ingestion mode">
          <button
            type="button"
            className={`op-button ${operation === "generate" ? "op-button-active" : ""}`}
            onClick={() => setOperation("generate")}
          >
            <Sparkles size={16} />
            <div>
              <strong>{t.upload.generateBtn}</strong>
              <small>{t.upload.generatePackDesc}</small>
            </div>
          </button>
          <button
            type="button"
            className={`op-button ${operation === "preview" ? "op-button-active" : ""}`}
            onClick={() => setOperation("preview")}
          >
            <FileText size={16} />
            <div>
              <strong>{t.upload.previewBtn}</strong>
              <small>{t.upload.previewOnlyDesc}</small>
            </div>
          </button>
        </div>

        {operation === "generate" && (
          <div className="generation-options-grid">
            <div className="option-field">
              <label htmlFor="question-count-select">{t.upload.questionCount}</label>
              <select
                id="question-count-select"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="select-input"
              >
                <option value={5}>{t.upload.qCount5}</option>
                <option value={10}>{t.upload.qCount10}</option>
                <option value={15}>{t.upload.qCount15}</option>
                <option value={20}>{t.upload.qCount20}</option>
                <option value={30}>{t.upload.qCount30}</option>
              </select>
            </div>

            <div className="option-field">
              <label htmlFor="mode-select">{t.upload.mode}</label>
              <select
                id="mode-select"
                value={mode}
                onChange={(e) => setMode(e.target.value as "variants" | "exact")}
                className="select-input"
              >
                <option value="variants">{t.upload.modeVariants}</option>
                <option value="exact">{t.upload.modeExact}</option>
              </select>
            </div>

            <div className="option-field">
              <label htmlFor="language-select">{t.upload.docLanguage}</label>
              <select
                id="language-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value as "en" | "vi")}
                className="select-input"
              >
                <option value="en">{t.upload.langEn}</option>
                <option value="vi">{t.upload.langVi}</option>
              </select>
            </div>

            <div className="option-field option-field-full">
              <label htmlFor="focus-input">{t.upload.focus}</label>
              <input
                id="focus-input"
                type="text"
                maxLength={1000}
                placeholder={t.upload.focusPlaceholder}
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                className="text-input"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="upload-error-box" role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>Error ({error.code}):</strong>
            <p>{error.message}</p>
            {error.code === "AI_NOT_CONFIGURED" && (
              <small className="block mt-1 text-xs">
                {t.upload.apiTip}
              </small>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="upload-actions">
        {loading ? (
          <div className="loading-state">
            <span className="spinner" />
            <span>{progressMsg}</span>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X size={14} />
              {t.upload.cancel}
            </Button>
          </div>
        ) : (
          <Button
            className="w-full start-button"
            disabled={files.length === 0}
            onClick={() => handleSubmit()}
          >
            {operation === "generate" ? (
              <>
                <Sparkles size={16} />
                {files.length > 1
                  ? `${t.upload.generateMasterBtn} (${files.length})`
                  : t.upload.generateBtn}
              </>
            ) : (
              <>
                <FileText size={16} />
                {files.length > 1
                  ? `${t.upload.previewMasterBtn} (${files.length})`
                  : t.upload.previewBtn}
              </>
            )}
          </Button>
        )}
      </div>

      {/* Generated Success Card */}
      {generatedResult && (
        <div className="result-card result-success">
          <div className="result-header">
            <CheckCircle2 size={20} className="text-green-600" />
            <div>
              <strong>{t.upload.studyPackReady}: {generatedResult.pack.title}</strong>
              <span>
                {generatedResult.pack.questions.length} {t.library.questionsCount} · {generatedResult.sourceKind}
              </span>
            </div>
          </div>
          {generatedResult.warnings.length > 0 && (
            <div className="result-warnings">
              {generatedResult.warnings.map((w, i) => (
                <p key={i}>⚠️ {w}</p>
              ))}
            </div>
          )}
          <div className="result-actions flex items-center gap-2">
            <Button
              className="btn-primary"
              onClick={() => onPlayPack(generatedResult.pack)}
            >
              <Play size={16} fill="currentColor" />
              {t.upload.playSoloRun}
            </Button>
            {onHostArena && (
              <Button
                variant="outline"
                className="btn-arena"
                onClick={() => onHostArena(generatedResult.pack)}
              >
                <Users size={16} />
                {t.upload.hostInArena}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Preview Success Card */}
      {previewResult && !generatedResult && (
        <div className="result-card result-preview">
          <div className="result-header">
            <FileText size={20} className="text-blue-600" />
            <div>
              <strong>Preview Extracted: {previewResult.fileName}</strong>
              <span>
                {previewResult.sources.length} blocks · {previewResult.characterCount.toLocaleString()} characters
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            The document is now loaded in the Document Viewer on the left. Ready to generate questions from it?
          </p>
          <div className="result-actions">
            <Button
              className="btn-primary"
              onClick={() => handleSubmit("generate")}
            >
              <Sparkles size={16} />
              Generate {questionCount} Questions Now
            </Button>
          </div>
        </div>
      )}

      <PricingModal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        initialReason={pricingReason}
      />
    </div>
  );
}
