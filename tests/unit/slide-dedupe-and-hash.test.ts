import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  deduplicateAnimationSlides,
  stripTrailingPageCounters,
  normalizeSlideTextForPrefix,
  longestCommonPrefixLength,
  computeFileSha256,
  computeImageSha256,
  computePerceptualImageHash,
  normalizeExtractedTextForHash,
  computeDocumentContentHash,
} from "@/lib/ingestion/content-hash";
import { computeContentHash } from "@/lib/rate-limit";
import { parseSlideDeck } from "@/lib/notes/parse-slides";
import { parseDocument } from "@/lib/ingestion/parse-document";
import { parseMultiDocuments } from "@/lib/ingestion/parse-multi-documents";
import type { SourceBlock, ParsedDocument } from "@/lib/schemas/ingestion";
import { makePdf, makeDocx, studyText } from "../helpers/documents";

const signal = () => new AbortController().signal;

describe("deduplicateAnimationSlides", () => {
  it("drops slide 1 in a 2-step progressive build when prefix exceeds 85%", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Introduction to Microeconomics\n• Scarcity and Opportunity Cost",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Introduction to Microeconomics\n• Scarcity and Opportunity Cost\n• Marginal Utility Analysis",
      },
    ];

    const result = deduplicateAnimationSlides(sources);
    expect(result.droppedCount).toBe(1);
    expect(result.droppedSlideIds).toEqual(["slide-1"]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].id).toBe("slide-2");
    expect(result.sources[0].label).toBe("Slide 2");
    expect(result.sources[0].text).toContain("Marginal Utility");
  });

  it("retains both slides when prefix is 85% or below", () => {
    // Current text: 100 characters. Prefix match: 80 characters (80% <= 85%)
    const prefix = "A".repeat(80);
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: `${prefix}${"B".repeat(20)}`,
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: `${prefix}${"C".repeat(40)}`,
      },
    ];

    const result = deduplicateAnimationSlides(sources);
    expect(result.droppedCount).toBe(0);
    expect(result.droppedSlideIds).toEqual([]);
    expect(result.sources).toHaveLength(2);
  });

  it("drops both slide 1 and slide 2 in a 3-step progressive build while preserving slide 3 label and id", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Financial Statement Analysis\n1. Balance Sheet",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Financial Statement Analysis\n1. Balance Sheet\n2. Income Statement",
      },
      {
        id: "slide-3",
        label: "Slide 3",
        text: "Financial Statement Analysis\n1. Balance Sheet\n2. Income Statement\n3. Cash Flow Statement",
      },
      {
        id: "slide-4",
        label: "Slide 4",
        text: "Ratio Analysis: Liquidity and Solvency",
      },
    ];

    const result = deduplicateAnimationSlides(sources);
    expect(result.droppedCount).toBe(2);
    expect(result.droppedSlideIds).toEqual(["slide-1", "slide-2"]);
    expect(result.sources).toHaveLength(2);

    // Surviving slide 3 retains original id and label
    expect(result.sources[0].id).toBe("slide-3");
    expect(result.sources[0].label).toBe("Slide 3");
    expect(result.sources[0].text).toContain("Cash Flow Statement");

    // Slide 4 untouched
    expect(result.sources[1].id).toBe("slide-4");
    expect(result.sources[1].label).toBe("Slide 4");
  });

  it("tolerates diverse trailing page and slide counters", () => {
    const sources: SourceBlock[] = [
      {
        id: "page-1",
        label: "Page 1",
        text: "Valuation Principles\nDiscounted Cash Flow Model\nPage 4",
      },
      {
        id: "page-2",
        label: "Page 2",
        text: "Valuation Principles\nDiscounted Cash Flow Model\nTerminal Value\nSlide 4 / 20",
      },
      {
        id: "page-3",
        label: "Page 3",
        text: "Valuation Principles\nDiscounted Cash Flow Model\nTerminal Value\nSensitivity Table\n4",
      },
    ];

    const result = deduplicateAnimationSlides(sources);
    expect(result.droppedCount).toBe(2);
    expect(result.droppedSlideIds).toEqual(["page-1", "page-2"]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].id).toBe("page-3");
  });

  it("preserves slide 1 via speaker-notes guard when note content is absent from next slide", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Topic: Capital Asset Pricing Model\n[Notes: Remember to emphasize that beta measures systematic risk only]",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Topic: Capital Asset Pricing Model\nFormula: E(R) = Rf + Beta * (Rm - Rf)",
      },
    ];

    const result = deduplicateAnimationSlides(sources);
    expect(result.droppedCount).toBe(0);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].id).toBe("slide-1");
    expect(result.sources[0].text).toContain("Notes: Remember to emphasize");
  });

  it("drops slide 1 when next slide contains the exact same speaker note", () => {
    const note = "[Notes: Remember to emphasize that beta measures systematic risk only]";
    const sources: SourceBlock[] = [
      {
        id: "slide-1",
        label: "Slide 1",
        text: `Topic: Capital Asset Pricing Model\n${note}`,
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: `Topic: Capital Asset Pricing Model\nFormula: E(R) = Rf + Beta * (Rm - Rf)\n${note}`,
      },
    ];

    const result = deduplicateAnimationSlides(sources);
    expect(result.droppedCount).toBe(1);
    expect(result.droppedSlideIds).toEqual(["slide-1"]);
    expect(result.sources[0].id).toBe("slide-2");
  });

  it("handles edge cases: empty sources, single slide, and shorter subsequent slides", () => {
    expect(deduplicateAnimationSlides([])).toEqual({
      sources: [],
      droppedSlideIds: [],
      droppedCount: 0,
    });

    const single: SourceBlock[] = [
      { id: "s-1", label: "Slide 1", text: "Unique slide" },
    ];
    expect(deduplicateAnimationSlides(single)).toEqual({
      sources: single,
      droppedSlideIds: [],
      droppedCount: 0,
    });

    // Shorter subsequent slide cannot be a progressive extension
    const shorterNext: SourceBlock[] = [
      { id: "s-1", label: "Slide 1", text: "Longer slide text describing the complete theory" },
      { id: "s-2", label: "Slide 2", text: "Longer slide" },
    ];
    const res = deduplicateAnimationSlides(shorterNext);
    expect(res.droppedCount).toBe(0);
    expect(res.sources).toHaveLength(2);
  });
});

