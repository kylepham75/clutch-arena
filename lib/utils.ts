import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}

/**
 * Validates request origin to protect against CSRF attacks while safely
 * permitting local development host aliases (localhost, 127.0.0.1, 0.0.0.0)
 * and forwarded host headers.
 */
export function isAllowedOrigin(origin: string | null, request: Request): boolean {
  if (!origin) return true;

  try {
    const reqUrl = new URL(request.url);
    if (origin === reqUrl.origin) return true;

    const host =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (host) {
      const proto =
        request.headers.get("x-forwarded-proto") ||
        reqUrl.protocol.replace(":", "");
      if (origin === `${proto}://${host}`) return true;
    }

    const originUrl = new URL(origin);
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
    if (localHosts.has(originUrl.hostname) && localHosts.has(reqUrl.hostname)) {
      if (originUrl.port === reqUrl.port || !originUrl.port || !reqUrl.port) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}
