"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  FileJson,
  FileSpreadsheet,
  FileText,
  Layers,
  Link2,
  Printer,
  Zap,
  AlertTriangle,
} from "lucide-react";
import type { StudyPack } from "@/lib/schemas/question";
import {
  LONG_LINK_THRESHOLD,
  buildShareUrl,
  copyTextWithFallback,
  downloadTextFile,
  encodePackForShare,
  packToAnki,
  packToCsv,
  packToJson,
  packToMarkdown,
  packToQuizlet,
  printStudyGuide,
  slugify,
} from "@/lib/game/pack-transfer";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

export function PackShareDialog({
  open,
  onOpenChange,
  pack,
  missedIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack: StudyPack;
  missedIds?: string[];
}) {
  const { t } = useLanguage();
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [scope, setScope] = useState<"all" | "missed">("all");

  const hasMissed = Boolean(missedIds && missedIds.length > 0);
  const activeIds = scope === "missed" && hasMissed ? missedIds : undefined;
  const count = activeIds ? activeIds.length : pack.questions.length;
  const suffix = scope === "missed" && hasMissed ? "missed" : "deck";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLink(null);
    setLinkError(null);
    setCopied(false);
    setCopiedMd(false);
    setScope("all");
    encodePackForShare(pack)
      .then((token) => {
        if (!cancelled) setLink(buildShareUrl(window.location.origin, token));
      })
      .catch(() => {
        if (!cancelled) setLinkError(t.share.linkErrorBuild);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pack, t.share.linkErrorBuild]);

  const copyLink = async () => {
    if (!link) return;
    const ok = await copyTextWithFallback(link);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } else {
      setLinkError(t.share.clipboardBlockedLink);
    }
  };

  const copyMarkdown = async () => {
    const md = packToMarkdown(pack, activeIds);
    const ok = await copyTextWithFallback(md);
    if (ok) {
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2_000);
    } else {
      setLinkError(t.share.clipboardBlockedMd);
    }
  };

  const base = slugify(pack.title);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.share.title}
      description={`${pack.title} · ${count} ${t.share.conceptsSelected}`}
    >
      <div className="share-dialog">
        {hasMissed && (
          <section className="share-section">
            <span className="field-label">{t.share.exportScope}</span>
            <div className="export-scope-toggle">
              <button
                type="button"
                className={`export-scope-btn ${scope === "all" ? "active" : ""}`}
                onClick={() => setScope("all")}
              >
                {t.share.allConcepts} ({pack.questions.length})
              </button>
              <button
                type="button"
                className={`export-scope-btn ${scope === "missed" ? "active" : ""}`}
                onClick={() => setScope("missed")}
              >
                {t.share.missedOnly} ({missedIds?.length})
              </button>
            </div>
          </section>
        )}

        <section className="share-section">
          <div className="flex items-center justify-between mb-1.5">
            <span className="field-label">{t.share.exportFormats}</span>
            <button
              type="button"
              className="text-xs text-stone-400 hover:text-stone-200 inline-flex items-center gap-1 transition-colors"
              onClick={copyMarkdown}
            >
              {copiedMd ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copiedMd ? t.share.copiedMarkdown : t.share.copyMarkdown}</span>
            </button>
          </div>

          <div className="export-grid">
            <button
              type="button"
              className="export-option"
              onClick={() => printStudyGuide(pack, activeIds)}
              title={t.share.printableGuideTooltip}
            >
              <Printer size={20} className="text-emerald-400" />
              <strong>{t.share.printableGuideTitle}</strong>
              <span>{t.share.printableGuideDesc}</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.md`, packToMarkdown(pack, activeIds), "text/markdown")
              }
              title={t.share.markdownTooltip}
            >
              <FileText size={20} className="text-blue-400" />
              <strong>{t.share.markdownTitle}</strong>
              <span>{t.share.markdownDesc}</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.anki.txt`, packToAnki(pack, activeIds), "text/plain")
              }
              title={t.share.ankiTooltip}
            >
              <Layers size={20} className="text-amber-400" />
              <strong>{t.share.ankiTitle}</strong>
              <span>{t.share.ankiDesc}</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.quizlet.txt`, packToQuizlet(pack, activeIds), "text/plain")
              }
              title={t.share.quizletTooltip}
            >
              <Zap size={20} className="text-purple-400" />
              <strong>{t.share.quizletTitle}</strong>
              <span>{t.share.quizletDesc}</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.csv`, `\uFEFF${packToCsv(pack, activeIds)}`, "text/csv")
              }
              title={t.share.csvTooltip}
            >
              <FileSpreadsheet size={20} className="text-teal-400" />
              <strong>{t.share.csvTitle}</strong>
              <span>{t.share.csvDesc}</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.clutch.json`, packToJson(pack, activeIds), "application/json")
              }
              title={t.share.jsonTooltip}
            >
              <FileJson size={20} className="text-orange-400" />
              <strong>{t.share.jsonTitle}</strong>
              <span>{t.share.jsonDesc}</span>
            </button>
          </div>
        </section>

        <section className="share-section">
          <span className="field-label">{t.share.shareLinkLabel}</span>
          <div className="share-link-row">
            <Link2 size={16} aria-hidden="true" />
            <input
              readOnly
              aria-label={t.share.shareLinkAria}
              className="text-input share-link-input"
              value={link ?? (linkError ? "" : t.share.buildingLink)}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" variant="dark" onClick={copyLink} disabled={!link}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t.share.copiedBtn : t.share.copyBtn}
            </Button>
          </div>
          {link && link.length > LONG_LINK_THRESHOLD && (
            <p className="share-warning">
              <AlertTriangle size={14} />
              {t.share.longLinkWarningPrefix} ({link.length.toLocaleString()} {t.share.charactersWord}). {t.share.longLinkWarningSuffix}
            </p>
          )}
          {linkError && (
            <p className="share-warning" role="alert">
              <AlertTriangle size={14} />
              {linkError}
            </p>
          )}
          <small className="share-note">
            {t.share.shareNote}
          </small>
          <div className="mt-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200">
            <strong className="flex items-center gap-1 font-bold text-amber-900 dark:text-amber-100">
              <Zap size={13} className="text-amber-600" />
              {t.share.zeroCostTitle}
            </strong>
            <p className="mt-1 text-stone-600 dark:text-stone-300">
              {t.share.zeroCostDesc}
            </p>
            <p className="mt-1 font-semibold text-emerald-700 dark:text-emerald-400">
              {t.share.earnPassNote}
            </p>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
