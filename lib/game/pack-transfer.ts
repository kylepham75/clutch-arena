import { studyPackSchema, type StudyPack } from "@/lib/schemas/question";
import type { ParsedDocument } from "@/lib/schemas/ingestion";

/** Hard ceiling for pack JSON (raw file or decompressed share payload). */
export const MAX_PACK_BYTES = 1_000_000;
/** Above this length some chat apps truncate links; the UI warns the user. */
export const LONG_LINK_THRESHOLD = 8_000;

const SHARE_HASH_KEY = "pack";
const LETTERS = ["A", "B", "C", "D"] as const;

export class PackTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackTransferError";
  }
}

/* -------------------------------------------------------------------------- */
/*  Validation                                                                 */
/* -------------------------------------------------------------------------- */

export function validatePack(candidate: unknown): StudyPack {
  let normalized = candidate;
  if (candidate && typeof candidate === "object") {
    const raw = { ...(candidate as Record<string, unknown>) };
    if (Array.isArray(raw.questions)) {
      raw.questions = raw.questions.map((q, idx) => {
        if (q && typeof q === "object") {
          const qObj = q as Record<string, unknown>;
          const id = typeof qObj.id === "string" && qObj.id.length > 0 ? qObj.id : `q-${idx + 1}`;
          const conceptVariant =
            qObj.conceptVariant && typeof qObj.conceptVariant === "object"
              ? qObj.conceptVariant
              : {
                  question: qObj.question,
                  options: qObj.options,
                  correctIndex: qObj.correctIndex,
                  explanation: qObj.explanation,
                };
          return { ...qObj, id, conceptVariant };
        }
        return q;
      });
    }
    normalized = raw;
  }
  const parsed = studyPackSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new PackTransferError("This isn’t a valid Clutch study pack.");
  }
  return parsed.data;
}

/* -------------------------------------------------------------------------- */
/*  Question Filtering Helper                                                  */
/* -------------------------------------------------------------------------- */

export function filterQuestions(pack: StudyPack, questionIds?: string[]) {
  if (!questionIds || questionIds.length === 0) return pack.questions;
  const set = new Set(questionIds);
  return pack.questions.filter((q) => set.has(q.id));
}

/* -------------------------------------------------------------------------- */
/*  JSON (lossless, re-importable)                                             */
/* -------------------------------------------------------------------------- */

export function packToJson(pack: StudyPack, questionIds?: string[]): string {
  const questions = filterQuestions(pack, questionIds);
  const metadata: Record<string, any> = {};
  for (const q of questions) {
    if (pack.metadata[q.id]) {
      metadata[q.id] = pack.metadata[q.id];
    }
  }
  const exportPack: StudyPack = {
    ...pack,
    questions,
    metadata,
  };
  return JSON.stringify({ format: "clutch-pack", version: 1, pack: exportPack }, null, 2);
}

export function parsePackJson(text: string): StudyPack {
  if (new TextEncoder().encode(text).length > MAX_PACK_BYTES) {
    throw new PackTransferError("This pack file is too large to import.");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PackTransferError("This file isn’t valid JSON.");
  }
  const candidate =
    data && typeof data === "object" && "pack" in data
      ? (data as { pack: unknown }).pack
      : data;
  return validatePack(candidate);
}

/* -------------------------------------------------------------------------- */
/*  CSV (spreadsheets)                                                         */
/* -------------------------------------------------------------------------- */

