/**
 * Polyfills browser canvas and geometry APIs required by pdfjs-dist / pdf-parse
 * when running inside Node.js serverless functions (e.g. Vercel).
 */

class NodeDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;

  constructor(
    init?:
      | number[]
      | string
      | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number },
  ) {
    if (Array.isArray(init)) {
      if (init.length >= 6) {
        this.a = Number(init[0]) || 0;
        this.b = Number(init[1]) || 0;
        this.c = Number(init[2]) || 0;
        this.d = Number(init[3]) || 0;
        this.e = Number(init[4]) || 0;
        this.f = Number(init[5]) || 0;
      }
    } else if (init && typeof init === "object") {
      this.a = typeof init.a === "number" ? init.a : 1;
      this.b = typeof init.b === "number" ? init.b : 0;
      this.c = typeof init.c === "number" ? init.c : 0;
      this.d = typeof init.d === "number" ? init.d : 1;
      this.e = typeof init.e === "number" ? init.e : 0;
      this.f = typeof init.f === "number" ? init.f : 0;
    }
  }

  get m11() {
    return this.a;
  }
  set m11(v: number) {
    this.a = v;
  }
  get m12() {
    return this.b;
  }
  set m12(v: number) {
    this.b = v;
  }
  get m13() {
    return 0;
  }
  get m14() {
    return 0;
  }

  get m21() {
    return this.c;
  }
  set m21(v: number) {
    this.c = v;
  }
  get m22() {
    return this.d;
  }
  set m22(v: number) {
    this.d = v;
  }
  get m23() {
    return 0;
  }
  get m24() {
    return 0;
  }

  get m31() {
    return 0;
  }
  get m32() {
    return 0;
  }
  get m33() {
    return 1;
  }
  get m34() {
    return 0;
  }

  get m41() {
    return this.e;
  }
  set m41(v: number) {
    this.e = v;
  }
  get m42() {
    return this.f;
  }
  set m42(v: number) {
    this.f = v;
  }
  get m43() {
    return 0;
  }
  get m44() {
    return 1;
  }

  get isIdentity(): boolean {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    );
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    this.a *= scaleX;
    this.b *= scaleX;
    this.c *= scaleY;
    this.d *= scaleY;
    return this;
  }

  scale(scaleX = 1, scaleY = scaleX): NodeDOMMatrix {
    return new NodeDOMMatrix(this).scaleSelf(scaleX, scaleY);
  }

  translateSelf(tx = 0, ty = 0): this {
    this.e += this.a * tx + this.c * ty;
    this.f += this.b * tx + this.d * ty;
    return this;
  }

  translate(tx = 0, ty = 0): NodeDOMMatrix {
    return new NodeDOMMatrix(this).translateSelf(tx, ty);
  }

  multiplySelf(other: {
    a?: number;
    b?: number;
    c?: number;
    d?: number;
    e?: number;
    f?: number;
  }): this {
    const oa = typeof other.a === "number" ? other.a : 1;
    const ob = typeof other.b === "number" ? other.b : 0;
    const oc = typeof other.c === "number" ? other.c : 0;
    const od = typeof other.d === "number" ? other.d : 1;
    const oe = typeof other.e === "number" ? other.e : 0;
    const of = typeof other.f === "number" ? other.f : 0;

    const a = this.a * oa + this.c * ob;
    const b = this.b * oa + this.d * ob;
    const c = this.a * oc + this.c * od;
    const d = this.b * oc + this.d * od;
    const e = this.a * oe + this.c * of + this.e;
    const f = this.b * oe + this.d * of + this.f;

    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  multiply(other: {
    a?: number;
    b?: number;
    c?: number;
    d?: number;
    e?: number;
    f?: number;
  }): NodeDOMMatrix {
    return new NodeDOMMatrix(this).multiplySelf(other);
  }

  preMultiplySelf(other: {
    a?: number;
    b?: number;
    c?: number;
    d?: number;
    e?: number;
    f?: number;
  }): this {
    const copy = new NodeDOMMatrix(other);
    copy.multiplySelf(this);
    this.a = copy.a;
    this.b = copy.b;
    this.c = copy.c;
    this.d = copy.d;
    this.e = copy.e;
    this.f = copy.f;
    return this;
  }

  inverse(): NodeDOMMatrix {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) {
      return new NodeDOMMatrix([NaN, NaN, NaN, NaN, NaN, NaN]);
    }
    const invDet = 1 / det;
    return new NodeDOMMatrix([
      this.d * invDet,
      -this.b * invDet,
      -this.c * invDet,
      this.a * invDet,
      (this.c * this.f - this.d * this.e) * invDet,
      (this.b * this.e - this.a * this.f) * invDet,
    ]);
  }

  invertSelf(): this {
    const inv = this.inverse();
    this.a = inv.a;
    this.b = inv.b;
    this.c = inv.c;
    this.d = inv.d;
    this.e = inv.e;
    this.f = inv.f;
    return this;
  }

  transformPoint(point?: { x?: number; y?: number }): { x: number; y: number; z: number; w: number } {
    const x = point?.x ?? 0;
    const y = point?.y ?? 0;
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: 0,
      w: 1,
    };
  }

  toFloat32Array(): Float32Array {
    return new Float32Array([
      this.a, this.b, 0, 0,
      this.c, this.d, 0, 0,
      0, 0, 1, 0,
      this.e, this.f, 0, 1,
    ]);
  }

  toFloat64Array(): Float64Array {
    return new Float64Array([
      this.a, this.b, 0, 0,
      this.c, this.d, 0, 0,
      0, 0, 1, 0,
      this.e, this.f, 0, 1,
    ]);
  }

  toString(): string {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

class NodePath2D {
  addPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  arcTo() {}
  ellipse() {}
  rect() {}
}

export function ensurePdfPolyfills(): void {
  const g = globalThis as any;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = NodeDOMMatrix;
  }
  if (typeof g.DOMMatrixReadOnly === "undefined") {
    g.DOMMatrixReadOnly = NodeDOMMatrix;
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = NodePath2D;
  }
}

// Auto-run on import
ensurePdfPolyfills();
