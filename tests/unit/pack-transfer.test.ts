import { describe, expect, it, vi, afterEach } from "vitest";
import {
  packToJson,
  parsePackJson,
  packToCsv,
  packToAnki,
  packToMarkdown,
  packToQuizlet,
  encodePackForShare,
  decodeSharedPack,
  readShareToken,
  sanitizeShareToken,
  copyTextWithFallback,
  buildShareUrl,
  documentFromPack,
  PackTransferError,
} from "@/lib/game/pack-transfer";
import type { StudyPack } from "@/lib/schemas/question";

const samplePack: StudyPack = {
  id: "sample-pack-cell-bio",
  title: "Cell Biology Essentials",
  subtitle: "Fundamentals of cell structure and energy",
  questions: [
    {
      id: "q-1",
      question: "Which organelle generates ATP?",
      options: ["Mitochondria", "Ribosome", "Golgi apparatus", "Lysosome"],
      correctIndex: 0,
      explanation: "Mitochondria produce most of the chemical energy via oxidative phosphorylation.",
      conceptVariant: {
        question: "Where does ATP synthase operate in animal cells?",
        options: ["Inner mitochondrial membrane", "Outer membrane", "Nucleus", "Cytoplasm"],
        correctIndex: 0,
        explanation: "ATP synthase is embedded in the inner mitochondrial membrane.",
      },
    },
    {
      id: "q-2",
      question: "=SUM(1+1) is dangerous in spreadsheets without escaping.",
      options: ["Formula test", "Normal text", "Other", "Nothing"],
      correctIndex: 1,
      explanation: "Testing formula escape & HTML <tags>.",
      conceptVariant: {
        question: "Does CSV injection risk exist when exporting untrusted text?",
        options: ["Yes", "No", "Never", "Only Linux"],
        correctIndex: 0,
        explanation: "Spreadsheet software executes cells beginning with =, +, -, @.",
      },
    },
  ],
  metadata: {
    "q-1": {
      topic: "Energy",
      chapter: "Chapter 3",
      citation: "Page 42, Para 2",
      rule: "ATP synthesis occurs in inner mitochondrial membrane.",
    },
    "q-2": {
      topic: "Spreadsheets",
      chapter: "Security",
      citation: "Page 99",
      rule: "Formulas begin with equals sign.",
    },
  },
};

describe("packToJson and parsePackJson", () => {
  it("losslessly round-trips a valid study pack", () => {
    const json = packToJson(samplePack);
    const parsed = parsePackJson(json);
    expect(parsed).toEqual(samplePack);
  });

  it("parses raw pack JSON when not wrapped in clutch-pack envelope", () => {
    const raw = JSON.stringify(samplePack);
    const parsed = parsePackJson(raw);
    expect(parsed.title).toBe(samplePack.title);
    expect(parsed.questions).toHaveLength(2);
  });

  it("throws PackTransferError on malformed JSON", () => {
    expect(() => parsePackJson("{not-json")).toThrow(PackTransferError);
  });

  it("throws PackTransferError when pack schema is invalid", () => {
    expect(() => parsePackJson(JSON.stringify({ title: "" }))).toThrow(PackTransferError);
  });
});

describe("packToCsv", () => {
  it("exports valid CSV rows and neutralizes formula injection", () => {
    const csv = packToCsv(samplePack);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(
      "Question,Option A,Option B,Option C,Option D,Correct Letter,Correct Answer,Explanation,Topic,Chapter,Citation",
    );

    // Second question starts with `=SUM`, verify it is single-quote prefixed
    const q2Line = lines.find((l) => l.includes("SUM"));
    expect(q2Line).toBeDefined();
    expect(q2Line).toContain("'=SUM(1+1) is dangerous in spreadsheets without escaping.");
  });
});

describe("packToMarkdown", () => {
  it("generates structured markdown study guide with rules and questions", () => {
    const md = packToMarkdown(samplePack);
    expect(md).toContain("# Cell Biology Essentials");
    expect(md).toContain("## 📌 Key Definitions & Essential Rules");
    expect(md).toContain("**Energy**: ATP synthesis occurs in inner mitochondrial membrane.");
    expect(md).toContain("### Question 1: Which organelle generates ATP?");
    expect(md).toContain("**A. Mitochondria**  *(Correct)*");
    expect(md).toContain("> **Explanation:** Mitochondria produce most of the chemical energy via oxidative phosphorylation.");
    expect(md).toContain("> **Citation:** Page 42, Para 2");
  });

  it("filters to subset of question IDs when specified", () => {
    const md = packToMarkdown(samplePack, ["q-1"]);
    expect(md).toContain("Total Concepts / Questions:** 1");
    expect(md).toContain("Which organelle generates ATP?");
    expect(md).not.toContain("=SUM(1+1)");
  });
});

