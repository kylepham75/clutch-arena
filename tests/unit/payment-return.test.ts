import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translations, type Language } from "@/lib/i18n/translations";

type HookRunner = {
  useState: <S>(init: S | (() => S)) => [S, (v: S | ((prev: S) => S)) => void];
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
  useCallback: <T extends (...args: any[]) => any>(fn: T, deps?: unknown[]) => T;
  useRef: <T>(init: T) => { current: T };
};

let activeHookRunner: HookRunner | null = null;
let mockLanguage: Language = "en";
let mockAuthState: { session: { access_token: string } | null; loading: boolean } = {
  session: null,
  loading: false,
};
const mockRefreshTier = vi.fn().mockResolvedValue("contender");
const mockRefreshQuota = vi.fn().mockResolvedValue(undefined);
let mockSupabaseClient: any = null;

function loadPaymentReturnModule() {
  const fullPath = path.resolve("components/pricing/payment-return-banner.tsx");
  const sourceCode = fs.readFileSync(fullPath, "utf8");
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} as typeof import("@/components/pricing/payment-return-banner") };
  const reactProxy = Object.assign({ default: React }, React, {
    useState: (init: any) =>
      activeHookRunner ? activeHookRunner.useState(init) : React.useState(init),
    useEffect: (fn: any, deps?: any[]) =>
      activeHookRunner ? activeHookRunner.useEffect(fn, deps) : React.useEffect(fn, deps),
    useCallback: (fn: any, deps: React.DependencyList = []) =>
      activeHookRunner ? activeHookRunner.useCallback(fn, [...deps]) : React.useCallback(fn, deps),
    useRef: (init: any) =>
      activeHookRunner ? activeHookRunner.useRef(init) : React.useRef(init),
  });
  const customRequire = (id: string) => {
    if (id === "react") return reactProxy;
    if (id === "@/lib/i18n/context") {
      return {
        useLanguage: () => ({
          t: translations[mockLanguage],
          language: mockLanguage,
          setLanguage: vi.fn(),
        }),
      };
    }
    if (id === "@/lib/auth/context") {
      return { useAuth: () => mockAuthState };
    }
    if (id === "@/hooks/use-user-tier") {
      return {
        useUserTier: () => ({
          tier: "contender",
          refreshTier: mockRefreshTier,
          refreshQuota: mockRefreshQuota,
        }),
      };
    }
    if (id === "@/lib/supabase/client") {
      return { getSupabaseBrowserClient: () => mockSupabaseClient };
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(id);
  };
  (globalThis as any).React = reactProxy;
  const fn = new Function("require", "module", "exports", transpiled.outputText);
  fn(customRequire, mod, mod.exports);
  return mod.exports;
}

const {
  PaymentReturnBanner,
  parsePaymentReturnParams,
  buildCleanReturnUrl,
} = loadPaymentReturnModule();

interface RenderedElement {
  type: unknown;
  props: Record<string, any>;
}

function expandElementTree(node: unknown): unknown {
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(expandElementTree);
  if (typeof node === "object" && "type" in (node as any) && "props" in (node as any)) {
    const el = node as RenderedElement;
    if (typeof el.type === "function") {
      return expandElementTree((el.type as (props: Record<string, any>) => unknown)(el.props));
    }
    const children =
      el.props?.children !== undefined ? expandElementTree(el.props.children) : undefined;
    return {
      type: el.type,
      props: { ...el.props, children },
    };
  }
  return node;
}

function collectNodes(
  node: unknown,
  predicate: (el: RenderedElement) => boolean,
  acc: RenderedElement[] = [],
): RenderedElement[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectNodes(item, predicate, acc);
    return acc;
  }
  if ("type" in node && "props" in node) {
    const el = node as RenderedElement;
    if (predicate(el)) acc.push(el);
    if (el.props?.children !== undefined) collectNodes(el.props.children, predicate, acc);
  }
  return acc;
}

function extractNodeText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join(" ");
  if (typeof node === "object" && "props" in node) {
    return extractNodeText((node as RenderedElement).props?.children);
  }
  return "";
}

function depsChanged(prev?: unknown[], next?: unknown[]): boolean {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  return prev.some((v, i) => !Object.is(v, next[i]));
}