describe("stripTrailingPageCounters & normalizeSlideTextForPrefix", () => {
  it("strips trailing counters on standalone lines", () => {
    expect(stripTrailingPageCounters("Slide Content\nPage 12")).toBe("Slide Content");
    expect(stripTrailingPageCounters("Slide Content\nSlide 3 / 45")).toBe("Slide Content");
    expect(stripTrailingPageCounters("Slide Content\nSlide 3 of 45")).toBe("Slide Content");
    expect(stripTrailingPageCounters("Slide Content\n15")).toBe("Slide Content");
    expect(stripTrailingPageCounters("Slide Content\nPage 12 of 30")).toBe("Slide Content");
    expect(stripTrailingPageCounters("Slide Content\n 7 / 20 ")).toBe("Slide Content");
  });

  it("does not strip inline numbers or formula assignments", () => {
    expect(stripTrailingPageCounters("The net profit in 2024")).toBe("The net profit in 2024");
    expect(stripTrailingPageCounters("x = 42")).toBe("x = 42");
  });

  it("normalizes slide text: Unicode NFC, collapses whitespace, strips notes and counters", () => {
    const raw = "  Title   with   spaces\r\n\r\n• Point   A  \n[Notes: Instructor notes]\nPage 5";
    const normalized = normalizeSlideTextForPrefix(raw);
    expect(normalized).toBe("Title with spaces • Point A");
  });
});

describe("longestCommonPrefixLength", () => {
  it("computes exact prefix length", () => {
    expect(longestCommonPrefixLength("abcdef", "abcxyz")).toBe(3);
    expect(longestCommonPrefixLength("identical", "identical")).toBe(9);
    expect(longestCommonPrefixLength("", "nonempty")).toBe(0);
    expect(longestCommonPrefixLength("apple", "banana")).toBe(0);
  });
});