function csvCell(raw: string): string {
  // Neutralise spreadsheet formula injection (OWASP CSV injection guidance).
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function packToCsv(pack: StudyPack, questionIds?: string[]): string {
  const header = [
    "Question",
    "Option A",
    "Option B",
    "Option C",
    "Option D",
    "Correct Letter",
    "Correct Answer",
    "Explanation",
    "Topic",
    "Chapter",
    "Citation",
  ];
  const questions = filterQuestions(pack, questionIds);
  const rows = questions.map((q) => {
    const meta = pack.metadata[q.id];
    return [
      q.question,
      ...q.options,
      LETTERS[q.correctIndex],
      q.options[q.correctIndex],
      q.explanation,
      meta?.topic ?? "",
      meta?.chapter ?? "",
      meta?.citation ?? "",
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/* -------------------------------------------------------------------------- */
/*  Anki (tab-separated notes with HTML fields)                                */
/* -------------------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Anki fields can't contain raw tabs/newlines; convert to HTML-safe text. */
function ankiField(html: string): string {
  return html.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
}

function ankiTag(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function packToAnki(pack: StudyPack, questionIds?: string[]): string {
  const lines = ["#separator:tab", "#html:true", "#tags column:3"];
  const questions = filterQuestions(pack, questionIds);
  for (const q of questions) {
    const meta = pack.metadata[q.id];
    const front = [
      escapeHtml(q.question),
      "",
      ...q.options.map((opt, i) => `${LETTERS[i]}. ${escapeHtml(opt)}`),
    ].join("<br>");
    const backParts = [
      `<b>${LETTERS[q.correctIndex]}. ${escapeHtml(q.options[q.correctIndex])}</b>`,
      escapeHtml(q.explanation),
    ];
    if (meta?.citation) backParts.push(`<i>${escapeHtml(meta.citation)}</i>`);
    const tags = ["clutch-arena", ankiTag(pack.title), meta?.topic ? ankiTag(meta.topic) : ""]
      .filter(Boolean)
      .join(" ");
    lines.push([ankiField(front), ankiField(backParts.join("<br><br>")), tags].join("\t"));
  }
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Markdown Study Guide & Cheat Sheet                                         */
/* -------------------------------------------------------------------------- */

export function packToMarkdown(pack: StudyPack, questionIds?: string[]): string {
  const questions = filterQuestions(pack, questionIds);
  const lines: string[] = [];

  lines.push(`# ${pack.title}`);
  if (pack.subtitle) {
    lines.push(`> *${pack.subtitle}*`);
  }
  lines.push("");
  lines.push(`**Total Concepts / Questions:** ${questions.length}`);
  lines.push("");

  // Section 1: Core Rules & Knowledge Takeaways
  const rules = questions
    .map((q) => {
      const meta = pack.metadata[q.id];
      if (!meta?.rule && !meta?.topic) return null;
      return {
        topic: meta?.topic ?? "Core Concept",
        rule: meta?.rule ?? q.explanation,
        citation: meta?.citation,
      };
    })
    .filter(Boolean);

  if (rules.length > 0) {
    lines.push("## 📌 Key Definitions & Essential Rules");
    lines.push("");
    for (const r of rules) {
      if (!r) continue;
      const citationText = r.citation ? ` *(Source: ${r.citation})*` : "";
      lines.push(`- **${r.topic}**: ${r.rule}${citationText}`);
    }
    lines.push("");
  }

  // Section 2: Questions & Solutions
  lines.push("## 📝 Practice Questions & Solutions");
  lines.push("");
  questions.forEach((q, idx) => {
    const meta = pack.metadata[q.id];
    lines.push(`### Question ${idx + 1}: ${q.question}`);
    if (meta?.topic) {
      lines.push(`*Topic: ${meta.topic}${meta.chapter ? ` · ${meta.chapter}` : ""}*`);
    }
    lines.push("");
    q.options.forEach((opt, optIdx) => {
      const isCorrect = optIdx === q.correctIndex;
      const marker = isCorrect ? "[x]" : "[ ]";
      const boldOpt = isCorrect
        ? `**${LETTERS[optIdx]}. ${opt}**  *(Correct)*`
        : `${LETTERS[optIdx]}. ${opt}`;
      lines.push(`- ${marker} ${boldOpt}`);
    });
    lines.push("");
    lines.push(`> **Explanation:** ${q.explanation}`);
    if (meta?.citation) {
      lines.push(`> **Citation:** ${meta.citation}`);
    }
    lines.push("");
  });

  lines.push("---");
  lines.push("*Exported from Clutch Arena · Grounded active learning*");
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Quizlet Flashcard Format (Tab-Separated Term & Definition)                 */
/* -------------------------------------------------------------------------- */

export function packToQuizlet(pack: StudyPack, questionIds?: string[]): string {
  const questions = filterQuestions(pack, questionIds);
  const rows = questions.map((q) => {
    const meta = pack.metadata[q.id];
    const optionsText = q.options.map((opt, i) => `${LETTERS[i]}) ${opt}`).join("; ");
    const cleanQuestion = q.question.replace(/[\r\n\t]+/g, " ").trim();
    const term = `${cleanQuestion} [Options: ${optionsText}]`;
    const defParts = [`Answer: ${LETTERS[q.correctIndex]}) ${q.options[q.correctIndex]}`, q.explanation];
    if (meta?.rule) defParts.push(`Rule: ${meta.rule}`);
    if (meta?.citation) defParts.push(`Ref: ${meta.citation}`);
    const definition = defParts.join(" — ").replace(/[\r\n\t]+/g, " ").trim();
    return `${term}\t${definition}`;
  });
  return rows.join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Printable / PDF Study Sheet                                                */
/* -------------------------------------------------------------------------- */

export function printStudyGuide(pack: StudyPack, questionIds?: string[]): void {
  if (typeof window === "undefined") return;
  const questions = filterQuestions(pack, questionIds);

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to open the printable study guide.");
    return;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(pack.title)} — Study Guide</title>
  <style>
    @media print {
      body { margin: 12mm; font-size: 10pt; }
      .no-print { display: none !important; }
      .question-block { break-inside: avoid; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1c1f19;
      line-height: 1.5;
      max-width: 800px;
      margin: 30px auto;
      padding: 0 20px;
    }
    .print-header {
      border-bottom: 2px solid #272c21;
      padding-bottom: 12px;
      margin-bottom: 24px;
    }
    .print-header h1 { margin: 0 0 6px; font-size: 24px; color: #1e2518; }
    .print-header p { margin: 0; color: #646d5c; font-size: 13px; }
    .rules-card {
      background: #fbfbf7;
      border: 1px solid #e5e7df;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
    }
    .rules-card h2 { margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #414a38; }
    .rules-list { margin: 0; padding-left: 20px; }
    .rules-list li { margin-bottom: 8px; font-size: 12px; }
    .rules-list strong { color: #1b2116; }
    .question-block {
      border-bottom: 1px solid #ebece6;
      padding: 16px 0;
    }
    .question-title { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: #1f241a; }
    .options-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
    .option-item { font-size: 11px; padding: 4px 8px; border-radius: 4px; background: #f7f8f4; border: 1px solid #e8e9e2; }
    .option-correct { background: #eef6e9; border-color: #a3c28c; font-weight: 600; color: #2e4d1f; }
    .explanation-box {
      background: #fafaf5;
      border-left: 3px solid #8fad76;
      padding: 6px 12px;
      margin-top: 8px;
      font-size: 11px;
      color: #3b4234;
    }
    .citation-tag { font-size: 10px; color: #7f8972; margin-top: 4px; font-style: italic; }
    .toolbar {
      position: sticky;
      top: 10px;
      background: #24291f;
      color: white;
      padding: 10px 16px;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .toolbar button {
      background: #8fae77;
      color: #172110;
      border: none;
      padding: 6px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <span>Printable Study Sheet · Clutch Arena</span>
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>

  <div class="print-header">
    <h1>${escapeHtml(pack.title)}</h1>
    <p>${escapeHtml(pack.subtitle || "Study Guide & Practice Run")} · ${questions.length} Concepts</p>
  </div>

  <div class="rules-card">
    <h2>Core Knowledge & Rules</h2>
    <ul class="rules-list">
      ${questions
        .map((q) => {
          const meta = pack.metadata[q.id];
          const topic = meta?.topic || "Concept";
          const rule = meta?.rule || q.explanation;
          return `<li><strong>${escapeHtml(topic)}:</strong> ${escapeHtml(rule)} ${meta?.citation ? `<span class="citation-tag">(${escapeHtml(meta.citation)})</span>` : ""}</li>`;
        })
        .join("")}
    </ul>
  </div>

  <h2>Practice Questions & Verified Solutions</h2>
  ${questions
    .map((q, idx) => {
      const meta = pack.metadata[q.id];
      return `
      <div class="question-block">
        <div class="question-title">${idx + 1}. ${escapeHtml(q.question)}</div>
        <div class="options-grid">
          ${q.options
            .map(
              (opt, oIdx) => `
            <div class="option-item ${oIdx === q.correctIndex ? "option-correct" : ""}">
              ${LETTERS[oIdx]}. ${escapeHtml(opt)} ${oIdx === q.correctIndex ? "✓" : ""}
            </div>`,
            )
            .join("")}
        </div>
        <div class="explanation-box">
          <strong>Key insight:</strong> ${escapeHtml(q.explanation)}
          ${meta?.citation ? `<div class="citation-tag">Source: ${escapeHtml(meta.citation)}</div>` : ""}
        </div>
      </div>`;
    })
    .join("")}

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 400);
    };
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

/* -------------------------------------------------------------------------- */
/*  Share links (compressed pack in the URL hash — never sent to the server)   */
/* -------------------------------------------------------------------------- */

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new PackTransferError("This share link is malformed.");
  }
  const base64 =
    value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Reads a stream fully, aborting if it exceeds `limit` bytes (zip-bomb guard). */
async function readCapped(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new PackTransferError("This shared pack is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const canCompress = () =>
  typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

/**
 * Encodes a pack into a URL-safe token. Format: `1.<base64url(deflate-raw)>`,
 * or `0.<base64url(utf8)>` on runtimes without CompressionStream.
 */
export async function encodePackForShare(pack: StudyPack): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  if (!canCompress()) return `0.${toBase64Url(bytes)}`;
  const compressed = await readCapped(
    streamFromBytes(bytes).pipeThrough(new CompressionStream("deflate-raw") as any),
    MAX_PACK_BYTES,
  );
  return `1.${toBase64Url(compressed)}`;
}

export async function decodeSharedPack(token: string): Promise<StudyPack> {
  const dot = token.indexOf(".");
  const version = token.slice(0, dot);
  const payload = token.slice(dot + 1);
  if (dot < 1 || !payload || (version !== "0" && version !== "1")) {
    throw new PackTransferError("This share link is malformed.");
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(payload);
    if (version === "1") {
      if (!canCompress()) {
        throw new PackTransferError("This browser can’t open compressed share links.");
      }
      bytes = await readCapped(
        streamFromBytes(bytes).pipeThrough(new DecompressionStream("deflate-raw") as any),
        MAX_PACK_BYTES,
      );
    } else if (bytes.byteLength > MAX_PACK_BYTES) {
      throw new PackTransferError("This shared pack is too large.");
    }
  } catch (err) {
    if (err instanceof PackTransferError) throw err;
    throw new PackTransferError("This share link is corrupted or incomplete.");
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PackTransferError("This share link is corrupted or incomplete.");
  }
  return validatePack(data);
}

export function buildShareUrl(origin: string, token: string): string {
  return `${origin}/solo#${SHARE_HASH_KEY}=${token}`;
}

/** Extracts the share token from a location hash like `#pack=1.abc`. */
export function readShareToken(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get(SHARE_HASH_KEY);
  return token && token.length > 0 ? token : null;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Imported packs don't carry their original document, so build a lightweight
 * one from the pack's citations/rules so the Document Viewer and Coach still
 * have grounded context.
 */
export function documentFromPack(pack: StudyPack, fileName?: string): ParsedDocument {
  const byLabel = new Map<string, string[]>();
  for (const q of pack.questions) {
    const meta = pack.metadata[q.id];
    const label = meta?.citation?.trim() || meta?.topic?.trim() || q.id;
    const text = [meta?.rule, q.explanation].filter(Boolean).join(" ");
    byLabel.set(label, [...(byLabel.get(label) ?? []), text]);
  }
  const sources = Array.from(byLabel, ([label, texts], i) => ({
    id: `imported-${i + 1}`,
    label,
    text: texts.join("\n\n"),
  }));
  return {
    fileName: fileName ?? `${pack.title}.clutch.json`,
    format: "txt",
    sources,
    characterCount: sources.reduce((sum, s) => sum + s.text.length, 0),
    pageCount: null,
    warnings: ["Imported pack — showing study notes reconstructed from question citations."],
  };
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "clutch-pack"
  );
}

export function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