describe("packToQuizlet", () => {
  it("formats tab-separated cards for Quizlet import", () => {
    const quizlet = packToQuizlet(samplePack);
    const lines = quizlet.split("\n");
    expect(lines).toHaveLength(2);

    const [term, def] = lines[0].split("\t");
    expect(term).toContain("Which organelle generates ATP?");
    expect(term).toContain("[Options: A) Mitochondria");
    expect(def).toContain("Answer: A) Mitochondria");
    expect(def).toContain("Mitochondria produce most of the chemical energy");
  });

  it("filters to subset when question IDs are passed", () => {
    const quizlet = packToQuizlet(samplePack, ["q-2"]);
    const lines = quizlet.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("=SUM(1+1)");
  });
});

describe("packToAnki", () => {
  it("formats tab-separated notes with HTML escaping and tags", () => {
    const anki = packToAnki(samplePack);
    const lines = anki.split("\n");

    expect(lines[0]).toBe("#separator:tab");
    expect(lines[1]).toBe("#html:true");
    expect(lines[2]).toBe("#tags column:3");

    // Check HTML escaping in q2
    const q2Line = lines.find((l) => l.includes("formula escape"));
    expect(q2Line).toBeDefined();
    expect(q2Line).toContain("&amp; HTML &lt;tags&gt;.");

    // Check tags column (3rd field)
    const fields = lines[3].split("\t");
    expect(fields).toHaveLength(3);
    expect(fields[2]).toContain("clutch-arena");
    expect(fields[2]).toContain("cell-biology-essentials");
  });

  it("supports filtering by question IDs", () => {
    const anki = packToAnki(samplePack, ["q-1"]);
    const lines = anki.split("\n");
    // Header (3 lines) + 1 question
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("Which organelle generates ATP?");
  });
});

describe("encodePackForShare and decodeSharedPack", () => {
  it("round-trips through URL-safe token compression", async () => {
    const token = await encodePackForShare(samplePack);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = await decodeSharedPack(token);
    expect(decoded).toEqual(samplePack);
  });

  it("builds and extracts share URLs cleanly", async () => {
    const token = await encodePackForShare(samplePack);
    const url = buildShareUrl("https://clutch.arena", token);
    expect(url).toContain("#pack=");

    const extracted = readShareToken(url.slice(url.indexOf("#")));
    expect(extracted).toBe(token);
  });

  it("throws PackTransferError on corrupted or bogus tokens", async () => {
    await expect(decodeSharedPack("not-a-token")).rejects.toThrow(PackTransferError);
    await expect(decodeSharedPack("1.invalid_base64_???")).rejects.toThrow(PackTransferError);
    await expect(decodeSharedPack("9.unsupported_version")).rejects.toThrow(PackTransferError);
  });
});

describe("documentFromPack", () => {
  it("reconstructs grounded document context from citations and rules", () => {
    const doc = documentFromPack(samplePack);
    expect(doc.sources.length).toBeGreaterThanOrEqual(1);
    expect(doc.sources[0].label).toBe("Page 42, Para 2");
    expect(doc.sources[0].text).toContain("ATP synthesis occurs in inner mitochondrial membrane.");
    expect(doc.warnings?.[0]).toContain("Imported pack");
  });
});

describe("readShareToken tracking sanitization & query string fallback", () => {
  const token = "1.sample-test-token-payload";

  it("extracts token from standard hash", () => {
    expect(readShareToken(`#pack=${token}`)).toBe(token);
  });

  it("strips Zalo tracking suffixes (?zarsrc=1303, &zarsrc=31)", () => {
    expect(readShareToken(`#pack=${token}?zarsrc=1303`)).toBe(token);
    expect(readShareToken(`#pack=${token}&zarsrc=31`)).toBe(token);
    expect(readShareToken(`https://clutch.arena/solo#pack=${token}?zarsrc=1303`)).toBe(token);
  });

  it("strips Facebook Messenger tracking suffixes (&fbclid=IwAR123, ?fbclid=IwAR123)", () => {
    expect(readShareToken(`#pack=${token}&fbclid=IwAR123`)).toBe(token);
    expect(readShareToken(`#pack=${token}?fbclid=IwAR123`)).toBe(token);
    expect(readShareToken(`https://clutch.arena/solo#pack=${token}?fbclid=IwAR123&zarsrc=31`)).toBe(token);
  });

  it("strips utm tracking parameters attached to hash", () => {
    expect(readShareToken(`#pack=${token}?utm_source=chat&utm_medium=zalo`)).toBe(token);
    expect(readShareToken(`#pack=${token}&utm_campaign=share`)).toBe(token);
  });

  it("extracts token when passed via ?pack= query string fallback", () => {
    expect(readShareToken("", `?pack=${token}`)).toBe(token);
    expect(readShareToken("", `?pack=${token}&zarsrc=1303`)).toBe(token);
    expect(readShareToken("", `?pack=${token}&fbclid=IwAR123`)).toBe(token);
    expect(readShareToken("", `?pack=${token}?fbclid=IwAR123`)).toBe(token);
    expect(readShareToken("#something-else", `?pack=${token}`)).toBe(token);
  });

  it("extracts token from full URL with query param", () => {
    expect(readShareToken(`https://clutch.arena/solo?pack=${token}&fbclid=IwAR123`)).toBe(token);
    expect(readShareToken(`https://clutch.arena/solo?pack=${token}&zarsrc=1303`)).toBe(token);
  });

  it("strips trailing whitespace and punctuation from chat linkifiers", () => {
    expect(readShareToken(`#pack=${token}. `)).toBe(token);
    expect(readShareToken(`#pack=${token})`)).toBe(token);
    expect(readShareToken(`#pack=${token};\n`)).toBe(token);
  });

  it("returns null when no pack token is found", () => {
    expect(readShareToken("")).toBeNull();
    expect(readShareToken("#")).toBeNull();
    expect(readShareToken("#pack=")).toBeNull();
    expect(readShareToken("#other=123")).toBeNull();
    expect(readShareToken("https://clutch.arena/solo")).toBeNull();
    expect(readShareToken("", "?other=123")).toBeNull();
  });
});

