-- ClutchArena: User Profiles & Cloud Study Packs Migration
-- Run this migration in your Supabase SQL Editor

-- 1. User Profiles Table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  tier text NOT NULL DEFAULT 'free',
  packs_generated_this_month int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.user_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- 2. Cloud Study Packs Table
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

-- Enable RLS on user_study_packs
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

-- 3. Automatic Profile Creation on Signup Trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, tier)
  VALUES (new.id, new.email, 'free')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
