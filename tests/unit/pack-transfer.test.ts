import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
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
  buildPrintableWorksheetHtml,
  exportPackToPrintablePdf,
  printStudyGuide,
  resolveImportPackId,
  PackTransferError,
} from "@/lib/game/pack-transfer";
import {
  clearLocalLibraryCaches,
  saveStudyItem,
  readLibrary,
  packQuestionsFingerprint,
  isLibraryIdCollision,
  STORAGE_KEY,
  USER_SCOPED_STORAGE_PREFIX,
  KEY as LIBRARY_STORAGE_KEY,
  type SavedStudyItem,
} from "@/lib/game/library";
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

describe("buildPrintableWorksheetHtml and exportPackToPrintablePdf Isolation (SA-19)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ensures buildPrintableWorksheetHtml output contains zero inline <script> tags", () => {
    const html = buildPrintableWorksheetHtml(samplePack);
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toContain("window.onload");
  });

  it("sets printWindow.opener to null and triggers safe parent print in exportPackToPrintablePdf", () => {
    const mockDocument = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    };
    const mockPrintWindow = {
      opener: "initial-parent-opener" as any,
      document: mockDocument,
      focus: vi.fn(),
      print: vi.fn(),
    };
    const openMock = vi.fn().mockReturnValue(mockPrintWindow);
    vi.stubGlobal("window", {
      open: openMock,
      location: { origin: "http://localhost:3000" },
    });

    vi.useFakeTimers();
    exportPackToPrintablePdf(samplePack);

    expect(openMock).toHaveBeenCalledWith("", "_blank");
    expect(mockPrintWindow.opener).toBeNull();
    expect(mockDocument.open).toHaveBeenCalled();
    expect(mockDocument.write).toHaveBeenCalled();
    expect(mockDocument.close).toHaveBeenCalled();
    expect(mockPrintWindow.focus).toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(mockPrintWindow.print).toHaveBeenCalled();
  });

  it("also sets printWindow.opener to null when called via printStudyGuide alias", () => {
    const mockDocument = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    };
    const mockPrintWindow = {
      opener: "initial-opener" as any,
      document: mockDocument,
      focus: vi.fn(),
      print: vi.fn(),
    };
    const openMock = vi.fn().mockReturnValue(mockPrintWindow);
    vi.stubGlobal("window", {
      open: openMock,
    });

    printStudyGuide(samplePack);
    expect(mockPrintWindow.opener).toBeNull();
  });
});

