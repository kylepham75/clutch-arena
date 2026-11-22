import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function buildAllowedOrigins(request: Request, reqUrl: URL): Set<string> {
  const allowed = new Set<string>([reqUrl.origin]);

  const envOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
  ];

  for (const raw of envOrigins) {
    if (!raw || !raw.trim()) continue;
    try {
      allowed.add(new URL(raw.trim()).origin);
    } catch {
      // Ignore malformed env URL
    }
  }

  return allowed;
}

function isOriginAllowedAgainstSet(
  candidateOrigin: string,
  reqUrl: URL,
  allowedOrigins: Set<string>,
): boolean {
  try {
    const parsed = new URL(candidateOrigin);
    if (allowedOrigins.has(parsed.origin)) {
      return true;
    }

    if (
      LOCAL_DEV_HOSTS.has(parsed.hostname) &&
      LOCAL_DEV_HOSTS.has(reqUrl.hostname) &&
      parsed.protocol === reqUrl.protocol &&
      (parsed.port === reqUrl.port || !parsed.port || !reqUrl.port)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Validates request origin / referer against a canonical configured origin
 * allowlist (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `VERCEL_URL`,
 * `VERCEL_PROJECT_PRODUCTION_URL`, request URL origin, and matching local dev
 * host aliases) without trusting spoofable `x-forwarded-host` or
 * `x-forwarded-proto` headers.
 */
export function isAllowedOrigin(origin: string | null, request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite.toLowerCase() === "cross-site") {
    return false;
  }

  let reqUrl: URL;
  try {
    reqUrl = new URL(request.url);
  } catch {
    return false;
  }

  const allowedOrigins = buildAllowedOrigins(request, reqUrl);

  if (origin) {
    return isOriginAllowedAgainstSet(origin, reqUrl, allowedOrigins);
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return isOriginAllowedAgainstSet(referer, reqUrl, allowedOrigins);
  }

  const method = (request.method || "GET").toUpperCase();
  if (STATE_CHANGING_METHODS.has(method)) {
    const enforceMissingOrigin =
      process.env.NODE_ENV === "production" ||
      process.env.ENFORCE_ORIGIN_HEADER === "true" ||
      request.headers.get("x-enforce-origin") === "true";
    if (enforceMissingOrigin) {
      return false;
    }
  }

  return true;
}
