-- Sprint 3: Multi-Quality Pipeline & Tier Enforcement
-- ====================================================

-- 1. Add profile_id to sessions table (link session to host's profile for tier checks)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_profile ON public.sessions(profile_id);


-- 2. Function to check listener limit against host's tier
-- Called by listener-manager edge function before allowing a join
CREATE OR REPLACE FUNCTION public.check_listener_limit(
  p_session_id UUID
)
RETURNS TABLE(allowed BOOLEAN, current_count INT, max_allowed INT, tier TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_max INT;
  v_current INT;
  v_tier TEXT;
BEGIN
  -- Get the session's host profile
  SELECT s.profile_id INTO v_profile_id
  FROM sessions s WHERE s.id = p_session_id;

  -- If no profile linked, use free tier defaults
  IF v_profile_id IS NULL THEN
    v_max := 5;
    v_tier := 'free';
  ELSE
    SELECT p.max_listeners, p.subscription_tier::text
    INTO v_max, v_tier
    FROM profiles p WHERE p.id = v_profile_id;

    IF NOT FOUND THEN
      v_max := 5;
      v_tier := 'free';
    END IF;
  END IF;

  -- Enterprise tier = unlimited (-1)
  IF v_max = -1 THEN
    allowed := true;
    current_count := 0;
    max_allowed := -1;
    tier := v_tier;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Count active listeners (pinged within last 60 seconds)
  SELECT COUNT(*)::int INTO v_current
  FROM session_listeners sl
  WHERE sl.session_id = p_session_id
    AND sl.last_ping_at > (now() - interval '60 seconds');

  allowed := v_current < v_max;
  current_count := v_current;
  max_allowed := v_max;
  tier := v_tier;
  RETURN NEXT;
END;
$$;


-- 3. Function to get quality variants available for a movie based on host tier
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
    WHEN 'event', 'pro' THEN
      RETURN (
        SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
        FROM jsonb_array_elements(v_variants) v
        WHERE v->>'quality' IN ('720p', '1080p')
      );
    WHEN 'enterprise' THEN
      RETURN v_variants; -- All qualities
    ELSE
      RETURN '[]'::jsonb;
  END CASE;
END;
$$;
