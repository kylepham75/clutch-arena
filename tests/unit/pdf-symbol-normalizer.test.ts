import { describe, expect, it } from "vitest";
import {
  normalizePdfArrowSymbols,
  normalizePdfMathSymbols,
} from "@/lib/notes/pdf-symbol-normalizer";

describe("normalizePdfMathSymbols", () => {
  describe("empty or falsy inputs", () => {
    it("handles empty string and falsy input safely", () => {
      expect(normalizePdfMathSymbols("")).toBe("");
      // @ts-expect-error test runtime boundary with non-string falsy
      expect(normalizePdfMathSymbols(null)).toBe("");
      // @ts-expect-error test runtime boundary with non-string falsy
      expect(normalizePdfMathSymbols(undefined)).toBe("");
    });
  });

  describe("arrow symbol normalization", () => {
    it("normalizes upward arrows", () => {
      expect(normalizePdfMathSymbols("\uF0E1")).toBe("↑");
      expect(normalizePdfMathSymbols("\uF0D9")).toBe("↑");
      expect(normalizePdfMathSymbols("\uF0AD")).toBe("↑");
      expect(normalizePdfMathSymbols("\u25B2")).toBe("↑");
      expect(normalizePdfMathSymbols("\u2191")).toBe("↑");
      expect(normalizePdfMathSymbols("Price \uF0E1 trending up")).toBe("Price ↑ trending up");
    });

    it("normalizes downward arrows", () => {
      expect(normalizePdfMathSymbols("\uF0E2")).toBe("↓");
      expect(normalizePdfMathSymbols("\uF0DA")).toBe("↓");
      expect(normalizePdfMathSymbols("\uF0AF")).toBe("↓");
      expect(normalizePdfMathSymbols("\u25BC")).toBe("↓");
      expect(normalizePdfMathSymbols("\u2193")).toBe("↓");
      expect(normalizePdfMathSymbols("Costs \uF0E2 decreasing")).toBe("Costs ↓ decreasing");
    });

    it("normalizes rightward arrows", () => {
      expect(normalizePdfMathSymbols("\uF0E0")).toBe("→");
      expect(normalizePdfMathSymbols("\uF0AE")).toBe("→");
      expect(normalizePdfMathSymbols("\uF0E8")).toBe("→");
      expect(normalizePdfMathSymbols("\u2192")).toBe("→");
      expect(normalizePdfMathSymbols("A \uF0E0 B")).toBe("A → B");
    });

    it("normalizes leftward arrows", () => {
      expect(normalizePdfMathSymbols("\uF0DF")).toBe("←");
      expect(normalizePdfMathSymbols("\uF0AC")).toBe("←");
      expect(normalizePdfMathSymbols("\u2190")).toBe("←");
      expect(normalizePdfMathSymbols("B \uF0DF A")).toBe("B ← A");
    });

    it("normalizes double rightward arrows (implies)", () => {
      expect(normalizePdfMathSymbols("\uF0DC")).toBe("⇒");
      expect(normalizePdfMathSymbols("\u21D2")).toBe("⇒");
      expect(normalizePdfMathSymbols("P \uF0DC Q")).toBe("P ⇒ Q");
    });
  });

  describe("math operators and Pearson textbook PUA characters", () => {
    it("normalizes multiplication and division signs", () => {
      expect(normalizePdfMathSymbols("3 \uF0B4 4 \uF03D 12")).toBe("3 × 4 = 12");
      expect(normalizePdfMathSymbols("10 \uF0D7 2")).toBe("10 × 2");
      expect(normalizePdfMathSymbols("12 \uF0B8 3 \uF03D 4")).toBe("12 ÷ 3 = 4");
      expect(normalizePdfMathSymbols("20 \uF0D8 5")).toBe("20 ÷ 5");
    });

    it("normalizes summation, product, and square root symbols", () => {
      expect(normalizePdfMathSymbols("\uF0E5_{i=1}^n x_i")).toBe("∑_{i=1}^n x_i");
      expect(normalizePdfMathSymbols("\uF0D5_{i=1}^n P(x_i)")).toBe("∏_{i=1}^n P(x_i)");
      expect(normalizePdfMathSymbols("\uF0D6(x^2 + y^2)")).toBe("√(x^2 + y^2)");
    });

    it("normalizes bracket delimiters and parenthesis", () => {
      expect(normalizePdfMathSymbols("\uF028x + 1\uF029")).toBe("(x + 1)");
      expect(normalizePdfMathSymbols("\uF05B0, 1\uF05D")).toBe("[0, 1]");
      expect(normalizePdfMathSymbols("\uF07Ba, b\uF07D")).toBe("{a, b}");
    });

    it("normalizes comparison, equality, calculus, and relation operators", () => {
      expect(normalizePdfMathSymbols("x \uF02D y \uF02B z")).toBe("x − y + z");
      expect(normalizePdfMathSymbols("x \uF0B1 5")).toBe("x ± 5");
      expect(normalizePdfMathSymbols("a \uF0B9 b")).toBe("a ≠ b");
      expect(normalizePdfMathSymbols("x \uF0A3 10 \uF0B3 0")).toBe("x ≤ 10 ≥ 0");
      expect(normalizePdfMathSymbols("y \uF0BB 3.14")).toBe("y ≈ 3.14");
      expect(normalizePdfMathSymbols("\uF0F2 f(x)dx")).toBe("∫ f(x)dx");
      expect(normalizePdfMathSymbols("\uF0B6f / \uF0B6x")).toBe("∂f / ∂x");
      expect(normalizePdfMathSymbols("lim x \uF0E0 \uF0A5")).toBe("lim x → ∞");
    });
  });

  describe("Greek letters normalization", () => {
    it("normalizes lowercase Greek letters", () => {
      expect(normalizePdfMathSymbols("\uF061 + \uF062 = \uF067")).toBe("α + β = γ");
      expect(normalizePdfMathSymbols("\uF063 \uF064 \uF065 \uF066")).toBe("χ δ ε φ");
      expect(normalizePdfMathSymbols("\uF068 \uF06B \uF06C \uF06D")).toBe("η κ λ μ");
      expect(normalizePdfMathSymbols("\uF070 \uF071 \uF072 \uF073 \uF074 \uF077")).toBe("π θ ρ σ τ ω");
    });

    it("normalizes uppercase Greek letters", () => {
      expect(normalizePdfMathSymbols("\uF044x \uF053y \uF057")).toBe("Δx Σy Ω");
    });
  });

  describe("unmapped PUA and replacement character handling", () => {
    it("replaces unmapped PUA codepoints and replacement characters with spaces and collapses extra spaces", () => {
      // \uE000 and \uF800 are unmapped PUA codepoints
      expect(normalizePdfMathSymbols("Hello\uE000World")).toBe("Hello World");
      expect(normalizePdfMathSymbols("Value:\uFFFD\uFFFD42")).toBe("Value: 42");
      expect(normalizePdfMathSymbols("A\uE123\uF789B")).toBe("A B");
    });
  });

  describe("ASCII control characters and whitespace sanitization", () => {
    it("strips ASCII control characters while preserving newlines", () => {
      expect(normalizePdfMathSymbols("Hello\x00\x07\x08World\x1F")).toBe("HelloWorld");
      expect(normalizePdfMathSymbols("Line 1\nLine 2\n\nLine 3")).toBe("Line 1\nLine 2\n\nLine 3");
    });

    it("converts tabs, vertical tabs, form feeds, and carriage returns cleanly", () => {
      expect(normalizePdfMathSymbols("Col1\tCol2\tCol3")).toBe("Col1 Col2 Col3");
      expect(normalizePdfMathSymbols("Header\r\nBody\r\nFooter")).toBe("Header\nBody\nFooter");
      expect(normalizePdfMathSymbols("Page1\fPage2\vSection")).toBe("Page1 Page2 Section");
    });

    it("collapses multiple horizontal spaces without collapsing newlines", () => {
      expect(normalizePdfMathSymbols("Word1    Word2   Word3")).toBe("Word1 Word2 Word3");
      expect(normalizePdfMathSymbols("Line 1   \n   Line 2")).toBe("Line 1 \n Line 2");
    });
  });

  describe("Vietnamese language preservation", () => {
    it("strictly preserves Vietnamese accents and diacritics", () => {
      const vietnameseText =
        "Chào mừng bạn đến với Clutch Arena: Đại học Bách Khoa Hà Nội.\n" +
        "Ví dụ: giải phương trình bậc hai ax² + bx + c = 0 khi \uF044 = b² \uF02D 4ac \uF0B3 0.";
      const expected =
        "Chào mừng bạn đến với Clutch Arena: Đại học Bách Khoa Hà Nội.\n" +
        "Ví dụ: giải phương trình bậc hai ax² + bx + c = 0 khi Δ = b² − 4ac ≥ 0.";
      expect(normalizePdfMathSymbols(vietnameseText)).toBe(expected);
    });

    it("preserves tone marks across all Vietnamese vowels", () => {
      const vowels = "a à á ả ã ạ ă ằ ắ ẳ ẵ ặ â ầ ấ ẩ ẫ ậ e è é ẻ ẽ ẹ ê ề ế ể ễ ệ i ì í ỉ ĩ ị o ò ó ỏ õ ọ ô ồ ố ổ ỗ ộ ơ ờ ớ ở ỡ ợ u ù ú ủ ũ ụ ư ừ ứ ử ữ ự y ỳ ý ỷ ỹ ỵ đ";
      expect(normalizePdfMathSymbols(vowels)).toBe(vowels);
    });
  });

  describe("normalizePdfArrowSymbols alias backwards compatibility", () => {
    it("behaves identically to normalizePdfMathSymbols", () => {
      expect(normalizePdfArrowSymbols("\uF0E1")).toBe("↑");
      expect(normalizePdfArrowSymbols("\uF0B4")).toBe("×");
      expect(normalizePdfArrowSymbols("A \uF0E0 B")).toBe("A → B");
      expect(normalizePdfArrowSymbols("")).toBe("");
    });
  });
});
