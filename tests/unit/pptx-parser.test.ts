import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import {
  parsePptx,
  ommlToLatex,
  extractSlideXmlText,
  extractOmmlEquationsFromXml,
  detectSlideEquationCandidates,
  transcribeEquationImageWithGemini,
} from "@/lib/ingestion/parse-pptx";
import { validateSlideFile, parseSlideDeck } from "@/lib/notes/parse-slides";
import { IngestionError } from "@/lib/ingestion/errors";

describe("PowerPoint (.pptx) & Slide Parser", () => {
  it("rejects non-zip files as invalid presentation", async () => {
    const corruptBuffer = Buffer.from("NOT_A_VALID_PPTX_FILE");
    await expect(parsePptx(corruptBuffer)).rejects.toThrow(IngestionError);
  });

  it("extracts text from multiple slides in correct numerical order", async () => {
    const zip = new JSZip();

    // Slide 1 XML
    const slide1Xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:txBody>
          <a:p>
            <a:r><a:t>Lecture 5: Equity Valuation</a:t></a:r>
          </a:p>
          <a:p>
            <a:r><a:t>Corporate Finance FIN301</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    // Slide 2 XML with math text
    const slide2Xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <p:txBody>
          <a:p>
            <a:r><a:t>Gordon Constant Growth Formula:</a:t></a:r>
          </a:p>
          <a:p>
            <m:oMath>
              <m:r><m:t>P_0 = D_1 / (r - g)</m:t></m:r>
            </m:oMath>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    // Add in reverse to test numerical sorting
    zip.file("ppt/slides/slide2.xml", slide2Xml);
    zip.file("ppt/slides/slide1.xml", slide1Xml);

    const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await parsePptx(pptxBuffer);

    expect(result.pageCount).toBe(2);
    expect(result.sources.length).toBe(2);

    // Verify slide 1 comes first
    expect(result.sources[0].label).toBe("Slide 1");
    expect(result.sources[0].text).toContain("Lecture 5: Equity Valuation");

    // Verify slide 2 contains formula
    expect(result.sources[1].label).toBe("Slide 2");
    expect(result.sources[1].text).toContain("Gordon Constant Growth Formula");
    expect(result.sources[1].text).toContain("P_0 = D_1 / (r - g)");
  });

  it("extracts speaker notes when present in presentation", async () => {
    const zip = new JSZip();

    const slide1Xml = `<p:sp><p:txBody><a:p><a:r><a:t>Main Concept Slide</a:t></a:r></a:p></p:txBody></p:sp>`;
    const notes1Xml = `<p:sp><p:txBody><a:p><a:r><a:t>Make sure students remember that g must be less than r!</a:t></a:r></a:p></p:txBody></p:sp>`;

    zip.file("ppt/slides/slide1.xml", slide1Xml);
    zip.file("ppt/notesSlides/notesSlide1.xml", notes1Xml);

    const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await parsePptx(pptxBuffer);

    expect(result.sources[0].text).toContain("Main Concept Slide");
    expect(result.sources[0].text).toContain("[Notes: Make sure students remember that g must be less than r!]");
  });

  it("validates file size and format in validateSlideFile", () => {
    const validPdf = new File(["dummy pdf content"], "deck.pdf", { type: "application/pdf" });
    expect(validateSlideFile(validPdf)).toBe("pdf");

    const validPptx = new File(["dummy pptx content"], "deck.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(validateSlideFile(validPptx)).toBe("pptx");

    const invalidDoc = new File(["dummy docx content"], "notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(() => validateSlideFile(invalidDoc)).toThrow(IngestionError);

    // Test file size exceeding 25MB
    const oversized = new File(["a".repeat(26 * 1024 * 1024)], "huge.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(() => validateSlideFile(oversized)).toThrow(IngestionError);
  });
});

describe("Recursive OMML to LaTeX Converter (ommlToLatex)", () => {
  it("converts standard and linear fractions (<m:f>)", () => {
    const standardFraction = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:f>
          <m:num><m:r><m:t>D_1</m:t></m:r></m:num>
          <m:den><m:r><m:t>r - g</m:t></m:r></m:den>
        </m:f>
      </m:oMath>
    `;
    expect(ommlToLatex(standardFraction)).toBe("\\frac{D_1}{r - g}");

    const linearFraction = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:f>
          <m:fPr><m:type m:val="lin"/></m:fPr>
          <m:num><m:r><m:t>1</m:t></m:r></m:num>
          <m:den><m:r><m:t>2</m:t></m:r></m:den>
        </m:f>
      </m:oMath>
    `;
    expect(ommlToLatex(linearFraction)).toBe("{1}/{2}");
  });

  it("converts subscripts (<m:sSub>) with single and multi-character subscripts", () => {
    const singleCharSub = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSub>
          <m:e><m:r><m:t>P</m:t></m:r></m:e>
          <m:sub><m:r><m:t>0</m:t></m:r></m:sub>
        </m:sSub>
      </m:oMath>
    `;
    expect(ommlToLatex(singleCharSub)).toBe("P_0");

    const multiCharSub = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSub>
          <m:e><m:r><m:t>P</m:t></m:r></m:e>
          <m:sub><m:r><m:t>t-1</m:t></m:r></m:sub>
        </m:sSub>
      </m:oMath>
    `;
    expect(ommlToLatex(multiCharSub)).toBe("P_{t-1}");

    const greekSub = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSub>
          <m:e><m:r><m:t>σ</m:t></m:r></m:e>
          <m:sub><m:r><m:t>p</m:t></m:r></m:sub>
        </m:sSub>
      </m:oMath>
    `;
    expect(ommlToLatex(greekSub)).toBe("\\sigma_p");

    const multiCharGreekSub = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSub>
          <m:e><m:r><m:t>ρ</m:t></m:r></m:e>
          <m:sub><m:r><m:t>1,2</m:t></m:r></m:sub>
        </m:sSub>
      </m:oMath>
    `;
    expect(ommlToLatex(multiCharGreekSub)).toBe("\\rho_{1,2}");
  });

  it("converts superscripts (<m:sSup>) with single, multi-character, and parenthesized bases", () => {
    const singleCharSup = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSup>
          <m:e><m:r><m:t>R</m:t></m:r></m:e>
          <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
        </m:sSup>
      </m:oMath>
    `;
    expect(ommlToLatex(singleCharSup)).toBe("R^2");

    const parenthesizedSup = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSup>
          <m:e><m:r><m:t>(1 + R)</m:t></m:r></m:e>
          <m:sup><m:r><m:t>t</m:t></m:r></m:sup>
        </m:sSup>
      </m:oMath>
    `;
    expect(ommlToLatex(parenthesizedSup)).toBe("(1 + R)^t");

    const multiCharSup = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSup>
          <m:e><m:r><m:t>x</m:t></m:r></m:e>
          <m:sup><m:r><m:t>n+1</m:t></m:r></m:sup>
        </m:sSup>
      </m:oMath>
    `;
    expect(ommlToLatex(multiCharSup)).toBe("x^{n+1}");
  });

  it("converts combined sub-superscripts (<m:sSubSup>)", () => {
    const subSupXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSubSup>
          <m:e><m:r><m:t>σ</m:t></m:r></m:e>
          <m:sub><m:r><m:t>p</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
        </m:sSubSup>
      </m:oMath>
    `;
    expect(ommlToLatex(subSupXml)).toBe("\\sigma_p^2");

    const indexedSubSup = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSubSup>
          <m:e><m:r><m:t>x</m:t></m:r></m:e>
          <m:sub><m:r><m:t>i</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
        </m:sSubSup>
      </m:oMath>
    `;
    expect(ommlToLatex(indexedSubSup)).toBe("x_i^2");
  });

  it("converts n-ary operators (<m:nary>) for summation, product, and integrals", () => {
    const sumXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:nary>
          <m:naryPr><m:chr m:val="∑"/></m:naryPr>
          <m:sub><m:r><m:t>t=1</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>N</m:t></m:r></m:sup>
          <m:e><m:r><m:t>C_t</m:t></m:r></m:e>
        </m:nary>
      </m:oMath>
    `;
    expect(ommlToLatex(sumXml)).toBe("\\sum_{t=1}^{N} C_t");

    const prodXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:nary>
          <m:naryPr><m:chr m:val="∏"/></m:naryPr>
          <m:sub><m:r><m:t>i=1</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>n</m:t></m:r></m:sup>
          <m:e><m:r><m:t>(1 + R_i)</m:t></m:r></m:e>
        </m:nary>
      </m:oMath>
    `;
    expect(ommlToLatex(prodXml)).toBe("\\prod_{i=1}^{n} (1 + R_i)");

    // N-ary with hidden limits
    const hiddenLimXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:nary>
          <m:naryPr>
            <m:chr m:val="∫"/>
            <m:subHide m:val="1"/>
            <m:supHide m:val="1"/>
          </m:naryPr>
          <m:sub><m:r><m:t>a</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>b</m:t></m:r></m:sup>
          <m:e><m:r><m:t>f(x)dx</m:t></m:r></m:e>
        </m:nary>
      </m:oMath>
    `;
    expect(ommlToLatex(hiddenLimXml)).toBe("\\int f(x)dx");
  });

  it("converts radicals (<m:rad>) with degree hidden and nth root", () => {
    const sqrtXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:rad>
          <m:radPr><m:degHide m:val="1"/></m:radPr>
          <m:deg/>
          <m:e><m:r><m:t>x^2 + y^2</m:t></m:r></m:e>
        </m:rad>
      </m:oMath>
    `;
    expect(ommlToLatex(sqrtXml)).toBe("\\sqrt{x^2 + y^2}");

    const cubeRootXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:rad>
          <m:radPr><m:degHide m:val="0"/></m:radPr>
          <m:deg><m:r><m:t>3</m:t></m:r></m:deg>
          <m:e><m:r><m:t>27</m:t></m:r></m:e>
        </m:rad>
      </m:oMath>
    `;
    expect(ommlToLatex(cubeRootXml)).toBe("\\sqrt[3]{27}");
  });

  it("converts delimiters (<m:d>) for parentheses, brackets, braces, and vertical bars", () => {
    const parenXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:d>
          <m:e><m:r><m:t>a + b</m:t></m:r></m:e>
        </m:d>
      </m:oMath>
    `;
    expect(ommlToLatex(parenXml)).toBe("\\left(a + b\\right)");

    const bracketXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:d>
          <m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr>
          <m:e><m:r><m:t>0, 1</m:t></m:r></m:e>
        </m:d>
      </m:oMath>
    `;
    expect(ommlToLatex(bracketXml)).toBe("\\left[0, 1\\right]");

    const braceXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:d>
          <m:dPr><m:begChr m:val="{"/><m:endChr m:val="}"/></m:dPr>
          <m:e><m:r><m:t>x</m:t></m:r></m:e>
        </m:d>
      </m:oMath>
    `;
    expect(ommlToLatex(braceXml)).toBe("\\left\\{x\\right\\}");

    const absXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:d>
          <m:dPr><m:begChr m:val="|"/><m:endChr m:val="|"/></m:dPr>
          <m:e><m:r><m:t>x - y</m:t></m:r></m:e>
        </m:d>
      </m:oMath>
    `;
    expect(ommlToLatex(absXml)).toBe("\\left|x - y\\right|");

    const emptyRightDelimXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:d>
          <m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr>
          <m:e><m:r><m:t>x = 0</m:t></m:r></m:e>
        </m:d>
      </m:oMath>
    `;
    expect(ommlToLatex(emptyRightDelimXml)).toBe("\\left\\{x = 0\\right.");
  });

  it("converts functions, accents, bars, equation arrays, and matrices", () => {
    const funcXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:func>
          <m:fName><m:r><m:t>sin</m:t></m:r></m:fName>
          <m:e><m:r><m:t>θ</m:t></m:r></m:e>
        </m:func>
      </m:oMath>
    `;
    expect(ommlToLatex(funcXml)).toBe("\\sin \\theta");

    const accentXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:acc>
          <m:accPr><m:chr m:val="^"/></m:accPr>
          <m:e><m:r><m:t>x</m:t></m:r></m:e>
        </m:acc>
        <m:r><m:t> + </m:t></m:r>
        <m:bar>
          <m:e><m:r><m:t>y</m:t></m:r></m:e>
        </m:bar>
        <m:r><m:t> + </m:t></m:r>
        <m:acc>
          <m:accPr><m:chr m:val="→"/></m:accPr>
          <m:e><m:r><m:t>v</m:t></m:r></m:e>
        </m:acc>
      </m:oMath>
    `;
    expect(ommlToLatex(accentXml)).toBe("\\hat{x} + \\bar{y} + \\vec{v}");

    const eqArrXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:eqArr>
          <m:e><m:r><m:t>x + y = 10</m:t></m:r></m:e>
          <m:e><m:r><m:t>2x - y = 5</m:t></m:r></m:e>
        </m:eqArr>
      </m:oMath>
    `;
    expect(ommlToLatex(eqArrXml)).toBe("x + y = 10 \\\\ 2x - y = 5");

    const matrixXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:m>
          <m:mr>
            <m:e><m:r><m:t>a</m:t></m:r></m:e>
            <m:e><m:r><m:t>b</m:t></m:r></m:e>
          </m:mr>
          <m:mr>
            <m:e><m:r><m:t>c</m:t></m:r></m:e>
            <m:e><m:r><m:t>d</m:t></m:r></m:e>
          </m:mr>
        </m:m>
      </m:oMath>
    `;
    expect(ommlToLatex(matrixXml)).toBe("\\begin{matrix} a & b \\\\ c & d \\end{matrix}");
  });

  it("maps Unicode math symbols and Greek characters inside runs (<m:r>/<m:t>)", () => {
    const unicodeXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:r><m:t>α + β ≤ γ × δ ≠ ε ± θ ≈ λ · μ ÷ π − ∞</m:t></m:r>
      </m:oMath>
    `;
    const latex = ommlToLatex(unicodeXml);
    expect(latex).toContain("\\alpha");
    expect(latex).toContain("\\beta");
    expect(latex).toContain("\\le");
    expect(latex).toContain("\\gamma");
    expect(latex).toContain("\\times");
    expect(latex).toContain("\\delta");
    expect(latex).toContain("\\ne");
    expect(latex).toContain("\\epsilon");
    expect(latex).toContain("\\pm");
    expect(latex).toContain("\\theta");
    expect(latex).toContain("\\approx");
    expect(latex).toContain("\\lambda");
    expect(latex).toContain("\\cdot");
    expect(latex).toContain("\\mu");
    expect(latex).toContain("\\div");
    expect(latex).toContain("\\pi");
    expect(latex).toContain("-");
    expect(latex).toContain("\\infty");
  });

  it("converts deeply nested DDM summation with fractions and exponents", () => {
    // \sum_{t=1}^{N} \frac{D_t}{(1+R)^t} + \frac{P_N}{(1+R)^N}
    const ddmXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:nary>
          <m:naryPr><m:chr m:val="∑"/></m:naryPr>
          <m:sub><m:r><m:t>t=1</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>N</m:t></m:r></m:sup>
          <m:e>
            <m:f>
              <m:num>
                <m:sSub>
                  <m:e><m:r><m:t>D</m:t></m:r></m:e>
                  <m:sub><m:r><m:t>t</m:t></m:r></m:sub>
                </m:sSub>
              </m:num>
              <m:den>
                <m:sSup>
                  <m:e><m:r><m:t>(1+R)</m:t></m:r></m:e>
                  <m:sup><m:r><m:t>t</m:t></m:r></m:sup>
                </m:sSup>
              </m:den>
            </m:f>
          </m:e>
        </m:nary>
        <m:r><m:t> + </m:t></m:r>
        <m:f>
          <m:num>
            <m:sSub>
              <m:e><m:r><m:t>P</m:t></m:r></m:e>
              <m:sub><m:r><m:t>N</m:t></m:r></m:sub>
            </m:sSub>
          </m:num>
          <m:den>
            <m:sSup>
              <m:e><m:r><m:t>(1+R)</m:t></m:r></m:e>
              <m:sup><m:r><m:t>N</m:t></m:r></m:sup>
            </m:sSup>
          </m:den>
        </m:f>
      </m:oMath>
    `;
    const result = ommlToLatex(ddmXml);
    expect(result).toBe("\\sum_{t=1}^{N} \\frac{D_t}{(1+R)^t} + \\frac{P_N}{(1+R)^N}");
  });

  it("converts deeply nested portfolio standard deviation with sub-superscripts and radicals", () => {
    // \sigma_p = \sqrt{w_1^2 \sigma_1^2 + w_2^2 \sigma_2^2 + 2 w_1 w_2 \rho_{1,2} \sigma_1 \sigma_2}
    const portfolioXml = `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSub>
          <m:e><m:r><m:t>σ</m:t></m:r></m:e>
          <m:sub><m:r><m:t>p</m:t></m:r></m:sub>
        </m:sSub>
        <m:r><m:t> = </m:t></m:r>
        <m:rad>
          <m:radPr><m:degHide m:val="1"/></m:radPr>
          <m:e>
            <m:sSubSup>
              <m:e><m:r><m:t>w</m:t></m:r></m:e>
              <m:sub><m:r><m:t>1</m:t></m:r></m:sub>
              <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
            </m:sSubSup>
            <m:r><m:t> </m:t></m:r>
            <m:sSubSup>
              <m:e><m:r><m:t>σ</m:t></m:r></m:e>
              <m:sub><m:r><m:t>1</m:t></m:r></m:sub>
              <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
            </m:sSubSup>
            <m:r><m:t> + </m:t></m:r>
            <m:sSubSup>
              <m:e><m:r><m:t>w</m:t></m:r></m:e>
              <m:sub><m:r><m:t>2</m:t></m:r></m:sub>
              <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
            </m:sSubSup>
            <m:r><m:t> </m:t></m:r>
            <m:sSubSup>
              <m:e><m:r><m:t>σ</m:t></m:r></m:e>
              <m:sub><m:r><m:t>2</m:t></m:r></m:sub>
              <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
            </m:sSubSup>
            <m:r><m:t> + 2 w_1 w_2 </m:t></m:r>
            <m:sSub>
              <m:e><m:r><m:t>ρ</m:t></m:r></m:e>
              <m:sub><m:r><m:t>1,2</m:t></m:r></m:sub>
            </m:sSub>
            <m:r><m:t> </m:t></m:r>
            <m:sSub>
              <m:e><m:r><m:t>σ</m:t></m:r></m:e>
              <m:sub><m:r><m:t>1</m:t></m:r></m:sub>
            </m:sSub>
            <m:r><m:t> </m:t></m:r>
            <m:sSub>
              <m:e><m:r><m:t>σ</m:t></m:r></m:e>
              <m:sub><m:r><m:t>2</m:t></m:r></m:sub>
            </m:sSub>
          </m:e>
        </m:rad>
      </m:oMath>
    `;
    const result = ommlToLatex(portfolioXml);
    expect(result).toBe(
      "\\sigma_p = \\sqrt{w_1^2 \\sigma_1^2 + w_2^2 \\sigma_2^2 + 2 w_1 w_2 \\rho_{1,2} \\sigma_1 \\sigma_2}",
    );
  });
});

describe("Helper Functions: extractOmmlEquationsFromXml & extractSlideXmlText", () => {
  it("extracts all OMML equations with raw text and LaTeX from slide XML", () => {
    const slideXml = `
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r><a:t>Formula 1:</a:t></a:r>
            <m:oMath>
              <m:f>
                <m:num><m:r><m:t>A</m:t></m:r></m:num>
                <m:den><m:r><m:t>B</m:t></m:r></m:den>
              </m:f>
            </m:oMath>
          </a:p>
          <a:p>
            <a:r><a:t>Formula 2:</a:t></a:r>
            <m:oMath>
              <m:sSub>
                <m:e><m:r><m:t>P</m:t></m:r></m:e>
                <m:sub><m:r><m:t>0</m:t></m:r></m:sub>
              </m:sSub>
            </m:oMath>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    const equations = extractOmmlEquationsFromXml(slideXml);
    expect(equations.length).toBe(2);
    expect(equations[0]).toEqual({
      raw: "AB",
      latex: "\\frac{A}{B}",
    });
    expect(equations[1]).toEqual({
      raw: "P0",
      latex: "P_0",
    });
  });

  it("extracts mixed paragraphs preserving exact inline document order", () => {
    const mixedXml = `
      <a:p>
        <a:r><a:t>Where </a:t></a:r>
        <m:oMath>
          <m:sSub>
            <m:e><m:r><m:t>P</m:t></m:r></m:e>
            <m:sub><m:r><m:t>0</m:t></m:r></m:sub>
          </m:sSub>
        </m:oMath>
        <a:r><a:t> is the current price and </a:t></a:r>
        <m:oMath>
          <m:sSub>
            <m:e><m:r><m:t>D</m:t></m:r></m:e>
            <m:sub><m:r><m:t>1</m:t></m:r></m:sub>
          </m:sSub>
        </m:oMath>
        <a:r><a:t> is the next dividend.</a:t></a:r>
      </a:p>
    `;

    const text = extractSlideXmlText(mixedXml);
    expect(text).toBe("Where $P_0$ is the current price and $D_1$ is the next dividend.");
  });

  it("handles line breaks <a:br/> inside paragraphs", () => {
    const xmlWithBreak = `
      <a:p>
        <a:r><a:t>Line 1</a:t></a:r>
        <a:br/>
        <a:r><a:t>Line 2</a:t></a:r>
      </a:p>
    `;
    const text = extractSlideXmlText(xmlWithBreak);
    expect(text).toBe("Line 1\nLine 2");
  });

  it("parses full presentation containing complex OMML equations in parsePptx", async () => {
    const zip = new JSZip();

    const slide1Xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <p:txBody>
          <a:p>
            <a:r><a:t>Dividend Discount Model:</a:t></a:r>
          </a:p>
          <a:p>
            <m:oMath>
              <m:sSub><m:e><m:r><m:t>P</m:t></m:r></m:e><m:sub><m:r><m:t>0</m:t></m:r></m:sub></m:sSub>
              <m:r><m:t> = </m:t></m:r>
              <m:f>
                <m:num><m:sSub><m:e><m:r><m:t>D</m:t></m:r></m:e><m:sub><m:r><m:t>1</m:t></m:r></m:sub></m:sSub></m:num>
                <m:den><m:r><m:t>r - g</m:t></m:r></m:den>
              </m:f>
            </m:oMath>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    zip.file("ppt/slides/slide1.xml", slide1Xml);
    const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await parsePptx(pptxBuffer);

    expect(result.sources.length).toBe(1);
    expect(result.sources[0].text).toContain("Dividend Discount Model:");
    expect(result.sources[0].text).toContain("$P_0 = \\frac{D_1}{r - g}$");
  });
});

describe("Image & OLE Equation Detection and Vision Math Transcription (Roadmap 2.2)", () => {
  describe("detectSlideEquationCandidates", () => {
    it("detects <p:oleObj progId='Equation.3'> with fallback <p:pic> and resolves .rels to ppt/media/image1.png", () => {
      const slideXml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
            <mc:Choice Requires="v">
              <p:oleObj progId="Equation.3" r:id="rId2"/>
            </mc:Choice>
            <mc:Fallback>
              <p:pic>
                <p:nvPicPr>
                  <p:cNvPr id="5" name="Equation Object" descr="CAPM Equation Preview"/>
                </p:nvPicPr>
                <p:blipFill>
                  <a:blip r:embed="rId1"/>
                </p:blipFill>
              </p:pic>
            </mc:Fallback>
          </mc:AlternateContent>
        </p:sp>
      `;

      const relsXml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/>
        </Relationships>
      `;

      const candidates = detectSlideEquationCandidates(slideXml, relsXml, 1);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].slide).toBe(1);
      expect(candidates[0].kind).toBe("ole");
      expect(candidates[0].progId).toBe("Equation.3");
      expect(candidates[0].rId).toBe("rId1");
      expect(candidates[0].mediaPath).toBe("ppt/media/image1.png");
      expect(candidates[0].mimeType).toBe("image/png");
      expect(candidates[0].altText).toBe("CAPM Equation Preview");
    });

    it("detects <p:pic> with descr='Equation: CAPM formula' and with name='MathType Equation'", () => {
      const slideXml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:pic>
            <p:nvPicPr>
              <p:cNvPr id="10" name="Picture 1" descr="Equation: CAPM formula"/>
            </p:nvPicPr>
            <p:blipFill>
              <a:blip r:embed="rId1"/>
            </p:blipFill>
          </p:pic>
          <p:pic>
            <p:nvPicPr>
              <p:cNvPr id="11" name="MathType Equation" descr="WACC calculation"/>
            </p:nvPicPr>
            <p:blipFill>
              <a:blip r:embed="rId2"/>
            </p:blipFill>
          </p:pic>
        </p:sp>
      `;

      const relsXml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/capm.png"/>
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/wacc.png"/>
        </Relationships>
      `;

      const candidates = detectSlideEquationCandidates(slideXml, relsXml, 3);

      expect(candidates).toHaveLength(2);
      expect(candidates[0]).toMatchObject({
        slide: 3,
        kind: "image",
        rId: "rId1",
        mediaPath: "ppt/media/capm.png",
        mimeType: "image/png",
        altText: "Equation: CAPM formula",
      });
      expect(candidates[1]).toMatchObject({
        slide: 3,
        kind: "image",
        rId: "rId2",
        mediaPath: "ppt/media/wacc.png",
        mimeType: "image/png",
        altText: "WACC calculation",
      });
    });

    it("deduplicates candidates per slide by rId/mediaPath", () => {
      const slideXml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
            <mc:Choice Requires="v">
              <p:oleObj progId="MathType 6.0 Equation" r:id="rId1"/>
            </mc:Choice>
            <mc:Fallback>
              <p:pic>
                <p:nvPicPr>
                  <p:cNvPr id="1" name="MathType Equation"/>
                </p:nvPicPr>
                <p:blipFill>
                  <a:blip r:embed="rId1"/>
                </p:blipFill>
              </p:pic>
            </mc:Fallback>
          </mc:AlternateContent>
        </p:sp>
      `;

      const relsXml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
        </Relationships>
      `;

      const candidates = detectSlideEquationCandidates(slideXml, relsXml, 1);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].kind).toBe("ole");
      expect(candidates[0].progId).toBe("MathType 6.0 Equation");
      expect(candidates[0].mediaPath).toBe("ppt/media/image1.png");
    });
  });

  describe("parsePptx with vision math transcription", () => {
    it("invokes visionTranscriber on a slide with an embedded PNG equation image, returning ocrEquations and appending $...$ to text (even when slide has no other text)", async () => {
      const zip = new JSZip();

      // Slide has ONLY an equation picture and NO other text runs
      const slide1Xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:pic>
            <p:nvPicPr>
              <p:cNvPr id="2" name="Formula Image" descr="Equation: Mass Energy Equivalence"/>
            </p:nvPicPr>
            <p:blipFill>
              <a:blip r:embed="rId1"/>
            </p:blipFill>
          </p:pic>
        </p:sp>
      `;

      const rels1Xml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
        </Relationships>
      `;

      const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      zip.file("ppt/slides/slide1.xml", slide1Xml);
      zip.file("ppt/slides/_rels/slide1.xml.rels", rels1Xml);
      zip.file("ppt/media/image1.png", fakePng);

      const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });

      const mockTranscriber = vi.fn().mockResolvedValue([
        { raw: "E = mc^2", latex: "E = mc^2", confidence: 0.96 },
      ]);

      const result = await parsePptx(pptxBuffer, { visionTranscriber: mockTranscriber });

      expect(mockTranscriber).toHaveBeenCalledTimes(1);
      expect(mockTranscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          slide: 1,
          mimeType: "image/png",
          altText: "Equation: Mass Energy Equivalence",
        }),
      );

      expect(result.ocrEquations).toHaveLength(1);
      expect(result.ocrEquations[0]).toEqual({
        slide: 1,
        raw: "E = mc^2",
        latex: "E = mc^2",
        origin: "ocr",
        confidence: 0.96,
        mediaPath: "ppt/media/image1.png",
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].label).toBe("Slide 1");
      expect(result.sources[0].text).toBe("$E = mc^2$");
      expect(result.pageCount).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it("appends transcribed equation to existing slide text cleanly", async () => {
      const zip = new JSZip();

      const slide1Xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:txBody>
            <a:p><a:r><a:t>Einstein Field Equations Overview</a:t></a:r></a:p>
          </p:txBody>
          <p:pic>
            <p:nvPicPr>
              <p:cNvPr id="2" name="MathType Equation" descr="Formula"/>
            </p:nvPicPr>
            <p:blipFill>
              <a:blip r:embed="rId1"/>
            </p:blipFill>
          </p:pic>
        </p:sp>
      `;

      const rels1Xml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
        </Relationships>
      `;

      zip.file("ppt/slides/slide1.xml", slide1Xml);
      zip.file("ppt/slides/_rels/slide1.xml.rels", rels1Xml);
      zip.file("ppt/media/image1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });

      const mockTranscriber = vi.fn().mockResolvedValue([
        { raw: "G_{\\mu\\nu} = 8\\pi T_{\\mu\\nu}", latex: "G_{\\mu\\nu} = 8\\pi T_{\\mu\\nu}", confidence: 0.92 },
      ]);

      const result = await parsePptx(pptxBuffer, { visionTranscriber: mockTranscriber });

      expect(result.sources[0].text).toBe(
        "Einstein Field Equations Overview\n$G_{\\mu\\nu} = 8\\pi T_{\\mu\\nu}$",
      );
      expect(result.ocrEquations[0].latex).toBe("G_{\\mu\\nu} = 8\\pi T_{\\mu\\nu}");
    });

    it("populates both ommlEquations and ocrEquations when presentation has both", async () => {
      const zip = new JSZip();

      // Slide 1 has OMML
      const slide1Xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
          <p:txBody>
            <a:p>
              <a:r><a:t>Pythagorean Theorem:</a:t></a:r>
              <m:oMath>
                <m:sSup><m:e><m:r><m:t>a</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
                <m:r><m:t> + </m:t></m:r>
                <m:sSup><m:e><m:r><m:t>b</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
                <m:r><m:t> = </m:t></m:r>
                <m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
              </m:oMath>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      // Slide 2 has Image Equation
      const slide2Xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:pic>
            <p:nvPicPr>
              <p:cNvPr id="1" name="MathType Equation"/>
            </p:nvPicPr>
            <p:blipFill>
              <a:blip r:embed="rId1"/>
            </p:blipFill>
          </p:pic>
        </p:sp>
      `;

      zip.file("ppt/slides/slide1.xml", slide1Xml);
      zip.file("ppt/slides/slide2.xml", slide2Xml);
      zip.file("ppt/slides/_rels/slide2.xml.rels", `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>
        </Relationships>
      `);
      zip.file("ppt/media/image2.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const mockTranscriber = vi.fn().mockResolvedValue([
        { raw: "E = mc^2", latex: "E = mc^2", confidence: 0.95 },
      ]);

      const result = await parsePptx(pptxBuffer, { visionTranscriber: mockTranscriber });

      expect(result.ommlEquations).toHaveLength(1);
      expect(result.ommlEquations[0]).toMatchObject({
        slide: 1,
        latex: "a^2 + b^2 = c^2",
        origin: "omml",
      });

      expect(result.ocrEquations).toHaveLength(1);
      expect(result.ocrEquations[0]).toMatchObject({
        slide: 2,
        latex: "E = mc^2",
        origin: "ocr",
      });
    });

    it("gracefully adds a warning when an OLE equation uses an unsupported .wmf or .emf file", async () => {
      const zip = new JSZip();

      const slide1Xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:txBody>
            <a:p><a:r><a:t>Formula Slide with Legacy WMF Object</a:t></a:r></a:p>
          </p:txBody>
          <p:oleObj progId="Equation.3" r:id="rId1"/>
        </p:sp>
      `;

      const rels1Xml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/equation.wmf"/>
        </Relationships>
      `;

      zip.file("ppt/slides/slide1.xml", slide1Xml);
      zip.file("ppt/slides/_rels/slide1.xml.rels", rels1Xml);
      zip.file("ppt/media/equation.wmf", Buffer.from("WMF_RAW_VECTOR_HEADER"));

      const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const mockTranscriber = vi.fn();

      const result = await parsePptx(pptxBuffer, { visionTranscriber: mockTranscriber });

      expect(mockTranscriber).not.toHaveBeenCalled();
      expect(result.warnings).toContain(
        "Slide 1 contains an embedded equation image/OLE object that could not be transcribed automatically.",
      );
      expect(result.ocrEquations).toHaveLength(0);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].text).toBe("Formula Slide with Legacy WMF Object");
    });

    it("gracefully adds a warning when vision transcription is unavailable or returns an empty array", async () => {
      const zip = new JSZip();

      const slide1Xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:txBody>
            <a:p><a:r><a:t>Slide with Unclear Formula</a:t></a:r></a:p>
          </p:txBody>
          <p:pic>
            <p:nvPicPr>
              <p:cNvPr id="1" name="MathType Equation"/>
            </p:nvPicPr>
            <p:blipFill>
              <a:blip r:embed="rId1"/>
            </p:blipFill>
          </p:pic>
        </p:sp>
      `;

      zip.file("ppt/slides/slide1.xml", slide1Xml);
      zip.file("ppt/slides/_rels/slide1.xml.rels", `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/equation.png"/>
        </Relationships>
      `);
      zip.file("ppt/media/equation.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const emptyTranscriber = vi.fn().mockResolvedValue([]);

      const result = await parsePptx(pptxBuffer, { visionTranscriber: emptyTranscriber });

      expect(emptyTranscriber).toHaveBeenCalledTimes(1);
      expect(result.warnings).toContain(
        "Slide 1 contains an embedded equation image/OLE object that could not be transcribed automatically.",
      );
      expect(result.ocrEquations).toHaveLength(0);
      expect(result.sources[0].text).toBe("Slide with Unclear Formula");
    });

    it("maintains backward compatibility with (bytes, signal) and default parameters", async () => {
      const zip = new JSZip();
      zip.file("ppt/slides/slide1.xml", `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:txBody>
            <a:p><a:r><a:t>Plain Slide Content For Backward Compatibility</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `);

      const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const controller = new AbortController();

      const result = await parsePptx(pptxBuffer, controller.signal);

      expect(result.sources).toHaveLength(1);
      expect(result.ocrEquations).toEqual([]);
      expect(result.ommlEquations).toEqual([]);
      expect(result.pageCount).toBe(1);
    });
  });

  describe("transcribeEquationImageWithGemini", () => {
    it("returns empty array safely when no valid API key is present in environment", async () => {
      const originalGoogle = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      const originalGemini = process.env.GEMINI_API_KEY;
      try {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const results = await transcribeEquationImageWithGemini({
          imageBytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
          slide: 1,
        });

        expect(results).toEqual([]);
      } finally {
        if (originalGoogle !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogle;
        if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
      }
    });

    it("returns empty array when an unsupported vector mime type is provided", async () => {
      const results = await transcribeEquationImageWithGemini({
        imageBytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/x-wmf",
        slide: 1,
      });

      expect(results).toEqual([]);
    });
  });

  describe("parseSlideDeck with equations", () => {
    it("populates ocrEquations and ommlEquations on ParsedSlideDeck for PPTX files", async () => {
      const zip = new JSZip();
      zip.file("ppt/slides/slide1.xml", `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:txBody>
            <a:p><a:r><a:t>Corporate Finance: Modern Portfolio Theory and Valuation Techniques</a:t></a:r></a:p>
          </p:txBody>
          <p:pic>
            <p:nvPicPr>
              <p:cNvPr id="1" name="MathType Equation" descr="CAPM"/>
            </p:nvPicPr>
            <p:blipFill>
              <a:blip r:embed="rId1"/>
            </p:blipFill>
          </p:pic>
        </p:sp>
      `);
      zip.file("ppt/slides/_rels/slide1.xml.rels", `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
        </Relationships>
      `);
      zip.file("ppt/media/image1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const pptxBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const file = new File([new Uint8Array(pptxBuffer)], "lecture.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      const mockTranscriber = vi.fn().mockResolvedValue([
        { raw: "r_e = r_f + \\beta(r_m - r_f)", latex: "r_e = r_f + \\beta(r_m - r_f)", confidence: 0.99 },
      ]);

      const deck = await parseSlideDeck(file, { visionTranscriber: mockTranscriber });

      expect(deck.format).toBe("pptx");
      expect(deck.ocrEquations).toBeDefined();
      expect(deck.ocrEquations).toHaveLength(1);
      expect(deck.ocrEquations![0].latex).toBe("r_e = r_f + \\beta(r_m - r_f)");
      expect(deck.ommlEquations).toBeDefined();
      expect(deck.sources[0].text).toContain("$r_e = r_f + \\beta(r_m - r_f)$");
    });
  });
});
