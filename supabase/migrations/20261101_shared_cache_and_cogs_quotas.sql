-- ClutchArena: Shared Deck Cache & Durable COGS Quota Migration
-- Stage 1: Fast-path caching & unit economic COGS enforcement

-- ============================================================================
-- Helper: Identify service_role / internal admin context
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean AS $$
BEGIN
  RETURN (
    COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (auth.jwt() ->> 'role') = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================================
-- 1. Create `public.shared_deck_cache` table
-- ============================================================================
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

-- Clean up any legacy or permissive policies
DROP POLICY IF EXISTS "Anyone can view shared deck cache" ON public.shared_deck_cache;
DROP POLICY IF EXISTS "Authenticated or service can insert shared deck cache" ON public.shared_deck_cache;
DROP POLICY IF EXISTS "Authenticated or service can update shared deck cache" ON public.shared_deck_cache;
DROP POLICY IF EXISTS "Service role can select shared deck cache" ON public.shared_deck_cache;
DROP POLICY IF EXISTS "Service role can insert shared deck cache" ON public.shared_deck_cache;
DROP POLICY IF EXISTS "Service role can update shared deck cache" ON public.shared_deck_cache;
DROP POLICY IF EXISTS "Service role can delete shared deck cache" ON public.shared_deck_cache;

-- Restrict all mutations and reads on shared_deck_cache strictly to service_role
CREATE POLICY "Service role can select shared deck cache"
  ON public.shared_deck_cache FOR SELECT
  USING (public.is_service_role());

CREATE POLICY "Service role can insert shared deck cache"
  ON public.shared_deck_cache FOR INSERT
  WITH CHECK (public.is_service_role());

CREATE POLICY "Service role can update shared deck cache"
  ON public.shared_deck_cache FOR UPDATE
  USING (public.is_service_role())
  WITH CHECK (public.is_service_role());

CREATE POLICY "Service role can delete shared deck cache"
  ON public.shared_deck_cache FOR DELETE
  USING (public.is_service_role());

-- ============================================================================
-- 2. Create `public.user_quota_ledgers` table
-- ============================================================================
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

-- Clean up any legacy or permissive policies
DROP POLICY IF EXISTS "Users can insert their own quota ledger" ON public.user_quota_ledgers;
DROP POLICY IF EXISTS "Users can update their own quota ledger" ON public.user_quota_ledgers;
DROP POLICY IF EXISTS "Users can view their own quota ledger" ON public.user_quota_ledgers;
DROP POLICY IF EXISTS "Service role can insert quota ledger" ON public.user_quota_ledgers;
DROP POLICY IF EXISTS "Service role can update quota ledger" ON public.user_quota_ledgers;
DROP POLICY IF EXISTS "Service role can delete quota ledger" ON public.user_quota_ledgers;

-- Users can only view their own ledger; all writes restricted to service_role
CREATE POLICY "Users can view their own quota ledger"
  ON public.user_quota_ledgers FOR SELECT
  USING (auth.uid()::text = user_id OR public.is_service_role());

CREATE POLICY "Service role can insert quota ledger"
  ON public.user_quota_ledgers FOR INSERT
  WITH CHECK (public.is_service_role());

CREATE POLICY "Service role can update quota ledger"
  ON public.user_quota_ledgers FOR UPDATE
  USING (public.is_service_role())
  WITH CHECK (public.is_service_role());

CREATE POLICY "Service role can delete quota ledger"
  ON public.user_quota_ledgers FOR DELETE
  USING (public.is_service_role());
