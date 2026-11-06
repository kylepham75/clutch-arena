-- ClutchArena: Security Hardening Migration
-- SA-01: Restrict user_subscriptions mutations strictly to service_role
-- SA-03: Restrict profile, user_profile, and user tier mutations with strict allowlist
-- SA-04 & SA-05: Restrict shared_deck_cache and user_quota_ledgers mutations to service_role
-- SA-06 & SA-07: Harden handle_profile_tier_update trigger against duplicate admin rows & support all cycles
-- SA-08: Add missing user_runs UPDATE policy for client upserts
-- SA-09: Restrict pilot_telemetry INSERT strictly to service_role
-- SA-10: Guard user_profiles packs_generated_this_month against non-service-role changes

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
-- Helper: Validate profile tier update authorization
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_update_profile_tier(
  p_user_id uuid,
  p_new_tier text,
  p_new_expires_at timestamptz
)
RETURNS boolean AS $$
DECLARE
  v_current_tier text;
  v_current_expires timestamptz;
BEGIN
  IF public.is_service_role() THEN
    RETURN true;
  END IF;

  SELECT tier, tier_expires_at
  INTO v_current_tier, v_current_expires
  FROM public.profiles
  WHERE id = p_user_id;

  -- Fallback to user_profiles if profiles record does not exist
  IF v_current_tier IS NULL AND EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    SELECT tier, tier_expires_at
    INTO v_current_tier, v_current_expires
    FROM public.user_profiles
    WHERE id = p_user_id;
  END IF;

  IF (p_new_tier IS NOT DISTINCT FROM v_current_tier) AND (p_new_expires_at IS NOT DISTINCT FROM v_current_expires) THEN
    RETURN true;
  END IF;

  IF p_new_tier IN ('contender', 'free') AND p_new_expires_at IS NULL THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.can_update_profile_tier(uuid, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_update_profile_tier(uuid, text, timestamptz) TO authenticated, service_role;

-- ============================================================================
-- Helper: Validate user profile quota update authorization
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_update_user_profile_quota(
  p_user_id uuid,
  p_new_packs int
)
RETURNS boolean AS $$
DECLARE
  v_current_packs int;
BEGIN
  IF public.is_service_role() THEN
    RETURN true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    RETURN true;
  END IF;

  SELECT packs_generated_this_month
  INTO v_current_packs
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF (p_new_packs IS NOT DISTINCT FROM v_current_packs) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.can_update_user_profile_quota(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_update_user_profile_quota(uuid, int) TO authenticated, service_role;

-- ============================================================================
-- Helper: Trigger function to guard user_profiles packs_generated_this_month
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_user_profile_quota_update()
RETURNS trigger AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    IF OLD.packs_generated_this_month IS DISTINCT FROM NEW.packs_generated_this_month THEN
      RAISE EXCEPTION 'Unauthorized: Non-service role callers cannot modify packs_generated_this_month.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================================
-- 1. Harden public.handle_profile_tier_update trigger function and trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_profile_tier_update()
RETURNS trigger AS $$
DECLARE
  v_cycle text;
  v_has_active_payos boolean := false;
BEGIN
  -- Security enforcement: reject client direct writes unless service_role
  IF NOT public.is_service_role() THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT (NEW.tier IN ('contender', 'free') AND NEW.tier_expires_at IS NULL) THEN
        RAISE EXCEPTION 'Unauthorized: Non-service role callers may only set tier to contender or free with null expiration.';
      END IF;
    ELSE
      IF (OLD.tier IS DISTINCT FROM NEW.tier) OR (OLD.tier_expires_at IS DISTINCT FROM NEW.tier_expires_at) THEN
        IF NOT (NEW.tier IN ('contender', 'free') AND NEW.tier_expires_at IS NULL) THEN
          RAISE EXCEPTION 'Unauthorized: Non-service role callers may only set tier to contender or free with null expiration.';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Fire only on tier change, or on INSERT of a paid tier, or when service_role clears expiration on an existing paid tier
  IF (TG_OP = 'INSERT' AND NEW.tier IN ('cram_pass', 'pro_monthly', 'pro', 'tutor'))
     OR (TG_OP = 'UPDATE' AND (
          (OLD.tier IS DISTINCT FROM NEW.tier)
          OR (NEW.tier IN ('cram_pass', 'pro_monthly', 'pro', 'tutor') AND NEW.tier_expires_at IS NULL AND OLD.tier_expires_at IS NOT NULL)
        )) THEN
    IF NEW.tier IN ('cram_pass', 'pro_monthly', 'pro', 'tutor') THEN
      -- Map cycle and calculate expiration if missing or elapsed
      IF NEW.tier = 'cram_pass' THEN
        v_cycle := 'Pass 7 Ngày';
        IF NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now() THEN
          NEW.tier_expires_at := now() + interval '7 days';
        END IF;
      ELSIF NEW.tier = 'pro_monthly' THEN
        v_cycle := 'monthly';
        IF NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now() THEN
          NEW.tier_expires_at := now() + interval '30 days';
        END IF;
      ELSIF NEW.tier = 'pro' THEN
        v_cycle := 'semester';
        IF NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now() THEN
          NEW.tier_expires_at := now() + interval '4 months';
        END IF;
      ELSIF NEW.tier = 'tutor' THEN
        v_cycle := 'semester';
        IF NEW.tier_expires_at IS NULL OR NEW.tier_expires_at <= now() THEN
          NEW.tier_expires_at := now() + interval '4 months';
        END IF;
      END IF;

      NEW.updated_at := now();

      -- Check if an active PayOS subscription already exists for this tier update
      SELECT EXISTS (
        SELECT 1 FROM public.user_subscriptions
        WHERE user_id = NEW.id
          AND status = 'active'
          AND payment_method = 'payos_vietqr'
          AND tier = NEW.tier
          AND (
            expires_at = NEW.tier_expires_at
            OR expires_at > now()
          )
      ) INTO v_has_active_payos;

      -- Only expire prior active subscriptions and insert a 'manual_admin' row
      -- when no active payos_vietqr row matches the update
      IF NOT v_has_active_payos THEN
        UPDATE public.user_subscriptions
        SET status = 'expired'
        WHERE user_id = NEW.id AND status = 'active';

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
      END IF;

    ELSIF NEW.tier IN ('contender', 'free') THEN
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

    -- Also keep users updated if table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
      UPDATE public.users
      SET tier = NEW.tier,
          updated_at = NEW.updated_at
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Attach trigger to public.profiles
DROP TRIGGER IF EXISTS tr_profile_tier_update ON public.profiles;
CREATE TRIGGER tr_profile_tier_update
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_tier_update();

-- ============================================================================
-- 2. Harden handle_new_user search_path
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user') THEN
    ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
  END IF;
END $$;

-- ============================================================================
-- 3. Harden public.user_subscriptions RLS (SA-01)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_subscriptions') THEN
    ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can insert their own subscriptions" ON public.user_subscriptions;
    DROP POLICY IF EXISTS "Service role can manage subscriptions" ON public.user_subscriptions;
    DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.user_subscriptions;

    CREATE POLICY "Users can view their own subscriptions"
      ON public.user_subscriptions FOR SELECT
      USING (auth.uid() = user_id);

    CREATE POLICY "Service role can manage subscriptions"
      ON public.user_subscriptions FOR ALL
      USING (public.is_service_role())
      WITH CHECK (public.is_service_role());
  END IF;
END $$;

-- ============================================================================
-- 4. Harden public.profiles RLS (SA-03)
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND (
      public.is_service_role()
      OR (
        COALESCE(tier, 'contender') IN ('contender', 'free')
        AND tier_expires_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND public.can_update_profile_tier(id, tier, tier_expires_at)
  );

-- ============================================================================
-- 5. Harden public.user_profiles RLS (SA-03)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
    ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS tier_expires_at timestamptz DEFAULT NULL;
    ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can view their own user_profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can insert their own profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can insert their own user_profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "Users can update their own user_profile" ON public.user_profiles;

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
            COALESCE(tier, 'contender') IN ('contender', 'free')
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
            (
              (
                COALESCE(tier, 'contender') IN ('contender', 'free')
                AND tier_expires_at IS NULL
              )
              OR public.can_update_profile_tier(id, tier, tier_expires_at)
            )
            AND public.can_update_user_profile_quota(id, packs_generated_this_month)
          )
        )
      );

    DROP TRIGGER IF EXISTS tr_user_profile_quota_guard ON public.user_profiles;
    CREATE TRIGGER tr_user_profile_quota_guard
      BEFORE UPDATE ON public.user_profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_user_profile_quota_update();
  END IF;
