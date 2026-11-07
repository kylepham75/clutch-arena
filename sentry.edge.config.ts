import * as Sentry from "@sentry/nextjs";

export const sentryEdgeOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  enabled: Boolean(
    process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  ),
};

Sentry.init(sentryEdgeOptions);

export default Sentry;
