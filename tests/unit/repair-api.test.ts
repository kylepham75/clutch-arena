import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockGenerateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

import { POST } from "@/app/api/repair/route";
import {
  deterministicRepairQuestion,
  deterministicRepairFormula,
} from "@/app/api/repair/helpers";
import {
  getUserQuotaLedger,
  resetQuotaLedgersForTests,
  saveUserQuotaLedger,
} from "@/lib/rate-limit";
import type { QuestionItem, QuestionMetadata } from "@/lib/schemas/question";
import type { NoteFormula } from "@/lib/schemas/notes";

const sampleQuestion: QuestionItem = {
  id: "q-econ-101",
  question: "Tính tỷ \\Sigma ất sinh lời kỳ vọng khi r == 0.08 và $PV = 100",
  options: [
    "Tỷ \\Sigma ất là 8%",
    "Tỷ \\Sigma ất là 10%",
    "Tỷ \\Sigma ất là 12%",
    "Tỷ \\Sigma ất là 14%",
  ],
  correctIndex: 0,
  explanation: "Khi r == 0.08, tỷ \\Sigma ất sinh lời là 8%.",
  conceptVariant: {
    question: "Biến thể: Tính tỷ \\Sigma ất khi r == 0.10",
    options: ["8%", "10%", "12%", "14%"],
    correctIndex: 1,
    explanation: "Tỷ \\Sigma ất là 10%.",
  },
};

const sampleMetadata: QuestionMetadata = {
  topic: "Kinh tế học",
  chapter: "Chương 1",
  citation: "Slide 12",
  rule: "r == r_f + \\beta == 0.08",
  distractorRationale: "Lựa chọn sai do nhầm lẫn tỷ \\Sigma ất",
};

const sampleFormula: NoteFormula = {
  name: "Tỷ \\Sigma ất Gordon",
  leadText: "Công thức tính tỷ \\Sigma ất sinh lời:",
  latex: "P_0 == \\frac{D_1}{R - g}",
  description: "Mô hình chiết khấu cổ tức",
  variables: [
    { symbol: "$P_0$", definition: "Giá cổ phiếu hôm nay" },
    { symbol: "D_1", definition: "Cổ tức năm 1" },
    { symbol: "R", definition: "Tỷ \\Sigma ất chiết khấu" },
    { symbol: "g", definition: "Tỷ \\Sigma ất tăng trưởng" },
  ],
  status: "needs_review",
  reviewReason: "Formula transcription disputed",
};

describe("Deterministic Repair Helpers", () => {
  it("deterministicRepairQuestion cleans Vietnamese Sigma typos, balances odd dollar signs, and normalizes consecutive ==", () => {
    const result = deterministicRepairQuestion(sampleQuestion, sampleMetadata);
    expect(result.changed).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);

    // Vietnamese Sigma typos cleaned
    expect(result.question.question).toContain("tỷ suất sinh lời");
    expect(result.question.options[0]).toBe("Tỷ suất là 8%");
    expect(result.question.explanation).toContain("tỷ suất sinh lời là 8%.");
    expect(result.question.conceptVariant.question).toContain("tỷ suất khi");

    // Consecutive == normalized to =
    expect(result.question.question).toContain("r = 0.08");
    expect(result.question.question).not.toContain("==");
    expect(result.question.explanation).toContain("r = 0.08");

    // Unbalanced $ delimiter balanced
    expect(result.question.question).toContain("$PV = 100$");

    // Metadata cleaned
    expect(result.metadata?.rule).toContain("r = r_f + \\beta = 0.08");
    expect(result.metadata?.distractorRationale).toContain("tỷ suất");
  });

  it("deterministicRepairFormula cleans typography, strips outer dollars, normalizes == to =, sets status to verified, and clears reviewReason", () => {
    const result = deterministicRepairFormula(sampleFormula);
    expect(result.changed).toBe(true);

    // Formula typography and equation normalized
    expect(result.formula.name).toBe("Tỷ suất Gordon");
    expect(result.formula.leadText).toBe("Công thức tính tỷ suất sinh lời:");
    expect(result.formula.latex).toBe("P_0 = \\frac{D_1}{R - g}");
    expect(result.formula.latex).not.toContain("==");

    // Variables cleaned (outer $ stripped, typography fixed)
    expect(result.formula.variables[0].symbol).toBe("P_0");
    expect(result.formula.variables[2].definition).toBe("Tỷ suất chiết khấu");
    expect(result.formula.variables[3].definition).toBe("Tỷ suất tăng trưởng");

    // Status set to verified and reviewReason cleared
    expect(result.formula.status).toBe("verified");
    expect(result.formula.reviewReason).toBeUndefined();
  });
});