END $$;

-- ============================================================================
-- 6. Harden public.users RLS (SA-03)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
    DROP POLICY IF EXISTS "Users can insert their own record" ON public.users;
    DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
    DROP POLICY IF EXISTS "Users can update their own record" ON public.users;
    DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
    DROP POLICY IF EXISTS "Users can view their own record" ON public.users;

    CREATE POLICY "Users can view their own record"
      ON public.users FOR SELECT
      TO authenticated
      USING (auth.uid() = id);

    CREATE POLICY "Users can insert their own record"
      ON public.users FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = id
        AND (
          public.is_service_role()
          OR COALESCE(tier, 'free') IN ('contender', 'free')
        )
      );

    CREATE POLICY "Users can update their own record"
      ON public.users FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (
        auth.uid() = id
        AND (
          public.is_service_role()
          OR COALESCE(tier, 'free') IN ('contender', 'free')
          OR tier = (SELECT u.tier FROM public.users u WHERE u.id = id)
        )
      );
  END IF;
END $$;

-- ============================================================================
-- 7. Harden public.shared_deck_cache RLS (SA-04 & SA-05)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shared_deck_cache') THEN
    ALTER TABLE public.shared_deck_cache ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Anyone can view shared deck cache" ON public.shared_deck_cache;
    DROP POLICY IF EXISTS "Authenticated or service can insert shared deck cache" ON public.shared_deck_cache;
    DROP POLICY IF EXISTS "Authenticated or service can update shared deck cache" ON public.shared_deck_cache;
    DROP POLICY IF EXISTS "Service role can select shared deck cache" ON public.shared_deck_cache;
    DROP POLICY IF EXISTS "Service role can insert shared deck cache" ON public.shared_deck_cache;
    DROP POLICY IF EXISTS "Service role can update shared deck cache" ON public.shared_deck_cache;
    DROP POLICY IF EXISTS "Service role can delete shared deck cache" ON public.shared_deck_cache;

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
  END IF;
