"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  BookOpen,
  FileText,
  Search,
  X,
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { ParsedDocument, SourceBlock } from "@/lib/schemas/ingestion";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

export function DocumentViewer({
  document,
  highlightedSourceId,
  highlightedExcerpt,
  onSelectSource,
  onAskCoachAboutSource,
  onOpenUpload,
}: {
  document: ParsedDocument | null;
  highlightedSourceId?: string | null;
  highlightedExcerpt?: string | null;
  onSelectSource?: (sourceId: string) => void;
  onAskCoachAboutSource?: (source: SourceBlock) => void;
  onOpenUpload?: () => void;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const sourceRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Scroll active source block into view
  useEffect(() => {
    if (!highlightedSourceId) return;
    const element = sourceRefs.current.get(highlightedSourceId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedSourceId]);

  const filteredSources = useMemo(() => {
    if (!document) return [];
    if (!search.trim()) return document.sources;
    const query = search.toLowerCase();
    return document.sources.filter(
      (s) =>
        s.label.toLowerCase().includes(query) ||
        s.text.toLowerCase().includes(query),
    );
  }, [document, search]);

  const copyText = (source: SourceBlock) => {
    void navigator.clipboard?.writeText(source.text);
    setCopiedId(source.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!document) {
    return (
      <aside className="doc-viewer doc-viewer-empty" aria-label={t.docViewer.viewerAria}>
        <div className="doc-empty-state">
          <div className="doc-empty-icon">
            <FileText size={36} />
          </div>
          <h3>{t.docViewer.emptyTitle}</h3>
          <p>{t.docViewer.emptyDesc}</p>
          {onOpenUpload && (
            <Button onClick={onOpenUpload} size="sm">
              <Sparkles size={14} />
              {t.docViewer.uploadDocBtn}
            </Button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="doc-viewer" aria-label={`${t.docViewer.viewerAria}: ${document.fileName}`}>
      <header className="doc-header">
        <div className="doc-title-row">
          <div className="doc-badge-group">
            <span className="doc-format-badge">{document.format.toUpperCase()}</span>
            <span className="doc-sources-count">
              {document.sources.length} {document.pageCount ? t.docViewer.pagesWord : t.docViewer.sectionsWord}
            </span>
          </div>
          <h2 className="doc-filename" title={document.fileName}>
            {document.fileName}
          </h2>
        </div>

        <div className="doc-search-bar">
          <Search size={14} className="doc-search-icon" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.docViewer.searchPlaceholder}
            aria-label={t.docViewer.searchAria}
            className="doc-search-input"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="doc-search-clear"
              aria-label={t.docViewer.clearSearchAria}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </header>

      <div className="doc-blocks-container" role="feed" aria-label={t.docViewer.sourceBlocksAria}>
        {filteredSources.length === 0 ? (
          <div className="doc-no-matches">
            <p>{t.docViewer.noMatchesPrefix} &ldquo;{search}&rdquo;</p>
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              {t.docViewer.clearFilter}
            </Button>
          </div>
        ) : (
          filteredSources.map((source) => {
            const isHighlighted = highlightedSourceId === source.id;
            const isExpanded = !!expandedIds[source.id];
            const isLong = source.text.length > 500;
            const displayText =
              isLong && !isExpanded ? source.text.slice(0, 480) + "…" : source.text;

            return (
              <article
                key={source.id}
                ref={(el) => {
                  if (el) sourceRefs.current.set(source.id, el);
                  else sourceRefs.current.delete(source.id);
                }}
                id={`source-${source.id}`}
                className={`doc-block ${isHighlighted ? "doc-block-active" : ""}`}
                onClick={() => onSelectSource?.(source.id)}
              >
                <div className="doc-block-header">
                  <span className="doc-block-label">
                    <BookOpen size={13} />
                    {source.label}
                  </span>
                  <div className="doc-block-actions" onClick={(e) => e.stopPropagation()}>
                    {onAskCoachAboutSource && (
                      <button
                        className="doc-block-btn"
                        title={t.docViewer.askCoachTooltip}
                        aria-label={`${t.docViewer.askCoachBtn}: ${source.label}`}
                        onClick={() => onAskCoachAboutSource(source)}
                      >
                        <Sparkles size={12} />
                        <span>{t.docViewer.askCoachBtn}</span>
                      </button>
                    )}
                    <button
                      className="doc-block-btn"
                      title={t.docViewer.copyTextTooltip}
                      aria-label={t.docViewer.copyTextTooltip}
                      onClick={() => copyText(source)}
                    >
                      {copiedId === source.id ? (
                        <Check size={12} className="text-green-600" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="doc-block-content">
                  {highlightedExcerpt && isHighlighted ? (
                    <RenderHighlightedText
                      fullText={displayText}
                      excerpt={highlightedExcerpt}
                    />
                  ) : (
                    <p>{displayText}</p>
                  )}
                </div>

                {isLong && (
                  <button
                    className="doc-block-expand-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(source.id);
                    }}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp size={12} /> {t.docViewer.showLess}
                      </>
                    ) : (
                      <>
                        <ChevronDown size={12} /> {t.docViewer.readMore}
                      </>
                    )}
                  </button>
                )}
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

function RenderHighlightedText({
  fullText,
  excerpt,
}: {
  fullText: string;
  excerpt: string;
}) {
  const normFull = fullText.toLowerCase();
  const normEx = excerpt.trim().toLowerCase();
  const matchIndex = normFull.indexOf(normEx);

  if (matchIndex === -1) {
    return <p>{fullText}</p>;
  }

  const before = fullText.slice(0, matchIndex);
  const match = fullText.slice(matchIndex, matchIndex + excerpt.length);
  const after = fullText.slice(matchIndex + excerpt.length);

  return (
    <p>
      {before}
      <mark className="doc-excerpt-mark">{match}</mark>
      {after}
    </p>
  );
}
