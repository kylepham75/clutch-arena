import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { matchesText } from "@/lib/ai/generate-questions";

describe("resilient citation matching (matchesText)", () => {
  const sampleDoc = `
    Price elasticity of demand measures the responsiveness of quantity demanded
    to changes in price. It is defined as the absolute percentage change in quantity
    divided by the percentage change in price (|%ΔQ / %ΔP|). When this ratio is
    greater than 1, demand is elastic; when less than 1, demand is inelastic.
    Cross-price elasticity of demand measures how quantity demanded of one good
    responds to a price change in another good (%ΔQx / %ΔPy).
  `;

  it("matches exact text", () => {
    expect(
      matchesText(
        sampleDoc,
        "Price elasticity of demand measures the responsiveness of quantity demanded",
      ),
    ).toBe(true);
  });

  it("matches with smart quotes and dashes", () => {
    expect(
      matchesText(
        sampleDoc,
        "“Price elasticity of demand measures the responsiveness of quantity demanded”",
      ),
    ).toBe(true);
  });

  it("matches when ellipsis (...) is used to condense a quote", () => {
    expect(
      matchesText(
        sampleDoc,
        "Price elasticity of demand measures... absolute percentage change in quantity",
      ),
    ).toBe(true);
  });

  it("matches when punctuation, case or extra spacing differs", () => {
    expect(
      matchesText(
        sampleDoc,
        "When this ratio is greater than 1 demand is elastic when less than 1 demand is inelastic",
      ),
    ).toBe(true);
  });

  it("matches with minor word insertions or deletions via n-gram sequence shingles", () => {
    expect(
      matchesText(
        sampleDoc,
        "Cross price elasticity of demand measures how the quantity demanded of one good responds",
      ),
    ).toBe(true);
  });

  it("correctly rejects completely fabricated quotes (anti-hallucination guard)", () => {
    expect(
      matchesText(
        sampleDoc,
        "Artificial neural networks use backpropagation to optimize neural weights across layers.",
      ),
    ).toBe(false);
  });
});

describe("findSourceBlockByCitation (slide/page citation resolution)", () => {
  it("resolves exact page number and prevents substring collision of Page 1 on Page 18", async () => {
    const { findSourceBlockByCitation } = await import(
      "@/lib/game/citation-matching"
    );

    const sources = [
      { id: "page-1", label: "Page 1", text: "Cover slide: Chapter 9" },
      { id: "page-2", label: "Page 2", text: "Attendance slide" },
      { id: "page-10", label: "Page 10", text: "Common stock rights" },
      { id: "page-18", label: "Page 18", text: "Preferred stock (cổ phiếu ưu đãi) characteristics" },
    ];

    // English format
    const match18 = findSourceBlockByCitation(
      sources,
      "FOW18_CF_SS2_Slides_Chapter 9.pdf · Page 18",
    );
    expect(match18?.id).toBe("page-18");

    // Vietnamese format
    const matchVi18 = findSourceBlockByCitation(
      sources,
      "FOW18_CF_SS2_Slides_Chapter 9.pdf · Trang 18",
    );
    expect(matchVi18?.id).toBe("page-18");

    // Page 1 should still match page 1 cleanly
    const match1 = findSourceBlockByCitation(
      sources,
      "FOW18_CF_SS2_Slides_Chapter 9.pdf · Page 1",
    );
    expect(match1?.id).toBe("page-1");

    // Direct ID match
    const matchId = findSourceBlockByCitation(sources, "page-10");
    expect(matchId?.id).toBe("page-10");
  });
});
