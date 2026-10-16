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
      <aside className="doc-viewer doc-viewer-empty" aria-label="Document viewer">
        <div className="doc-empty-state">
          <div className="doc-empty-icon">
            <FileText size={36} />
          </div>
          <h3>No study material loaded</h3>
          <p>
            Upload lecture slides, notes, or test banks (PDF, Word, TXT) to view
            source pages, inspect citations, and ask the AI Coach questions.
          </p>
          {onOpenUpload && (
            <Button onClick={onOpenUpload} size="sm">
              <Sparkles size={14} />
              Upload document
            </Button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="doc-viewer" aria-label={`Document: ${document.fileName}`}>
      <header className="doc-header">
        <div className="doc-title-row">
          <div className="doc-badge-group">
            <span className="doc-format-badge">{document.format.toUpperCase()}</span>
            <span className="doc-sources-count">
              {document.sources.length} {document.pageCount ? "pages" : "sections"}
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
            placeholder="Search source blocks..."
            aria-label="Search within document"
            className="doc-search-input"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="doc-search-clear"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </header>

      <div className="doc-blocks-container" role="feed" aria-label="Source blocks">
        {filteredSources.length === 0 ? (
          <div className="doc-no-matches">
            <p>No sections match &ldquo;{search}&rdquo;</p>
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              Clear filter
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
                        title="Ask Coach about this section"
                        aria-label={`Ask Coach about ${source.label}`}
                        onClick={() => onAskCoachAboutSource(source)}
                      >
                        <Sparkles size={12} />
                        <span>Ask Coach</span>
                      </button>
                    )}
                    <button
                      className="doc-block-btn"
                      title="Copy text"
                      aria-label="Copy source text"
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
                        <ChevronUp size={12} /> Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown size={12} /> Read more
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