describe("POST /api/repair route handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetQuotaLedgersForTests();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("returns 400 for malformed JSON request body", async () => {
    const req = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json ...",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("Malformed JSON");
  });

  it("returns 400 for invalid schema payload", async () => {
    const req = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "unknown_kind",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it("kind: 'question' gracefully falls back to deterministic repair when LLM is unconfigured or fails", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";
    mockGenerateObject.mockRejectedValueOnce(
      new Error("AI service is not configured."),
    );

    const req = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "question",
        question: sampleQuestion,
        metadata: sampleMetadata,
        sourceText: "Slide 12: Tỷ suất sinh lời r = 8%.",
        userNote: "Câu hỏi bị lỗi font tiếng Việt và công thức.",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.kind).toBe("question");
    expect(data.hallucinationDetected).toBe(true);
    expect(data.question.id).toBe(sampleQuestion.id);
    expect(data.question.question).toContain("tỷ suất sinh lời");
    expect(data.question.question).toContain("r = 0.08");
    expect(data.metadata.distractorRationale).toContain("tỷ suất");
  });

  it("kind: 'question' returns LLM math-fix response updating correctIndex and explanation", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        hallucinationDetected: true,
        summary:
          "Math error corrected: the true correct answer is option index 1 (10%), not index 0.",
        question: {
          question: "Tính tỷ suất sinh lời kỳ vọng khi r = 0.10 và PV = 100",
          options: [
            "Tỷ suất là 8%",
            "Tỷ suất là 10%",
            "Tỷ suất là 12%",
            "Tỷ suất là 14%",
          ],
          correctIndex: 1,
          explanation: "Áp dụng r = 0.10, đáp án chính xác là 10%.",
          conceptVariant: {
            question: "Biến thể: Tính tỷ suất khi r = 0.12",
            options: ["8%", "10%", "12%", "14%"],
            correctIndex: 2,
            explanation: "Tỷ suất là 12%.",
          },
        },
        metadata: {
          topic: "Kinh tế học",
          chapter: "Chương 1",
          citation: "Slide 12",
          rule: "r = 0.10",
        },
      },
    });

    const req = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "question",
        question: sampleQuestion,
        metadata: sampleMetadata,
        sourceText: "Slide 12: Tỷ suất sinh lời là 10%.",
        userNote: "Đáp án bị sai, phải là B chứ không phải A.",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.kind).toBe("question");
    expect(data.hallucinationDetected).toBe(true);
    expect(data.summary).toContain("Math error corrected");
    expect(data.question.id).toBe(sampleQuestion.id); // Strict original ID retention
    expect(data.question.correctIndex).toBe(1); // Upgraded from 0 to 1
    expect(data.question.explanation).toContain("đáp án chính xác là 10%");
  });

  it("kind: 'note_formula' falls back to deterministic cleanup when LLM fails", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";
    mockGenerateObject.mockRejectedValueOnce(
      new Error("AI service is not configured."),
    );

    const req = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "note_formula",
        sectionId: "sec-a",
        formulaIndex: 0,
        formula: sampleFormula,
        sectionTitle: "A. CÔNG THỨC ĐỊNH GIÁ",
        sourceText: "Slide 5: P_0 = D_1 / (R - g)",
        userNote: "Công thức có dấu == và ký tự lạ.",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.kind).toBe("note_formula");
    expect(data.hallucinationDetected).toBe(true);
    expect(data.formula.status).toBe("verified");
    expect(data.formula.reviewReason).toBeUndefined();
    expect(data.formula.latex).toBe("P_0 = \\frac{D_1}{R - g}");
    expect(data.formula.name).toBe("Tỷ suất Gordon");
  });

  it("kind: 'note_formula' repairs formula via mocked LLM response", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        hallucinationDetected: true,
        summary:
          "Repaired inverted denominator in Capital Asset Pricing Model (CAPM).",
        formula: {
          name: "Mô hình CAPM",
          leadText: "Công thức CAPM chuẩn:",
          latex: "E(R_i) = R_f + \\beta_i [E(R_M) - R_f]",
          description: "Mô hình định giá tài sản vốn",
          variables: [
            { symbol: "E(R_i)", definition: "Tỷ suất sinh lời kỳ vọng" },
            { symbol: "R_f", definition: "Lãi suất phi rủi ro" },
            { symbol: "\\beta_i", definition: "Hệ số beta đo lường rủi ro hệ thống" },
          ],
        },
      },
    });

    const wrongCapmFormula: NoteFormula = {
      name: "CAPM",
      leadText: "Công thức:",
      latex: "E(R_i) = R_f - \\beta_i [E(R_M) + R_f]", // Wrong signs
      variables: [],
      status: "needs_review",
    };

    const req = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "note_formula",
        sectionId: "sec-b",
        formulaIndex: 1,
        formula: wrongCapmFormula,
        sectionTitle: "B. CAPM",
        sourceText: "Slide 8: E(R_i) = R_f + beta_i * (E(R_M) - R_f)",
        userNote: "Dấu cộng trừ trong CAPM bị ngược.",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.kind).toBe("note_formula");
    expect(data.hallucinationDetected).toBe(true);
    expect(data.summary).toContain("CAPM");
    expect(data.formula.latex).toBe("E(R_i) = R_f + \\beta_i [E(R_M) - R_f]");
    expect(data.formula.status).toBe("verified");
    expect(data.formula.reviewReason).toBeUndefined();
    expect(data.formula.variables).toHaveLength(3);
  });

  it("rejects cross-origin requests with 403 ORIGIN_NOT_ALLOWED", async () => {
    const req = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({
        kind: "question",
        question: sampleQuestion,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("rejects unauthenticated callers with 401 UNAUTHORIZED when auth is enforced or invalid token is supplied", async () => {
    const reqEnforced = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-enforce-auth": "true",
      },
      body: JSON.stringify({
        kind: "question",
        question: sampleQuestion,
      }),
    });

    const res1 = await POST(reqEnforced);
    expect(res1.status).toBe(401);
    expect(await res1.json()).toEqual({ ok: false, error: "UNAUTHORIZED" });

    const reqInvalidToken = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-jwt-token",
      },
      body: JSON.stringify({
        kind: "question",
        question: sampleQuestion,
      }),
    });

    const res2 = await POST(reqInvalidToken);
    expect(res2.status).toBe(401);
    expect(await res2.json()).toEqual({ ok: false, error: "UNAUTHORIZED" });
  });

  it("enforces rate limiting with 429 RATE_LIMIT_EXCEEDED when x-enforce-rate-limit is enabled", async () => {
    let lastRes: Response | null = null;
    for (let i = 0; i < 16; i++) {
      const req = new Request("http://localhost:3000/api/repair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-enforce-rate-limit": "true",
          "x-real-ip": "198.51.100.42",
        },
        body: JSON.stringify({
          kind: "question",
          question: sampleQuestion,
        }),
      });
      lastRes = await POST(req);
    }

    expect(lastRes).not.toBeNull();
    expect(lastRes!.status).toBe(429);
    const data = await lastRes!.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("rolls back quota reservation on LLM failure and rejects with 429 when rolling quota is depleted", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";
    mockGenerateObject.mockRejectedValueOnce(new Error("Upstream model timeout"));

    const rollbackReq = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-enforce-quota": "true",
        "x-real-ip": "203.0.113.77",
      },
      body: JSON.stringify({
        kind: "question",
        question: sampleQuestion,
      }),
    });

    const rollbackRes = await POST(rollbackReq);
    expect(rollbackRes.status).toBe(200);

    const ledgerAfterRollback = await getUserQuotaLedger("ip:203.0.113.77", "contender", "ROW");
    expect(ledgerAfterRollback.windowReservedUsd).toBe(0);
    expect(ledgerAfterRollback.windowSpentUsd).toBe(0);

    const depletedLedger = await getUserQuotaLedger("ip:203.0.113.78", "contender", "ROW");
    depletedLedger.windowSpentUsd = depletedLedger.cogsCeilingUsd;
    depletedLedger.cogsSpentUsd = depletedLedger.cogsCeilingUsd;
    await saveUserQuotaLedger(depletedLedger);

    const quotaReq = new Request("http://localhost:3000/api/repair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-enforce-quota": "true",
        "x-real-ip": "203.0.113.78",
      },
      body: JSON.stringify({
        kind: "question",
        question: sampleQuestion,
      }),
    });

    const quotaRes = await POST(quotaReq);
    expect(quotaRes.status).toBe(429);
    const quotaData = await quotaRes.json();
    expect(quotaData.ok).toBe(false);
    expect(quotaData.error).toBe("COGS_CEILING_EXCEEDED");
    expect(quotaData.quota).toBeDefined();
    expect(quotaData.quota.remainingPct).toBe(0);
    expect(quotaData.quota.windowSpentUsd).toBeUndefined();
  });
});
