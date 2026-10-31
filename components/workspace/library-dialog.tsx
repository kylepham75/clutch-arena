"use client";

import { useEffect, useRef, useState } from "react";
import {
  Layers3,
  BookOpen,
  Calendar,
  Trash2,
  Play,
  FileText,
  Sparkles,
  ArrowRight,
  Upload,
  Share2,
  Users,
  Plus,
} from "lucide-react";
import {
  readLibrary,
  saveStudyItem,
  deleteStudyItem,
  fetchCloudLibrary,
  LIBRARY_UPDATED_EVENT,
  type SavedStudyItem,
} from "@/lib/game/library";
import {
  parsePackJson,
  documentFromPack,
} from "@/lib/game/pack-transfer";
import { PackShareDialog } from "./pack-share-dialog";
import type { StudyPack } from "@/lib/schemas/question";
import type { ParsedDocument } from "@/lib/schemas/ingestion";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

export function LibraryDialog({
  open,
  onOpenChange,
  onSelectPack,
  onHostArena,
  onOpenUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPack: (pack: StudyPack, doc?: ParsedDocument) => void;
  onHostArena?: (pack: StudyPack) => void;
  onOpenUpload?: () => void;
}) {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<SavedStudyItem[]>([]);
  const [sharingPack, setSharingPack] = useState<StudyPack | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenUpload = () => {
    onOpenChange(false);
    onOpenUpload?.();
  };

  useEffect(() => {
    if (open) {
      setItems(readLibrary());
      setImportError(null);
      // Fetch fresh cloud copies if user is signed in
      void fetchCloudLibrary().then((cloudItems) => {
        if (Array.isArray(cloudItems)) {
          setItems(cloudItems);
        }
      });
    }
  }, [open]);

  useEffect(() => {
    const handleUpdate = () => setItems(readLibrary());
    window.addEventListener(LIBRARY_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(LIBRARY_UPDATED_EVENT, handleUpdate);
  }, []);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImportError(null);
      const text = await file.text();
      const pack = parsePackJson(text);
      const doc = documentFromPack(pack, file.name);
      const newItem: SavedStudyItem = {
        id: pack.id,
        title: pack.title,
        createdAt: new Date().toISOString(),
        questionCount: pack.questions.length,
        format: "txt",
        fileName: file.name,
        pack,
        document: doc,
      };
      const updated = saveStudyItem(newItem);
      setItems(updated);
    } catch (err: any) {
      setImportError(err.message || t.library.importErrorFallback);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window !== "undefined" && !window.confirm(t.library.confirmDelete)) {
      return;
    }
    const updated = deleteStudyItem(id);
    setItems(updated);
  };

  const handleSelect = (item: SavedStudyItem) => {
    onSelectPack(item.pack, item.document);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.library.title}
      description={t.library.subtitle}
      className="library-dialog-modal"
    >
      <div className="library-dialog-content">
        {/* User Saved Packs */}
        <div className="library-section">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <span className="field-label mb-0">{t.library.savedPacksHeader} ({items.length})</span>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={handleImportFile}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs font-medium rounded-lg border-stone-200 text-stone-700 hover:bg-stone-50 flex items-center gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={13} />
                <span>{t.library.importJson}</span>
              </Button>
              {onOpenUpload && (
                <Button
                  size="sm"
                  variant="dark"
                  className="h-8 px-3 text-xs font-semibold rounded-lg bg-stone-900 text-white hover:bg-stone-800 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  onClick={handleOpenUpload}
                >
                  <Plus size={14} />
                  <span>{t.library.addDeck}</span>
                </Button>
              )}
            </div>
          </div>
          {importError && (
            <div className="upload-error-box mb-3 text-xs" role="alert">
              {importError}
            </div>
          )}
          {items.length === 0 ? (
            <div className="library-empty">
              <FileText size={28} />
              <p>{t.library.noPacksSavedTitle}</p>
              <small>{t.library.noPacksSavedDesc}</small>
              {onOpenUpload && (
                <Button
                  size="sm"
                  variant="dark"
                  className="mt-3.5 h-8 px-3.5 text-xs font-semibold rounded-lg bg-stone-900 text-white hover:bg-stone-800 flex items-center gap-1.5 cursor-pointer"
                  onClick={handleOpenUpload}
                >
                  <Plus size={14} />
                  <span>{t.library.addDeck}</span>
                </Button>
              )}
            </div>
          ) : (
            <div className="library-list" role="list">
              {items.map((item) => {
                const displayTitle =
                  item.title?.trim() || item.fileName || t.run?.practiceConceptFallback || "Bộ đề ôn tập";
                return (
                  <div
                    key={item.id}
                    className="library-item"
                    role="listitem"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest(".library-item-actions")) return;
                      handleSelect(item);
                    }}
                  >
                    <div className="library-item-main">
                      <div className="library-item-icon">
                        <Sparkles size={18} />
                      </div>
                      <div className="library-item-details">
                        <div className="flex items-center gap-2 min-w-0">
                          <strong title={displayTitle}>
                            {displayTitle}
                          </strong>
                          <span className="tag shrink-0">{item.format.toUpperCase()}</span>
                        </div>
                        <small title={`${item.fileName} · ${item.questionCount} ${t.library.questionsCount}`}>
                          {item.fileName} · {item.questionCount} {t.library.questionsCount} ·{" "}
                          {new Date(item.createdAt).toLocaleDateString(language === "vi" ? "vi-VN" : "en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </small>
                      </div>
                    </div>
                    <div
                      className="library-item-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="dark"
                        className="library-action-play"
                        onClick={() => handleSelect(item)}
                      >
                        <Play size={12} fill="currentColor" />
                        <span>{t.library.playBtn}</span>
                      </Button>
                      {onHostArena && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="library-action-arena"
                          onClick={() => {
                            onHostArena(item.pack);
                            onOpenChange(false);
                          }}
                          title={t.library.hostInArenaTooltip}
                        >
                          <Users size={12} />
                          <span>{t.library.arenaBtn}</span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="library-action-icon"
                        onClick={() => setSharingPack(item.pack)}
                        title={t.library.shareExportTooltip}
                      >
                        <Share2 size={13} />
                      </Button>
                      <button
                        className="library-delete-btn"
                        title={t.library.deletePackTooltip}
                        aria-label={`${t.library.deleteBtn} ${displayTitle}`}
                        onClick={(e) => handleDelete(item.id, e)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {sharingPack && (
        <PackShareDialog
          open={!!sharingPack}
          onOpenChange={(isOpen) => {
            if (!isOpen) setSharingPack(null);
          }}
          pack={sharingPack}
        />
      )}
    </Dialog>
  );
}
