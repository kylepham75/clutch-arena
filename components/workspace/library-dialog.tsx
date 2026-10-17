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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPack: (pack: StudyPack, doc?: ParsedDocument) => void;
  onHostArena?: (pack: StudyPack) => void;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<SavedStudyItem[]>([]);
  const [sharingPack, setSharingPack] = useState<StudyPack | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setImportError(err.message || "Failed to import pack file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
    >
      <div className="library-dialog-content">
        {/* User Saved Packs */}
        <div className="library-section">
          <div className="flex items-center justify-between mb-2">
            <span className="field-label mb-0">SAVED STUDY PACKS ({items.length})</span>
            <div>
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
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={13} />
                Import JSON
              </Button>
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
              <p>No uploaded packs saved yet.</p>
              <small>
                Upload your slides, PDFs, or notes in the Ingest tab to generate custom study
                packs that stay saved here.
              </small>
            </div>
          ) : (
            <div className="library-list" role="list">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="library-item"
                  role="listitem"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest(".library-item-actions")) return;
                    handleSelect(item);
                  }}
                >
                  <div className="library-item-icon">
                    <Sparkles size={18} />
                  </div>
                  <div className="library-item-details">
                    <div className="flex items-center gap-2">
                      <strong>{item.title}</strong>
                      <span className="tag">{item.format.toUpperCase()}</span>
                    </div>
                    <small>
                      {item.fileName} · {item.questionCount} questions ·{" "}
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </div>
                  <div
                    className="library-item-actions flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="dark"
                      onClick={() => handleSelect(item)}
                    >
                      <Play size={12} fill="currentColor" />
                      Play
                    </Button>
                    {onHostArena && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onHostArena(item.pack);
                          onOpenChange(false);
                        }}
                        title="Host in Arena"
                      >
                        <Users size={12} />
                        Arena
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSharingPack(item.pack)}
                      title="Share & Export"
                    >
                      <Share2 size={13} />
                    </Button>
                    <button
                      className="library-delete-btn"
                      title="Delete saved pack"
                      aria-label={`Delete ${item.title}`}
                      onClick={(e) => handleDelete(item.id, e)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
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
