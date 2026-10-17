-- ClutchArena: Full PostgreSQL Cloud Sync Migration
-- Run this migration in your Supabase SQL Editor

-- 1. Users Table (Tied to auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  avatar_url text,
  tier text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own record"
  ON public.users
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own record"
  ON public.users
  FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own record"
  ON public.users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 2. User Profiles Table (Quota & Subscription Settings)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  tier text NOT NULL DEFAULT 'free',
  packs_generated_this_month int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.user_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 3. Cloud Study Packs Table (Decks, Questions, Citations)
CREATE TABLE IF NOT EXISTS public.user_study_packs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  question_count int NOT NULL DEFAULT 0,
  pack jsonb NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_study_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own study packs"
  ON public.user_study_packs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own study packs"
  ON public.user_study_packs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own study packs"
  ON public.user_study_packs
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own study packs"
  ON public.user_study_packs
  FOR DELETE
  USING (auth.uid() = user_id);

-- 4. User Runs Table (Run History, High Scores, Stats)
CREATE TABLE IF NOT EXISTS public.user_runs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date timestamptz NOT NULL DEFAULT now(),
  score int NOT NULL DEFAULT 0,
  correct int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  best_streak int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own runs"
  ON public.user_runs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own runs"
  ON public.user_runs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own runs"
  ON public.user_runs
  FOR DELETE
  USING (auth.uid() = user_id);

-- 5. User Concept Mastery Table (Topic Mastery & Weak Spot Tracking)
CREATE TABLE IF NOT EXISTS public.user_concept_mastery (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  total_attempts int NOT NULL DEFAULT 0,
  correct_attempts int NOT NULL DEFAULT 0,
  consecutive_correct int NOT NULL DEFAULT 0,
  last_attempted_at timestamptz NOT NULL DEFAULT now(),
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, topic)
);

ALTER TABLE public.user_concept_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own mastery stats"
  ON public.user_concept_mastery
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own mastery stats"
  ON public.user_concept_mastery
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own mastery stats"
  ON public.user_concept_mastery
  FOR UPDATE
  USING (auth.uid() = user_id);

-- 6. Automatic Trigger for New Users (Signup via Email or Google OAuth)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Insert into public.users
  INSERT INTO public.users (id, email, avatar_url, tier)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    'free'
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
      updated_at = now();

  -- Insert into public.user_profiles
  INSERT INTO public.user_profiles (id, email, tier)
  VALUES (new.id, new.email, 'free')
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
