import type { SourceBlock } from "@/lib/schemas/ingestion";
import { IngestionError } from "./errors";
import { MAX_EXTRACTED_CHARACTERS } from "./limits";

export interface OcrTranscribedEquation {
  slide: number;
  raw: string;
  latex: string;
  origin: "ocr";
  confidence: number;
  mediaPath?: string;
}

export interface SlideEquationCandidate {
  slide: number;
  kind: "ole" | "image";
  rId?: string;
  mediaPath?: string;
  mimeType?: string;
  altText?: string;
  progId?: string;
}

export type VisionMathTranscriber = (input: {
  imageBytes: Uint8Array;
  mimeType: string;
  slide: number;
  altText?: string;
  signal?: AbortSignal;
}) => Promise<Array<{ raw: string; latex: string; confidence: number }>>;

export interface ParsePptxOptions {
  signal?: AbortSignal;
  visionTranscriber?: VisionMathTranscriber;
}

export interface OmmlTranscribedEquation {
  slide: number;
  raw: string;
  latex: string;
  origin: "omml";
}

export interface ParsePptxResult {
  sources: SourceBlock[];
  pageCount: number;
  warnings: string[];
  ocrEquations: OcrTranscribedEquation[];
  ommlEquations: OmmlTranscribedEquation[];
}

export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: Array<XmlElement | string>;
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

const GREEK_MAP: Record<string, string> = {
  // Lowercase
  "α": "\\alpha",
  "β": "\\beta",
  "γ": "\\gamma",
  "δ": "\\delta",
  "ε": "\\epsilon",
  "ϵ": "\\epsilon",
  "ζ": "\\zeta",
  "η": "\\eta",
  "θ": "\\theta",
  "ϑ": "\\vartheta",
  "ι": "\\iota",
  "κ": "\\kappa",
  "λ": "\\lambda",
  "μ": "\\mu",
  "ν": "\\nu",
  "ξ": "\\xi",
  "π": "\\pi",
  "ϖ": "\\varpi",
  "ρ": "\\rho",
  "ϱ": "\\varrho",
  "σ": "\\sigma",
  "ς": "\\varsigma",
  "τ": "\\tau",
  "υ": "\\upsilon",
  "φ": "\\phi",
  "ϕ": "\\varphi",
  "χ": "\\chi",
  "ψ": "\\psi",
  "ω": "\\omega",
  // Uppercase
  "Γ": "\\Gamma",
  "Δ": "\\Delta",
  "Θ": "\\Theta",
  "Λ": "\\Lambda",
  "Ξ": "\\Xi",
  "Π": "\\Pi",
  "Σ": "\\Sigma",
  "Υ": "\\Upsilon",
  "Φ": "\\Phi",
  "Ψ": "\\Psi",
  "Ω": "\\Omega",
};

const SYMBOL_MAP: Record<string, string> = {
  "−": "-", // U+2212 minus sign
  "–": "-", // en-dash
  "—": "-", // em-dash
  "∑": "\\sum",
  "∏": "\\prod",
  "√": "\\sqrt",
  "×": "\\times",
  "÷": "\\div",
  "±": "\\pm",
  "∓": "\\mp",
  "≤": "\\le",
  "≥": "\\ge",
  "≠": "\\ne",
  "≈": "\\approx",
  "≡": "\\equiv",
  "∼": "\\sim",
  "∝": "\\propto",
  "∞": "\\infty",
  "·": "\\cdot",
  "⋅": "\\cdot",
  "∘": "\\circ",
  "∂": "\\partial",
  "∇": "\\nabla",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "∈": "\\in",
  "∉": "\\notin",
  "⊂": "\\subset",
  "⊆": "\\subseteq",
  "⊃": "\\supset",
  "⊇": "\\supseteq",
  "∪": "\\cup",
  "∩": "\\cap",
  "∧": "\\land",
  "∨": "\\lor",
  "¬": "\\neg",
  "→": "\\to",
  "←": "\\gets",
  "⇒": "\\implies",
  "⇐": "\\impliedby",
  "⇔": "\\iff",
  "∀": "\\forall",
  "∃": "\\exists",
  "∄": "\\nexists",
  "∅": "\\emptyset",
  "∠": "\\angle",
  "⊥": "\\perp",
  "…": "\\dots",
  "⋯": "\\cdots",
  "⋮": "\\vdots",
  "⋱": "\\ddots",
};

const NARY_CHR_MAP: Record<string, string> = {
  "∑": "\\sum",
  "∏": "\\prod",
  "∐": "\\coprod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "⋃": "\\cup",
  "⋂": "\\cap",
  "⋁": "\\bigvee",
  "⋀": "\\bigwedge",
  "⨁": "\\bigoplus",
  "⨂": "\\bigotimes",
};

function parseXml(xml: string): XmlElement[] {
  if (!xml) return [];

  const cleanXml = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");

  const rootNodes: XmlElement[] = [];
  const stack: XmlElement[] = [];

  const TAG_REGEX =
    /<\/\s*([a-zA-Z0-9:_.-]+)\s*>|<([a-zA-Z0-9:_.-]+)((?:\s+[^=>\s]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;

  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(cleanXml)) !== null) {
    const [, closeTag, openTag, attrString, selfClose, textContent] = match;

    if (textContent !== undefined) {
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(textContent);
      }
      continue;
    }

    if (closeTag !== undefined) {
      const lower = closeTag.toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag.toLowerCase() === lower) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (openTag !== undefined) {
      const attrs: Record<string, string> = {};
      if (attrString) {
        const ATTR_REGEX =
          /([a-zA-Z0-9:_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = ATTR_REGEX.exec(attrString)) !== null) {
          const rawVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
          attrs[attrMatch[1]] = decodeXmlEntities(rawVal);
        }
      }

      const element: XmlElement = {
        tag: openTag,
        attrs,
        children: [],
      };

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(element);
      } else {
        rootNodes.push(element);
      }

      const isSelfClosing = selfClose === "/";
      if (!isSelfClosing) {
        stack.push(element);
      }
    }
  }

  return rootNodes;
}