function mountBanner() {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const callbacks: { fn: (...args: any[]) => any; deps?: unknown[] }[] = [];
  const effects: {
    fn: () => void | (() => void);
    deps?: unknown[];
    cleanup?: (() => void) | void;
    initialized: boolean;
  }[] = [];

  let tree: unknown = null;
  let dirty = false;

  const renderOnce = () => {
    let stateIdx = 0;
    let refIdx = 0;
    let cbIdx = 0;
    let effIdx = 0;
    const pendingEffects: number[] = [];

    const runner: HookRunner = {
      useState: (init) => {
        const idx = stateIdx++;
        if (!(idx in states)) {
          states[idx] = typeof init === "function" ? (init as () => unknown)() : init;
        }
        const setState = (next: any) => {
          const prev = states[idx];
          const resolved = typeof next === "function" ? next(prev) : next;
          if (!Object.is(prev, resolved)) {
            states[idx] = resolved;
            dirty = true;
          }
        };
        return [states[idx] as any, setState];
      },
      useRef: (init) => {
        const idx = refIdx++;
        if (!(idx in refs)) {
          refs[idx] = { current: init };
        }
        return refs[idx] as any;
      },
      useCallback: (fn, deps) => {
        const idx = cbIdx++;
        const prev = callbacks[idx];
        if (!prev || depsChanged(prev.deps, deps)) {
          callbacks[idx] = { fn, deps };
        }
        return callbacks[idx].fn as any;
      },
      useEffect: (fn, deps) => {
        const idx = effIdx++;
        const prev = effects[idx];
        if (!prev || !prev.initialized || depsChanged(prev.deps, deps)) {
          effects[idx] = {
            fn,
            deps,
            cleanup: prev?.cleanup,
            initialized: true,
          };
          pendingEffects.push(idx);
        }
      },
    };

    dirty = false;
    activeHookRunner = runner;
    try {
      tree = expandElementTree(PaymentReturnBanner());
    } finally {
      activeHookRunner = null;
    }

    for (const idx of pendingEffects) {
      const eff = effects[idx];
      if (typeof eff.cleanup === "function") {
        eff.cleanup();
      }
      eff.cleanup = eff.fn();
    }
  };

  const settle = () => {
    for (let guard = 0; guard < 12; guard++) {
      renderOnce();
      if (!dirty) break;
    }
  };

  const flush = async () => {
    for (let tick = 0; tick < 8; tick++) {
      await Promise.resolve();
      if (dirty) {
        settle();
      }
    }
  };

  settle();

  return {
    getTree: () => tree,
    getText: () => extractNodeText(tree).replace(/\s+/g, " ").trim(),
    findButtonByText: (text: string) =>
      collectNodes(
        tree,
        (el) => el.type === "button" && extractNodeText(el.props.children).trim() === text,
      )[0],
    click: (el: RenderedElement | undefined) => {
      if (!el?.props?.onClick) {
        throw new Error("Target button has no onClick handler");
      }
      el.props.onClick();
      settle();
    },
    flush,
    unmount: () => {
      for (const eff of effects) {
        if (typeof eff.cleanup === "function") {
          eff.cleanup();
        }
      }
    },
  };
}

describe("Payment Return URL Helpers", () => {
  it("parsePaymentReturnParams parses valid success and cancelled return parameters", () => {
    expect(parsePaymentReturnParams("")).toBeNull();
    expect(parsePaymentReturnParams("?pack=econ101")).toBeNull();
    expect(parsePaymentReturnParams("?payment=pending&orderCode=12345")).toBeNull();

    expect(parsePaymentReturnParams("?payment=success&orderCode=12345")).toEqual({
      status: "success",
      provider: null,
      checkoutId: null,
      orderCode: 12345,
    });

    expect(
      parsePaymentReturnParams("?payment=success&provider=polar&checkoutId=chk_123"),
    ).toEqual({
      status: "success",
      provider: "polar",
      checkoutId: "chk_123",
      orderCode: null,
    });

    expect(parsePaymentReturnParams("?payment=cancelled&provider=polar")).toEqual({
      status: "cancelled",
      provider: "polar",
      checkoutId: null,
      orderCode: null,
    });

    expect(parsePaymentReturnParams("?payment=success&orderCode=notanumber")).toEqual({
      status: "success",
      provider: null,
      checkoutId: null,
      orderCode: null,
    });
  });

  it("buildCleanReturnUrl strips payment return params while preserving #pack= and unrelated query params", () => {
    expect(
      buildCleanReturnUrl(
        "/",
        "?payment=success&orderCode=12345&pack=econ101",
        "#pack=encoded-payload",
      ),
    ).toBe("/?pack=econ101#pack=encoded-payload");

    expect(
      buildCleanReturnUrl(
        "/",
        "?payment=success&provider=polar&checkoutId=chk_123",
        "#pack=abc123",
      ),
    ).toBe("/#pack=abc123");

    expect(buildCleanReturnUrl("/", "?payment=cancelled&provider=payos", "")).toBe("/");

    expect(
      buildCleanReturnUrl("/arena", "?room=CLUTCH&payment=cancelled&checkoutId=chk_9", "pack=xyz"),
    ).toBe("/arena?room=CLUTCH#pack=xyz");
  });
});

