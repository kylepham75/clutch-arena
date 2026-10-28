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
        if (!cancelled) setLinkError("Couldn’t build a share link. Use the JSON export instead.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, pack]);

  const copyLink = async () => {
    if (!link) return;
    const ok = await copyTextWithFallback(link);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } else {
      setLinkError("Clipboard access was blocked — select the link and copy it manually.");
    }
  };

  const copyMarkdown = async () => {
    const md = packToMarkdown(pack, activeIds);
    const ok = await copyTextWithFallback(md);
    if (ok) {
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2_000);
    } else {
      setLinkError("Clipboard access was blocked — try downloading the file instead.");
    }
  };

  const base = slugify(pack.title);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share & Export Study Deck"
      description={`${pack.title} · ${count} concepts selected`}
    >
      <div className="share-dialog">
        {hasMissed && (
          <section className="share-section">
            <span className="field-label">EXPORT SCOPE</span>
            <div className="export-scope-toggle">
              <button
                type="button"
                className={`export-scope-btn ${scope === "all" ? "active" : ""}`}
                onClick={() => setScope("all")}
              >
                All Concepts ({pack.questions.length})
              </button>
              <button
                type="button"
                className={`export-scope-btn ${scope === "missed" ? "active" : ""}`}
                onClick={() => setScope("missed")}
              >
                Missed Only ({missedIds?.length})
              </button>
            </div>
          </section>
        )}

        <section className="share-section">
          <div className="flex items-center justify-between mb-1.5">
            <span className="field-label">EXPORT FORMATS</span>
            <button
              type="button"
              className="text-xs text-stone-400 hover:text-stone-200 inline-flex items-center gap-1 transition-colors"
              onClick={copyMarkdown}
            >
              {copiedMd ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copiedMd ? "Copied Markdown!" : "Copy Markdown"}</span>
            </button>
          </div>

          <div className="export-grid">
            <button
              type="button"
              className="export-option"
              onClick={() => printStudyGuide(pack, activeIds)}
              title="Open print view or save as PDF"
            >
              <Printer size={20} className="text-emerald-400" />
              <strong>Printable Guide</strong>
              <span>Print or Save as PDF</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.md`, packToMarkdown(pack, activeIds), "text/markdown")
              }
              title="Download clean Markdown study guide"
            >
              <FileText size={20} className="text-blue-400" />
              <strong>Markdown (.md)</strong>
              <span>Obsidian, Notion, Notes</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.anki.txt`, packToAnki(pack, activeIds), "text/plain")
              }
              title="Import into Anki for spaced repetition"
            >
              <Layers size={20} className="text-amber-400" />
              <strong>Anki (.anki.txt)</strong>
              <span>Spaced repetition deck</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.quizlet.txt`, packToQuizlet(pack, activeIds), "text/plain")
              }
              title="Import into Quizlet as flashcard terms and definitions"
            >
              <Zap size={20} className="text-purple-400" />
              <strong>Quizlet</strong>
              <span>Pasteable flashcard terms</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.csv`, `\uFEFF${packToCsv(pack, activeIds)}`, "text/csv")
              }
              title="Download spreadsheet CSV"
            >
              <FileSpreadsheet size={20} className="text-teal-400" />
              <strong>CSV Spreadsheet</strong>
              <span>Excel, Google Sheets</span>
            </button>

            <button
              type="button"
              className="export-option"
              onClick={() =>
                downloadTextFile(`${base}-${suffix}.clutch.json`, packToJson(pack, activeIds), "application/json")
              }
              title="Full pack backup to re-import into Clutch Arena"
            >
              <FileJson size={20} className="text-orange-400" />
              <strong>Clutch JSON</strong>
              <span>Full backup — re-import</span>
            </button>
          </div>
        </section>

        <section className="share-section">
          <span className="field-label">SHARE LINK</span>
          <div className="share-link-row">
            <Link2 size={16} aria-hidden="true" />
            <input
              readOnly
              aria-label="Share link"
              className="text-input share-link-input"
              value={link ?? (linkError ? "" : "Building link…")}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" variant="dark" onClick={copyLink} disabled={!link}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          {link && link.length > LONG_LINK_THRESHOLD && (
            <p className="share-warning">
              <AlertTriangle size={14} />
              This link is long ({link.length.toLocaleString()} characters). Some chat apps
              may cut it off — send the JSON file instead if it doesn’t open.
            </p>
          )}
          {linkError && (
            <p className="share-warning" role="alert">
              <AlertTriangle size={14} />
              {linkError}
            </p>
          )}
          <small className="share-note">
            The whole pack lives inside the link itself. Nothing is uploaded, so anyone with
            the link can study these questions on any device.
          </small>
          <div className="mt-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200">
            <strong className="flex items-center gap-1 font-bold text-amber-900 dark:text-amber-100">
              <Zap size={13} className="text-amber-600" />
              $0 AI Token Cost · Zero-CAC Distribution
            </strong>
            <p className="mt-1 text-stone-600 dark:text-stone-300">
              Importing and playing this shared link uses $0 in LLM tokens because all questions and citations are pre-computed inside the token. Free users can import and study in Classic mode forever!
            </p>
            <p className="mt-1 font-semibold text-emerald-700 dark:text-emerald-400">
              🎁 Earn-Your-Pass: When 3 classmates import your pack link, you automatically unlock 3 free Concept Remix runs!
            </p>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
