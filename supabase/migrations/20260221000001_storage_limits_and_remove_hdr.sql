-- Migration: Add storage limits per tier + remove 4K HDR quality references
-- ============================================================================

-- 1. Add storage_limit_bytes column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT NOT NULL DEFAULT 2684354560; -- 2.5 GB default (free tier)

-- Set storage limits for existing profiles based on their tier
UPDATE public.profiles SET storage_limit_bytes = 2684354560  WHERE subscription_tier = 'free';     -- 2.5 GB
UPDATE public.profiles SET storage_limit_bytes = 53687091200 WHERE subscription_tier = 'event';    -- 50 GB
UPDATE public.profiles SET storage_limit_bytes = 107374182400 WHERE subscription_tier = 'pro';     -- 100 GB
UPDATE public.profiles SET storage_limit_bytes = 1099511627776 WHERE subscription_tier = 'enterprise'; -- 1 TB


-- 2. Update check_quality_access() — remove 4k_hdr blocking, max is now 1080p for all paid tiers
CREATE OR REPLACE FUNCTION public.check_quality_access(
  p_profile_id UUID,
  p_quality public.quality_profile
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tier public.subscription_tier;
BEGIN
  SELECT subscription_tier INTO v_tier
  FROM profiles WHERE id = p_profile_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Free: 720p only
  IF v_tier = 'free' AND p_quality != '720p' THEN RETURN false; END IF;
  -- All paid tiers (event, pro, enterprise): up to 1080p
  RETURN true;
END;
$$;


-- 3. Update get_available_qualities() — enterprise now gets same as pro (720p + 1080p, no 4k_hdr)
CREATE OR REPLACE FUNCTION public.get_available_qualities(
  p_movie_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_variants JSONB;
  v_tier public.subscription_tier;
  v_profile_id UUID;
BEGIN
  SELECT m.variants, m.profile_id INTO v_variants, v_profile_id
  FROM movies m WHERE m.id = p_movie_id;

  IF NOT FOUND OR v_variants IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- If no profile, return only 720p variants
  IF v_profile_id IS NULL THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
      FROM jsonb_array_elements(v_variants) v
      WHERE v->>'quality' = '720p'
    );
  END IF;

  SELECT p.subscription_tier INTO v_tier
  FROM profiles p WHERE p.id = v_profile_id;

  IF NOT FOUND THEN v_tier := 'free'; END IF;

  -- Filter variants based on tier
  CASE v_tier
    WHEN 'free' THEN
      RETURN (
        SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
        FROM jsonb_array_elements(v_variants) v
        WHERE v->>'quality' = '720p'
      );
    WHEN 'event', 'pro', 'enterprise' THEN
      RETURN (
        SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
        FROM jsonb_array_elements(v_variants) v
        WHERE v->>'quality' IN ('720p', '1080p')
      );
    ELSE
      RETURN '[]'::jsonb;
  END CASE;
END;
$$;


-- 4. Update upgrade_profile_tier() — include storage_limit_bytes
CREATE OR REPLACE FUNCTION public.upgrade_profile_tier(
  p_profile_id UUID,
  p_new_tier public.subscription_tier,
  p_stripe_customer_id TEXT DEFAULT NULL,
  p_stripe_subscription_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention public.retention_policy;
  v_max_listeners INT;
  v_concurrent INT;
  v_storage BIGINT;
BEGIN
  -- Determine limits based on tier
  CASE p_new_tier
    WHEN 'pro' THEN
      v_retention := 'permanent';
      v_max_listeners := 100;
      v_concurrent := 5;
      v_storage := 107374182400;   -- 100 GB
    WHEN 'enterprise' THEN
      v_retention := 'permanent';
      v_max_listeners := 999999;   -- effectively unlimited
      v_concurrent := 999999;
      v_storage := 1099511627776;  -- 1 TB
    WHEN 'event' THEN
      v_retention := '30_days';
      v_max_listeners := 50;
      v_concurrent := 3;
      v_storage := 53687091200;    -- 50 GB
    ELSE
      v_retention := '7_days';
      v_max_listeners := 5;
      v_concurrent := 1;
      v_storage := 2684354560;     -- 2.5 GB
  END CASE;

  -- Update the profile
  UPDATE profiles
  SET subscription_tier = p_new_tier,
      tier_expires_at = NULL,
      max_listeners = v_max_listeners,
      concurrent_movies_allowed = v_concurrent,
      storage_limit_bytes = v_storage,
      stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
      stripe_subscription_id = COALESCE(p_stripe_subscription_id, stripe_subscription_id),
      updated_at = now()
  WHERE id = p_profile_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Cascade retention policy to existing movies
  IF v_retention = 'permanent' THEN
    UPDATE movies
    SET retention_policy = 'permanent',
        archived_at = NULL
    WHERE profile_id = p_profile_id
      AND status != 'archived';
  ELSE
    UPDATE movies
    SET retention_policy = v_retention
    WHERE profile_id = p_profile_id
      AND retention_policy != 'permanent'
      AND status != 'archived';
  END IF;

  RETURN true;
END;
$$;


-- 5. Update downgrade_profile_tier() — reset storage to free tier
CREATE OR REPLACE FUNCTION public.downgrade_profile_tier(
  p_profile_id UUID,
  p_grace_days INT DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET subscription_tier = 'free',
      tier_expires_at = now() + (p_grace_days || ' days')::interval,
      max_listeners = 5,
      concurrent_movies_allowed = 1,
      storage_limit_bytes = 2684354560,  -- 2.5 GB (free tier)
      stripe_subscription_id = NULL,
      updated_at = now()
  WHERE id = p_profile_id;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE movies
  SET retention_policy = '30_days'
  WHERE profile_id = p_profile_id
    AND retention_policy = 'permanent'
    AND status != 'archived';

  RETURN true;
END;
$$;


-- 6. Update activate_event_pass() — include storage limit
CREATE OR REPLACE FUNCTION public.activate_event_pass(
  p_pass_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass event_passes%ROWTYPE;
BEGIN
  SELECT * INTO v_pass FROM event_passes WHERE id = p_pass_id FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_pass.status != 'pending' THEN RETURN false; END IF;
  IF now() > v_pass.max_activation_date THEN
    UPDATE event_passes SET status = 'expired' WHERE id = p_pass_id;
    RETURN false;
  END IF;

  UPDATE event_passes
  SET status = 'active',
      activation_date = now(),
      expires_at = now() + interval '48 hours'
  WHERE id = p_pass_id;

  -- Upgrade profile to event tier
  UPDATE profiles
  SET subscription_tier = 'event',
      tier_expires_at = now() + interval '48 hours',
      max_listeners = 50,
      concurrent_movies_allowed = 3,
      storage_limit_bytes = 53687091200  -- 50 GB
  WHERE id = v_pass.profile_id;

  RETURN true;
END;
$$;


-- 7. Update expire_event_passes() — reset storage on expiry
CREATE OR REPLACE FUNCTION public.expire_event_passes()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_pass RECORD;
BEGIN
  FOR v_pass IN
    SELECT ep.id, ep.profile_id
    FROM event_passes ep
    WHERE ep.status = 'active'
      AND ep.expires_at IS NOT NULL
      AND ep.expires_at < now()
  LOOP
    UPDATE event_passes SET status = 'expired' WHERE id = v_pass.id;

    -- Downgrade profile back to free (only if still on event tier)
    UPDATE profiles
    SET subscription_tier = 'free',
        tier_expires_at = NULL,
        max_listeners = 5,
        concurrent_movies_allowed = 1,
        storage_limit_bytes = 2684354560  -- 2.5 GB
    WHERE id = v_pass.profile_id
      AND subscription_tier = 'event';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
