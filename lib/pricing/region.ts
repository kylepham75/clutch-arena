/**
 * Geo-IP Billing Region Resolution & Regional Currency Formatting
 *
 * CRITICAL ARCHITECTURAL GUARANTEE — ZERO LOCALE COUPLING:
 * BillingRegion ('VN' vs 'ROW') is strictly decoupled from the UI display language / i18n
 * locale ('vi' vs 'en'). Language preference must never dictate billing region or currency.
 *
 * Real-world examples:
 * - A Vietnamese student studying abroad in the US (UI: 'vi', Country: 'US') -> ROW ($ USD).
 * - An international expat or exchange student in Vietnam (UI: 'en', Country: 'VN') -> VN (đ VND).
 *
 * Billing Region Resolution Priority:
 * 1. Explicit user cookie override ('clutch_region' = 'VN' | 'ROW').
 * 2. Explicit request override header ('x-clutch-region' = 'VN' | 'ROW').
 * 3. Edge Geo-IP country headers ('x-vercel-ip-country', 'cf-ipcountry').
 * 4. Default fallback: 'ROW'.
 */

import {
  PRICING_PLANS,
  type BillingRegion,
  type RegionalPrice,
  type PlanId,
} from "./tiers";

export type { BillingRegion, RegionalPrice, PlanId };

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

export const CLUTCH_REGION_COOKIE = "clutch_region";
export const REGION_HEADER_VERCEL = "x-vercel-ip-country";
export const REGION_HEADER_CLOUDFLARE = "cf-ipcountry";
export const CLOUDFLARE_RAY_HEADER = "cf-ray";
export const CLUTCH_REGION_HEADER = "x-clutch-region";

/* -------------------------------------------------------------------------- */
/*  Type Guards & Region Parsers                                              */
/* -------------------------------------------------------------------------- */

/**
 * Type guard verifying whether a given unknown value is a valid BillingRegion ('VN' | 'ROW').
 */
export function isValidBillingRegion(val: unknown): val is BillingRegion {
  return val === "VN" || val === "ROW";
}

/**
 * Parses and normalizes a candidate string into a valid BillingRegion ('VN' | 'ROW').
 * Case-insensitive and trims whitespace. Returns null if invalid or missing.
 */
export function parseBillingRegion(val?: string | null): BillingRegion | null {
  if (typeof val !== "string") return null;
  const normalized = val.trim().toUpperCase();
  if (normalized === "VN") return "VN";
  if (normalized === "ROW") return "ROW";
  return null;
}

/**
 * Resolves a BillingRegion from an ISO 3166-1 alpha-2 country code.
 * Returns 'VN' if countryCode is 'VN' (case-insensitive).
 * Returns 'ROW' for any other country code or when countryCode is null/undefined/empty.
 *
 * Guaranteed zero coupling to UI language locale ('en' vs 'vi').
 */
export function detectBillingRegionFromCountry(countryCode?: string | null): BillingRegion {
  if (!countryCode) return "ROW";
  return countryCode.trim().toUpperCase() === "VN" ? "VN" : "ROW";
}

/* -------------------------------------------------------------------------- */
/*  Header & Cookie Helpers                                                   */
/* -------------------------------------------------------------------------- */

type HeaderSource =
  | Headers
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

/**
 * Safely retrieves a header value by name from any supported header container.
 * Case-insensitive lookup for plain objects and standard .get() for Headers instances.
 */
function getHeaderValue(headers: unknown, key: string): string | null {
  if (!headers || typeof headers !== "object") return null;

  // Web standard Headers or interface with get(name)
  if ("get" in headers && typeof (headers as { get: unknown }).get === "function") {
    try {
      const val = (headers as { get(k: string): string | null }).get(key);
      if (typeof val === "string") return val;
    } catch {
      // Fall through to plain object traversal if .get throws
    }
  }

  // Plain Record/Object case-insensitive search
  const lowerKey = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lowerKey) {
      if (typeof v === "string") return v;
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
    }
  }

  return null;
}

/**
 * Parses a specific cookie key value from a raw Cookie header string.
 */
function parseCookieString(cookieStr: string, name: string): string | null {
  const parts = cookieStr.split(";");
  for (const part of parts) {
    const [rawKey, ...rawVal] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawVal.join("="));
    }
  }
  return null;
}