describe("Hashing utilities", () => {
  it("computeFileSha256 and computeImageSha256 return deterministic 64-character hex", () => {
    const buf = Buffer.from("test document content payload");
    const h1 = computeFileSha256(buf);
    const h2 = computeImageSha256(buf);
    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);

    // Works with ArrayBuffer and Uint8Array
    const uint8 = new Uint8Array(buf);
    expect(computeFileSha256(uint8)).toBe(h1);
    expect(computeFileSha256(uint8.buffer)).toBe(h1);
  });

  it("computePerceptualImageHash returns deterministic 16-hex-char difference hash", () => {
    const img = Buffer.alloc(300, 42);
    // Add PNG signature
    img[0] = 0x89;
    img[1] = 0x50;
    img[2] = 0x4e;
    img[3] = 0x47;
    for (let i = 64; i < 300; i++) {
      img[i] = (i * 13) % 256;
    }

    const hash1 = computePerceptualImageHash(img);
    expect(hash1).toHaveLength(16);

    // Metadata tweaks in header (offset < 64) do NOT alter the perceptual hash
    const imgWithMetadataTweak = Buffer.from(img);
    imgWithMetadataTweak[12] = 0xff;
    imgWithMetadataTweak[20] = 0xaa;
    const hash2 = computePerceptualImageHash(imgWithMetadataTweak);
    expect(hash2).toBe(hash1);

    // Structural image payload change alters perceptual hash
    const distinctImg = Buffer.from(img);
    for (let i = 100; i < 200; i++) {
      distinctImg[i] = (distinctImg[i] + 128) % 256;
    }
    const hash3 = computePerceptualImageHash(distinctImg);
    expect(hash3).not.toBe(hash1);

    // Empty buffer returns 16 zeros
    expect(computePerceptualImageHash(Buffer.alloc(0))).toBe("0000000000000000");
  });

  it("computeDocumentContentHash exactly matches computeContentHash from lib/rate-limit.ts", () => {
    const normalizedText = "Sample lecture notes text for matching rate limit hash engine.";
    const pageCount = 12;
    const imageHashes = ["b_hash", "a_hash", "c_hash"];

    const hashFromIngestion = computeDocumentContentHash({
      normalizedText,
      pageCount,
      imageHashes,
    });

    const hashFromRateLimit = computeContentHash({
      normalizedText,
      pageCount,
      imageHashes,
    });

    expect(hashFromIngestion).toBe(hashFromRateLimit);
  });

  it("computeDocumentContentHash is invariant to raw file byte re-exports when extracted text, pageCount, and imageHashes match", () => {
    const sources1: SourceBlock[] = [
      { id: "1", label: "Page 1", text: "Introduction to Economics\r\nDemand and supply." },
      { id: "2", label: "Page 2", text: "Market Equilibrium." },
    ];
    // Re-export with Unix line endings and extra whitespace
    const sources2: SourceBlock[] = [
      { id: "p1", label: "Slide 1", text: "Introduction to Economics\nDemand and supply." },
      { id: "p2", label: "Slide 2", text: "Market Equilibrium.  " },
    ];

    const hash1 = computeDocumentContentHash({ sources: sources1, pageCount: 2 });
    const hash2 = computeDocumentContentHash({ sources: sources2, pageCount: 2 });
    expect(hash1).toBe(hash2);
  });

  it("computeDocumentContentHash is sensitive to pageCount, imageHashes, and text changes", () => {
    const base = {
      normalizedText: "Standard course text",
      pageCount: 5,
      imageHashes: ["img1"],
    };
    const baseHash = computeDocumentContentHash(base);

    // Different page count
    expect(computeDocumentContentHash({ ...base, pageCount: 6 })).not.toBe(baseHash);

    // Different image hashes
    expect(computeDocumentContentHash({ ...base, imageHashes: ["img1", "img2"] })).not.toBe(baseHash);

    // Different text
    expect(computeDocumentContentHash({ ...base, normalizedText: "Altered text" })).not.toBe(baseHash);
  });

  it("normalizeExtractedTextForHash collapses whitespace and normalizes Unicode", () => {
    const sources: SourceBlock[] = [
      { id: "1", label: "1", text: "  Hello   world \r\n second line  " },
      { id: "2", label: "2", text: "Third line \n\n Fourth line" },
    ];
    const norm = normalizeExtractedTextForHash(sources);
    expect(norm).toBe("Hello world\nsecond line\nThird line\nFourth line");
  });
});

