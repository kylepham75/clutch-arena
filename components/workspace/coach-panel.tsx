"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  Sparkles,
  Send,
  BookOpen,
  HelpCircle,
  RotateCcw,
  AlertCircle,
  Lightbulb,
  Square,
  User,
  Bot,
} from "lucide-react";
import type { ParsedDocument } from "@/lib/schemas/ingestion";
import type { CoachFocus } from "@/lib/schemas/coach";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { splitMathBlocks, cleanCoachMathArtifacts } from "@/lib/math/latex";
import { useLanguage } from "@/lib/i18n/context";

export function CoachPanel({
  document,
  activeFocus,
  onClearFocus,
  onSelectCitation,
  onOpenUpload,
}: {
  document: ParsedDocument | null;
  activeFocus?: CoachFocus | null;
  onClearFocus?: () => void;
  onSelectCitation?: (sourceId: string) => void;
  onOpenUpload?: () => void;
}) {
  const { language, t } = useLanguage();
  const [inputVal, setInputVal] = useState("");
  const documentRef = useRef(document);
  documentRef.current = document;
  const languageRef = useRef(language);
  languageRef.current = language;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/coach",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            messages,
            document: documentRef.current,
            language: languageRef.current,
            ...body,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const handleSend = (text?: string, focus?: CoachFocus) => {
    const content = (text || inputVal).trim();
    if (!content || !document || isStreaming) return;
    setInputVal("");

    const currentFocus = focus ?? activeFocus ?? undefined;
    void sendMessage(
      {
        text: content,
        metadata: currentFocus ? { focus: currentFocus } : undefined,
      },
      {
        body: {
          document,
          language: languageRef.current || language,
        },
      },
    );

    if (activeFocus && onClearFocus) {
      onClearFocus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!document) {
    return (
      <div className="coach-panel coach-empty surface" aria-label={t.coach.title}>
        <div className="coach-empty-state">
          <div className="section-icon">
            <Sparkles size={24} />
          </div>
          <h3>{t.coach.noDocument}</h3>
          <p>{t.coach.noDocDesc}</p>
          {onOpenUpload && (
            <Button onClick={onOpenUpload} size="sm">
              <Sparkles size={14} />
              {t.coach.uploadPrompt}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="coach-panel surface" aria-label={t.coach.title}>
      <header className="coach-header">
        <div className="section-top">
          <div className="section-icon">
            <Sparkles size={18} />
          </div>
          <div>
            <h2>{t.coach.title}</h2>
            <p>
              {t.coach.groundedIn} <strong>{document.fileName}</strong>
            </p>
          </div>
        </div>

        {activeFocus && (
          <div className="coach-focus-banner" role="status">
            <div className="coach-focus-info">
              {activeFocus.type === "explain" ? (
                <>
                  <Lightbulb size={14} className="text-amber-500" />
                  <span>
                    {t.coach.focusMissedPrefix} &ldquo;{activeFocus.topic || activeFocus.question.slice(0, 40)}...&rdquo;
                  </span>
                </>
              ) : (
                <>
                  <RotateCcw size={14} className="text-purple-500" />
                  <span>
                    {t.coach.focusDebriefPrefix} ({activeFocus.correct}/{activeFocus.total} {t.coach.focusDebriefCorrect}, {activeFocus.score} XP)
                  </span>
                </>
              )}
            </div>
            <div className="coach-focus-actions">
              <Button
                variant="dark"
                size="sm"
                onClick={() =>
                  handleSend(
                    activeFocus.type === "explain"
                      ? t.coach.explainAutoPrompt
                      : t.coach.debriefAutoPrompt,
                    activeFocus,
                  )
                }
                disabled={isStreaming}
              >
                {t.coach.askCoachNow}
              </Button>
              {onClearFocus && (
                <button
                  className="coach-clear-focus-btn"
                  onClick={onClearFocus}
                  title={t.coach.dismissFocus}
                  aria-label={t.coach.dismissFocus}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Messages area */}
      <div className="coach-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="coach-welcome">
            <div className="welcome-avatar">
              <Sparkles size={20} />
            </div>
            <h4>{t.coach.askAnythingAbout} {document.fileName}</h4>
            <p>
              {t.coach.everyAnswer}
            </p>

            <div className="coach-suggestions">
              <span className="field-label">{t.coach.suggestedQuestions}</span>
              <button
                className="coach-suggestion-chip"
                onClick={() =>
                  handleSend(t.coach.suggest1)
                }
              >
                ✦ {t.coach.suggest1}
              </button>
              <button
                className="coach-suggestion-chip"
                onClick={() =>
                  handleSend(t.coach.suggest2)
                }
              >
                ✦ {t.coach.suggest2}
              </button>
              <button
                className="coach-suggestion-chip"
                onClick={() =>
                  handleSend(t.coach.suggest3)
                }
              >
                ✦ {t.coach.suggest3}
              </button>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            const text = message.parts
              ?.filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("") || "";

            return (
              <div
                key={message.id}
                className={`coach-message ${isUser ? "coach-message-user" : "coach-message-coach"}`}
              >
                <div className="coach-message-avatar">
                  {isUser ? <User size={14} /> : <Bot size={14} />}
                </div>
                <div className="coach-message-bubble">
                  {isUser ? (
                    <p>{text}</p>
                  ) : (
                    <RenderCoachText
                      text={text}
                      onSelectCitation={onSelectCitation}
                      document={document}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}

        {isStreaming && (
          <div className="coach-streaming-indicator">
            <span className="pulse-dot" />
            <span>{t.coach.streamingStatus}</span>
            <button
              className="coach-stop-btn"
              onClick={stop}
              aria-label={t.coach.stop}
            >
              <Square size={12} />
              {t.coach.stop}
            </button>
          </div>
        )}

        {error && (
          <div className="upload-error-box mt-3" role="alert">
            <AlertCircle size={16} />
            <span>
              {(() => {
                try {
                  const parsed = JSON.parse(error.message);
                  return parsed.error?.message || error.message;
                } catch {
                  if (error.message === "An error occurred.") {
                    return t.coach.connectionError;
                  }
                  return error.message || t.coach.genericCoachError;
                }
              })()}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <footer className="coach-input-bar">
        <textarea
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.coach.placeholder}
          aria-label={t.coach.placeholder}
          rows={1}
          maxLength={2000}
          className="coach-textarea"
          disabled={isStreaming}
        />
        <Button
          size="sm"
          className="btn-primary"
          onClick={() => handleSend()}
          disabled={!inputVal.trim() || isStreaming}
          aria-label={t.coach.send}
        >
          <Send size={14} />
        </Button>
      </footer>
    </section>
  );
}

function getCitationDisplay(
  sourceId: string,
  document?: ParsedDocument | null,
  labels?: { docWord: string; slideWord: string },
): { label: string; fullTitle: string } {
  const docWord = labels?.docWord || "Doc";
  const slideWord = labels?.slideWord || "Slide";

  const localizeLabel = (rawLabel: string) => {
    return rawLabel
      .replace(/^Doc\s+(\d+)\s*·\s*Slide\s+(\d+)/i, `${docWord} $1 · ${slideWord} $2`)
      .replace(/^Slide\s+(\d+)/i, `${slideWord} $1`)
      .replace(/^Page\s+(\d+)/i, `${slideWord} $1`);
  };

  if (!document || !document.sources) {
    return { label: sourceId, fullTitle: sourceId };
  }

  // 1. Exact match in sources
  const direct = document.sources.find((s) => s.id === sourceId);
  if (direct && direct.label) {
    const label = localizeLabel(direct.label);
    return { label, fullTitle: `${label} (${sourceId})` };
  }

  // 2. Loose match (prefix or suffix)
  const loose = document.sources.find(
    (s) =>
      s.id.endsWith(`_${sourceId}`) ||
      sourceId.endsWith(`_${s.id}`) ||
      s.id === `doc0_${sourceId}`,
  );
  if (loose && loose.label) {
    const label = localizeLabel(loose.label);
    return { label, fullTitle: `${label} (${sourceId})` };
  }

  // 3. Fallback parser: doc0_page-9 -> Doc 1 · Slide 9
  const docMatch = sourceId.match(/^doc(\d+)_(?:page-)?(\d+)$/i);
  if (docMatch) {
    const docIdx = parseInt(docMatch[1], 10) + 1;
    const pageNum = docMatch[2];
    const label = `${docWord} ${docIdx} · ${slideWord} ${pageNum}`;
    return { label, fullTitle: `${label} (${sourceId})` };
  }

  const pageMatch = sourceId.match(/^(?:page-)?(\d+)$/i);
  if (pageMatch) {
    const label = `${slideWord} ${pageMatch[1]}`;
    return { label, fullTitle: `${label} (${sourceId})` };
  }

  return { label: sourceId, fullTitle: sourceId };
}

function FormattedInlineSegment({
  text,
  onSelectCitation,
  document,
}: {
  text: string;
  onSelectCitation?: (sourceId: string) => void;
  document?: ParsedDocument | null;
}) {
  const { t } = useLanguage();
  // Matches [[id1, id2]] or [[id]] or [docN_page-X]
  const citationTokenRegex = /(\[\[[a-zA-Z0-9_\-.,\s]+\]\]|\[doc\d+_[a-zA-Z0-9_\-]+\])/g;
  const citationParts = text.split(citationTokenRegex);

  return (
    <>
      {citationParts.map((part, cIdx) => {
        const isDoubleBracket = part.startsWith("[[") && part.endsWith("]]");
        const isSingleBracket =
          part.startsWith("[") &&
          part.endsWith("]") &&
          /^\[doc\d+_[a-zA-Z0-9_\-]+\]$/.test(part);

        if (isDoubleBracket || isSingleBracket) {
          const inner = isDoubleBracket
            ? part.slice(2, -2).trim()
            : part.slice(1, -1).trim();
          const ids = inner
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && /^[a-zA-Z0-9_\-]+$/.test(s));

          if (ids.length > 0) {
            return (
              <span
                key={cIdx}
                className="inline-flex flex-wrap items-center gap-1 mx-1 align-baseline"
              >
                {ids.map((sourceId, sIdx) => {
                  const { label, fullTitle } = getCitationDisplay(sourceId, document, {
                    docWord: t.coach.docWord,
                    slideWord: t.coach.slideWord,
                  });
                  return (
                    <button
                      key={sIdx}
                      type="button"
                      className="coach-citation-pill inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-amber-200/90 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-medium transition-colors align-baseline shadow-xs"
                      onClick={() => onSelectCitation?.(sourceId)}
                      title={`${t.coach.jumpToCitation} ${fullTitle} ${t.coach.jumpToCitationViewerSuffix}`}
                      aria-label={`${t.coach.jumpToCitationAria}: ${label}`}
                    >
                      <BookOpen size={11} className="text-amber-700 shrink-0" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </span>
            );
          }
        }

        // Split by **bold** or *italic* markdown syntax
        const mdTokens = part.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/g);

        return (
          <span key={cIdx}>
            {mdTokens.map((token, mIdx) => {
              if (token.startsWith("**") && token.endsWith("**")) {
                const inner = token.slice(2, -2);
                return (
                  <strong key={mIdx} className="font-semibold text-stone-900">
                    <MathText content={inner} inline />
                  </strong>
                );
              }
              if (token.startsWith("*") && token.endsWith("*")) {
                const inner = token.slice(1, -1);
                return (
                  <em key={mIdx} className="italic text-stone-800">
                    <MathText content={inner} inline />
                  </em>
                );
              }
              return <MathText key={mIdx} content={token} inline />;
            })}
          </span>
        );
      })}
    </>
  );
}

function RenderCoachText({
  text,
  onSelectCitation,
  document,
}: {
  text: string;
  onSelectCitation?: (sourceId: string) => void;
  document?: ParsedDocument | null;
}) {
  const cleanedText = useMemo(() => cleanCoachMathArtifacts(text), [text]);
  const blocks = splitMathBlocks(cleanedText);

  return (
    <div className="coach-response-text space-y-2">
      {blocks.map((block, bIdx) => {
        if (block.type === "math-display") {
          return (
            <div key={bIdx} className="my-2.5 flex justify-center">
              <MathText content={`$$${block.math}$$`} inline={false} />
            </div>
          );
        }

        const paragraphs = block.text
          .split(/\n\s*\n/)
          .filter((p) => p.trim().length > 0);

        return paragraphs.map((para, pIdx) => {
          const lines = para.split("\n").filter((l) => l.trim().length > 0);
          const isAllBullets =
            lines.length > 0 && lines.every((l) => /^\s*[-*•]\s+/.test(l));

          if (isAllBullets) {
            return (
              <ul
                key={`${bIdx}-${pIdx}`}
                className="coach-bullet-list space-y-1.5 my-1.5 pl-1"
              >
                {lines.map((line, lIdx) => {
                  const content = line.replace(/^\s*[-*•]\s+/, "");
                  return (
                    <li
                      key={lIdx}
                      className="flex items-start gap-2 text-stone-700 leading-relaxed"
                    >
                      <span className="text-stone-400 mt-1 select-none text-xs leading-none">
                        •
                      </span>
                      <span className="flex-1">
                        <FormattedInlineSegment
                          text={content}
                          onSelectCitation={onSelectCitation}
                          document={document}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            );
          }

          return (
            <div
              key={`${bIdx}-${pIdx}`}
              className="coach-paragraph leading-relaxed"
            >
              {lines.map((line, lIdx) => {
                const isBullet = /^\s*[-*•]\s+/.test(line);
                if (isBullet) {
                  const content = line.replace(/^\s*[-*•]\s+/, "");
                  return (
                    <div
                      key={lIdx}
                      className="flex items-start gap-2 my-1 pl-1 text-stone-700"
                    >
                      <span className="text-stone-400 mt-1 select-none text-xs leading-none">
                        •
                      </span>
                      <span className="flex-1">
                        <FormattedInlineSegment
                          text={content}
                          onSelectCitation={onSelectCitation}
                          document={document}
                        />
                      </span>
                    </div>
                  );
                }
                return (
                  <p key={lIdx} className="mb-1 text-stone-700">
                    <FormattedInlineSegment
                      text={line}
                      onSelectCitation={onSelectCitation}
                      document={document}
                    />
                  </p>
                );
              })}
            </div>
          );
        });
      })}
    </div>
  );
}