describe("decodeSharedPack with tracking suffixes", () => {
  it("decodes cleanly when token has Zalo (?zarsrc=1303, &zarsrc=31) suffix attached", async () => {
    const rawToken = await encodePackForShare(samplePack);
    const decoded1 = await decodeSharedPack(`${rawToken}?zarsrc=1303`);
    expect(decoded1.title).toBe(samplePack.title);

    const decoded2 = await decodeSharedPack(`${rawToken}&zarsrc=31`);
    expect(decoded2.title).toBe(samplePack.title);
  });

  it("decodes cleanly when token has Messenger (?fbclid=IwAR123, &fbclid=IwAR123) suffix attached", async () => {
    const rawToken = await encodePackForShare(samplePack);
    const decoded1 = await decodeSharedPack(`${rawToken}?fbclid=IwAR123`);
    expect(decoded1.title).toBe(samplePack.title);

    const decoded2 = await decodeSharedPack(`${rawToken}&fbclid=IwAR123`);
    expect(decoded2.title).toBe(samplePack.title);
  });

  it("decodes cleanly when extracted from ?pack= query string fallback with tracking", async () => {
    const rawToken = await encodePackForShare(samplePack);
    const extracted = readShareToken("", `?pack=${rawToken}&zarsrc=1303`);
    expect(extracted).not.toBeNull();
    const decoded = await decodeSharedPack(extracted!);
    expect(decoded.title).toBe(samplePack.title);
    expect(decoded.questions).toHaveLength(samplePack.questions.length);
  });
});

describe("copyTextWithFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns false in non-browser (SSR / node) environment when window is undefined", async () => {
    vi.stubGlobal("window", undefined);
    const result = await copyTextWithFallback("https://clutch.arena/solo#pack=1.test");
    expect(result).toBe(false);
  });

  it("copies via navigator.clipboard.writeText when available and resolved", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const success = await copyTextWithFallback("https://clutch.arena/solo#pack=1.test");
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("https://clutch.arena/solo#pack=1.test");
  });

  it("falls back to document.execCommand when navigator.clipboard throws (webview blocked)", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied inside in-app browser"));
    const execCommandMock = vi.fn().mockReturnValue(true);

    const dummyTextArea: any = {
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      parentNode: null,
    };

    const bodyChildren: any[] = [];
    const dummyDocument: any = {
      createElement: vi.fn((tag: string) => {
        if (tag === "textarea") return dummyTextArea;
        return {};
      }),
      body: {
        appendChild: vi.fn((node: any) => {
          bodyChildren.push(node);
          node.parentNode = dummyDocument.body;
          return node;
        }),
        removeChild: vi.fn((node: any) => {
          const idx = bodyChildren.indexOf(node);
          if (idx !== -1) bodyChildren.splice(idx, 1);
          node.parentNode = null;
          return node;
        }),
      },
      execCommand: execCommandMock,
    };

    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });
    vi.stubGlobal("document", dummyDocument);

    const success = await copyTextWithFallback("https://clutch.arena/solo#pack=1.test");
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalled();
    expect(dummyDocument.createElement).toHaveBeenCalledWith("textarea");
    expect(dummyTextArea.value).toBe("https://clutch.arena/solo#pack=1.test");
    expect(dummyTextArea.readOnly).toBe(true);
    expect(dummyTextArea.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(dummyTextArea.select).toHaveBeenCalled();
    expect(dummyTextArea.setSelectionRange).toHaveBeenCalledWith(0, "https://clutch.arena/solo#pack=1.test".length);
    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(dummyDocument.body.removeChild).toHaveBeenCalledWith(dummyTextArea);
  });

  it("returns false if both modern clipboard and execCommand fail", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const execCommandMock = vi.fn().mockReturnValue(false);

    const dummyTextArea: any = {
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      parentNode: null,
    };

    const dummyDocument: any = {
      createElement: vi.fn(() => dummyTextArea),
      body: {
        appendChild: vi.fn((node: any) => {
          node.parentNode = dummyDocument.body;
          return node;
        }),
        removeChild: vi.fn((node: any) => {
          node.parentNode = null;
          return node;
        }),
      },
      execCommand: execCommandMock,
    };

    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });
    vi.stubGlobal("document", dummyDocument);

    const success = await copyTextWithFallback("fallback failure text");
    expect(success).toBe(false);
  });
});

