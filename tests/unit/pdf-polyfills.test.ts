import { describe, it, expect } from "vitest";
import { initPdfWorker } from "@/lib/polyfills/pdf-node-polyfills";

describe("PDF Node.js Polyfills (DOMMatrix & Path2D)", () => {
  it("defines globalThis.DOMMatrix in Node.js runtime", () => {
    expect(globalThis.DOMMatrix).toBeDefined();
    const m = new (globalThis.DOMMatrix as any)();
    expect(m.a).toBe(1);
    expect(m.b).toBe(0);
    expect(m.c).toBe(0);
    expect(m.d).toBe(1);
    expect(m.e).toBe(0);
    expect(m.f).toBe(0);
    expect(m.is2D).toBe(true);
  });

  it("supports chaining scaleSelf and translateSelf as used in pdfjs worker", () => {
    const t = 100;
    const r = 200;
    const { a: p, b: m, c: b, d: y, e: w, f: x } = new (globalThis.DOMMatrix as any)()
      .scaleSelf(1 / t, -1 / r)
      .translateSelf(0, -r);

    expect(p).toBeCloseTo(0.01);
    expect(m).toBe(0);
    expect(y).toBeCloseTo(-0.005);
    expect(w).toBe(0);
    expect(x).toBe(1);
  });

  it("defines globalThis.Path2D in Node.js runtime", () => {
    expect(globalThis.Path2D).toBeDefined();
    const p = new (globalThis.Path2D as any)();
    expect(typeof p.addPath).toBe("function");
    expect(typeof p.closePath).toBe("function");
    expect(typeof p.moveTo).toBe("function");
    expect(typeof p.lineTo).toBe("function");
  });

  it("pre-binds in-memory WorkerMessageHandler to prevent serverless file lookups", async () => {
    await initPdfWorker();
    const g = globalThis as any;
    expect(g.pdfjsWorker).toBeDefined();
    expect(g.pdfjsWorker.WorkerMessageHandler).toBeDefined();
  });
});
