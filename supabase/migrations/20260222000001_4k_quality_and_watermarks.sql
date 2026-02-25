-- Migration: Add 4K quality for enterprise, watermark columns for pro/enterprise
-- ============================================================================

-- 1. Add '4k' enum value to quality_profile (keeping '4k_hdr' for backward compat)
ALTER TYPE public.quality_profile ADD VALUE IF NOT EXISTS '4k';

-- 2. Add watermark columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS watermark_text TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS watermark_image_url TEXT DEFAULT NULL;

-- 3. Update check_quality_access() — enterprise gets 4k, event/pro get 1080p, free gets 720p
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

  -- Event and Pro: up to 1080p (block 4k and 4k_hdr)
  IF v_tier IN ('event', 'pro') AND p_quality IN ('4k', '4k_hdr') THEN RETURN false; END IF;

  -- Enterprise: all qualities including 4k
  RETURN true;
END;
$$;

-- 4. Update get_available_qualities() — enterprise gets 720p + 1080p + 4k
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
      RETURN (
        SELECT COALESCE(jsonb_agg(v), '[]'::jsonb)
        FROM jsonb_array_elements(v_variants) v
        WHERE v->>'quality' IN ('720p', '1080p', '4k')
      );
    ELSE
      RETURN '[]'::jsonb;
  END CASE;
END;
$$;
