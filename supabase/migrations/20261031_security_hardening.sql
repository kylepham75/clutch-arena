-- ClutchArena: Security Hardening Migration
-- 1. Restrict client ability to write arbitrary tiers to profiles and user_profiles
-- 2. Restrict shared_deck_cache mutations to service_role to prevent poisoning

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- Helper: Validate profile tier update authorization
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_update_profile_tier(p_id uuid, p_new_tier text, p_new_tier_expires_at timestamptz)
RETURNS boolean AS $$
DECLARE
  v_old_tier text;
  v_old_expires_at timestamptz;
BEGIN
  IF public.is_service_role() THEN
    RETURN true;
  END IF;

  SELECT tier, tier_expires_at INTO v_old_tier, v_old_expires_at
  FROM public.profiles
  WHERE id = p_id;

  -- Regular users cannot self-assign paid tiers
  IF p_new_tier IN ('pro', 'cram_pass', 'tutor') AND (v_old_tier IS DISTINCT FROM p_new_tier) THEN
    RETURN false;
  END IF;

  -- Regular users cannot modify expiration timestamp
  IF v_old_expires_at IS DISTINCT FROM p_new_tier_expires_at THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 1. Harden public.profiles RLS and Trigger
-- ============================================================================

-- Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 1.1 Restrict profile INSERT to non-paid tiers for regular users
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND (
      public.is_service_role()
      OR (
        tier NOT IN ('pro', 'cram_pass', 'tutor')
        AND tier_expires_at IS NULL
      )
    )
  );

-- 1.2 Restrict profile UPDATE: users can only update non-sensitive columns or maintain existing tier
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND public.can_update_profile_tier(id, tier, tier_expires_at)
  );

-- 1.3 Harden profile tier update trigger function against unauthorized caller elevation
CREATE OR REPLACE FUNCTION public.handle_profile_tier_update()
RETURNS trigger AS $$
DECLARE
  v_cycle text;
BEGIN
  -- Security enforcement: reject client direct writes to paid tiers or tier expiration
  IF NOT public.is_service_role() THEN
    IF (OLD.tier IS DISTINCT FROM NEW.tier) AND (NEW.tier IN ('pro', 'cram_pass', 'tutor')) THEN
      RAISE EXCEPTION 'Unauthorized: Users cannot assign paid tier % directly.', NEW.tier;
    END IF;

    IF (OLD.tier_expires_at IS DISTINCT FROM NEW.tier_expires_at) THEN
      RAISE EXCEPTION 'Unauthorized: Users cannot modify tier_expires_at directly.';
    END IF;
  END IF;

  -- Fire when tier changes, or if a paid tier has a null/elapsed expiration
  IF (OLD.tier IS DISTINCT FROM NEW.tier) OR (NEW.tier IN ('pro', 'cram_pass', 'tutor') AND (NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now())) THEN
    IF NEW.tier IN ('pro', 'cram_pass', 'tutor') THEN
      -- Map cycle and calculate expiration if missing or elapsed
      IF NEW.tier = 'cram_pass' THEN
        v_cycle := 'one_time';
        IF NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now() THEN
          NEW.tier_expires_at := now() + interval '7 days';
        END IF;
      ELSIF NEW.tier = 'tutor' THEN
        v_cycle := 'monthly';
        IF NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now() THEN
          NEW.tier_expires_at := now() + interval '30 days';
        END IF;
      ELSIF NEW.tier = 'pro' THEN
        v_cycle := 'semester';
        IF NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now() THEN
          NEW.tier_expires_at := now() + interval '120 days';
        END IF;
      END IF;

      NEW.updated_at := now();

      -- Mark older active subscriptions as expired
      UPDATE public.user_subscriptions
      SET status = 'expired'
      WHERE user_id = NEW.id AND status = 'active';

      -- Insert active record in user_subscriptions
      INSERT INTO public.user_subscriptions (
        user_id,
        tier,
        cycle,
        amount,
        currency,
        payment_method,
        status,
        starts_at,
        expires_at,
        created_at
      ) VALUES (
        NEW.id,
        NEW.tier,
        v_cycle,
        0,
        'VND',
        'manual_admin',
        'active',
        now(),
        NEW.tier_expires_at,
        now()
      );

    ELSIF NEW.tier = 'contender' THEN
      NEW.tier_expires_at := NULL;
      NEW.updated_at := now();

      -- Mark older active subscriptions as expired
      UPDATE public.user_subscriptions
      SET status = 'expired'
      WHERE user_id = NEW.id AND status = 'active';
    END IF;

    -- Also keep user_profiles updated if table exists for backward compatibility
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
      UPDATE public.user_profiles
      SET tier = NEW.tier,
          tier_expires_at = NEW.tier_expires_at,
          updated_at = NEW.updated_at
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. Harden public.user_profiles (Backward Compatibility Table)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
    ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can update their own user_profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can insert their own user_profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can view their own user_profile" ON public.user_profiles;

    CREATE POLICY "Users can view their own user_profile"
      ON public.user_profiles FOR SELECT
      TO authenticated
      USING (auth.uid() = id);

    CREATE POLICY "Users can insert their own user_profile"
      ON public.user_profiles FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = id
        AND (
          public.is_service_role()
          OR (
            tier NOT IN ('pro', 'cram_pass', 'tutor')
            AND tier_expires_at IS NULL
          )
        )
      );

    CREATE POLICY "Users can update their own user_profile"
      ON public.user_profiles FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (
        auth.uid() = id
        AND (
          public.is_service_role()
          OR (
            tier NOT IN ('pro', 'cram_pass', 'tutor')
            AND tier_expires_at IS NULL
          )
        )
      );
  END IF;
END $$;

-- ============================================================================
-- 3. Harden public.shared_deck_cache RLS
-- ============================================================================

-- Drop permissive insert and update policies
DROP POLICY IF EXISTS "Authenticated or service can insert shared deck cache" ON public.shared_deck_cache;
DROP POLICY IF EXISTS "Authenticated or service can update shared deck cache" ON public.shared_deck_cache;

-- Ensure public SELECT remains active
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'shared_deck_cache' AND policyname = 'Anyone can view shared deck cache'
  ) THEN
    CREATE POLICY "Anyone can view shared deck cache"
      ON public.shared_deck_cache FOR SELECT USING (true);
  END IF;
END $$;

-- Restrict INSERT and UPDATE strictly to service_role
DROP POLICY IF EXISTS "Service role can insert shared deck cache" ON public.shared_deck_cache;
CREATE POLICY "Service role can insert shared deck cache"
  ON public.shared_deck_cache FOR INSERT
  WITH CHECK (public.is_service_role());

DROP POLICY IF EXISTS "Service role can update shared deck cache" ON public.shared_deck_cache;
CREATE POLICY "Service role can update shared deck cache"
  ON public.shared_deck_cache FOR UPDATE
  USING (public.is_service_role())
  WITH CHECK (public.is_service_role());
