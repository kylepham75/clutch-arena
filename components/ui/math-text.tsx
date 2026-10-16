"use client";

import React, { useMemo } from "react";
import {
  normalizeMathFormulas,
  renderKatexSafe,
  tokenizeMath,
} from "@/lib/math/latex";

interface MathTextProps {
  content?: string | null;
  className?: string;
  inline?: boolean;
}

export function MathText({
  content,
  className = "",
  inline = false,
}: MathTextProps) {
  const tokens = useMemo(() => {
    if (!content) return [];
    const normalized = normalizeMathFormulas(content);
    return tokenizeMath(normalized);
  }, [content]);

  if (!content) return null;

  // Fast path: if pure text without any math tokens, render simple text
  if (tokens.length === 1 && tokens[0].type === "text") {
    return <span className={className}>{tokens[0].value}</span>;
  }

  return (
    <span className={`math-text-container ${inline ? "math-text-inline" : "math-text-block"} ${className}`}>
      {tokens.map((token, index) => {
        if (token.type === "display-math") {
          const html = renderKatexSafe(token.value, !inline);
          if (inline) {
            return (
              <span
                key={index}
                className="math-formula-inline mx-1"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          return (
            <span key={index} className="math-display-card my-1.5 block">
              <span
                className="math-formula-block"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </span>
          );
        }

        if (token.type === "inline-math") {
          const html = renderKatexSafe(token.value, false);
          return (
            <span
              key={index}
              className="math-inline-render mx-0.5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        // Regular text segment (handle line breaks cleanly)
        const parts = token.value.split("\n");
        return (
          <span key={index} className="math-prose">
            {parts.map((part, pIdx) => (
              <React.Fragment key={pIdx}>
                {pIdx > 0 && <br />}
                {part}
              </React.Fragment>
            ))}
          </span>
        );
      })}
    </span>
  );
}