describe("<PaymentReturnBanner />", () => {
  const originalWindow = (globalThis as any).window;
  const originalFetch = globalThis.fetch;

  let replaceStateMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  function setBrowserLocation(pathname: string, search: string, hash = "") {
    replaceStateMock = vi.fn();
    (globalThis as any).window = {
      location: { pathname, search, hash },
      history: {
        state: { idx: 0 },
        replaceState: replaceStateMock,
      },
    };
  }

  beforeEach(() => {
    mockLanguage = "en";
    mockAuthState = {
      session: { access_token: "token-abc" },
      loading: false,
    };
    mockSupabaseClient = null;
    mockRefreshTier.mockReset().mockResolvedValue("cram_pass");
    mockRefreshQuota.mockReset().mockResolvedValue(undefined);
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    setBrowserLocation("/", "");
  });

  afterEach(() => {
    activeHookRunner = null;
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;
  });

  it("renders nothing when no payment return query params are present", () => {
    setBrowserLocation("/", "?pack=sample", "#pack=stay");
    const banner = mountBanner();
    try {
      expect(banner.getTree()).toBeNull();
      expect(replaceStateMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      banner.unmount();
    }
  });

  it("verifies PayOS order, refreshes tier & quota, renders squadCodes, and preserves #pack= on replaceState", async () => {
    setBrowserLocation("/", "?payment=success&orderCode=12345", "#pack=my-deck-hash");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        paid: true,
        squadCodes: ["CLUTCH-AAAA-1111", "CLUTCH-BBBB-2222"],
      }),
    });

    const banner = mountBanner();
    try {
      await banner.flush();

      expect(replaceStateMock).toHaveBeenCalledTimes(1);
      expect(replaceStateMock).toHaveBeenCalledWith(
        { idx: 0 },
        "",
        "/#pack=my-deck-hash",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/payments/payos/verify",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ orderCode: 12345 }),
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer token-abc",
          }),
        }),
      );

      expect(mockRefreshTier).toHaveBeenCalledTimes(1);
      expect(mockRefreshQuota).toHaveBeenCalledTimes(1);

      const text = banner.getText();
      expect(text).toContain("Payment Confirmed!");
      expect(text).toContain("Your Squad Invite Codes");
      expect(text).toContain("CLUTCH-AAAA-1111");
      expect(text).toContain("CLUTCH-BBBB-2222");
    } finally {
      banner.unmount();
    }
  });

  it("handles Polar checkout return by refreshing tier & quota, fetching squad/mine, and cleaning URL", async () => {
    setBrowserLocation(
      "/",
      "?payment=success&provider=polar&checkoutId=chk_123&keep=1",
      "#pack=polar-pack",
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        purchased: [
          { code: "CLUTCH-POLAR-001", status: "available" },
          { code: "CLUTCH-POLAR-002", status: "redeemed" },
        ],
      }),
    });

    const banner = mountBanner();
    try {
      await banner.flush();

      expect(replaceStateMock).toHaveBeenCalledTimes(1);
      expect(replaceStateMock).toHaveBeenCalledWith(
        { idx: 0 },
        "",
        "/?keep=1#pack=polar-pack",
      );

      expect(mockRefreshTier).toHaveBeenCalledTimes(1);
      expect(mockRefreshQuota).toHaveBeenCalledTimes(1);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/payments/squad/mine",
        expect.objectContaining({
          method: "GET",
          cache: "no-store",
          headers: { Authorization: "Bearer token-abc" },
        }),
      );

      const text = banner.getText();
      expect(text).toContain("Payment Confirmed!");
      expect(text).toContain("CLUTCH-POLAR-001");
      expect(text).toContain("CLUTCH-POLAR-002");
      expect(text).toContain("Available");
      expect(text).toContain("Redeemed");
    } finally {
      banner.unmount();
    }
  });

  it("renders a dismissible cancelled notice and cleans URL on ?payment=cancelled", async () => {
    setBrowserLocation("/", "?payment=cancelled", "#pack=cancel-keep");

    const banner = mountBanner();
    try {
      await banner.flush();

      expect(replaceStateMock).toHaveBeenCalledTimes(1);
      expect(replaceStateMock).toHaveBeenCalledWith(
        { idx: 0 },
        "",
        "/#pack=cancel-keep",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockRefreshTier).not.toHaveBeenCalled();
      expect(mockRefreshQuota).not.toHaveBeenCalled();

      const text = banner.getText();
      expect(text).toContain("Payment Cancelled");
      expect(text).toContain("No charges were made");

      const dismissBtn = banner.findButtonByText("Continue");
      expect(dismissBtn).toBeDefined();
      banner.click(dismissBtn);
      expect(banner.getTree()).toBeNull();
    } finally {
      banner.unmount();
    }
  });
});
