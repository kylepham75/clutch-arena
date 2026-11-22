-- Security Audit Remediation Migration (2026-11-19)
-- Addresses:
-- 1. NV-33 / F-35: Remove SECURITY DEFINER privilege escalation in public.is_service_role()
-- 2. NV-20 / F-27: Fix default cogs_ceiling_usd = 0 on public.user_quota_ledgers
-- 3. NV-02 / F-02: Cascade auth.users deletion to quota ledgers, telemetry, and mastery records
-- 4. NV-05 / F-19: Downgrade derived profiles/user_profiles tiers upon subscription revocation/refund

-- ============================================================================
-- 1. Replace SECURITY DEFINER is_service_role() with SECURITY INVOKER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean AS $$
  SELECT (
    COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR COALESCE((auth.jwt() ->> 'role'), '') = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
  );
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp;

-- ============================================================================
-- 2. Normalize cogs_ceiling_usd default and stale zero rows
-- ============================================================================
ALTER TABLE public.user_quota_ledgers
  ALTER COLUMN cogs_ceiling_usd SET DEFAULT 0.08;

UPDATE public.user_quota_ledgers
SET cogs_ceiling_usd = CASE
  WHEN tier = 'cram_pass' THEN 0.25
  WHEN tier IN ('pro', 'pro_monthly', 'pro_semester') THEN 1.50
  WHEN tier IN ('tutor', 'tutor_guild') THEN 4.00
  ELSE 0.08
END
WHERE COALESCE(cogs_ceiling_usd, 0) <= 0;

-- ============================================================================
-- 3. Cascade account deletion across non-FK user tables
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_deleted_auth_user_data()
RETURNS trigger AS $$
BEGIN
  DELETE FROM public.user_quota_ledgers
  WHERE user_id IN ('user:' || OLD.id::text, OLD.id::text);

  DELETE FROM public.pilot_telemetry
  WHERE user_id = OLD.id;

  DELETE FROM public.user_concept_mastery
  WHERE user_id = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_deleted_cleanup ON auth.users;
CREATE TRIGGER on_auth_user_deleted_cleanup
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_deleted_auth_user_data();

-- ============================================================================
-- 4. Sync profile downgrade when a subscription is revoked/refunded/cancelled
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_profile_on_subscription_revocation()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('revoked', 'refunded', 'cancelled')
     AND (OLD.status IS NULL OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.profiles
    SET tier = 'contender',
        tier_expires_at = NULL,
        updated_at = now()
    WHERE id = NEW.user_id;

    UPDATE public.user_profiles
    SET tier = 'contender',
        tier_expires_at = NULL,
        updated_at = now()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_subscription_revoked_sync_profile ON public.user_subscriptions;
CREATE TRIGGER on_subscription_revoked_sync_profile
  AFTER UPDATE OF status ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_on_subscription_revocation();