/**
 * Safely extracts a cookie value from any request-like, headers-like, or string source.
 */
function extractCookieValue(source: unknown, cookieName: string): string | null {
  if (!source) {
    if (typeof document !== "undefined") {
      try {
        return parseCookieString(document.cookie, cookieName);
      } catch {
        return null;
      }
    }
    return null;
  }

  if (typeof source === "string") {
    return parseCookieString(source, cookieName);
  }

  if (typeof source !== "object") return null;

  const obj = source as Record<string, unknown>;

  // Check NextRequest.cookies or Next.js cookies() wrapper
  if (obj.cookies && typeof obj.cookies === "object") {
    const cookiesObj = obj.cookies as { get?: (k: string) => unknown };
    if (typeof cookiesObj.get === "function") {
      try {
        const item = cookiesObj.get(cookieName);
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "value" in item) {
          const v = (item as { value: unknown }).value;
          if (typeof v === "string") return v;
        }
      } catch {
        // ignore
      }
    }
  }

  // Check source itself if it implements .get(name) for cookies (e.g. ReadonlyRequestCookies)
  if (typeof obj.get === "function" && !("headers" in obj)) {
    try {
      const item = (obj as { get(k: string): unknown }).get(cookieName);
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "value" in item) {
        const v = (item as { value: unknown }).value;
        if (typeof v === "string") return v;
      }
    } catch {
      // ignore
    }
  }

  // Check headers object or source itself for 'cookie' / 'Cookie' header
  const headers = "headers" in obj && obj.headers ? obj.headers : obj;
  const cookieHeader = getHeaderValue(headers, "cookie");
  if (cookieHeader) {
    const fromHeader = parseCookieString(cookieHeader, cookieName);
    if (fromHeader) return fromHeader;
  }

  // Check direct property assignment e.g. { clutch_region: "VN" }
  if (typeof obj[cookieName] === "string") {
    return obj[cookieName] as string;
  }

  // Fallback to document.cookie in browser environments if not found on request
  if (typeof document !== "undefined") {
    try {
      return parseCookieString(document.cookie, cookieName);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Resolves header container from a Request, NextRequest, or headers object.
 */
function resolveHeaderContainer(source: unknown): unknown {
  if (!source || typeof source !== "object") return null;
  if ("headers" in source && (source as { headers: unknown }).headers) {
    return (source as { headers: unknown }).headers;
  }
  return source;
}

/**
 * Verifies whether Cloudflare edge headers can be trusted (SA2-06).
 * Only trusted when 'cf-ray' header is present or TRUST_CLOUDFLARE_HEADERS === "true".
 */
export function isCloudflareGeoIpVerified(headers: unknown): boolean {
  if (process.env.TRUST_CLOUDFLARE_HEADERS === "true") {
    return true;
  }
  const cfRay = getHeaderValue(headers, CLOUDFLARE_RAY_HEADER);
  return Boolean(cfRay && cfRay.trim().length > 0);
}

/**
 * Resolves BillingRegion strictly from trusted Edge Geo-IP country headers
 * ('x-vercel-ip-country' or verified 'cf-ipcountry') if present and non-empty.
 * Prioritizes 'x-vercel-ip-country' over 'cf-ipcountry'.
 * Only trusts 'cf-ipcountry' when verified with 'cf-ray' or TRUST_CLOUDFLARE_HEADERS (SA2-06).
 * Returns null when no trusted Edge Geo-IP header is present.
 */
function resolveEdgeGeoIpRegion(headers: unknown): BillingRegion | null {
  if (!headers || typeof headers !== "object") return null;

  // 1. Vercel platform Edge Geo-IP takes strict precedence
  const vercelCountry = getHeaderValue(headers, REGION_HEADER_VERCEL);
  if (vercelCountry && vercelCountry.trim().length > 0) {
    return detectBillingRegionFromCountry(vercelCountry);
  }

  // 2. Cloudflare Geo-IP country header (only trusted when verified)
  const cfCountry = getHeaderValue(headers, REGION_HEADER_CLOUDFLARE);
  if (cfCountry && cfCountry.trim().length > 0 && isCloudflareGeoIpVerified(headers)) {
    return detectBillingRegionFromCountry(cfCountry);
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Header Detection & Server Region Resolver                                */
/* -------------------------------------------------------------------------- */

/**
 * Detects the BillingRegion strictly from request headers.
 * In production (NODE_ENV === "production"), trusted Edge Geo-IP country headers
 * ('x-vercel-ip-country', verified 'cf-ipcountry') take strict precedence when present so
 * client-supplied 'x-clutch-region' headers cannot spoof the billing/COGS region.
 * Otherwise checks in priority order:
 * 1. 'x-clutch-region' (explicit override header in dev/test)
 * 2. 'x-vercel-ip-country' (Vercel Edge Geo-IP, prioritized over cf-ipcountry)
 * 3. 'cf-ipcountry' (Cloudflare Geo-IP, only if verified)
 *
 * Returns 'VN' if resolved region is 'VN', else 'ROW'.
 */
export function detectBillingRegionFromHeaders(headers: HeaderSource): BillingRegion {
  if (process.env.NODE_ENV === "production") {
    const geoIpRegion = resolveEdgeGeoIpRegion(headers);
    if (geoIpRegion !== null) {
      return geoIpRegion;
    }
  }

  // 1. Explicit override header in dev/test
  const clutchRegion = parseBillingRegion(getHeaderValue(headers, CLUTCH_REGION_HEADER));
  if (clutchRegion) {
    return clutchRegion;
  }

  // 2. Vercel Edge Geo-IP header takes strict precedence over cf-ipcountry
  const vercelCountry = getHeaderValue(headers, REGION_HEADER_VERCEL);
  if (vercelCountry && vercelCountry.trim().length > 0) {
    return detectBillingRegionFromCountry(vercelCountry);
  }

  // 3. Cloudflare Geo-IP header (only trusted when verified with cf-ray or TRUST_CLOUDFLARE_HEADERS)
  const cfCountry = getHeaderValue(headers, REGION_HEADER_CLOUDFLARE);
  if (cfCountry && cfCountry.trim().length > 0 && isCloudflareGeoIpVerified(headers)) {
    return detectBillingRegionFromCountry(cfCountry);
  }

  return "ROW";
}

/**
 * Authoritative billing region resolver that strictly prioritizes trusted Edge Geo-IP
 * country headers ('x-vercel-ip-country' and 'cf-ipcountry') FIRST when present on the
 * request/headers before falling back to getBillingRegion(requestOrHeaders).
 */
export function getAuthoritativeBillingRegion(requestOrHeaders?: unknown): BillingRegion {
  const headerContainer = resolveHeaderContainer(requestOrHeaders);
  const geoIpRegion = resolveEdgeGeoIpRegion(headerContainer);
  if (geoIpRegion !== null) {
    return geoIpRegion;
  }
  return getBillingRegion(requestOrHeaders);
}

/**
 * Server region resolver. Resolves the user's BillingRegion from any request or headers context.
 *
 * In production (NODE_ENV === "production"), when a trusted Edge Geo-IP country header
 * ('x-vercel-ip-country' or 'cf-ipcountry') is present and non-empty on the request headers,
 * it takes strict priority so client-supplied 'clutch_region' cookies or 'x-clutch-region'
 * headers cannot spoof the billing/COGS region.
 *
 * In development/test (or when no Edge Geo-IP header is present), resolves in strict order:
 * 1. Explicit cookie 'clutch_region' (if passed, readable, and valid 'VN' or 'ROW').
 * 2. Explicit header 'x-clutch-region' (if passed and valid 'VN' or 'ROW').
 * 3. Geo-IP country headers ('x-vercel-ip-country', 'cf-ipcountry').
 * 4. Default fallback: 'ROW'.
 *
 * Safe in all environments (does not throw if called without parameters or outside request context).
 * Supports standard Fetch Request, Next.js NextRequest, Headers, plain object headers, or string cookie headers.
 */
export function getBillingRegion(requestOrHeaders?: unknown): BillingRegion {
  const headerContainer = resolveHeaderContainer(requestOrHeaders);

  if (process.env.NODE_ENV === "production") {
    const geoIpRegion = resolveEdgeGeoIpRegion(headerContainer);
    if (geoIpRegion !== null) {
      return geoIpRegion;
    }
  }

  // 1. Priority a: Explicit cookie clutch_region
  const cookieRegion = parseBillingRegion(extractCookieValue(requestOrHeaders, CLUTCH_REGION_COOKIE));
  if (cookieRegion) {
    return cookieRegion;
  }

  // 2. Priority b & c: Headers (x-clutch-region override, then Geo-IP headers)
  if (headerContainer && typeof headerContainer === "object") {
    return detectBillingRegionFromHeaders(headerContainer as HeaderSource);
  }

  // 3. Priority d: Default fallback
  return "ROW";
}

/* -------------------------------------------------------------------------- */
/*  Client Cookie Helpers                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Client-side helper to read the billing region from document.cookie.
 * Safe when executed in SSR or server environments (returns 'ROW').
 */
export function getBillingRegionClient(): BillingRegion {
  if (typeof document === "undefined") {
    return "ROW";
  }
  try {
    const raw = parseCookieString(document.cookie, CLUTCH_REGION_COOKIE);
    const parsed = parseBillingRegion(raw);
    return parsed ?? "ROW";
  } catch {
    return "ROW";
  }
}

/**
 * Client-side helper to persist the user's explicit billing region override in document.cookie.
 * Safe when executed in SSR or server environments (no-op).
 */
export function setBillingRegionClient(region: BillingRegion): void {
  if (typeof document === "undefined") {
    return;
  }
  try {
    const validRegion = isValidBillingRegion(region) ? region : "ROW";
    document.cookie = `${CLUTCH_REGION_COOKIE}=${validRegion}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Ignore cookie write failures in sandboxed/restricted environments
  }
}

/* -------------------------------------------------------------------------- */
/*  Currency & Price Formatting Helpers                                       */
/* -------------------------------------------------------------------------- */

/**
 * Returns the effective billing currency for a region:
 * - 'VN' -> 'VND'
 * - 'ROW' -> 'USD'
 */
export function getEffectiveCurrency(region: BillingRegion): "VND" | "USD" {
  return region === "VN" ? "VND" : "USD";
}

/**
 * Formats a monetary amount into standard regional currency presentation:
 * - If region === 'VN':
 *     - If amount === 0: '0đ'
 *     - Otherwise: Vietnamese Dong with dot separators (e.g. '69.000đ', '299.000đ')
 * - If region === 'ROW':
 *     - If amount === 0: '$0'
 *     - If integer: '$29'
 *     - Otherwise: 2 decimal places (e.g. '$4.99', '$9.99', '$24.99')
 */
export function formatRegionalPrice(amount: number, region: BillingRegion): string {
  if (region === "VN") {
    if (amount === 0) return "0đ";
    const isNegative = amount < 0;
    const abs = Math.abs(Math.round(amount));
    const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${isNegative ? "-" : ""}${formatted}đ`;
  }

  // region === "ROW"
  if (amount === 0) return "$0";
  const isNegative = amount < 0;
  const abs = Math.abs(amount);
  const formatted = Number.isInteger(abs) ? abs.toString() : abs.toFixed(2);
  return isNegative ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Retrieves the RegionalPrice ({ amount, currency, formatted }) for the given plan and region
 * from PRICING_PLANS in lib/pricing/tiers.ts.
 *
 * Normalizes alias plan IDs (e.g. 'pro_semester' -> 'pro', 'tutor_guild' -> 'tutor').
 * Throws a descriptive error if plan is not found.
 */
export function getPlanRegionalPrice(planId: PlanId, region: BillingRegion): RegionalPrice {
  const normalizedId =
    planId === "pro_semester" ? "pro" : planId === "tutor_guild" ? "tutor" : planId;

  const plan = PRICING_PLANS.find((p) => p.id === normalizedId || p.id === planId);
  if (!plan) {
    throw new Error(`Plan pricing not found for planId: "${planId}"`);
  }

  const regional = plan.pricing?.[region];
  if (!regional) {
    const currency = getEffectiveCurrency(region);
    const amount = region === "VN" ? plan.priceVnd : plan.priceUsd;
    return {
      amount,
      currency,
      formatted: formatRegionalPrice(amount, region),
    };
  }

  return {
    amount: regional.amount,
    currency: regional.currency,
    formatted: regional.formatted,
  };
}
