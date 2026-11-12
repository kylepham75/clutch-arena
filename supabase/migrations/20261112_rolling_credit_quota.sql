-- Rolling Antigravity-style Percentage Quota Columns on user_quota_ledgers
-- Tracks fast rolling session/daily/3-day window spend alongside a longer anti-drain rolling guard window.

ALTER TABLE public.user_quota_ledgers
  ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS window_spent_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_reserved_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS weekly_spent_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_reserved_usd NUMERIC(12, 6) NOT NULL DEFAULT 0;
