-- ClutchArena: Pilot Telemetry Migration
-- Creates public.pilot_telemetry table for user feedback, smoke test intents, and parser telemetry

CREATE TABLE IF NOT EXISTS public.pilot_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_kind text NOT NULL,
  category text,
  message text,
  contact text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index by event_kind and created_at DESC for efficient dashboard filtering and recent event lookups
CREATE INDEX IF NOT EXISTS idx_pilot_telemetry_kind_created
  ON public.pilot_telemetry (event_kind, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.pilot_telemetry ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Policy: Allow anonymous and authenticated users to submit telemetry
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pilot_telemetry'
      AND policyname = 'Allow insert for anon and authenticated'
  ) THEN
    CREATE POLICY "Allow insert for anon and authenticated"
      ON public.pilot_telemetry
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
  END IF;

  -- Policy: Allow users to view their own submitted telemetry
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pilot_telemetry'
      AND policyname = 'Users can view their own telemetry'
  ) THEN
    CREATE POLICY "Users can view their own telemetry"
      ON public.pilot_telemetry
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