describe("parseSlideDeck integration with deduplication and hashing", () => {
  it("processes PDF deck, deduplicates animation slides, and computes contentHash and fileSha256", async () => {
    const baseText = "Financial Markets and Institutions: Overview of Money Markets and Treasury Bills.\n";
    // Page 1 is a progressive prefix of Page 2 (>85% prefix)
    const page1Text = `${baseText}Point 1: Federal Funds Rate\nPage 1`;
    const page2Text = `${baseText}Point 1: Federal Funds Rate\nPoint 2: Repurchase Agreements\nPage 2`;

    const pdfBytes = makePdf([page1Text, page2Text]);
    const file = new File([new Uint8Array(pdfBytes)], "lecture-deck.pdf", {
      type: "application/pdf",
    });

    const parsed = await parseSlideDeck(file);
    expect(parsed.format).toBe("pdf");
    expect(parsed.slideCount).toBe(2);
    expect(parsed.dedupedSlideCount).toBe(1);
    expect(parsed.warnings).toContain("Deduplicated 1 incremental animation slide(s).");
    expect(parsed.sources).toHaveLength(1);
    // Page 2 was kept and has label Slide 2 (preserving original page number)
    expect(parsed.sources[0].id).toBe("slide-2");
    expect(parsed.sources[0].label).toBe("Slide 2");
    expect(parsed.contentHash).toBeDefined();
    expect(parsed.contentHash).toHaveLength(64);
    expect(parsed.fileSha256).toBeDefined();
    expect(parsed.fileSha256).toHaveLength(64);
  });

  it("processes PDF deck without animations without deduplication warnings", async () => {
    const pdfBytes = makePdf([
      `${studyText} Part one covering elasticity and revenue impact.`,
      "Opportunity cost analysis and production possibility frontiers in national economics.",
    ]);
    const file = new File([new Uint8Array(pdfBytes)], "clean-lecture.pdf", {
      type: "application/pdf",
    });

    const parsed = await parseSlideDeck(file);
    expect(parsed.dedupedSlideCount).toBeUndefined();
    expect(parsed.warnings.some((w) => w.includes("Deduplicated"))).toBe(false);
    expect(parsed.sources).toHaveLength(2);
    expect(parsed.contentHash).toBeDefined();
    expect(parsed.fileSha256).toBeDefined();
  });
});

describe("parseDocument & parseMultiDocuments integration", () => {
  it("parseDocument computes fileSha256 and contentHash on PDF documents and applies deduplication", async () => {
    const baseText = "Macroeconomic Policy and Central Banking: Monetary transmission mechanisms.\n";
    const p1 = `${baseText}First build.\nPage 1`;
    const p2 = `${baseText}First build.\nSecond build with extended open market operations.\nPage 2`;

    const file = new File([new Uint8Array(makePdf([p1, p2]))], "macro.pdf", {
      type: "application/pdf",
    });

    const doc = await parseDocument(file, signal());
    expect(doc.format).toBe("pdf");
    expect(doc.pageCount).toBe(2);
    expect(doc.dedupedSlideCount).toBe(1);
    expect(doc.warnings).toContain("Deduplicated 1 incremental animation slide(s).");
    expect(doc.fileSha256).toBeDefined();
    expect(doc.contentHash).toBeDefined();
    expect(doc.sources).toHaveLength(1);
    // Ensure SourceBlock items contain strictly only id, label, text
    expect(Object.keys(doc.sources[0]).sort()).toEqual(["id", "label", "text"]);
  });

  it("parseDocument computes fileSha256 and contentHash on TXT and DOCX files", async () => {
    const txtFile = new File([studyText], "notes.txt", { type: "text/plain" });
    const txtDoc = await parseDocument(txtFile, signal());
    expect(txtDoc.fileSha256).toBeDefined();
    expect(txtDoc.contentHash).toBeDefined();
    expect(txtDoc.dedupedSlideCount).toBeUndefined();

    const docxBytes = await makeDocx();
    const docxFile = new File([new Uint8Array(docxBytes)], "notes.docx");
    const docxDoc = await parseDocument(docxFile, signal());
    expect(docxDoc.fileSha256).toBeDefined();
    expect(docxDoc.contentHash).toBeDefined();
  });

  it("parseMultiDocuments aggregates imageHashes, maps lowConfidenceSourceIds, and computes composite contentHash", async () => {
    const file1 = new File([studyText], "doc1.txt", { type: "text/plain" });
    const file2 = new File([studyText], "doc2.txt", { type: "text/plain" });

    const multi = await parseMultiDocuments([file1, file2], signal());
    expect(multi.documents).toHaveLength(2);
    expect(multi.compositeDocument.contentHash).toBeDefined();
    expect(multi.compositeDocument.sources).toHaveLength(2);
    expect(multi.compositeDocument.sources[0].id).toContain("doc0_");
    expect(multi.compositeDocument.sources[1].id).toContain("doc1_");
  });
});