describe("clearLocalLibraryCaches Per-User Purge on Sign-Out (NV-04)", () => {
  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    mockStore = {};
    const mockLocalStorage = {
      getItem: vi.fn((k: string) => mockStore[k] ?? null),
      setItem: vi.fn((k: string, v: string) => {
        mockStore[k] = v;
      }),
      removeItem: vi.fn((k: string) => {
        delete mockStore[k];
      }),
      clear: vi.fn(() => {
        mockStore = {};
      }),
      get length() {
        return Object.keys(mockStore).length;
      },
      key: vi.fn((idx: number) => Object.keys(mockStore)[idx] ?? null),
    };
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("window", {
      localStorage: mockLocalStorage,
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("purges all clutch:library:* keys and clutch:saved-packs:v1 while preserving unrelated keys", () => {
    mockStore["clutch:library:v1"] = JSON.stringify([{ id: "deck-1" }]);
    mockStore["clutch:library:user-abc-123"] = JSON.stringify([{ id: "deck-2" }]);
    mockStore["clutch:library:user-xyz-456"] = JSON.stringify([{ id: "deck-3" }]);
    mockStore[STORAGE_KEY] = JSON.stringify([{ id: "legacy-deck" }]);
    mockStore["clutch:guest_usage:v1"] = "2";
    mockStore["other_app:settings"] = "dark_mode";

    clearLocalLibraryCaches();

    expect(mockStore["clutch:library:v1"]).toBeUndefined();
    expect(mockStore["clutch:library:user-abc-123"]).toBeUndefined();
    expect(mockStore["clutch:library:user-xyz-456"]).toBeUndefined();
    expect(mockStore[STORAGE_KEY]).toBeUndefined();
    // Unrelated keys outside clutch:library:* and STORAGE_KEY should remain intact
    expect(mockStore["clutch:guest_usage:v1"]).toBe("2");
    expect(mockStore["other_app:settings"]).toBe("dark_mode");
  });
});

describe("Import Collision Prevention and Silent Overwrite Protection (NV-03)", () => {
  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    mockStore = {};
    const mockLocalStorage = {
      getItem: vi.fn((k: string) => mockStore[k] ?? null),
      setItem: vi.fn((k: string, v: string) => {
        mockStore[k] = v;
      }),
      removeItem: vi.fn((k: string) => {
        delete mockStore[k];
      }),
      clear: vi.fn(() => {
        mockStore = {};
      }),
      get length() {
        return Object.keys(mockStore).length;
      },
      key: vi.fn((idx: number) => Object.keys(mockStore)[idx] ?? null),
    };
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("window", {
      localStorage: mockLocalStorage,
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolveImportPackId generates a fresh collision-safe ID if ID already exists", () => {
    const existingIds = ["sample-pack-cell-bio", "existing-pack-2"];
    const resolved = resolveImportPackId(samplePack, existingIds);

    expect(resolved.id).not.toBe(samplePack.id);
    expect(resolved.id).toContain(`${samplePack.id}-imported-`);
    expect(resolved.title).toBe(samplePack.title);
  });

  it("resolveImportPackId preserves original ID if overwrite: true is passed", () => {
    const existingIds = ["sample-pack-cell-bio"];
    const resolved = resolveImportPackId(samplePack, existingIds, { overwrite: true });
    expect(resolved.id).toBe(samplePack.id);
  });

  it("parsePackJson reassigns collision-safe ID when colliding with existingIds", () => {
    const json = packToJson(samplePack);
    const existingIds = [samplePack.id];
    const imported = parsePackJson(json, { existingIds });

    expect(imported.id).not.toBe(samplePack.id);
    expect(imported.id).toContain(`${samplePack.id}-imported-`);
    expect(imported.title).toBe(samplePack.title);
  });

  it("decodeSharedPack reassigns collision-safe ID when colliding with existingIds", async () => {
    const token = await encodePackForShare(samplePack);
    const existingIds = [samplePack.id];
    const imported = await decodeSharedPack(token, { existingIds });

    expect(imported.id).not.toBe(samplePack.id);
    expect(imported.id).toContain(`${samplePack.id}-imported-`);
    expect(imported.title).toBe(samplePack.title);
  });

  it("saveStudyItem prevents an imported share pack from silently clobbering an unrelated existing deck", () => {
    const existingItem: SavedStudyItem = {
      id: "shared-collision-deck-id",
      title: "Legitimate Corporate Finance Deck",
      createdAt: "2026-01-01T00:00:00Z",
      questionCount: 1,
      format: "txt",
      fileName: "corp-fin.txt",
      pack: {
        id: "shared-collision-deck-id",
        title: "Legitimate Corporate Finance Deck",
        subtitle: "",
        questions: [
          {
            id: "q-orig-1",
            question: "What is WACC?",
            options: ["Weighted Cost", "Other", "None", "All"],
            correctIndex: 0,
            explanation: "Weighted average cost of capital",
            conceptVariant: {
              question: "What does WACC stand for?",
              options: ["Weighted Cost", "Other", "None", "All"],
              correctIndex: 0,
              explanation: "Weighted average cost of capital",
            },
          },
        ],
        metadata: {},
      },
      document: {
        format: "txt",
        fileName: "corp-fin.txt",
        characterCount: 100,
        pageCount: null,
        sources: [],
        warnings: [],
      },
    };

    // 1. Save original legitimate deck
    saveStudyItem(existingItem);
    expect(readLibrary()).toHaveLength(1);
    expect(readLibrary()[0].title).toBe("Legitimate Corporate Finance Deck");

    // 2. Untrusted imported share pack with colliding ID but different content/title
    const collidingImportItem: SavedStudyItem = {
      id: "shared-collision-deck-id",
      title: "Untrusted Random Shared Pack",
      createdAt: "2026-02-01T00:00:00Z",
      questionCount: 1,
      format: "txt",
      fileName: "untrusted.txt",
      pack: {
        id: "shared-collision-deck-id",
        title: "Untrusted Random Shared Pack",
        subtitle: "",
        questions: [
          {
            id: "q-fake-1",
            question: "Is this safe?",
            options: ["Yes", "No", "Maybe", "Unknown"],
            correctIndex: 0,
            explanation: "Checking collision",
            conceptVariant: {
              question: "Is this safe?",
              options: ["Yes", "No", "Maybe", "Unknown"],
              correctIndex: 0,
              explanation: "Checking collision",
            },
          },
        ],
        metadata: {},
      },
      document: {
        format: "txt",
        fileName: "untrusted.txt",
        characterCount: 50,
        pageCount: null,
        sources: [],
        warnings: [],
      },
    };

    // Save colliding pack without overwrite: true
    const updatedLibrary = saveStudyItem(collidingImportItem);

    // Verify existing deck was NOT clobbered and both decks now exist
    expect(updatedLibrary).toHaveLength(2);
    const originalDeck = updatedLibrary.find((d) => d.id === "shared-collision-deck-id");
    expect(originalDeck).toBeDefined();
    expect(originalDeck?.title).toBe("Legitimate Corporate Finance Deck");

    const importedDeck = updatedLibrary.find((d) => d.title === "Untrusted Random Shared Pack");
    expect(importedDeck).toBeDefined();
    expect(importedDeck?.id).not.toBe("shared-collision-deck-id");
    expect(importedDeck?.id).toContain("shared-collision-deck-id-copy-");
  });

  it("saveStudyItem allows intentional overwrite when overwrite: true is passed", () => {
    const originalItem: SavedStudyItem = {
      id: "deck-to-overwrite",
      title: "Original Version",
      createdAt: "2026-01-01T00:00:00Z",
      questionCount: 1,
      format: "txt",
      fileName: "v1.txt",
      pack: {
        id: "deck-to-overwrite",
        title: "Original Version",
        subtitle: "",
        questions: [],
        metadata: {},
      },
      document: {
        format: "txt",
        fileName: "v1.txt",
        characterCount: 10,
        pageCount: null,
        sources: [],
        warnings: [],
      },
    };
    saveStudyItem(originalItem);
    expect(readLibrary()).toHaveLength(1);
    expect(readLibrary()[0].title).toBe("Original Version");

    const updatedItem: SavedStudyItem = {
      ...originalItem,
      title: "Updated Version 2.0",
    };
    saveStudyItem(updatedItem, { overwrite: true });

    const library = readLibrary();
    expect(library).toHaveLength(1);
    expect(library[0].id).toBe("deck-to-overwrite");
    expect(library[0].title).toBe("Updated Version 2.0");
  });

  describe("packQuestionsFingerprint", () => {
    it("produces identical fingerprints for identical study packs", () => {
      const fp1 = packQuestionsFingerprint(samplePack);
      const fp2 = packQuestionsFingerprint({ ...samplePack });
      expect(fp1).toBe(fp2);
      expect(fp1.startsWith("fp_")).toBe(true);
    });

    it("produces different fingerprints when pack title differs even if questions are identical", () => {
      const altPack: StudyPack = {
        ...samplePack,
        title: "Cell Biology Essentials - Advanced Edition",
      };
      expect(packQuestionsFingerprint(altPack)).not.toBe(packQuestionsFingerprint(samplePack));
    });

    it("produces different fingerprints when pack subtitle differs even if questions are identical", () => {
      const altPack: StudyPack = {
        ...samplePack,
        subtitle: "Altered subtitle for different course",
      };
      expect(packQuestionsFingerprint(altPack)).not.toBe(packQuestionsFingerprint(samplePack));
    });

    it("produces different fingerprints when metadata fields change even if question text is identical", () => {
      const altPack: StudyPack = {
        ...samplePack,
        metadata: {
          ...samplePack.metadata,
          "q-1": {
            ...samplePack.metadata["q-1"],
            rule: "Altered ATP synthesis explanation rule.",
          },
        },
      };
      expect(packQuestionsFingerprint(altPack)).not.toBe(packQuestionsFingerprint(samplePack));
    });

    it("produces different fingerprints when question content changes", () => {
      const altPack: StudyPack = {
        ...samplePack,
        questions: [
          {
            ...samplePack.questions[0],
            question: "Which cellular organelle creates ATP?",
          },
          samplePack.questions[1],
        ],
      };
      expect(packQuestionsFingerprint(altPack)).not.toBe(packQuestionsFingerprint(samplePack));
    });

    it("produces identical fingerprints regardless of metadata key ordering", () => {
      const packOrder1: StudyPack = {
        ...samplePack,
        metadata: {
          "q-1": samplePack.metadata["q-1"],
          "q-2": samplePack.metadata["q-2"],
        },
      };
      const packOrder2: StudyPack = {
        ...samplePack,
        metadata: {
          "q-2": samplePack.metadata["q-2"],
          "q-1": samplePack.metadata["q-1"],
        },
      };
      expect(packQuestionsFingerprint(packOrder1)).toBe(packQuestionsFingerprint(packOrder2));
    });

    it("handles empty or missing metadata and subtitles gracefully", () => {
      const minimalPack: StudyPack = {
        id: "min-1",
        title: "Minimal",
        subtitle: "",
        questions: [samplePack.questions[0]],
        metadata: {},
      };
      const fp = packQuestionsFingerprint(minimalPack);
      expect(fp.startsWith("fp_")).toBe(true);
    });
  });

  describe("isLibraryIdCollision & unique shared import ID minting", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("detects collisions when ID matches but content fingerprint differs", () => {
      const existingItem: SavedStudyItem = {
        id: "deck-123",
        title: "Physics 101",
        createdAt: new Date().toISOString(),
        questionCount: 1,
        format: "txt",
        fileName: "physics.json",
        pack: {
          id: "deck-123",
          title: "Physics 101",
          subtitle: "",
          questions: [samplePack.questions[0]],
          metadata: {},
        },
        document: {
          format: "txt",
          fileName: "physics.json",
          characterCount: 100,
          pageCount: null,
          sources: [],
          warnings: [],
        },
      };
      saveStudyItem(existingItem);

      // Same ID, different title/fingerprint -> isLibraryIdCollision = true
      const collidingPack: StudyPack = {
        id: "deck-123",
        title: "Malicious / Modified Physics 101",
        subtitle: "",
        questions: [samplePack.questions[0]],
        metadata: {},
      };
      expect(isLibraryIdCollision("deck-123", collidingPack)).toBe(true);

      // Same ID, exact same content -> isLibraryIdCollision = false
      expect(isLibraryIdCollision("deck-123", existingItem.pack)).toBe(false);
    });

    it("generates unique collision-safe shared- IDs for imported decks", () => {
      const mintUniqueSharedId = () =>
        `shared-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;

      const id1 = mintUniqueSharedId();
      const id2 = mintUniqueSharedId();

      expect(id1.startsWith("shared-")).toBe(true);
      expect(id2.startsWith("shared-")).toBe(true);
      expect(id1).not.toBe(id2);
    });
  });
});

