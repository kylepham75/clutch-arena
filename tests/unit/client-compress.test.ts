import { describe, it, expect, vi } from "vitest";
import {
  VERCEL_PAYLOAD_LIMIT_BYTES,
  optimizeUploadFileIfNeeded,
} from "@/lib/ingestion/client-compress";
import { parseTxt } from "@/lib/ingestion/parse-txt";

// Top-level mock for client-extract-slides
vi.mock("@/lib/notes/client-extract-slides", () => ({
  extractSlidesInBrowser: vi.fn().mockResolvedValue({
    fileName: "heavy-slides.pdf",
    slideCount: 2,
    sources: [
      {
        id: "slide-1",
        label: "Slide 1",
        text: "Introduction to Corporate Finance and Capital Structure",
      },
      {
        id: "slide-2",
        label: "Slide 2",
        text: "Weighted Average Cost of Capital (WACC) = (E/V)*Re + (D/V)*Rd*(1-Tc)",
      },
    ],
    warnings: [],
  }),
}));

describe("client-compress", () => {
  it("defines VERCEL_PAYLOAD_LIMIT_BYTES as 4.2 MB safe buffer", () => {
    expect(VERCEL_PAYLOAD_LIMIT_BYTES).toBe(4.2 * 1024 * 1024);
  });

  it("passes files <= 4.2 MB through without compression", async () => {
    const smallContent = "Hello world study material";
    const smallFile = new File([smallContent], "lecture.pdf", {
      type: "application/pdf",
    });

    const result = await optimizeUploadFileIfNeeded(smallFile);
    expect(result.wasCompressed).toBe(false);
    expect(result.file).toBe(smallFile);
  });

  it("extracts slides from > 4.2 MB PDF into a compact text file", async () => {
    // Create a dummy file with simulated large size
    const dummyBlob = new Blob(["dummy content"], { type: "application/pdf" });
    const largeFile = new File([dummyBlob], "heavy-slides.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(largeFile, "size", { value: 6 * 1024 * 1024 });

    const statusUpdates: string[] = [];
    const result = await optimizeUploadFileIfNeeded(
      largeFile,
      undefined,
      (msg) => statusUpdates.push(msg),
    );

    expect(result.wasCompressed).toBe(true);
    expect(result.file.name).toBe("heavy-slides.txt");
    expect(result.file.type).toBe("text/plain");

    const text = await result.file.text();
    expect(text).toContain("=== Slide 1 ===");
    expect(text).toContain("Introduction to Corporate Finance");
    expect(text).toContain("=== Slide 2 ===");
    expect(text).toContain("Weighted Average Cost of Capital");
  });

  it("parseTxt correctly parses slide headers into slide sources with matching IDs", () => {
    const slideText = `
=== Slide 1 ===
Introduction to Economics.
Scarcity is the fundamental economic problem.

=== Slide 2 ===
Demand and Supply.
Equilibrium occurs where quantity demanded equals quantity supplied.
`;
    const buffer = Buffer.from(slideText, "utf-8");
    const sources = parseTxt(buffer);

    expect(sources).toHaveLength(2);
    expect(sources[0].id).toBe("slide-1");
    expect(sources[0].label).toBe("Slide 1");
    expect(sources[0].text).toContain("Introduction to Economics");

    expect(sources[1].id).toBe("slide-2");
    expect(sources[1].label).toBe("Slide 2");
    expect(sources[1].text).toContain("Demand and Supply");
  });

  it("parseTxt falls back to 30-line chunks for normal unstructured text", () => {
    const lines = Array.from({ length: 45 }, (_, i) => `Paragraph line ${i + 1}`).join("\n");
    const buffer = Buffer.from(lines, "utf-8");
    const sources = parseTxt(buffer);

    expect(sources).toHaveLength(2);
    expect(sources[0].id).toBe("lines-1-30");
    expect(sources[0].label).toBe("Lines 1–30");
    expect(sources[1].id).toBe("lines-31-45");
    expect(sources[1].label).toBe("Lines 31–45");
  });
});