function getLocalName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function findChild(
  elem: XmlElement | undefined,
  localName: string,
): XmlElement | undefined {
  if (!elem) return undefined;
  for (const child of elem.children) {
    if (typeof child !== "string" && getLocalName(child.tag) === localName) {
      return child;
    }
  }
  return undefined;
}

function findChildren(
  elem: XmlElement | undefined,
  localName: string,
): XmlElement[] {
  if (!elem) return [];
  const results: XmlElement[] = [];
  for (const child of elem.children) {
    if (typeof child !== "string" && getLocalName(child.tag) === localName) {
      results.push(child);
    }
  }
  return results;
}

function getAttr(
  elem: XmlElement | undefined,
  localName: string,
): string | undefined {
  if (!elem) return undefined;
  for (const [key, val] of Object.entries(elem.attrs)) {
    if (getLocalName(key) === localName || key === localName) {
      return val;
    }
  }
  return undefined;
}

function convertMathText(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nextCh = i + 1 < text.length ? text[i + 1] : "";

    if (ch === "\u2212" || ch === "–" || ch === "—") {
      result += "-";
    } else if (GREEK_MAP[ch]) {
      const cmd = GREEK_MAP[ch];
      if (/[a-zA-Z0-9]/.test(nextCh)) {
        result += `${cmd} `;
      } else {
        result += cmd;
      }
    } else if (SYMBOL_MAP[ch]) {
      const cmd = SYMBOL_MAP[ch];
      if (cmd === "-") {
        result += "-";
      } else if (/[a-zA-Z0-9]/.test(nextCh)) {
        result += `${cmd} `;
      } else {
        result += cmd;
      }
    } else {
      result += ch;
    }
  }
  return result;
}

function formatBase(base: string): string {
  const trimmed = base.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z0-9]$/.test(trimmed) || /^\\[a-zA-Z]+$/.test(trimmed)) {
    return trimmed;
  }
  if (
    /^([a-zA-Z0-9]|\\[a-zA-Z]+)_[a-zA-Z0-9]$/.test(trimmed) ||
    /^([a-zA-Z0-9]|\\[a-zA-Z]+)_\{[^}]+\}$/.test(trimmed)
  ) {
    return trimmed;
  }
  if (
    (trimmed.startsWith("(") && trimmed.endsWith(")")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("\\left(") && trimmed.endsWith("\\right)")) ||
    (trimmed.startsWith("\\left[") && trimmed.endsWith("\\right]")) ||
    (trimmed.startsWith("\\left\\{") && trimmed.endsWith("\\right\\}")) ||
    (trimmed.startsWith("\\left|") && trimmed.endsWith("\\right|"))
  ) {
    return trimmed;
  }
  return `{${trimmed}}`;
}

function formatScript(script: string): string {
  const trimmed = script.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z0-9]$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  return `{${trimmed}}`;
}

function mapDelimiter(chr: string, isLeft: boolean): string {
  if (!chr) {
    return isLeft ? "\\left." : "\\right.";
  }
  switch (chr) {
    case "(":
    case ")":
      return isLeft ? "\\left(" : "\\right)";
    case "[":
    case "]":
      return isLeft ? "\\left[" : "\\right]";
    case "{":
    case "}":
      return isLeft ? "\\left\\{" : "\\right\\}";
    case "|":
      return isLeft ? "\\left|" : "\\right|";
    case "‖":
    case "\u2016":
      return isLeft ? "\\left\\|" : "\\right\\|";
    case "⟨":
    case "\u27E8":
    case "<":
      return isLeft ? "\\left\\langle " : "\\right\\langle ";
    case "⟩":
    case "\u27E9":
    case ">":
      return isLeft ? "\\left\\rangle " : "\\right\\rangle ";
    default:
      return isLeft ? `\\left${chr}` : `\\right${chr}`;
  }
}

function convertFraction(node: XmlElement): string {
  const fPr = findChild(node, "fPr");
  const typeElem = findChild(fPr, "type");
  const isLinear = getAttr(typeElem, "val") === "lin";

  const num = convertChildren(findChild(node, "num")).trim();
  const den = convertChildren(findChild(node, "den")).trim();

  if (isLinear) {
    return `{${num}}/{${den}}`;
  }
  return `\\frac{${num}}{${den}}`;
}

function convertSub(node: XmlElement): string {
  const base = convertChildren(findChild(node, "e")).trim();
  const sub = convertChildren(findChild(node, "sub")).trim();
  return `${formatBase(base)}_${formatScript(sub)}`;
}

function convertSup(node: XmlElement): string {
  const base = convertChildren(findChild(node, "e")).trim();
  const sup = convertChildren(findChild(node, "sup")).trim();
  return `${formatBase(base)}^${formatScript(sup)}`;
}

function convertSubSup(node: XmlElement): string {
  const base = convertChildren(findChild(node, "e")).trim();
  const sub = convertChildren(findChild(node, "sub")).trim();
  const sup = convertChildren(findChild(node, "sup")).trim();
  return `${formatBase(base)}_${formatScript(sub)}^${formatScript(sup)}`;
}

function convertNary(node: XmlElement): string {
  const naryPr = findChild(node, "naryPr");
  const chrElem = findChild(naryPr, "chr");
  const rawChr = getAttr(chrElem, "val") ?? "∑";
  const op =
    NARY_CHR_MAP[rawChr] ??
    SYMBOL_MAP[rawChr] ??
    (rawChr.startsWith("\\") ? rawChr : `\\${rawChr}`);

  const isTrue = (val: string | undefined) =>
    val === "1" || val === "true" || val === "on";

  const subHidden =
    isTrue(getAttr(findChild(naryPr, "subHide"), "val")) ||
    isTrue(getAttr(findChild(naryPr, "limLowHide"), "val"));

  const supHidden =
    isTrue(getAttr(findChild(naryPr, "supHide"), "val")) ||
    isTrue(getAttr(findChild(naryPr, "limUppHide"), "val"));

  const subNode = findChild(node, "sub");
  const supNode = findChild(node, "sup");
  const eNode = findChild(node, "e");

  const subText = !subHidden && subNode ? convertChildren(subNode).trim() : "";
  const supText = !supHidden && supNode ? convertChildren(supNode).trim() : "";
  const eText = eNode ? convertChildren(eNode).trim() : "";

  let res = op;
  if (subText) {
    res += `_{${subText}}`;
  }
  if (supText) {
    res += `^{${supText}}`;
  }
  if (eText) {
    res += ` ${eText}`;
  }
  return res;
}

