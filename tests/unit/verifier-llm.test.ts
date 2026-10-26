import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateObject, type LanguageModel } from "ai";
import {
  extractVerifiableClaimsFromNote,
  buildVerifierPrompt,
  deterministicFallbackCheck,
  verifyNoteClaimsWithLlm,
  extractSignificantTokens,
  VERIFIER_SYSTEM_PROMPT,
  type VerifiableNoteClaim,
} from "@/lib/notes/verifier-llm";
import type { NoteSection } from "@/lib/schemas/notes";
import type { SourceBlock } from "@/lib/schemas/ingestion";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

const mockModel = {} as unknown as LanguageModel;

function createMockSection(
  overrides: Partial<NoteSection> & { id: string; letter: string; titleVi: string },
): NoteSection {
  return {
    titleEn: "",
    overview: "",
    bulletPoints: [],
    formulas: [],
    subSections: [],
    keyTakeaways: null,
    sourceSlides: [],
    ...overrides,
  };
}

describe("verifier-llm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractSignificantTokens", () => {
    it("extracts content words while stripping stop words and symbols", () => {
      const tokens = extractSignificantTokens(
        "The Gordon Growth Model requires that g < R for the stock valuation",
      );
      expect(tokens).toContain("gordon");
      expect(tokens).toContain("growth");
      expect(tokens).toContain("model");
      expect(tokens).toContain("requires");
      expect(tokens).toContain("stock");
      expect(tokens).toContain("valuation");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("that");
      expect(tokens).not.toContain("for");
    });

    it("handles Vietnamese text and stop words correctly", () => {
      const tokens = extractSignificantTokens(
        "Mô hình chiết khấu cổ tức của doanh nghiệp",
      );
      expect(tokens).toContain("mô");
      expect(tokens).toContain("hình");
      expect(tokens).toContain("chiết");
      expect(tokens).toContain("khấu");
      expect(tokens).toContain("cổ");
      expect(tokens).toContain("tức");
      expect(tokens).toContain("doanh");
      expect(tokens).toContain("nghiệp");
      expect(tokens).not.toContain("của");
    });

    it("returns empty array for empty string or whitespace", () => {
      expect(extractSignificantTokens("")).toEqual([]);
      expect(extractSignificantTokens("   ")).toEqual([]);
    });
  });

  describe("extractVerifiableClaimsFromNote", () => {
    it("extracts sequential deterministic claim IDs across coreStatement, groundedBullets, subSections, and takeaways", () => {
      const mockSections: NoteSection[] = [
        createMockSection({
          id: "sec-1",
          letter: "A",
          titleVi: "NGUYÊN LÝ CƠ BẢN",
          titleEn: "Basic Principles",
          coreStatement: "The value of any asset is the PV of expected future cash flows.",
          overview: "Overview intro",
          bulletPoints: [],
          groundedBullets: [
            {
              text: "Dividends represent direct cash distribution to equity owners.",
              slide: 2,
              evidence: "Dividends: regular direct cash distribution",
            },
            {
              text: "Capital gains represent share price appreciation over time.",
              slide: 3,
              evidence: "Capital gains: share price appreciation",
            },
          ],
          subSections: [
            {
              heading: "CASE 1: Zero Growth Model",
              leadIn: "For preferred stock:",
              bulletPoints: [],
              groundedBullets: [
                {
                  text: "Dividends remain constant forever like a perpetuity.",
                  slide: 4,
                  evidence: "Dividend is constant like perpetuity",
                },
              ],
              formulas: [],
            },
          ],
          keyTakeaways: {
            title: "KEY TAKEAWAYS",
            items: [
              {
                point: "Ensure g < R, otherwise the denominator becomes negative.",
                subBullets: [],
                slide: 5,
                evidence: "Condition: g < R is strictly required",
              },
            ],
            summaryPoints: [],
          },
          sourceSlides: [2, 3, 4, 5],
        }),
      ];

      const claims = extractVerifiableClaimsFromNote(mockSections);

      expect(claims).toHaveLength(5);
      expect(claims[0]).toEqual({
        claimId: "C1",
        sectionLetter: "A",
        kind: "coreStatement",
        text: "The value of any asset is the PV of expected future cash flows.",
        slide: 2,
      });

      expect(claims[1]).toEqual({
        claimId: "C2",
        sectionLetter: "A",
        kind: "bullet",
        bulletIndex: 0,
        text: "Dividends represent direct cash distribution to equity owners.",
        slide: 2,
        evidence: "Dividends: regular direct cash distribution",
      });

      expect(claims[2]).toEqual({
        claimId: "C3",
        sectionLetter: "A",
        kind: "bullet",
        bulletIndex: 1,
        text: "Capital gains represent share price appreciation over time.",
        slide: 3,
        evidence: "Capital gains: share price appreciation",
      });

      expect(claims[3]).toEqual({
        claimId: "C4",
        sectionLetter: "A",
        subHeading: "CASE 1: Zero Growth Model",
        kind: "bullet",
        bulletIndex: 0,
        text: "Dividends remain constant forever like a perpetuity.",
        slide: 4,
        evidence: "Dividend is constant like perpetuity",
      });

      expect(claims[4]).toEqual({
        claimId: "C5",
        sectionLetter: "A",
        kind: "takeaway",
        takeawayIndex: 0,
        text: "Ensure g < R, otherwise the denominator becomes negative.",
        slide: 5,
        evidence: "Condition: g < R is strictly required",
      });
    });

    it("falls back to bulletPoints when groundedBullets is empty", () => {
      const mockSections: NoteSection[] = [
        createMockSection({
          id: "sec-2",
          letter: "B",
          titleVi: "MÔ HÌNH TĂNG TRƯỞNG",
          bulletPoints: [
            "Constant dividend growth model assumes perpetual rate g.",
            "Supernormal growth requires a two-stage DCF approach.",
          ],
          subSections: [
            {
              heading: "Two-stage growth",
              bulletPoints: ["Stage 1 uses explicit dividend forecasts."],
              formulas: [],
            },
          ],
          sourceSlides: [7],
        }),
      ];

      const claims = extractVerifiableClaimsFromNote(mockSections);
      expect(claims).toHaveLength(3);
      expect(claims[0]).toEqual({
        claimId: "C1",
        sectionLetter: "B",
        kind: "bullet",
        bulletIndex: 0,
        text: "Constant dividend growth model assumes perpetual rate g.",
        slide: 7,
      });
      expect(claims[1]).toEqual({
        claimId: "C2",
        sectionLetter: "B",
        kind: "bullet",
        bulletIndex: 1,
        text: "Supernormal growth requires a two-stage DCF approach.",
        slide: 7,
      });
      expect(claims[2]).toEqual({
        claimId: "C3",
        sectionLetter: "B",
        subHeading: "Two-stage growth",
        kind: "bullet",
        bulletIndex: 0,
        text: "Stage 1 uses explicit dividend forecasts.",
        slide: 7,
      });
    });

    it("defaults to slide 1 when sourceSlides is missing or empty", () => {
      const mockSections: NoteSection[] = [
        createMockSection({
          id: "sec-3",
          letter: "C",
          titleVi: "TỔNG KẾT",
          coreStatement: "Overview principle without slide list.",
          bulletPoints: ["Bullet point without slide."],
        }),
      ];

      const claims = extractVerifiableClaimsFromNote(mockSections);
      expect(claims).toHaveLength(2);
      expect(claims[0].slide).toBe(1);
      expect(claims[1].slide).toBe(1);
    });

    it("skips empty and whitespace-only statements and bullets", () => {
      const mockSections: NoteSection[] = [
        createMockSection({
          id: "sec-4",
          letter: "D",
          titleVi: "TRỐNG",
          coreStatement: "   ",
          bulletPoints: ["   ", ""],
        }),
      ];

      const claims = extractVerifiableClaimsFromNote(mockSections);
      expect(claims).toHaveLength(0);
    });
  });

  describe("buildVerifierPrompt", () => {
    it("formats slides, claims, and security instruction delimiters", () => {
      const claims: VerifiableNoteClaim[] = [
        {
          claimId: "C1",
          sectionLetter: "A",
          kind: "coreStatement",
          text: "Price equals discounted future dividends",
          slide: 1,
        },
        {
          claimId: "C2",
          sectionLetter: "A",
          subHeading: "Model conditions",
          kind: "bullet",
          text: "g must be smaller than R",
          slide: 2,
          evidence: "Requirement: g < R",
        },
      ];

      const sources: SourceBlock[] = [
        {
          id: "slide_1",
          label: "Slide 1",
          text: "Stock Valuation: Price = PV of dividends.",
        },
        {
          id: "slide_2",
          label: "Slide 2",
          text: "Gordon Model Requirement: g < R.",
        },
      ];

      const prompt = buildVerifierPrompt(claims, sources);

      expect(prompt).toContain("<slides>");
      expect(prompt).toContain("</slides>");
      expect(prompt).toContain("=== SLIDE 1 [Slide 1] ===");
      expect(prompt).toContain("Stock Valuation: Price = PV of dividends.");
      expect(prompt).toContain("=== SLIDE 2 [Slide 2] ===");
      expect(prompt).toContain("Gordon Model Requirement: g < R.");

      expect(prompt).toContain("<claims_to_verify>");
      expect(prompt).toContain("</claims_to_verify>");
      expect(prompt).toContain(
        "[C1] (Slide 1, coreStatement): Price equals discounted future dividends",
      );
      expect(prompt).toContain(
        '[C2] (Slide 2, bullet [Model conditions]): g must be smaller than R | evidence="Requirement: g < R"',
      );

      expect(prompt).toContain("SECURITY INSTRUCTION:");
      expect(prompt).toContain("untrusted input data");
    });

    it("handles empty sources and claims gracefully", () => {
      const prompt = buildVerifierPrompt([], []);
      expect(prompt).toContain("(No slides provided)");
      expect(prompt).toContain("(No claims provided)");
    });
  });

  describe("deterministicFallbackCheck", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide_1",
        label: "Slide 1",
        text: "The Gordon Growth Model assumes dividends grow at a constant rate g indefinitely.",
      },
      {
        id: "slide_2",
        label: "Slide 2",
        text: "Condition for Gordon model: discount rate R must exceed growth rate g (g < R).",
      },
    ];

    it("returns SUPPORTED when evidence quote matches verbatim", () => {
      const claim: VerifiableNoteClaim = {
        claimId: "C1",
        sectionLetter: "A",
        kind: "bullet",
        text: "The discount rate R must exceed growth rate g.",
        slide: 2,
        evidence: "discount rate R must exceed growth rate g",
      };

      const result = deterministicFallbackCheck(claim, sources);
      expect(result.verdict).toBe("SUPPORTED");
      expect(result.claimId).toBe("C1");
      expect(result.slide).toBe(2);
      expect(result.reason).toContain("matched verbatim");
    });

    it("returns SUPPORTED when evidence tokens match >= 50%", () => {
      const claim: VerifiableNoteClaim = {
        claimId: "C2",
        sectionLetter: "A",
        kind: "bullet",
        text: "Gordon Growth model assumes constant growth.",
        slide: 1,
        evidence: "Gordon Growth model constant dividends indefinitely",
      };

      const result = deterministicFallbackCheck(claim, sources);
      expect(result.verdict).toBe("SUPPORTED");
      expect(result.reason).toContain("Deterministic fallback: Evidence tokens");
    });

    it("returns SUPPORTED when text tokens match on slide without evidence", () => {
      const claim: VerifiableNoteClaim = {
        claimId: "C3",
        sectionLetter: "A",
        kind: "bullet",
        text: "discount rate R must exceed growth rate g",
        slide: 2,
      };

      const result = deterministicFallbackCheck(claim, sources);
      expect(result.verdict).toBe("SUPPORTED");
      expect(result.claimId).toBe("C3");
    });

    it("returns UNSUPPORTED when tokens do not match the slide", () => {
      const claim: VerifiableNoteClaim = {
        claimId: "C4",
        sectionLetter: "A",
        kind: "bullet",
        text: "Arbitrage Pricing Theory multi-factor macroeconomic beta regression",
        slide: 1,
      };

      const result = deterministicFallbackCheck(claim, sources);
      expect(result.verdict).toBe("UNSUPPORTED");
      expect(result.claimId).toBe("C4");
      expect(result.reason).toContain("not found on slide 1");
    });
  });

  describe("verifyNoteClaimsWithLlm", () => {
    const sources: SourceBlock[] = [
      {
        id: "slide_1",
        label: "Slide 1",
        text: "Stock value is the present value of all expected future dividends.",
      },
      {
        id: "slide_2",
        label: "Slide 2",
        text: "Gordon Model rule: required return R must be strictly greater than growth rate g (g < R).",
      },
    ];

    it("short-circuits without calling generateObject when note has zero claims", async () => {
      const report = await verifyNoteClaimsWithLlm({
        sections: [],
        sources,
        model: mockModel,
      });

      expect(report.claims).toEqual([]);
      expect(report.verdicts).toEqual([]);
      expect(report.supportedIds).toEqual([]);
      expect(report.unsupportedIds).toEqual([]);
      expect(report.contradictedIds).toEqual([]);
      expect(report.allSupported).toBe(true);
      expect(generateObject).not.toHaveBeenCalled();
    });

    it("returns allSupported = true when all claims receive SUPPORTED verdicts", async () => {
      const sections: NoteSection[] = [
        createMockSection({
          id: "sec-1",
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          coreStatement: "Stock value is the present value of future dividends.",
          groundedBullets: [
            {
              text: "Required return R must be strictly greater than g.",
              slide: 2,
              evidence: "required return R must be strictly greater than growth rate g",
            },
          ],
          sourceSlides: [1, 2],
        }),
      ];

      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          verdicts: [
            {
              claimId: "C1",
              slide: 1,
              verdict: "SUPPORTED",
              reason: "Directly matches slide 1 statement",
            },
            {
              claimId: "C2",
              slide: 2,
              verdict: "SUPPORTED",
              reason: "Directly matches slide 2 rule",
            },
          ],
        },
      } as any);

      const report = await verifyNoteClaimsWithLlm({
        sections,
        sources,
        model: mockModel,
      });

      expect(generateObject).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(generateObject).mock.calls[0][0];
      expect(callArgs.system).toBe(VERIFIER_SYSTEM_PROMPT);
      expect(callArgs.temperature).toBe(0);

      expect(report.allSupported).toBe(true);
      expect(report.supportedIds).toEqual(["C1", "C2"]);
      expect(report.unsupportedIds).toEqual([]);
      expect(report.contradictedIds).toEqual([]);
      expect(report.verdicts).toHaveLength(2);
      expect(report.verdicts[0].verdict).toBe("SUPPORTED");
      expect(report.verdicts[1].verdict).toBe("SUPPORTED");
    });

    it("correctly identifies UNSUPPORTED and CONTRADICTED claims and sets allSupported = false", async () => {
      const sections: NoteSection[] = [
        createMockSection({
          id: "sec-1",
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          coreStatement: "Stock value is the present value of future dividends.",
          groundedBullets: [
            {
              text: "Outside textbook claim about Black-Scholes option pricing.",
              slide: 1,
              evidence: "black scholes option formula",
            },
            {
              text: "Growth rate g can safely exceed discount rate R without limits.",
              slide: 2,
              evidence: "g can exceed R",
            },
          ],
          sourceSlides: [1, 2],
        }),
      ];

      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          verdicts: [
            {
              claimId: "C1",
              slide: 1,
              verdict: "SUPPORTED",
              reason: "Directly matches slide 1",
            },
            {
              claimId: "C2",
              slide: 1,
              verdict: "UNSUPPORTED",
              reason: "Black-Scholes is not mentioned anywhere in slide 1",
            },
            {
              claimId: "C3",
              slide: 2,
              verdict: "CONTRADICTED",
              reason: "Slide 2 explicitly requires g < R, reversing this violates model boundary",
            },
          ],
        },
      } as any);

      const report = await verifyNoteClaimsWithLlm({
        sections,
        sources,
        model: mockModel,
      });

      expect(report.allSupported).toBe(false);
      expect(report.supportedIds).toEqual(["C1"]);
      expect(report.unsupportedIds).toEqual(["C2"]);
      expect(report.contradictedIds).toEqual(["C3"]);
      expect(report.verdicts).toHaveLength(3);
    });

    it("falls back to deterministic check when LLM omits a claimId", async () => {
      const sections: NoteSection[] = [
        createMockSection({
          id: "sec-1",
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          coreStatement: "Stock value is the present value of all expected future dividends.",
          groundedBullets: [
            {
              text: "Unrelated outside topic about quantum computing.",
              slide: 1,
              evidence: "quantum physics computing",
            },
          ],
          sourceSlides: [1],
        }),
      ];

      // LLM only returns verdict for C1 and omits C2
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          verdicts: [
            {
              claimId: "C1",
              slide: 1,
              verdict: "SUPPORTED",
              reason: "Supported by slide 1",
            },
          ],
        },
      } as any);

      const report = await verifyNoteClaimsWithLlm({
        sections,
        sources,
        model: mockModel,
      });

      expect(report.claims).toHaveLength(2);
      expect(report.verdicts).toHaveLength(2);
      expect(report.verdicts[0].claimId).toBe("C1");
      expect(report.verdicts[0].verdict).toBe("SUPPORTED");

      // C2 was omitted by LLM; fallback ran and determined UNSUPPORTED because quantum computing is not on slide 1
      expect(report.verdicts[1].claimId).toBe("C2");
      expect(report.verdicts[1].verdict).toBe("UNSUPPORTED");
      expect(report.verdicts[1].reason).toContain("Deterministic fallback");
      expect(report.allSupported).toBe(false);
      expect(report.unsupportedIds).toEqual(["C2"]);
    });

    it("falls back to SUPPORTED when omitted claim has matching tokens on slide", async () => {
      const sections: NoteSection[] = [
        createMockSection({
          id: "sec-1",
          letter: "A",
          titleVi: "ĐỊNH GIÁ",
          coreStatement: "Stock value is the present value of all expected future dividends.",
          groundedBullets: [
            {
              text: "Discount rate R must exceed growth rate g",
              slide: 2,
              evidence: "required return R must be strictly greater than growth rate g",
            },
          ],
          sourceSlides: [1, 2],
        }),
      ];

      // LLM returns empty verdicts array
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          verdicts: [],
        },
      } as any);

      const report = await verifyNoteClaimsWithLlm({
        sections,
        sources,
        model: mockModel,
      });

      expect(report.claims).toHaveLength(2);
      expect(report.verdicts).toHaveLength(2);
      // Both claims exist on slides 1 and 2, so fallback marks both SUPPORTED
      expect(report.verdicts[0].verdict).toBe("SUPPORTED");
      expect(report.verdicts[1].verdict).toBe("SUPPORTED");
      expect(report.allSupported).toBe(true);
      expect(report.supportedIds).toEqual(["C1", "C2"]);
    });

    it("passes abortSignal to generateObject when provided", async () => {
      const controller = new AbortController();
      const sections: NoteSection[] = [
        createMockSection({
          id: "sec-1",
          letter: "A",
          titleVi: "TEST",
          coreStatement: "Test statement.",
          sourceSlides: [1],
        }),
      ];

      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          verdicts: [
            {
              claimId: "C1",
              slide: 1,
              verdict: "SUPPORTED",
              reason: "OK",
            },
          ],
        },
      } as any);

      await verifyNoteClaimsWithLlm({
        sections,
        sources,
        model: mockModel,
        signal: controller.signal,
      });

      expect(generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: controller.signal,
        }),
      );
    });
  });
});
