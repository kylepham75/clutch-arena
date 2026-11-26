-- ClutchArena: Numeric Subscription Amounts & Squad Invites Migration (2026-11-25)
-- 1. Convert public.user_subscriptions.amount from int to numeric(12,2) for USD/fractional amounts
-- 2. Create public.squad_invites table with constraints, indexes, and RLS policies
-- 3. Cascade subscription revocation/refund/cancellation to squad_invites and redeemed members' tiers/quotas

-- ============================================================================
-- 1. Alter public.user_subscriptions.amount to numeric(12,2)
-- ============================================================================
ALTER TABLE public.user_subscriptions
  ALTER COLUMN amount TYPE numeric(12,2) USING amount::numeric(12,2),
  ALTER COLUMN amount SET DEFAULT 0,
  ALTER COLUMN amount SET NOT NULL;

-- ============================================================================
-- 2. Create public.squad_invites table & indexes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.squad_invites (
  id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES public.user_subscriptions(id) ON DELETE CASCADE,
  buyer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  seat_index int NOT NULL CHECK (seat_index IN (1, 2)),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'redeemed', 'revoked')),
  redeemed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  redeemed_at timestamptz DEFAULT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, seat_index)
);

CREATE INDEX IF NOT EXISTS idx_squad_invites_buyer_user_id
  ON public.squad_invites (buyer_user_id);

CREATE INDEX IF NOT EXISTS idx_squad_invites_redeemed_by_user_id
  ON public.squad_invites (redeemed_by_user_id);

-- ============================================================================
-- 3. Enable RLS & idempotent policies on public.squad_invites
-- ============================================================================
ALTER TABLE public.squad_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to squad_invites" ON public.squad_invites;
CREATE POLICY "Service role full access to squad_invites"
  ON public.squad_invites
  FOR ALL
  USING (public.is_service_role())
  WITH CHECK (public.is_service_role());

DROP POLICY IF EXISTS "Authenticated users can view own or redeemed squad_invites" ON public.squad_invites;
CREATE POLICY "Authenticated users can view own or redeemed squad_invites"
  ON public.squad_invites
  FOR SELECT
  USING (auth.uid() = buyer_user_id OR auth.uid() = redeemed_by_user_id);

-- ============================================================================
-- 4. Cascade subscription revocation/refund/cancellation to squad_invites
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cascade_squad_invites_on_subscription_revocation()
RETURNS trigger AS $$
DECLARE
  v_affected_user_ids uuid[];
  v_uid uuid;
BEGIN
  IF NEW.status IN ('revoked', 'refunded', 'cancelled')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT redeemed_by_user_id), ARRAY[]::uuid[])
    INTO v_affected_user_ids
    FROM public.squad_invites
    WHERE subscription_id = NEW.id
      AND status = 'redeemed'
      AND redeemed_by_user_id IS NOT NULL;

    UPDATE public.squad_invites
    SET status = 'revoked'
    WHERE subscription_id = NEW.id;

    UPDATE public.user_subscriptions
    SET status = NEW.status,
        expires_at = now()
    WHERE id IN (
      SELECT 'squad_redeem_' || si.id
      FROM public.squad_invites si
      WHERE si.subscription_id = NEW.id
    )
    AND status = 'active';

    FOREACH v_uid IN ARRAY v_affected_user_ids LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM public.user_subscriptions
        WHERE user_id = v_uid
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
      ) THEN
        UPDATE public.profiles
        SET tier = 'contender',
            tier_expires_at = NULL,
            updated_at = now()
        WHERE id = v_uid;

        IF to_regclass('public.user_profiles') IS NOT NULL THEN
          UPDATE public.user_profiles
          SET tier = 'contender',
              tier_expires_at = NULL,
              updated_at = now()
          WHERE id = v_uid;
        END IF;

        UPDATE public.user_quota_ledgers
        SET tier = 'contender',
            cogs_ceiling_usd = 0.08,
            updated_at = now()
        WHERE user_id = 'user:' || v_uid::text;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_subscription_revoked_cascade_squad_invites ON public.user_subscriptions;
CREATE TRIGGER on_subscription_revoked_cascade_squad_invites
  AFTER UPDATE OF status ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_squad_invites_on_subscription_revocation();