function convertRad(node: XmlElement): string {
  const radPr = findChild(node, "radPr");
  const degHideElem = findChild(radPr, "degHide");
  const isTrue = (val: string | undefined) =>
    val === undefined || val === "1" || val === "true" || val === "on";
  const degHidden =
    degHideElem !== undefined && isTrue(getAttr(degHideElem, "val"));

  const degNode = findChild(node, "deg");
  const eNode = findChild(node, "e");

  const degText = !degHidden && degNode ? convertChildren(degNode).trim() : "";
  const eText = eNode ? convertChildren(eNode).trim() : "";

  if (!degText) {
    return `\\sqrt{${eText}}`;
  }
  return `\\sqrt[${degText}]{${eText}}`;
}

function convertDelimiter(node: XmlElement): string {
  const dPr = findChild(node, "dPr");
  const begElem = findChild(dPr, "begChr");
  const endElem = findChild(dPr, "endChr");
  const sepElem = findChild(dPr, "sepChr");

  const begChr = begElem ? (getAttr(begElem, "val") ?? "(") : "(";
  const endChr = endElem ? (getAttr(endElem, "val") ?? ")") : ")";
  const sepChr = sepElem ? (getAttr(sepElem, "val") ?? ",") : ",";

  const eNodes = findChildren(node, "e");
  const parts = eNodes.map((e) => convertChildren(e).trim());
  const inner = parts.join(sepChr ? `${sepChr} ` : " ");

  const left = mapDelimiter(begChr, true);
  const right = mapDelimiter(endChr, false);

  return `${left}${inner}${right}`;
}

const KNOWN_FUNCS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc",
  "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "coth",
  "ln", "log", "exp", "lim", "max", "min",
  "det", "gcd", "deg", "dim", "hom", "inf", "sup", "ker", "lg",
]);

