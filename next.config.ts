import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

if (
  process.env.NODE_ENV === "production" &&
  !process.env.NEXT_PUBLIC_PARTYKIT_HOST
) {
  console.error(
    "[Clutch Arena] CRITICAL CONFIG ERROR: NEXT_PUBLIC_PARTYKIT_HOST is not set in production! Edge WebSockets will not work across multi-device rooms.",
  );
}

const isProduction = process.env.NODE_ENV === "production";

function toOrigin(
  value?: string,
  defaultProtocol: "https:" | "http:" = "https:",
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `${defaultProtocol}//${trimmed}`;
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

function toWsOrigin(origin: string): string | null {
  if (origin.startsWith("https://")) {
    return `wss://${origin.slice("https://".length)}`;
  }
  if (origin.startsWith("http://")) {
    return `ws://${origin.slice("http://".length)}`;
  }
  return null;
}

const supabaseOrigin = toOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const sentryOrigin = toOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
const partykitHostRaw = process.env.NEXT_PUBLIC_PARTYKIT_HOST?.trim();
const partykitDefaultProto =
  partykitHostRaw && /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(partykitHostRaw)
    ? "http:"
    : "https:";
const partykitOrigin = toOrigin(partykitHostRaw, partykitDefaultProto);

const connectSources = Array.from(
  new Set(
    [
      "'self'",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      supabaseOrigin,
      supabaseOrigin ? toWsOrigin(supabaseOrigin) : null,
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
      "https://*.ingest.de.sentry.io",
      "https://*.sentry.io",
      sentryOrigin,
      "https://*.workers.dev",
      "wss://*.workers.dev",
      "https://*.partykit.dev",
      "wss://*.partykit.dev",
      partykitOrigin,
      partykitOrigin ? toWsOrigin(partykitOrigin) : null,
      ...(!isProduction
        ? [
            "http://localhost:*",
            "ws://localhost:*",
            "http://127.0.0.1:*",
            "ws://127.0.0.1:*",
          ]
        : []),
    ].filter((entry): entry is string => Boolean(entry)),
  ),
);

const scriptSrc = isProduction
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const cspHeader = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https:",
  scriptSrc,
  `connect-src ${connectSources.join(" ")}`,
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspHeader,
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const config: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

const sentryOptions = {
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
};

export default withSentryConfig(config, sentryOptions as any);