END $$;

-- ============================================================================
-- 8. Harden public.user_quota_ledgers RLS (SA-04 & SA-05)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_quota_ledgers') THEN
    ALTER TABLE public.user_quota_ledgers ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can insert their own quota ledger" ON public.user_quota_ledgers;
    DROP POLICY IF EXISTS "Users can update their own quota ledger" ON public.user_quota_ledgers;
    DROP POLICY IF EXISTS "Users can view their own quota ledger" ON public.user_quota_ledgers;
    DROP POLICY IF EXISTS "Service role can insert quota ledger" ON public.user_quota_ledgers;
    DROP POLICY IF EXISTS "Service role can update quota ledger" ON public.user_quota_ledgers;
    DROP POLICY IF EXISTS "Service role can delete quota ledger" ON public.user_quota_ledgers;

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
  END IF;
END $$;

-- ============================================================================
-- 9. Harden public.user_runs RLS: Add missing UPDATE policy for upsert (SA-08)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_runs') THEN
    DROP POLICY IF EXISTS "Users can update their own runs" ON public.user_runs;

    CREATE POLICY "Users can update their own runs"
      ON public.user_runs FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================================
-- 10. Harden public.pilot_telemetry RLS: Restrict INSERT to service_role (SA-09)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pilot_telemetry') THEN
    ALTER TABLE public.pilot_telemetry ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Allow insert for anon and authenticated" ON public.pilot_telemetry;
    DROP POLICY IF EXISTS "Service role can insert telemetry" ON public.pilot_telemetry;
    DROP POLICY IF EXISTS "Service role can select telemetry" ON public.pilot_telemetry;

    CREATE POLICY "Service role can insert telemetry"
      ON public.pilot_telemetry FOR INSERT
      WITH CHECK (public.is_service_role());

    CREATE POLICY "Service role can select telemetry"
      ON public.pilot_telemetry FOR SELECT
      USING (public.is_service_role());
  END IF;
END $$;