function convertFunc(node: XmlElement): string {
  const fNameNode = findChild(node, "fName");
  const eNode = findChild(node, "e");

  let fName = fNameNode ? convertChildren(fNameNode).trim() : "";
  const e = eNode ? convertChildren(eNode).trim() : "";

  if (KNOWN_FUNCS.has(fName.toLowerCase())) {
    fName = `\\${fName.toLowerCase()}`;
  }

  if (!e) return fName;
  if (!fName) return e;

  const needsSpace =
    !/^[\(\[\{]/.test(e) &&
    !e.startsWith("\\left") &&
    !e.startsWith("_") &&
    !e.startsWith("^");

  return needsSpace ? `${fName} ${e}` : `${fName}${e}`;
}

function convertAcc(node: XmlElement): string {
  const accPr = findChild(node, "accPr");
  const chrElem = findChild(accPr, "chr");
  const chr = getAttr(chrElem, "val") ?? "^";
  const eNode = findChild(node, "e");
  const e = eNode ? convertChildren(eNode).trim() : "";

  if (chr === "^" || chr === "\u0302" || chr === "hat" || chr === "\\hat") {
    return `\\hat{${e}}`;
  }
  if (chr === "→" || chr === "\u2192" || chr === "\u20D7" || chr === "vec" || chr === "\\vec") {
    return `\\vec{${e}}`;
  }
  if (chr === "~" || chr === "\u0303" || chr === "tilde" || chr === "\\tilde") {
    return `\\tilde{${e}}`;
  }
  if (chr === "." || chr === "\u02D9" || chr === "dot" || chr === "\\dot") {
    return `\\dot{${e}}`;
  }
  if (chr === "¨" || chr === "\u00A8" || chr === "ddot" || chr === "\\ddot") {
    return `\\ddot{${e}}`;
  }
  if (chr === "¯" || chr === "\u0304" || chr === "bar" || chr === "\\bar" || chr === "-") {
    return `\\bar{${e}}`;
  }
  return `\\hat{${e}}`;
}

function convertBar(node: XmlElement): string {
  const barPr = findChild(node, "barPr");
  const posElem = findChild(barPr, "pos");
  const pos = getAttr(posElem, "val");
  const eNode = findChild(node, "e");
  const e = eNode ? convertChildren(eNode).trim() : "";

  if (pos === "bot") {
    return `\\underline{${e}}`;
  }
  return `\\bar{${e}}`;
}

function convertEqArr(node: XmlElement): string {
  const eNodes = findChildren(node, "e");
  const lines = eNodes.map((e) => convertChildren(e).trim());
  return lines.join(" \\\\ ");
}

function convertMatrix(node: XmlElement): string {
  const mrNodes = findChildren(node, "mr");
  const rowStrings: string[] = [];
  for (const mr of mrNodes) {
    const eNodes = findChildren(mr, "e");
    const cellStrings = eNodes.map((e) => convertChildren(e).trim());
    rowStrings.push(cellStrings.join(" & "));
  }
  return `\\begin{matrix} ${rowStrings.join(" \\\\ ")} \\end{matrix}`;
}

function convertRun(node: XmlElement): string {
  const rPr = findChild(node, "rPr");
  const textChildren = findChildren(node, "t");
  const rawText = textChildren
    .map((t) =>
      t.children.filter((c): c is string => typeof c === "string").join(""),
    )
    .join("");
  const decoded = decodeXmlEntities(rawText);
  const mathConverted = convertMathText(decoded);

  if (!rPr) return mathConverted;

  const isNormal =
    findChild(rPr, "nor") !== undefined ||
    getAttr(findChild(rPr, "sty"), "val") === "p";
  if (isNormal && /[a-zA-Z]/.test(decoded)) {
    return `\\text{${decoded}}`;
  }

  const scr = getAttr(findChild(rPr, "scr"), "val");
  if (scr === "double-struck") return `\\mathbb{${mathConverted}}`;
  if (scr === "script") return `\\mathcal{${mathConverted}}`;
  if (scr === "fraktur") return `\\mathfrak{${mathConverted}}`;
  if (scr === "sans-serif") return `\\mathsf{${mathConverted}}`;

  const sty = getAttr(findChild(rPr, "sty"), "val");
  if (sty === "b") return `\\mathbf{${mathConverted}}`;
  if (sty === "bi") return `\\boldsymbol{${mathConverted}}`;

  return mathConverted;
}

function convertChildren(elem: XmlElement | undefined): string {
  if (!elem) return "";
  return elem.children.map((child) => nodeToLatex(child)).join("");
}

function nodeToLatex(node: XmlElement | string): string {
  if (typeof node === "string") {
    return "";
  }

  const localName = getLocalName(node.tag);

  switch (localName) {
    case "oMathPara": {
      const oMathChildren = findChildren(node, "oMath");
      if (oMathChildren.length > 0) {
        return oMathChildren.map((om) => convertChildren(om)).join(" ");
      }
      return convertChildren(node);
    }
    case "oMath":
      return convertChildren(node);
    case "f":
      return convertFraction(node);
    case "sSub":
      return convertSub(node);
    case "sSup":
      return convertSup(node);
    case "sSubSup":
      return convertSubSup(node);
    case "nary":
      return convertNary(node);
    case "rad":
      return convertRad(node);
    case "d":
      return convertDelimiter(node);
    case "func":
      return convertFunc(node);
    case "acc":
      return convertAcc(node);
    case "bar":
      return convertBar(node);
    case "eqArr":
      return convertEqArr(node);
    case "m":
      return convertMatrix(node);
    case "r":
      return convertRun(node);
    case "t": {
      const rawText = node.children
        .filter((c): c is string => typeof c === "string")
        .join("");
      return convertMathText(decodeXmlEntities(rawText));
    }
    case "box":
    case "borderBox": {
      const eNode = findChild(node, "e");
      return eNode ? convertChildren(eNode) : convertChildren(node);
    }
    case "groupChr": {
      const groupChrPr = findChild(node, "groupChrPr");
      const chr = getAttr(findChild(groupChrPr, "chr"), "val");
      const eNode = findChild(node, "e");
      const e = eNode ? convertChildren(eNode) : "";
      if (chr === "⏞") return `\\overbrace{${e}}`;
      if (chr === "⏟") return `\\underbrace{${e}}`;
      return e;
    }
    case "sPre": {
      const subNode = findChild(node, "sub");
      const supNode = findChild(node, "sup");
      const eNode = findChild(node, "e");
      const sub = subNode ? convertChildren(subNode).trim() : "";
      const sup = supNode ? convertChildren(supNode).trim() : "";
      const e = eNode ? convertChildren(eNode).trim() : "";
      return `{}_{${sub}}^{${sup}} ${e}`;
    }
    case "e":
    case "num":
    case "den":
    case "sub":
    case "sup":
    case "deg":
    case "fName":
      return convertChildren(node);
    default:
      if (localName.endsWith("Pr")) {
        return "";
      }
      return convertChildren(node);
  }
}

/**
 * Converts Office Math Markup Language (OMML) XML snippet to LaTeX.
 */
export function ommlToLatex(ommlXml: string): string {
  if (!ommlXml || !ommlXml.trim()) return "";

  const ast = parseXml(ommlXml);
  if (ast.length === 0) return "";

  const oMathParas = ast.filter((n) => getLocalName(n.tag) === "oMathPara");
  if (oMathParas.length > 0) {
    return oMathParas
      .map((p) => nodeToLatex(p))
      .join(" ")
      .trim();
  }

  const oMaths = ast.filter((n) => getLocalName(n.tag) === "oMath");
  if (oMaths.length > 0) {
    return oMaths
      .map((m) => nodeToLatex(m))
      .join(" ")
      .trim();
  }

  return ast
    .map((n) => nodeToLatex(n))
    .join("")
    .trim();
}

/**
 * Extracts all `<m:oMath>` equations from a slide's XML with their plain concatenated text (`raw`) and converted `latex`.
 */
export function extractOmmlEquationsFromXml(
  xml: string,
): Array<{ raw: string; latex: string }> {
  if (!xml) return [];

  const results: Array<{ raw: string; latex: string }> = [];
  const oMathRegex =
    /<(?:[a-zA-Z0-9]+:)?oMath(?:\s[^>]*)?>[\s\S]*?<\/(?:[a-zA-Z0-9]+:)?oMath>/gi;
  let match: RegExpExecArray | null;

  while ((match = oMathRegex.exec(xml)) !== null) {
    const block = match[0];
    const latex = ommlToLatex(block);

    const textMatches =
      block.match(/<(?:[a-zA-Z0-9]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?t>/gi) ||
      [];
    const raw = textMatches
      .map((tag) => {
        const inner = tag
          .replace(/^<(?:[a-zA-Z0-9]+:)?t(?:\s[^>]*)?>/i, "")
          .replace(/<\/(?:[a-zA-Z0-9]+:)?t>$/i, "");
        return decodeXmlEntities(inner);
      })
      .join("");

    results.push({
      raw: raw.trim(),
      latex: latex.trim(),
    });
  }

  return results;
}

/**
 * Extracts human-readable text and math notations from PPTX slide XML.
 * Inline math notations are converted to LaTeX wrapped in `$ ... $`.
 */
export function extractSlideXmlText(xml: string): string {
  if (!xml) return "";

  // Split into paragraphs (<a:p>...</a:p>) or top-level math blocks
  const paragraphMatches =
    xml.match(
      /<a:p[\s>][\s\S]*?<\/a:p>|<(?:[a-zA-Z0-9]+:)?oMathPara[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?oMathPara>|<(?:[a-zA-Z0-9]+:)?oMath[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?oMath>/gi,
    ) || [xml];

  const paragraphTexts: string[] = [];

  for (const block of paragraphMatches) {
    if (
      /^<(?:[a-zA-Z0-9]+:)?oMathPara[\s>]/i.test(block) ||
      /^<(?:[a-zA-Z0-9]+:)?oMath[\s>]/i.test(block)
    ) {
      const latex = ommlToLatex(block).trim();
      if (latex) {
        paragraphTexts.push(`$${latex}$`);
      }
      continue;
    }

    const TOKEN_REGEX =
      /<(?:[a-zA-Z0-9]+:)?oMathPara[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?oMathPara>|<(?:[a-zA-Z0-9]+:)?oMath[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?oMath>|<(?:a|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|m):t>|<a:br\s*\/?>/gi;

    let lineText = "";
    let tokenMatch: RegExpExecArray | null;

    while ((tokenMatch = TOKEN_REGEX.exec(block)) !== null) {
      const matchedStr = tokenMatch[0];

      if (
        /^<(?:[a-zA-Z0-9]+:)?oMathPara[\s>]/i.test(matchedStr) ||
        /^<(?:[a-zA-Z0-9]+:)?oMath[\s>]/i.test(matchedStr)
      ) {
        const latex = ommlToLatex(matchedStr).trim();
        if (latex) {
          lineText += `$${latex}$`;
        }
      } else if (/^<(?:a|m):t/i.test(matchedStr)) {
        const inner = tokenMatch[1] ?? "";
        lineText += decodeXmlEntities(inner);
      } else if (/^<a:br/i.test(matchedStr)) {
        lineText += "\n";
      }
    }

    const trimmed = lineText.trim();
    if (trimmed) {
      paragraphTexts.push(trimmed);
    }
  }

  return paragraphTexts.join("\n");
}

export function resolveRelsPath(target: string): string {
  let clean = target.replace(/\\/g, "/").trim();
  if (clean.startsWith("/")) {
    clean = clean.slice(1);
  }
  if (clean.startsWith("../")) {
    return "ppt/" + clean.slice(3);
  }
  if (clean.startsWith("ppt/")) {
    return clean;
  }
  if (clean.startsWith("media/") || clean.startsWith("embeddings/")) {
    return "ppt/" + clean;
  }
  return `ppt/slides/${clean}`;
}

export function getMimeType(filePath: string): string | undefined {
  const ext = filePath.split(".").at(-1)?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "wmf":
      return "image/x-wmf";
    case "emf":
      return "image/x-emf";
    case "svg":
      return "image/svg+xml";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return undefined;
  }
}

export function parseRels(
  relsXml?: string,
): Map<string, { target: string; resolvedPath: string; mimeType?: string }> {
  const map = new Map<
    string,
    { target: string; resolvedPath: string; mimeType?: string }
  >();
  if (!relsXml) return map;

  const relRegex = /<Relationship\b([^>]*?)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = relRegex.exec(relsXml)) !== null) {
    const rawAttrs = match[1];
    const idMatch = rawAttrs.match(/\bId\s*=\s*["']([^"']+)["']/i);
    const targetMatch = rawAttrs.match(/\bTarget\s*=\s*["']([^"']+)["']/i);
    if (idMatch && targetMatch) {
      const id = idMatch[1];
      const target = targetMatch[1];
      const resolvedPath = resolveRelsPath(target);
      const mimeType = getMimeType(resolvedPath);
      map.set(id, { target, resolvedPath, mimeType });
    }
  }
  return map;
}

export function detectSlideEquationCandidates(
  slideXml: string,
  relsXml: string | undefined,
  slideNum: number,
): SlideEquationCandidate[] {
  if (!slideXml) return [];

  const relsMap = parseRels(relsXml);
  const rawCandidates: SlideEquationCandidate[] = [];

  const slideText = extractSlideXmlText(slideXml);
  const eqRegex = /equation|formula|math|latex|công thức/i;
  const isImageHeavyOrEquationSlide =
    slideText.length < 50 ||
    eqRegex.test(slideText) ||
    /<(?:[a-zA-Z0-9]+:)?oMath/i.test(slideXml) ||
    /<(?:[a-zA-Z0-9]+:)?oleObj/i.test(slideXml) ||
    /presentationml\/2006\/ole/i.test(slideXml);

  let remainingXml = slideXml;

  // 1. Scan for <mc:AlternateContent> blocks
  const altContentRegex =
    /<(?:[a-zA-Z0-9]+:)?AlternateContent[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?AlternateContent>/gi;
  let altMatch: RegExpExecArray | null;

  while ((altMatch = altContentRegex.exec(slideXml)) !== null) {
    const block = altMatch[0];
    const isOleBlock =
      /<(?:[a-zA-Z0-9]+:)?oleObj/i.test(block) ||
      /presentationml\/2006\/ole/i.test(block);

    const progIdMatch = block.match(/\bprogId\s*=\s*["']([^"']+)["']/i);
    const progId = progIdMatch ? progIdMatch[1] : isOleBlock ? "Equation" : undefined;

    // Search for blip within AlternateContent (either Choice or Fallback)
    const blipMatch = block.match(
      /<(?:[a-zA-Z0-9]+:)?blip\b[^>]*?\b(?:[a-zA-Z0-9]+:)?(?:embed|link)\s*=\s*["']([^"']+)["']/i,
    );
    const oleRIdMatch = block.match(
      /<(?:[a-zA-Z0-9]+:)?oleObj\b[^>]*?\b(?:[a-zA-Z0-9]+:)?(?:id|r:id)\s*=\s*["']([^"']+)["']/i,
    );

    const cNvPrMatch = block.match(/<(?:[a-zA-Z0-9]+:)?cNvPr\b([^>]*?)\/?>/i);
    let altText: string | undefined;
    let name: string | undefined;
    let descr: string | undefined;
    let title: string | undefined;

    if (cNvPrMatch) {
      const attrs = cNvPrMatch[1];
      const descrM = attrs.match(/\bdescr\s*=\s*["']([^"']+)["']/i);
      const titleM = attrs.match(/\btitle\s*=\s*["']([^"']+)["']/i);
      const nameM = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
      descr = descrM ? descrM[1] : undefined;
      title = titleM ? titleM[1] : undefined;
      name = nameM ? nameM[1] : undefined;
      altText = descr || title || name;
    }

    const combinedAlt = [name, descr, title].filter(Boolean).join(" ");
    const isEqPic = eqRegex.test(combinedAlt);

    if (isOleBlock) {
      const rId = blipMatch ? blipMatch[1] : (oleRIdMatch ? oleRIdMatch[1] : undefined);
      const mediaRel = rId ? relsMap.get(rId) : undefined;
      const mediaPath = mediaRel?.resolvedPath;
      const mimeType = mediaRel?.mimeType || (mediaPath ? getMimeType(mediaPath) : undefined);

      rawCandidates.push({
        slide: slideNum,
        kind: "ole",
        rId,
        mediaPath,
        mimeType,
        altText,
        progId,
      });

      const idx = remainingXml.indexOf(block);
      if (idx !== -1) {
        remainingXml =
          remainingXml.slice(0, idx) +
          " ".repeat(block.length) +
          remainingXml.slice(idx + block.length);
      }
    } else if (isEqPic || isImageHeavyOrEquationSlide) {
      const rId = blipMatch ? blipMatch[1] : undefined;
      const mediaRel = rId ? relsMap.get(rId) : undefined;
      const mediaPath = mediaRel?.resolvedPath;
      const mimeType = mediaRel?.mimeType || (mediaPath ? getMimeType(mediaPath) : undefined);

      rawCandidates.push({
        slide: slideNum,
        kind: "image",
        rId,
        mediaPath,
        mimeType,
        altText,
      });

      const idx = remainingXml.indexOf(block);
      if (idx !== -1) {
        remainingXml =
          remainingXml.slice(0, idx) +
          " ".repeat(block.length) +
          remainingXml.slice(idx + block.length);
      }
    }
  }

  // 2. Scan for standalone <p:oleObj> or graphicData with OLE
  const oleObjRegex =
    /<(?:[a-zA-Z0-9]+:)?oleObj[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?oleObj>|<(?:[a-zA-Z0-9]+:)?oleObj\b[^>]*\/>/gi;
  let oleMatch: RegExpExecArray | null;

  while ((oleMatch = oleObjRegex.exec(remainingXml)) !== null) {
    const block = oleMatch[0];
    const progIdMatch = block.match(/\bprogId\s*=\s*["']([^"']+)["']/i);
    const progId = progIdMatch ? progIdMatch[1] : "Equation";

    const blipMatch = block.match(
      /<(?:[a-zA-Z0-9]+:)?blip\b[^>]*?\b(?:[a-zA-Z0-9]+:)?(?:embed|link)\s*=\s*["']([^"']+)["']/i,
    );
    const oleRIdMatch = block.match(
      /<(?:[a-zA-Z0-9]+:)?oleObj\b[^>]*?\b(?:[a-zA-Z0-9]+:)?(?:id|r:id)\s*=\s*["']([^"']+)["']/i,
    );

    const cNvPrMatch = block.match(/<(?:[a-zA-Z0-9]+:)?cNvPr\b([^>]*?)\/?>/i);
    let altText: string | undefined;
    if (cNvPrMatch) {
      const attrs = cNvPrMatch[1];
      const descrM = attrs.match(/\bdescr\s*=\s*["']([^"']+)["']/i);
      const titleM = attrs.match(/\btitle\s*=\s*["']([^"']+)["']/i);
      const nameM = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
      altText = descrM ? descrM[1] : titleM ? titleM[1] : nameM ? nameM[1] : undefined;
    }

    const rId = blipMatch ? blipMatch[1] : (oleRIdMatch ? oleRIdMatch[1] : undefined);
    const mediaRel = rId ? relsMap.get(rId) : undefined;
    const mediaPath = mediaRel?.resolvedPath;
    const mimeType = mediaRel?.mimeType || (mediaPath ? getMimeType(mediaPath) : undefined);

    rawCandidates.push({
      slide: slideNum,
      kind: "ole",
      rId,
      mediaPath,
      mimeType,
      altText,
      progId,
    });

    const idx = remainingXml.indexOf(block);
    if (idx !== -1) {
      remainingXml =
        remainingXml.slice(0, idx) +
        " ".repeat(block.length) +
        remainingXml.slice(idx + block.length);
    }
  }

  // 3. Scan for standalone <p:pic> elements
  const picRegex =
    /<(?:[a-zA-Z0-9]+:)?pic[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?pic>/gi;
  let picMatch: RegExpExecArray | null;

  while ((picMatch = picRegex.exec(remainingXml)) !== null) {
    const block = picMatch[0];
    const blipMatch = block.match(
      /<(?:[a-zA-Z0-9]+:)?blip\b[^>]*?\b(?:[a-zA-Z0-9]+:)?(?:embed|link)\s*=\s*["']([^"']+)["']/i,
    );
    const rId = blipMatch ? blipMatch[1] : undefined;

    const cNvPrMatch = block.match(/<(?:[a-zA-Z0-9]+:)?cNvPr\b([^>]*?)\/?>/i);
    let altText: string | undefined;
    let name: string | undefined;
    let descr: string | undefined;
    let title: string | undefined;

    if (cNvPrMatch) {
      const attrs = cNvPrMatch[1];
      const descrM = attrs.match(/\bdescr\s*=\s*["']([^"']+)["']/i);
      const titleM = attrs.match(/\btitle\s*=\s*["']([^"']+)["']/i);
      const nameM = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
      descr = descrM ? descrM[1] : undefined;
      title = titleM ? titleM[1] : undefined;
      name = nameM ? nameM[1] : undefined;
      altText = descr || title || name;
    }

    const combinedAlt = [name, descr, title].filter(Boolean).join(" ");
    const isEqAttr = eqRegex.test(combinedAlt);
    const isIgnored = !isEqAttr && /logo|avatar|icon|bg|background|bullet/i.test(combinedAlt);

    if ((isEqAttr || isImageHeavyOrEquationSlide) && !isIgnored) {
      const mediaRel = rId ? relsMap.get(rId) : undefined;
      const mediaPath = mediaRel?.resolvedPath;
      const mimeType = mediaRel?.mimeType || (mediaPath ? getMimeType(mediaPath) : undefined);

      rawCandidates.push({
        slide: slideNum,
        kind: "image",
        rId,
        mediaPath,
        mimeType,
        altText,
      });
    }
  }

  // 4. Deduplicate per slide by rId / mediaPath
  const deduplicated: SlideEquationCandidate[] = [];
  const keyMap = new Map<string, number>();

  for (const c of rawCandidates) {
    const key = c.mediaPath || c.rId;
    if (!key) {
      deduplicated.push(c);
      continue;
    }

    if (keyMap.has(key)) {
      const existingIdx = keyMap.get(key)!;
      const existing = deduplicated[existingIdx];

      if (existing.kind === "image" && c.kind === "ole") {
        deduplicated[existingIdx] = {
          ...c,
          altText: c.altText || existing.altText,
        };
      } else if (existing.kind === "ole" && c.kind === "image") {
        if (!existing.altText && c.altText) {
          existing.altText = c.altText;
        }
      }
    } else {
      keyMap.set(key, deduplicated.length);
      deduplicated.push(c);
    }
  }

  // If an OLE candidate has no image mediaPath (e.g. .bin), but an image candidate exists on the same slide, merge them
  const oleWithoutRaster = deduplicated.find(
    (c) =>
      c.kind === "ole" &&
      (!c.mediaPath ||
        c.mediaPath.endsWith(".bin") ||
        !c.mimeType?.startsWith("image/")),
  );
  if (oleWithoutRaster) {
    const fallbackImage = deduplicated.find(
      (c) =>
        c.kind === "image" &&
        c.mediaPath &&
        c.mimeType?.startsWith("image/"),
    );
    if (fallbackImage) {
      oleWithoutRaster.rId = fallbackImage.rId;
      oleWithoutRaster.mediaPath = fallbackImage.mediaPath;
      oleWithoutRaster.mimeType = fallbackImage.mimeType;
      oleWithoutRaster.altText =
        oleWithoutRaster.altText || fallbackImage.altText;
      const imgIdx = deduplicated.indexOf(fallbackImage);
      if (imgIdx !== -1) {
        deduplicated.splice(imgIdx, 1);
      }
    }
  }

  return deduplicated;
}

export const transcribeEquationImageWithGemini: VisionMathTranscriber = async ({
  imageBytes,
  mimeType,
  slide,
  altText,
  signal,
}) => {
  const apiKey =
    typeof process !== "undefined" && process?.env
      ? process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
        process.env.GEMINI_API_KEY?.trim()
      : undefined;

  if (
    !apiKey ||
    apiKey === "your-gemini-key-here" ||
    apiKey === "your-api-key-here"
  ) {
    return [];
  }

  const supportedMimes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);

  if (!supportedMimes.has(mimeType)) {
    return [];
  }

  signal?.throwIfAborted();

  try {
    const { generateObject } = await import("ai");
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const { z } = await import("zod");

    const modelId =
      (typeof process !== "undefined" &&
        (process.env.NOTES_AI_MODEL?.trim() ||
          process.env.GEMINI_MODEL?.trim())) ||
      "gemini-3.5-flash";

    const google = createGoogleGenerativeAI({ apiKey });

    const promptText = [
      `You are a specialized mathematical OCR engine.`,
      `Transcribe all mathematical equations and formulas shown in this image from slide ${slide}.`,
      altText ? `Context / image label: ${altText}` : "",
      `Requirements:`,
      `- Extract each distinct mathematical formula into clean, syntactically correct LaTeX.`,
      `- Do NOT enclose LaTeX in '$' or '$$' delimiters.`,
      `- Provide a plain-text ASCII representation for each formula in 'raw'.`,
      `- Provide a confidence score from 0.0 (uncertain) to 1.0 (completely clear and correct).`,
      `- If no mathematical equations or formulas appear in the image, return an empty array.`,
    ]
      .filter(Boolean)
      .join("\n");

    const schema = z.object({
      equations: z.array(
        z.object({
          latex: z.string().describe("Clean LaTeX math without dollar signs"),
          raw: z
            .string()
            .optional()
            .describe("Plain text / ASCII formula representation"),
          confidence: z
            .number()
            .min(0)
            .max(1)
            .describe("Confidence score between 0.0 and 1.0"),
        }),
      ),
    });

    const response = await generateObject({
      model: google(modelId),
      temperature: 0,
      abortSignal: signal,
      schema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
            {
              type: "image",
              image: imageBytes,
              mediaType: mimeType,
            },
          ],
        },
      ],
    });

    const items = response.object?.equations || [];
    return items
      .map((item) => ({
        latex: item.latex.trim(),
        raw: (item.raw || item.latex).trim(),
        confidence: Math.max(0, Math.min(1, item.confidence)),
      }))
      .filter((eq) => eq.latex.length > 0 && eq.confidence > 0);
  } catch {
    return [];
  }
};

export async function parsePptx(
  bytes: Buffer,
  signalOrOptions?: AbortSignal | ParsePptxOptions,
): Promise<ParsePptxResult> {
  let signal: AbortSignal | undefined;
  let customTranscriber: VisionMathTranscriber | undefined;

  if (signalOrOptions) {
    if (signalOrOptions instanceof AbortSignal || "aborted" in signalOrOptions) {
      signal = signalOrOptions as AbortSignal;
    } else {
      signal = signalOrOptions.signal;
      customTranscriber = signalOrOptions.visionTranscriber;
    }
  }

  signal?.throwIfAborted();

  const transcriber: VisionMathTranscriber =
    customTranscriber ?? transcribeEquationImageWithGemini;

  // Validate ZIP header (PK\x03\x04)
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new IngestionError(
      "INVALID_PPTX",
      "This file does not contain a valid PowerPoint presentation.",
      422,
    );
  }

  const JSZip = (await import("jszip")).default;
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new IngestionError(
      "INVALID_PPTX",
      "Could not open PowerPoint file. It may be corrupted or password protected.",
      422,
    );
  }

  // Find all slide XML files: ppt/slides/slide1.xml, slide2.xml...
  const slideEntries: Array<{ num: number; path: string }> = [];
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;

  zip.forEach((relativePath) => {
    const match = relativePath.match(slideRegex);
    if (match) {
      slideEntries.push({
        num: parseInt(match[1], 10),
        path: relativePath,
      });
    }
  });

  if (slideEntries.length === 0) {
    throw new IngestionError(
      "EMPTY_PRESENTATION",
      "No slides found in this PowerPoint presentation.",
      422,
    );
  }

  // Sort slides numerically
  slideEntries.sort((a, b) => a.num - b.num);

  const sources: SourceBlock[] = [];
  const ocrEquations: OcrTranscribedEquation[] = [];
  const ommlEquations: OmmlTranscribedEquation[] = [];
  const warnings: string[] = [];
  let characterCount = 0;
  let emptySlides = 0;

  for (let i = 0; i < slideEntries.length; i++) {
    signal?.throwIfAborted();
    const slide = slideEntries[i];
    const file = zip.file(slide.path);
    if (!file) continue;

    const xml = await file.async("text");

    // 1. Extract OMML equations from slide XML
    const slideOmmls = extractOmmlEquationsFromXml(xml);
    for (const omml of slideOmmls) {
      if (omml.latex.trim()) {
        ommlEquations.push({
          slide: slide.num,
          raw: omml.raw,
          latex: omml.latex,
          origin: "omml",
        });
      }
    }

    // 2. Extract slide text (including inline OMML math)
    let text = extractSlideXmlText(xml);

    // 3. Speaker notes
    const notePath = `ppt/notesSlides/notesSlide${slide.num}.xml`;
    const noteFile = zip.file(notePath);
    if (noteFile) {
      try {
        const noteXml = await noteFile.async("text");
        const noteText = extractSlideXmlText(noteXml);
        // Exclude default placeholder slide number text from notes
        const cleanNotes = noteText.replace(/^Slide\s+\d+$/m, "").trim();
        if (cleanNotes && cleanNotes.length > 5) {
          text += `\n[Notes: ${cleanNotes}]`;
        }
      } catch {
        // Speaker notes optional
      }
    }

    // 4. Equation candidate detection and OCR vision transcription
    const relsPath = slide.path.replace(
      /^ppt\/slides\/slide(\d+)\.xml$/i,
      "ppt/slides/_rels/slide$1.xml.rels",
    );
    const relsFile = zip.file(relsPath);
    const relsXml = relsFile ? await relsFile.async("text") : undefined;

    const candidates = detectSlideEquationCandidates(xml, relsXml, slide.num);

    for (const candidate of candidates) {
      signal?.throwIfAborted();

      const mediaPath = candidate.mediaPath;
      const mediaFile = mediaPath ? zip.file(mediaPath) : undefined;
      const ext = mediaPath?.split(".").at(-1)?.toLowerCase();
      const isVector =
        ext === "wmf" ||
        ext === "emf" ||
        candidate.mimeType === "image/x-wmf" ||
        candidate.mimeType === "image/x-emf";

      if (!mediaFile || isVector) {
        const warnMsg = `Slide ${slide.num} contains an embedded equation image/OLE object that could not be transcribed automatically.`;
        if (!warnings.includes(warnMsg)) {
          warnings.push(warnMsg);
        }
        continue;
      }

      const imageBuffer = await mediaFile.async("nodebuffer");
      const imageBytes = new Uint8Array(
        imageBuffer.buffer,
        imageBuffer.byteOffset,
        imageBuffer.byteLength,
      );
      const mimeType =
        candidate.mimeType || (mediaPath ? getMimeType(mediaPath) : undefined) || "image/png";

      let transcribed: Array<{ raw: string; latex: string; confidence: number }> = [];
      try {
        transcribed = await transcriber({
          imageBytes,
          mimeType,
          slide: slide.num,
          altText: candidate.altText,
          signal,
        });
      } catch {
        transcribed = [];
      }

      let validEquationCount = 0;
      if (Array.isArray(transcribed) && transcribed.length > 0) {
        for (const eq of transcribed) {
          const cleanLatex = (eq.latex || "").trim();
          const conf =
            typeof eq.confidence === "number"
              ? Math.max(0, Math.min(1, eq.confidence))
              : 0;

          if (cleanLatex && conf > 0) {
            validEquationCount++;
            const cleanRaw = (eq.raw || cleanLatex).trim();
            ocrEquations.push({
              slide: slide.num,
              raw: cleanRaw,
              latex: cleanLatex,
              origin: "ocr",
              confidence: conf,
              mediaPath,
            });

            const formulaSnippet = `$${cleanLatex}$`;
            if (!text.includes(formulaSnippet)) {
              text = text.trim() ? `${text.trim()}\n${formulaSnippet}` : formulaSnippet;
            }
          }
        }
      }

      if (validEquationCount === 0) {
        const warnMsg = `Slide ${slide.num} contains an embedded equation image/OLE object that could not be transcribed automatically.`;
        if (!warnings.includes(warnMsg)) {
          warnings.push(warnMsg);
        }
      }
    }

    if (!text.trim()) {
      emptySlides++;
      continue;
    }

    characterCount += text.length;
    if (characterCount > MAX_EXTRACTED_CHARACTERS) {
      throw new IngestionError(
        "TOO_MUCH_TEXT",
        "The presentation exceeds character limits. Split the deck by chapter.",
        413,
      );
    }

    sources.push({
      id: `slide-${slide.num}`,
      label: `Slide ${slide.num}`,
      text: text.trim(),
    });
  }

  if (sources.length === 0) {
    throw new IngestionError(
      "NO_TEXT_FOUND",
      "This slide deck contains only images with no extractable text. Please upload a deck with text or run OCR.",
      422,
    );
  }

  if (emptySlides > 0) {
    warnings.push(
      `${emptySlides} slide(s) contained only images or had no extractable text.`,
    );
  }

  return {
    sources,
    pageCount: slideEntries.length,
    warnings,
    ocrEquations,
    ommlEquations,
  };
}
