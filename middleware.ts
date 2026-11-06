import { NextResponse, type NextRequest } from "next/server";
import {
  getBillingRegion,
  getAuthoritativeBillingRegion,
  CLUTCH_REGION_COOKIE,
  CLUTCH_REGION_HEADER,
  type BillingRegion,
} from "./lib/pricing/region";

/**
 * Next.js Edge Middleware for Geo-IP Billing Region Resolution
 *
 * CRITICAL ARCHITECTURAL GUARANTEE — ZERO LOCALE COUPLING:
 * Billing region resolution ('VN' vs 'ROW') is strictly decoupled from the UI
 * display language / i18n locale ('vi' vs 'en'). This middleware guarantees that
 * language preferences (such as 'clutch_language' or route locale) are NEVER
 * modified, evaluated, or coupled to the user's billing region or currency.
 *
 * In production (NODE_ENV === "production"), trusted Edge Geo-IP country headers
 * ('x-vercel-ip-country' / 'cf-ipcountry') take strict precedence when present
 * over client-supplied 'clutch_region' cookies or 'x-clutch-region' headers.
 */
export function middleware(request: NextRequest): NextResponse {
  // Resolve user's billing region ('VN' vs 'ROW')
  const region: BillingRegion =
    process.env.NODE_ENV === "production"
      ? getAuthoritativeBillingRegion(request)
      : getBillingRegion(request);

  // Clone incoming request headers and inject the resolved region header for downstream server components and routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CLUTCH_REGION_HEADER, region);

  // Initialize response forwarding the updated headers
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Ensure client-side cookie is set if missing or differing from the resolved region
  const existingCookie = request.cookies.get(CLUTCH_REGION_COOKIE)?.value;
  if (!existingCookie || existingCookie !== region) {
    response.cookies.set(CLUTCH_REGION_COOKIE, region, {
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
      httpOnly: false,
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
