-- ClutchArena: Shared Deck Cache & Durable COGS Quota Migration
-- Stage 1: Fast-path caching & unit economic COGS enforcement

-- 1. Create `public.shared_deck_cache` table
CREATE TABLE IF NOT EXISTS public.shared_deck_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash text NOT NULL,
  file_sha256 text,
  language text NOT NULL DEFAULT 'en',
  mode text NOT NULL DEFAULT 'generate',
  focus_hash text NOT NULL DEFAULT '',
  pipeline_version text NOT NULL,
  served_generator_model text,
  served_verifier_model text,
  question_pool jsonb NOT NULL DEFAULT '[]'::jsonb,
  study_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  clutch_note jsonb,
  hit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fast-path lookup index on file_sha256
CREATE INDEX IF NOT EXISTS idx_shared_deck_cache_file_sha256
  ON public.shared_deck_cache (file_sha256);

-- Unique composite index on (content_hash, language, mode, focus_hash, pipeline_version)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_deck_cache_composite
  ON public.shared_deck_cache (content_hash, language, mode, focus_hash, pipeline_version);

-- Enable RLS on shared_deck_cache
ALTER TABLE public.shared_deck_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'shared_deck_cache' AND policyname = 'Anyone can view shared deck cache'
  ) THEN
    CREATE POLICY "Anyone can view shared deck cache"
      ON public.shared_deck_cache FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'shared_deck_cache' AND policyname = 'Authenticated or service can insert shared deck cache'
  ) THEN
    CREATE POLICY "Authenticated or service can insert shared deck cache"
      ON public.shared_deck_cache FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'shared_deck_cache' AND policyname = 'Authenticated or service can update shared deck cache'
  ) THEN
    CREATE POLICY "Authenticated or service can update shared deck cache"
      ON public.shared_deck_cache FOR UPDATE USING (true);
  END IF;
END $$;

-- 2. Create `public.user_quota_ledgers` table
CREATE TABLE IF NOT EXISTS public.user_quota_ledgers (
  user_id text PRIMARY KEY,
  tier text NOT NULL DEFAULT 'contender',
  cogs_spent_usd numeric(10,6) NOT NULL DEFAULT 0,
  cogs_reserved_usd numeric(10,6) NOT NULL DEFAULT 0,
  cogs_ceiling_usd numeric(10,6) NOT NULL DEFAULT 0,
  deck_credits_used int NOT NULL DEFAULT 0,
  deck_credits_limit int NOT NULL DEFAULT 2,
  daily_burst_used int NOT NULL DEFAULT 0,
  daily_burst_date date NOT NULL DEFAULT CURRENT_DATE,
  unlocked_decks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on user_quota_ledgers
ALTER TABLE public.user_quota_ledgers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_quota_ledgers' AND policyname = 'Users can view their own quota ledger'
  ) THEN
    CREATE POLICY "Users can view their own quota ledger"
      ON public.user_quota_ledgers FOR SELECT USING (auth.uid()::text = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_quota_ledgers' AND policyname = 'Users can insert their own quota ledger'
  ) THEN
    CREATE POLICY "Users can insert their own quota ledger"
      ON public.user_quota_ledgers FOR INSERT WITH CHECK (auth.uid()::text = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_quota_ledgers' AND policyname = 'Users can update their own quota ledger'
  ) THEN
    CREATE POLICY "Users can update their own quota ledger"
      ON public.user_quota_ledgers FOR UPDATE USING (auth.uid()::text = user_id);
  END IF;
END $$;
