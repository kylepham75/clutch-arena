-- ClutchArena: Admin Tier Sync Trigger Migration
-- Automatically synchronizes admin tier updates on public.profiles to user_subscriptions
-- Sets default tier_expires_at for paid tiers, clears contender expiration, updates updated_at,
-- and prevents expired subscriptions from shadowing manual admin tier changes.

CREATE OR REPLACE FUNCTION public.handle_profile_tier_update()
RETURNS trigger AS $$
DECLARE
  v_cycle text;
BEGIN
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

-- Attach trigger to public.profiles
DROP TRIGGER IF EXISTS tr_profile_tier_update ON public.profiles;
CREATE TRIGGER tr_profile_tier_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_tier_update();
