-- Sprint 5: Stripe Integration & Retention Enforcement
-- ====================================================
-- NOTE: profiles.stripe_customer_id, profiles.stripe_subscription_id,
--       event_passes.stripe_payment_id, movies.archived_at,
--       movies.retention_policy, get_retention_date() already exist from Sprint 1.

-- 1. Stripe webhook events table (idempotency guard)
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,           -- Stripe event ID (evt_xxx)
  event_type TEXT NOT NULL,            -- e.g. checkout.session.completed
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB                        -- Store full event for debugging
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed
  ON public.stripe_webhook_events(processed_at);

-- RLS: only service_role should access this table
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages webhook events"
  ON public.stripe_webhook_events FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
  );


-- 2. Add Stripe indexes to profiles (for webhook lookups)
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON public.profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription
  ON public.profiles(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;


-- 3. upgrade_profile_tier() — called after successful Stripe checkout
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
BEGIN
  -- Determine limits based on tier
  CASE p_new_tier
    WHEN 'pro' THEN
      v_retention := 'permanent';
      v_max_listeners := 100;
      v_concurrent := 5;
    WHEN 'enterprise' THEN
      v_retention := 'permanent';
      v_max_listeners := 999999; -- effectively unlimited
      v_concurrent := 999999;
    WHEN 'event' THEN
      v_retention := '30_days';
      v_max_listeners := 50;
      v_concurrent := 3;
    ELSE
      v_retention := '7_days';
      v_max_listeners := 5;
      v_concurrent := 1;
  END CASE;

  -- Update the profile
  UPDATE profiles
  SET subscription_tier = p_new_tier,
      tier_expires_at = NULL,  -- subscription-based tiers don't expire (Stripe handles it)
      max_listeners = v_max_listeners,
      concurrent_movies_allowed = v_concurrent,
      stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
      stripe_subscription_id = COALESCE(p_stripe_subscription_id, stripe_subscription_id),
      updated_at = now()
  WHERE id = p_profile_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Cascade retention policy to existing movies:
  -- For upgrades to permanent, clear archived_at so movies stay forever
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


-- 4. downgrade_profile_tier() — called when subscription is cancelled/expired
--    Sets a 30-day grace period before movies get retention-downgraded
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
  -- Downgrade to free with a grace period
  UPDATE profiles
  SET subscription_tier = 'free',
      tier_expires_at = now() + (p_grace_days || ' days')::interval,
      max_listeners = 5,
      concurrent_movies_allowed = 1,
      stripe_subscription_id = NULL,
      updated_at = now()
  WHERE id = p_profile_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Cascade retention policy changes to movies after grace period
  -- For now, just mark that the retention should change.
  -- The enforce_retention() cron will handle actual archival.
  UPDATE movies
  SET retention_policy = '30_days'
  WHERE profile_id = p_profile_id
    AND retention_policy = 'permanent'
    AND status != 'archived';

  RETURN true;
END;
$$;


-- 5. enforce_retention() — finds movies past their retention date and archives them
CREATE OR REPLACE FUNCTION public.enforce_retention()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_movie RECORD;
  v_retention_date TIMESTAMPTZ;
BEGIN
  FOR v_movie IN
    SELECT m.id, m.created_at, m.retention_policy, m.profile_id
    FROM movies m
    WHERE m.status NOT IN ('archived', 'error')
      AND m.retention_policy != 'permanent'
      AND m.archived_at IS NULL
  LOOP
    v_retention_date := get_retention_date(v_movie.created_at, v_movie.retention_policy);

    IF v_retention_date IS NOT NULL AND now() > v_retention_date THEN
      UPDATE movies
      SET status = 'archived',
          archived_at = now()
      WHERE id = v_movie.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;


-- 6. notify_retention_expiring() — finds movies expiring within N days
--    Returns a table of movie+profile info for email notifications
CREATE OR REPLACE FUNCTION public.notify_retention_expiring(
  p_days_ahead INT DEFAULT 2
)
RETURNS TABLE (
  movie_id UUID,
  movie_title TEXT,
  profile_id UUID,
  profile_email TEXT,
  retention_policy public.retention_policy,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id AS movie_id,
    m.title AS movie_title,
    p.id AS profile_id,
    p.email AS profile_email,
    m.retention_policy,
    get_retention_date(m.created_at, m.retention_policy) AS expires_at
  FROM movies m
  JOIN profiles p ON m.profile_id = p.id
  WHERE m.status NOT IN ('archived', 'error')
    AND m.retention_policy != 'permanent'
    AND m.archived_at IS NULL
    AND get_retention_date(m.created_at, m.retention_policy) IS NOT NULL
    AND get_retention_date(m.created_at, m.retention_policy) BETWEEN now() AND now() + (p_days_ahead || ' days')::interval;
END;
$$;


-- 7. Cleanup old webhook events (keep last 90 days)
CREATE OR REPLACE FUNCTION public.cleanup_webhook_events(
  p_days_old INT DEFAULT 90
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM stripe_webhook_events
  WHERE processed_at < now() - (p_days_old || ' days')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
